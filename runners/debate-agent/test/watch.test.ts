// Mailbox primitives + the daemon's request→response loop, deterministic via an
// injected worker executor (stub runItems). No real LLM/CLI.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  MailboxRequestRejected,
  claimRequest,
  loadRequestObject,
  openMailbox,
  snapshotRequestIds,
  validateRunBatchRequest,
  writeResponse,
} from "../src/mailbox";
import { BatchDeps } from "../src/mailbox-batch";
import { BatchItemResult, PreparedItem } from "../src/runner";
import { processNewRequests, recoverOrphans } from "../src/watch";
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
    JSON.stringify({
      schema_version: 1,
      id,
      kind: "run_batch_request",
      repo: realpathSync(repo),
      items: [{ item_id: "P1", provider: "codex", prompt: "go", phase: "proposal_generation" }],
      ...overrides,
    }),
  );
}

/** A stub worker executor that records what it was asked to run and writes a fake
 * stdout file per item (so the embedded-output path is exercised). */
function stubDeps(): { opts: BatchDeps; calls: PreparedItem[][] } {
  const calls: PreparedItem[][] = [];
  const runItems: BatchDeps["runItems"] = async (items) => {
    calls.push(items);
    return items.map((it): BatchItemResult => {
      if (it.rejected !== undefined) return { item_id: it.itemId, status: "rejected", reject_reason: it.rejected };
      const p = join(outDir, `${it.itemId}-${calls.length}.txt`);
      writeFileSync(p, `out-${it.itemId}`);
      return { item_id: it.itemId, status: "completed", provider: it.req!.provider, stdout_path: p };
    });
  };
  return { opts: { runItems }, calls };
}

// --- mailbox primitives ----------------------------------------------------

test("validateRunBatchRequest accepts a good request", () => {
  const req = validateRunBatchRequest(
    {
      schema_version: 1,
      id: "r1",
      kind: "run_batch_request",
      repo: realpathSync(repo),
      items: [{ item_id: "P1", provider: "codex", prompt: "x" }],
    },
    allow,
  );
  assert.equal(req.id, "r1");
  assert.equal(req.repo, realpathSync(repo));
  assert.equal(req.fast, false); // defaults
  assert.equal(req.maxParallel, null);
  assert.equal(req.items[0]!.phase, "other"); // default
});

test("validateRunBatchRequest accepts fast + phase + timeout", () => {
  const req = validateRunBatchRequest(
    {
      schema_version: 1,
      id: "r1",
      kind: "run_batch_request",
      repo: realpathSync(repo),
      fast: true,
      items: [{ item_id: "P1", provider: "codex", prompt: "x", phase: "critique", timeout_seconds: 120 }],
    },
    allow,
  );
  assert.equal(req.fast, true);
  assert.equal(req.items[0]!.phase, "critique");
  assert.equal(req.items[0]!.timeoutSeconds, 120);
});

test("validateRunBatchRequest rejects a non-boolean fast", () => {
  assert.throws(
    () =>
      validateRunBatchRequest(
        { schema_version: 1, id: "r1", kind: "run_batch_request", repo: realpathSync(repo), fast: "yes", items: [{ item_id: "P1", provider: "codex", prompt: "x" }] },
        allow,
      ),
    /fast must be a boolean/,
  );
});

test("validateRunBatchRequest rejects bad kind / unknown field / outside repo / bad id", () => {
  const base = { schema_version: 1, id: "r1", kind: "run_batch_request", repo: realpathSync(repo), items: [{ item_id: "P1", provider: "codex", prompt: "x" }] };
  assert.throws(() => validateRunBatchRequest({ ...base, kind: "debate_request" }, allow), /kind must be/);
  assert.throws(() => validateRunBatchRequest({ ...base, oops: 1 }, allow), MailboxRequestRejected);
  assert.throws(() => validateRunBatchRequest({ ...base, repo: "/etc" }, allow), MailboxRequestRejected);
  assert.throws(() => validateRunBatchRequest({ ...base, id: "../escape" }, allow), MailboxRequestRejected);
});

test("validateRunBatchRequest rejects bad items: empty, dup id, unknown provider, blank prompt, unknown field", () => {
  const base = { schema_version: 1, id: "r1", kind: "run_batch_request", repo: realpathSync(repo) };
  assert.throws(() => validateRunBatchRequest({ ...base, items: [] }, allow), /at least one launch/);
  assert.throws(
    () => validateRunBatchRequest({ ...base, items: [{ item_id: "P1", provider: "codex", prompt: "x" }, { item_id: "P1", provider: "codex", prompt: "y" }] }, allow),
    /duplicate item_id/,
  );
  assert.throws(() => validateRunBatchRequest({ ...base, items: [{ item_id: "P1", provider: "gemini", prompt: "x" }] }, allow), /not in allowlist providers/);
  assert.throws(() => validateRunBatchRequest({ ...base, items: [{ item_id: "P1", provider: "codex", prompt: "  " }] }, allow), /non-empty string/);
  assert.throws(() => validateRunBatchRequest({ ...base, items: [{ item_id: "P1", provider: "codex", prompt: "x", oops: 1 }] }, allow), /unknown field/);
  assert.throws(() => validateRunBatchRequest({ ...base, items: [{ item_id: "P1", provider: "codex", prompt: "x", phase: "nope" }] }, allow), /phase .* invalid/);
});

