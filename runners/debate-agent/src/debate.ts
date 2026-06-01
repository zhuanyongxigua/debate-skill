// The debate orchestrator: plan once (with retry), then execute the plan.
//
// Step 1: ask the planner for a validated Plan (planner.ts + plan.ts), retrying
// on invalid output. Step 2: execute the plan's phases MECHANICALLY — for each
// phase, substitute earlier phases' outputs into each launch's prompt template
// (text only, no LLM between phases), run the read-only workers, and collect
// their free-text outputs. Branch only on execution STATUS, never by parsing a
// worker's text. The answer is the `answer_item` launch's output. Always returns
// a response (never throws): a planning failure or step error becomes
// `error`/`degraded` so the caller never hangs.

import { Allowlist, VALID_PHASES } from "./allowlist";
import { DebateRequest } from "./mailbox";
import { Plan, substitute } from "./plan";
import { PlanFailed, PlannerFn, planWithRetry } from "./planner";
import { BatchItemResult, PreparedItem, runPreparedItems } from "./runner";
import { RequestRejected, validateRequest } from "./schema";
import { RESULT_SCHEMA_VERSION } from "./version";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DebateDeps {
  planner: PlannerFn;
  // Injectable worker executor (defaults to runPreparedItems) so tests stub workers.
  runItems?: (
    items: PreparedItem[],
    allow: Allowlist,
    baseEnv: Record<string, string | undefined> | undefined,
    maxParallel: number,
  ) => Promise<BatchItemResult[]>;
  // Injectable stdout reader (defaults to reading the audit stdout_path).
  readOutput?: (r: BatchItemResult) => string;
  baseEnv?: Record<string, string | undefined>;
  maxPlanAttempts?: number;
  // Optional progress sink (the daemon points it at responses/<id>.log).
  log?: (line: string) => void;
  // Optional folder for per-launch live CLI debug streams (responses/<id>.streams/).
  streamDir?: string;
}

export interface TraceRow {
  phase: string;
  item: string;
  provider: string;
  status: string;
}

export interface DebateResponse {
  schema_version: number;
  request_id: string;
  kind: "debate_result";
  status: string; // completed | degraded | error
  status_reason: string;
  answer_markdown: string;
  trace: TraceRow[];
  finished_at: string;
}

function validPhase(name: string): string {
  return (VALID_PHASES as readonly string[]).includes(name) ? name : "other";
}

function phaseToMode(name: string, allow: Allowlist): string {
  const map: Record<string, string> = {
    proposal_generation: "debate-proposal",
    critique: "debate-critique",
    debate_execution: "debate-critique",
    cross_review: "debate-cross-review",
  };
  const candidate = map[name];
  if (candidate && allow.modes.includes(candidate)) return candidate;
  return allow.modes[0] ?? "debate-proposal"; // a misconfigured allowlist surfaces as a rejection
}

function defaultReadOutput(r: BatchItemResult): string {
  const p = r.stdout_path;
  if (typeof p === "string") {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* fall through */
    }
  }
  return "";
}

function errorResponse(id: string, message: string): DebateResponse {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: id,
    kind: "debate_result",
    status: "error",
    status_reason: message,
    answer_markdown: "",
    trace: [],
    finished_at: new Date().toISOString(),
  };
}

/** Next provider to try for a rate_limited launch: the first entry in the
 * fallback order that is allowlisted and not yet tried for this launch. Returns
 * null when every available provider has been tried (the launch then degrades). */
function pickFallbackProvider(allow: Allowlist, tried: Set<string>): string | null {
  const order = allow.fallback.order.length ? allow.fallback.order : allow.providers;
  for (const p of order) {
    if (allow.providers.includes(p) && !tried.has(p)) return p;
  }
  return null;
}

