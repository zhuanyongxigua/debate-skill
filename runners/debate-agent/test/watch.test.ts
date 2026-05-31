// Mailbox primitives + the daemon's request→response loop, deterministic via
// injected deps (scripted brain + stub workers). No real LLM/CLI.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { BrainFn } from "../src/brain";
import { DebateDeps } from "../src/debate";
import {
  DebateRequestRejected,
  claimRequest,
  loadDebateRequest,
  openMailbox,
  snapshotRequestIds,
  validateDebateRequest,
  writeResponse,
} from "../src/mailbox";
import { BatchItemResult, PreparedItem } from "../src/runner";
import { processNewRequests, recoverOrphans, watchLoop } from "../src/watch";
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

function stubDeps(): { makeDeps: () => DebateDeps; calls: PreparedItem[][] } {
  const calls: PreparedItem[][] = [];
  const runItems: DebateDeps["runItems"] = async (items) => {
    calls.push(items);
    return items.map((it): BatchItemResult => {
      const p = join(outDir, `${it.itemId}-${calls.length}.txt`);
      writeFileSync(p, `out-${it.itemId}`);
      return { item_id: it.itemId, status: "completed", provider: it.req!.provider, stdout_path: p };
    });
  };
  const brain: BrainFn = async (state) => {
    if (state.history.length === 0) {
      return { kind: "run", phase: "proposal_generation", launches: [{ id: "P1", provider: "codex", prompt: "go" }] };
    }
    return { kind: "final", status: "completed", answer_markdown: "ANSWER" };
  };
  return { makeDeps: () => ({ brain, runItems }), calls };
}

// --- mailbox primitives ----------------------------------------------------

test("validateDebateRequest accepts a good request", () => {
  const req = validateDebateRequest(
    { schema_version: 1, id: "r1", kind: "debate_request", prompt: "x", repo: realpathSync(repo) },
    allow,
  );
  assert.equal(req.id, "r1");
  assert.equal(req.repo, realpathSync(repo));
  assert.equal(req.language, null); // defaults
  assert.equal(req.fast, false);
});

test("validateDebateRequest accepts language + fast", () => {
  const req = validateDebateRequest(
    { schema_version: 1, id: "r1", kind: "debate_request", prompt: "x", repo: realpathSync(repo), language: "中文", fast: true },
    allow,
  );
  assert.equal(req.language, "中文");
  assert.equal(req.fast, true);
});

test("validateDebateRequest rejects a non-boolean fast", () => {
  assert.throws(
    () => validateDebateRequest({ schema_version: 1, id: "r1", kind: "debate_request", prompt: "x", repo: realpathSync(repo), fast: "yes" }, allow),
    /fast must be a boolean/,
  );
});

test("validateDebateRequest rejects unknown field / outside repo / bad id", () => {
  const base = { schema_version: 1, id: "r1", kind: "debate_request", prompt: "x", repo: realpathSync(repo) };
  assert.throws(() => validateDebateRequest({ ...base, oops: 1 }, allow), DebateRequestRejected);
  assert.throws(() => validateDebateRequest({ ...base, repo: "/etc" }, allow), DebateRequestRejected);
  assert.throws(() => validateDebateRequest({ ...base, id: "../escape" }, allow), DebateRequestRejected);
  assert.throws(() => validateDebateRequest({ ...base, kind: "nope" }, allow), /kind must be/);
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

test("watchLoop fails closed when the brain provider is not allowlisted", async () => {
  const onlyCodex = makeAllowlist(repo, { providers: ["codex"] });
  await assert.rejects(
    () => watchLoop(onlyCodex, { brainProvider: "claude" }),
    /brain provider claude is not in the allowlist/,
  );
});

test("claim is atomic: second claim returns null", () => {
  const mb = openMailbox();
  writeRequestFile("r1");
  assert.ok(claimRequest(mb, "r1"));
  assert.equal(claimRequest(mb, "r1"), null);
});

test("snapshot ignores pre-existing requests", async () => {
  const mb = openMailbox();
  writeRequestFile("old"); // exists before snapshot
  const ignore = snapshotRequestIds(mb);
  const { makeDeps } = stubDeps();
  const processed = await processNewRequests(mb, ignore, allow, { makeDeps });
  assert.deepEqual(processed, []); // pre-existing request is not processed
  assert.ok(!existsSync(join(mb.responsesDir, "old.json")));
});

// --- end-to-end loop -------------------------------------------------------

test("processes a new request: writes a matching response", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb); // empty
  writeRequestFile("20260531-e2e");
  const { makeDeps, calls } = stubDeps();

  const processed = await processNewRequests(mb, ignore, allow, { makeDeps });

  assert.deepEqual(processed, ["20260531-e2e"]);
  const respPath = join(mb.responsesDir, "20260531-e2e.json");
  assert.ok(existsSync(respPath), "response file written");
  const resp = JSON.parse(readFileSync(respPath, "utf8"));
  assert.equal(resp.request_id, "20260531-e2e");
  assert.equal(resp.status, "completed");
  assert.match(resp.answer_markdown, /ANSWER/);
  // runner-built process summary (Trace) from the actual launches
  assert.match(resp.answer_markdown, /## Trace/);
  assert.ok(Array.isArray(resp.cli_participation) && resp.cli_participation.length >= 1);
  // request was claimed out of the inbox
  assert.ok(!existsSync(join(mb.requestsDir, "20260531-e2e.json")));
  // the worker ran read-only
  assert.equal(calls[0]![0]!.req!.capability, "read_only_review");
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
  // simulate a crash mid-flight: a claimed request sits in processing/ with no response
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
  assert.ok(existsSync(join(mb.responsesDir, "orphan.log")), "progress log written");
});

test("processNewRequests re-reads the allowlist per request via reloadAllow", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  // A second repo the base `allow` does NOT permit, but the reloaded one does.
  const repo2 = join(root, "repo2");
  mkdirSync(repo2);
  const expanded = makeAllowlist(repo2, { modes: ["debate-proposal", "debate-critique", "debate-cross-review"] });
  writeFileSync(
    join(mb.requestsDir, "r2.json"),
    JSON.stringify({ schema_version: 1, id: "r2", kind: "debate_request", prompt: "x", repo: realpathSync(repo2) }),
  );
  const { makeDeps } = stubDeps();
  // base `allow` (repoRoots=[repo]) would reject repo2; reloadAllow returns the
  // expanded allowlist (repoRoots=[repo2]) so the request is accepted.
  const processed = await processNewRequests(mb, ignore, allow, { makeDeps, reloadAllow: () => expanded });
  assert.deepEqual(processed, ["r2"]);
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "r2.json"), "utf8"));
  assert.equal(resp.status, "completed");
});

test("loadDebateRequest round-trips a written request", () => {
  const mb = openMailbox();
  writeRequestFile("r1");
  const raw = loadDebateRequest(join(mb.requestsDir, "r1.json"));
  assert.equal(raw.id, "r1");
});

test("writeResponse is atomic and id-named", () => {
  const mb = openMailbox();
  const p = writeResponse(mb, "r1", { status: "completed" });
  assert.ok(p.endsWith("/r1.json"));
  assert.equal(JSON.parse(readFileSync(p, "utf8")).status, "completed");
});