test("payload id mismatching the file name becomes an error response", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  writeFileSync(
    join(mb.requestsDir, "fileid.json"),
    JSON.stringify({ schema_version: 1, id: "otherid", kind: "run_batch_request", repo: realpathSync(repo), items: [{ item_id: "P1", provider: "codex", prompt: "x" }] }),
  );
  const { opts } = stubDeps();
  await processNewRequests(mb, ignore, allow, opts);
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "fileid.json"), "utf8"));
  assert.equal(resp.status, "error");
  assert.match(resp.status_reason, /does not match file name/);
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
  const { opts } = stubDeps();
  const processed = await processNewRequests(mb, ignore, allow, opts);
  assert.deepEqual(processed, []); // pre-existing request is not processed
  assert.ok(!existsSync(join(mb.responsesDir, "old.json")));
});

// --- end-to-end loop -------------------------------------------------------

test("processes a new request: writes a matching response with embedded output, read-only", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb); // empty
  writeRequestFile("20260531-e2e");
  const { opts, calls } = stubDeps();

  const processed = await processNewRequests(mb, ignore, allow, opts);

  assert.deepEqual(processed, ["20260531-e2e"]);
  const respPath = join(mb.responsesDir, "20260531-e2e.json");
  assert.ok(existsSync(respPath), "response file written");
  const resp = JSON.parse(readFileSync(respPath, "utf8"));
  assert.equal(resp.request_id, "20260531-e2e");
  assert.equal(resp.kind, "run_batch_result");
  assert.equal(resp.status, "completed");
  assert.equal(resp.items.length, 1);
  assert.equal(resp.items[0].provider, "codex");
  assert.match(resp.items[0].output, /out-P1/); // worker stdout embedded
  // request was claimed out of the inbox + cleared from processing/
  assert.ok(!existsSync(join(mb.requestsDir, "20260531-e2e.json")));
  assert.ok(!existsSync(join(mb.processingDir, "20260531-e2e.json")), "processing entry cleared");
  // the worker request was forced read-only and got the requested provider
  assert.equal(calls[0]![0]!.req!.capability, "read_only_review");
  assert.equal(calls[0]![0]!.req!.provider, "codex");
});

test("a malformed request becomes an error response (never hangs)", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  writeFileSync(
    join(mb.requestsDir, "bad.json"),
    JSON.stringify({ schema_version: 1, id: "bad", kind: "run_batch_request", repo: "/not/allowed", items: [{ item_id: "P1", provider: "codex", prompt: "x" }] }),
  );
  const { opts } = stubDeps();
  await processNewRequests(mb, ignore, allow, opts);
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "bad.json"), "utf8"));
  assert.equal(resp.status, "error");
  assert.equal(resp.request_id, "bad");
});

test("a per-item rejection degrades the batch but still completes the others", async () => {
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  // P2 uses a provider not in the allowlist → rejected item; P1 still runs.
  writeFileSync(
    join(mb.requestsDir, "mix.json"),
    JSON.stringify({
      schema_version: 1,
      id: "mix",
      kind: "run_batch_request",
      repo: realpathSync(repo),
      items: [
        { item_id: "P1", provider: "codex", prompt: "x" },
        { item_id: "P2", provider: "codex", prompt: "x" },
      ],
    }),
  );
  // Stub that completes P1 and fails P2 to prove "one bad item degrades, not fails".
  const runItems: BatchDeps["runItems"] = async (items) =>
    items.map((it): BatchItemResult =>
      it.itemId === "P2"
        ? { item_id: it.itemId, status: "error", provider: "codex", error_category: "nonzero_exit" }
        : { item_id: it.itemId, status: "completed", provider: "codex", stdout_path: join(outDir, "p1.txt") },
    );
  writeFileSync(join(outDir, "p1.txt"), "ok-P1");
  await processNewRequests(mb, ignore, allow, { runItems });
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "mix.json"), "utf8"));
  assert.equal(resp.status, "degraded");
  assert.equal(resp.items.length, 2);
  assert.equal(resp.items[0].status, "completed");
  assert.equal(resp.items[1].status, "error");
});

test("orphaned processing/ request is recovered as an error response on startup", () => {
  const mb = openMailbox();
  // simulate a crash mid-flight: a claimed request sits in processing/ with no response
  writeFileSync(
    join(mb.processingDir, "orphan.json"),
    JSON.stringify({ schema_version: 1, id: "orphan", kind: "run_batch_request", repo: realpathSync(repo), items: [{ item_id: "P1", provider: "codex", prompt: "x" }] }),
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
    JSON.stringify({ schema_version: 1, id: "r2", kind: "run_batch_request", repo: realpathSync(repo2), items: [{ item_id: "P1", provider: "codex", prompt: "x" }] }),
  );
  const { opts } = stubDeps();
  // base `allow` (repoRoots=[repo]) would reject repo2; reloadAllow returns the
  // expanded allowlist (repoRoots=[repo2]) so the request is accepted.
  const processed = await processNewRequests(mb, ignore, allow, { ...opts, reloadAllow: () => expanded });
  assert.deepEqual(processed, ["r2"]);
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, "r2.json"), "utf8"));
  assert.equal(resp.status, "completed");
});

test("loadRequestObject round-trips a written request", () => {
  const mb = openMailbox();
  writeRequestFile("r1");
  const raw = loadRequestObject(join(mb.requestsDir, "r1.json"));
  assert.equal(raw.id, "r1");
  assert.equal(raw.kind, "run_batch_request");
});

test("writeResponse is atomic and id-named", () => {
  const mb = openMailbox();
  const p = writeResponse(mb, "r1", { status: "completed" });
  assert.ok(p.endsWith("/r1.json"));
  assert.equal(JSON.parse(readFileSync(p, "utf8")).status, "completed");
});
