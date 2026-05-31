// The debate step loop. Repeatedly asks the brain (debate-router, read-only) for
// the next action and executes it via read-only worker launches, feeding results
// back, until the brain returns a final answer. The daemon is the only thing
// that spawns; every CLI (brain and workers) runs read-only. The allowlist is
// enforced in code on every launch.

import { readFileSync } from "node:fs";

import { Allowlist, VALID_PHASES } from "./allowlist";
import { BrainFn, DebateState, PhaseResult } from "./brain";
import { DebateRequest } from "./mailbox";
import { BatchItemResult, PreparedItem, runPreparedItems } from "./runner";
import { RequestRejected, validateRequest } from "./schema";
import { RESULT_SCHEMA_VERSION } from "./version";

export interface DebateDeps {
  brain: BrainFn;
  // Injectable executor (defaults to runPreparedItems) so tests can stub workers.
  runItems?: (
    items: PreparedItem[],
    allow: Allowlist,
    baseEnv: Record<string, string | undefined> | undefined,
    maxParallel: number,
  ) => Promise<BatchItemResult[]>;
  baseEnv?: Record<string, string | undefined>;
  maxSteps?: number;
  // Optional progress sink. The daemon points this at responses/<id>.log so other
  // agents can follow a debate live. Receives plain lines (no timestamp).
  log?: (line: string) => void;
}

export interface TraceRow {
  step: number;
  phase: string;
  worker: string;
  provider: string;
  status: string;
}

export interface DebateResponse {
  schema_version: number;
  request_id: string;
  status: string; // completed | degraded | blocked | error
  status_reason: string;
  answer_markdown: string;
  debate_record?: unknown;
  cli_participation: TraceRow[]; // ground-truth process record (every launch)
  steps: number;
  finished_at: string;
}

const DEFAULT_MAX_STEPS = 12;

function phaseToMode(phase: string, allow: Allowlist): string {
  const map: Record<string, string> = {
    proposal_generation: "debate-proposal",
    critique: "debate-critique",
    debate_execution: "debate-critique",
    cross_review: "debate-cross-review",
  };
  const candidate = map[phase] ?? "debate-proposal";
  if (allow.modes.includes(candidate)) return candidate;
  return allow.modes[0] ?? candidate; // surfaces a misconfigured allowlist as a rejection
}

function validPhase(phase: string): string {
  return (VALID_PHASES as readonly string[]).includes(phase) ? phase : "other";
}

function readOutput(result: BatchItemResult): string {
  const p = result.stdout_path;
  if (typeof p === "string") {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* fall through */
    }
  }
  return "";
}

/** Build the faithful Trace (and structured cli_participation) from what the
 * daemon actually ran — ground truth, not the brain's recollection. */
function buildTrace(history: DebateState["history"]): { markdown: string; rows: TraceRow[] } {
  const rows: TraceRow[] = [];
  history.forEach((h, i) => {
    for (const r of h.results) rows.push({ step: i + 1, phase: h.phase, worker: r.id, provider: r.provider, status: r.status });
  });
  if (rows.length === 0) return { markdown: "", rows };
  const md = [
    "## Trace",
    "",
    "| Step | Phase | Worker | Provider | Status |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.step} | ${r.phase} | ${r.worker} | ${r.provider} | ${r.status} |`),
  ].join("\n");
  return { markdown: md, rows };
}

/** Assemble the debate-skill output layout: the brain's human-first sections,
 * then a runner-built Archive + Trace summarizing the actual process. */
function buildResponse(
  req: DebateRequest,
  status: string,
  reason: string,
  answer: string,
  steps: number,
  history: DebateState["history"],
  record?: unknown,
): DebateResponse {
  const { markdown: traceMd, rows } = buildTrace(history);
  const archive = `## Archive\n- Per-step worker audit under \`~/.debate-agent/\` (run ids \`${req.id}-s<step>-<worker>\`).`;
  const parts: string[] = [];
  if (answer.trim()) parts.push(answer.trim());
  parts.push(archive);
  if (traceMd) parts.push(traceMd);
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: req.id,
    status,
    status_reason: reason,
    answer_markdown: parts.join("\n\n"),
    debate_record: record,
    cli_participation: rows,
    steps,
    finished_at: new Date().toISOString(),
  };
}

