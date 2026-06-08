// Static argv shape and env allowlist tests.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildChildEnv, buildChildLaunch } from "../src/launch";

function withTempDir(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "dr-launch-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

test("claude provider env comes from project file before global file", () => {
  withTempDir((root) => {
    const repo = join(root, "repo");
    const home = join(root, "home");
    mkdirSync(join(repo, ".debate-agent"), { recursive: true });
    mkdirSync(join(home, ".config", "debate-agent"), { recursive: true });
    writeFileSync(
      join(repo, ".debate-agent", "env"),
      [
        "ANTHROPIC_API_KEY=project-key",
        'export ANTHROPIC_BASE_URL="https://project.example"',
        "PATH=/bad",
        "CLAUDE_CONFIG_DIR=/bad",
      ].join("\n"),
    );
    writeFileSync(join(home, ".config", "debate-agent", "env"), "ANTHROPIC_API_KEY=global-key\n");

    const launch = buildChildLaunch({
      provider: "claude",
      cwd: repo,
      profile: null,
      capability: "read_only_review",
      prompt: "P",
      baseEnv: { PATH: "/usr/bin", HOME: home, ANTHROPIC_API_KEY: "parent-key" },
    });

    assert.equal(launch.env.ANTHROPIC_API_KEY, "project-key");
    assert.equal(launch.env.ANTHROPIC_BASE_URL, "https://project.example");
    assert.equal(launch.env.PATH, "/usr/bin");
    assert.ok(!("CLAUDE_CONFIG_DIR" in launch.env));
    assert.equal(launch.providerEnvSource, join(repo, ".debate-agent", "env"));
    assert.deepEqual(launch.injectedEnvKeys, ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]);
    assert.ok(launch.strippedEnvKeys.includes("ANTHROPIC_API_KEY"));
  });
});

test("claude provider env falls back to global file and is not injected into codex", () => {
  withTempDir((root) => {
    const repo = join(root, "repo");
    const home = join(root, "home");
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(home, ".config", "debate-agent"), { recursive: true });
    writeFileSync(
      join(home, ".config", "debate-agent", "env"),
      "ANTHROPIC_MODEL=claude-test\nOPENAI_API_KEY=openai-test\n",
    );

    const claude = buildChildLaunch({
      provider: "claude",
      cwd: repo,
      profile: null,
      capability: "read_only_review",
      prompt: "P",
      baseEnv: { PATH: "/usr/bin", HOME: home },
    });
    assert.equal(claude.env.ANTHROPIC_MODEL, "claude-test");
    assert.ok(!("OPENAI_API_KEY" in claude.env));
    assert.equal(claude.providerEnvSource, join(home, ".config", "debate-agent", "env"));
    assert.deepEqual(claude.injectedEnvKeys, ["ANTHROPIC_MODEL"]);

    const codex = buildChildLaunch({
      provider: "codex",
      cwd: repo,
      profile: null,
      capability: "read_only_review",
      prompt: "P",
      baseEnv: { PATH: "/usr/bin", HOME: home },
    });
    assert.ok(!("OPENAI_API_KEY" in codex.env));
    assert.ok(!("ANTHROPIC_MODEL" in codex.env));
    assert.equal(codex.providerEnvSource, null);
    assert.deepEqual(codex.injectedEnvKeys, []);
  });
});

test("project claude provider env suppresses global fallback even with no allowed keys", () => {
  withTempDir((root) => {
    const repo = join(root, "repo");
    const home = join(root, "home");
    mkdirSync(join(repo, ".debate-agent"), { recursive: true });
    mkdirSync(join(home, ".config", "debate-agent"), { recursive: true });
    writeFileSync(join(repo, ".debate-agent", "env"), "PATH=/bad\nCLAUDE_CONFIG_DIR=/bad\n");
    writeFileSync(join(home, ".config", "debate-agent", "env"), "ANTHROPIC_MODEL=global-model\nOPENAI_API_KEY=global-key\n");

    const launch = buildChildLaunch({
      provider: "claude",
      cwd: repo,
      profile: null,
      capability: "read_only_review",
      prompt: "P",
      baseEnv: { PATH: "/usr/bin", HOME: home },
    });

    assert.ok(!("ANTHROPIC_MODEL" in launch.env));
    assert.equal(launch.providerEnvSource, join(repo, ".debate-agent", "env"));
    assert.deepEqual(launch.injectedEnvKeys, []);
  });
});

