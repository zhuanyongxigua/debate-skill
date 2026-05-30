// Step-loop tests. The brain and the workers are both stubbed (scripted), so
// these run deterministically with no real LLM/CLI — the codex-style approach.

import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { BrainFn } from "../src/brain";
import { DebateDeps, runDebate } from "../src/debate";
import { DebateRequest } from "../src/mailbox";
import { BatchItemResult, PreparedItem } from "../src/runner";
import { cleanup, makeAllowlist, makeTempDir } from "./helpers";

let root: string;
let repo: string;
let outDir: string;
let allow: ReturnType<typeof makeAllowlist>;

beforeEach(() => {
  root = makeTempDir();
  repo = join(root, "repo");
  mkdirSync(repo);
  outDir = join(root, "out");
  mkdirSync(outDir);
  allow = makeAllowlist(repo, { modes: ["debate-proposal", "debate-critique", "debate-cross-review"] });
});

afterEach(() => cleanup(root));

function debateRequest(): DebateRequest {
  const r = realpathSync(repo);
  return { id: "20260531-test", prompt: "debate this", repo: r, repoRoot: r, outputContract: null };
}

/** Stubbed worker runner: records the items it was asked to run, writes each
 * completed worker's output to a temp file (so readOutput() works like prod). */
function stubWorkers(output: (it: PreparedItem) => string = (it) => `output-of-${it.itemId}`) {
  const calls: PreparedItem[][] = [];
  const fn: DebateDeps["runItems"] = async (items) => {
    calls.push(items);
    return items.map((it): BatchItemResult => {
      if (it.rejected !== undefined) {
        return { item_id: it.itemId, status: "rejected", error_category: "rejected", reject_reason: it.rejected };
      }
      const p = join(outDir, `${it.itemId}-${calls.length}.txt`);
      writeFileSync(p, output(it));
      return { item_id: it.itemId, status: "completed", provider: it.req!.provider, stdout_path: p };
    });
  };
  return { fn, calls };
}

test("multi-phase debate: brain → proposers → critic → final, with feedback", async () => {
  const workers = stubWorkers();
  const brain: BrainFn = async (state) => {
    if (state.history.length === 0) {
      return {
        kind: "run",
        phase: "proposal_generation",
        launches: [
          { id: "P1", provider: "codex", prompt: "propose A" },
          { id: "P2", provider: "claude", prompt: "propose B" },
        ],
      };
    }
    if (state.history.length === 1) {
      const props = state.history[0]!.results.map((r) => r.output).join(" | ");
      return { kind: "run", phase: "critique", launches: [{ id: "C1", provider: "claude", prompt: `critique: ${props}` }] };
    }
    return { kind: "final", status: "completed", answer_markdown: `FINAL: ${state.history[1]!.results[0]!.output}` };
  };

  const res = await runDebate(debateRequest(), allow, { brain, runItems: workers.fn });

  assert.equal(res.status, "completed");
  assert.equal(res.steps, 2);
  assert.match(res.answer_markdown, /FINAL: output-of-C1/);

  // debate-skill output layout: brain sections + runner-built Archive + Trace
  assert.match(res.answer_markdown, /## Archive/);
  assert.match(res.answer_markdown, /## Trace/);
  assert.match(res.answer_markdown, /\| 1 \| proposal_generation \| P1 \| codex \| completed \|/);
  // structured ground-truth process record
  assert.deepEqual(
    res.cli_participation.map((r) => `${r.step}:${r.phase}:${r.worker}:${r.provider}:${r.status}`),
    [
      "1:proposal_generation:P1:codex:completed",
      "1:proposal_generation:P2:claude:completed",
      "2:critique:C1:claude:completed",
    ],
  );

  // phase 0: 2 proposers, providers preserved, capability FORCED read-only
  const p0 = workers.calls[0]!;
  assert.deepEqual(
    p0.map((it) => it.req!.provider),
    ["codex", "claude"],
  );
  assert.ok(p0.every((it) => it.req!.capability === "read_only_review"));
  assert.equal(p0[0]!.req!.prompt, "propose A");
  assert.equal(p0[0]!.req!.phase, "proposal_generation");

  // phase 1: critic prompt contains the proposal outputs → feedback works
  const p1 = workers.calls[1]!;
  assert.equal(p1.length, 1);
  assert.match(p1[0]!.req!.prompt, /output-of-P1 \| output-of-P2/);
});

test("brain can answer directly with no debate", async () => {
  const workers = stubWorkers();
  const brain: BrainFn = async () => ({ kind: "final", status: "completed", answer_markdown: "direct answer" });
  const res = await runDebate(debateRequest(), allow, { brain, runItems: workers.fn });
  assert.equal(res.status, "completed");
  assert.equal(res.steps, 0);
  assert.equal(workers.calls.length, 0);
});

test("a non-allowlisted worker provider is rejected; the brain sees it", async () => {
  const workers = stubWorkers();
  let sawRejection = false;
  const brain: BrainFn = async (state) => {
    if (state.history.length === 0) {
      return {
        kind: "run",
        phase: "proposal_generation",
        launches: [
          { id: "P1", provider: "claude", prompt: "ok" },
          { id: "P2", provider: "copilot", prompt: "blocked" }, // not in default allowlist
        ],
      };
    }
    const statuses = state.history[0]!.results.map((r) => r.status);
    sawRejection = statuses.includes("rejected");
    return { kind: "final", status: "degraded", answer_markdown: "done" };
  };
  const res = await runDebate(debateRequest(), allow, { brain, runItems: workers.fn });
  assert.equal(res.status, "degraded");
  assert.ok(sawRejection, "brain should see the copilot launch rejected in history");
});

test("degraded when the brain never finishes within maxSteps", async () => {
  const workers = stubWorkers();
  const brain: BrainFn = async () => ({
    kind: "run",
    phase: "proposal_generation",
    launches: [{ id: "P1", provider: "claude", prompt: "loop" }],
  });
  const res = await runDebate(debateRequest(), allow, { brain, runItems: workers.fn, maxSteps: 2 });
  assert.equal(res.status, "degraded");
  assert.match(res.status_reason, /within 2 steps/);
});

test("error when the brain throws", async () => {
  const workers = stubWorkers();
  const brain: BrainFn = async () => {
    throw new Error("brain boom");
  };
  const res = await runDebate(debateRequest(), allow, { brain, runItems: workers.fn });
  assert.equal(res.status, "error");
  assert.match(res.status_reason, /brain boom/);
});
