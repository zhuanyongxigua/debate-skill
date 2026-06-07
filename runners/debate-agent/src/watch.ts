// The mailbox daemon. Watches ~/.debate-router/requests/ for NEW request files
// (existing ones at startup are ignored), claims each atomically, runs the whole
// debate — plan (one-shot planner CLI, with retry) then mechanical execution —
// and writes responses/<id>.json. One debate at a time. Every CLI it spawns (the
// planner and every worker) runs read-only.
//
// The sandboxed debate-router skill only writes the high-level `debate_request`
// and presents the result; all execution (planner + workers) is here, out of
// sandbox, so it bypasses the parent's top-level command reviewer.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Allowlist, PLANNER_PROVIDERS } from "./allowlist";
import { DebateDeps, DebateResponse, IntermediateStore, PersistedDebateState, narrowAllowlistForRequest, runDebate } from "./debate";
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
  responseIntermediatesPath,
  requestIds,
  requestStreamDir,
  snapshotRequestIds,
  validateDebateRequest,
  writeIntermediates,
  writeResponse,
} from "./mailbox";
import { makeCliPlanner } from "./planner";
import { RESULT_SCHEMA_VERSION } from "./version";

export interface WatchOptions {
  plannerProvider?: string; // legacy/CLI option; requests choose planner_provider or providers[0]
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

// Only PLANNER_PROVIDERS support the native JSON-Schema structured output the
// planner relies on (claude --json-schema, codex --output-schema). copilot has no
// equivalent, so the planner must never rotate onto it — that would silently drop
// the schema constraint. Workers are unaffected (they can use any provider).
const PLANNER_PROVIDER_SET = new Set<string>(PLANNER_PROVIDERS);

function validatePlannerProvider(provider: string, allow: Allowlist): void {
  if (!allow.providers.includes(provider)) {
    throw new Error(`planner provider ${provider} is not in the allowlist providers (${allow.providers.join(", ")})`);
  }
  if (!PLANNER_PROVIDER_SET.has(provider)) {
    throw new Error(`planner provider ${provider} cannot produce a structured plan (supported: ${[...PLANNER_PROVIDERS].join(", ")})`);
  }
}

function defaultDeps(req: DebateRequest, opts: WatchOptions, streamDir: string, allow: Allowlist): DebateDeps {
  const primary = req.plannerProvider ?? req.providers[0]! ?? "codex";
  // Planner provider order: primary first, then the fallback order intersected
  // with the allowlist — so a failed planner can swap engines just like a worker
  // does. Disabling fallback leaves only the primary.
  const providers = [primary];
  if (allow.fallback.enabled) {
    const order = allow.fallback.order.length ? allow.fallback.order : allow.providers;
    for (const p of order) {
      if (p !== primary && allow.providers.includes(p) && PLANNER_PROVIDER_SET.has(p) && !providers.includes(p)) {
        providers.push(p);
      }
    }
  }
  return {
    planner: makeCliPlanner(req.repo, {
      providers,
      baseEnv: opts.baseEnv,
      streamDir,
      rateLimitPatterns: allow.rateLimitPatterns,
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
    intermediate_outputs: [],
    finished_at: new Date().toISOString(),
  };
}

function fileIntermediateStore(mb: Mailbox, id: string): IntermediateStore {
  const path = responseIntermediatesPath(mb, id);
  return {
    path,
    load: () => {
      if (!existsSync(path)) return null;
      try {
        return JSON.parse(readFileSync(path, "utf8")) as PersistedDebateState;
      } catch {
        return null;
      }
    },
    save: (state) => {
      writeIntermediates(mb, id, state as unknown as Record<string, unknown>);
    },
  };
}

function writeDebateArtifacts(mb: Mailbox, id: string, response: DebateResponse, requestDigest: string): void {
  const { intermediate_outputs: intermediateOutputs, ...responseBody } = response;
  const intermediatesPath = responseIntermediatesPath(mb, id);
  if (response.status === "error" || !existsSync(intermediatesPath)) {
    writeIntermediates(mb, id, {
      schema_version: RESULT_SCHEMA_VERSION,
      request_id: id,
      request_digest: requestDigest,
      kind: "debate_intermediates",
      plan: null,
      outputs: intermediateOutputs,
      updated_at: response.finished_at,
      finished_at: response.finished_at,
    });
  }
  writeResponse(mb, id, { ...responseBody, intermediates_path: intermediatesPath });
}

async function processClaimedRequest(
  mb: Mailbox,
  id: string,
  allow: Allowlist,
  opts: WatchOptions,
  resume: boolean,
): Promise<void> {
  const { log, close } = openResponseLog(mb, id);
  let response: DebateResponse;
  let requestDigest = "invalid-request";
  try {
    if (resume) log("daemon restarted while this request was in flight — attempting resume from intermediates");
    // Re-read the allowlist per request (if a reloader is configured) so config
    // edits take effect without a restart; one consistent snapshot per debate.
    const allowNow = opts.reloadAllow ? opts.reloadAllow() : allow;
    const req = validateDebateRequest(loadRequestObject(join(mb.processingDir, `${id}.json`)), allowNow);
    const allowForReq = narrowAllowlistForRequest(allowNow, req);
    // The file name is the id callers poll by; a payload id that disagrees
    // would write the response under a name the caller never watches.
    if (req.id !== id) throw new MailboxRequestRejected(`request id "${req.id}" does not match file name "${id}"`);
    requestDigest = req.requestDigest;
    // The planner is a launched CLI too: re-check the request-selected provider
    // against the current allowlist. Fast requests skip the planner entirely.
    const plannerProvider = req.plannerProvider ?? req.providers[0]! ?? "codex";
    if (!opts.makeDeps && !req.fast) {
      validatePlannerProvider(plannerProvider, allowForReq);
    }
    const streamDir = requestStreamDir(mb, id);
    const deps = opts.makeDeps ? opts.makeDeps(req) : defaultDeps(req, opts, streamDir, allowForReq);
    deps.log = log;
    deps.streamDir = streamDir;
    deps.intermediateStore = fileIntermediateStore(mb, id);
    response = await runDebate(req, allowForReq, deps);
  } catch (err) {
    log(`error: ${String(err)}`);
    response = errorResponse(id, String(err));
  } finally {
    close();
  }
  writeDebateArtifacts(mb, id, response, requestDigest);
  archiveProcessing(mb, id); // finished: move the request into archive/ (durable record); processing/ holds only live requests
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

    await processClaimedRequest(mb, id, allow, opts, false);
    processed.push(id);
  }
  return processed;
}

/** Recover requests left in processing/ by a previous crash/restart. If no final
 * response exists, resume the request through the normal plan→execute path, using
 * persisted intermediates to skip completed work. Returns the recovered ids. */
export async function recoverOrphans(mb: Mailbox, allow: Allowlist, opts: WatchOptions): Promise<string[]> {
  const recovered: string[] = [];
  for (const id of processingIds(mb)) {
    if (!existsSync(join(mb.responsesDir, `${id}.json`))) {
      await processClaimedRequest(mb, id, allow, opts, true);
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
  // allowlist AND be able to produce a structured plan (claude/codex only;
  // skipped when makeDeps injects a scripted planner, e.g. tests).
  if (!opts.makeDeps) {
    if (opts.plannerProvider !== undefined) validatePlannerProvider(opts.plannerProvider, allow);
  }
  const mb = openMailbox();
  const recovered = await recoverOrphans(mb, allow, opts);
  const ignore = snapshotRequestIds(mb);
  const interval = opts.intervalMs ?? 1000;
  process.stderr.write(
    `debate-agent watch: mailbox ${mb.root}; providers default=codex; planner defaults to request providers[0]` +
      `${opts.plannerProvider ? ` (legacy --planner=${opts.plannerProvider}; request fields decide each planner)` : ""}; ` +
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
