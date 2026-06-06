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

import { Allowlist, DEFAULT_EFFORT, VALID_PHASES } from "./allowlist";
import { isFallbackEligible } from "./fallback";
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
  provider: string; // the engine that actually ran (may differ from planned_provider after a swap)
  status: string;
  // The provider the plan assigned. Present (and != provider) when a provider
  // fallback moved this launch to another engine, so a swap is visible in the
  // response — not only in the live log.
  planned_provider?: string;
  // The final launch's error_category when it did not complete (e.g. "rate_limited"
  // when every engine was exhausted), so a degrade reason is visible too.
  error_category?: string;
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

export function narrowAllowlistForRequest(allow: Allowlist, req: DebateRequest): Allowlist {
  const providerSet = new Set(req.providers);
  const fallbackOrder = allow.fallback.order.length ? allow.fallback.order : allow.providers;
  return {
    ...allow,
    providers: req.providers.filter((p) => allow.providers.includes(p)),
    fallback: {
      ...allow.fallback,
      order: fallbackOrder.filter((p) => providerSet.has(p) && allow.providers.includes(p)),
    },
  };
}

/** Next provider to try for a failed launch: the first entry in the fallback
 * order that is allowlisted and not yet tried for this launch. Returns null
 * when every available provider has been tried (the launch then degrades). */
function pickFallbackProvider(allow: Allowlist, tried: Set<string>): string | null {
  const order = allow.fallback.order.length ? allow.fallback.order : allow.providers;
  for (const p of order) {
    if (allow.providers.includes(p) && !tried.has(p)) return p;
  }
  return null;
}

// Read-only capability rank, for a downgrade warning when provider fallback moves
// a task to a weaker engine. codex's OS sandbox can run ANY read-only command
// (shell/build/tests); claude/copilot are limited to read tools + read-only git.
// We cannot know whether a given task actually needs shell (the plan carries no
// such hint yet), so a codex→claude swap is allowed but flagged — the operator can
// see it in both the log and the trace's planned_provider.
function capabilityRank(provider: string): number {
  return provider === "codex" ? 2 : 1;
}

function defaultEffort(provider: string): string {
  return DEFAULT_EFFORT[provider] ?? DEFAULT_EFFORT.claude!;
}

/** The hardcoded FAST debate shape used when a request is `fast`: skip the planner
 * entirely and run a fixed lean 2-phase debate — two independent reviewers in
 * parallel, then one arbiter. This MIRRORS the debate-router FAST workflow by hand
 * (same "kept in sync by hand" pattern as launch.ts mirroring cli-launch). It uses
 * GENERIC worker prompts (no planner-crafted, task-specific instructions), so it is
 * faster/cheaper but shallower than the planner path; a non-fast (fast=false)
 * request still goes through the full planner. See AGENTS.md invariant #3. */
