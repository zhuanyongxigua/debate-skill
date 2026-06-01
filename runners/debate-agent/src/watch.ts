// The mailbox daemon. Watches ~/.debate-router/requests/ for NEW request files
// (existing ones at startup are ignored), claims each atomically, runs the whole
// debate — plan (one-shot planner CLI, with retry) then mechanical execution —
// and writes responses/<id>.json. One debate at a time. Every CLI it spawns (the
// planner and every worker) runs read-only.
//
// The sandboxed debate-router skill only writes the high-level `debate_request`
// and presents the result; all execution (planner + workers) is here, out of
// sandbox, so it bypasses the parent's top-level command reviewer.

import { existsSync } from "node:fs";
import { join } from "node:path";

import { Allowlist } from "./allowlist";
import { DebateDeps, DebateResponse, runDebate } from "./debate";
import {
  DebateRequest,
  Mailbox,
  MailboxRequestRejected,
  archiveProcessing,
  claimRequest,
  loadRequestObject,
  openMailbox,
  openResponseLog,
  processingIds,
  requestIds,
  requestStreamDir,
  snapshotRequestIds,
  validateDebateRequest,
  writeResponse,
} from "./mailbox";
import { makeCliPlanner } from "./planner";
import { RESULT_SCHEMA_VERSION } from "./version";

export interface WatchOptions {
  plannerProvider?: string; // CLI that produces the plan (default "claude")
  baseEnv?: Record<string, string | undefined>;
  intervalMs?: number;
  maxPlanAttempts?: number;
  // When set, the allowlist is re-read for EACH request via this thunk (so config
  // edits apply without a restart). It must never throw — fall back to last-good
  // internally (see safeReloadAllowlist). Absent → the fixed `allow` is used.
  reloadAllow?: () => Allowlist;
  // Injectable for tests: build per-request deps (scripted planner + stub workers).
  makeDeps?: (req: DebateRequest) => DebateDeps;
}

function defaultDeps(req: DebateRequest, opts: WatchOptions, streamDir: string): DebateDeps {
  return {
    planner: makeCliPlanner(req.repo, {
      provider: opts.plannerProvider ?? "claude",
      baseEnv: opts.baseEnv,
      streamDir,
    }),
    baseEnv: opts.baseEnv,
    maxPlanAttempts: opts.maxPlanAttempts,
    streamDir,
  };
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
    let response: DebateResponse;
    try {
      // Re-read the allowlist per request (if a reloader is configured) so config
      // edits take effect without a restart; one consistent snapshot per debate.
      const allowNow = opts.reloadAllow ? opts.reloadAllow() : allow;
      const req = validateDebateRequest(loadRequestObject(join(mb.processingDir, `${id}.json`)), allowNow);
      // The file name is the id callers poll by; a payload id that disagrees
      // would write the response under a name the caller never watches.
      if (req.id !== id) throw new MailboxRequestRejected(`request id "${req.id}" does not match file name "${id}"`);
      // The planner is a launched CLI too: re-check it against the current allowlist.
      const plannerProvider = opts.plannerProvider ?? "claude";
      if (!opts.makeDeps && !allowNow.providers.includes(plannerProvider)) {
        throw new Error(`planner provider ${plannerProvider} is not in the current allowlist providers (${allowNow.providers.join(", ")})`);
      }
      const streamDir = requestStreamDir(mb, id);
      const deps = opts.makeDeps ? opts.makeDeps(req) : defaultDeps(req, opts, streamDir);
      deps.log = log;
      deps.streamDir = streamDir;
      response = await runDebate(req, allowNow, deps);
    } catch (err) {
      log(`error: ${String(err)}`);
      response = errorResponse(id, String(err));
    } finally {
      close();
    }
    writeResponse(mb, id, response as unknown as Record<string, unknown>);
    archiveProcessing(mb, id); // finished: move the request into archive/ (durable record); processing/ holds only live requests
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
    archiveProcessing(mb, id); // keep the request in archive/ either way
  }
  return recovered;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run the daemon forever: snapshot existing requests (ignored), then poll. */
export async function watchLoop(allow: Allowlist, opts: WatchOptions = {}): Promise<never> {
  // Fail closed: the planner is a launched CLI, so its provider must be in the
  // allowlist (skipped when makeDeps injects a scripted planner, e.g. tests).
  if (!opts.makeDeps) {
    const plannerProvider = opts.plannerProvider ?? "claude";
    if (!allow.providers.includes(plannerProvider)) {
      throw new Error(`planner provider ${plannerProvider} is not in the allowlist providers (${allow.providers.join(", ")})`);
    }
  }
  const mb = openMailbox();
  const recovered = recoverOrphans(mb);
  const ignore = snapshotRequestIds(mb);
  const interval = opts.intervalMs ?? 1000;
  process.stderr.write(
    `debate-agent watch: mailbox ${mb.root}; planner=${opts.plannerProvider ?? "claude"}; ` +
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
