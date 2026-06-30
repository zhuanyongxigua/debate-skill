// Cancellation tests: execute() signal param, daemon-level registry isolation,
// harmless no-op for already-finished ids, and intermediates preservation.
//
// Tests must FAIL without the implementation changes.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { DebateDeps } from "../src/debate";
import {
  cancelRequestIds,
  consumeCancel,
  openMailboxAt,
  writeResponse,
} from "../src/mailbox";
import { CancellationRegistry, applyCancellations } from "../src/mailbox_service";
import { execute } from "../src/runner";
import { BatchItemResult } from "../src/runner";
import { processNewRequests } from "../src/watch";
import { cleanup, makeAllowlist, makeStub, makeTempDir } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempMailbox(root: string): ReturnType<typeof openMailboxAt> {
  const mbRoot = join(root, "mailbox");
  return openMailboxAt(mbRoot);
}

function stubBinDir(root: string): { binDir: string; slowStubPath: string } {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  // A stub that sleeps for 30 seconds — used to prove a signal kills it.
  const slowStubPath = makeStub(binDir, "slow-stub", "#!/usr/bin/env bash\nsleep 30\n");
  return { binDir, slowStubPath };
}

// Minimal ChildLaunch for testing execute() directly.
function makeSlowLaunch(binDir: string, repo: string): import("../src/launch").ChildLaunch {
  return {
    provider: "codex",
    baseProvider: "codex",
    model: null,
    argv: [join(binDir, "slow-stub")],
    cwd: repo,
    env: { PATH: `${binDir}:${process.env.PATH ?? ""}` },
    promptTransport: "stdin" as const,
    stdin: "",
    displayCommand: "slow-stub",
    strippedEnvKeys: [],
    providerEnvSource: null,
    injectedEnvKeys: [],
  };
}

// ---------------------------------------------------------------------------
// Test 1: execute() with a signal — cancellation kills the child process and
// resolves with status "cancelled".
// ---------------------------------------------------------------------------

let root1: string;
let repo1: string;

beforeEach(() => {
  // Use unique prefixes to avoid sharing root dirs between test instances.
});

test("execute() with signal: aborting kills the child and returns status=cancelled", async () => {
  const root = makeTempDir("cancel-exec-");
  const repo = join(root, "repo");
  mkdirSync(repo);
  const { binDir } = stubBinDir(root);
  try {
    const launch = makeSlowLaunch(binDir, repo);
    const ctrl = new AbortController();
    // Abort after a short delay so the child has time to start.
    const timer = setTimeout(() => ctrl.abort(), 100);
    const result = await execute(launch, 30, undefined, ctrl.signal);
    clearTimeout(timer);
    assert.equal(result.status, "cancelled", `expected cancelled, got ${JSON.stringify(result)}`);
    assert.equal(result.errorCategory, "cancelled");
    // The child should have exited (killed), so elapsed should be well under 30s.
    assert.ok(result.elapsedSeconds < 10, `elapsed ${result.elapsedSeconds}s is too long — child was not killed`);
  } finally {
    cleanup(root);
  }
});

test("execute() with pre-aborted signal: resolves cancelled immediately (no actual run)", async () => {
  const root = makeTempDir("cancel-preabort-");
  const repo = join(root, "repo");
  mkdirSync(repo);
  const { binDir } = stubBinDir(root);
  try {
    const launch = makeSlowLaunch(binDir, repo);
    const ctrl = new AbortController();
    ctrl.abort(); // already aborted before execute is called
    const result = await execute(launch, 30, undefined, ctrl.signal);
    assert.equal(result.status, "cancelled");
    assert.equal(result.errorCategory, "cancelled");
  } finally {
    cleanup(root);
  }
});

