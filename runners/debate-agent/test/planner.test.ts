// The claude structured-output extractor (reads the plan out of the
// `--output-format json` envelope), plus the CLI planner's provider rotation on a
// rate limit — driven by an injected `exec`, so no real CLI runs.

import assert from "node:assert/strict";
import { test } from "node:test";

import { ChildLaunch } from "../src/launch";
import { DebateRequest } from "../src/mailbox";
import { extractClaudeStructuredOutput, makeCliPlanner, planWithRetry } from "../src/planner";
import { compilePatterns } from "../src/ratelimit";
import { ExecResult } from "../src/runner";
import { cleanup, makeAllowlist, makeTempDir } from "./helpers";

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

// --- CLI planner provider rotation on a rate limit (injected exec) ----------

const VALID_PLAN = JSON.stringify({
  phases: [{ name: "proposal_generation", launches: [{ id: "P1", provider: "codex", prompt: "do the task" }] }],
  answer_item: "P1",
});
const RL_PATTERNS = { claude: compilePatterns(["usage limit", "\\b429\\b"]), codex: compilePatterns(["usage limit", "\\b429\\b"]) };
const RL: ExecResult = { status: "error", errorCategory: "nonzero_exit", returncode: 1, elapsedSeconds: 0, stdout: "", stderr: "usage limit reached (429)" };
const ok = (stdout: string): ExecResult => ({ status: "completed", errorCategory: null, returncode: 0, elapsedSeconds: 0, stdout, stderr: "" });

function plannerReq(repo: string): DebateRequest {
  return { id: "d1", prompt: "decide", repo, repoRoot: repo, language: null, fast: false };
}

test("planner rotates to the next provider when the primary is rate-limited", async () => {
  const root = makeTempDir();
  try {
    const allow = makeAllowlist(root);
    const seen: string[] = [];
    const exec = async (launch: ChildLaunch): Promise<ExecResult> => {
      seen.push(launch.provider);
      return launch.provider === "claude" ? RL : ok(VALID_PLAN);
    };
    const planner = makeCliPlanner(root, { providers: ["claude", "codex"], rateLimitPatterns: RL_PATTERNS, exec });
    const plan = await planWithRetry(plannerReq(root), allow, planner, 4);
    assert.deepEqual(seen, ["claude", "codex"]); // claude limited → rotate to codex
    assert.equal(plan.answerItem, "P1");
  } finally {
    cleanup(root);
  }
});

test("all planner providers rate-limited fails fast — no wasted attempts", async () => {
  const root = makeTempDir();
  try {
    const allow = makeAllowlist(root);
    let execCalls = 0;
    const exec = async (_launch: ChildLaunch): Promise<ExecResult> => {
      execCalls++;
      return RL;
    };
    const planner = makeCliPlanner(root, { providers: ["claude", "codex"], rateLimitPatterns: RL_PATTERNS, exec });
    await assert.rejects(() => planWithRetry(plannerReq(root), allow, planner, 4), /rate-limited/);
    assert.equal(execCalls, 2, "should call exec once per provider, then stop (not spin to maxAttempts=4)");
  } finally {
    cleanup(root);
  }
});

test("rotation composes with invalid-plan retry within the attempt budget", async () => {
  const root = makeTempDir();
  try {
    const allow = makeAllowlist(root);
    let codexCalls = 0;
    const exec = async (launch: ChildLaunch): Promise<ExecResult> => {
      if (launch.provider === "claude") return RL; // exhaust claude first
      codexCalls++;
      return ok(codexCalls === 1 ? "this is not a plan" : VALID_PLAN); // invalid, then valid
    };
    const planner = makeCliPlanner(root, { providers: ["claude", "codex"], rateLimitPatterns: RL_PATTERNS, exec });
    const plan = await planWithRetry(plannerReq(root), allow, planner, 4);
    assert.equal(plan.answerItem, "P1");
    assert.equal(codexCalls, 2); // first codex plan invalid → retried on the same (rotated) provider
  } finally {
    cleanup(root);
  }
});

// --- claude resumable session (fix the plan in-context, not regenerate) -------

