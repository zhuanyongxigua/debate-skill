// The mailbox daemon. Watches ~/.debate-router/requests/ for NEW request files
// (existing ones at startup are ignored), claims each atomically, runs the
// debate via the step loop, and writes the result to responses/<id>.json. One
// debate at a time. Every CLI it spawns (brain + workers) runs read-only.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Allowlist } from "./allowlist";
import { makeCliBrain } from "./brain";
import { DebateDeps, DebateResponse, runDebate } from "./debate";
import {
  DebateRequest,
  Mailbox,
  claimRequest,
  clearProcessing,
  loadDebateRequest,
  openMailbox,
  openResponseLog,
  processingIds,
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
  // Path to the debate-router protocol (e.g. references/debate-protocol.md). Its
  // text is injected into the brain prompt so the brain applies the ready-made
  // strategies instead of improvising.
  protocolPath?: string;
  // When set, the allowlist is re-read for EACH request via this thunk (so config
  // edits apply without a restart). It must never throw — fall back to last-good
  // internally (see safeReloadAllowlist). Absent → the fixed `allow` is used.
  reloadAllow?: () => Allowlist;
  // Injectable for tests: build the per-request deps (brain + worker runner).
  makeDeps?: (req: DebateRequest) => DebateDeps;
}

function loadProtocol(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    process.stderr.write(`  warning: could not read protocol ${path}: ${String(err)} (brain runs without it)\n`);
    return undefined;
  }
}

function defaultDeps(req: DebateRequest, opts: WatchOptions): DebateDeps {
  return {
    brain: makeCliBrain(req.repo, {
      provider: opts.brainProvider ?? "claude",
      baseEnv: opts.baseEnv,
      protocol: loadProtocol(opts.protocolPath),
      fast: req.fast, // the whole debate (brain + workers) goes fast when requested
    }),
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

    const { log, close } = openResponseLog(mb, id);
    let response: DebateResponse;
    try {
      // Re-read the allowlist per request (if a reloader is configured) so config
      // edits take effect without a restart; one consistent snapshot per debate.
      const allowNow = opts.reloadAllow ? opts.reloadAllow() : allow;
      const req = validateDebateRequest(loadDebateRequest(mb.processingDir + `/${id}.json`), allowNow);
      // The file name is the id callers poll by; a payload id that disagrees
      // would write the response under a name the caller never watches.
      if (req.id !== id) throw new Error(`request id "${req.id}" does not match file name "${id}"`);
      // The brain is a launched CLI too: re-check it against the current allowlist.
      const brainProvider = opts.brainProvider ?? "claude";
      if (!opts.makeDeps && !allowNow.providers.includes(brainProvider)) {
        throw new Error(`brain provider ${brainProvider} is not in the current allowlist providers (${allowNow.providers.join(", ")})`);
      }
      const deps = opts.makeDeps ? opts.makeDeps(req) : defaultDeps(req, opts);
      deps.log = log;
      response = await runDebate(req, allowNow, deps);
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
  // Fail closed: the real brain is a launched CLI, so its provider must be in the
  // allowlist (skipped when makeDeps injects a stub brain, e.g. tests).
  if (!opts.makeDeps) {
    const brainProvider = opts.brainProvider ?? "claude";
    if (!allow.providers.includes(brainProvider)) {
      throw new Error(`brain provider ${brainProvider} is not in the allowlist providers (${allow.providers.join(", ")})`);
    }
  }
  const mb = openMailbox();
  const recovered = recoverOrphans(mb);
  const ignore = snapshotRequestIds(mb);
  const interval = opts.intervalMs ?? 1000;
  const protocolNote = opts.protocolPath
    ? `protocol ${opts.protocolPath}`
    : "no protocol (brain uses the built-in contract + its own competence; pass --protocol for the ready-made strategies)";
  process.stderr.write(
    `debate-agent watch: mailbox ${mb.root}; brain=${opts.brainProvider ?? "claude"}; ${protocolNote}; recovered ${recovered.length} orphaned request(s); ignoring ${ignore.size} existing request(s); polling every ${interval}ms\n`,
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