test("execute() without signal: timeout still works correctly (no regression)", async () => {
  const root = makeTempDir("cancel-timeout-");
  const repo = join(root, "repo");
  mkdirSync(repo);
  const { binDir } = stubBinDir(root);
  try {
    const launch = makeSlowLaunch(binDir, repo);
    // 0.1-second timeout — the 30-second sleep should time out
    const result = await execute(launch, 0.1);
    assert.equal(result.status, "timed_out", `expected timed_out, got ${result.status}`);
    assert.equal(result.errorCategory, "timeout");
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Test 2: daemon-level isolation — cancel ONE of two concurrent requests;
// the other must still complete normally.
// ---------------------------------------------------------------------------

test("daemon: cancelling one request does not affect a concurrently running sibling", async () => {
  const root = makeTempDir("cancel-isolate-");
  const repo = join(root, "repo");
  mkdirSync(repo);
  process.env.DEBATE_AGENT_MAILBOX = join(root, "mbdebate");
  const allow = makeAllowlist(repo, {
    modes: ["debate-proposal"],
    maxConcurrentRequests: 2, // allow two concurrent requests
  });

  // Two requests: one that will be cancelled, one that should complete.
  // We use injected runItems so no real subprocess is needed — instead we make
  // the "to-cancel" request pend on a real AbortSignal that we fire via the
  // registry, and the sibling resolves normally.
  const mb = openMailboxAt(join(root, "mbdebate"));
  const ignore = new Set<string>();

  // Write both requests to the mailbox.
  const repoPath = require("node:fs").realpathSync(repo) as string;
  writeFileSync(
    join(mb.requestsDir, "cancel-me.json"),
    JSON.stringify({ schema_version: 1, id: "cancel-me", kind: "debate_request", prompt: "to be cancelled", repo: repoPath }),
  );
  writeFileSync(
    join(mb.requestsDir, "keep-me.json"),
    JSON.stringify({ schema_version: 1, id: "keep-me", kind: "debate_request", prompt: "must complete", repo: repoPath }),
  );

  const registry = new CancellationRegistry();

  // Track which ids actually ran and whether they saw the signal.
  const cancelled: string[] = [];
  const completed: string[] = [];

  const makeDeps = (req: { id: string }): DebateDeps => {
    const planner = async () =>
      JSON.stringify({
        complexity: "simple",
        phases: [{ name: "proposal_generation", launches: [{ id: "P1", provider: "codex", prompt: "go" }] }],
        answer_item: "P1",
      });

    const runItems: DebateDeps["runItems"] = async (_items, _allow, _env, _maxP, signal): Promise<BatchItemResult[]> => {
      if (req.id === "cancel-me") {
        // Wait until the signal fires.
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener("abort", () => resolve());
          // Safety: resolve after 5s anyway.
          setTimeout(resolve, 5000);
        });
        cancelled.push(req.id);
        // Return a cancelled-status result to simulate what execute() would do.
        return [{ item_id: "P1", status: "cancelled", error_category: "cancelled" }];
      }
      // Sibling completes normally.
      completed.push(req.id);
      return [{ item_id: "P1", status: "completed", provider: "codex" }];
    };

    return { planner, runItems, readOutput: () => "OK" };
  };

  // Start processing — this will dispatch both claims concurrently.
  const processPromise = processNewRequests(mb, ignore, allow, { makeDeps }, registry);

  // Give the jobs a tick to start and register in the registry.
  await new Promise((r) => setTimeout(r, 20));

  // Now cancel just "cancel-me" by aborting via the registry.
  registry.abort("cancel-me");

  // Wait for both to finish.
  await processPromise;

  // "keep-me" must have completed normally.
  assert.ok(completed.includes("keep-me"), `keep-me did not complete: completed=${JSON.stringify(completed)}`);
  // "cancel-me" must have been cancelled.
  assert.ok(cancelled.includes("cancel-me"), `cancel-me was not cancelled: cancelled=${JSON.stringify(cancelled)}`);

  // The keep-me response should be status=completed.
  const keepResp = JSON.parse(readFileSync(join(mb.responsesDir, "keep-me.json"), "utf8"));
  assert.equal(keepResp.status, "completed", `keep-me response: ${JSON.stringify(keepResp)}`);

  // The cancel-me response should be status=cancelled.
  const cancelResp = JSON.parse(readFileSync(join(mb.responsesDir, "cancel-me.json"), "utf8"));
  assert.equal(cancelResp.status, "cancelled", `cancel-me response: ${JSON.stringify(cancelResp)}`);

  // Registry should be empty (both deregistered in finally).
  assert.ok(!registry.has("cancel-me"), "cancel-me should be deregistered after completion");
  assert.ok(!registry.has("keep-me"), "keep-me should be deregistered after completion");

  delete process.env.DEBATE_AGENT_MAILBOX;
  cleanup(root);
});

// ---------------------------------------------------------------------------
// Test 3: cancel marker for an already-finished id is a harmless no-op.
// ---------------------------------------------------------------------------

test("applyCancellations: cancel marker for already-finished id is a no-op (response unchanged, marker consumed)", () => {
  const root = makeTempDir("cancel-finished-");
  const repo = join(root, "repo");
  mkdirSync(repo);
  try {
    const mb = openMailboxAt(join(root, "mb"));
    const registry = new CancellationRegistry();
    const allow = makeAllowlist(repo);
    const ignore = new Set<string>();

    // Write a response as if the request already completed.
    writeResponse(mb, "done-id", { status: "completed", answer: "done" });

    // Write a cancel marker for the same id.
    writeFileSync(join(mb.cancelDir, "done-id.json"), JSON.stringify({}));
    assert.deepEqual(cancelRequestIds(mb), ["done-id"]);

    // A minimal handler stub — it should not be invoked.
    const handler = {
      kind: "debate_request",
      mailboxName: "test",
      resourceBudget: { maxConcurrent: 1, maxMinutes: null },
      invalidRequestDigest: "invalid",
      validate: () => { throw new Error("should not validate"); },
      requestDigest: () => "x",
      run: async () => { throw new Error("should not run"); },
      errorResponse: () => ({ status: "error" }),
      writeArtifacts: () => {},
    } as unknown as import("../src/handler").MailboxHandler<unknown, unknown>;

    applyCancellations(mb, registry, ignore, handler);

    // Marker must be consumed.
    assert.deepEqual(cancelRequestIds(mb), [], "cancel marker should have been consumed");
    // Response must be unchanged.
    const resp = JSON.parse(readFileSync(join(mb.responsesDir, "done-id.json"), "utf8"));
    assert.equal(resp.status, "completed", "finished response must not be altered by a cancel no-op");
  } finally {
    cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Test 4: intermediates are preserved on cancel of a multi-phase debate.
// ---------------------------------------------------------------------------

test("debate: cancellation preserves already-completed phase intermediates", async () => {
  const root = makeTempDir("cancel-intermediates-");
  const repo = join(root, "repo");
  mkdirSync(repo);
  process.env.DEBATE_AGENT_MAILBOX = join(root, "mb-ints");
  const allow = makeAllowlist(repo, { modes: ["debate-proposal"] });

  const { runDebate } = await import("../src/debate");

  const repoPath = require("node:fs").realpathSync(repo) as string;
  const request = {
    id: "multi-phase",
    prompt: "test",
    repo: repoPath,
    repoRoot: repoPath,
    language: null,
    fast: false,
    plannerProvider: null,
    providers: ["codex"],
    requestDigest: "sha256:test",
  };

  // Two-phase plan: phase 1 completes, phase 2 is interrupted by abort.
  const plan = JSON.stringify({
    complexity: "simple",
    phases: [
      { name: "proposal_generation", launches: [{ id: "P1", provider: "codex", prompt: "phase1" }] },
      { name: "arbitration", launches: [{ id: "A1", provider: "codex", prompt: "phase2" }] },
    ],
    answer_item: "A1",
  });

  const ctrl = new AbortController();
  let phase1Done = false;
  const capturedOutputs: string[] = [];

  // In-memory store to inspect intermediates after the run.
  let savedState: import("../src/debate").PersistedDebateState | null = null;
  const store: import("../src/debate").IntermediateStore = {
    load: () => savedState,
    save: (s) => { savedState = s; },
  };

  const deps: DebateDeps = {
    planner: async () => plan,
    runItems: async (items, _allow, _env, _max, signal): Promise<BatchItemResult[]> => {
      // Phase 1: run normally and complete.
      if (!phase1Done) {
        phase1Done = true;
        // Abort signal right after phase 1 finishes so phase 2 sees it.
        ctrl.abort();
        return items.map((it) => ({
          item_id: it.itemId,
          status: "completed" as const,
          provider: "codex",
        }));
      }
      // Phase 2: should not be reached because signal.aborted is checked before each phase.
      return items.map((it) => ({ item_id: it.itemId, status: "completed" as const, provider: "codex" }));
    },
    readOutput: () => "PHASE1-OUTPUT",
    signal: ctrl.signal,
    intermediateStore: store,
  };

  const resp = await runDebate(request, allow, deps);

  // Response status must be cancelled.
  assert.equal(resp.status, "cancelled", `expected cancelled, got ${JSON.stringify(resp)}`);

  // Intermediates must be preserved — phase 1 completed, phase 2 was not launched.
  assert.ok(savedState !== null, "state should have been persisted");
  const state = savedState as import("../src/debate").PersistedDebateState;
  const completedPhase1 = state.outputs.filter((o: import("../src/debate").IntermediateOutput) => o.status === "completed");
  assert.ok(completedPhase1.length >= 1, `expected at least 1 completed output, got ${JSON.stringify(state.outputs)}`);
  assert.equal(completedPhase1[0]!.item, "P1", "P1 should be the completed item");

  delete process.env.DEBATE_AGENT_MAILBOX;
  cleanup(root);
});

// ---------------------------------------------------------------------------
// Test 5: CancellationRegistry isolation — abort(X) does not affect Y.
// ---------------------------------------------------------------------------

test("CancellationRegistry: aborting id X does not abort id Y", () => {
  const registry = new CancellationRegistry();
  const ctrlX = registry.register("X");
  const ctrlY = registry.register("Y");

  assert.ok(!ctrlX.signal.aborted, "X should not be aborted yet");
  assert.ok(!ctrlY.signal.aborted, "Y should not be aborted yet");

  registry.abort("X");

  assert.ok(ctrlX.signal.aborted, "X should be aborted");
  assert.ok(!ctrlY.signal.aborted, "Y must NOT be aborted when only X is cancelled");
});

// ---------------------------------------------------------------------------
// Test 6: applyCancellations — cancel an unclaimed request before it runs.
// ---------------------------------------------------------------------------

test("applyCancellations: cancelling an unclaimed request writes a cancelled response and archives it", () => {
  const root = makeTempDir("cancel-unclaimed-");
  const repo = join(root, "repo");
  mkdirSync(repo);
  try {
    const mb = openMailboxAt(join(root, "mb2"));
    const registry = new CancellationRegistry();
    const ignore = new Set<string>();
    const repoPath = require("node:fs").realpathSync(repo) as string;

    // Write a request but do NOT claim it (ignore set is empty).
    writeFileSync(
      join(mb.requestsDir, "unclaimed.json"),
      JSON.stringify({ schema_version: 1, id: "unclaimed", kind: "debate_request", prompt: "x", repo: repoPath }),
    );

    // Write a cancel marker for it.
    writeFileSync(join(mb.cancelDir, "unclaimed.json"), JSON.stringify({}));

    const handler = {
      kind: "debate_request",
      mailboxName: "test",
      resourceBudget: { maxConcurrent: 1, maxMinutes: null },
      invalidRequestDigest: "invalid",
      validate: () => { throw new Error("should not validate"); },
      requestDigest: () => "x",
      run: async () => { throw new Error("should not run"); },
      errorResponse: () => ({ status: "error" }),
      writeArtifacts: () => {},
    } as unknown as import("../src/handler").MailboxHandler<unknown, unknown>;

    const logs: string[] = [];
    applyCancellations(mb, registry, ignore, handler, (msg) => logs.push(msg));

    // Marker consumed.
    assert.deepEqual(cancelRequestIds(mb), []);

    // A cancelled response must exist.
    const resp = JSON.parse(readFileSync(join(mb.responsesDir, "unclaimed.json"), "utf8"));
    assert.equal(resp.status, "cancelled", "unclaimed request should get a cancelled response");

    // The request should be in the ignore set (so it's not re-processed).
    assert.ok(ignore.has("unclaimed"), "unclaimed id should be added to the ignore set");

    // At least one log message should mention it.
    assert.ok(logs.some((l) => l.includes("unclaimed")), `expected log mention of 'unclaimed', got: ${JSON.stringify(logs)}`);
  } finally {
    cleanup(root);
  }
});
