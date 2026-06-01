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
import { classifyRateLimit } from "./ratelimit";
import { execute } from "./runner";

const SCHEMA_STR = JSON.stringify(PLAN_JSON_SCHEMA);

// Planning is one reasoning-heavy call; mirror the proposal-generation budget.
const PLANNER_TIMEOUT_SECONDS = 1800;
// One extra attempt over the old default so a rate-limited primary planner can
// rotate to a fallback provider AND still get a retry-on-invalid there.
const DEFAULT_MAX_ATTEMPTS = 4;

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
  "complexity": "simple|complex",
  "phases": [
    { "name": "<label, e.g. proposal_generation|critique|cross_review|arbitration>",
      "launches": [ { "id": "<unique slug, e.g. P1>", "provider": "claude|codex", "effort": "<see below>", "fast": <true|false>, "prompt": "<full self-contained instruction for this worker>" } ] }
  ],
  "answer_item": "<the id of the launch whose output IS the final answer>"
}
Rules you MUST follow:
- "complexity": FIRST judge the task. SIMPLE = a focused question, a small/single-area change, or a clearly-scoped review. COMPLEX = broad, contentious, large, or spanning multiple subsystems.
  - If SIMPLE, emit the FAST workflow (keep it short, this is the whole point):
      Phase 1 "proposal_generation": TWO independent reviewers in PARALLEL — P1 codex (effort xhigh, fast true) and P2 claude (effort high) — each independently does the task/review.
      Phase 2 "arbitration": ONE claude (effort high) arbiter that reads {{P1.output}} and {{P2.output}} and writes the final answer, noting any disagreement. answer_item = that arbiter.
      Do NOT add separate critique / cross-review phases for a simple task.
  - If COMPLEX, design the full bounded debate (proposal_generation -> normalization -> critique -> cross_review -> arbitration), allocating providers and effort per the task.
- "effort" (per launch, the planner's choice — DO set it):
    codex: generally "xhigh" with "fast": true (codex is fast and token-cheap).
    claude: usually "high" is enough; use "xhigh" or "max" ONLY when that launch needs deep reasoning. claude ignores "fast".
    valid values — claude: low|medium|high|xhigh|max ; codex: low|medium|high|xhigh.
- Provider capabilities (allocate accordingly):
    claude worker = can Read/Grep/Glob and run READ-ONLY git (git diff/log/show/status/blame), but NOT arbitrary shell.
    codex worker = read-only OS sandbox; can run any read-only command. Give tasks needing shell beyond git (build, tests, broad inspection) to codex.
- Each launch is one independent read-only worker; its "prompt" must be a COMPLETE, self-contained instruction (the worker does NOT run any skill — it only answers the prompt you give). Give it a concrete anchor (what artifact / which change to look at) and tell it to read the affected code AND its callers/dependents to judge impact — do NOT write "explore the whole repo", and do NOT artificially restrict it to only the diff.
- Launches within the same phase run in PARALLEL and must NOT depend on each other. A later phase's prompt may embed an EARLIER launch's output with {{<id>.output}} (only earlier phases). Write the surrounding framing yourself.
- "id" values are unique slugs across the whole plan. "answer_item" is the launch whose output is the final, human-facing answer — its prompt must instruct that worker to write the final answer in the required layout and language.
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
  opts: {
    // Ordered planner providers: primary first, then rate-limit fallbacks.
    providers: string[];
    baseEnv?: Record<string, string | undefined>;
    streamDir?: string;
    // provider -> compiled rate-limit signatures (so the planner can swap engines).
    rateLimitPatterns?: Record<string, readonly RegExp[]>;
  },
): PlannerFn {
  // The planner is a launched CLI too, so it can be rate-limited. We rotate to
  // the next provider on a rate limit (same task, swap engine); `exhausted`
  // tracks which providers are spent across this debate's plan attempts.
  const exhausted = new Set<string>();
  return async (req, attempt, lastError) => {
    const baseEnv = opts.baseEnv ?? process.env;
    const prompt = buildPlannerPrompt(req, lastError);
    const provider = opts.providers.find((p) => !exhausted.has(p));
    if (provider === undefined) {
      throw new Error(`all planner providers are rate-limited (${opts.providers.join(", ")})`);
    }
    const streamPath = opts.streamDir ? join(opts.streamDir, `planner-${attempt + 1}.log`) : undefined;

    // Shared failure handler: re-label a rate limit and mark this provider
    // exhausted so the next plan attempt rotates to a fallback; otherwise surface
    // the raw failure. Throwing lets planWithRetry retry (with the rotated
    // provider). Branch on execution status only, never on the planner's text.
    const fail = (exec: { status: string; errorCategory: string | null; stderr: string; stdout: string }): never => {
      const patterns = opts.rateLimitPatterns?.[provider] ?? [];
      const limited =
        exec.errorCategory !== "timeout" &&
        exec.errorCategory !== "missing_cli" &&
        classifyRateLimit(exec.stderr, exec.stdout, patterns);
      if (limited) {
        exhausted.add(provider);
        throw new Error(`planner CLI rate-limited on ${provider}; rotating to a fallback provider`);
      }
      throw new Error(`planner CLI ${exec.status} (${exec.errorCategory ?? "?"}): ${(exec.stderr || "").slice(0, 300)}`);
    };

    if (provider === "codex") {
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
          effort: "xhigh", // the planner's job is heavy — always xhigh
          fast: req.fast,
          codexSchemaFile: schemaFile,
          codexOutputFile: outFile,
        });
        const exec = await execute(launch, PLANNER_TIMEOUT_SECONDS, streamPath);
        if (exec.status !== "completed") fail(exec);
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
      provider,
      cwd: repo,
      profile: null,
      capability: "read_only_review",
      prompt,
      baseEnv,
      effort: "xhigh", // the planner's job is heavy — always xhigh
      jsonSchema: SCHEMA_STR,
    });
    const exec = await execute(launch, PLANNER_TIMEOUT_SECONDS, streamPath);
    if (exec.status !== "completed") fail(exec);
    return extractClaudeStructuredOutput(exec.stdout);
  };
}
