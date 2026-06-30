// Generic claim/run/respond loop for file-backed mailbox handlers. Request
// semantics live in handlers; this module only owns durable queue mechanics.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { Allowlist } from "./allowlist";
import { MailboxHandler } from "./handler";
import {
  Mailbox,
  archiveProcessing,
  cancelRequestIds,
  claimRequest,
  consumeCancel,
  loadRequestObject,
  openResponseLog,
  processingIds,
  requestIds,
  requestStreamDir,
  writeResponse,
} from "./mailbox";
import { runWithCaps } from "./runner";
import { RESULT_SCHEMA_VERSION } from "./version";

export interface MailboxServiceOptions {
  reloadAllow?: () => Allowlist;
}

/**
 * Per-mailbox registry of in-flight request id → AbortController.
 * Registered synchronously before handler.run() is awaited; deregistered in a
 * finally. The poll loop calls abort(id) to cancel one specific request without
 * affecting any other concurrent request.
 *
 * WHY a separate registry object rather than a Map in the closure: it lets
 * tests pass in an observable registry to assert "abort was called for id X only".
 */
export class CancellationRegistry {
  private readonly _map = new Map<string, AbortController>();

  /** Register a new AbortController for the given id. */
  register(id: string): AbortController {
    const ctrl = new AbortController();
    this._map.set(id, ctrl);
    return ctrl;
  }

  /** Remove the registry entry for id (call in a finally after handler.run). */
  deregister(id: string): void {
    this._map.delete(id);
  }

  /** Abort the controller for id, if it is currently registered. Returns true
   * if an active entry was found and aborted, false if the id was not in flight. */
  abort(id: string): boolean {
    const ctrl = this._map.get(id);
    if (!ctrl) return false;
    ctrl.abort();
    return true;
  }

  /** Whether id is currently registered (i.e. in-flight). */
  has(id: string): boolean {
    return this._map.has(id);
  }
}

async function processClaimedWithHandler<RequestT, ResponseT>(
  mb: Mailbox,
  id: string,
  allow: Allowlist,
  opts: MailboxServiceOptions,
  handler: MailboxHandler<RequestT, ResponseT>,
  resume: boolean,
  registry?: CancellationRegistry,
): Promise<void> {
  const { log, close } = openResponseLog(mb, id);
  let response: ResponseT;
  let requestDigest = handler.invalidRequestDigest;
  // Register this id with the cancellation registry BEFORE awaiting handler.run,
  // so an abort signal written to cancel/<id>.json during the same tick can be
  // acted on immediately. Deregistered in finally so the slot is freed whether
  // the handler completes, errors, or is cancelled.
  const ctrl = registry?.register(id);
  try {
    if (resume) log("daemon restarted while this request was in flight — attempting resume from persisted state");
    const allowNow = opts.reloadAllow ? opts.reloadAllow() : allow;
    const req = handler.validate(loadRequestObject(join(mb.processingDir, `${id}.json`)), id, allowNow);
    requestDigest = handler.requestDigest(req);
    const streamDir = requestStreamDir(mb, id);
    response = await handler.run(req, { mailbox: mb, id, allow: allowNow, resume, streamDir, log, signal: ctrl?.signal });
  } catch (err) {
    log(`error: ${String(err)}`);
    response = handler.errorResponse(id, String(err));
  } finally {
    registry?.deregister(id);
    close();
  }
  // Artifact write-out lives outside the try above, so a throw here must NOT reject
  // this promise: runWithCaps (the concurrent pool) has no per-job .catch, so a
  // rejected job would never increment `done` and would stall the whole pool. Keep
  // it best-effort and swallow — the request is already done; an archive/artifact
  // hiccup must not wedge sibling requests.
  try {
    handler.writeArtifacts(mb, id, response, requestDigest);
  } catch (err) {
    process.stderr.write(`  writeArtifacts failed for ${id}: ${String(err)}\n`);
  }
  try {
    archiveProcessing(mb, id);
  } catch (err) {
    process.stderr.write(`  archiveProcessing failed for ${id}: ${String(err)}\n`);
  }
}

/**
 * Abort ONLY the cancel markers whose id is a currently in-flight request.
 *
 * This is the time-critical half of cancellation: it must run on its OWN cadence
 * (a timer), independent of the main poll loop, because the main loop blocks
 * inside `await processNewMailboxRequests` for the entire duration of a running
 * task — so a cancel marker that arrives while a long task is executing would
 * otherwise not be seen until that task finishes (defeating the whole point).
 *
 * Deliberately does the bare minimum and touches NO shared mutable claim state:
 * it only reads the registry, calls abort() (idempotent), and consumes the marker
 * (best-effort file delete). It does NOT claim requests, write responses, or
 * mutate `ignore` — that "intercept an unclaimed request" work stays in
 * applyCancellations on the main loop, so the two never race on a claim. Running
 * this concurrently with applyCancellations is safe: abort() and consumeCancel()
 * are both idempotent, and registry.has/abort are synchronous in single-threaded JS.
 */
export function abortInFlightCancellations(
  mb: Mailbox,
  registry: CancellationRegistry,
  log?: (msg: string) => void,
): void {
  for (const id of cancelRequestIds(mb)) {
    if (registry.has(id)) {
      if (registry.abort(id)) log?.(`cancelling in-flight request ${id}`);
      consumeCancel(mb, id);
    }
    // Markers that are NOT in-flight (unclaimed / already-finished) are left for
    // applyCancellations on the main loop to handle and consume.
  }
}

