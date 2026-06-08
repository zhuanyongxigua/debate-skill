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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Allowlist, VALID_PHASES, resolveProvider } from "./allowlist";
import { isFallbackEligible } from "./fallback";
import { DebateRequest } from "./mailbox";
import { Plan, substitute, validatePlan } from "./plan";
import { PlanFailed, PlannerFn, planWithRetry } from "./planner";
import { BatchItemResult, PreparedItem, runPreparedItems } from "./runner";
import { RequestRejected, validateRequest } from "./schema";
import { RESULT_SCHEMA_VERSION } from "./version";

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
  // Persisted canonical state for plan + worker outputs. The daemon binds this to
  // responses/<id>.intermediates.json so later phases read exactly what was
  // already written to disk; tests may omit it and get an in-memory store.
  intermediateStore?: IntermediateStore;
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
  // Present when this launch was loaded from persisted intermediates instead of
  // being executed in the current daemon process.
  resumed?: boolean;
}

export interface IntermediateOutput {
  phase: string;
  item: string;
  provider: string;
  status: string;
  output_markdown: string;
  planned_provider?: string;
  error_category?: string;
  stdout_path?: string;
  stderr_path?: string;
  audit_path?: string;
  stream_path?: string;
}

export interface PersistedDebateState {
  schema_version: number;
  request_id: string;
  request_digest: string;
  kind: "debate_intermediates";
  plan: Plan | null;
  outputs: IntermediateOutput[];
  updated_at: string;
  finished_at?: string;
}

export interface IntermediateStore {
  path?: string;
  load(): PersistedDebateState | null;
  save(state: PersistedDebateState): void;
}

export interface DebateResponse {
  schema_version: number;
  request_id: string;
  kind: "debate_result";
  status: string; // completed | degraded | error
  status_reason: string;
  answer_markdown: string;
  trace: TraceRow[];
  intermediate_outputs: IntermediateOutput[];
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
    intermediate_outputs: [],
    finished_at: new Date().toISOString(),
  };
}

function emptyState(req: DebateRequest): PersistedDebateState {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: req.id,
    request_digest: req.requestDigest,
    kind: "debate_intermediates",
    plan: null,
    outputs: [],
    updated_at: new Date().toISOString(),
  };
}

function memoryIntermediateStore(req: DebateRequest): IntermediateStore {
  let state: PersistedDebateState | null = emptyState(req);
  return {
    load: () => state,
    save: (next) => {
      state = next;
    },
  };
}

class PersistedStateInvalid extends Error {}

