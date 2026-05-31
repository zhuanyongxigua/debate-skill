// Watch path with a scripted planner but REAL worker subprocess spawns.
//
// The planner is injected (returns a fixed plan), but the workers are really
// spawned via the runner's execute() (runItems defaults to the real
// runPreparedItems). A bash stub stands in for the worker CLI (records its argv,
// returns text). We assert the response (answer = worker stdout), the
// claimed→cleared processing entry, the live <id>.log, and that the read-only
// argv reached the child.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { DebateDeps } from "../src/debate";
import { openMailbox, snapshotRequestIds } from "../src/mailbox";
import { PlannerFn } from "../src/planner";
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

test("watch e2e: scripted plan + real worker spawn, answer + live log + read-only argv", async () => {
  // worker = claude stub: records the argv it was launched with, returns text.
  const argsFile = join(root, "claude_args");
  makeStub(
    binDir,
    "claude",
    "#!/usr/bin/env bash\n" + `echo "$@" >> ${JSON.stringify(argsFile)}\n` + "cat >/dev/null\n" + "printf 'FINAL-ANSWER\\n'\n",
  );

  const allow = makeAllowlist(repo, { modes: ["debate-proposal", "debate-critique", "debate-cross-review"] });
  const mb = openMailbox();
  const ignore = snapshotRequestIds(mb);
  const id = "20260531-e2e-real";
  writeFileSync(
    join(mb.requestsDir, `${id}.json`),
    JSON.stringify({ schema_version: 1, id, kind: "debate_request", prompt: "debate this", repo: realpathSync(repo) }),
  );

  const baseEnv = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`, HOME: root };
  const plan = JSON.stringify({
    phases: [{ name: "arbitration", launches: [{ id: "A1", provider: "claude", prompt: "decide and answer" }] }],
    answer_item: "A1",
  });
  const planner: PlannerFn = async () => plan; // injected planner; workers are REAL
  const makeDeps = (): DebateDeps => ({ planner, baseEnv }); // runItems defaults to real runPreparedItems

  const processed = await processNewRequests(mb, ignore, allow, { makeDeps });
  assert.deepEqual(processed, [id]);

  // 1) response: completed, answer is the real worker's stdout
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, `${id}.json`), "utf8"));
  assert.equal(resp.kind, "debate_result");
  assert.equal(resp.status, "completed", JSON.stringify(resp));
  assert.match(resp.answer_markdown, /FINAL-ANSWER/);
  assert.deepEqual(resp.trace.map((t: { item: string; provider: string; status: string }) => `${t.item}:${t.provider}:${t.status}`), ["A1:claude:completed"]);

  // 2) claimed then cleared from processing/
  assert.ok(!existsSync(join(mb.processingDir, `${id}.json`)), "processing entry cleared");

  // 3) live progress log reflects the real execution
  const log = readFileSync(join(mb.responsesDir, `${id}.log`), "utf8");
  assert.match(log, /A1 claude completed/);
  assert.match(log, /done: completed/);

  // 4) the read-only argv actually reached the spawned worker
  const workerArgs = readFileSync(argsFile, "utf8");
  assert.match(workerArgs, /--permission-mode default/);
  assert.match(workerArgs, /--disallowedTools/);
  assert.ok(!workerArgs.includes("decide and answer")); // prompt on stdin, not argv
});
