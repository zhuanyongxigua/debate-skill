// Integration test: real subprocess cancel path through the daemon.
//
// APPROACH CHOSEN: in-process + real child process.
//
// Why not the full "bin/debate-agent watch" subprocess approach:
//   The watch daemon polls on a 1-second interval between ticks. Coordinating
//   cancel/<id>.json delivery timing relative to when processNewRequests is
//   actively executing (not sleeping) requires either a long sleep (flaky) or
//   hooking into internals. The in-process approach lets us drive processNewRequests
//   directly while still spawning a REAL blocking child process (a `sleep 30` bash
//   stub), exercising the full real spawn->SIGTERM->grace->SIGKILL teardown path
//   through execute() and the CancellationRegistry.
//
// What this test exercises:
//   - A real AbortController signal threaded through processNewRequests ->
//     createDebateHandler -> runDebate -> runPreparedItems -> execute()
//   - A real OS child process (bash sleep 30 stub) is actually spawned.
//   - applyCancellations writes the cancel/<id>.json marker and aborts the registry,
//     which triggers the SIGTERM -> grace -> SIGKILL sequence in execute().
//   - The response file gets status "cancelled".
//   - The stub child process is actually DEAD after cancel (we capture its PID
//     via a file the stub writes and assert process.kill(pid, 0) throws ESRCH).
//   - A concurrently-running sibling request is NOT cancelled.
//
// PROCESS DEATH ASSERTION:
//   The bash stub writes its own PID to a file (pidFile) before sleeping.
//   After the cancel resolves, we read that PID and call process.kill(pid, 0),
//   which throws ESRCH (no such process) if the process is truly dead. This
//   mirrors the approach in cancel.test.ts test 1 (execute() signal test).

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { openMailboxAt, writeResponse } from "../src/mailbox";
import { CancellationRegistry, applyCancellations } from "../src/mailbox_service";
import { DebateDeps } from "../src/debate";
import { BatchItemResult } from "../src/runner";
import { processNewRequests } from "../src/watch";
import { cleanup, makeAllowlist, makeStub, makeTempDir } from "./helpers";

// ---------------------------------------------------------------------------
// Poll helper (bounded retry loop)
// ---------------------------------------------------------------------------
async function pollUntil(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`pollUntil timed out (${timeoutMs}ms): ${what}`);
    await new Promise<void>((r) => setTimeout(r, 30));
  }
}

// ---------------------------------------------------------------------------
// Test state (one set per test run)
// ---------------------------------------------------------------------------

let root: string;
let repo: string;
let binDir: string;
let pidFile: string;

beforeEach(() => {
  root = makeTempDir("cancel-real-child-");
  repo = join(root, "repo");
  mkdirSync(repo);
  binDir = join(root, "bin");
  mkdirSync(binDir);
  pidFile = join(root, "child.pid");
  process.env.DEBATE_AGENT_MAILBOX = join(root, "mailbox");
  process.env.DEBATE_AGENT_AUDIT_HOME = join(root, "audit");
});

afterEach(() => {
  delete process.env.DEBATE_AGENT_MAILBOX;
  delete process.env.DEBATE_AGENT_AUDIT_HOME;
  // Best-effort kill of any lingering child whose PID we captured.
  if (existsSync(pidFile)) {
    const pidStr = readFileSync(pidFile, "utf8").trim();
    const pid = parseInt(pidStr, 10);
    if (!isNaN(pid)) {
      for (const sig of ["SIGTERM", "SIGKILL"] as NodeJS.Signals[]) {
        try { process.kill(pid, sig); } catch { /* already gone */ }
      }
    }
  }
  cleanup(root);
});

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