test("non-regular project claude provider env falls back to global file", () => {
  withTempDir((root) => {
    const repo = join(root, "repo");
    const home = join(root, "home");
    mkdirSync(join(repo, ".debate-agent"), { recursive: true });
    mkdirSync(join(home, ".config", "debate-agent"), { recursive: true });
    writeFileSync(join(root, "target.env"), "ANTHROPIC_MODEL=project-symlink-model\n");
    symlinkSync(join(root, "target.env"), join(repo, ".debate-agent", "env"));
    writeFileSync(join(home, ".config", "debate-agent", "env"), "ANTHROPIC_MODEL=global-model\n");

    const launch = buildChildLaunch({
      provider: "claude",
      cwd: repo,
      profile: null,
      capability: "read_only_review",
      prompt: "P",
      baseEnv: { PATH: "/usr/bin", HOME: home },
    });

    assert.equal(launch.env.ANTHROPIC_MODEL, "global-model");
    assert.equal(launch.providerEnvSource, join(home, ".config", "debate-agent", "env"));
    assert.deepEqual(launch.injectedEnvKeys, ["ANTHROPIC_MODEL"]);
  });
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
  assert.ok(launch.argv.includes('approval_policy="never"'));
  assert.ok(launch.argv.includes("--json"));
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

test("provider alias launch keeps alias id but uses base provider argv and model", () => {
  const claude = buildChildLaunch({
    provider: "claude-opus",
    baseProvider: "claude",
    model: "claude-opus-4-8",
    cwd: "/repo",
    profile: null,
    capability: "read_only_review",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin" },
  });
  assert.equal(claude.provider, "claude-opus");
  assert.equal(claude.baseProvider, "claude");
  assert.equal(claude.model, "claude-opus-4-8");
  assert.equal(claude.argv[0], "claude");
  assert.equal(claude.argv[claude.argv.indexOf("--model") + 1], "claude-opus-4-8");

  const codex = buildChildLaunch({
    provider: "codex-gpt52",
    baseProvider: "codex",
    model: "gpt-5.2-codex",
    cwd: "/repo",
    profile: "azure",
    capability: "read_only_review",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin" },
  });
  assert.equal(codex.provider, "codex-gpt52");
  assert.equal(codex.baseProvider, "codex");
  assert.equal(codex.argv[0], "codex");
  assert.equal(codex.argv[codex.argv.indexOf("--model") + 1], "gpt-5.2-codex");
  assert.equal(codex.argv[codex.argv.indexOf("--profile") + 1], "azure");

  const copilot = buildChildLaunch({
    provider: "copilot-gpt",
    baseProvider: "copilot",
    model: "gpt-5-mini",
    cwd: "/repo",
    profile: null,
    capability: "read_only_review",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin" },
  });
  assert.equal(copilot.provider, "copilot-gpt");
  assert.equal(copilot.baseProvider, "copilot");
  assert.equal(copilot.argv[0], "copilot");
  assert.equal(copilot.argv[copilot.argv.indexOf("--model") + 1], "gpt-5-mini");
});

test("built-in provider launch has no model unless allowlist alias resolves one", () => {
  const claude = buildChildLaunch({
    provider: "claude",
    cwd: "/repo",
    profile: null,
    capability: "read_only_review",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin" },
  });
  assert.equal(claude.baseProvider, "claude");
  assert.equal(claude.model, null);
  assert.ok(!claude.argv.includes("--model"));
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

test("claude read_only_review denies writes, allows read tools + read-only git", () => {
  const ro = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  // write tools denied (each its own argv element); Bash NOT broadly denied
  const di = ro.argv.indexOf("--disallowedTools");
  const ai = ro.argv.indexOf("--allowedTools");
  const denied = ro.argv.slice(di + 1, ai);
  assert.deepEqual(denied, ["Edit", "Write", "MultiEdit", "NotebookEdit"]);
  assert.ok(!denied.includes("Bash"), "Bash must not be broadly denied (we allow read-only git patterns)");
  // read tools + scoped read-only git allowed; the git patterns are intact (own elements)
  const allowed = ro.argv.slice(ai + 1).filter((a) => !a.startsWith("--"));
  for (const t of ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)"]) {
    assert.ok(allowed.includes(t), `${t} should be allowed`);
  }
  // no write/exec patterns leak into the allow list
  assert.ok(!allowed.some((a) => /Bash\((?!git )/.test(a)), "only read-only git Bash patterns are allowed");
  // workspace_write must NOT deny edits (it is allowed to write)
  const rw = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "workspace_write", prompt: "P", baseEnv: {} });
  assert.ok(!rw.argv.includes("--disallowedTools") && !rw.argv.includes("--allowedTools"));
});

test("claude remote_ops uses default permission mode with static allowed tools", () => {
  const launch = buildChildLaunch({
    provider: "claude",
    cwd: "/r",
    profile: null,
    capability: "remote_ops",
    prompt: "P",
    baseEnv: { PATH: "/usr/bin", SSH_AUTH_SOCK: "/tmp/agent.sock" },
    remoteOps: { allowedBashPatterns: ["ssh:*", "scp:*"], injectSshAuthSock: true },
  });
  assert.equal(launch.argv[launch.argv.indexOf("--permission-mode") + 1], "default");
  assert.ok(!launch.argv.includes("acceptEdits"));
  assert.ok(!launch.argv.includes("--disallowedTools"));
  const allowed = launch.argv.slice(launch.argv.indexOf("--allowedTools") + 1).filter((a) => !a.startsWith("--"));
  for (const tool of ["Read", "Grep", "Glob", "Edit", "Write", "MultiEdit", "Bash(ssh:*)", "Bash(scp:*)"]) {
    assert.ok(allowed.includes(tool), `${tool} should be allowed`);
  }
  assert.equal(launch.env.SSH_AUTH_SOCK, "/tmp/agent.sock");
  assert.ok(!launch.strippedEnvKeys.includes("SSH_AUTH_SOCK"));
  assert.ok(launch.injectedEnvKeys.includes("SSH_AUTH_SOCK"));
});

test("remote_ops fails closed without Bash patterns and for non-Claude providers", () => {
  assert.throws(
    () =>
      buildChildLaunch({
        provider: "claude",
        cwd: "/r",
        profile: null,
        capability: "remote_ops",
        prompt: "P",
        baseEnv: {},
        remoteOps: { allowedBashPatterns: [], injectSshAuthSock: false },
      }),
    /requires at least one/,
  );
  assert.throws(
    () =>
      buildChildLaunch({
        provider: "codex",
        cwd: "/r",
        profile: null,
        capability: "remote_ops",
        prompt: "P",
        baseEnv: {},
        remoteOps: { allowedBashPatterns: ["ssh:*"], injectSshAuthSock: false },
      }),
    /only supported for claude/,
  );
});

test("thinking effort is optional; codex defaults to profile config", () => {
  // Claude has no Codex-style profile knob, so the runner defaults it to high.
  const c = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  assert.equal(c.argv[c.argv.indexOf("--effort") + 1], "high");
  // An explicit effort is honored.
  const cx = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, effort: "xhigh" });
  assert.equal(cx.argv[cx.argv.indexOf("--effort") + 1], "xhigh");

  const defaultCodex = buildChildLaunch({ provider: "codex", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  assert.ok(!defaultCodex.argv.some((a) => a.includes("model_reasoning_effort")));

  const x = buildChildLaunch({ provider: "codex", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, effort: "xhigh" });
  assert.ok(x.argv.some((a) => a === 'model_reasoning_effort="xhigh"'));
});

test("codex does not get runner-injected service tier or fast-mode flags", () => {
  const x = buildChildLaunch({ provider: "codex", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  assert.ok(!x.argv.some((a) => a.includes("service_tier") || a.includes("fast_mode")));
  const c = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  assert.ok(!c.argv.some((a) => a.includes("service_tier") || a.includes("fast_mode")));
  const cp = buildChildLaunch({ provider: "copilot", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  assert.ok(!cp.argv.some((a) => a.includes("service_tier") || a.includes("fast_mode")));
});

test("planner structured-output flags: claude inline --json-schema, codex --output-schema/-o", () => {
  // claude: inline --json-schema (with --output-format json)
  const c = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, jsonSchema: '{"type":"object"}' });
  assert.ok(c.argv.includes("--output-format") && c.argv.includes("json"));
  const ji = c.argv.indexOf("--json-schema");
  assert.ok(ji >= 0 && c.argv[ji + 1] === '{"type":"object"}');
  // codex: --output-schema <file> and -o <file>, inside the exec options (before the trailing "-")
  const x = buildChildLaunch({ provider: "codex", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, codexSchemaFile: "/tmp/s.json", codexOutputFile: "/tmp/o.json" });
  const si = x.argv.indexOf("--output-schema");
  assert.ok(si >= 0 && x.argv[si + 1] === "/tmp/s.json");
  const oi = x.argv.indexOf("-o");
  assert.ok(oi >= 0 && x.argv[oi + 1] === "/tmp/o.json");
  assert.equal(x.argv[x.argv.length - 1], "-"); // prompt still on stdin
  assert.ok(si > x.argv.indexOf("exec") && oi > x.argv.indexOf("exec"));
  assert.ok(!x.argv.includes("--json"), "codex planner uses -o/--output-schema, not worker JSONL");
  // a normal claude worker streams (for the live debug file) but has no schema
  const w = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  assert.ok(!w.argv.includes("--json-schema"));
  assert.ok(w.argv.includes("--output-format") && w.argv.includes("stream-json") && w.argv.includes("--verbose"));
  // a normal worker (no claudeSession) carries no session flags
  assert.ok(!w.argv.includes("--session-id") && !w.argv.includes("--resume"));
});

test("claude planner session: --session-id creates, --resume continues (runner-generated id)", () => {
  const fresh = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, jsonSchema: "{}", claudeSession: { id: "11111111-1111-1111-1111-111111111111", resume: false } });
  const si = fresh.argv.indexOf("--session-id");
  assert.ok(si >= 0 && fresh.argv[si + 1] === "11111111-1111-1111-1111-111111111111");
  assert.ok(!fresh.argv.includes("--resume"));
  const resumed = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, jsonSchema: "{}", claudeSession: { id: "11111111-1111-1111-1111-111111111111", resume: true } });
  const ri = resumed.argv.indexOf("--resume");
  assert.ok(ri >= 0 && resumed.argv[ri + 1] === "11111111-1111-1111-1111-111111111111");
  assert.ok(!resumed.argv.includes("--session-id"));
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
