// Watch path end-to-end with REAL subprocess spawns (no mocked workers).
//
// Closes the gap the other watch tests leave: here processNewRequests runs the
// daemon's batch executor and the workers are really spawned via the runner's
// execute(). A bash stub stands in for the CLI (records its argv, returns text),
// so we assert the response (with the worker's stdout embedded), the
// claimed→cleared processing entry, the live <id>.log, and that the read-only
// argv actually reached the child.

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

test("watch e2e: real worker spawn, response items + embedded output + live log + read-only argv", async () => {
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
    JSON.stringify({
      schema_version: 1,
      id,
      kind: "run_batch_request",
      repo: realpathSync(repo),
      items: [{ item_id: "P1", provider: "claude", prompt: "propose", phase: "proposal_generation" }],
    }),
  );

  const baseEnv = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`, HOME: root };
  const processed = await processNewRequests(mb, ignore, allow, { baseEnv });

  assert.deepEqual(processed, [id]);

  // 1) response written, completed, with the worker's stdout embedded
  const resp = JSON.parse(readFileSync(join(mb.responsesDir, `${id}.json`), "utf8"));
  assert.equal(resp.kind, "run_batch_result");
  assert.equal(resp.status, "completed");
  assert.equal(resp.items.length, 1);
  assert.equal(resp.items[0].item_id, "P1");
  assert.equal(resp.items[0].provider, "claude");
  assert.equal(resp.items[0].status, "completed");
  assert.match(resp.items[0].output, /PROPOSAL-TEXT/); // the skill reads this directly — no audit access needed

  // 2) the request was claimed then cleared from processing/
  assert.ok(!existsSync(join(mb.processingDir, `${id}.json`)), "processing entry cleared");

  // 3) a live progress log sits next to the response and reflects real work
  const log = readFileSync(join(mb.responsesDir, `${id}.log`), "utf8");
  assert.match(log, /run_batch 20260531-e2e-real/);
  assert.match(log, /P1 claude completed/);
  assert.match(log, /done: completed/);

  // 4) the read-only argv actually reached the spawned claude worker
  const workerArgs = readFileSync(argsFile, "utf8");
  assert.match(workerArgs, /--permission-mode default/);
  assert.match(workerArgs, /--disallowedTools/);
  // the prompt is NOT in argv (stdin transport)
  assert.ok(!workerArgs.includes("propose"));
});
