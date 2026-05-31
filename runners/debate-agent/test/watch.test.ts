// Mailbox primitives + the daemon's request→response loop, deterministic via a
// scripted planner and stub workers (injected makeDeps). No real LLM/CLI.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { DebateDeps } from "../src/debate";
import {
  MailboxRequestRejected,
  claimRequest,
  loadRequestObject,
  openMailbox,
  snapshotRequestIds,
  validateDebateRequest,
  writeResponse,
} from "../src/mailbox";
import { PlannerFn } from "../src/planner";
import { BatchItemResult } from "../src/runner";
import { processNewRequests, recoverOrphans, watchLoop } from "../src/watch";
import { cleanup, makeAllowlist, makeTempDir } from "./helpers";

let root: string;
let repo: string;
let allow: ReturnType<typeof makeAllowlist>;

beforeEach(() => {
  root = makeTempDir();
  repo = join(root, "repo");
  mkdirSync(repo);
  process.env.DEBATE_AGENT_MAILBOX = join(root, "mailbox");
  allow = makeAllowlist(repo, { modes: ["debate-proposal", "debate-critique", "debate-cross-review"] });
});

afterEach(() => {
  delete process.env.DEBATE_AGENT_MAILBOX;
  cleanup(root);
});

function writeRequestFile(id: string, overrides: Record<string, unknown> = {}): void {
  const mb = openMailbox();
  writeFileSync(
    join(mb.requestsDir, `${id}.json`),
    JSON.stringify({ schema_version: 1, id, kind: "debate_request", prompt: "debate this", repo: realpathSync(repo), ...overrides }),
  );
}

const onePhasePlan = JSON.stringify({
  phases: [{ name: "proposal_generation", launches: [{ id: "P1", provider: "codex", prompt: "go" }] }],
  answer_item: "P1",
});

/** Scripted planner + stub workers (with embedded output). */
function stubDeps(): { makeDeps: () => DebateDeps; planTexts: string[] } {
  const planTexts: string[] = [];
  const planner: PlannerFn = async () => {
    planTexts.push(onePhasePlan);
    return onePhasePlan;
  };
  const runItems: DebateDeps["runItems"] = async (items) =>
    items.map((it): BatchItemResult =>
      it.rejected !== undefined
        ? { item_id: it.itemId, status: "rejected", reject_reason: it.rejected }
        : { item_id: it.itemId, status: "completed", provider: it.req!.provider },
    );
  const readOutput = (r: BatchItemResult): string => `ANSWER-${r.item_id}`;
  return { makeDeps: () => ({ planner, runItems, readOutput }), planTexts };
}

// --- mailbox primitives ----------------------------------------------------

test("validateDebateRequest accepts a good request and defaults", () => {
  const r = validateDebateRequest({ schema_version: 1, id: "r1", kind: "debate_request", prompt: "x", repo: realpathSync(repo) }, allow);
  assert.equal(r.id, "r1");
  assert.equal(r.repo, realpathSync(repo));
  assert.equal(r.language, null);
  assert.equal(r.fast, false);
});

test("validateDebateRequest accepts language + fast, rejects bad shapes", () => {
  const r = validateDebateRequest({ schema_version: 1, id: "r1", kind: "debate_request", prompt: "x", repo: realpathSync(repo), language: "中文", fast: true }, allow);
  assert.equal(r.language, "中文");
  assert.equal(r.fast, true);
  const base = { schema_version: 1, id: "r1", kind: "debate_request", prompt: "x", repo: realpathSync(repo) };
  assert.throws(() => validateDebateRequest({ ...base, fast: "yes" }, allow), /fast must be a boolean/);
  assert.throws(() => validateDebateRequest({ ...base, kind: "run_batch_request" }, allow), /kind must be/);
  assert.throws(() => validateDebateRequest({ ...base, oops: 1 }, allow), MailboxRequestRejected);
  assert.throws(() => validateDebateRequest({ ...base, repo: "/etc" }, allow), MailboxRequestRejected);
  assert.throws(() => validateDebateRequest({ ...base, id: "../escape" }, allow), MailboxRequestRejected);
});

test("payload id mismatching the file name becomes an error response", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  writeFileSync(
    join(mb.requestsDir, "fileid.json"),
    JSON.stringify({ schema_version: 1, id: "otherid", kind: "debate_request", prompt: "x", repo: realpathSync(repo) }),
  );
  const { makeDeps } = stubDeps();
  await processNewRequests(mb, ignore, allow, { makeDeps });
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "fileid.json"), "utf8"));
  assert.equal(resp.status, "error");
  assert.match(resp.status_reason, /does not match file name/);
});

test("watchLoop fails closed when the planner provider is not allowlisted", async () => {
  const onlyCodex = makeAllowlist(repo, { providers: ["codex"] });
  await assert.rejects(() => watchLoop(onlyCodex, { plannerProvider: "claude" }), /planner provider claude is not in the allowlist/);
});

