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
}

export interface DebateResponse {
  schema_version: number;
  request_id: string;
  status: string; // completed | degraded | blocked | error
  status_reason: string;
  answer_markdown: string;
  debate_record?: unknown;
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

function finalResponse(req: DebateRequest, status: string, reason: string, answer: string, steps: number, record?: unknown): DebateResponse {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: req.id,
    status,
    status_reason: reason,
    answer_markdown: answer,
    debate_record: record,
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
  const state: DebateState = {
    request: { id: req.id, prompt: req.prompt, repo: req.repo, output_contract: req.outputContract },
    history: [],
  };

  for (let step = 0; step < maxSteps; step++) {
    let decision;
    try {
      decision = await deps.brain(state);
    } catch (err) {
      return finalResponse(req, "error", `brain failed at step ${step}: ${String(err)}`, "", step);
    }

    if (decision.kind === "final") {
      return finalResponse(req, decision.status, decision.status_reason ?? "", decision.answer_markdown, step, decision.debate_record);
    }

    const phase = validPhase(decision.phase);
    const launches = decision.launches.slice(0, allow.maxBatchItems);

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
      return finalResponse(req, "error", `execution failed at step ${step}: ${String(err)}`, "", step);
    }

    const phaseResults: PhaseResult[] = results.map((r, i) => ({
      id: r.item_id,
      provider: (r.provider as string) ?? launches[i]?.provider ?? "unknown",
      status: r.status,
      output: r.status === "completed" ? readOutput(r) : ((r.reject_reason as string) ?? (r.stderr as string) ?? ""),
    }));
    state.history.push({ phase: decision.phase, results: phaseResults });
  }

  return finalResponse(req, "degraded", `debate did not finish within ${maxSteps} steps`, "", maxSteps);
}
