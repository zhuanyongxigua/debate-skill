// Parser tests for the brain's step-decision contract.

import assert from "node:assert/strict";
import { test } from "node:test";

import { BrainError, parseStepDecision } from "../src/brain";

test("parses a run decision", () => {
  const d = parseStepDecision('{"kind":"run","phase":"proposal_generation","launches":[{"id":"P1","provider":"codex","prompt":"go"}]}');
  assert.equal(d.kind, "run");
  if (d.kind === "run") {
    assert.equal(d.phase, "proposal_generation");
    assert.equal(d.launches[0]!.provider, "codex");
    assert.equal(d.launches[0]!.prompt, "go");
  }
});

test("parses a final decision", () => {
  const d = parseStepDecision('{"kind":"final","status":"completed","answer_markdown":"# Decision\\nyes"}');
  assert.equal(d.kind, "final");
  if (d.kind === "final") {
    assert.equal(d.status, "completed");
    assert.match(d.answer_markdown, /Decision/);
  }
});

test("tolerates markdown fences and surrounding prose", () => {
  const out = 'Sure, here is the next step:\n```json\n{"kind":"run","phase":"critique","launches":[{"provider":"claude","prompt":"x"}]}\n```\n';
  const d = parseStepDecision(out);
  assert.equal(d.kind, "run");
  if (d.kind === "run") assert.equal(d.launches[0]!.id, "L1"); // default id when omitted
});

test("rejects non-JSON output", () => {
  assert.throws(() => parseStepDecision("I cannot help with that."), BrainError);
});

test("rejects a run decision with empty launches", () => {
  assert.throws(() => parseStepDecision('{"kind":"run","launches":[]}'), BrainError);
});

test("rejects a launch missing provider/prompt", () => {
  assert.throws(() => parseStepDecision('{"kind":"run","launches":[{"id":"P1"}]}'), BrainError);
});

test("rejects an unknown kind", () => {
  assert.throws(() => parseStepDecision('{"kind":"explode"}'), BrainError);
});
