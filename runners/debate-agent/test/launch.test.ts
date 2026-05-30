// Static argv shape and env allowlist tests.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChildEnv, buildChildLaunch } from "../src/launch";

test("secrets dropped, PATH kept", () => {
  const base = {
    PATH: "/usr/bin",
    HOME: "/Users/me",
    LC_CTYPE: "UTF-8",
    XDG_CONFIG_HOME: "/Users/me/.config",
    ANTHROPIC_API_KEY: "sk-secret",
    OPENAI_API_KEY: "sk-secret2",
    GH_TOKEN: "ghp_x",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    CLAUDE_CONFIG_DIR: "/Users/me/.claude-other",
    RANDOM_UNLISTED: "x",
  };
  const { env, stripped } = buildChildEnv(base);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/Users/me");
  assert.ok("LC_CTYPE" in env);
  assert.ok("XDG_CONFIG_HOME" in env);
  for (const secret of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GH_TOKEN", "SSH_AUTH_SOCK", "CLAUDE_CONFIG_DIR"]) {
    assert.ok(!(secret in env), `${secret} leaked into child env`);
  }
  // unlisted non-secret also not copied (allowlist, not denylist)
  assert.ok(!("RANDOM_UNLISTED" in env));
  for (const secret of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GH_TOKEN", "SSH_AUTH_SOCK"]) {
    assert.ok(stripped.includes(secret));
  }
});

test("claude argv has no prompt in argv", () => {
  const launch = buildChildLaunch({
    provider: "claude",
    cwd: "/repo",
    profile: null,
    capability: "read_only_review",
    prompt: "SECRET PROMPT",
    baseEnv: { PATH: "/usr/bin" },
  });
  assert.equal(launch.argv[0], "claude");
  assert.ok(launch.argv.includes("--print"));
  assert.ok(launch.argv.includes("--permission-mode"));
  assert.ok(!launch.argv.includes("SECRET PROMPT"));
  assert.equal(launch.stdin, "SECRET PROMPT");
  assert.ok(launch.displayCommand.includes("<stdin-prompt>"));
  assert.ok(!launch.displayCommand.includes("SECRET PROMPT"));
});

test("codex argv uses stdin dash and cwd", () => {
  const launch = buildChildLaunch({
    provider: "codex",
    cwd: "/repo/sub",
    profile: null,
    capability: "read_only_review",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin" },
  });
  assert.equal(launch.argv[0], "codex");
  assert.ok(launch.argv.includes("exec"));
  assert.ok(launch.argv.includes("--sandbox"));
  assert.equal(launch.argv[launch.argv.length - 1], "-");
  assert.ok(launch.argv.includes("/repo/sub"));
  assert.equal(launch.cwd, "/repo/sub");
});

test("codex profile inserted statically", () => {
  const launch = buildChildLaunch({
    provider: "codex",
    cwd: "/repo",
    profile: "work",
    capability: "read_only_review",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin" },
  });
  const i = launch.argv.indexOf("--profile");
  assert.ok(i >= 0);
  assert.equal(launch.argv[i + 1], "work");
});

test("read_only_review: codex read-only sandbox, no network override", () => {
  const launch = buildChildLaunch({
    provider: "codex",
    cwd: "/repo",
    profile: null,
    capability: "read_only_review",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin" },
  });
  const i = launch.argv.indexOf("--sandbox");
  assert.equal(launch.argv[i + 1], "read-only");
  assert.ok(!launch.argv.some((a) => a.includes("network_access")));
});

test("workspace_write: codex writable sandbox with network", () => {
  const launch = buildChildLaunch({
    provider: "codex",
    cwd: "/repo",
    profile: null,
    capability: "workspace_write",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin" },
  });
  const i = launch.argv.indexOf("--sandbox");
  assert.equal(launch.argv[i + 1], "workspace-write");
  assert.ok(launch.argv.some((a) => a.includes("sandbox_workspace_write.network_access=true")));
});

test("claude permission-mode follows capability", () => {
  const ro = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  assert.equal(ro.argv[ro.argv.indexOf("--permission-mode") + 1], "default");
  const rw = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "workspace_write", prompt: "P", baseEnv: {} });
  assert.equal(rw.argv[rw.argv.indexOf("--permission-mode") + 1], "acceptEdits");
});

test("claude profile is a hard error", () => {
  assert.throws(
    () =>
      buildChildLaunch({
        provider: "claude",
        cwd: "/repo",
        profile: "work",
        capability: "read_only_review",
        prompt: "P",
        baseEnv: { PATH: "/usr/bin" },
      }),
    /claude profile is not supported/,
  );
});

test("copilot read_only_review: denies write/shell, prompt in -p argv (not stdin)", () => {
  const launch = buildChildLaunch({
    provider: "copilot",
    cwd: "/repo",
    profile: null,
    capability: "read_only_review",
    prompt: "SECRET PROMPT",
    baseEnv: { PATH: "/usr/bin" },
  });
  assert.equal(launch.argv[0], "copilot");
  assert.equal(launch.promptTransport, "argv");
  assert.ok(launch.argv.includes("--deny-tool=write"));
  assert.ok(launch.argv.includes("--deny-tool=shell"));
  // never grant broad access
  assert.ok(!launch.argv.some((a) => a.startsWith("--allow-all")));
  assert.ok(!launch.argv.includes("--allow-tool=write"));
  // cwd set, prompt bound to a single -p element
  assert.equal(launch.argv[launch.argv.indexOf("-C") + 1], "/repo");
  assert.equal(launch.argv[launch.argv.indexOf("-p") + 1], "SECRET PROMPT");
  // prompt redacted in display; never as a stdin marker
  assert.ok(launch.displayCommand.includes("<prompt>"));
  assert.ok(!launch.displayCommand.includes("SECRET PROMPT"));
  assert.ok(!launch.displayCommand.includes("<stdin-prompt>"));
});

test("copilot workspace_write: allows write scoped to cwd, still denies shell", () => {
  const launch = buildChildLaunch({
    provider: "copilot",
    cwd: "/repo",
    profile: null,
    capability: "workspace_write",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin" },
  });
  assert.ok(launch.argv.includes("--allow-tool=write"));
  assert.ok(launch.argv.includes("--deny-tool=shell"));
  assert.equal(launch.argv[launch.argv.indexOf("--add-dir") + 1], "/repo");
  assert.ok(!launch.argv.some((a) => a.startsWith("--allow-all")));
});

test("copilot profile is a hard error", () => {
  assert.throws(
    () =>
      buildChildLaunch({
        provider: "copilot",
        cwd: "/repo",
        profile: "x",
        capability: "read_only_review",
        prompt: "P",
        baseEnv: { PATH: "/usr/bin" },
      }),
    /copilot profile is not supported/,
  );
});

test("COPILOT_ALLOW_ALL is stripped from child env", () => {
  const { env, stripped } = buildChildEnv({ PATH: "/usr/bin", COPILOT_ALLOW_ALL: "1" });
  assert.ok(!("COPILOT_ALLOW_ALL" in env));
  assert.ok(stripped.includes("COPILOT_ALLOW_ALL"));
});
