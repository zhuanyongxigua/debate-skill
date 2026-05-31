// Watch path end-to-end with REAL subprocess spawns (no mocked brain/worker).
//
// Closes the gap the other watch tests leave: here processNewRequests drives the
// real step loop, makeCliBrain spawns a real "brain" CLI, and the workers are
// really spawned via the runner's execute(). Bash stubs stand in for the CLIs
// (brain=codex emits StepDecision JSON; worker=claude records its argv), so we
// assert the response, the claimed→cleared processing entry, the live <id>.log,
// and that the read-only argv actually reached the child.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { openMailbox, snapshotRequestIds } from "../src/mailbox";
import { processNewRequests } from "../src/watch";
import { cleanup, makeAllowlist, makeStub, makeTempDir } from "./helpers";

let root: string;
let repo: string;
let binDir: string;

beforeEach(() => {
  root = makeTempDir();
  repo = join(root, "repo");
  mkdirSync(repo);
  binDir = join(root, "bin");
  mkdirSync(binDir);
  process.env.DEBATE_AGENT_MAILBOX = join(root, "mailbox");
  process.env.DEBATE_AGENT_AUDIT_HOME = join(root, "audit");
});

afterEach(() => {
  delete process.env.DEBATE_AGENT_MAILBOX;
  delete process.env.DEBATE_AGENT_AUDIT_HOME;
  cleanup(root);
});

test("watch e2e: real brain + worker spawns, response + live log + read-only argv", async () => {
  // brain = codex stub: 1st call → run one claude proposer; 2nd call → final.
  const counter = join(root, "brain_calls");
  makeStub(
    binDir,
    "codex",
    "#!/usr/bin/env bash\n" +
      "cat >/dev/null\n" +
      `n=$(cat ${JSON.stringify(counter)} 2>/dev/null || echo 0)\n` +
      `echo $((n+1)) > ${JSON.stringify(counter)}\n` +
      'if [ "$n" -eq 0 ]; then\n' +
      `  printf '{"kind":"run","phase":"proposal_generation","launches":[{"id":"P1","provider":"claude","prompt":"propose"}]}\\n'\n` +
      "else\n" +
      `  printf '{"kind":"final","status":"completed","answer_markdown":"DONE-ANSWER"}\\n'\n` +
      "fi\n",
  );
  // worker = claude stub: records the argv it was launched with, returns text.
  const argsFile = join(root, "claude_args");
  makeStub(
    binDir,
    "claude",
    "#!/usr/bin/env bash\n" + `echo "$@" >> ${JSON.stringify(argsFile)}\n` + "cat >/dev/null\n" + "printf 'PROPOSAL-TEXT\\n'\n",
  );

  const allow = makeAllowlist(repo, { modes: ["debate-proposal", "debate-critique", "debate-cross-review"] });
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb); // empty
  const id = "20260531-e2e-real";
  writeFileSync(
    join(mb.requestsDir, `${id}.json`),
    JSON.stringify({ schema_version: 1, id, kind: "debate_request", prompt: "debate this", repo: realpathSync(repo) }),
  );

  const baseEnv = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`, HOME: root };
  const processed = await processNewRequests(mb, ignore, allow, { brainProvider: "codex", baseEnv });

  assert.deepEqual(processed, [id]);

  // 1) response written, completed, with the brain's answer + the daemon-built Trace
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, `${id}.json`), "utf8"));
  assert.equal(resp.status, "completed");
  assert.match(resp.answer_markdown, /DONE-ANSWER/);
  assert.match(resp.answer_markdown, /## Trace/);
  assert.deepEqual(
    resp.cli_participation.map((r: { worker: string; provider: string; status: string }) => `${r.worker}:${r.provider}:${r.status}`),
    ["P1:claude:completed"],
  );

  // 2) the request was claimed then cleared from processing/
  assert.ok(!existsSync(join(mb.processingDir, `${id}.json`)), "processing entry cleared");

  // 3) a live progress log sits next to the response and reflects real steps
  const log = readFileSync(join(mb.responsesDir, `${id}.log`), "utf8");
  assert.match(log, /step 1: proposal_generation — launching P1 claude/);
  assert.match(log, /P1 claude completed/);
  assert.match(log, /done: completed in 1 step\(s\)/);

  // 4) the read-only argv actually reached the spawned claude worker
  const workerArgs = readFileSync(argsFile, "utf8");
  assert.match(workerArgs, /--permission-mode default/);
  assert.match(workerArgs, /--disallowedTools/);
  // the prompt is NOT in argv (stdin transport)
  assert.ok(!workerArgs.includes("propose"));
});
