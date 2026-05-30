// In-process launch test using a stubbed CLI binary (no real claude/codex).

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { runRequestFile } from "../src/runner";
import { CLAUDE_STUB, cleanup, makeAllowlist, makeMarkerStub, makeStub, makeTempDir, writeRequest } from "./helpers";

let root: string;
let repo: string;
let binDir: string;
let auditHome: string;
let allow: ReturnType<typeof makeAllowlist>;

beforeEach(() => {
  root = makeTempDir();
  repo = join(root, "repo");
  mkdirSync(repo);
  binDir = join(root, "bin");
  mkdirSync(binDir);
  auditHome = join(root, "audit");
  process.env.DEBATE_AGENT_AUDIT_HOME = auditHome;
  makeStub(binDir, "claude", CLAUDE_STUB);
  allow = makeAllowlist(repo);
});

afterEach(() => {
  delete process.env.DEBATE_AGENT_AUDIT_HOME;
  cleanup(root);
});

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    HOME: root,
    ANTHROPIC_API_KEY: "sk-should-be-stripped",
    ...extra,
  };
}

test("successful launch records audit and transports prompt on stdin", async () => {
  const reqPath = join(root, "request.json");
  writeRequest(reqPath, repo, { run_id: "20260530-e2e", timeout_seconds: 30 });
  const result = await runRequestFile(reqPath, allow, env());

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.returncode, 0);
  assert.ok((result.stripped_env_keys as string[]).includes("ANTHROPIC_API_KEY"));

  const stdout = readFileSync(result.stdout_path as string, "utf8");
  assert.ok(stdout.includes(`CWD=${realpathSync(repo)}`));
  assert.ok(stdout.includes("STDIN=PROMPT-MARKER-XYZ"));
  const argsLine = stdout.split("\n").find((l) => l.startsWith("ARGS="))!;
  assert.ok(!argsLine.includes("PROMPT-MARKER-XYZ"));

  const audit = readFileSync(result.audit_path as string, "utf8");
  assert.ok((result.audit_path as string).includes("20260530-e2e"));
  assert.ok(audit.includes("request_digest:"));
  assert.ok(audit.includes("status: completed"));
});

test("rejected request does not launch", async () => {
  const reqPath = join(root, "request.json");
  writeRequest(reqPath, repo, { provider: "copilot" });
  const result = await runRequestFile(reqPath, allow, env());
  assert.equal(result.status, "rejected");
  assert.equal(result.error_category, "rejected");
  assert.ok((result.reject_reason as string).includes("provider"));
});

test("rejected request never spawns the child (negative proof)", async () => {
  // claude is an allowed, launchable provider (has a stub); the mode is not.
  // Rejection therefore happens after provider resolution — exactly where a
  // spawn-then-reject regression would already have launched the child.
  const marker = join(root, "launched.marker");
  makeMarkerStub(binDir, "claude", marker); // overwrite the CLAUDE_STUB
  const reqPath = join(root, "request.json");
  writeRequest(reqPath, repo, { mode: "not-an-allowed-mode" });

  const result = await runRequestFile(reqPath, allow, env());

  assert.equal(result.status, "rejected");
  assert.ok((result.reject_reason as string).includes("mode"));
  assert.ok(!existsSync(marker), "no child should be launched for a rejected request");
});

test("missing cli reported", async () => {
  // Clean PATH = only the stub bin dir (has claude, not codex).
  const reqPath = join(root, "request.json");
  writeRequest(reqPath, repo, { provider: "codex" });
  const result = await runRequestFile(reqPath, allow, env({ PATH: binDir }));
  assert.equal(result.status, "error");
  assert.equal(result.error_category, "missing_cli");
});