test("claim is atomic: second claim returns null", () => {
  const mb = openMailbox();
  writeRequestFile("r1");
  assert.ok(claimRequest(mb, "r1"));
  assert.equal(claimRequest(mb, "r1"), null);
});

test("snapshot ignores pre-existing requests", async () => {
  const mb = openMailbox();
  writeRequestFile("old");
  const ignore = snapshotRequestIds(mb);
  const { makeDeps } = stubDeps();
  const processed = await processNewRequests(mb, ignore, allow, { makeDeps });
  assert.deepEqual(processed, []);
  assert.ok(!existsSync(join(mb.responsesDir, "old.json")));
});

// --- end-to-end loop -------------------------------------------------------

test("processes a new request: plans, executes, writes a matching response", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  writeRequestFile("20260531-e2e");
  const { makeDeps, planTexts } = stubDeps();

  const processed = await processNewRequests(mb, ignore, allow, { makeDeps });

  assert.deepEqual(processed, ["20260531-e2e"]);
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "20260531-e2e.json"), "utf8"));
  assert.equal(resp.request_id, "20260531-e2e");
  assert.equal(resp.kind, "debate_result");
  assert.equal(resp.status, "completed");
  assert.equal(resp.answer_markdown, "ANSWER-P1");
  assert.ok(Array.isArray(resp.trace) && resp.trace.length === 1);
  assert.equal(planTexts.length, 1); // the planner was consulted
  assert.ok(!existsSync(join(mb.requestsDir, "20260531-e2e.json")));
  assert.ok(!existsSync(join(mb.processingDir, "20260531-e2e.json")), "processing entry cleared");
  // the request is preserved in archive/ (durable record), not deleted
  assert.ok(existsSync(join(mb.archiveDir, "20260531-e2e.json")), "request archived");
});

test("a malformed request becomes an error response (never hangs)", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  writeFileSync(join(mb.requestsDir, "bad.json"), JSON.stringify({ schema_version: 1, id: "bad", kind: "debate_request", prompt: "x", repo: "/not/allowed" }));
  const { makeDeps } = stubDeps();
  await processNewRequests(mb, ignore, allow, { makeDeps });
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "bad.json"), "utf8"));
  assert.equal(resp.status, "error");
  assert.equal(resp.request_id, "bad");
});

test("orphaned processing/ request is recovered as an error response on startup", () => {
  const mb = openMailbox();
  writeFileSync(
    join(mb.processingDir, "orphan.json"),
    JSON.stringify({ schema_version: 1, id: "orphan", kind: "debate_request", prompt: "x", repo: realpathSync(repo) }),
  );
  const recovered = recoverOrphans(mb);
  assert.deepEqual(recovered, ["orphan"]);
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "orphan.json"), "utf8"));
  assert.equal(resp.status, "error");
  assert.match(resp.status_reason, /in flight/);
  assert.ok(!existsSync(join(mb.processingDir, "orphan.json")), "processing entry cleared");
  assert.ok(existsSync(join(mb.archiveDir, "orphan.json")), "orphan request archived");
  assert.ok(existsSync(join(mb.responsesDir, "orphan.log")), "progress log written");
});

test("processNewRequests re-reads the allowlist per request via reloadAllow", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  const repo2 = join(root, "repo2");
  mkdirSync(repo2);
  const expanded = makeAllowlist(repo2, { modes: ["debate-proposal", "debate-critique", "debate-cross-review"] });
  writeFileSync(
    join(mb.requestsDir, "r2.json"),
    JSON.stringify({ schema_version: 1, id: "r2", kind: "debate_request", prompt: "x", repo: realpathSync(repo2) }),
  );
  // the plan runs a worker in repo2, which only the expanded allowlist permits
  const planner: PlannerFn = async () => onePhasePlan;
  const runItems: DebateDeps["runItems"] = async (items) => items.map((it): BatchItemResult => ({ item_id: it.itemId, status: "completed", provider: it.req!.provider }));
  const makeDeps = (): DebateDeps => ({ planner, runItems, readOutput: () => "OK" });
  const processed = await processNewRequests(mb, ignore, allow, { makeDeps, reloadAllow: () => expanded });
  assert.deepEqual(processed, ["r2"]);
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "r2.json"), "utf8"));
  assert.equal(resp.status, "completed");
});

test("loadRequestObject round-trips; writeResponse is atomic and id-named", () => {
  const mb = openMailbox();
  writeRequestFile("r1");
  assert.equal(loadRequestObject(join(mb.requestsDir, "r1.json")).kind, "debate_request");
  const p = writeResponse(mb, "r9", { status: "completed" });
  assert.ok(p.endsWith("/r9.json"));
  assert.equal(JSON.parse(readFileSync(p, "utf8")).status, "completed");
});
