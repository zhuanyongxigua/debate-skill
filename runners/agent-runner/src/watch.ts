// The mailbox daemon. Watches ~/.debate-router/requests/ for NEW request files
// (existing ones at startup are ignored), claims each atomically, runs the
// debate via the step loop, and writes the result to responses/<id>.json. One
// debate at a time. Every CLI it spawns (brain + workers) runs read-only.

import { Allowlist } from "./allowlist";
import { makeCliBrain } from "./brain";
import { DebateDeps, DebateResponse, runDebate } from "./debate";
import {
  DebateRequest,
  Mailbox,
  claimRequest,
  loadDebateRequest,
  openMailbox,
  requestIds,
  snapshotRequestIds,
  validateDebateRequest,
  writeResponse,
} from "./mailbox";
import { RESULT_SCHEMA_VERSION } from "./version";

export interface WatchOptions {
  brainProvider?: string; // default "claude"
  baseEnv?: Record<string, string | undefined>;
  maxSteps?: number;
  intervalMs?: number;
  // Injectable for tests: build the per-request deps (brain + worker runner).
  makeDeps?: (req: DebateRequest) => DebateDeps;
}

function defaultDeps(req: DebateRequest, opts: WatchOptions): DebateDeps {
  return {
    brain: makeCliBrain(req.repo, { provider: opts.brainProvider ?? "claude", baseEnv: opts.baseEnv }),
    baseEnv: opts.baseEnv,
    maxSteps: opts.maxSteps,
  };
}

function errorResponse(id: string, message: string): DebateResponse {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: id,
    status: "error",
    status_reason: message,
    answer_markdown: "",
    cli_participation: [],
    steps: 0,
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

    let response: DebateResponse;
    try {
      const req = validateDebateRequest(loadDebateRequest(mb.processingDir + `/${id}.json`), allow);
      const deps = opts.makeDeps ? opts.makeDeps(req) : defaultDeps(req, opts);
      response = await runDebate(req, allow, deps);
    } catch (err) {
      response = errorResponse(id, String(err));
    }
    writeResponse(mb, id, response as unknown as Record<string, unknown>);
    processed.push(id);
  }
  return processed;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Run the daemon forever: snapshot existing requests (ignored), then poll. */
export async function watchLoop(allow: Allowlist, opts: WatchOptions = {}): Promise<never> {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  const interval = opts.intervalMs ?? 1000;
  process.stderr.write(
    `agent-runner watch: mailbox ${mb.root} (ignoring ${ignore.size} existing request(s)); polling every ${interval}ms\n`,
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
