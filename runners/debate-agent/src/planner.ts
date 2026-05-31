// The one-shot planner: produce a validated debate Plan, with retry.
//
// The daemon spawns a planner CLI that loads the debate-router skill's STRATEGY
// (its planner mode) and designs the debate for this task. The strict output
// FORMAT is owned here (the prompt below) and validated in plan.ts — the skill
// never records the plan format. On invalid output the daemon retries with the
// validation error fed back, which is why strict-format generation is reliable
// here (code-driven retry) in a way it is not in the sandboxed parent.

import { ChildLaunch, buildChildLaunch } from "./launch";
import { DebateRequest } from "./mailbox";
import { Allowlist } from "./allowlist";
import { Plan, PlanInvalid, parsePlan, validatePlan } from "./plan";
import { execute } from "./runner";

// Planning is one reasoning-heavy call; mirror the proposal-generation budget.
const PLANNER_TIMEOUT_SECONDS = 1800;
const DEFAULT_MAX_ATTEMPTS = 3;

export class PlanFailed extends Error {}

/** Raw planner: returns the planner CLI's stdout for one attempt. Injectable so
 * tests can script plans without a real model. */
export type PlannerFn = (req: DebateRequest, attempt: number, lastError: string | null) => Promise<string>;

/**
 * Call the planner, parse + validate, and retry on invalid output (feeding the
 * error back) up to maxAttempts. Throws PlanFailed if no valid plan is produced.
 */
export async function planWithRetry(
  req: DebateRequest,
  allow: Allowlist,
  planner: PlannerFn,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  log?: (line: string) => void,
): Promise<Plan> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let text: string;
    try {
      text = await planner(req, attempt, lastError);
    } catch (err) {
      lastError = `planner call failed: ${String(err)}`;
      log?.(`plan attempt ${attempt + 1} failed: ${lastError}`);
      continue;
    }
    try {
      const plan = validatePlan(parsePlan(text), allow);
      log?.(`plan ok on attempt ${attempt + 1}: ${plan.phases.length} phase(s), answer=${plan.answerItem}`);
      return plan;
    } catch (err) {
      if (!(err instanceof PlanInvalid)) throw err;
      lastError = err.message;
      log?.(`plan attempt ${attempt + 1} invalid: ${lastError}`);
    }
  }
  throw new PlanFailed(`planner did not produce a valid plan in ${maxAttempts} attempt(s): ${lastError ?? "unknown"}`);
}

const PLAN_FORMAT = `Output ONLY one JSON object — no prose, no markdown, no code fences — with EXACTLY this shape:
{
  "phases": [
    { "name": "<label, e.g. proposal_generation|critique|cross_review|arbitration>",
      "launches": [ { "id": "<unique slug, e.g. P1>", "provider": "claude|codex", "prompt": "<full self-contained instruction for this worker>" } ] }
  ],
  "answer_item": "<the id of the launch whose output IS the final answer>"
}
Rules you MUST follow:
- Each launch is one independent read-only worker; its "prompt" must be a COMPLETE, self-contained instruction (the worker does NOT run any skill — it only answers the prompt you give).
- Launches within the same phase run in PARALLEL and must NOT depend on each other.
- A later phase's prompt may embed an EARLIER launch's output with the placeholder {{<id>.output}} (only reference ids from earlier phases). Write the surrounding framing yourself, e.g. "Here are the proposals:\\n{{P1.output}}\\n{{P2.output}}\\nCritique them.".
- "id" values are unique slugs across the whole plan; "provider" is one of the allowlisted providers.
- "answer_item" is the launch whose output is the final, human-facing answer — its prompt must instruct that worker to write the final answer in the required layout and language.
- Do NOT call cli-launch, do NOT write files, do NOT execute anything, do NOT include a Trace. Output ONLY the JSON plan object.`;

function buildPlannerPrompt(req: DebateRequest, lastError: string | null): string {
  const lang = req.language ? `Write every worker prompt AND the final answer in this language: ${req.language}.` : "";
  const fast = req.fast
    ? "FAST mode: design a LEAN debate — fewer workers, merge or skip phases where the protocol allows — and keep it short."
    : "";
  const retry = lastError
    ? `\n\nYour previous attempt was REJECTED for this reason:\n${lastError}\nFix it and output only the corrected JSON plan.`
    : "";
  return [
    "You are the PLANNER for a bounded multi-CLI debate. Apply the debate-router skill's STRATEGY",
    "(entry-case classification, proposal generation, normalization, critique, cross-review, arbitration,",
    "and the degrade rules) to design — but NOT run — the debate for the task below. You only output a plan.",
    "",
    `Task to debate:\n${req.prompt}`,
    "",
    `Target repository (workers run read-only here): ${req.repo}`,
    lang,
    fast,
    "",
    PLAN_FORMAT,
    retry,
  ]
    .filter((s) => s !== "")
    .join("\n");
}

/** A real planner that spawns a CLI (read-only) and returns its stdout. */
export function makeCliPlanner(
  repo: string,
  opts: { provider: string; baseEnv?: Record<string, string | undefined> },
): PlannerFn {
  return async (req, _attempt, lastError) => {
    const launch: ChildLaunch = buildChildLaunch({
      provider: opts.provider,
      cwd: repo,
      profile: null,
      capability: "read_only_review", // the planner only reasons + reads; never writes
      prompt: buildPlannerPrompt(req, lastError),
      baseEnv: opts.baseEnv ?? process.env,
      fast: req.fast,
    });
    const exec = await execute(launch, PLANNER_TIMEOUT_SECONDS);
    if (exec.status !== "completed") {
      throw new Error(`planner CLI ${exec.status} (${exec.errorCategory ?? "?"}): ${(exec.stderr || "").slice(0, 300)}`);
    }
    return exec.stdout;
  };
}