test("claude planner creates a named session, then resumes it on an invalid retry", async () => {
  const root = makeTempDir();
  try {
    const allow = makeAllowlist(root);
    const launches: ChildLaunch[] = [];
    let n = 0;
    const exec = async (launch: ChildLaunch): Promise<ExecResult> => {
      launches.push(launch);
      n++;
      return ok(n === 1 ? "not a valid plan" : VALID_PLAN); // first invalid → retry, then valid
    };
    const planner = makeCliPlanner(root, { providers: ["claude", "codex"], rateLimitPatterns: RL_PATTERNS, exec });
    const plan = await planWithRetry(plannerReq(root), allow, planner, 4);
    assert.equal(plan.answerItem, "P1");
    assert.equal(launches.length, 2);
    // first attempt: fresh named session
    assert.ok(launches[0]!.argv.includes("--session-id"));
    assert.ok(!launches[0]!.argv.includes("--resume"));
    const id = launches[0]!.argv[launches[0]!.argv.indexOf("--session-id") + 1];
    // retry: resume the SAME session, not a new one
    assert.ok(launches[1]!.argv.includes("--resume"));
    assert.ok(!launches[1]!.argv.includes("--session-id"));
    assert.equal(launches[1]!.argv[launches[1]!.argv.indexOf("--resume") + 1], id);
  } finally {
    cleanup(root);
  }
});

test("a resume that does not fix the plan falls back to a fresh regeneration (no resume loop)", async () => {
  const root = makeTempDir();
  try {
    const allow = makeAllowlist(root);
    const launches: ChildLaunch[] = [];
    let n = 0;
    const exec = async (launch: ChildLaunch): Promise<ExecResult> => {
      launches.push(launch);
      n++;
      // attempt 1 invalid, attempt 2 (resume) STILL invalid, attempt 3 (fresh) valid
      return ok(n <= 2 ? "still not a plan" : VALID_PLAN);
    };
    const planner = makeCliPlanner(root, { providers: ["claude", "codex"], rateLimitPatterns: RL_PATTERNS, exec });
    const plan = await planWithRetry(plannerReq(root), allow, planner, 4);
    assert.equal(plan.answerItem, "P1");
    assert.equal(launches.length, 3);
    assert.ok(launches[0]!.argv.includes("--session-id")); // fresh
    assert.ok(launches[1]!.argv.includes("--resume")); // one resume
    assert.ok(launches[2]!.argv.includes("--session-id")); // resume didn't fix it → fresh again
    const id1 = launches[0]!.argv[launches[0]!.argv.indexOf("--session-id") + 1];
    const id3 = launches[2]!.argv[launches[2]!.argv.indexOf("--session-id") + 1];
    assert.notEqual(id3, id1); // a genuinely new session, not the stale one
  } finally {
    cleanup(root);
  }
});

test("rate-limit rotation starts the fallback engine fresh; codex never gets a session flag", async () => {
  const root = makeTempDir();
  try {
    const allow = makeAllowlist(root);
    const launches: ChildLaunch[] = [];
    const exec = async (launch: ChildLaunch): Promise<ExecResult> => {
      launches.push(launch);
      return launch.provider === "claude" ? RL : ok(VALID_PLAN);
    };
    const planner = makeCliPlanner(root, { providers: ["claude", "codex"], rateLimitPatterns: RL_PATTERNS, exec });
    const plan = await planWithRetry(plannerReq(root), allow, planner, 4);
    assert.equal(plan.answerItem, "P1");
    // the claude attempt opened a fresh session but was never resumed (it failed)
    const claudeLaunch = launches.find((l) => l.provider === "claude")!;
    assert.ok(claudeLaunch.argv.includes("--session-id"));
    assert.ok(!claudeLaunch.argv.includes("--resume"));
    // codex (the fallback engine) carries no session flags at all
    const codexLaunch = launches.find((l) => l.provider === "codex")!;
    assert.ok(!codexLaunch.argv.includes("--session-id"));
    assert.ok(!codexLaunch.argv.includes("--resume"));
  } finally {
    cleanup(root);
  }
});
