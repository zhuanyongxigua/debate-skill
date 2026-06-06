// Integration tests: cross the process boundary.
//
// Unlike the unit tests (which import src directly), these invoke the real
// bin/debate-agent the way Codex Rules will, with on-disk JSON config and a
// stub CLI on PATH. They exercise the launcher bootstrap, argparse, install.sh,
// and real timeout/process-group signal behavior. A stub binary stands in for
// claude/codex, so no real login is required. The opt-in codex Rules check is
// skipped unless DEBATE_AGENT_CODEX_RULES_TEST=1 and codex is on PATH.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { CLAUDE_STUB, cleanup, makeMarkerStub, makeStub, makeTempDir, writeConfig, writeRequest } from "./helpers";

const PKG_ROOT = join(__dirname, "..", "..");
const BIN = join(PKG_ROOT, "bin", "debate-agent");
const INSTALL = join(PKG_ROOT, "install.sh");

function which(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const cand = join(dir, bin);
    try {
      accessSync(cand, constants.X_OK);
      return cand;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

interface Ctx {
  root: string;
  repo: string;
  binDir: string;
  audit: string;
  cfg: string;
}

function setup(): Ctx {
  const root = makeTempDir();
  const repo = join(root, "repo");
  mkdirSync(repo);
  const binDir = join(root, "bin");
  mkdirSync(binDir);
  const audit = join(root, "audit");
  const cfg = join(root, "allowlist.json");
  writeConfig(cfg, repo);
  makeStub(binDir, "claude", CLAUDE_STUB);
  return { root, repo, binDir, audit, cfg };
}

function cliEnv(ctx: Ctx, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Isolate HOME so defaultConfigPath() cannot pick up the developer's real
    // ~/.config/debate-agent/allowlist.json — otherwise the "closed by default"
    // test (and any default-config path) would be environment-dependent.
    HOME: ctx.root,
    PATH: `${ctx.binDir}${delimiter}${process.env.PATH ?? ""}`,
    DEBATE_AGENT_AUDIT_HOME: ctx.audit,
    ANTHROPIC_API_KEY: "sk-test-should-be-stripped",
    ...extra,
  };
}

function runCli(ctx: Ctx, args: string[], env = cliEnv(ctx)) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env });
}

/** Poll `pred` until true or the deadline; for driving the async watch daemon. */
async function waitFor(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("run success writes audit and transports prompt", () => {
  const ctx = setup();
  try {
    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo);
    const proc = runCli(ctx, ["--config", ctx.cfg, "run", "--request", req]);
    assert.equal(proc.status, 0, proc.stderr);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.status, "completed");
    assert.ok(result.stripped_env_keys.includes("ANTHROPIC_API_KEY"));

    const childStdout = readFileSync(result.stdout_path, "utf8");
    assert.ok(childStdout.includes(`CWD=${realpathSync(ctx.repo)}`));
    assert.ok(childStdout.includes("STDIN=PROMPT-MARKER-XYZ"));
    const argsLine = childStdout.split("\n").find((l) => l.startsWith("ARGS="))!;
    assert.ok(!argsLine.includes("PROMPT-MARKER-XYZ"));

    const audit = readFileSync(result.audit_path, "utf8");
    assert.ok(result.audit_path.includes("20260530-itest"));
    assert.ok(audit.includes("status: completed"));
  } finally {
    cleanup(ctx.root);
  }
});

test("run rejected exits 1", () => {
  const ctx = setup();
  try {
    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo, { provider: "copilot" });
    const proc = runCli(ctx, ["--config", ctx.cfg, "run", "--request", req]);
    assert.equal(proc.status, 1);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.status, "rejected");
    assert.ok(result.reject_reason.includes("provider"));
  } finally {
    cleanup(ctx.root);
  }
});

test("rejected request launches no child (cross-process negative proof)", () => {
  const ctx = setup();
  try {
    // Replace the claude stub with one that records any launch. Provider is
    // allowed (claude) but the mode is not, so rejection happens AFTER provider
    // resolution — a spawn-then-reject regression would touch the marker.
    const marker = join(ctx.root, "launched.marker");
    makeMarkerStub(ctx.binDir, "claude", marker);
    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo, { mode: "not-an-allowed-mode" });
    const proc = runCli(ctx, ["--config", ctx.cfg, "run", "--request", req]);
    assert.equal(proc.status, 1);
    assert.equal(JSON.parse(proc.stdout).status, "rejected");
    assert.ok(!existsSync(marker), "validation must precede launch: no child for a rejected request");
  } finally {
    cleanup(ctx.root);
  }
});

test("validate subcommand", () => {
  const ctx = setup();
  try {
    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo);
    const proc = runCli(ctx, ["--config", ctx.cfg, "validate", "--request", req]);
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(JSON.parse(proc.stdout).status, "valid");
  } finally {
    cleanup(ctx.root);
  }
});

test("config via env var", () => {
  const ctx = setup();
  try {
    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo);
    const proc = runCli(ctx, ["validate", "--request", req], cliEnv(ctx, { DEBATE_AGENT_CONFIG: ctx.cfg }));
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(JSON.parse(proc.stdout).status, "valid");
  } finally {
    cleanup(ctx.root);
  }
});

test("closed by default without config", () => {
  const ctx = setup();
  try {
    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo);
    const env = cliEnv(ctx);
    delete env.DEBATE_AGENT_CONFIG;
    const proc = runCli(ctx, ["validate", "--request", req], env);
    assert.equal(proc.status, 1);
    assert.equal(JSON.parse(proc.stdout).status, "rejected");
  } finally {
    cleanup(ctx.root);
  }
});

