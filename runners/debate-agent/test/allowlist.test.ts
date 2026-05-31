// Allowlist config loading tests.

import assert from "node:assert/strict";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { AllowlistError, DEFAULT_ALLOWLIST, loadAllowlist, repoRootMatch } from "../src/allowlist";
import { cleanup, makeTempDir } from "./helpers";

test("missing path returns closed default", () => {
  const allow = loadAllowlist(null);
  assert.deepEqual(allow.repoRoots, []);
});

test("nonexistent file returns default", () => {
  const allow = loadAllowlist("/no/such/file.json");
  assert.equal(allow, DEFAULT_ALLOWLIST);
});

test("loads and resolves repo roots", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(
      cfg,
      JSON.stringify({ repo_roots: [d], modes: ["debate-proposal"], providers: ["claude"], limits: { max_batch_items: 5 } }),
    );
    const allow = loadAllowlist(cfg);
    assert.deepEqual(allow.repoRoots, [realpathSync(d)]);
    assert.deepEqual(allow.providers, ["claude"]);
    assert.equal(allow.maxBatchItems, 5);
  } finally {
    cleanup(d);
  }
});

test("unsupported provider raises", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify({ providers: ["evilcli"] }));
    assert.throws(() => loadAllowlist(cfg), AllowlistError);
  } finally {
    cleanup(d);
  }
});

test("relative repo root raises", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify({ repo_roots: ["relative/dir"] }));
    assert.throws(() => loadAllowlist(cfg), AllowlistError);
  } finally {
    cleanup(d);
  }
});

test("claude profile config rejected", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify({ profiles: { claude: ["work"] } }));
    assert.throws(
      () => loadAllowlist(cfg),
      (err) => err instanceof AllowlistError && /claude profiles are not supported/.test(err.message),
    );
  } finally {
    cleanup(d);
  }
});

test("codex profile config ok", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify({ repo_roots: [d], profiles: { codex: ["work"] } }));
    const allow = loadAllowlist(cfg);
    assert.deepEqual(allow.profiles.codex, ["work"]);
  } finally {
    cleanup(d);
  }
});

// --- malformed shapes must fail closed, not be coerced ---------------------
// Regression for the "string passes Array.includes() as a substring match"
// class of bug: a non-array `modes`/`providers`/`repo_roots`, a non-object
// `profiles`/`limits`, or a non-numeric limit must all raise AllowlistError.

function expectShapeError(config: unknown, pattern: RegExp) {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify(config));
    assert.throws(
      () => loadAllowlist(cfg),
      (err) => err instanceof AllowlistError && pattern.test(err.message),
    );
  } finally {
    cleanup(d);
  }
}

test("malformed modes (string not array) is rejected, not coerced", () => {
  // Without the guard this is kept as a string and `"debate-proposal".includes(mode)`
  // becomes a substring match — silently widening the allowlist.
  expectShapeError({ repo_roots: [], modes: "debate-proposal" }, /modes must be an array of strings/);
});

test("malformed providers (string not array) is rejected", () => {
  expectShapeError({ providers: "claude" }, /providers must be an array of strings/);
});

test("malformed repo_roots (string not array) is rejected", () => {
  expectShapeError({ repo_roots: "/tmp" }, /repo_roots must be an array of strings/);
});

test("array with non-string entries is rejected", () => {
  expectShapeError({ modes: ["ok", 7] }, /modes must be an array of strings/);
});

test("malformed profiles (non-object) is rejected", () => {
  expectShapeError({ profiles: "codex" }, /profiles must be a JSON object/);
});

test("malformed profile names (string not array) is rejected", () => {
  expectShapeError({ profiles: { codex: "work" } }, /profiles\.codex must be an array of strings/);
});

test("malformed limits (non-object) is rejected", () => {
  expectShapeError({ limits: "fast" }, /limits must be a JSON object/);
});

test("non-numeric limit value is rejected", () => {
  expectShapeError({ limits: { max_batch_items: "lots" } }, /limits\.max_batch_items must be a number/);
});

test("default allowlist is read-only and carries batch limits", () => {
  assert.deepEqual(DEFAULT_ALLOWLIST.capabilities, ["read_only_review"]);
  assert.equal(DEFAULT_ALLOWLIST.maxBatchItems, 8);
  assert.equal(DEFAULT_ALLOWLIST.maxParallelPerProvider, 2);
});

test("copilot is opt-in: not in default providers", () => {
  assert.deepEqual(DEFAULT_ALLOWLIST.providers, ["claude", "codex"]);
  assert.ok(!DEFAULT_ALLOWLIST.providers.includes("copilot"));
});

test("copilot can be enabled by configuring providers", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify({ repo_roots: [d], providers: ["claude", "codex", "copilot"] }));
    assert.deepEqual(loadAllowlist(cfg).providers, ["claude", "codex", "copilot"]);
  } finally {
    cleanup(d);
  }
});

test("copilot profile config rejected (only codex has profiles)", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify({ profiles: { copilot: ["x"] } }));
    assert.throws(
      () => loadAllowlist(cfg),
      (err) => err instanceof AllowlistError && /copilot profiles are not supported/.test(err.message),
    );
  } finally {
    cleanup(d);
  }
});

test("capabilities can be locked to read-only", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify({ repo_roots: [d], capabilities: ["read_only_review"] }));
    assert.deepEqual(loadAllowlist(cfg).capabilities, ["read_only_review"]);
  } finally {
    cleanup(d);
  }
});

test("unsupported capability in config rejected", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify({ capabilities: ["root"] }));
    assert.throws(
      () => loadAllowlist(cfg),
      (err) => err instanceof AllowlistError && /capability/.test(err.message),
    );
  } finally {
    cleanup(d);
  }
});

test("batch limits parsed from config", () => {
  const d = makeTempDir();
  try {
    const cfg = join(d, "allowlist.json");
    writeFileSync(cfg, JSON.stringify({ repo_roots: [d], limits: { max_batch_items: 3, max_parallel: 2, max_parallel_per_provider: 1 } }));
    const allow = loadAllowlist(cfg);
    assert.equal(allow.maxBatchItems, 3);
    assert.equal(allow.maxParallel, 2);
    assert.equal(allow.maxParallelPerProvider, 1);
  } finally {
    cleanup(d);
  }
});

test("repo root match", () => {
  const allow = { ...DEFAULT_ALLOWLIST, repoRoots: ["/a/b"] };
  assert.equal(repoRootMatch(allow, "/a/b/c/d"), "/a/b");
  assert.equal(repoRootMatch(allow, "/a/b"), "/a/b");
  assert.equal(repoRootMatch(allow, "/somewhere/else"), null);
});
