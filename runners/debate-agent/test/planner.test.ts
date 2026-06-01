// The claude structured-output extractor (reads the plan out of the
// `--output-format json` envelope). No real CLI.

import assert from "node:assert/strict";
import { test } from "node:test";

import { extractClaudeStructuredOutput } from "../src/planner";

test("extracts structured_output from a claude json envelope", () => {
  const plan = { phases: [{ name: "p", launches: [{ id: "P1", provider: "codex", prompt: "x" }] }], answer_item: "P1" };
  const env = JSON.stringify({ type: "result", subtype: "success", result: "ignore this text", structured_output: plan });
  assert.deepEqual(JSON.parse(extractClaudeStructuredOutput(env)), plan);
});

test("falls back to the envelope's text result when there is no structured_output", () => {
  const env = JSON.stringify({ type: "result", result: '{"phases":[]}' });
  assert.equal(extractClaudeStructuredOutput(env), '{"phases":[]}');
});

test("falls back to raw stdout when the output is not an envelope", () => {
  assert.equal(extractClaudeStructuredOutput("this is not a valid plan"), "this is not a valid plan");
});