test("child env has no secrets", () => {
  const ctx = setup();
  try {
    // Swap in a stub that dumps its OWN environment.
    makeStub(ctx.binDir, "claude", "#!/usr/bin/env bash\nenv\n");
    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo);
    const proc = runCli(ctx, ["--config", ctx.cfg, "run", "--request", req]);
    assert.equal(proc.status, 0, proc.stderr);
    const childEnv = readFileSync(JSON.parse(proc.stdout).stdout_path, "utf8");
    assert.ok(!childEnv.includes("ANTHROPIC_API_KEY"));
    assert.ok(!childEnv.includes("sk-test-should-be-stripped"));
    assert.match(childEnv, /^PATH=/m);
  } finally {
    cleanup(ctx.root);
  }
});

test("copilot is rejected unless the allowlist opts in", () => {
  const ctx = setup(); // default config: providers = claude, codex
  try {
    makeStub(ctx.binDir, "copilot", CLAUDE_STUB);
    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo, { provider: "copilot" });
    const proc = runCli(ctx, ["--config", ctx.cfg, "run", "--request", req]);
    assert.equal(proc.status, 1);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.status, "rejected");
    assert.match(result.reject_reason, /provider .* not in allowlist/);
  } finally {
    cleanup(ctx.root);
  }
});

test("copilot run delivers the prompt via -p argv, not stdin", () => {
  const ctx = setup();
  try {
    makeStub(ctx.binDir, "copilot", CLAUDE_STUB); // echoes ARGS / STDIN
    // opt-in config that allows copilot
    const cfg = join(ctx.root, "copilot-allow.json");
    require("node:fs").writeFileSync(
      cfg,
      JSON.stringify({ repo_roots: [ctx.repo], modes: ["debate-proposal"], providers: ["claude", "codex", "copilot"] }),
    );
    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo, { provider: "copilot", prompt: "PROMPT-MARKER-XYZ" });
    const proc = runCli(ctx, ["--config", cfg, "run", "--request", req]);
    assert.equal(proc.status, 0, proc.stderr);
    const childStdout = readFileSync(JSON.parse(proc.stdout).stdout_path, "utf8");
    const argsLine = childStdout.split("\n").find((l) => l.startsWith("ARGS="))!;
    assert.ok(argsLine.includes("-p"));
    assert.ok(argsLine.includes("PROMPT-MARKER-XYZ")); // prompt is in argv
    assert.ok(argsLine.includes("--deny-tool=write")); // read-only default posture
    assert.ok(childStdout.includes("STDIN=\n") || childStdout.trimEnd().endsWith("STDIN=")); // nothing on stdin
  } finally {
    cleanup(ctx.root);
  }
});

test("run-batch executes items in parallel and returns ordered results", () => {
  const ctx = setup();
  try {
    makeStub(ctx.binDir, "codex", CLAUDE_STUB); // codex stand-in
    const mkReq = (provider: string) => ({
      schema_version: 1,
      run_id: "20260530-batch",
      phase: "proposal_generation",
      provider,
      mode: "debate-proposal",
      repo: ctx.repo,
      prompt: `PROMPT-${provider}`,
    });
    const batch = join(ctx.root, "batch.json");
    require("node:fs").writeFileSync(
      batch,
      JSON.stringify({
        schema_version: 1,
        batch_id: "20260530-batch",
        max_parallel: 4,
        items: [
          { item_id: "P1", request: mkReq("codex") },
          { item_id: "P2", request: mkReq("claude") },
          { item_id: "P3", request: { ...mkReq("claude"), provider: "copilot" } }, // invalid -> degraded
        ],
      }),
    );
    const proc = runCli(ctx, ["--config", ctx.cfg, "run-batch", "--request", batch]);
    // degraded -> exit 1, but a parseable batch envelope on stdout
    assert.equal(proc.status, 1, proc.stderr);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.kind, "batch");
    assert.equal(result.status, "degraded");
    assert.equal(result.item_count, 3);
    assert.deepEqual(
      result.items.map((it: { item_id: string }) => it.item_id),
      ["P1", "P2", "P3"],
    );
    assert.equal(result.items[0].status, "completed");
    assert.equal(result.items[1].status, "completed");
    assert.equal(result.items[2].status, "rejected");
  } finally {
    cleanup(ctx.root);
  }
});

