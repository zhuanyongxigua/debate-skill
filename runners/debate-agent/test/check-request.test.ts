// Pins the debate-router skill's request-file checker
// (skills/debate-router/scripts/check-request.mjs) to the daemon's request
// format, and proves the checker actually catches a malformed request. If the
// daemon's ALLOWED_DEBATE_FIELDS changes without updating the skill checker, the
// first test fails — enforcing the AGENTS.md "keep them in sync" rule.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { ALLOWED_DEBATE_FIELDS } from "../src/mailbox";

// dist/test -> ../../../.. -> repo root -> skills/debate-router/scripts/...
const SCRIPT = resolve(__dirname, "..", "..", "..", "..", "skills", "debate-router", "scripts", "check-request.mjs");

test("the skill checker exists and its ALLOWED set matches the daemon's", () => {
  assert.ok(existsSync(SCRIPT), `skill checker not found at ${SCRIPT}`);
  const src = readFileSync(SCRIPT, "utf8");
  const m = src.match(/const ALLOWED = (\[[^\]]*\]);/);
  assert.ok(m, "could not find `const ALLOWED = [...]` in the skill checker");
  const scriptAllowed: string[] = JSON.parse(m![1]!);
  // Same set as the daemon's validateDebateRequest — drift here means the skill
  // checker (and SKILL.md's Mode 2 example) need updating. See AGENTS.md.
  assert.deepEqual([...scriptAllowed].sort(), [...ALLOWED_DEBATE_FIELDS].sort());
});

function runChecker(obj: unknown): { status: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "dr-check-"));
  try {
    const f = join(dir, "req.json");
    writeFileSync(f, JSON.stringify(obj));
    const p = spawnSync(process.execPath, [SCRIPT, f], { encoding: "utf8" });
    return { status: p.status ?? -1, stderr: p.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the skill checker accepts a valid request and rejects the stale output_contract field", () => {
  const good = {
    schema_version: 1,
    id: "20260601-120000-x",
    kind: "debate_request",
    prompt: "debate this",
    repo: "/abs/repo",
    fast: false,
    planner_provider: "codex",
    providers: ["codex"],
  };
  assert.equal(runChecker(good).status, 0);
  assert.equal(runChecker({ ...good, fast: true }).status, 1);
  assert.equal(runChecker({ ...good, planner_provider: "claude" }).status, 1);
  const { providers: _providers, ...withoutProviders } = good;
  assert.equal(runChecker(withoutProviders).status, 0, "omitted providers defaults to codex");
  assert.equal(runChecker({ ...withoutProviders, planner_provider: "claude" }).status, 1);
  assert.equal(runChecker({ ...good, providers: ["codex", "codex"] }).status, 1);
  assert.equal(
    runChecker({ ...good, planner_provider: "claude-opus", providers: ["claude-opus", "codex-gpt52"] }).status,
    0,
    "checker accepts safe provider alias ids; daemon allowlist validates them later",
  );
  assert.equal(runChecker({ ...good, planner_provider: "bad space", providers: ["bad space"] }).status, 1);
  // the exact recurring mistake: a stale top-level output_contract field
  const bad = { ...good, output_contract: { format: "default" } };
  const r = runChecker(bad);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /output_contract|unknown field/);
});
