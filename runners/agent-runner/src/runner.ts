// Orchestrate a single request: validate -> build -> exec -> audit -> result.
//
// This module performs the actual privileged step (launching a child CLI), so
// it stays small and delegates policy to schema.ts / allowlist.ts / launch.ts.

import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";

import { Allowlist } from "./allowlist";
import { AuditPaths, writeExecutionAudit } from "./audit";
import { ChildLaunch, buildChildLaunch } from "./launch";
import {
  RequestRejected,
  ValidatedRequest,
  loadBatchDict,
  loadRequestDict,
  validateBatchEnvelope,
  validateRequest,
} from "./schema";
import { RESULT_SCHEMA_VERSION } from "./version";

// Grace period between SIGTERM and SIGKILL for a timed-out process group.
const KILL_GRACE_MS = 10_000;

type ResultEnvelope = Record<string, unknown>;

export interface ExecResult {
  status: "completed" | "timed_out" | "error";
  errorCategory: string | null;
  returncode: number | null;
  elapsedSeconds: number;
  stdout: string;
  stderr: string;
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolve a binary against an explicit PATH (the child's), like `which`. */
function which(bin: string, pathEnv: string): string | null {
  if (bin.includes("/")) {
    return isExecutable(bin) ? bin : null;
  }
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const cand = join(dir, bin);
    if (isExecutable(cand)) return cand;
  }
  return null;
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal); // negative pid => process group
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

function rejectedResult(runId: unknown, message: string): ResultEnvelope {
  // Record the rejection in the audit trail too, under a sanitized run_id.
  // Anything that could escape the audit root is logged under "rejected".
  const safeRunId =
    typeof runId === "string" && /^[A-Za-z0-9]/.test(runId) && !runId.includes("..")
      ? runId
      : "rejected";
  let paths: Partial<AuditPaths> = {};
  try {
    paths = writeExecutionAudit({
      runId: safeRunId,
      record: { status: "rejected", error_category: "rejected", reject_reason: message },
      phase: "other",
      provider: "none",
    });
  } catch {
    /* never fail the reject path on audit problems */
  }
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    run_id: typeof runId === "string" ? runId : "",
    status: "rejected",
    error_category: "rejected",
    reject_reason: message,
    ...paths,
  };
}

/** Run the static child command in its own process group with a timeout. */
export function execute(launch: ChildLaunch, timeoutSeconds: number): Promise<ExecResult> {
  // Resolve the binary against the CHILD env PATH (not the parent's) and exec
  // the absolute path, so the missing-CLI check matches what the child would
  // actually run.
  const resolved = which(launch.argv[0]!, launch.env.PATH ?? "");
  if (resolved === null) {
    return Promise.resolve({
      status: "error",
      errorCategory: "missing_cli",
      returncode: null,
      elapsedSeconds: 0,
      stdout: "",
      stderr: `required CLI not found on child PATH: ${launch.argv[0]}`,
    });
  }

  const start = process.hrtime.bigint();
  const elapsed = () => Number(process.hrtime.bigint() - start) / 1e9;

  return new Promise<ExecResult>((resolvePromise) => {
    const child = spawn(resolved, launch.argv.slice(1), {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // own process group, so we can kill the whole tree
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      if (killTimer) clearTimeout(killTimer);
      if (graceTimer) clearTimeout(graceTimer);
    };

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolvePromise({
        status: "error",
        errorCategory: "exception",
        returncode: null,
        elapsedSeconds: Math.round(elapsed() * 1000) / 1000,
        stdout,
        stderr: stderr || String(err),
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      const e = Math.round(elapsed() * 1000) / 1000;
      if (timedOut) {
        resolvePromise({ status: "timed_out", errorCategory: "timeout", returncode: code, elapsedSeconds: e, stdout, stderr });
      } else if (code !== 0) {
        resolvePromise({ status: "error", errorCategory: "nonzero_exit", returncode: code, elapsedSeconds: e, stdout, stderr });
      } else {
        resolvePromise({ status: "completed", errorCategory: null, returncode: code, elapsedSeconds: e, stdout, stderr });
      }
    });

    // Prompt is transported on stdin for stdin-transport providers; for argv
    // transport (copilot) it is already in argv, so just close stdin.
    if (child.stdin) {
      child.stdin.on("error", () => {
        /* child may exit before draining stdin; ignore EPIPE */
      });
      if (launch.promptTransport === "stdin") child.stdin.write(launch.stdin);
      child.stdin.end();
    }

    killTimer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        killGroup(child.pid, "SIGTERM");
        graceTimer = setTimeout(() => {
          if (child.pid !== undefined) killGroup(child.pid, "SIGKILL");
        }, KILL_GRACE_MS);
      }
    }, timeoutSeconds * 1000);
  });
}

