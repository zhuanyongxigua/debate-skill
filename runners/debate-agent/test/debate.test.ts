// The debate orchestrator: plan-with-retry + mechanical templated execution,
// driven by a scripted planner and stub workers (no real model/CLI).

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { DebateDeps, runDebate } from "../src/debate";
import { DebateRequest } from "../src/mailbox";
import { PlannerFn } from "../src/planner";
import { BatchItemResult, PreparedItem } from "../src/runner";
import { cleanup, makeAllowlist, makeTempDir } from "./helpers";

let root: string;
let repo: string;
let allow: ReturnType<typeof makeAllowlist>;

beforeEach(() => {
  root = makeTempDir();
  repo = join(root, "repo");
  mkdirSync(repo);
  allow = makeAllowlist(repo, { modes: ["debate-proposal", "debate-critique", "debate-cross-review"] });
});

afterEach(() => cleanup(root));

function req(overrides: Partial<DebateRequest> = {}): DebateRequest {
  return { id: "d1", prompt: "debate this", repo, repoRoot: repo, language: null, fast: false, ...overrides };
}

/** Stub workers: capture the prepared items and complete each. */
function stubRun(): { runItems: DebateDeps["runItems"]; calls: PreparedItem[][] } {
  const calls: PreparedItem[][] = [];
  const runItems: DebateDeps["runItems"] = async (items) => {
    calls.push(items);
    return items.map((it): BatchItemResult =>
      it.rejected !== undefined
        ? { item_id: it.itemId, status: "rejected", reject_reason: it.rejected }
        : { item_id: it.itemId, status: "completed", provider: it.req!.provider },
    );
  };
  return { runItems, calls };
}

const readOutput = (r: BatchItemResult): string => `OUT[${r.item_id}]`;

const twoPhasePlan = JSON.stringify({
  phases: [
    { name: "proposal_generation", launches: [
      { id: "P1", provider: "codex", prompt: "propose A" },
      { id: "P2", provider: "claude", prompt: "propose B" },
    ] },
    { name: "arbitration", launches: [
      { id: "A1", provider: "claude", prompt: "Proposals:\n{{P1.output}}\n---\n{{P2.output}}\nDecide and write the final answer." },
    ] },
  ],
  answer_item: "A1",
});

test("runs the plan, substitutes earlier outputs into later prompts (mechanical)", async () => {
  const planner: PlannerFn = async () => twoPhasePlan;
  const { runItems, calls } = stubRun();
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput });

  assert.equal(resp.kind, "debate_result");
  assert.equal(resp.status, "completed");
  assert.equal(resp.answer_markdown, "OUT[A1]"); // answer_item's output
  // phase 2 prompt got phase 1 outputs substituted in as text (no LLM did this)
  const arbPrompt = calls[1]![0]!.req!.prompt;
  assert.match(arbPrompt, /Proposals:\nOUT\[P1\]\n---\nOUT\[P2\]/);
  // workers were forced read-only
  assert.equal(calls[0]![0]!.req!.capability, "read_only_review");
  // trace covers every launch
  assert.deepEqual(resp.trace.map((t) => `${t.item}:${t.status}`), ["P1:completed", "P2:completed", "A1:completed"]);
});

test("retries the planner on invalid output, then succeeds", async () => {
  let n = 0;
  const planner: PlannerFn = async (_r, attempt, lastError) => {
    n++;
    assert.equal(attempt, n - 1);
    if (n === 1) {
      assert.equal(lastError, null);
      return "this is not a plan";
    }
    assert.match(lastError ?? "", /not valid JSON|plan/);
    return twoPhasePlan;
  };
  const { runItems } = stubRun();
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput });
  assert.equal(n, 2);
  assert.equal(resp.status, "completed");
});

test("a planner that never produces a valid plan yields an error response (never hangs)", async () => {
  const planner: PlannerFn = async () => "{ not valid";
  const { runItems } = stubRun();
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput, maxPlanAttempts: 2 });
  assert.equal(resp.status, "error");
  assert.match(resp.status_reason, /did not produce a valid plan/);
  assert.equal(resp.answer_markdown, "");
});

