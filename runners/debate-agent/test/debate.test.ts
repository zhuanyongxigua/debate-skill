// The debate orchestrator: plan-with-retry + mechanical templated execution,
// driven by a scripted planner and stub workers (no real model/CLI).

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { DEFAULT_EFFORT } from "../src/allowlist";
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
  return {
    id: "d1",
    prompt: "debate this",
    repo,
    repoRoot: repo,
    language: null,
    fast: false,
    plannerProvider: null,
    providers: ["codex", "claude"],
    ...overrides,
  };
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
  complexity: "simple",
  phases: [
    { name: "proposal_generation", launches: [
      { id: "P1", provider: "codex", effort: "xhigh", prompt: "propose A" },
      { id: "P2", provider: "claude", effort: "high", prompt: "propose B" },
    ] },
    { name: "arbitration", launches: [
      { id: "A1", provider: "claude", effort: "high", prompt: "Proposals:\n{{P1.output}}\n---\n{{P2.output}}\nDecide and write the final answer." },
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
  const allowNoFallback = { ...allow, fallback: { enabled: false, order: ["claude", "codex"] } };
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
  const resp = await runDebate(req(), allowNoFallback, { planner, runItems, readOutput });
  assert.equal(resp.status, "degraded");
  // a failed upstream output substitutes as empty, debate still finishes
  const arbPrompt = calls[1]![0]!.req!.prompt;
  assert.match(arbPrompt, /Proposals:\nOUT\[P1\]\n---\n\nDecide/);
  assert.equal(resp.answer_markdown, "OUT[A1]");
});

test("a plan with a non-allowlisted provider rejects that launch and degrades", async () => {
  const badPlan = JSON.stringify({
    complexity: "simple",
    phases: [{ name: "proposal_generation", launches: [{ id: "P1", provider: "copilot", effort: "high", prompt: "x" }] }],
    answer_item: "P1",
  });
  // provider not in the allowlist => validatePlan rejects the whole plan => retry => error
  const planner: PlannerFn = async () => badPlan;
  const { runItems } = stubRun();
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput, maxPlanAttempts: 1 });
  assert.equal(resp.status, "error");
  assert.match(resp.status_reason, /not in allowlist/);
});

// --- provider fallback: same task, swap engine ------------------------------

const onePhaseClaudePlan = JSON.stringify({
  complexity: "simple",
  phases: [{ name: "proposal_generation", launches: [{ id: "P1", provider: "claude", effort: "high", prompt: "do the task" }] }],
  answer_item: "P1",
});

/** Stub workers that fail `failProviders` with `errorCategory` and complete the rest. */
function failureRun(
  failProviders: Set<string>,
  errorCategory = "rate_limited",
): { runItems: DebateDeps["runItems"]; calls: PreparedItem[][] } {
  const calls: PreparedItem[][] = [];
  const runItems: DebateDeps["runItems"] = async (items) => {
    calls.push(items);
    return items.map((it): BatchItemResult => {
      if (it.rejected !== undefined) return { item_id: it.itemId, status: "rejected", reject_reason: it.rejected };
      const provider = it.req!.provider;
      return failProviders.has(provider)
        ? { item_id: it.itemId, status: "error", provider, error_category: errorCategory }
        : { item_id: it.itemId, status: "completed", provider };
    });
  };
  return { runItems, calls };
}

test("a rate_limited worker is re-run on the next provider (same task, swap engine)", async () => {
  const planner: PlannerFn = async () => onePhaseClaudePlan;
  const { runItems, calls } = failureRun(new Set(["claude"])); // claude limited, codex ok
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput });

  assert.equal(resp.status, "completed");
  assert.equal(calls.length, 2); // initial (claude) + one fallback round (codex)
  assert.equal(calls[0]![0]!.req!.provider, "claude");
  assert.equal(calls[1]![0]!.req!.provider, "codex");
  // the SAME substituted prompt is reused verbatim on the swap
  assert.equal(calls[1]![0]!.req!.prompt, calls[0]![0]!.req!.prompt);
  // the planner's claude effort is dropped for codex's default on the swap
  assert.equal(calls[0]![0]!.req!.effort, DEFAULT_EFFORT.claude);
  assert.equal(calls[1]![0]!.req!.effort, DEFAULT_EFFORT.codex);
  // trace + answer reflect the substitute engine, and the swap is visible
  assert.deepEqual(resp.trace.map((t) => `${t.item}:${t.provider}:${t.status}`), ["P1:codex:completed"]);
  assert.equal(resp.trace[0]!.planned_provider, "claude"); // swap from the planned engine is recorded
  assert.equal(resp.answer_markdown, "OUT[P1]");
});

test("a nonzero_exit worker is re-run on the next provider (same task, swap engine)", async () => {
  const planner: PlannerFn = async () => onePhaseClaudePlan;
  const { runItems, calls } = failureRun(new Set(["claude"]), "nonzero_exit"); // e.g. cert/API failure
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput });

  assert.equal(resp.status, "completed");
  assert.equal(calls.length, 2); // initial (claude) + one fallback round (codex)
  assert.equal(calls[0]![0]!.req!.provider, "claude");
  assert.equal(calls[1]![0]!.req!.provider, "codex");
  assert.equal(calls[1]![0]!.req!.prompt, calls[0]![0]!.req!.prompt);
  assert.deepEqual(resp.trace.map((t) => `${t.item}:${t.provider}:${t.status}`), ["P1:codex:completed"]);
  assert.equal(resp.trace[0]!.planned_provider, "claude");
  assert.equal(resp.answer_markdown, "OUT[P1]");
});

