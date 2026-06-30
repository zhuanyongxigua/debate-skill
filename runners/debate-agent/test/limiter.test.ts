// Regression tests for the module-global subprocess concurrency limiter in src/runner.ts.
//
// These tests use the exported test seams:
//   __testAcquireSubprocessSlot(provider, globalCap, perProviderCap)
//   __testReleaseSubprocessSlot(provider)
//   __testResetSubprocessLimiter()
//
// WHY THESE TESTS GUARD A REAL BUG:
// The old "wake only the FIFO head" implementation called _waiters.shift() and
// invoked that one waiter. If it failed (per-provider cap still full), the old
// code dropped it — no re-park. That meant a slot freed for provider X would
// wake the FIFO head (which might be a different provider Y that can't acquire),
// fail, drop it, and the actual provider-X waiter behind it would NEVER wake:
// a lost wakeup / head-of-line deadlock. The fix drains all waiters into a
// local snapshot, tries each, and re-parks failures in order so no waiter is
// ever silently dropped.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  __testAcquireSubprocessSlot,
  __testReleaseSubprocessSlot,
  __testResetSubprocessLimiter,
} from "../src/runner";

beforeEach(() => {
  __testResetSubprocessLimiter();
});

afterEach(() => {
  __testResetSubprocessLimiter();
});

// ---------------------------------------------------------------------------
// (a) THE DEADLOCK SCENARIO
// globalCap=4, perProviderCap=2.
// 1. Acquire 2 codex + 2 claude slots => global full.
// 2. Enqueue a codex acquire FIRST (parks: codex per-provider cap at 2).
// 3. Enqueue a claude acquire SECOND (parks: global cap at 4).
// 4. Release ONE claude slot: frees global=3/4 AND claude=1/2.
//
// OLD BUG ("wake FIFO head only"):
//   - Wakes the head waiter (codex), which fails (codex still at 2), gets DROPPED.
//   - The claude waiter behind it is never woken => its promise hangs forever => deadlock.
//   - The test would time out waiting for claudeResolved to become true.
//
// WITH THE FIX (drain all waiters, re-park failures):
//   - Both waiters are tried; codex fails and is re-parked, claude succeeds and resolves.
//   - claudeResolved becomes true within this tick.
// ---------------------------------------------------------------------------
test("limiter (a): releasing a claude slot wakes the blocked claude waiter even when a codex waiter is ahead in FIFO", async () => {
  const G = 4;
  const P = 2;

  // Step 1: fill all 4 global slots (2 codex, 2 claude)
  await __testAcquireSubprocessSlot("codex", G, P);
  await __testAcquireSubprocessSlot("codex", G, P);
  await __testAcquireSubprocessSlot("claude", G, P);
  await __testAcquireSubprocessSlot("claude", G, P);
  // global=4, codex=2, claude=2 — completely saturated.

  // Step 2: enqueue codex acquire FIRST (parks: codex per-provider full at 2)
  // This parks in the FIFO queue ahead of the claude waiter below.
  let codexResolved = false;
  const codexWaiter = __testAcquireSubprocessSlot("codex", G, P).then(() => {
    codexResolved = true;
  });

  // Yield one microtask tick to let the codex waiter park itself.
  await Promise.resolve();

  // Step 3: enqueue claude acquire SECOND (parks: global full at 4)
  // In the FIFO queue, this sits BEHIND the codex waiter.
  let claudeResolved = false;
  const claudeWaiter = __testAcquireSubprocessSlot("claude", G, P).then(() => {
    claudeResolved = true;
  });

  // Yield one microtask tick to let the claude waiter park itself.
  await Promise.resolve();

  assert.equal(codexResolved, false, "codex waiter should still be parked before release");
  assert.equal(claudeResolved, false, "claude waiter should still be parked before release");

  // Step 4: release ONE claude slot.
  // After this: global=3/4, claude=1/2. The claude waiter can acquire (global room + claude room).
  // The codex waiter still cannot (codex still at per-provider cap of 2).
  __testReleaseSubprocessSlot("claude");

  // Allow microtasks to drain. The fix wakes both waiters; codex re-parks, claude resolves.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  // Assert: WITHOUT the fix this would remain false (deadlock). WITH the fix it is true.
  assert.equal(
    claudeResolved,
    true,
    "claude waiter MUST resolve after releasing a claude slot — if false, the old head-of-line bug is present",
  );
  // Codex should still be parked (its per-provider cap is still full at 2).
  assert.equal(codexResolved, false, "codex waiter should remain parked (codex per-provider cap still at 2)");

  // Clean up: release a codex slot so the codex waiter can resolve, then
  // release both newly acquired slots so the limiter is clean for afterEach.
  __testReleaseSubprocessSlot("codex");
  await Promise.resolve();
  await Promise.resolve();
  // claude slot was acquired by the claude waiter
  __testReleaseSubprocessSlot("claude");
  // codex waiter now resolved
  await codexWaiter;
  __testReleaseSubprocessSlot("codex");
  // remaining held slots (from step 1)
  __testReleaseSubprocessSlot("codex");
  __testReleaseSubprocessSlot("claude");

  await claudeWaiter; // already resolved; just confirm no unhandled rejection
});

