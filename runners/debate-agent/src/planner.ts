// The one-shot planner: produce a validated debate Plan, with retry.
//
// The daemon spawns a planner CLI that loads the debate-router skill's STRATEGY
// (its planner mode) and designs the debate for this task. The strict output
// FORMAT is owned here (the prompt below) and validated in plan.ts — the skill
// never records the plan format. On invalid output the daemon retries with the
// validation error fed back, which is why strict-format generation is reliable
// here (code-driven retry) in a way it is not in the sandboxed parent.

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Allowlist, resolveProvider } from "./allowlist";
import { fallbackCategory, isFallbackEligible } from "./fallback";
import { buildChildLaunch } from "./launch";
import { DebateRequest } from "./mailbox";
import { PLAN_JSON_SCHEMA, Plan, PlanInvalid, parsePlan, validatePlan } from "./plan";
import { classifyRateLimit } from "./ratelimit";
import { execute } from "./runner";

const SCHEMA_STR = JSON.stringify(PLAN_JSON_SCHEMA);

// Planning is one reasoning-heavy call; mirror the proposal-generation budget.
const PLANNER_TIMEOUT_SECONDS = 1800;
// One extra attempt over the old default so a failed primary planner can rotate
// to a fallback provider AND still get a retry-on-invalid there.
const DEFAULT_MAX_ATTEMPTS = 4;

export class PlanFailed extends Error {}

/** Thrown by the CLI planner when every candidate provider failed to launch or
 * produce a plan, so planWithRetry can stop immediately instead of spinning its
 * remaining retry budget on attempts that can only re-throw this. */
export class AllPlannersUnavailable extends Error {}
// Back-compat for older tests/imports; rate limits are now one unavailable case.
export class AllPlannersRateLimited extends AllPlannersUnavailable {}

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
      // Every planner provider is unavailable — further attempts can only
      // re-throw this, so stop now rather than burn the rest of the budget.
      if (err instanceof AllPlannersUnavailable) {
        log?.(`plan aborted: ${err.message}`);
        throw new PlanFailed(err.message);
      }
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
      "launches": [ { "id": "<unique slug, e.g. P1>", "provider": "<one provider id from the request provider list>", "prompt": "<full self-contained instruction for this worker>", "effort": <thinking override string, or null for no override> } ] }
  ],
  "answer_item": "<the id of the launch whose output IS the final answer>"
}
Rules you MUST follow:
- "complexity": FIRST judge the task. SIMPLE = a focused question, a small/single-area change, or a clearly-scoped review. COMPLEX = broad, contentious, large, or spanning multiple subsystems.
  - If SIMPLE, emit the FAST workflow (keep it short, this is the whole point):
      Phase 1 "proposal_generation": TWO independent reviewers in PARALLEL; Phase 2 "arbitration": ONE arbiter that reads {{P1.output}} and {{P2.output}} and writes the final answer, noting any disagreement. answer_item = that arbiter.
      Use the request provider order positionally: P1 = providers[0], P2 = providers[1] if present otherwise providers[0], A1 = providers[2] if present otherwise providers[0]. Ignore providers after the first three for this simple shape. For example, codex-only means P1/P2/A1 are all codex with effort null unless you deliberately set one.
      Do NOT add separate critique / cross-review phases for a simple task.
  - If COMPLEX, design the full bounded debate (proposal_generation -> normalization -> critique -> cross_review -> arbitration), allocating providers and optional effort per the task.