export async function runValidated(
  reqValidated: ValidatedRequest,
  baseEnv?: Record<string, string | undefined>,
): Promise<ResultEnvelope> {
  const env = baseEnv ?? process.env;
  const launch = buildChildLaunch({
    provider: reqValidated.provider,
    cwd: reqValidated.repo,
    profile: reqValidated.profile,
    capability: reqValidated.capability,
    prompt: reqValidated.prompt,
    baseEnv: env,
  });
  const exec = await execute(launch, reqValidated.timeoutSeconds);

  const auditRecord = {
    run_id: reqValidated.runId,
    request_digest: reqValidated.requestDigest,
    provider: reqValidated.provider,
    phase: reqValidated.phase,
    mode: reqValidated.mode,
    capability: reqValidated.capability,
    repo: reqValidated.repo,
    repo_root: reqValidated.repoRoot,
    profile: reqValidated.profile,
    cwd: launch.cwd,
    display_command: launch.displayCommand,
    timeout_seconds: reqValidated.timeoutSeconds,
    status: exec.status,
    error_category: exec.errorCategory,
    returncode: exec.returncode,
    elapsed_seconds: exec.elapsedSeconds,
    stripped_env_keys: launch.strippedEnvKeys,
  };
  const paths = writeExecutionAudit({
    runId: reqValidated.runId,
    record: auditRecord,
    stdout: exec.stdout,
    stderr: exec.stderr,
    phase: reqValidated.phase,
    provider: reqValidated.provider,
  });

  return {
    schema_version: RESULT_SCHEMA_VERSION,
    run_id: reqValidated.runId,
    request_digest: reqValidated.requestDigest,
    provider: reqValidated.provider,
    phase: reqValidated.phase,
    mode: reqValidated.mode,
    capability: reqValidated.capability,
    status: exec.status,
    error_category: exec.errorCategory,
    returncode: exec.returncode,
    elapsed_seconds: exec.elapsedSeconds,
    timeout_seconds: reqValidated.timeoutSeconds,
    display_command: launch.displayCommand,
    stripped_env_keys: launch.strippedEnvKeys,
    ...paths,
  };
}

/**
 * Top-level entry: load + validate + run, returning a result envelope.
 *
 * Any RequestRejected becomes a `rejected` result (no launch). The function
 * does not throw for policy failures; it encodes them in the envelope.
 */
export async function runRequestFile(
  requestPath: string,
  allow: Allowlist,
  baseEnv?: Record<string, string | undefined>,
): Promise<ResultEnvelope> {
  let runId: unknown = "";
  try {
    const raw = loadRequestDict(requestPath);
    runId = raw.run_id ?? "";
    const reqValidated = validateRequest(raw, allow);
    return await runValidated(reqValidated, baseEnv);
  } catch (err) {
    if (err instanceof RequestRejected) {
      return rejectedResult(runId, err.message);
    }
    throw err;
  }
}

// --- run-batch -------------------------------------------------------------
// Parallel execution of N already-decided requests. The runner stays
// semantics-free: it does NOT know this is multi-path, debate, or review. The
// caller (debate-router) decides roles, provider allocation, and how many
// surviving items are "enough". The runner only fans out safely, caps
// concurrency globally and per provider, and reports per-item results in input
// order. One bad item degrades the batch; it never fails the whole batch.

export interface BatchItemResult {
  item_id: string;
  status: string;
  [k: string]: unknown;
}

/** A batch slot: either a validated request to run, or a pre-rejected reason. */
export interface PreparedItem {
  itemId: string;
  req?: ValidatedRequest;
  rejected?: string;
}

interface Job<T> {
  key: string; // provider, for the per-provider cap
  run: () => Promise<T>;
}

