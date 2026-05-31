// Real-CLI end-to-end eval for the daemon's execution primitive. Drops a
// run_batch_request into a self-contained local mailbox and runs the daemon's
// batch executor against REAL workers (claude/codex), then prints the response.
//
//   npm run build && node dist/evals/run-eval.js [path/to/request.json]
//   node dist/evals/run-eval.js --mock        # offline wiring check, no real CLI
//
// The debate PLANNING lives in the debate-router skill (it composes these
// requests), not here — this eval only exercises the runner's read-only batch
// execution and the embedded-output response. Real runs require `claude`/`codex`
// on PATH and logged in.

import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Allowlist, DEFAULT_ALLOWLIST } from "../src/allowlist";
import { openMailbox } from "../src/mailbox";
import { BatchDeps } from "../src/mailbox-batch";
import { BatchItemResult, PreparedItem } from "../src/runner";
import { processNewRequests } from "../src/watch";

const EVALS = resolve(__dirname, "..", "..", "evals"); // source evals/ dir
const fixtureRepo = realpathSync(join(EVALS, "fixture-repo"));
const mailboxDir = join(EVALS, "mailbox"); // scratch; never ~/.debate-router

function parseArgs(argv: string[]) {
  const mock = argv.includes("--mock");
  const reqArg = argv.find((a) => a.endsWith(".json"));
  const reqPath = reqArg ?? join(EVALS, "requests", "sample-debate.json");
  return { mock, reqPath };
}

/** Fully stubbed executor for offline plumbing checks (no real CLI). */
function mockDeps(): Pick<BatchDeps, "runItems"> {
  const runItems = async (items: PreparedItem[]): Promise<BatchItemResult[]> =>
    items.map((it): BatchItemResult => {
      if (it.rejected !== undefined) return { item_id: it.itemId, status: "rejected", reject_reason: it.rejected };
      const p = join(mailboxDir, `${it.itemId}.out.txt`);
      writeFileSync(p, `mock output of ${it.itemId}`);
      return { item_id: it.itemId, status: "completed", provider: it.req!.provider, stdout_path: p };
    });
  return { runItems };
}

async function main(): Promise<void> {
  const { mock, reqPath } = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(readFileSync(reqPath, "utf8").replace(/__FIXTURE_REPO__/g, fixtureRepo));
  const allow: Allowlist = {
    ...DEFAULT_ALLOWLIST,
    repoRoots: [fixtureRepo],
    modes: ["debate-proposal", "debate-critique", "debate-cross-review"],
    providers: ["claude", "codex"],
    capabilities: ["read_only_review"], // lock the eval to read-only (the runner forces it anyway)
  };

  // self-contained scratch mailbox
  process.env.DEBATE_AGENT_MAILBOX = mailboxDir;
  rmSync(mailboxDir, { recursive: true, force: true });
  const mb = openMailbox();
  writeFileSync(join(mb.requestsDir, `${raw.id}.json`), JSON.stringify(raw, null, 2));

  const opts = mock ? mockDeps() : {};
  process.stderr.write(`Running run_batch "${raw.id}" (${mock ? "MOCK" : "real CLIs"}); mailbox ${mailboxDir}\n`);

  const processed = await processNewRequests(mb, new Set<string>(), allow, opts);
  for (const id of processed) {
    process.stderr.write(`\n--- response ${id} ---\n`);
    process.stdout.write(readFileSync(join(mb.responsesDir, `${id}.json`), "utf8") + "\n");
  }
  if (processed.length === 0) process.stderr.write("no request processed\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