const OUTPUT_STATUSES = new Set(["completed", "timed_out", "error", "rejected"]);
const ERROR_CATEGORIES = new Set(["rejected", "timeout", "missing_cli", "nonzero_exit", "rate_limited", "exception"]);

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PersistedStateInvalid(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(obj: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new PersistedStateInvalid(`${label}.${key} must be a string`);
  return value;
}

function requiredString(obj: Record<string, unknown>, key: string, label: string): string {
  const value = obj[key];
  if (typeof value !== "string") throw new PersistedStateInvalid(`${label}.${key} must be a string`);
  return value;
}

function validatePersistedPlan(raw: unknown, allow: Allowlist): Plan | null {
  if (raw === null || raw === undefined) return null;
  const obj = asObject(raw, "plan");
  const unknown = Object.keys(obj).filter((k) => !["complexity", "phases", "answerItem"].includes(k));
  if (unknown.length > 0) throw new PersistedStateInvalid(`plan has unknown field(s): ${JSON.stringify(unknown.sort())}`);
  if (typeof obj.answerItem !== "string") throw new PersistedStateInvalid("plan.answerItem must be a string");
  try {
    return validatePlan({ complexity: obj.complexity, phases: obj.phases, answer_item: obj.answerItem }, allow);
  } catch (err) {
    throw new PersistedStateInvalid(`plan is invalid: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateOutput(raw: unknown, allow: Allowlist, index: number): IntermediateOutput {
  const label = `outputs[${index}]`;
  const obj = asObject(raw, label);
  const unknown = Object.keys(obj).filter(
    (k) =>
      ![
        "phase",
        "item",
        "provider",
        "status",
        "output_markdown",
        "planned_provider",
        "error_category",
        "stdout_path",
        "stderr_path",
        "audit_path",
        "stream_path",
      ].includes(k),
  );
  if (unknown.length > 0) throw new PersistedStateInvalid(`${label} has unknown field(s): ${JSON.stringify(unknown.sort())}`);

  const phase = requiredString(obj, "phase", label);
  const item = requiredString(obj, "item", label);
  const provider = requiredString(obj, "provider", label);
  const status = requiredString(obj, "status", label);
  const outputMarkdown = requiredString(obj, "output_markdown", label);
  if (!allow.providers.includes(provider)) {
    throw new PersistedStateInvalid(`${label}.provider ${JSON.stringify(provider)} is not in request providers`);
  }
  if (!OUTPUT_STATUSES.has(status)) {
    throw new PersistedStateInvalid(`${label}.status ${JSON.stringify(status)} is not supported`);
  }

  const plannedProvider = optionalString(obj, "planned_provider", label);
  if (plannedProvider !== undefined && !allow.providers.includes(plannedProvider)) {
    throw new PersistedStateInvalid(`${label}.planned_provider ${JSON.stringify(plannedProvider)} is not in request providers`);
  }
  const errorCategory = optionalString(obj, "error_category", label);
  if (errorCategory !== undefined && !ERROR_CATEGORIES.has(errorCategory)) {
    throw new PersistedStateInvalid(`${label}.error_category ${JSON.stringify(errorCategory)} is not supported`);
  }
  const stdoutPath = optionalString(obj, "stdout_path", label);
  const stderrPath = optionalString(obj, "stderr_path", label);
  const auditPath = optionalString(obj, "audit_path", label);
  const streamPath = optionalString(obj, "stream_path", label);

  return {
    phase,
    item,
    provider,
    status,
    output_markdown: outputMarkdown,
    ...(plannedProvider !== undefined ? { planned_provider: plannedProvider } : {}),
    ...(errorCategory !== undefined ? { error_category: errorCategory } : {}),
    ...(stdoutPath !== undefined ? { stdout_path: stdoutPath } : {}),
    ...(stderrPath !== undefined ? { stderr_path: stderrPath } : {}),
    ...(auditPath !== undefined ? { audit_path: auditPath } : {}),
    ...(streamPath !== undefined ? { stream_path: streamPath } : {}),
  };
}

function validateOutputsAgainstPlan(outputs: IntermediateOutput[], plan: Plan | null): void {
  if (plan === null) {
    if (outputs.length > 0) throw new PersistedStateInvalid("outputs require a persisted plan");
    return;
  }
  const launches = new Map<string, { phase: string; provider: string }>();
  for (const phase of plan.phases) {
    for (const launch of phase.launches) launches.set(launch.id, { phase: phase.name, provider: launch.provider });
  }

  const seen = new Set<string>();
  for (const output of outputs) {
    if (seen.has(output.item)) throw new PersistedStateInvalid(`duplicate output item ${JSON.stringify(output.item)}`);
    seen.add(output.item);
    const launch = launches.get(output.item);
    if (launch === undefined) throw new PersistedStateInvalid(`output item ${JSON.stringify(output.item)} is not in the persisted plan`);
    if (output.phase !== launch.phase) {
      throw new PersistedStateInvalid(`output ${output.item} phase ${JSON.stringify(output.phase)} does not match plan phase ${JSON.stringify(launch.phase)}`);
    }
    if (output.provider !== launch.provider) {
      if (output.planned_provider !== launch.provider) {
        throw new PersistedStateInvalid(`output ${output.item} provider swap is missing planned_provider ${JSON.stringify(launch.provider)}`);
      }
    } else if (output.planned_provider !== undefined && output.planned_provider !== launch.provider) {
      throw new PersistedStateInvalid(`output ${output.item} planned_provider does not match the plan`);
    }
  }
}

function validatePersistedDebateState(raw: unknown, req: DebateRequest, allow: Allowlist): PersistedDebateState {
  const obj = asObject(raw, "persisted intermediates");
  const unknown = Object.keys(obj).filter((k) => !["schema_version", "request_id", "request_digest", "kind", "plan", "outputs", "updated_at", "finished_at"].includes(k));
  if (unknown.length > 0) throw new PersistedStateInvalid(`persisted intermediates has unknown field(s): ${JSON.stringify(unknown.sort())}`);
  if (obj.schema_version !== RESULT_SCHEMA_VERSION) {
    throw new PersistedStateInvalid(`schema_version ${JSON.stringify(obj.schema_version)} is not supported`);
  }
  if (obj.kind !== "debate_intermediates") throw new PersistedStateInvalid('kind must be "debate_intermediates"');
  if (obj.request_id !== req.id) throw new PersistedStateInvalid(`request_id ${JSON.stringify(obj.request_id)} does not match ${JSON.stringify(req.id)}`);
  if (obj.request_digest !== req.requestDigest) throw new PersistedStateInvalid("request_digest does not match current request");
  if (typeof obj.updated_at !== "string") throw new PersistedStateInvalid("updated_at must be a string");
  if (obj.finished_at !== undefined && typeof obj.finished_at !== "string") throw new PersistedStateInvalid("finished_at must be a string");
  if (!Array.isArray(obj.outputs)) throw new PersistedStateInvalid("outputs must be an array");
  const plan = validatePersistedPlan(obj.plan, allow);
  const outputs = obj.outputs.map((output, index) => validateOutput(output, allow, index));
  validateOutputsAgainstPlan(outputs, plan);
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: req.id,
    request_digest: req.requestDigest,
    kind: "debate_intermediates",
    plan,
    outputs,
    updated_at: obj.updated_at,
    ...(typeof obj.finished_at === "string" ? { finished_at: obj.finished_at } : {}),
  };
}

function loadState(req: DebateRequest, store: IntermediateStore, allow: Allowlist, log?: (line: string) => void): PersistedDebateState {
  const loaded = store.load();
  if (loaded !== null) {
    try {
      return validatePersistedDebateState(loaded, req, allow);
    } catch (err) {
      log?.(`ignored persisted intermediates: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return emptyState(req);
}

function saveState(store: IntermediateStore, state: PersistedDebateState, finishedAt?: string): PersistedDebateState {
  const next: PersistedDebateState = {
    ...state,
    updated_at: new Date().toISOString(),
    ...(finishedAt ? { finished_at: finishedAt } : {}),
  };
  store.save(next);
  return next;
}

function outputMapFrom(state: PersistedDebateState): Record<string, string> {
  const outputs: Record<string, string> = {};
  for (const output of state.outputs) {
    if (output.status === "completed") outputs[output.item] = output.output_markdown;
  }
  return outputs;
}

function outputByItem(state: PersistedDebateState): Map<string, IntermediateOutput> {
  return new Map(state.outputs.map((output) => [output.item, output]));
}

function upsertOutput(state: PersistedDebateState, output: IntermediateOutput): PersistedDebateState {
  const outputs = state.outputs.filter((existing) => existing.item !== output.item);
  outputs.push(output);
  return { ...state, outputs };
}

function traceRowFromIntermediate(output: IntermediateOutput & { resumed?: boolean }): TraceRow {
  const row: TraceRow = { phase: output.phase, item: output.item, provider: output.provider, status: output.status };
  if (output.planned_provider) row.planned_provider = output.planned_provider;
  if (output.error_category) row.error_category = output.error_category;
  if (output.resumed) row.resumed = true;
  return row;
}

function matchesLaunch(output: IntermediateOutput, launch: { id: string; provider: string }, phaseName: string): boolean {
  if (output.item !== launch.id || output.phase !== phaseName) return false;
  if (output.provider === launch.provider) return output.planned_provider === undefined || output.planned_provider === launch.provider;
  return output.planned_provider === launch.provider;
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
function capabilityRank(provider: string, allow: Allowlist): number {
  return resolveProvider(allow, provider).base === "codex" ? 2 : 1;
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
  // Assign the fixed fast-path roles from the request's effective provider
  // order. If fewer than three providers were selected, reuse the first one;
  // if more were selected, the fast shape intentionally consumes only the first
  // three roles (P1, P2, A1).
  const firstProvider = allow.providers[0] ?? "codex";
  const r1 = allow.providers[0] ?? firstProvider;
  const r2 = allow.providers[1] ?? firstProvider;
  const arb = allow.providers[2] ?? firstProvider;
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
          { id: "P1", provider: r1, prompt: reviewer },
          { id: "P2", provider: r2, prompt: reviewer },
        ],
      },
      { name: "arbitration", launches: [{ id: "A1", provider: arb, prompt: arbiter }] },
    ],
    answerItem: "A1",
  };
}