- "effort" is a REQUIRED key, but use null for "no override" (let the child CLI's own profile/config decide):
    codex: prefer null so the user's Codex profile controls model/reasoning/service tier. Set low|medium|high|xhigh only when the task truly needs an explicit override.
    claude: null means the runner uses high. Set xhigh or max ONLY when that launch needs deeper reasoning.
    copilot: use null; the runner ignores effort for copilot.
    valid values — null, or claude: low|medium|high|xhigh|max ; codex: low|medium|high|xhigh ; copilot: low|medium|high|xhigh|max.
- Provider capabilities (allocate accordingly):
    claude worker = can Read/Grep/Glob and run READ-ONLY git (git diff/log/show/status/blame), but NOT arbitrary shell.
    codex worker = read-only OS sandbox; can run any read-only command. Give tasks needing shell beyond git (build, tests, broad inspection) to codex.
    copilot worker = plan-mode reviewer; useful as an extra independent opinion when the request explicitly includes it.
- Each launch is one independent read-only worker; its "prompt" must be a COMPLETE, self-contained instruction (the worker does NOT run any skill — it only answers the prompt you give). Give it a concrete anchor (what artifact / which change to look at) and tell it to read the affected code AND its callers/dependents to judge impact — do NOT write "explore the whole repo", and do NOT artificially restrict it to only the diff.
- Launches within the same phase run in PARALLEL and must NOT depend on each other. A later phase's prompt may embed an EARLIER launch's output with {{<id>.output}} (only earlier phases). Write the surrounding framing yourself.
- "id" values are unique slugs across the whole plan. "answer_item" is the launch whose output is the final, human-facing answer — its prompt must instruct that worker to write the final answer in the required layout and language.
- Do NOT call cli-launch, do NOT write files, do NOT execute anything, do NOT include a Trace. Output ONLY the JSON plan object.`;

function buildPlannerPrompt(req: DebateRequest, lastError: string | null): string {
  const lang = req.language ? `Write every worker prompt AND the final answer in this language: ${req.language}.` : "";
  const providerConstraint = `Provider constraint for this request: use ONLY these worker providers in the plan, in this preference order: ${req.providers.join(", ")}. Do not use any provider outside this list.`;
  // The planner only runs for NON-fast (full) debates — a fast request skips it for
  // a hardcoded lean shape (see debate.ts buildFastPlan) — so there is no "fast"
  // leanness hint here.
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
    providerConstraint,
    "",
    PLAN_FORMAT,
    retry,
  ]
    .filter((s) => s !== "")
    .join("\n");
}

/** Follow-up prompt for a RESUMED claude planner session: the task, format, and
 * the model's own prior (rejected) plan are already in the session context, so we
 * only send the validation error and ask for the corrected full plan — that is the
 * point of resuming (fix in-context instead of regenerating from scratch). */
function buildResumePrompt(lastError: string | null): string {
  return [
    "Your previous plan was REJECTED by the validator for this reason:",
    lastError ?? "(unknown)",
    "",
    "Fix only what that error points to and output the corrected, COMPLETE plan again",
    "in the same JSON schema/format as before. Output ONLY the JSON object — no prose.",
  ].join("\n");
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
/** Last `n` chars of a trimmed string — the END of CLI stderr holds the real
 * error (e.g. codex prints a startup banner + skill warnings first, then the
 * fatal API error LAST), so a head slice would show noise, not the cause. */
function stderrTail(stderr: string, n = 600): string {
  const s = (stderr || "").trim();
  return s.length > n ? `…${s.slice(-n)}` : s;
}

/** Append a failing planner attempt's FULL stderr to its stream file so the real
 * cause is preserved on disk (the planner path writes no execution audit, and the
 * stream sink otherwise only captures stdout — which is empty when the child dies
 * before producing output, e.g. a codex --output-schema 400). Best-effort: a sink
 * problem must never mask the original failure. No-op without a stream path. */
function persistPlannerStderr(
  streamPath: string | undefined,
  provider: string,
  exec: { status: string; errorCategory: string | null; returncode?: number | null; stderr: string },
): void {
  if (!streamPath) return;
  try {
    const rc = exec.returncode ?? "null";
    const header = `\n[planner failed on ${provider}: status=${exec.status} category=${exec.errorCategory ?? "null"} rc=${rc}] stderr:\n`;
    appendFileSync(streamPath, header + (exec.stderr || "(empty)") + "\n", { mode: 0o600 });
  } catch {
    /* best effort — never let a sink problem hide the real error */
  }
}

export function makeCliPlanner(
  repo: string,
  opts: {
    // Ordered planner providers: primary first, then provider-failure fallbacks.
    providers: string[];
    allow: Allowlist;
    baseEnv?: Record<string, string | undefined>;
    streamDir?: string;
    // provider -> compiled rate-limit signatures (for the `rate_limited` label).
    rateLimitPatterns?: Record<string, readonly RegExp[]>;
    // Injectable child executor (defaults to the real execute) so the provider
    // rotation can be unit-tested without spawning a CLI.
    exec?: typeof execute;
  },
): PlannerFn {
  // The planner is a launched CLI too. If it fails to produce output, rotate to
  // the next provider (same task, swap engine); `exhausted` tracks which
  // providers are spent across this debate's plan attempts.
  const exhausted = new Set<string>();
  const execFn = opts.exec ?? execute;
  // When set, the NEXT claude attempt resumes this session once (to fix the plan
  // in-context); it is consumed each time. A fresh claude attempt arms it on
  // success; a resume attempt does NOT re-arm it, so a resume that fails to fix the
  // plan (or a CLI that ignores --resume) falls back to a fresh regeneration rather
  // than looping. codex can't pin a session id for a non-interactive structured
  // exec, so codex is never resumed — it regenerates each attempt (see AGENTS.md).
  let pendingResumeSession: string | undefined;
  return async (req, attempt, lastError) => {
    const baseEnv = opts.baseEnv ?? process.env;
    const provider = opts.providers.find((p) => !exhausted.has(p));
    if (provider === undefined) {
      throw new AllPlannersUnavailable(`all planner providers are unavailable (${opts.providers.join(", ")})`);
    }
    const resolvedProvider = resolveProvider(opts.allow, provider);
    const streamPath = opts.streamDir ? join(opts.streamDir, `planner-${attempt + 1}.log`) : undefined;

    // Shared failure handler: rate limits keep their label, but any planner
    // launch/completion failure (nonzero exit, missing CLI, timeout, connection
    // error, ...) marks this provider exhausted so the next plan attempt rotates to a
    // fallback. Throwing lets planWithRetry retry with the rotated provider.
    // Branch on execution status only, never on the planner's text.
    const fail = (exec: { status: string; errorCategory: string | null; returncode?: number | null; stderr: string; stdout: string }): never => {
      // Preserve the child's real error (full to the stream file, a tail in the
      // thrown message that planWithRetry logs) BEFORE rotating — otherwise the
      // only trace is a generic "rotating to a fallback provider" line, which is
      // exactly how a codex --output-schema 400 stayed invisible.
      persistPlannerStderr(streamPath, provider, exec);
      const tail = stderrTail(exec.stderr);
      const detail = tail ? `: ${tail}` : "";
      const patterns = opts.rateLimitPatterns?.[resolvedProvider.base] ?? [];
      const limited =
        classifyRateLimit(exec.stderr, exec.stdout, patterns);
      const category = limited ? "rate_limited" : fallbackCategory(exec.errorCategory);
      if (isFallbackEligible(exec.status, category)) {
        exhausted.add(provider);
        const reason = limited ? "rate-limited" : `failed (${category})`;
        throw new Error(`planner CLI ${reason} on ${provider}${detail}; rotating to a fallback provider`);
      }
      throw new Error(`planner CLI ${exec.status} (${category}) on ${provider}${detail}`);
    };

    if (resolvedProvider.base === "codex") {
      // codex takes the schema as a file and writes the final message to `-o`.
      const prompt = buildPlannerPrompt(req, lastError); // codex always regenerates (no resume)
      const dir = mkdtempSync(join(tmpdir(), "debate-plan-"));
      const schemaFile = join(dir, "schema.json");
      const outFile = join(dir, "plan.json");
      try {
        writeFileSync(schemaFile, SCHEMA_STR);
        const launch = buildChildLaunch({
          provider,
          baseProvider: resolvedProvider.base,
          model: resolvedProvider.model,
          cwd: repo,
          profile: resolvedProvider.profile,
          capability: "read_only_review", // the planner only reasons + reads; never writes
          capabilities: ["read_only_review"],
          prompt,
          baseEnv,
          codexSchemaFile: schemaFile,
          codexOutputFile: outFile,
        });
        const exec = await execFn(launch, PLANNER_TIMEOUT_SECONDS, streamPath);
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

    // claude (default): inline schema; the result is in the envelope's
    // structured_output. A fresh attempt opens a named session (--session-id); if
    // its plan is rejected, the next attempt resumes it (--resume) with only the
    // correction. Resume is consumed BEFORE the call and re-armed only after a fresh
    // attempt, so a resume that fails (or a CLI that ignores it) falls back to a
    // fresh regeneration next time instead of looping the planner into failure.
    const resuming = pendingResumeSession !== undefined;
    const sessionId = pendingResumeSession ?? randomUUID();
    pendingResumeSession = undefined;
    const prompt = resuming ? buildResumePrompt(lastError) : buildPlannerPrompt(req, lastError);
    const launch = buildChildLaunch({
      provider,
      baseProvider: resolvedProvider.base,
      model: resolvedProvider.model,
      cwd: repo,
      profile: resolvedProvider.profile,
      capability: "read_only_review",
      capabilities: ["read_only_review"],
      prompt,
      baseEnv,
      effort: "xhigh", // the planner's job is heavy — always xhigh
      jsonSchema: SCHEMA_STR,
      claudeSession: { id: sessionId, resume: resuming },
    });
    const exec = await execFn(launch, PLANNER_TIMEOUT_SECONDS, streamPath);
    if (exec.status !== "completed") fail(exec);
    // Arm exactly one resume of this session — but only after a FRESH generation,
    // never after a resume (so a resume that didn't fix the plan regenerates fresh).
    if (!resuming) pendingResumeSession = sessionId;
    return extractClaudeStructuredOutput(exec.stdout);
  };
}