function buildFastPlan(req: DebateRequest, allow: Allowlist): Plan {
  const lang = req.language ? `\n\nRespond in ${req.language}.` : "";
  // Escape any `{{...}}` in the user's task so the mechanical substitute() — which
  // fills the daemon's own {{P1.output}}/{{P2.output}} below — cannot accidentally
  // mangle a literal placeholder the user happened to write in their prompt.
  const task = req.prompt.replace(/\{\{/g, "{ {");
  // Pick real allowlisted providers — prefer the canonical codex+claude reviewers
  // and a claude arbiter, but fall back to whatever IS allowlisted so a narrowed
  // allowlist degrades to a working provider instead of a rejected/empty reviewer.
  const pick = (...prefs: string[]) => prefs.find((p) => allow.providers.includes(p)) ?? allow.providers[0] ?? "claude";
  const r1 = pick("codex", "claude");
  const r2 = pick("claude", "codex");
  const arb = pick("claude", "codex");
  const reviewer =
    `${task}\n\nIndependently complete the task above. If it concerns this repository, read the ` +
    `affected code AND its callers/dependents to judge impact — do not restrict yourself to only a diff, ` +
    `and do not "explore the whole repo". Be concrete and cite specifics.${lang}`;
  const arbiter =
    `Two independent analyses of the same task are below.\n\n--- Analysis A ---\n{{P1.output}}\n\n` +
    `--- Analysis B ---\n{{P2.output}}\n\nThe task was:\n${task}\n\nDecide and write the FINAL ` +
    `answer, reconciling the two and noting any important disagreement.${lang}`;
  return {
    complexity: "simple",
    phases: [
      {
        name: "proposal_generation",
        launches: [
          { id: "P1", provider: r1, effort: defaultEffort(r1), prompt: reviewer },
          { id: "P2", provider: r2, effort: defaultEffort(r2), prompt: reviewer },
        ],
      },
      { name: "arbitration", launches: [{ id: "A1", provider: arb, effort: defaultEffort(arb), prompt: arbiter }] },
    ],
    answerItem: "A1",
  };
}

export async function runDebate(req: DebateRequest, allow: Allowlist, deps: DebateDeps): Promise<DebateResponse> {
  allow = narrowAllowlistForRequest(allow, req);
  const runItems = deps.runItems ?? runPreparedItems;
  const readOutput = deps.readOutput ?? defaultReadOutput;
  const log = deps.log;
  log?.(`debate ${req.id}: repo=${req.repo} language=${req.language ?? "-"} fast=${req.fast}`);

  // --- Step 1: plan ------------------------------------------------------
  // Fast path skips the planner entirely (saves a full xhigh planning call) and
  // runs a fixed lean 2-phase shape; the non-fast path plans with the CLI planner.
  let plan: Plan;
  if (req.fast) {
    plan = buildFastPlan(req, allow);
    const shape = plan.phases.flatMap((p) => p.launches.map((l) => `${l.id} ${l.provider}`)).join(", ");
    log?.(`fast mode: planner skipped — fixed lean 2-phase shape (${shape})`);
  } else {
    try {
      plan = await planWithRetry(req, allow, deps.planner, deps.maxPlanAttempts, log);
    } catch (err) {
      const reason = err instanceof PlanFailed ? err.message : `planning failed: ${String(err)}`;
      log?.(`error: ${reason}`);
      const resp = errorResponse(req.id, reason);
      log?.(`done: error (no plan) — response → ${req.id}.json`);
      return resp;
    }
  }

  // --- Step 2: execute the plan mechanically -----------------------------
  const outputs: Record<string, string> = {}; // launch id -> worker stdout (free text)
  const trace: TraceRow[] = [];
  let allCompleted = true;

  for (let pi = 0; pi < plan.phases.length; pi++) {
    const phase = plan.phases[pi]!;
    log?.(`phase ${pi + 1}/${plan.phases.length} ${phase.name}: ${phase.launches.map((l) => `${l.id} ${l.provider}`).join(", ")}`);

    // The same substituted prompt is reused verbatim if we have to swap engines
    // after a CLI failure, so compute it once per launch (mechanical text
    // fill-in; no LLM runs here).
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

      // Provider fallback: re-run any CLI launch/completion failure on the next
      // available provider — same task, swap engine. Bounded by the provider count; we
      // branch only on execution status/category, never on a worker's text. A
      // rejected launch is a policy/validation failure, so it is not swapped. A
      // launch with no untried provider left degrades as before.
      if (allow.fallback.enabled) {
        const tried = phase.launches.map((l) => new Set<string>([l.provider]));
        for (let round = 0; round < allow.providers.length; round++) {
          const retry: Array<{ idx: number; provider: string }> = [];
          results.forEach((r, i) => {
            if (!isFallbackEligible(r.status as string, r.error_category as string | null | undefined)) return;
            const next = pickFallbackProvider(allow, tried[i]!);
            if (next !== null) retry.push({ idx: i, provider: next });
          });
          if (retry.length === 0) break;
          log?.(
            `  provider fallback: ${retry
              .map(({ idx, provider }) => `${phase.launches[idx]!.id} ${phase.launches[idx]!.provider} → ${provider}`)
              .join(", ")}`,
          );
          // Flag a capability downgrade (e.g. codex → claude): a task the planner
          // gave to codex because it may need shell could underperform on claude.
          for (const { idx, provider } of retry) {
            const planned = phase.launches[idx]!.provider;
            if (capabilityRank(provider) < capabilityRank(planned)) {
              log?.(
                `  warning: ${phase.launches[idx]!.id} ${planned} → ${provider} is a capability downgrade ` +
                  `(${provider} cannot run arbitrary read-only shell); a task needing shell may underperform`,
              );
            }
          }
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
      const plannedProvider = launch.provider;
      const provider = (r.provider as string) ?? plannedProvider;
      outputs[launch.id] = r.status === "completed" ? readOutput(r) : "";
      if (r.status !== "completed") allCompleted = false;
      const errorCategory = typeof r.error_category === "string" ? (r.error_category as string) : undefined;
      const detail = r.status === "completed" ? "" : r.reject_reason ? ` (${r.reject_reason})` : errorCategory ? ` (${errorCategory})` : "";
      log?.(`  ${launch.id} ${provider} ${r.status}${detail}`);
      const row: TraceRow = { phase: phase.name, item: launch.id, provider, status: r.status };
      // Surface a provider swap and a degrade reason in the response itself,
      // not only in the live log.
      if (provider !== plannedProvider) row.planned_provider = plannedProvider;
      if (r.status !== "completed" && errorCategory) row.error_category = errorCategory;
      trace.push(row);
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
