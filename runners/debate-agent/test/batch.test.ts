// run-batch: envelope validation + parallel execution with a stub binary.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { runBatchFile } from "../src/runner";
import { RequestRejected, validateBatchEnvelope } from "../src/schema";
import { CLAUDE_STUB, cleanup, makeAllowlist, makeRequest, makeStub, makeTempDir } from "./helpers";

// --- envelope validation (no execution) ------------------------------------

test("batch envelope: too many items rejected (whole batch)", () => {
  const d = makeTempDir();
  try {
    const allow = makeAllowlist(d, { maxBatchItems: 2 });
    const items = [1, 2, 3].map((n) => ({ item_id: `P${n}`, request: makeRequest(d) }));
    assert.throws(
      () => validateBatchEnvelope({ schema_version: 1, batch_id: "b1", items }, allow),
      (err) => err instanceof RequestRejected && /max_batch_items/.test(err.message),
    );
  } finally {
    cleanup(d);
  }
});

test("batch envelope: duplicate item_id rejected", () => {
  const d = makeTempDir();
  try {
    const allow = makeAllowlist(d);
    const items = [
      { item_id: "P1", request: makeRequest(d) },
      { item_id: "P1", request: makeRequest(d) },
    ];
    assert.throws(
      () => validateBatchEnvelope({ schema_version: 1, batch_id: "b1", items }, allow),
      /duplicate item_id/,
    );
  } finally {
    cleanup(d);
  }
});

test("batch envelope: unknown field rejected", () => {
  const d = makeTempDir();
  try {
    const allow = makeAllowlist(d);
    assert.throws(
      () => validateBatchEnvelope({ schema_version: 1, batch_id: "b1", items: [], oops: 1 }, allow),
      /unknown batch field/,
    );
  } finally {
    cleanup(d);
  }
});

// --- execution -------------------------------------------------------------

let root: string;
let repo: string;
let binDir: string;
let allow: ReturnType<typeof makeAllowlist>;

beforeEach(() => {
  root = makeTempDir();
  repo = join(root, "repo");
  mkdirSync(repo);
  binDir = join(root, "bin");
  mkdirSync(binDir);
  process.env.DEBATE_AGENT_AUDIT_HOME = join(root, "audit");
  makeStub(binDir, "claude", CLAUDE_STUB);
  makeStub(binDir, "codex", CLAUDE_STUB); // same stub stands in for codex
  allow = makeAllowlist(repo);
});

afterEach(() => {
  delete process.env.DEBATE_AGENT_AUDIT_HOME;
  cleanup(root);
});

function env(): Record<string, string> {
  return { PATH: `${binDir}:${process.env.PATH ?? ""}`, HOME: root };
}

function writeBatchFile(items: Array<{ item_id: string; request: Record<string, unknown> }>, envelope: Record<string, unknown> = {}): string {
  const p = join(root, "batch.json");
  writeFileSync(p, JSON.stringify({ schema_version: 1, batch_id: "20260530-batch", items, ...envelope }));
  return p;
}

test("batch runs all items, results in input order", async () => {
  const items = [
    { item_id: "P1", request: makeRequest(repo, { provider: "codex", run_id: "r1" }) },
    { item_id: "P2", request: makeRequest(repo, { provider: "claude", run_id: "r1" }) },
  ];
  const result = await runBatchFile(writeBatchFile(items), allow, env());
  assert.equal(result.status, "completed");
  assert.equal(result.item_count, 2);
  const out = result.items as Array<Record<string, unknown>>;
  assert.equal(out[0]!.item_id, "P1");
  assert.equal(out[1]!.item_id, "P2");
  assert.ok(out.every((it) => it.status === "completed"));
});

test("one invalid item degrades the batch; valid items still run", async () => {
  const items = [
    { item_id: "P1", request: makeRequest(repo, { run_id: "r1" }) },
    { item_id: "P2", request: makeRequest(repo, { run_id: "r1", provider: "copilot" }) }, // invalid provider
  ];
  const result = await runBatchFile(writeBatchFile(items), allow, env());
  assert.equal(result.status, "degraded");
  const out = result.items as Array<Record<string, unknown>>;
  assert.equal(out[0]!.status, "completed");
  assert.equal(out[1]!.status, "rejected");
  assert.match(out[1]!.reject_reason as string, /provider/);
});

test("capability passthrough per item", async () => {
  const items = [
    { item_id: "P1", request: makeRequest(repo, { run_id: "r1", capability: "workspace_write" }) },
  ];
  const result = await runBatchFile(writeBatchFile(items), allow, env());
  const out = result.items as Array<Record<string, unknown>>;
  assert.equal(out[0]!.capability, "workspace_write");
});

test("whole-batch reject when envelope invalid (no items run)", async () => {
  const p = join(root, "batch.json");
  writeFileSync(p, JSON.stringify({ schema_version: 2, batch_id: "b1", items: [] }));
  const result = await runBatchFile(p, allow, env());
  assert.equal(result.status, "rejected");
  assert.equal(result.kind, "batch");
});