export async function runDebate(req: DebateRequest, allow: Allowlist, deps: DebateDeps): Promise<DebateResponse> {
  allow = narrowAllowlistForRequest(allow, req);
  const runItems = deps.runItems ?? runPreparedItems;
  const readOutput = deps.readOutput ?? defaultReadOutput;
  const log = deps.log;
  const store = deps.intermediateStore ?? memoryIntermediateStore(req);
  log?.(`debate ${req.id}: repo=${req.repo} language=${req.language ?? "-"} fast=${req.fast}`);

  // --- Step 1: plan ------------------------------------------------------
  // Fast path skips the planner entirely (saves a full xhigh planning call) and
  // runs a fixed lean 2-phase shape; the non-fast path plans with the CLI planner.
  let state = loadState(req, store, allow, log);
  let plan: Plan;
  if (state.plan) {
    plan = state.plan;
    log?.(`resume: loaded persisted plan from intermediates (${plan.phases.length} phase(s), answer=${plan.answerItem})`);
  } else {
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
    state = saveState(store, { ...state, plan });
  }

  // --- Step 2: execute the plan mechanically -----------------------------
  const trace: TraceRow[] = [];

  for (let pi = 0; pi < plan.phases.length; pi++) {
    const phase = plan.phases[pi]!;
    log?.(`phase ${pi + 1}/${plan.phases.length} ${phase.name}: ${phase.launches.map((l) => `${l.id} ${l.provider}`).join(", ")}`);

    state = loadState(req, store, allow, log);
    const existingByItem = outputByItem(state);
    const outputs = outputMapFrom(state);
    // The same substituted prompt is reused verbatim if we have to swap engines
    // after a CLI failure, so compute it once per launch (mechanical text
    // fill-in; no LLM runs here). Inputs come from the persisted sidecar state so
    // downstream prompts consume exactly what has already been written to disk.
    const substituted = phase.launches.map((launch) => substitute(launch.prompt, outputs));

    // Build a PreparedItem for one launch on a chosen provider. The initial run
    // honors an explicit planner effort; if absent, the child CLI's profile/config
    // applies. A fallback drops effort so provider-specific values do not leak
    // across engines (e.g. claude "max" is invalid for codex).
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

    const pending = phase.launches.flatMap((launch, idx) => {
      const existing = existingByItem.get(launch.id);
      if (existing?.status === "completed" && matchesLaunch(existing, launch, phase.name)) {
        log?.(`  ${launch.id} ${existing.provider} completed (resumed from intermediates)`);
        trace.push(traceRowFromIntermediate({ ...existing, resumed: true }));
        return [];
      }
      return [{ idx, item: buildItem(idx, launch.provider, launch.effort) }];
    });

    if (pending.length === 0) continue;

    let results: BatchItemResult[];
    try {
      // Initial run: each launch on its planned provider and effort.
      results = await runItems(
        pending.map((p) => p.item),
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
        const tried = pending.map((p) => new Set<string>([phase.launches[p.idx]!.provider]));
        for (let round = 0; round < allow.providers.length; round++) {
          const retry: Array<{ idx: number; provider: string }> = [];
          results.forEach((r, pendingIdx) => {
            if (!isFallbackEligible(r.status as string, r.error_category as string | null | undefined)) return;
            const next = pickFallbackProvider(allow, tried[pendingIdx]!);
            if (next !== null) retry.push({ idx: pendingIdx, provider: next });
          });
          if (retry.length === 0) break;
          log?.(
            `  provider fallback: ${retry
              .map(({ idx, provider }) => `${phase.launches[pending[idx]!.idx]!.id} ${phase.launches[pending[idx]!.idx]!.provider} → ${provider}`)
              .join(", ")}`,
          );
          // Flag a capability downgrade (e.g. codex → claude): a task the planner
          // gave to codex because it may need shell could underperform on claude.
          for (const { idx, provider } of retry) {
            const planned = phase.launches[pending[idx]!.idx]!.provider;
            if (capabilityRank(provider, allow) < capabilityRank(planned, allow)) {
              log?.(
                `  warning: ${phase.launches[pending[idx]!.idx]!.id} ${planned} → ${provider} is a capability downgrade ` +
                  `(${provider} cannot run arbitrary read-only shell); a task needing shell may underperform`,
              );
            }
          }
          retry.forEach(({ idx, provider }) => tried[idx]!.add(provider));
          const retryResults = await runItems(
            retry.map(({ idx, provider }) => buildItem(pending[idx]!.idx, provider, undefined)),
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
      state = loadState(req, store, allow, log);
      const resp: DebateResponse = {
        ...errorResponse(req.id, `phase ${phase.name} failed: ${String(err)}`),
        status: "degraded",
        answer_markdown: outputMapFrom(state)[plan.answerItem] ?? "",
        trace,
        intermediate_outputs: state.outputs,
      };
      log?.(`done: degraded — response → ${req.id}.json`);
      return resp;
    }

    state = loadState(req, store, allow, log);
    results.forEach((r, pendingIdx) => {
      const launch = phase.launches[pending[pendingIdx]!.idx]!;
      const plannedProvider = launch.provider;
      const provider = (r.provider as string) ?? plannedProvider;
      const output = r.status === "completed" ? readOutput(r) : "";
      const errorCategory = typeof r.error_category === "string" ? (r.error_category as string) : undefined;
      const detail = r.status === "completed" ? "" : r.reject_reason ? ` (${r.reject_reason})` : errorCategory ? ` (${errorCategory})` : "";
      log?.(`  ${launch.id} ${provider} ${r.status}${detail}`);
      const row: TraceRow = { phase: phase.name, item: launch.id, provider, status: r.status };
      // Surface a provider swap and a degrade reason in the response itself,
      // not only in the live log.
      if (provider !== plannedProvider) row.planned_provider = plannedProvider;
      if (r.status !== "completed" && errorCategory) row.error_category = errorCategory;
      trace.push(row);

      const intermediate: IntermediateOutput = {
        phase: phase.name,
        item: launch.id,
        provider,
        status: r.status,
        output_markdown: output,
      };
      if (provider !== plannedProvider) intermediate.planned_provider = plannedProvider;
      if (errorCategory) intermediate.error_category = errorCategory;
      if (typeof r.stdout_path === "string") intermediate.stdout_path = r.stdout_path;
      if (typeof r.stderr_path === "string") intermediate.stderr_path = r.stderr_path;
      if (typeof r.audit_path === "string") intermediate.audit_path = r.audit_path;
      if (deps.streamDir) intermediate.stream_path = join(deps.streamDir, `${launch.id}.log`);
      state = upsertOutput(state, intermediate);
    });
    state = saveState(store, state);
  }

  state = loadState(req, store, allow, log);
  const finalOutputsByItem = outputByItem(state);
  const outputs = outputMapFrom(state);
  const answer = outputs[plan.answerItem] ?? "";
  const allCompleted = plan.phases.every((phase) =>
    phase.launches.every((launch) => finalOutputsByItem.get(launch.id)?.status === "completed"),
  );
  const completed = allCompleted && answer.trim() !== "";
  const status = completed ? "completed" : "degraded";
  const statusReason = completed
    ? ""
    : !answer.trim()
      ? `answer worker ${plan.answerItem} produced no output`
      : "one or more workers did not complete (see trace)";
  log?.(`done: ${status} — response → ${req.id}.json`);
  const finishedAt = new Date().toISOString();
  state = saveState(store, state, finishedAt);
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: req.id,
    kind: "debate_result",
    status,
    status_reason: statusReason,
    answer_markdown: answer,
    trace,
    intermediate_outputs: state.outputs,
    finished_at: finishedAt,
  };
}
