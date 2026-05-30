// Audit integrity tests: uniqueness and root containment.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { writeExecutionAudit } from "../src/audit";
import { cleanup, makeTempDir } from "./helpers";

let auditHome: string;

beforeEach(() => {
  auditHome = makeTempDir();
  process.env.AGENT_RUNNER_AUDIT_HOME = auditHome;
});

afterEach(() => {
  delete process.env.AGENT_RUNNER_AUDIT_HOME;
  cleanup(auditHome);
});

test("same-second launches are distinct and both survive", () => {
  const p1 = writeExecutionAudit({
    runId: "r1",
    record: { note: "FIRST" },
    phase: "proposal_generation",
    provider: "claude",
  });
  const p2 = writeExecutionAudit({
    runId: "r1",
    record: { note: "SECOND" },
    phase: "proposal_generation",
    provider: "claude",
  });
  assert.notEqual(p1.audit_path, p2.audit_path);
  assert.ok(readFileSync(p1.audit_path, "utf8").includes("FIRST"));
  assert.ok(readFileSync(p2.audit_path, "utf8").includes("SECOND"));
});

test("many writes all unique", () => {
  const paths = new Set<string>();
  for (let i = 0; i < 50; i++) {
    paths.add(writeExecutionAudit({ runId: "r1", record: { i }, phase: "other", provider: "codex" }).audit_path);
  }
  assert.equal(paths.size, 50);
});

test("escape run_id blocked at audit layer", () => {
  for (const bad of ["..", "../escape"]) {
    assert.throws(() => writeExecutionAudit({ runId: bad, record: { x: 1 }, phase: "other", provider: "none" }), /escapes the audit root/);
  }
});

test("pre-existing symlink run dir is blocked (symlink escape)", () => {
  // Lexical '..' checks don't catch this: a symlink at <root>/<runId> pointing
  // outside would otherwise be followed when writing the audit file.
  const escape = makeTempDir();
  try {
    // Create the symlink at the realpath'd root (matches what resolveRunDir sees).
    symlinkSync(escape, join(realpathSync(auditHome), "r1"));
    assert.throws(
      () => writeExecutionAudit({ runId: "r1", record: { x: 1 }, phase: "other", provider: "none" }),
      /symlink/,
    );
    // Nothing leaked into the escape target.
    assert.deepEqual(readdirSync(escape), []);
  } finally {
    cleanup(escape);
  }
});

test("stdout/stderr share unique stem with yaml", () => {
  const p = writeExecutionAudit({
    runId: "r1",
    record: { x: 1 },
    stdout: "OUT",
    stderr: "ERR",
    phase: "critique",
    provider: "claude",
  });
  assert.ok(p.stdout_path && p.stderr_path);
  assert.equal(readFileSync(p.stdout_path, "utf8"), "OUT");
  const stem = basename(p.audit_path).replace(/\.yaml$/, "");
  assert.ok(basename(p.stdout_path).startsWith(stem));
});