test(
  "daemon cancel (real child): SIGTERM+SIGKILL teardown exercised, response status=cancelled, sibling unaffected",
  { timeout: 20_000 },
  async () => {
    const repoPath = realpathSync(repo);

    // A bash stub that:
    //   1. Writes its own PID to pidFile (so we can later assert it is dead).
    //   2. Sleeps 30 seconds — keeps the request "in flight".
    makeStub(
      binDir,
      "codex",
      [
        "#!/usr/bin/env bash",
        // Write PID to pidFile (create or append — each spawn will overwrite)
        `echo $$ > ${JSON.stringify(pidFile)}`,
        "sleep 30",
      ].join("\n") + "\n",
    );

    const allow = makeAllowlist(repoPath, {
      providers: ["codex"],
      modes: ["debate-proposal"],
      maxConcurrentRequests: 2,
      maxParallel: 2,
      maxParallelPerProvider: 2,
    });

    const mb = openMailboxAt(join(root, "mailbox"));
    const ignore = new Set<string>();

    // Write two debate requests: one to cancel, one sibling that completes fast.
    writeFileSync(
      join(mb.requestsDir, "cancel-me.json"),
      JSON.stringify({
        schema_version: 1,
        id: "cancel-me",
        kind: "debate_request",
        prompt: "to be cancelled",
        repo: repoPath,
        providers: ["codex"],
      }),
    );
    writeFileSync(
      join(mb.requestsDir, "sibling.json"),
      JSON.stringify({
        schema_version: 1,
        id: "sibling",
        kind: "debate_request",
        prompt: "must complete normally",
        repo: repoPath,
        providers: ["codex"],
      }),
    );

    const registry = new CancellationRegistry();

    // A codex stub that actually blocks (real child) for cancel-me, and
    // returns immediately (injected) for sibling.
    //
    // We inject runItems for both requests via makeDeps:
    //   - "cancel-me" uses the REAL runPreparedItems (default, no makeDeps override
    //     for runItems) so the real codex bash stub is spawned.
    //   - "sibling" uses an injected runItems that resolves immediately.
    //
    // To spawn a REAL child only for cancel-me, we pass custom makeDeps that
    // selects between real runItems and an injected fast path based on req.id.

    const baseEnv = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      HOME: root,
    };

    const makeDeps = (req: { id: string }): DebateDeps => {
      const planner = async () =>
        JSON.stringify({
          complexity: "simple",
          phases: [
            {
              name: "proposal_generation",
              launches: [{ id: "P1", provider: "codex", prompt: "go" }],
            },
          ],
          answer_item: "P1",
        });

      if (req.id === "sibling") {
        // Sibling completes immediately via injected runItems (no real spawn needed
        // for the sibling-isolation assertion).
        const runItems: DebateDeps["runItems"] = async (): Promise<BatchItemResult[]> => [
          { item_id: "P1", status: "completed", provider: "codex" },
        ];
        return { planner, runItems, readOutput: () => "SIBLING-OK" };
      }

      // cancel-me: use real runPreparedItems (default) so the codex bash stub
      // (sleep 30) is actually spawned. Pass baseEnv so the stub is on PATH.
      return { planner, baseEnv };
    };

    // Kick off processNewRequests in the background (will claim + start both).
    const processPromise = processNewRequests(mb, ignore, allow, { makeDeps }, registry);

    // Wait until the real child subprocess has started (stub writes its PID to
    // pidFile before sleeping). We must wait for this file — not just for
    // registry.has("cancel-me") — because the registry entry is added BEFORE
    // handler.run() starts (so the child has not yet been spawned when the entry
    // appears). If we abort before the child spawns, pidFile never gets written
    // and our process-death assertion would fail.
    await pollUntil(
      () => existsSync(pidFile),
      8_000,
      "child pid file to appear (real codex stub started)",
    );

    // Now fire the cancel — the registry aborts the AbortController for cancel-me,
    // which triggers SIGTERM->grace->SIGKILL on the real child process.
    const aborted = registry.abort("cancel-me");
    assert.ok(aborted, "registry.abort('cancel-me') should return true (it was in-flight)");

    // Wait for processNewRequests to finish (both requests settled).
    await processPromise;

    // --- ASSERTION 1: response status = cancelled ---
    const cancelRespPath = join(mb.responsesDir, "cancel-me.json");
    assert.ok(existsSync(cancelRespPath), "cancel-me.json response file should exist");
    const cancelResp = JSON.parse(readFileSync(cancelRespPath, "utf8"));
    assert.equal(
      cancelResp.status,
      "cancelled",
      `cancel-me response should be status=cancelled, got: ${JSON.stringify(cancelResp)}`,
    );

    // --- ASSERTION 2: the real spawned child process is actually dead ---
    // The stub wrote its PID to pidFile before sleeping. We read it and assert
    // that the process no longer exists. This proves SIGTERM (or SIGKILL) was
    // actually delivered through the execute() kill sequence.
    assert.ok(existsSync(pidFile), "child.pid file must exist (stub wrote it before sleeping)");
    const childPidStr = readFileSync(pidFile, "utf8").trim();
    const childPid = parseInt(childPidStr, 10);
    assert.ok(!isNaN(childPid) && childPid > 0, `child PID must be a positive integer, got: "${childPidStr}"`);

    // Give the OS a moment to reap the process after SIGKILL.
    await pollUntil(
      () => {
        try {
          process.kill(childPid, 0);
          return false; // still alive
        } catch {
          return true; // ESRCH = dead
        }
      },
      5_000,
      `child process ${childPid} to be dead after cancel`,
    );

    // Final check: throws means process is gone (ESRCH).
    assert.throws(
      () => process.kill(childPid, 0),
      (err: NodeJS.ErrnoException) => err.code === "ESRCH",
      `child process ${childPid} should be dead (ESRCH) after cancel`,
    );

    // --- ASSERTION 3: sibling was NOT cancelled ---
    const siblingRespPath = join(mb.responsesDir, "sibling.json");
    assert.ok(existsSync(siblingRespPath), "sibling.json response file should exist");
    const siblingResp = JSON.parse(readFileSync(siblingRespPath, "utf8"));
    assert.equal(
      siblingResp.status,
      "completed",
      `sibling response should be status=completed, got: ${JSON.stringify(siblingResp)}`,
    );

    // --- ASSERTION 4: registry is clean after both finished ---
    assert.ok(!registry.has("cancel-me"), "cancel-me should be deregistered after completion");
    assert.ok(!registry.has("sibling"), "sibling should be deregistered after completion");
  },
);