export async function runDebate(req: DebateRequest, allow: Allowlist, deps: DebateDeps): Promise<DebateResponse> {
  const runItems = deps.runItems ?? runPreparedItems;
  const readOutput = deps.readOutput ?? defaultReadOutput;
  const log = deps.log;
  log?.(`debate ${req.id}: repo=${req.repo} language=${req.language ?? "-"} fast=${req.fast}`);

  // --- Step 1: plan (with retry) -----------------------------------------
  let plan: Plan;
  try {
    plan = await planWithRetry(req, allow, deps.planner, deps.maxPlanAttempts, log);
  } catch (err) {
    const reason = err instanceof PlanFailed ? err.message : `planning failed: ${String(err)}`;
    log?.(`error: ${reason}`);
    const resp = errorResponse(req.id, reason);
    log?.(`done: error (no plan) — response → ${req.id}.json`);
    return resp;
  }

  // --- Step 2: execute the plan mechanically -----------------------------
  const outputs: Record<string, string> = {}; // launch id -> worker stdout (free text)
  const trace: TraceRow[] = [];
  let allCompleted = true;

  for (let pi = 0; pi < plan.phases.length; pi++) {
    const phase = plan.phases[pi]!;
    log?.(`phase ${pi + 1}/${plan.phases.length} ${phase.name}: ${phase.launches.map((l) => `${l.id} ${l.provider}`).join(", ")}`);

    // The same substituted prompt is reused verbatim if we have to swap engines
    // on a rate limit, so compute it once per launch (mechanical text fill-in;
    // no LLM runs here).
    const substituted = phase.launches.map((launch) => substitute(launch.prompt, outputs));

    // Build a PreparedItem for one launch on a chosen provider. The initial run
    // honors the planner's effort; a fallback passes effort=undefined so the new
    // provider's default applies (e.g. claude "max" is invalid for codex).
    const buildItem = (idx: number, provider: string, effort: string | undefined): PreparedItem => {
      const launch = phase.launches[idx]!;
      try {
        const reqObj = {
          schema_version: 1,
          run_id: `${req.id}-${launch.id}`.slice(0, 128),
          phase: validPhase(phase.name),
          provider,
          mode: phaseToMode(phase.name, allow),
          repo: req.repo,
          prompt: substituted[idx]!,
          capability: "read_only_review", // FORCED read-only; the plan cannot request writes
          effort,
          fast: launch.fast ?? req.fast, // per-launch (codex turbo); fall back to the request flag
        };
        const streamPath = deps.streamDir ? join(deps.streamDir, `${launch.id}.log`) : undefined;
        return { itemId: launch.id, req: validateRequest(reqObj, allow), streamPath };
      } catch (err) {
        if (err instanceof RequestRejected) return { itemId: launch.id, rejected: err.message };
        throw err;
      }
    };

    let results: BatchItemResult[];
    try {
      // Initial run: each launch on its planned provider and effort.
      results = await runItems(
        phase.launches.map((l, i) => buildItem(i, l.provider, l.effort)),
        allow,
        deps.baseEnv,
        allow.maxParallel,
      );

      // Rate-limit fallback: re-run any `rate_limited` launch on the next
      // available provider — same task, swap engine. Bounded by the provider
      // count; we branch only on error_category (execution status), never on a
      // worker's text. A launch with no untried provider left degrades as before.
      if (allow.fallback.enabled) {
        const tried = phase.launches.map((l) => new Set<string>([l.provider]));
        for (let round = 0; round < allow.providers.length; round++) {
          const retry: Array<{ idx: number; provider: string }> = [];
          results.forEach((r, i) => {
            if (r.error_category !== "rate_limited") return;
            const next = pickFallbackProvider(allow, tried[i]!);
            if (next !== null) retry.push({ idx: i, provider: next });
          });
          if (retry.length === 0) break;
          log?.(
            `  rate-limit fallback: ${retry
              .map(({ idx, provider }) => `${phase.launches[idx]!.id} → ${provider}`)
              .join(", ")}`,
          );
          retry.forEach(({ idx, provider }) => tried[idx]!.add(provider));
          const retryResults = await runItems(
            retry.map(({ idx, provider }) => buildItem(idx, provider, undefined)),
            allow,
            deps.baseEnv,
            allow.maxParallel,
          );
          retry.forEach(({ idx }, k) => {
            results[idx] = retryResults[k]!;
          });
        }
      }
    } catch (err) {
      log?.(`error: phase ${phase.name} failed to execute: ${String(err)}`);
      const resp: DebateResponse = {
        ...errorResponse(req.id, `phase ${phase.name} failed: ${String(err)}`),
        status: "degraded",
        answer_markdown: outputs[plan.answerItem] ?? "",
        trace,
      };
      log?.(`done: degraded — response → ${req.id}.json`);
      return resp;
    }

    results.forEach((r, i) => {
      const launch = phase.launches[i]!;
      const provider = (r.provider as string) ?? launch.provider;
      outputs[launch.id] = r.status === "completed" ? readOutput(r) : "";
      if (r.status !== "completed") allCompleted = false;
      const detail = r.status === "completed" ? "" : r.reject_reason ? ` (${r.reject_reason})` : r.error_category ? ` (${r.error_category})` : "";
      log?.(`  ${launch.id} ${provider} ${r.status}${detail}`);
      trace.push({ phase: phase.name, item: launch.id, provider, status: r.status });
    });
  }

  const answer = outputs[plan.answerItem] ?? "";
  const completed = allCompleted && answer.trim() !== "";
  const status = completed ? "completed" : "degraded";
  const statusReason = completed
    ? ""
    : !answer.trim()
      ? `answer worker ${plan.answerItem} produced no output`
      : "one or more workers did not complete (see trace)";
  log?.(`done: ${status} — response → ${req.id}.json`);
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: req.id,
    kind: "debate_result",
    status,
    status_reason: statusReason,
    answer_markdown: answer,
    trace,
    finished_at: new Date().toISOString(),
  };
}