test("when every provider is rate-limited the launch degrades (bounded, no infinite loop)", async () => {
  const planner: PlannerFn = async () => onePhaseClaudePlan;
  const { runItems, calls } = failureRun(new Set(["claude", "codex"]));
  const resp = await runDebate(req(), allow, { planner, runItems, readOutput });

  assert.equal(resp.status, "degraded");
  assert.equal(resp.answer_markdown, "");
  // initial + exactly one fallback round (then both providers tried => stop)
  assert.equal(calls.length, 2);
  // the degrade reason is visible in the trace, not only the log
  assert.equal(resp.trace[0]!.error_category, "rate_limited");
});

// --- fast path: skip the planner, run a fixed lean 2-phase shape -----------

test("a fast request skips the planner and runs the fixed lean 2-phase shape", async () => {
  // a planner that throws would turn the debate into an `error` response if it were
  // ever called — so a `completed` result proves the planner was skipped.
  const planner: PlannerFn = async () => {
    throw new Error("planner must NOT be called for a fast request");
  };
  const { runItems, calls } = stubRun();
  const resp = await runDebate(req({ fast: true, prompt: "REVIEW THIS TASK" }), allow, { planner, runItems, readOutput });

  assert.equal(resp.status, "completed");
  // fixed shape: phase 1 = P1 codex + P2 claude in parallel; phase 2 = A1 claude
  assert.deepEqual(resp.trace.map((t) => `${t.item}:${t.provider}`), ["P1:codex", "P2:claude", "A1:claude"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]!.map((it) => it.req!.provider), ["codex", "claude"]);
  assert.deepEqual(calls[1]!.map((it) => it.req!.provider), ["claude"]);
  // the generic reviewer prompt embeds the human's task verbatim
  assert.match(calls[0]![0]!.req!.prompt, /REVIEW THIS TASK/);
  // the arbiter prompt embeds both reviewers' outputs (mechanical {{id.output}})
  assert.match(calls[1]![0]!.req!.prompt, /OUT\[P1\][\s\S]*OUT\[P2\]/);
  assert.equal(resp.answer_markdown, "OUT[A1]");
});

test("the fast path still swaps engines on a rate limit", async () => {
  const planner: PlannerFn = async () => {
    throw new Error("planner must NOT be called for a fast request");
  };
  const { runItems } = failureRun(new Set(["codex"])); // P1 codex limited → fall back
  const resp = await runDebate(req({ fast: true }), allow, { planner, runItems, readOutput });
  assert.equal(resp.status, "completed");
  // P1 was planned codex but ran on claude after the swap
  const p1 = resp.trace.find((t) => t.item === "P1")!;
  assert.equal(p1.provider, "claude");
  assert.equal(p1.planned_provider, "codex");
});

test("the fast plan picks allowlisted providers (a narrowed allowlist degrades gracefully)", async () => {
  // only claude allowlisted → both reviewers + arbiter run on claude (no rejected/
  // empty reviewer from a hardcoded codex that isn't available).
  const claudeOnly = makeAllowlist(repo, { providers: ["claude"] });
  const planner: PlannerFn = async () => {
    throw new Error("planner must NOT be called for a fast request");
  };
  const { runItems } = stubRun();
  const resp = await runDebate(req({ fast: true }), claudeOnly, { planner, runItems, readOutput });
  assert.equal(resp.status, "completed");
  assert.deepEqual(resp.trace.map((t) => `${t.item}:${t.provider}`), ["P1:claude", "P2:claude", "A1:claude"]);
});

test("runDebate honors a codex-only request provider set even with a wider allowlist", async () => {
  const planner: PlannerFn = async () => {
    throw new Error("planner must NOT be called for a fast request");
  };
  const { runItems, calls } = stubRun();
  const resp = await runDebate(req({ fast: true, providers: ["codex"] }), allow, { planner, runItems, readOutput });
  assert.equal(resp.status, "completed");
  assert.deepEqual(resp.trace.map((t) => `${t.item}:${t.provider}`), ["P1:codex", "P2:codex", "A1:codex"]);
  assert.deepEqual(calls.flat().map((it) => it.req!.provider), ["codex", "codex", "codex"]);
  assert.deepEqual(calls.flat().map((it) => it.req!.effort), ["xhigh", "xhigh", "xhigh"]);
});

test("the fast plan escapes {{...}} in the user prompt (not mangled by substitute)", async () => {
  const planner: PlannerFn = async () => {
    throw new Error("planner must NOT be called for a fast request");
  };
  const { runItems, calls } = stubRun();
  await runDebate(req({ fast: true, prompt: "explain {{P1.output}} in the template" }), allow, { planner, runItems, readOutput });
  // the user's literal placeholder survives (escaped to `{ {`), not blanked away
  assert.match(calls[0]![0]!.req!.prompt, /\{ \{P1\.output\}\}/);
  assert.ok(!/explain\s+in the template/.test(calls[0]![0]!.req!.prompt), "user placeholder must not be substituted to empty");
});

test("fallback disabled leaves a rate_limited worker to degrade (no retry)", async () => {
  const allowNoFb = makeAllowlist(repo, {
    modes: ["debate-proposal", "debate-critique", "debate-cross-review"],
    fallback: { enabled: false, order: ["claude", "codex"] },
  });
  const planner: PlannerFn = async () => onePhaseClaudePlan;
  const { runItems, calls } = failureRun(new Set(["claude"]));
  const resp = await runDebate(req(), allowNoFb, { planner, runItems, readOutput });

  assert.equal(resp.status, "degraded");
  assert.equal(calls.length, 1); // no fallback round
});