test("watch daemon: real bin subprocess — planner retry + multi-phase templated execution", async () => {
  const ctx = setup();
  // One stub serves as BOTH planner and worker. As the planner (claude
  // `--output-format json --json-schema`) it returns an INVALID envelope the first
  // time (forcing the daemon's validate→retry), then a valid one whose
  // `structured_output` is a TWO-phase plan with a {{P1.output}} placeholder. As a
  // worker it echoes the prompt it received, so we can prove the daemon
  // substituted P1's real stdout into A1's prompt across the boundary.
  const argsFile = join(ctx.root, "claude_args");
  const planCounter = join(ctx.root, "plan_calls");
  const plan =
    '{"complexity":"simple","phases":[{"name":"proposal_generation","launches":[{"id":"P1","provider":"claude","effort":"high","prompt":"propose"}]},{"name":"arbitration","launches":[{"id":"A1","provider":"claude","effort":"high","prompt":"context {{P1.output}} decide"}]}],"answer_item":"A1"}';
  // Route planner vs worker by ARGV (--json-schema is present on every planner
  // call, fresh or --resume) rather than by a stdin marker — the resume prompt no
  // longer repeats "You are the PLANNER", so argv is the robust discriminator.
  makeStub(
    ctx.binDir,
    "claude",
    "#!/usr/bin/env bash\n" +
      "input=$(cat)\n" +
      `echo "$@" >> ${JSON.stringify(argsFile)}\n` +
      'if printf "%s" "$*" | grep -q -- "--json-schema"; then\n' +
      `  n=$(cat ${JSON.stringify(planCounter)} 2>/dev/null || echo 0)\n` +
      `  echo $((n+1)) > ${JSON.stringify(planCounter)}\n` +
      '  if [ "$n" -eq 0 ]; then\n' +
      "    printf 'this is not a valid plan\\n'\n" +
      "  else\n" +
      `    printf '%s\\n' ${JSON.stringify(`{"type":"result","subtype":"success","structured_output":${plan}}`)}\n` +
      "  fi\n" +
      "else\n" +
      `  printf '%s\\n' "WORKER_GOT[$input]"\n` +
      "fi\n",
  );
  const mailbox = join(ctx.root, "mailbox");
  const env = cliEnv(ctx, { DEBATE_AGENT_MAILBOX: mailbox });
  let daemon: ReturnType<typeof spawn> | undefined;
  try {
    // Start the REAL daemon as its own process group (so we can kill the tree).
    let stderr = "";
    daemon = spawn(process.execPath, [BIN, "--config", ctx.cfg, "watch"], { env, detached: true });
    daemon.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
    daemon.on("error", (e) => (stderr += `spawn error: ${String(e)}`));
    // The daemon snapshots+ignores existing requests at startup, so submit only
    // AFTER it is polling (the banner is printed once it is up).
    await waitFor(() => stderr.includes("polling every"), 8000, `daemon banner (stderr so far: ${stderr})`);

    const id = "20260531-itest-debate";
    writeFileSync(
      join(mailbox, "requests", `${id}.json`),
      JSON.stringify({ schema_version: 1, id, kind: "debate_request", prompt: "should we X or Y?", repo: realpathSync(ctx.repo), providers: ["claude"] }),
    );

    const respPath = join(mailbox, "responses", `${id}.json`);
    await waitFor(() => existsSync(respPath), 15000, `response ${id}.json (stderr: ${stderr})`);

    const resp = JSON.parse(readFileSync(respPath, "utf8"));
    assert.equal(resp.kind, "debate_result");
    assert.equal(resp.status, "completed", JSON.stringify(resp));
    // planner retried: first plan invalid, second valid => the planner ran twice
    assert.equal(readFileSync(planCounter, "utf8").trim(), "2", "planner should have been retried once");
    // mechanical {{P1.output}} substitution across the boundary: A1's prompt
    // embedded P1's actual stdout ("WORKER_GOT[propose]") inside its framing
    assert.match(resp.answer_markdown, /context WORKER_GOT\[propose\]/);
    assert.deepEqual(
      resp.trace.map((t: { item: string; status: string }) => `${t.item}:${t.status}`),
      ["P1:completed", "A1:completed"],
    );

    // the read-only argv reached the planner + worker spawns; prompts went on stdin
    const argv = readFileSync(argsFile, "utf8");
    assert.match(argv, /--permission-mode default/);
    assert.match(argv, /--disallowedTools/);
    assert.ok(!argv.includes("propose"), "prompt must go on stdin, not argv");
    // the planner created a session on attempt 1 and RESUMED THE SAME ONE on the
    // retry (proven across the real subprocess boundary, not just in a unit stub).
    // Parse per claude invocation (one line each); planner calls carry --json-schema.
    const argLines = argv.trim().split("\n");
    const plannerLines = argLines.filter((l) => l.includes("--json-schema"));
    assert.equal(plannerLines.length, 2, "planner ran twice (invalid then valid)");
    const sid = plannerLines[0]!.match(/--session-id (\S+)/);
    assert.ok(sid && !plannerLines[0]!.includes("--resume"), "attempt 1 creates a fresh --session-id");
    const rid = plannerLines[1]!.match(/--resume (\S+)/);
    assert.ok(rid && !plannerLines[1]!.includes("--session-id"), "attempt 2 resumes, does not re-create");
    assert.equal(rid![1], sid![1], "the retry resumes the SAME session id, not a new one");
    // worker calls (no --json-schema) carry no session flags at all
    const workerLines = argLines.filter((l) => !l.includes("--json-schema"));
    assert.ok(workerLines.length > 0 && workerLines.every((l) => !l.includes("--session-id") && !l.includes("--resume")));

    // the daemon moved the request out of processing/ and preserved it in
    // archive/ with its original prompt intact (durable record, not deleted)
    assert.ok(!existsSync(join(mailbox, "processing", `${id}.json`)), "processing entry cleared");
    const archived = JSON.parse(readFileSync(join(mailbox, "archive", `${id}.json`), "utf8"));
    assert.equal(archived.prompt, "should we X or Y?", "original request preserved in archive/");
  } finally {
    if (daemon?.pid !== undefined) {
      try {
        process.kill(-daemon.pid, "SIGKILL");
      } catch {
        try {
          daemon.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    cleanup(ctx.root);
  }
});

test("watch daemon: a failed planner AND worker fall back to the other engine", async () => {
  const ctx = setup();
  // The `claude` stub fails for EVERY call (planner and worker) with a generic
  // non-rate-limit API/certificate error. The `codex` stub is healthy and serves
  // BOTH roles — as the planner (input contains "You are the PLANNER") it prints
  // a plan that, deliberately, assigns a `claude` worker; as a worker it echoes
  // its prompt. So the daemon must: rotate the planner claude→codex, then swap
  // the failed claude worker→codex, and still finish `completed`.
  makeStub(
    ctx.binDir,
    "claude",
    "#!/usr/bin/env bash\n" +
      "cat >/dev/null\n" +
      "printf 'API Error: Unable to connect to API (UNKNOWN_CERTIFICATE_VERIFICATION_ERROR)\\n' >&2\n" +
      "exit 1\n",
  );
  const plan =
    '{"complexity":"simple","phases":[{"name":"proposal_generation","launches":[{"id":"P1","provider":"claude","effort":"high","prompt":"propose something"}]}],"answer_item":"P1"}';
  makeStub(
    ctx.binDir,
    "codex",
    "#!/usr/bin/env bash\n" +
      "input=$(cat)\n" +
      'if printf "%s" "$input" | grep -q "You are the PLANNER"; then\n' +
      `  printf '%s\\n' ${JSON.stringify(plan)}\n` +
      "else\n" +
      '  printf \'CODEX_WORKER[%s]\\n\' "$input"\n' +
      "fi\n",
  );
  const mailbox = join(ctx.root, "mailbox");
  const env = cliEnv(ctx, { DEBATE_AGENT_MAILBOX: mailbox });
  let daemon: ReturnType<typeof spawn> | undefined;
  try {
    let stderr = "";
    daemon = spawn(process.execPath, [BIN, "--config", ctx.cfg, "watch"], { env, detached: true });
    daemon.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
    daemon.on("error", (e) => (stderr += `spawn error: ${String(e)}`));
    await waitFor(() => stderr.includes("polling every"), 8000, `daemon banner (stderr so far: ${stderr})`);

    const id = "20260531-itest-failure-fallback";
    writeFileSync(
      join(mailbox, "requests", `${id}.json`),
      JSON.stringify({ schema_version: 1, id, kind: "debate_request", prompt: "decide X", repo: realpathSync(ctx.repo), providers: ["claude", "codex"] }),
    );

    const respPath = join(mailbox, "responses", `${id}.json`);
    await waitFor(() => existsSync(respPath), 20000, `response ${id}.json (stderr: ${stderr})`);

    const resp = JSON.parse(readFileSync(respPath, "utf8"));
    assert.equal(resp.status, "completed", JSON.stringify(resp));
    // the (only) worker P1 was planned as claude but ran on codex after the swap;
    // the swap is visible in the trace (planned_provider), not only the log
    assert.deepEqual(
      resp.trace.map((t: { item: string; provider: string; status: string }) => `${t.item}:${t.provider}:${t.status}`),
      ["P1:codex:completed"],
    );
    assert.equal(resp.trace[0].planned_provider, "claude");
    // the answer is the codex worker's echo (claude never produced output)
    assert.match(resp.answer_markdown, /CODEX_WORKER\[propose something\]/);
    // the live log recorded the worker-level fallback decision (planned → actual)
    const logText = readFileSync(join(mailbox, "responses", `${id}.log`), "utf8");
    assert.match(logText, /provider fallback: P1 claude → codex/);
  } finally {
    if (daemon?.pid !== undefined) {
      try {
        process.kill(-daemon.pid, "SIGKILL");
      } catch {
        try {
          daemon.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    cleanup(ctx.root);
  }
});

test("watch daemon: request planner_provider overrides the first providers entry", async () => {
  const ctx = setup();
  const claudeArgs = join(ctx.root, "claude_args");
  const codexArgs = join(ctx.root, "codex_args");
  const plan =
    '{"complexity":"simple","phases":[{"name":"proposal_generation","launches":[{"id":"P1","provider":"claude","effort":"high","prompt":"worker prompt"}]}],"answer_item":"P1"}';
  makeStub(
    ctx.binDir,
    "claude",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(claudeArgs)}\n` +
      'if printf "%s" "$*" | grep -q -- "--json-schema"; then\n' +
      "  printf 'claude should not be the planner for this request\\n' >&2\n" +
      "  exit 9\n" +
      "fi\n" +
      "input=$(cat)\n" +
      "printf 'CLAUDE_WORKER[%s]\\n' \"$input\"\n",
  );
  makeStub(
    ctx.binDir,
    "codex",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(codexArgs)}\n` +
      "input=$(cat)\n" +
      'out=""\n' +
      'prev=""\n' +
      'for arg in "$@"; do\n' +
      '  if [ "$prev" = "-o" ]; then out="$arg"; fi\n' +
      '  prev="$arg"\n' +
      "done\n" +
      'if printf "%s" "$input" | grep -q "You are the PLANNER"; then\n' +
      `  [ -n "$out" ] && printf '%s\\n' ${JSON.stringify(plan)} > "$out"\n` +
      `  printf '%s\\n' ${JSON.stringify(plan)}\n` +
      "else\n" +
      "  printf 'CODEX_WORKER[%s]\\n' \"$input\"\n" +
      "fi\n",
  );
  const mailbox = join(ctx.root, "mailbox");
  const env = cliEnv(ctx, { DEBATE_AGENT_MAILBOX: mailbox });
  let daemon: ReturnType<typeof spawn> | undefined;
  try {
    let stderr = "";
    // The legacy daemon --planner is present, but this request explicitly picks
    // codex through planner_provider.
    daemon = spawn(process.execPath, [BIN, "--config", ctx.cfg, "watch", "--planner", "claude"], { env, detached: true });
    daemon.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
    daemon.on("error", (e) => (stderr += `spawn error: ${String(e)}`));
    await waitFor(() => stderr.includes("polling every"), 8000, `daemon banner (stderr so far: ${stderr})`);

    const id = "20260604-itest-request-planner-provider";
    writeFileSync(
      join(mailbox, "requests", `${id}.json`),
      JSON.stringify({
        schema_version: 1,
        id,
        kind: "debate_request",
        prompt: "decide X",
        repo: realpathSync(ctx.repo),
        fast: false,
        providers: ["claude", "codex"],
        planner_provider: "codex",
      }),
    );

    const respPath = join(mailbox, "responses", `${id}.json`);
    await waitFor(() => existsSync(respPath), 15000, `response ${id}.json (stderr: ${stderr})`);

    const resp = JSON.parse(readFileSync(respPath, "utf8"));
    assert.equal(resp.status, "completed", JSON.stringify(resp));
    assert.match(resp.answer_markdown, /CLAUDE_WORKER\[worker prompt\]/);
    assert.match(readFileSync(codexArgs, "utf8"), /--output-schema/, "codex should be the request-selected planner");
    assert.ok(!readFileSync(claudeArgs, "utf8").includes("--json-schema"), "claude should only run as worker, not planner");
    const archived = JSON.parse(readFileSync(join(mailbox, "archive", `${id}.json`), "utf8"));
    assert.equal(archived.planner_provider, "codex");
  } finally {
    if (daemon?.pid !== undefined) {
      try {
        process.kill(-daemon.pid, "SIGKILL");
      } catch {
        try {
          daemon.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    cleanup(ctx.root);
  }
});

test("watch daemon: first request provider beats legacy daemon --planner", async () => {
  const ctx = setup();
  const claudeArgs = join(ctx.root, "claude_args");
  const codexArgs = join(ctx.root, "codex_args");
  const plan =
    '{"complexity":"simple","phases":[{"name":"proposal_generation","launches":[{"id":"P1","provider":"claude","effort":"high","prompt":"worker prompt"}]}],"answer_item":"P1"}';
  makeStub(
    ctx.binDir,
    "claude",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(claudeArgs)}\n` +
      'if printf "%s" "$*" | grep -q -- "--json-schema"; then\n' +
      "  printf 'claude should not be the planner when providers[0] is codex\\n' >&2\n" +
      "  exit 9\n" +
      "fi\n" +
      "input=$(cat)\n" +
      "printf 'CLAUDE_WORKER[%s]\\n' \"$input\"\n",
  );
  makeStub(
    ctx.binDir,
    "codex",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(codexArgs)}\n` +
      "input=$(cat)\n" +
      'out=""\n' +
      'prev=""\n' +
      'for arg in "$@"; do\n' +
      '  if [ "$prev" = "-o" ]; then out="$arg"; fi\n' +
      '  prev="$arg"\n' +
      "done\n" +
      'if printf "%s" "$input" | grep -q "You are the PLANNER"; then\n' +
      `  [ -n "$out" ] && printf '%s\\n' ${JSON.stringify(plan)} > "$out"\n` +
      `  printf '%s\\n' ${JSON.stringify(plan)}\n` +
      "else\n" +
      "  printf 'CODEX_WORKER[%s]\\n' \"$input\"\n" +
      "fi\n",
  );
  const mailbox = join(ctx.root, "mailbox");
  const env = cliEnv(ctx, { DEBATE_AGENT_MAILBOX: mailbox });
  let daemon: ReturnType<typeof spawn> | undefined;
  try {
    let stderr = "";
    daemon = spawn(process.execPath, [BIN, "--config", ctx.cfg, "watch", "--planner", "claude"], { env, detached: true });
    daemon.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
    daemon.on("error", (e) => (stderr += `spawn error: ${String(e)}`));
    await waitFor(() => stderr.includes("polling every"), 8000, `daemon banner (stderr so far: ${stderr})`);

    const id = "20260606-itest-first-provider-planner";
    writeFileSync(
      join(mailbox, "requests", `${id}.json`),
      JSON.stringify({
        schema_version: 1,
        id,
        kind: "debate_request",
        prompt: "decide X",
        repo: realpathSync(ctx.repo),
        fast: false,
        providers: ["codex", "claude"],
      }),
    );

    const respPath = join(mailbox, "responses", `${id}.json`);
    await waitFor(() => existsSync(respPath), 15000, `response ${id}.json (stderr: ${stderr})`);

    const resp = JSON.parse(readFileSync(respPath, "utf8"));
    assert.equal(resp.status, "completed", JSON.stringify(resp));
    assert.match(resp.answer_markdown, /CLAUDE_WORKER\[worker prompt\]/);
    assert.match(readFileSync(codexArgs, "utf8"), /--output-schema/, "providers[0] codex should be the planner");
    assert.ok(!readFileSync(claudeArgs, "utf8").includes("--json-schema"), "legacy --planner must not override providers[0]");
  } finally {
    if (daemon?.pid !== undefined) {
      try {
        process.kill(-daemon.pid, "SIGKILL");
      } catch {
        try {
          daemon.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    cleanup(ctx.root);
  }
});

test("watch daemon: request providers can force every role to codex", async () => {
  const ctx = setup();
  const claudeArgs = join(ctx.root, "claude_args");
  const codexArgs = join(ctx.root, "codex_args");
  const plan =
    '{"complexity":"simple","phases":[{"name":"proposal_generation","launches":[{"id":"P1","provider":"codex","effort":"xhigh","prompt":"worker prompt"}]}],"answer_item":"P1"}';
  makeStub(
    ctx.binDir,
    "claude",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(claudeArgs)}\n` +
      "cat >/dev/null\n" +
      "printf 'claude should not be launched for providers=[codex]\\n' >&2\n" +
      "exit 9\n",
  );
  makeStub(
    ctx.binDir,
    "codex",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(codexArgs)}\n` +
      "input=$(cat)\n" +
      'out=""\n' +
      'prev=""\n' +
      'for arg in "$@"; do\n' +
      '  if [ "$prev" = "-o" ]; then out="$arg"; fi\n' +
      '  prev="$arg"\n' +
      "done\n" +
      'if printf "%s" "$input" | grep -q "You are the PLANNER"; then\n' +
      `  [ -n "$out" ] && printf '%s\\n' ${JSON.stringify(plan)} > "$out"\n` +
      `  printf '%s\\n' ${JSON.stringify(plan)}\n` +
      "else\n" +
      "  printf 'CODEX_WORKER[%s]\\n' \"$input\"\n" +
      "fi\n",
  );
  const mailbox = join(ctx.root, "mailbox");
  const env = cliEnv(ctx, { DEBATE_AGENT_MAILBOX: mailbox });
  let daemon: ReturnType<typeof spawn> | undefined;
  try {
    let stderr = "";
    // Legacy daemon --planner is claude, but this request narrows all launched
    // providers to codex. That affects planner, workers, and fallback membership.
    daemon = spawn(process.execPath, [BIN, "--config", ctx.cfg, "watch", "--planner", "claude"], { env, detached: true });
    daemon.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
    daemon.on("error", (e) => (stderr += `spawn error: ${String(e)}`));
    await waitFor(() => stderr.includes("polling every"), 8000, `daemon banner (stderr so far: ${stderr})`);

    const id = "20260606-itest-request-providers-codex";
    writeFileSync(
      join(mailbox, "requests", `${id}.json`),
      JSON.stringify({
        schema_version: 1,
        id,
        kind: "debate_request",
        prompt: "decide X",
        repo: realpathSync(ctx.repo),
        fast: false,
        providers: ["codex"],
      }),
    );

    const respPath = join(mailbox, "responses", `${id}.json`);
    await waitFor(() => existsSync(respPath), 15000, `response ${id}.json (stderr: ${stderr})`);

    const resp = JSON.parse(readFileSync(respPath, "utf8"));
    assert.equal(resp.status, "completed", JSON.stringify(resp));
    assert.match(resp.answer_markdown, /CODEX_WORKER\[worker prompt\]/);
    assert.deepEqual(
      resp.trace.map((t: { item: string; provider: string; status: string }) => `${t.item}:${t.provider}:${t.status}`),
      ["P1:codex:completed"],
    );
    assert.match(readFileSync(codexArgs, "utf8"), /--output-schema/, "codex should be the planner");
    assert.ok(!existsSync(claudeArgs), "claude should not be launched for planner or worker");
    const archived = JSON.parse(readFileSync(join(mailbox, "archive", `${id}.json`), "utf8"));
    assert.deepEqual(archived.providers, ["codex"]);
  } finally {
    if (daemon?.pid !== undefined) {
      try {
        process.kill(-daemon.pid, "SIGKILL");
      } catch {
        try {
          daemon.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    cleanup(ctx.root);
  }
});

test("watch daemon: codex-only provider set cannot fall back to claude", async () => {
  const ctx = setup();
  const claudeArgs = join(ctx.root, "claude_args");
  const codexArgs = join(ctx.root, "codex_args");
  makeStub(
    ctx.binDir,
    "claude",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(claudeArgs)}\n` +
      "cat >/dev/null\n" +
      "printf 'claude must not be used as fallback for providers=[codex]\\n' >&2\n" +
      "exit 9\n",
  );
  makeStub(
    ctx.binDir,
    "codex",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(codexArgs)}\n` +
      "cat >/dev/null\n" +
      "printf 'codex unavailable\\n' >&2\n" +
      "exit 7\n",
  );
  const mailbox = join(ctx.root, "mailbox");
  const env = cliEnv(ctx, { DEBATE_AGENT_MAILBOX: mailbox });
  let daemon: ReturnType<typeof spawn> | undefined;
  try {
    let stderr = "";
    daemon = spawn(process.execPath, [BIN, "--config", ctx.cfg, "watch"], { env, detached: true });
    daemon.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
    daemon.on("error", (e) => (stderr += `spawn error: ${String(e)}`));
    await waitFor(() => stderr.includes("polling every"), 8000, `daemon banner (stderr so far: ${stderr})`);

    const id = "20260606-itest-codex-only-no-claude-fallback";
    writeFileSync(
      join(mailbox, "requests", `${id}.json`),
      JSON.stringify({
        schema_version: 1,
        id,
        kind: "debate_request",
        prompt: "decide X",
        repo: realpathSync(ctx.repo),
        fast: true,
        providers: ["codex"],
      }),
    );

    const respPath = join(mailbox, "responses", `${id}.json`);
    await waitFor(() => existsSync(respPath), 15000, `response ${id}.json (stderr: ${stderr})`);

    const resp = JSON.parse(readFileSync(respPath, "utf8"));
    assert.equal(resp.status, "degraded", JSON.stringify(resp));
    assert.ok(resp.trace.length > 0, "failed codex launches should still be traced");
    assert.deepEqual([...new Set(resp.trace.map((t: { provider: string }) => t.provider))], ["codex"]);
    assert.ok(!existsSync(claudeArgs), "claude should not launch as fallback outside request providers");
    assert.ok(readFileSync(codexArgs, "utf8").length > 0, "codex should have been attempted");
  } finally {
    if (daemon?.pid !== undefined) {
      try {
        process.kill(-daemon.pid, "SIGKILL");
      } catch {
        try {
          daemon.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    cleanup(ctx.root);
  }
});

test("watch daemon: codex-only full plan rejects a claude worker from the planner", async () => {
  const ctx = setup();
  const claudeArgs = join(ctx.root, "claude_args");
  const codexArgs = join(ctx.root, "codex_args");
  const plan =
    '{"complexity":"simple","phases":[{"name":"proposal_generation","launches":[{"id":"P1","provider":"claude","effort":"high","prompt":"worker prompt"}]}],"answer_item":"P1"}';
  makeStub(
    ctx.binDir,
    "claude",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(claudeArgs)}\n` +
      "cat >/dev/null\n" +
      "printf 'claude worker must not launch for providers=[codex]\\n' >&2\n" +
      "exit 9\n",
  );
  makeStub(
    ctx.binDir,
    "codex",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(codexArgs)}\n` +
      "input=$(cat)\n" +
      'out=""\n' +
      'prev=""\n' +
      'for arg in "$@"; do\n' +
      '  if [ "$prev" = "-o" ]; then out="$arg"; fi\n' +
      '  prev="$arg"\n' +
      "done\n" +
      'if printf "%s" "$input" | grep -q "You are the PLANNER"; then\n' +
      `  [ -n "$out" ] && printf '%s\\n' ${JSON.stringify(plan)} > "$out"\n` +
      `  printf '%s\\n' ${JSON.stringify(plan)}\n` +
      "else\n" +
      "  printf 'CODEX_WORKER[%s]\\n' \"$input\"\n" +
      "fi\n",
  );
  const mailbox = join(ctx.root, "mailbox");
  const env = cliEnv(ctx, { DEBATE_AGENT_MAILBOX: mailbox });
  let daemon: ReturnType<typeof spawn> | undefined;
  try {
    let stderr = "";
    daemon = spawn(process.execPath, [BIN, "--config", ctx.cfg, "watch"], { env, detached: true });
    daemon.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
    daemon.on("error", (e) => (stderr += `spawn error: ${String(e)}`));
    await waitFor(() => stderr.includes("polling every"), 8000, `daemon banner (stderr so far: ${stderr})`);

    const id = "20260606-itest-codex-only-rejects-claude-plan";
    writeFileSync(
      join(mailbox, "requests", `${id}.json`),
      JSON.stringify({
        schema_version: 1,
        id,
        kind: "debate_request",
        prompt: "decide X",
        repo: realpathSync(ctx.repo),
        fast: false,
        providers: ["codex"],
      }),
    );

    const respPath = join(mailbox, "responses", `${id}.json`);
    await waitFor(() => existsSync(respPath), 15000, `response ${id}.json (stderr: ${stderr})`);

    const resp = JSON.parse(readFileSync(respPath, "utf8"));
    assert.equal(resp.status, "error", JSON.stringify(resp));
    assert.match(resp.status_reason, /provider .*claude.*not in allowlist/);
    assert.match(readFileSync(codexArgs, "utf8"), /--output-schema/, "codex should have run as planner");
    assert.ok(!existsSync(claudeArgs), "invalid claude worker plan must be rejected before launch");
  } finally {
    if (daemon?.pid !== undefined) {
      try {
        process.kill(-daemon.pid, "SIGKILL");
      } catch {
        try {
          daemon.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    cleanup(ctx.root);
  }
});

test("watch daemon: a fast request skips the planner and runs the fixed 2-phase shape", async () => {
  const ctx = setup();
  // No planner runs in fast mode: the daemon builds a fixed 2-phase plan in code.
  // With providers omitted, the request defaults to codex-only, so every worker
  // is codex and no claude process should launch.
  const claudeArgs = join(ctx.root, "claude_args");
  const codexArgs = join(ctx.root, "codex_args");
  makeStub(
    ctx.binDir,
    "claude",
    "#!/usr/bin/env bash\n" +
      `echo "$@" >> ${JSON.stringify(claudeArgs)}\n` +
      "cat >/dev/null\n" +
      "printf 'claude should not launch for omitted providers default\\n' >&2\n" +
      "exit 9\n",
  );
  makeStub(ctx.binDir, "codex", "#!/usr/bin/env bash\n" + `echo "$@" >> ${JSON.stringify(codexArgs)}\n` + "input=$(cat)\nprintf 'CODEX[%s]\\n' \"$input\"\n");
  const mailbox = join(ctx.root, "mailbox");
  const env = cliEnv(ctx, { DEBATE_AGENT_MAILBOX: mailbox });
  let daemon: ReturnType<typeof spawn> | undefined;
  try {
    let stderr = "";
    daemon = spawn(process.execPath, [BIN, "--config", ctx.cfg, "watch"], { env, detached: true });
    daemon.stderr!.on("data", (d: Buffer) => (stderr += d.toString()));
    daemon.on("error", (e) => (stderr += `spawn error: ${String(e)}`));
    await waitFor(() => stderr.includes("polling every"), 8000, `daemon banner (stderr so far: ${stderr})`);

    const id = "20260531-itest-fast";
    writeFileSync(
      join(mailbox, "requests", `${id}.json`),
      JSON.stringify({ schema_version: 1, id, kind: "debate_request", prompt: "decide X", repo: realpathSync(ctx.repo), fast: true }),
    );

    const respPath = join(mailbox, "responses", `${id}.json`);
    await waitFor(() => existsSync(respPath), 15000, `response ${id}.json (stderr: ${stderr})`);

    const resp = JSON.parse(readFileSync(respPath, "utf8"));
    assert.equal(resp.status, "completed", JSON.stringify(resp));
    // omitted providers defaults to codex-only: P1/P2/A1 all run on codex.
    assert.deepEqual(
      resp.trace.map((t: { item: string; provider: string }) => `${t.item}:${t.provider}`),
      ["P1:codex", "P2:codex", "A1:codex"],
    );
    // the arbiter answer embeds BOTH workers' outputs (mechanical substitution)
    assert.match(resp.answer_markdown, /CODEX\[/);
    // PROOF the planner was skipped: no planner stream file, and no --json-schema
    // (the planner's structured-output flag) ever reached any worker stub.
    assert.ok(!existsSync(join(mailbox, "responses", `${id}.streams`, "planner-1.log")), "no planner stream in fast mode");
    assert.ok(!existsSync(claudeArgs), "claude should not launch when providers is omitted");
    assert.ok(!readFileSync(codexArgs, "utf8").includes("--output-schema"), "no planner call (no --output-schema)");
  } finally {
    if (daemon?.pid !== undefined) {
      try {
        process.kill(-daemon.pid, "SIGKILL");
      } catch {
        try {
          daemon.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    cleanup(ctx.root);
  }
});

test("timeout kills process group", async () => {
  const ctx = setup();
  try {
    const marker = join(ctx.root, "done.marker");
    const timeoutStub = "#!/usr/bin/env bash\n" + `( sleep 6 && echo DONE > "${marker}" ) &\n` + "wait\n";
    makeStub(ctx.binDir, "claude", timeoutStub);
    writeConfig(ctx.cfg, ctx.repo);

    const req = join(ctx.root, "req.json");
    writeRequest(req, ctx.repo, { timeout_seconds: 1 });
    const start = Date.now();
    const proc = runCli(ctx, ["--config", ctx.cfg, "run", "--request", req]);
    const elapsed = (Date.now() - start) / 1000;

    const result = JSON.parse(proc.stdout);
    assert.equal(result.status, "timed_out");
    assert.equal(result.error_category, "timeout");
    assert.ok(elapsed < 6, "runner should return at timeout, not wait for the child");

    await new Promise((r) => setTimeout(r, 7000)); // outlast the stub's sleep
    assert.ok(!existsSync(marker), "grandchild survived: process group was not killed");
  } finally {
    cleanup(ctx.root);
  }
});

// --- installed launcher ----------------------------------------------------

function installSetup() {
  const root = makeTempDir();
  const home = join(root, "home");
  mkdirSync(home);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const binDir = join(root, "stubbin");
  mkdirSync(binDir);
  makeStub(binDir, "claude", CLAUDE_STUB);
  const cfg = join(root, "allowlist.json");
  writeConfig(cfg, repo);
  return { root, home, repo, binDir, cfg };
}

test("frozen install then run", () => {
  const c = installSetup();
  try {
    const inst = spawnSync("bash", [INSTALL], { encoding: "utf8", env: { ...process.env, HOME: c.home } });
    assert.equal(inst.status, 0, inst.stderr);
    const launcher = join(c.home, ".local", "bin", "debate-agent");
    assert.ok(existsSync(launcher));
    assert.ok(!lstatSync(launcher).isSymbolicLink(), "frozen install must be a real file");

    const req = join(c.root, "req.json");
    writeRequest(req, c.repo);
    const env = { ...process.env, HOME: c.home, PATH: `${c.binDir}${delimiter}${process.env.PATH ?? ""}` };
    const proc = spawnSync(process.execPath, [launcher, "--config", c.cfg, "run", "--request", req], { encoding: "utf8", env });
    assert.equal(proc.status, 0, proc.stderr);
    const result = JSON.parse(proc.stdout);
    assert.equal(result.status, "completed");
    assert.ok(result.audit_path.startsWith(realpathSync(c.home)));
  } finally {
    cleanup(c.root);
  }
});

test("installed launcher runs via exec bit and shebang", () => {
  const c = installSetup();
  try {
    const inst = spawnSync("bash", [INSTALL], { encoding: "utf8", env: { ...process.env, HOME: c.home } });
    assert.equal(inst.status, 0, inst.stderr);
    const launcher = join(c.home, ".local", "bin", "debate-agent");
    accessSync(launcher, constants.X_OK);

    const req = join(c.root, "req.json");
    writeRequest(req, c.repo);
    const env = { ...process.env, HOME: c.home, PATH: `${c.binDir}${delimiter}${process.env.PATH ?? ""}` };
    // Invoke the path DIRECTLY (no node prefix): exec bit + shebang must carry it.
    const proc = spawnSync(launcher, ["--config", c.cfg, "run", "--request", req], { encoding: "utf8", env });
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(JSON.parse(proc.stdout).status, "completed");
  } finally {
    cleanup(c.root);
  }
});

test("symlink install is live link", () => {
  const c = installSetup();
  try {
    const inst = spawnSync("bash", [INSTALL, "--symlink"], { encoding: "utf8", env: { ...process.env, HOME: c.home } });
    assert.equal(inst.status, 0, inst.stderr);
    const launcher = join(c.home, ".local", "bin", "debate-agent");
    assert.ok(lstatSync(launcher).isSymbolicLink());
    assert.equal(realpathSync(launcher), realpathSync(BIN));
  } finally {
    cleanup(c.root);
  }
});

// --- opt-in codex rules check ----------------------------------------------

test("codex execpolicy matches runner path (opt-in)", { skip: !(process.env.DEBATE_AGENT_CODEX_RULES_TEST === "1" && which("codex")) }, () => {
  const d = makeTempDir();
  try {
    const runnerPath = "/Users/test/.local/bin/debate-agent";
    const rules = join(d, "default.rules");
    const gen = spawnSync(process.execPath, [BIN, "print-rules", "--path", runnerPath], { encoding: "utf8" });
    require("node:fs").writeFileSync(rules, gen.stdout);
    const check = spawnSync(
      "codex",
      ["execpolicy", "check", "--rules", rules, "--", runnerPath, "run", "--request", "/abs/request.json"],
      { encoding: "utf8" },
    );
    assert.equal(check.status, 0, check.stderr);
    const payload = JSON.parse(check.stdout);
    assert.equal(payload.decision, "prompt", check.stdout);
    const prefixes = (payload.matchedRules ?? []).flatMap((r: any) => r.prefixRuleMatch?.matchedPrefix ?? []);
    assert.ok(prefixes.includes(runnerPath), check.stdout);
  } finally {
    cleanup(d);
  }
});
