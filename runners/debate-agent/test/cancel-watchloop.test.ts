// Regression test: cancel via watchLoop setInterval timer (Method A — real daemon subprocess).
//
// BUG BEING LOCKED DOWN:
//   Before the fix, watchLoop's main poll loop blocked inside
//   `await processNewMailboxRequests` for the full duration of a running task.
//   The cancel/<id>.json marker was only scanned at the TOP of each tick
//   (via applyCancellations), so writing a cancel file while a long task was
//   executing had no effect until the task finished naturally — by which time
//   "cancel" was already too late to matter.
//
// FIX:
//   A setInterval(abortInFlightCancellations, interval) was added inside
//   watchLoop. This timer runs independently of the main poll loop and fires
//   during the awaits inside any running task (Node.js event-loop yields),
//   calling registry.abort(id) for every cancel marker it finds. That triggers
//   the SIGTERM -> grace -> SIGKILL teardown in execute() on the real worker.
//
// REGRESSION PROPERTY:
//   If the setInterval(abortInFlightCancellations, ...) call is removed from
//   src/watch.ts (reverting to the buggy state), this test MUST FAIL because
//   the cancel file written while the worker is executing will never be seen
//   during that execution, and the worker (sleep 60) will not be killed within
//   the assertion window.
//
// METHOD A (real daemon subprocess) was chosen over Method B (in-process) because:
//   - It covers the real cross-process watchLoop path end-to-end.
//   - watchLoop is Promise<never> and has no stop interface; starting it in-process
//     would require adding test-only plumbing or leaking a live timer.
//   - Spawning a child "node bin/debate-agent watch" exercises the full production
//     code path including the setInterval timer, giving the highest confidence.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";

import { cleanup, makeStub } from "./helpers";

// ---------------------------------------------------------------------------
// Poll helper
// ---------------------------------------------------------------------------
async function pollUntil(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`pollUntil timed out after ${timeoutMs}ms: ${what}`);
    }
    await new Promise<void>((r) => setTimeout(r, 50));
  }
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------
let root: string;
let daemonProc: ReturnType<typeof spawn> | null = null;

beforeEach(() => {
  root = (() => {
    const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
    return mkdtempSync(join(tmpdir(), "cancel-watchloop-"));
  })();
  daemonProc = null;
  process.env.DEBATE_AGENT_AUDIT_HOME = join(root, "audit");
});

