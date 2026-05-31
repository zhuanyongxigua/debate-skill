// Turn a mailbox run_batch_request into a response.
//
// Build a read-only worker request per launch, run them (parallel, capped by the
// allowlist), and embed each worker's stdout in the response so the sandboxed
// skill can read the whole result directly — it never needs access to the
// runner's execution audit under ~/.debate-agent/. Capability is FORCED to
// read-only here in code; the skill cannot ask a worker to write.

import { readFileSync } from "node:fs";

import { Allowlist } from "./allowlist";
import { RunBatchRequest } from "./mailbox";
import { BatchItemResult, PreparedItem, runPreparedItems } from "./runner";
import { RequestRejected, validateRequest } from "./schema";
import { RESULT_SCHEMA_VERSION } from "./version";

export interface RunBatchItemResult {
  item_id: string;
  provider: string;
  status: string; // completed | timed_out | error | rejected
  output: string; // worker stdout, embedded so the skill needs no audit access
  elapsed_seconds?: number;
  error_category?: string | null;
  reject_reason?: string;
  audit_path?: string;
}

export interface RunBatchResponse {
  schema_version: number;
  request_id: string;
  kind: "run_batch_result";
  status: string; // completed | degraded | error
  status_reason: string;
  items: RunBatchItemResult[];
  finished_at: string;
}

export interface BatchDeps {
  // Injectable executor (defaults to runPreparedItems) so tests can stub workers.
  runItems?: (
    items: PreparedItem[],
    allow: Allowlist,
    baseEnv: Record<string, string | undefined> | undefined,
    maxParallel: number,
  ) => Promise<BatchItemResult[]>;
  // Injectable stdout reader (defaults to reading the audit stdout_path).
  readOutput?: (r: BatchItemResult) => string;
  baseEnv?: Record<string, string | undefined>;
  // Optional progress sink. The daemon points this at responses/<id>.log so other
  // agents can follow a phase live. Receives plain lines (no timestamp).
  log?: (line: string) => void;
}

// Map an audit phase to an allowlisted mode. `mode` does not affect launch
// behavior (only provider/capability/fast/profile do); it is an audit/validation
// label, so any allowlisted value is fine and we fall back to the first one.
function phaseToMode(phase: string, allow: Allowlist): string {
  const map: Record<string, string> = {
    proposal_generation: "debate-proposal",
    critique: "debate-critique",
    debate_execution: "debate-critique",
    cross_review: "debate-cross-review",
  };
  const candidate = map[phase];
  if (candidate && allow.modes.includes(candidate)) return candidate;
  return allow.modes[0] ?? "debate-proposal"; // surfaces a misconfigured allowlist as a rejection
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

/**
 * Run one mailbox batch to a response. Never throws: an executor failure becomes
 * a `degraded` response so the caller always gets a writable result.
 */
export async function runMailboxBatch(req: RunBatchRequest, allow: Allowlist, deps: BatchDeps = {}): Promise<RunBatchResponse> {
  const runItems = deps.runItems ?? runPreparedItems;
  const readOutput = deps.readOutput ?? defaultReadOutput;
  const log = deps.log;
  log?.(`run_batch ${req.id}: repo=${req.repo} fast=${req.fast} items=${req.items.length}`);

  // Build + validate each worker launch. Capability is FORCED to read-only in
  // code; the skill cannot request write access.
  const prepared: PreparedItem[] = req.items.map((it) => {
    log?.(`  queue ${it.itemId} ${it.provider} phase=${it.phase}`);
    try {
      const reqObj: Record<string, unknown> = {
        schema_version: 1,
        run_id: `${req.id}-${it.itemId}`.slice(0, 128),
        phase: it.phase,
        provider: it.provider,
        mode: phaseToMode(it.phase, allow),
        repo: req.repo,
        prompt: it.prompt,
        capability: "read_only_review",
        fast: req.fast,
      };
      if (it.timeoutSeconds !== null) reqObj.timeout_seconds = it.timeoutSeconds;
      return { itemId: it.itemId, req: validateRequest(reqObj, allow) };
    } catch (err) {
      if (err instanceof RequestRejected) return { itemId: it.itemId, rejected: err.message };
      throw err;
    }
  });

  const maxParallel = Math.min(req.maxParallel ?? allow.maxParallel, allow.maxParallel);
  let results: BatchItemResult[];
  try {
    results = await runItems(prepared, allow, deps.baseEnv, maxParallel);
  } catch (err) {
    log?.(`error: execution failed: ${String(err)}`);
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      request_id: req.id,
      kind: "run_batch_result",
      status: "degraded",
      status_reason: `execution failed: ${String(err)}`,
      items: [],
      finished_at: new Date().toISOString(),
    };
  }

  const items: RunBatchItemResult[] = results.map((r) => {
    const provider = (r.provider as string) ?? "unknown";
    const status = r.status;
    const detail =
      status === "completed"
        ? typeof r.stdout_path === "string"
          ? ` → ${r.stdout_path}`
          : ""
        : r.reject_reason
          ? ` (${r.reject_reason})`
          : r.error_category
            ? ` (${r.error_category})`
            : "";
    log?.(`  ${r.item_id} ${provider} ${status}${detail}`);
    const out: RunBatchItemResult = {
      item_id: r.item_id,
      provider,
      status,
      output: status === "completed" ? readOutput(r) : "",
    };
    if (typeof r.elapsed_seconds === "number") out.elapsed_seconds = r.elapsed_seconds;
    if (r.error_category !== undefined) out.error_category = r.error_category as string | null;
    if (typeof r.reject_reason === "string") out.reject_reason = r.reject_reason;
    if (typeof r.audit_path === "string") out.audit_path = r.audit_path;
    return out;
  });

  const completed = items.filter((i) => i.status === "completed").length;
  const allCompleted = items.length > 0 && completed === items.length;
  const status = allCompleted ? "completed" : "degraded";
  log?.(`done: ${status} (${completed}/${items.length} completed) — response → ${req.id}.json`);
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: req.id,
    kind: "run_batch_result",
    status,
    status_reason: allCompleted ? "" : "one or more workers did not complete (see items)",
    items,
    finished_at: new Date().toISOString(),
  };
}