// ---------------------------------------------------------------------------
// (b) LIVENESS CHECK
// Fill up to globalCap, park N waiters, release N times; assert ALL N resolve
// and that concurrency never exceeded globalCap or perProviderCap.
// ---------------------------------------------------------------------------
test("limiter (b): releasing N slots wakes all N parked waiters (no lost wakeup)", async () => {
  const G = 3;
  const P = 3; // per-provider cap = globalCap so only global cap is binding here
  const EXTRA = 4; // number of extra waiters to park beyond globalCap

  // Track concurrent acquisitions via a counter.
  let concurrentActive = 0;
  let maxConcurrentSeen = 0;

  // Fill global cap.
  for (let i = 0; i < G; i++) {
    await __testAcquireSubprocessSlot("claude", G, P);
    concurrentActive++;
    maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrentActive);
  }

  // Park EXTRA more waiters.
  const waiters: Promise<void>[] = [];
  for (let i = 0; i < EXTRA; i++) {
    waiters.push(
      __testAcquireSubprocessSlot("claude", G, P).then(() => {
        concurrentActive++;
        maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrentActive);
      }),
    );
  }

  // Yield to let waiters park.
  await Promise.resolve();

  // Release the G held slots one by one; each release should wake one waiter.
  for (let i = 0; i < G; i++) {
    concurrentActive--;
    __testReleaseSubprocessSlot("claude");
    await Promise.resolve();
    await Promise.resolve();
  }

  // Now the waiters should be resolving (up to G at a time). Release remaining.
  for (let i = 0; i < EXTRA; i++) {
    concurrentActive--;
    __testReleaseSubprocessSlot("claude");
    await Promise.resolve();
    await Promise.resolve();
  }

  // Wait for all to resolve.
  await Promise.all(waiters);

  // All EXTRA waiters must have resolved (no lost wakeup).
  // Also verify global cap was never exceeded.
  assert.ok(maxConcurrentSeen <= G, `concurrency exceeded globalCap: saw ${maxConcurrentSeen} > ${G}`);
});

// ---------------------------------------------------------------------------
// (c) PER-PROVIDER CAP ENFORCEMENT
// With perProviderCap=1, two acquires for the same provider must NOT be active
// concurrently. The second must park until the first releases.
// ---------------------------------------------------------------------------
test("limiter (c): per-provider cap=1 prevents two simultaneous slots for the same provider", async () => {
  const G = 4;
  const P = 1;

  // Acquire the first slot for "codex" — should resolve immediately.
  await __testAcquireSubprocessSlot("codex", G, P);

  // Attempt a second slot for "codex" — must park (per-provider cap full).
  let secondResolved = false;
  const second = __testAcquireSubprocessSlot("codex", G, P).then(() => {
    secondResolved = true;
  });

  // Yield to confirm the second is parked.
  await Promise.resolve();
  assert.equal(secondResolved, false, "second codex acquire must be parked while first is held");

  // Release the first slot — the second should now resolve.
  __testReleaseSubprocessSlot("codex");
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(secondResolved, true, "second codex acquire must resolve after the first is released");

  // Clean up the second acquired slot.
  __testReleaseSubprocessSlot("codex");
  await second;
});