/**
 * Scan the cancel/ dir and act on any pending cancel markers.
 *
 * For each marker id:
 *   - If the id is active in the registry: abort it and consume the marker.
 *   - If a response already exists (finished race): consume the marker, no-op.
 *   - If the id is still unclaimed in requests/ (not yet picked up): claim it
 *     immediately and write a cancelled response so it NEVER runs. This is the
 *     preferred behaviour — a cancelled id must not produce a real run.
 *   - Otherwise (unknown / already archived): consume the marker, no-op.
 *
 * Runs synchronously (no await) except for the unclaimed-request short-circuit,
 * which writes a response file. Two mailboxes' cancel dirs are independent.
 *
 * NOTE: the in-flight-abort branch here is ALSO covered by the independent timer
 * (abortInFlightCancellations) so an in-flight task is cancelled promptly even
 * while this main loop is blocked. Keeping the branch here too is harmless
 * (abort/consume are idempotent) and preserves correctness if the timer is off.
 */
export function applyCancellations<RequestT, ResponseT>(
  mb: Mailbox,
  registry: CancellationRegistry,
  ignore: Set<string>,
  handler: MailboxHandler<RequestT, ResponseT>,
  log?: (msg: string) => void,
): void {
  for (const id of cancelRequestIds(mb)) {
    if (registry.has(id)) {
      // Active: abort the running handler. The handler will finish naturally
      // (write a cancelled response, archive processing/), so we do NOT forcibly
      // remove processing/<id> here.
      const aborted = registry.abort(id);
      if (aborted) log?.(`cancelling in-flight request ${id}`);
      consumeCancel(mb, id);
      continue;
    }
    // Not active. Check whether it already has a response (finished before cancel
    // arrived) or is still waiting to be claimed.
    const responseFile = join(mb.responsesDir, `${id}.json`);
    if (existsSync(responseFile)) {
      // Already finished — cancel is a harmless no-op.
      consumeCancel(mb, id);
      continue;
    }
    // Check if it is still unclaimed in requests/ and not yet in our ignore set.
    const requestFile = join(mb.requestsDir, `${id}.json`);
    if (existsSync(requestFile) && !ignore.has(id)) {
      // Claim it immediately and write a cancelled response so it never runs.
      ignore.add(id);
      const claimed = claimRequest(mb, id);
      if (claimed !== null) {
        log?.(`cancelling unclaimed request ${id} — writing cancelled response`);
        try {
          writeResponse(mb, id, {
            schema_version: RESULT_SCHEMA_VERSION,
            request_id: id,
            kind: "cancelled_before_run",
            status: "cancelled",
            status_reason: "request was cancelled before it was processed",
            finished_at: new Date().toISOString(),
          });
        } catch {
          /* best-effort */
        }
        archiveProcessing(mb, id);
      }
    }
    // Consume the marker regardless — don't let stale markers accumulate.
    consumeCancel(mb, id);
  }
}

/**
 * Process every currently-new request once (claim, run, write response).
 * `ignore` is mutated to mark ids as seen so they are never re-processed.
 *
 * Concurrency is bounded by handler.resourceBudget.maxConcurrent (wired from the
 * allowlist's maxConcurrentRequests, default 3; set to 1 for strictly serial).
 * The claim pass is synchronous (no await between has-check, ignore.add, and
 * claimRequest) so single-threaded JS makes it race-free; then claimed ids are
 * processed concurrently up to the cap.
 *
 * The optional `registry` enables per-id cancellation: when provided, each
 * claimed request is registered before handler.run so the poll-loop's
 * applyCancellations can abort a specific in-flight id.
 */
export async function processNewMailboxRequests<RequestT, ResponseT>(
  mb: Mailbox,
  ignore: Set<string>,
  allow: Allowlist,
  opts: MailboxServiceOptions,
  handler: MailboxHandler<RequestT, ResponseT>,
  registry?: CancellationRegistry,
): Promise<string[]> {
  // --- Phase 1: synchronous claim pass (no await inside) ---
  // Single-threaded JS guarantees ignore.add + claimRequest are atomic w.r.t.
  // other microtasks, so two concurrent poll ticks never double-claim the same id.
  const claimed: string[] = [];
  for (const id of requestIds(mb)) {
    if (ignore.has(id)) continue;
    ignore.add(id);
    if (claimRequest(mb, id) === null) continue;
    claimed.push(id);
  }

  if (claimed.length === 0) return [];

  // --- Phase 2: bounded-concurrent processing ---
  // processClaimedWithHandler never rejects (it catches internally and writes an
  // error response), so a simple runWithCaps pool is safe here. We use a constant
  // key ("request") so all requests share one global slot pool = maxConcurrent.
  // maxConcurrent comes from the allowlist (default 3); 1 means strictly serial.
  const maxConcurrent = handler.resourceBudget.maxConcurrent;
  const jobs = claimed.map((id) => ({
    key: "request",
    run: async () => {
      await processClaimedWithHandler(mb, id, allow, opts, handler, false, registry);
      return id;
    },
  }));
  const results = await runWithCaps(jobs, maxConcurrent, maxConcurrent);
  return results;
}

/** Recover requests left in processing/ by a previous crash/restart. */
export async function recoverMailboxOrphans<RequestT, ResponseT>(
  mb: Mailbox,
  allow: Allowlist,
  opts: MailboxServiceOptions,
  handler: MailboxHandler<RequestT, ResponseT>,
  registry?: CancellationRegistry,
): Promise<string[]> {
  const recovered: string[] = [];
  for (const id of processingIds(mb)) {
    if (!existsSync(join(mb.responsesDir, `${id}.json`))) {
      await processClaimedWithHandler(mb, id, allow, opts, handler, true, registry);
      recovered.push(id);
    }
    archiveProcessing(mb, id);
  }
  return recovered;
}
