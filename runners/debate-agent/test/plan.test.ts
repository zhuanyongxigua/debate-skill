// The plan parser + validator: the one strict-format surface in the daemon.

import assert from "node:assert/strict";
import { test } from "node:test";

import { Allowlist } from "../src/allowlist";
import { PLAN_JSON_SCHEMA, PlanInvalid, parsePlan, placeholderRefs, substitute, validatePlan } from "../src/plan";

const allow: Allowlist = {
  repoRoots: [],
  modes: ["debate-proposal"],
  providers: ["claude", "codex"],
  providerAliases: {},
  profiles: { claude: [], codex: [] },
  capabilities: ["read_only_review"],
  allowedCapabilitySets: [["read_only_review"]],
  maxPromptChars: 200000,
  maxBatchItems: 8,
  maxParallel: 4,
  maxParallelPerProvider: 2,
  rateLimitPatterns: { claude: [], codex: [], copilot: [] },
  fallback: { enabled: true, order: ["claude", "codex"] },
  delegate: { enabled: false, modes: ["once"], maxMinutes: 30, maxWorkspaceWriteMinutes: 30 },
  remoteOps: { enabled: false, allowedBashPatterns: [], injectSshAuthSock: false },
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
  // `effort: null` means "no override" — the structured-output schema requires the
  // key, so codex emits null when it has nothing to override. It must validate and
  // be dropped (not rejected), or every codex plan would fail validation.
  const nullEffort = validatePlan(
    { complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", prompt: "x", effort: null }] }], answer_item: "P1" },
    allow,
  );
  assert.equal(nullEffort.phases[0]!.launches[0]!.effort, undefined);
  // 'max' is NOT valid for codex
  const badCodex = { complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", prompt: "x", effort: "max" }] }], answer_item: "P1" };
  assert.throws(() => validatePlan(badCodex, allow), /effort .* not allowed for provider "codex"/);
  // the retired per-launch `fast` field is now an UNKNOWN field => rejected.
  const badFast = { complexity: "simple", phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", prompt: "x", effort: "xhigh", fast: true }] }], answer_item: "P1" };
  assert.throws(() => validatePlan(badFast, allow), /unknown field/);
});

test("PLAN_JSON_SCHEMA is a valid OpenAI strict response_format (codex --output-schema)", () => {
  // codex forwards this schema to the OpenAI API, whose strict validator requires
  // EVERY object property to appear in that object's `required` array. A miss (e.g.
  // optional-by-omission `effort`) makes every codex planner call fail with HTTP 400
  // invalid_json_schema. Walk the schema and assert the rule everywhere.
  const offenders: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
      const props = Object.keys(obj.properties as Record<string, unknown>);
      const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
      for (const key of props) {
        if (!required.includes(key)) offenders.push(`${path}.${key}`);
      }
      for (const key of props) walk((obj.properties as Record<string, unknown>)[key], `${path}.${key}`);
    }
    if (obj.items) walk(obj.items, `${path}[]`);
  };
  walk(PLAN_JSON_SCHEMA, "plan");
  assert.deepEqual(offenders, [], `schema properties missing from their object's "required": ${offenders.join(", ")}`);
  // and the optional override must stay nullable so "no override" is expressible.
  const effort = (PLAN_JSON_SCHEMA as any).properties.phases.items.properties.launches.items.properties.effort;
  assert.deepEqual(effort.type, ["string", "null"]);
});

test("validatePlan checks effort against alias base provider", () => {
  const aliasAllow: Allowlist = {
    ...allow,
    providers: ["codex-gpt52", "claude-opus"],
    providerAliases: {
      "codex-gpt52": { base: "codex", model: "gpt-5.2-codex", profile: null },
      "claude-opus": { base: "claude", model: "claude-opus-4-8", profile: null },
    },
  };
  const ok = {
    complexity: "simple",
    phases: [{ name: "p", launches: [{ id: "P1", provider: "claude-opus", effort: "max", prompt: "x" }] }],
    answer_item: "P1",
  };
  assert.equal(validatePlan(ok, aliasAllow).phases[0]!.launches[0]!.provider, "claude-opus");
  const badCodex = {
    complexity: "simple",
    phases: [{ name: "p", launches: [{ id: "P1", provider: "codex-gpt52", effort: "max", prompt: "x" }] }],
    answer_item: "P1",
  };
  assert.throws(() => validatePlan(badCodex, aliasAllow), /base codex/);
});

test("validatePlan enforces per-phase launch cap (max_batch_items)", () => {
  const launches = Array.from({ length: allow.maxBatchItems + 1 }, (_v, i) => ({ id: `P${i}`, provider: "codex", effort: "xhigh", prompt: "x" }));
  assert.throws(() => validatePlan({ complexity: "simple", phases: [{ name: "p", launches }], answer_item: "P0" }, allow), /exceeds max_batch_items/);
});
