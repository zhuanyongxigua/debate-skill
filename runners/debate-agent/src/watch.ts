// The mailbox daemon. Watches ~/.debate-router/requests/ for NEW request files
// (existing ones at startup are ignored), claims each atomically, runs the batch
// of read-only worker launches, and writes the result to responses/<id>.json.
// One batch at a time. Every CLI it spawns runs read-only.
//
// The daemon owns EXECUTION only. The debate-router skill (in its sandboxed
// parent) plans the whole debate in its own context and drives the daemon one
// batch per phase; there is no brain/step loop here anymore.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { Allowlist } from "./allowlist";
import { BatchDeps, RunBatchResponse, runMailboxBatch } from "./mailbox-batch";
import {
  Mailbox,
  MailboxRequestRejected,
  claimRequest,
  clearProcessing,
  loadRequestObject,
  openMailbox,
  openResponseLog,
  processingIds,
  requestIds,
  snapshotRequestIds,
  validateRunBatchRequest,
  writeResponse,
} from "./mailbox";
import { RESULT_SCHEMA_VERSION } from "./version";

export interface WatchOptions {
  baseEnv?: Record<string, string | undefined>;
  intervalMs?: number;
  // When set, the allowlist is re-read for EACH request via this thunk (so config
  // edits apply without a restart). It must never throw — fall back to last-good
  // internally (see safeReloadAllowlist). Absent → the fixed `allow` is used.
  reloadAllow?: () => Allowlist;
  // Injectable for tests: stub the worker executor / stdout reader so the loop
  // runs end-to-end without spawning real CLIs.
  runItems?: BatchDeps["runItems"];
  readOutput?: BatchDeps["readOutput"];
}

function errorResponse(id: string, message: string): RunBatchResponse {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: id,
    kind: "run_batch_result",
    status: "error",
    status_reason: message,
    items: [],
    finished_at: new Date().toISOString(),
  };
}

/**
 * Process every currently-new request once (claim, run, write response).
 * `ignore` is mutated to mark ids as seen so they are never re-processed (the
 * startup snapshot plus everything handled since). Returns processed ids.
 */
export async function processNewRequests(
  mb: Mailbox,
  ignore: Set<string>,
  allow: Allowlist,
  opts: WatchOptions,
): Promise<string[]> {
  const processed: string[] = [];
  for (const id of requestIds(mb)) {
    if (ignore.has(id)) continue;
    ignore.add(id); // claim-once: never retry, even if this run fails
    if (claimRequest(mb, id) === null) continue; // someone else took it / it vanished

    const { log, close } = openResponseLog(mb, id);
    let response: RunBatchResponse;
    try {
      // Re-read the allowlist per request (if a reloader is configured) so config
      // edits take effect without a restart; one consistent snapshot per batch.
      const allowNow = opts.reloadAllow ? opts.reloadAllow() : allow;
      const req = validateRunBatchRequest(loadRequestObject(join(mb.processingDir, `${id}.json`)), allowNow);
      // The file name is the id callers poll by; a payload id that disagrees
      // would write the response under a name the caller never watches.
      if (req.id !== id) throw new MailboxRequestRejected(`request id "${req.id}" does not match file name "${id}"`);
      response = await runMailboxBatch(req, allowNow, {
        runItems: opts.runItems,
        readOutput: opts.readOutput,
        baseEnv: opts.baseEnv,
        log,
      });
    } catch (err) {
      log(`error: ${String(err)}`);
      response = errorResponse(id, String(err));
    } finally {
      close();
    }
    writeResponse(mb, id, response as unknown as Record<string, unknown>);
    clearProcessing(mb, id); // finished: drop the in-flight marker so processing/ only holds live requests
    processed.push(id);
  }
  return processed;
}

/** Recover requests left in processing/ by a previous crash/restart: if no
 * response exists, write an error response so the caller stops waiting; then
 * clear the stale processing entry either way. Returns the recovered ids. */
export function recoverOrphans(mb: Mailbox): string[] {
  const recovered: string[] = [];
  for (const id of processingIds(mb)) {
    if (!existsSync(join(mb.responsesDir, `${id}.json`))) {
      const { log, close } = openResponseLog(mb, id);
      log("daemon restarted while this request was in flight — abandoned");
      close();
      writeResponse(
        mb,
        id,
        errorResponse(id, "daemon restarted while this request was in flight; resubmit if still needed") as unknown as Record<string, unknown>,
      );
      recovered.push(id);
    }
    clearProcessing(mb, id);
  }
  return recovered;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run the daemon forever: snapshot existing requests (ignored), then poll. */
export async function watchLoop(allow: Allowlist, opts: WatchOptions = {}): Promise<never> {
  const mb = openMailbox();
  const recovered = recoverOrphans(mb);
  const ignore = snapshotRequestIds(mb);
  const interval = opts.intervalMs ?? 1000;
  process.stderr.write(
    `debate-agent watch: mailbox ${mb.root}; executor for run_batch_request (read-only workers); ` +
      `recovered ${recovered.length} orphaned request(s); ignoring ${ignore.size} existing request(s); polling every ${interval}ms\n`,
  );
  for (;;) {
    try {
      const done = await processNewRequests(mb, ignore, allow, opts);
      for (const id of done) process.stderr.write(`  processed ${id}\n`);
    } catch (err) {
      process.stderr.write(`  watch error: ${String(err)}\n`);
    }
    await sleep(interval);
  }
}
