// In-process launch test using a stubbed CLI binary (no real claude/codex).

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { compilePatterns } from "../src/ratelimit";
import { execute, extractClaudeStreamResult, extractCodexJsonResult, runRequestFile } from "../src/runner";
import { CLAUDE_STUB, cleanup, makeAllowlist, makeMarkerStub, makeStub, makeTempDir, writeRequest } from "./helpers";

const RATE_LIMIT_STUB =
  "#!/usr/bin/env bash\n" + "cat >/dev/null\n" + "printf 'Error: usage limit reached (HTTP 429)\\n' >&2\n" + "exit 1\n";

test("extractClaudeStreamResult: final result event, else raw fallback", () => {
  // a stream-json transcript: assistant events + a final result event
  const stream = [
    '{"type":"system","subtype":"init"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Red"}]}}',
    '{"type":"result","subtype":"success","result":"Red\\nYellow\\nBlue"}',
  ].join("\n");
  assert.equal(extractClaudeStreamResult(stream), "Red\nYellow\nBlue");
  // not a stream (e.g. a plain stub) — returned verbatim
  assert.equal(extractClaudeStreamResult("PROPOSAL-TEXT"), "PROPOSAL-TEXT");
  assert.equal(extractClaudeStreamResult("CWD=/r\nARGS=x\nSTDIN=y"), "CWD=/r\nARGS=x\nSTDIN=y");
});

test("extractCodexJsonResult: final JSONL answer, else raw fallback", () => {
  assert.equal(
    extractCodexJsonResult(
      [
        '{"type":"session.started","session_id":"s"}',
        '{"type":"response.output_text.delta","delta":"ignored partial"}',
        '{"type":"result","result":"Final answer\\n"}',
      ].join("\n"),
    ),
    "Final answer\n",
  );
  assert.equal(
    extractCodexJsonResult(
      [
        '{"type":"item.completed","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Final "},{"type":"output_text","text":"answer"}]}}',
      ].join("\n"),
    ),
    "Final answer",
  );
  assert.equal(extractCodexJsonResult("CWD=/r\nARGS=x\nSTDIN=y"), "CWD=/r\nARGS=x\nSTDIN=y");
});

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

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
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

test("live stream sink is private", async () => {
  makeStub(binDir, "streamer", "#!/bin/sh\necho STREAM-OUT\n");
  const streamPath = join(root, "stream.log");
  const result = await execute(
    {
      provider: "test",
      baseProvider: "test",
      model: null,
      argv: ["streamer"],
      displayCommand: "streamer",
      stdin: "",
      promptTransport: "stdin",
      cwd: repo,
      env: { PATH: binDir },
      strippedEnvKeys: [],
      providerEnvSource: null,
      injectedEnvKeys: [],
    },
    30,
    streamPath,
  );

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(readFileSync(streamPath, "utf8"), "STREAM-OUT\n");
  assert.equal(modeOf(streamPath), 0o600);
});

test("claude provider env file is injected and audited without trusting parent secrets", async () => {
  makeStub(binDir, "claude", "#!/usr/bin/env bash\nenv\n");
  mkdirSync(join(repo, ".debate-agent"), { recursive: true });
  writeFileSync(join(repo, ".debate-agent", "env"), "ANTHROPIC_API_KEY=project-key\nANTHROPIC_MODEL=project-model\n");

  const reqPath = join(root, "request.json");
  writeRequest(reqPath, repo, { run_id: "20260606-claude-env", timeout_seconds: 30 });
  const result = await runRequestFile(reqPath, allow, {
    ...env(),
    HOME: root,
    ANTHROPIC_API_KEY: "parent-key",
  });

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.deepEqual(result.injected_env_keys, ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"]);
  assert.equal(result.provider_env_source, join(realpathSync(repo), ".debate-agent", "env"));
  assert.ok((result.stripped_env_keys as string[]).includes("ANTHROPIC_API_KEY"));

  const stdout = readFileSync(result.stdout_path as string, "utf8");
  assert.match(stdout, /^ANTHROPIC_API_KEY=project-key$/m);
  assert.match(stdout, /^ANTHROPIC_MODEL=project-model$/m);
  assert.ok(!stdout.includes("parent-key"));

  const audit = readFileSync(result.audit_path as string, "utf8");
  assert.ok(audit.includes("provider_env_source:"));
  assert.ok(audit.includes("injected_env_keys:"));
  assert.ok(!audit.includes("project-key"));
});

test("codex json worker stream is cleaned before audit stdout", async () => {
  makeStub(
    binDir,
    "codex",
    [
      "#!/usr/bin/env bash",
      "cat >/dev/null",
      'printf \'{"type":"session.started"}\\n\'',
      'printf \'{"type":"result","result":"CODEX FINAL"}\\n\'',
    ].join("\n") + "\n",
  );

  const reqPath = join(root, "request.json");
  writeRequest(reqPath, repo, { provider: "codex", run_id: "20260606-codex-json", timeout_seconds: 30 });
  const result = await runRequestFile(reqPath, allow, env());

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.ok((result.display_command as string).includes("--json"));
  const stdout = readFileSync(result.stdout_path as string, "utf8");
  assert.equal(stdout, "CODEX FINAL");
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

test("a non-zero failure matching a signature is reclassified rate_limited (real runValidated path)", async () => {
  // This exercises the ACTUAL detection chain in runValidated (not the injected
  // error_category the orchestrator tests use): a real child exits non-zero with a
  // limit signature on stderr, and the runner relabels it from the configured
  // patterns. Detection is opt-in, so with empty patterns it stays nonzero_exit.
  makeStub(binDir, "claude", RATE_LIMIT_STUB);
  const reqPath = join(root, "request.json");
  writeRequest(reqPath, repo, { timeout_seconds: 30 });

  // patterns off (the default makeAllowlist) => ordinary failure
  const plain = await runRequestFile(reqPath, allow, env());
  assert.equal(plain.status, "error");
  assert.equal(plain.error_category, "nonzero_exit");

  // patterns on => reclassified
  const withPatterns = makeAllowlist(repo, {
    rateLimitPatterns: { claude: compilePatterns(["usage limit", "\\b429\\b"]), codex: [], copilot: [] },
  });
  const limited = await runRequestFile(reqPath, withPatterns, env());
  assert.equal(limited.status, "error");
  assert.equal(limited.error_category, "rate_limited");
});
