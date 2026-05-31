// The one-shot planner: produce a validated debate Plan, with retry.
//
// The daemon spawns a planner CLI that loads the debate-router skill's STRATEGY
// (its planner mode) and designs the debate for this task. The strict output
// FORMAT is owned here (the prompt below) and validated in plan.ts — the skill
// never records the plan format. On invalid output the daemon retries with the
// validation error fed back, which is why strict-format generation is reliable
// here (code-driven retry) in a way it is not in the sandboxed parent.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Allowlist } from "./allowlist";
import { buildChildLaunch } from "./launch";
import { DebateRequest } from "./mailbox";
import { PLAN_JSON_SCHEMA, Plan, PlanInvalid, parsePlan, validatePlan } from "./plan";
import { execute } from "./runner";

const SCHEMA_STR = JSON.stringify(PLAN_JSON_SCHEMA);

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

/** Extract the plan text from claude's `--output-format json` envelope: the
 * schema-validated object lives in `structured_output`. Falls back to the
 * envelope's text `result`, then to the raw stdout, so parse/validate + retry
 * still run if the shape is unexpected. */
export function extractClaudeStructuredOutput(stdout: string): string {
  try {
    const env = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (env && typeof env === "object") {
      if (env.structured_output !== undefined && env.structured_output !== null) {
        return JSON.stringify(env.structured_output);
      }
      if (typeof env.result === "string") return env.result;
    }
  } catch {
    /* not an envelope — return raw stdout, parsePlan will try */
  }
  return stdout;
}

/**
 * A real planner that spawns a CLI (read-only) and returns the plan text, using
 * the CLI's NATIVE JSON-Schema structured output as the first line of defense:
 * claude `--json-schema` (result in the `--output-format json` envelope's
 * `structured_output`); codex `--output-schema <file>` with the final message
 * captured to `-o <file>`. validatePlan + retry remain the semantic second line.
 */
export function makeCliPlanner(
  repo: string,
  opts: { provider: string; baseEnv?: Record<string, string | undefined> },
): PlannerFn {
  return async (req, _attempt, lastError) => {
    const baseEnv = opts.baseEnv ?? process.env;
    const prompt = buildPlannerPrompt(req, lastError);

    if (opts.provider === "codex") {
      // codex takes the schema as a file and writes the final message to `-o`.
      const dir = mkdtempSync(join(tmpdir(), "debate-plan-"));
      const schemaFile = join(dir, "schema.json");
      const outFile = join(dir, "plan.json");
      try {
        writeFileSync(schemaFile, SCHEMA_STR);
        const launch = buildChildLaunch({
          provider: "codex",
          cwd: repo,
          profile: null,
          capability: "read_only_review", // the planner only reasons + reads; never writes
          prompt,
          baseEnv,
          fast: req.fast,
          codexSchemaFile: schemaFile,
          codexOutputFile: outFile,
        });
        const exec = await execute(launch, PLANNER_TIMEOUT_SECONDS);
        if (exec.status !== "completed") {
          throw new Error(`planner CLI ${exec.status} (${exec.errorCategory ?? "?"}): ${(exec.stderr || "").slice(0, 300)}`);
        }
        try {
          return readFileSync(outFile, "utf8");
        } catch {
          return exec.stdout; // codex echoes the final message to stdout too
        }
      } finally {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    }

    // claude (default): inline schema; the result is in the envelope's structured_output.
    const launch = buildChildLaunch({
      provider: "claude",
      cwd: repo,
      profile: null,
      capability: "read_only_review",
      prompt,
      baseEnv,
      jsonSchema: SCHEMA_STR,
    });
    const exec = await execute(launch, PLANNER_TIMEOUT_SECONDS);
    if (exec.status !== "completed") {
      throw new Error(`planner CLI ${exec.status} (${exec.errorCategory ?? "?"}): ${(exec.stderr || "").slice(0, 300)}`);
    }
    return extractClaudeStructuredOutput(exec.stdout);
  };
}