/** Run jobs honoring a global cap and a per-key (provider) cap; ordered results. */
function runWithCaps<T>(jobs: Job<T>[], maxParallel: number, perKey: number): Promise<T[]> {
  const cap = Math.max(1, maxParallel);
  const keyCap = Math.max(1, perKey);
  return new Promise<T[]>((resolve) => {
    const results: T[] = new Array(jobs.length);
    const started = new Array<boolean>(jobs.length).fill(false);
    const byKey: Record<string, number> = {};
    let active = 0;
    let done = 0;

    const pump = () => {
      if (done === jobs.length) {
        resolve(results);
        return;
      }
      for (let i = 0; i < jobs.length; i++) {
        if (active >= cap) break;
        if (started[i]) continue;
        const { key, run } = jobs[i]!;
        if ((byKey[key] ?? 0) >= keyCap) continue;
        started[i] = true;
        active++;
        byKey[key] = (byKey[key] ?? 0) + 1;
        run().then((r) => {
          results[i] = r;
          active--;
          byKey[key]!--;
          done++;
          pump();
        });
      }
    };
    pump();
  });
}

/**
 * Run a set of already-prepared batch items (valid requests run; pre-rejected
 * items become `rejected` results consuming no concurrency). Ordered results.
 * Shared by `run-batch` and the debate daemon's per-phase fan-out.
 */
export async function runPreparedItems(
  items: PreparedItem[],
  allow: Allowlist,
  baseEnv: Record<string, string | undefined> | undefined,
  maxParallel: number,
): Promise<BatchItemResult[]> {
  const jobs: Job<BatchItemResult>[] = [];
  const jobIndexBySlot = new Map<number, number>();
  items.forEach((slot, idx) => {
    if (slot.req) {
      jobIndexBySlot.set(idx, jobs.length);
      jobs.push({
        key: slot.req.provider,
        run: async () => ({ item_id: slot.itemId, ...(await runValidated(slot.req!, baseEnv)) }) as BatchItemResult,
      });
    }
  });
  const cap = Math.min(maxParallel, allow.maxParallel);
  const jobResults = await runWithCaps(jobs, cap, allow.maxParallelPerProvider);
  return items.map((slot, idx) =>
    slot.rejected !== undefined
      ? { item_id: slot.itemId, status: "rejected", error_category: "rejected", reject_reason: slot.rejected }
      : jobResults[jobIndexBySlot.get(idx)!]!,
  );
}

/**
 * Top-level batch entry: load + validate envelope + per-item validate + run.
 *
 * Envelope-level problems (bad version, too many items, ...) become a single
 * `rejected` batch result. Per-item validation failures become `rejected` item
 * results that consume no concurrency and never block valid items.
 */
export async function runBatchFile(
  batchPath: string,
  allow: Allowlist,
  baseEnv?: Record<string, string | undefined>,
): Promise<ResultEnvelope> {
  let envelope;
  try {
    const raw = loadBatchDict(batchPath);
    envelope = validateBatchEnvelope(raw, allow);
  } catch (err) {
    if (err instanceof RequestRejected) {
      return {
        schema_version: RESULT_SCHEMA_VERSION,
        kind: "batch",
        status: "rejected",
        error_category: "rejected",
        reject_reason: err.message,
      };
    }
    throw err;
  }

  // Per-item validation up front: valid items become jobs, invalid items become
  // immediate rejected results (no launch, no concurrency consumed).
  const slots: PreparedItem[] = envelope.items.map(({ itemId, request }) => {
    try {
      return { itemId, req: validateRequest(request, allow) };
    } catch (err) {
      if (err instanceof RequestRejected) return { itemId, rejected: err.message };
      throw err;
    }
  });

  const maxParallel = Math.min(envelope.maxParallel ?? allow.maxParallel, allow.maxParallel);
  const items = await runPreparedItems(slots, allow, baseEnv, maxParallel);

  const allCompleted = items.every((it) => it.status === "completed");
  const batchRecord = {
    batch_id: envelope.batchId,
    status: allCompleted ? "completed" : "degraded",
    item_count: items.length,
    items: items.map((it) => `${it.item_id}:${it.status}`),
  };
  let auditPath: Partial<AuditPaths> = {};
  try {
    auditPath = writeExecutionAudit({
      runId: envelope.batchId,
      record: batchRecord,
      phase: "other",
      provider: "batch",
    });
  } catch {
    /* never fail the batch on audit problems */
  }

  return {
    schema_version: RESULT_SCHEMA_VERSION,
    kind: "batch",
    batch_id: envelope.batchId,
    status: allCompleted ? "completed" : "degraded",
    item_count: items.length,
    max_parallel: maxParallel,
    items,
    ...auditPath,
  };
}