afterEach(async () => {
  // Kill daemon first (it keeps worker alive via job-control if we don't).
  if (daemonProc !== null) {
    try { daemonProc.kill("SIGKILL"); } catch { /* already gone */ }
    // Give it a moment to release the pidfile lock (best-effort).
    await new Promise<void>((r) => setTimeout(r, 100));
  }

  // Kill any lingering worker stub by reading the pidfile we asked the stub to write.
  const workerPidFile = join(root, "worker.pid");
  if (existsSync(workerPidFile)) {
    const pidStr = readFileSync(workerPidFile, "utf8").trim();
    const pid = parseInt(pidStr, 10);
    if (!isNaN(pid) && pid > 0) {
      for (const sig of ["SIGTERM", "SIGKILL"] as NodeJS.Signals[]) {
        try { process.kill(pid, sig); } catch { /* already gone */ }
      }
    }
  }

  delete process.env.DEBATE_AGENT_AUDIT_HOME;
  cleanup(root);
});

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------
test(
  "cancel via watchLoop timer: worker killed, response status=cancelled (regression for missing setInterval)",
  { timeout: 40_000 },
  async () => {
    // --- 1. Filesystem layout ---
    const delegateMb = join(root, "delegate-mb");
    const binDir = join(root, "bin");
    const repoDir = join(root, "repo");
    const workerPidFile = join(root, "worker.pid");

    for (const d of [
      join(delegateMb, "requests"),
      join(delegateMb, "cancel"),
      join(delegateMb, "responses"),
      join(delegateMb, "processing"),
      join(delegateMb, "archive"),
      binDir,
      repoDir,
    ]) {
      mkdirSync(d, { recursive: true });
    }

    // macOS /tmp is a symlink to /private/tmp; realpath resolves it so the
    // allowlist repo_roots check passes.
    const repoReal = realpathSync(repoDir);

    // --- 2. Stub codex: writes its own PID then sleeps 60 s ---
    // This keeps the delegate request "in flight" long enough for us to cancel it.
    makeStub(
      binDir,
      "codex",
      [
        "#!/usr/bin/env bash",
        `echo $$ > ${JSON.stringify(workerPidFile)}`,
        "sleep 60",
      ].join("\n") + "\n",
    );
    // Also provide a stub claude (daemon validates the allowlist; avoid missing-CLI errors).
    makeStub(
      binDir,
      "claude",
      "#!/usr/bin/env bash\necho $$ > " + JSON.stringify(workerPidFile) + "\nsleep 60\n",
    );

    // --- 3. Allowlist config ---
    // Matches the verified-working fields from the task brief.
    // repo_roots must be realpath (macOS /tmp -> /private/tmp).
    const configPath = join(root, "allowlist.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        repo_roots: [repoReal],
        providers: ["codex", "claude"],
        profiles: { claude: [], codex: [] },
        capabilities: ["read_only_review"],
        delegate: {
          enabled: true,
          modes: ["once"],
          max_minutes: 5,
          max_workspace_write_minutes: 5,
        },
        limits: {
          max_concurrent_requests: 2,
          max_prompt_chars: 200000,
        },
      }),
    );

    // --- 4. Start the daemon ---
    // Point DEBATE_AGENT_DELEGATE_MAILBOX at our tmp delegate-mb dir.
    const daemonEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      DEBATE_AGENT_DELEGATE_MAILBOX: delegateMb,
      // Use a fresh debate mailbox too (we won't use it but the daemon opens it).
      DEBATE_AGENT_MAILBOX: join(root, "debate-mb"),
      HOME: root,
    };

    // __dirname at runtime is dist/test/; we need the package root (two levels up).
    const runnerDir = join(__dirname, "..", "..");
    const binEntry = join(runnerDir, "bin", "debate-agent");

    daemonProc = spawn(
      process.execPath,
      [binEntry, "--config", configPath, "watch"],
      { env: daemonEnv, stdio: ["ignore", "ignore", "pipe"] },
    );

    // Collect daemon stderr so we can assert the "cancelling in-flight" message.
    const daemonStderr: string[] = [];
    daemonProc.stderr!.on("data", (chunk: Buffer) => {
      daemonStderr.push(chunk.toString());
    });

    // Wait for the daemon to print its startup line (snapshot + poll ready).
    // We wait up to 8 s for the daemon to be up before submitting the request.
    await pollUntil(
      () => daemonStderr.join("").includes("debate-agent watch:"),
      8_000,
      "daemon startup message in stderr",
    );

    // Extra small sleep: after printing the startup line the daemon snapshots the
    // existing requests directory and then enters the poll loop. The snapshot
    // happens before the first tick, so a request written AFTER the startup message
    // is visible to the NEXT tick (not the snapshot). 200 ms is enough headroom.
    await new Promise<void>((r) => setTimeout(r, 200));

    // --- 5. Submit a delegate request (atomic rename so the daemon sees it whole) ---
    const reqId = "cancel-wl-test";
    const requestPayload = {
      schema_version: 1,
      id: reqId,
      kind: "delegate_request",
      provider: "codex",
      repo: repoReal,
      mode: "once",
      task: "do something slow",
      max_minutes: 5,
    };
    const reqFile = join(delegateMb, "requests", `${reqId}.json`);
    const reqTmp = `${reqFile}.tmp`;
    writeFileSync(reqTmp, JSON.stringify(requestPayload));
    renameSync(reqTmp, reqFile);

    // --- 6. Wait until the worker stub has actually started (it writes its PID) ---
    await pollUntil(
      () => existsSync(workerPidFile),
      15_000,
      "worker pid file to appear (stub codex started)",
    );

    // Read the worker PID now that we know the stub has started.
    const workerPidStr = readFileSync(workerPidFile, "utf8").trim();
    const workerPid = parseInt(workerPidStr, 10);
    assert.ok(!isNaN(workerPid) && workerPid > 0, `worker PID must be a positive integer, got: "${workerPidStr}"`);

    // Confirm the worker is alive before we cancel.
    assert.doesNotThrow(
      () => process.kill(workerPid, 0),
      "worker process should be alive before cancel",
    );

    // --- 7. Write the cancel marker (this is the ONLY cancel trigger; no manual abort) ---
    //
    // REGRESSION NOTE: if setInterval(abortInFlightCancellations, ...) is absent from
    // src/watch.ts, this file will be seen only at the TOP of the NEXT tick — which
    // requires the current task (sleep 60) to finish first. The test assertion that
    // the worker is dead within 10 s would then FAIL, proving the bug is present.
    const cancelFile = join(delegateMb, "cancel", `${reqId}.json`);
    writeFileSync(cancelFile, JSON.stringify({ reason: "test cancel" }));

    // --- 8. Assert the worker subprocess is killed within the cancel window ---
    // The setInterval fires on each `interval` tick (default 1 s in watchLoop) and
    // calls abortInFlightCancellations, which aborts the registry entry for reqId.
    // That triggers SIGTERM -> grace -> SIGKILL inside the delegate handler's run().
    // We give 10 s: generous even for a slow CI box (timer fires within 1–2 s).
    await pollUntil(
      () => {
        try {
          process.kill(workerPid, 0);
          return false; // still alive
        } catch {
          return true; // ESRCH — process is dead
        }
      },
      10_000,
      `worker process ${workerPid} to die after cancel marker written`,
    );

    // Hard assert: the process must be gone (ESRCH).
    assert.throws(
      () => process.kill(workerPid, 0),
      (err: NodeJS.ErrnoException) => err.code === "ESRCH",
      `worker process ${workerPid} must be dead (ESRCH) after cancel`,
    );

    // --- 9. Assert the response file has status=cancelled ---
    const responsePath = join(delegateMb, "responses", `${reqId}.json`);
    await pollUntil(
      () => existsSync(responsePath),
      8_000,
      "response file to appear",
    );

    const response = JSON.parse(readFileSync(responsePath, "utf8")) as Record<string, unknown>;
    assert.equal(
      response.status,
      "cancelled",
      `response status must be "cancelled", got: ${JSON.stringify(response.status)}`,
    );

    // --- 10. Assert daemon logged the cancellation (confirms it went through the timer path) ---
    const allStderr = daemonStderr.join("");
    assert.match(
      allStderr,
      /cancelling in-flight request cancel-wl-test/,
      "daemon stderr must contain 'cancelling in-flight request cancel-wl-test'",
    );
  },
);
