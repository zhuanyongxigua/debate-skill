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

test("thinking effort is per-launch (default high; planner picks the value)", () => {
  // default effort is high (the planner overrides per launch; codex defaults to xhigh at the schema layer)
  const c = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  assert.equal(c.argv[c.argv.indexOf("--effort") + 1], "high");
  // an explicit effort is honored
  const cx = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, effort: "xhigh" });
  assert.equal(cx.argv[cx.argv.indexOf("--effort") + 1], "xhigh");
  const x = buildChildLaunch({ provider: "codex", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, effort: "xhigh" });
  assert.ok(x.argv.some((a) => a === 'model_reasoning_effort="xhigh"'));
});

test("fast mode applies to codex ONLY (claude is exempt — needs an API token)", () => {
  // codex honors fast via per-invocation -c overrides
  const x = buildChildLaunch({ provider: "codex", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, fast: true });
  assert.ok(x.argv.includes('service_tier="fast"'));
  assert.ok(x.argv.includes("features.fast_mode=true"));
  // claude is fast-exempt: even with fast=true it gets NO fast flag (its fast mode
  // needs an API token, which the runner strips — it runs on the logged-in account)
  const c = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, fast: true });
  assert.ok(!c.argv.includes("--settings"));
  assert.ok(!c.argv.some((a) => a.includes("fastMode")));
});

test("no fast flags when fast is false / omitted", () => {
  const c = buildChildLaunch({ provider: "claude", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {} });
  assert.ok(!c.argv.includes("--settings"));
  const x = buildChildLaunch({ provider: "codex", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, fast: false });
  assert.ok(!x.argv.some((a) => a.includes("service_tier") || a.includes("fast_mode")));
});

test("copilot is exempt from fast mode", () => {
  const cp = buildChildLaunch({ provider: "copilot", cwd: "/r", profile: null, capability: "read_only_review", prompt: "P", baseEnv: {}, fast: true });
  assert.ok(!cp.argv.some((a) => a.includes("fast") || a.includes("--settings") || a.includes("service_tier")));
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