test("a worker that does not complete degrades the debate (branch on status, not content)", async () => {
  const planner: PlannerFn = async () => twoPhasePlan;
  const calls: PreparedItem[][] = [];
  const runItems: DebateDeps["runItems"] = async (items) => {
    calls.push(items);
    // fail P2; complete the rest
    return items.map((it): BatchItemResult =>
      it.itemId === "P2"
        ? { item_id: it.itemId, status: "error", provider: "claude", error_category: "nonzero_exit" }
        : { item_id: it.itemId, status: "completed", provider: it.req!.provider },
    );
  };
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput });
  assert.equal(resp.status, "degraded");
  // a failed upstream output substitutes as empty, debate still finishes
  const arbPrompt = calls[1]![0]!.req!.prompt;
  assert.match(arbPrompt, /Proposals:\nOUT\[P1\]\n---\n\nDecide/);
  assert.equal(resp.answer_markdown, "OUT[A1]");
});

test("a plan with a non-allowlisted provider rejects that launch and degrades", async () => {
  const badPlan = JSON.stringify({
    phases: [{ name: "proposal_generation", launches: [{ id: "P1", provider: "copilot", prompt: "x" }] }],
    answer_item: "P1",
  });
  // provider not in the allowlist => validatePlan rejects the whole plan => retry => error
  const planner: PlannerFn = async () => badPlan;
  const { runItems } = stubRun();
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput, maxPlanAttempts: 1 });
  assert.equal(resp.status, "error");
  assert.match(resp.status_reason, /not in allowlist/);
});

// --- rate-limit fallback: same task, swap engine ---------------------------

const onePhaseClaudePlan = JSON.stringify({
  phases: [{ name: "proposal_generation", launches: [{ id: "P1", provider: "claude", prompt: "do the task" }] }],
  answer_item: "P1",
});

/** Stub workers that fail `failProviders` with a rate limit and complete the rest. */
function rateLimitRun(failProviders: Set<string>): { runItems: DebateDeps["runItems"]; calls: PreparedItem[][] } {
  const calls: PreparedItem[][] = [];
  const runItems: DebateDeps["runItems"] = async (items) => {
    calls.push(items);
    return items.map((it): BatchItemResult => {
      if (it.rejected !== undefined) return { item_id: it.itemId, status: "rejected", reject_reason: it.rejected };
      const provider = it.req!.provider;
      return failProviders.has(provider)
        ? { item_id: it.itemId, status: "error", provider, error_category: "rate_limited" }
        : { item_id: it.itemId, status: "completed", provider };
    });
  };
  return { runItems, calls };
}

test("a rate_limited worker is re-run on the next provider (same task, swap engine)", async () => {
  const planner: PlannerFn = async () => onePhaseClaudePlan;
  const { runItems, calls } = rateLimitRun(new Set(["claude"])); // claude limited, codex ok
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput });

  assert.equal(resp.status, "completed");
  assert.equal(calls.length, 2); // initial (claude) + one fallback round (codex)
  assert.equal(calls[0]![0]!.req!.provider, "claude");
  assert.equal(calls[1]![0]!.req!.provider, "codex");
  // the SAME substituted prompt is reused verbatim on the swap
  assert.equal(calls[1]![0]!.req!.prompt, calls[0]![0]!.req!.prompt);
  // the planner's claude effort ("high") is dropped for codex's default ("xhigh")
  assert.equal(calls[0]![0]!.req!.effort, "high");
  assert.equal(calls[1]![0]!.req!.effort, "xhigh");
  // trace + answer reflect the substitute engine
  assert.deepEqual(resp.trace.map((t) => `${t.item}:${t.provider}:${t.status}`), ["P1:codex:completed"]);
  assert.equal(resp.answer_markdown, "OUT[P1]");
});

test("when every provider is rate-limited the launch degrades (bounded, no infinite loop)", async () => {
  const planner: PlannerFn = async () => onePhaseClaudePlan;
  const { runItems, calls } = rateLimitRun(new Set(["claude", "codex"]));
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput });

  assert.equal(resp.status, "degraded");
  assert.equal(resp.answer_markdown, "");
  // initial + exactly one fallback round (then both providers tried => stop)
  assert.equal(calls.length, 2);
});

test("fallback disabled leaves a rate_limited worker to degrade (no retry)", async () => {
  const allowNoFb = makeAllowlist(repo, {
    modes: ["debate-proposal", "debate-critique", "debate-cross-review"],
    fallback: { enabled: false, order: ["claude", "codex"] },
  });
  const planner: PlannerFn = async () => onePhaseClaudePlan;
  const { runItems, calls } = rateLimitRun(new Set(["claude"]));
  const resp = await runDebate(req(), allowNoFb, { planner, runItems, readOutput });

  assert.equal(resp.status, "degraded");
  assert.equal(calls.length, 1); // no fallback round
});
