// The plan parser + validator: the one strict-format surface in the daemon.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Allowlist } from "../src/allowlist";
import { PlanInvalid, parsePlan, placeholderRefs, substitute, validatePlan } from "../src/plan";

const allow: Allowlist = {
  repoRoots: [],
  modes: ["debate-proposal"],
  providers: ["claude", "codex"],
  profiles: { claude: [], codex: [] },
  capabilities: ["read_only_review"],
  maxPromptChars: 200000,
  maxBatchItems: 8,
  maxParallel: 4,
  maxParallelPerProvider: 2,
  rateLimitPatterns: { claude: [], codex: [], copilot: [] },
  fallback: { enabled: true, order: ["claude", "codex"] },
  delegate: { enabled: false, modes: ["once"], maxMinutes: 30, maxWorkspaceWriteMinutes: 30 },
};

function goodPlan(): unknown {
  return {
    complexity: "simple",
    phases: [
      { name: "proposal_generation", launches: [
        { id: "P1", provider: "codex", effort: "xhigh", prompt: "propose A" },
        { id: "P2", provider: "claude", effort: "high", prompt: "propose B" },
      ] },
      { name: "arbitration", launches: [
        { id: "A1", provider: "claude", effort: "high", prompt: "Proposals:\n{{P1.output}}\n{{P2.output}}\nDecide." },
      ] },
    ],
    answer_item: "A1",
  };
}

// --- parsePlan -------------------------------------------------------------

test("parsePlan accepts bare JSON", () => {
  assert.deepEqual(parsePlan('{"phases":[]}'), { phases: [] });
});

test("parsePlan extracts JSON from code fences / prose", () => {
  const wrapped = "Here is the plan:\n```json\n" + JSON.stringify(goodPlan()) + "\n```\nDone.";
  assert.equal((parsePlan(wrapped) as { answer_item: string }).answer_item, "A1");
});

test("parsePlan throws on non-JSON", () => {
  assert.throws(() => parsePlan("not json at all"), PlanInvalid);
});

// --- substitute / placeholderRefs -----------------------------------------

test("placeholderRefs finds referenced ids (deduped)", () => {
  assert.deepEqual(placeholderRefs("a {{P1.output}} b {{P2.output}} c {{P1.output}}"), ["P1", "P2"]);
});

test("substitute fills placeholders; missing => empty", () => {
  assert.equal(substitute("x {{P1.output}} y {{Z.output}}", { P1: "HELLO" }), "x HELLO y ");
});

// --- validatePlan ----------------------------------------------------------

test("validatePlan accepts a good plan", () => {
  const plan = validatePlan(goodPlan(), allow);
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.answerItem, "A1");
  assert.equal(plan.phases[1]!.launches[0]!.prompt.includes("{{P1.output}}"), true);
});

test("validatePlan rejects unknown field / empty phases / dup id", () => {
  assert.throws(() => validatePlan({ ...(goodPlan() as object), oops: 1 }, allow), /unknown plan field/);
  assert.throws(() => validatePlan({ complexity: "simple", phases: [], answer_item: "x" }, allow), /non-empty array/);
  const dup = {
    complexity: "simple",
    phases: [{ name: "p", launches: [
      { id: "P1", provider: "codex", effort: "xhigh", prompt: "a" },
      { id: "P1", provider: "codex", effort: "xhigh", prompt: "b" },
    ] }],
    answer_item: "P1",
  };
  assert.throws(() => validatePlan(dup, allow), /duplicate launch id/);
});

test("validatePlan rejects non-allowlisted provider and empty prompt", () => {
  const badProv = { complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "gemini", effort: "high", prompt: "a" }] }], answer_item: "P1" };
  assert.throws(() => validatePlan(badProv, allow), /not in allowlist/);
  const blank = { complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", effort: "xhigh", prompt: "  " }] }], answer_item: "P1" };
  assert.throws(() => validatePlan(blank, allow), /non-empty string/);
});

test("validatePlan rejects forward / same-phase output references", () => {
  // same phase: C2 references C1 which runs in parallel with it
  const samePhase = {
    complexity: "simple",
    phases: [{ name: "critique", launches: [
      { id: "C1", provider: "codex", effort: "xhigh", prompt: "a" },
      { id: "C2", provider: "claude", effort: "high", prompt: "see {{C1.output}}" },
    ] }],
    answer_item: "C1",
  };
  assert.throws(() => validatePlan(samePhase, allow), /same or a later phase/);
  // forward: phase 1 references phase 2's output
  const forward = {
    complexity: "simple",
    phases: [
      { name: "p1", launches: [{ id: "P1", provider: "codex", effort: "xhigh", prompt: "see {{A1.output}}" }] },
      { name: "p2", launches: [{ id: "A1", provider: "claude", effort: "high", prompt: "decide" }] },
    ],
    answer_item: "A1",
  };
  assert.throws(() => validatePlan(forward, allow), /same or a later phase|unknown output/);
});

test("validatePlan rejects unknown reference and bad answer_item", () => {
  const unknownRef = { complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", effort: "xhigh", prompt: "see {{ZZ.output}}" }] }], answer_item: "P1" };
  assert.throws(() => validatePlan(unknownRef, allow), /unknown output/);
  assert.throws(
    () => validatePlan({ complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", effort: "xhigh", prompt: "a" }] }], answer_item: "nope" }, allow),
    /answer_item/,
  );
});

test("validatePlan allows optional per-launch effort, rejects bad effort and unknown fields", () => {
  const ok = {
    complexity: "simple",
    phases: [{ name: "p", launches: [
      { id: "P1", provider: "codex", prompt: "x" },
      { id: "P2", provider: "claude", prompt: "y", effort: "max" },
    ] }],
    answer_item: "P1",
  };
  const plan = validatePlan(ok, allow);
  assert.equal(plan.complexity, "simple");
  assert.equal(plan.phases[0]!.launches[0]!.effort, undefined);
  assert.equal(plan.phases[0]!.launches[1]!.effort, "max"); // max valid for claude
  assert.throws(
    () => validatePlan({ phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", effort: "xhigh", prompt: "x" }] }], answer_item: "P1" }, allow),
    /complexity/,
  );
  assert.throws(
    () => validatePlan({ complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", prompt: "x", effort: null }] }], answer_item: "P1" }, allow),
    /effort .* not allowed/,
  );
  // 'max' is NOT valid for codex
  const badCodex = { complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", prompt: "x", effort: "max" }] }], answer_item: "P1" };
  assert.throws(() => validatePlan(badCodex, allow), /effort .* not allowed for provider "codex"/);
  // the retired per-launch `fast` field is now an UNKNOWN field => rejected.
  const badFast = { complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", prompt: "x", effort: "xhigh", fast: true }] }], answer_item: "P1" };
  assert.throws(() => validatePlan(badFast, allow), /unknown field/);
});

test("validatePlan enforces per-phase launch cap (max_batch_items)", () => {
  const launches = Array.from({ length: allow.maxBatchItems + 1 }, (_v, i) => ({ id: `P${i}`, provider: "codex", effort: "xhigh", prompt: "x" }));
  assert.throws(() => validatePlan({ complexity: "simple", phases: [{ name: "p", launches }], answer_item: "P0" }, allow), /exceeds max_batch_items/);
});