/**
 * Run one debate to completion. Always returns a DebateResponse (never throws):
 * brain/exec failures and the step cap become `error`/`degraded` so the caller
 * always gets a writable response.
 */
export async function runDebate(req: DebateRequest, allow: Allowlist, deps: DebateDeps): Promise<DebateResponse> {
  const runItems = deps.runItems ?? runPreparedItems;
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const log = deps.log;
  const done = (resp: DebateResponse): DebateResponse => {
    log?.(`done: ${resp.status} in ${resp.steps} step(s) — response → ${req.id}.json`);
    return resp;
  };
  log?.(`debate ${req.id}: repo=${req.repo} language=${req.language ?? "-"} fast=${req.fast}`);
  const state: DebateState = {
    request: {
      id: req.id,
      prompt: req.prompt,
      repo: req.repo,
      output_contract: req.outputContract,
      language: req.language,
      fast: req.fast,
    },
    history: [],
  };

  for (let step = 0; step < maxSteps; step++) {
    let decision;
    try {
      decision = await deps.brain(state);
    } catch (err) {
      return done(buildResponse(req, "error", `brain failed at step ${step}: ${String(err)}`, "", step, state.history));
    }

    if (decision.kind === "final") {
      log?.(`brain → final: ${decision.status}`);
      return done(buildResponse(req, decision.status, decision.status_reason ?? "", decision.answer_markdown, step, state.history, decision.debate_record));
    }

    const phase = validPhase(decision.phase);
    const launches = decision.launches.slice(0, allow.maxBatchItems);
    log?.(`step ${step + 1}: ${phase} — launching ${launches.map((l) => `${l.id} ${l.provider}`).join(", ")}`);
    if (decision.notes) log?.(`  note: ${decision.notes}`);

    // Build + validate each worker launch. Capability is FORCED to read-only in
    // code; the brain cannot request write access.
    const items: PreparedItem[] = launches.map((l) => {
      const itemId = l.id;
      try {
        const reqObj = {
          schema_version: 1,
          run_id: `${req.id}-s${step}-${itemId}`.slice(0, 128),
          phase,
          provider: l.provider,
          mode: phaseToMode(decision.phase, allow),
          repo: req.repo,
          prompt: l.prompt,
          capability: "read_only_review",
          fast: req.fast,
        };
        return { itemId, req: validateRequest(reqObj, allow) };
      } catch (err) {
        if (err instanceof RequestRejected) return { itemId, rejected: err.message };
        throw err;
      }
    });

    let results: BatchItemResult[];
    try {
      results = await runItems(items, allow, deps.baseEnv, allow.maxParallel);
    } catch (err) {
      return done(buildResponse(req, "error", `execution failed at step ${step}: ${String(err)}`, "", step, state.history));
    }

    for (const r of results) {
      const detail =
        r.status === "completed"
          ? typeof r.stdout_path === "string"
            ? ` → ${r.stdout_path}`
            : ""
          : r.reject_reason
            ? ` (${r.reject_reason})`
            : r.error_category
              ? ` (${r.error_category})`
              : "";
      log?.(`  ${r.item_id} ${r.provider ?? "?"} ${r.status}${detail}`);
    }

    const phaseResults: PhaseResult[] = results.map((r, i) => ({
      id: r.item_id,
      provider: (r.provider as string) ?? launches[i]?.provider ?? "unknown",
      status: r.status,
      output: r.status === "completed" ? readOutput(r) : ((r.reject_reason as string) ?? (r.stderr as string) ?? ""),
    }));
    state.history.push({ phase: decision.phase, results: phaseResults });
  }

  return done(buildResponse(req, "degraded", `debate did not finish within ${maxSteps} steps`, "", maxSteps, state.history));
}
