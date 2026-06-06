// Real-CLI end-to-end eval for the daemon. Drops a debate_request into a
// self-contained local mailbox and runs the whole flow — plan (real planner CLI)
// then execute (real worker CLIs) — then prints the response.
//
//   npm run build && node dist/evals/run-eval.js [path/to/request.json]
//   node dist/evals/run-eval.js --mock        # offline wiring check, no real CLI
//
// The planner reuses the debate-router skill's strategy (install it for the
// planner CLI). Request providers decide the planner; real runs require the
// selected CLIs on PATH and logged in.

import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Allowlist, DEFAULT_ALLOWLIST } from "../src/allowlist";
import { DebateDeps } from "../src/debate";
import { openMailbox } from "../src/mailbox";
import { PlannerFn } from "../src/planner";
import { BatchItemResult } from "../src/runner";
import { processNewRequests } from "../src/watch";

const EVALS = resolve(__dirname, "..", "..", "evals"); // source evals/ dir
const fixtureRepo = realpathSync(join(EVALS, "fixture-repo"));
const mailboxDir = join(EVALS, "mailbox"); // scratch; never ~/.debate-router

function parseArgs(argv: string[]) {
  const mock = argv.includes("--mock");
  const pi = argv.indexOf("--planner");
  const plannerProvider = pi >= 0 ? argv[pi + 1]! : undefined;
  const reqArg = argv.find((a) => a.endsWith(".json"));
  const reqPath = reqArg ?? join(EVALS, "requests", "sample-debate.json");
  return { mock, plannerProvider, reqPath };
}

/** Fully stubbed deps for offline plumbing checks (scripted plan + stub workers). */
function mockDeps(): () => DebateDeps {
  const plan = JSON.stringify({
    complexity: "simple",
    phases: [
      { name: "proposal_generation", launches: [
        { id: "P1", provider: "codex", effort: "xhigh", prompt: "argue for in-house auth" },
        { id: "P2", provider: "codex", effort: "xhigh", prompt: "argue for a managed provider" },
      ] },
      { name: "arbitration", launches: [
        { id: "A1", provider: "codex", effort: "xhigh", prompt: "Proposals:\n{{P1.output}}\n{{P2.output}}\nDecide." },
      ] },
    ],
    answer_item: "A1",
  });
  const planner: PlannerFn = async () => plan;
  const runItems: DebateDeps["runItems"] = async (items) =>
    items.map((it): BatchItemResult => ({ item_id: it.itemId, status: "completed", provider: it.req!.provider }));
  const readOutput = (r: BatchItemResult): string => `(MOCK output of ${r.item_id})`;
  return () => ({ planner, runItems, readOutput });
}

async function main(): Promise<void> {
  const { mock, plannerProvider, reqPath } = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(readFileSync(reqPath, "utf8").replace(/__FIXTURE_REPO__/g, fixtureRepo));
  const allow: Allowlist = {
    ...DEFAULT_ALLOWLIST,
    repoRoots: [fixtureRepo],
    modes: ["debate-proposal", "debate-critique", "debate-cross-review"],
    providers: ["claude", "codex"],
    capabilities: ["read_only_review"], // lock the eval to read-only (the runner forces it anyway)
  };

  process.env.DEBATE_AGENT_MAILBOX = mailboxDir;
  rmSync(mailboxDir, { recursive: true, force: true });
  const mb = openMailbox();
  writeFileSync(join(mb.requestsDir, `${raw.id}.json`), JSON.stringify(raw, null, 2));

  const opts = mock ? { makeDeps: mockDeps() } : plannerProvider ? { plannerProvider } : {};
  process.stderr.write(
    `Running debate "${raw.id}" (${mock ? "MOCK" : `real CLIs, planner from request providers${plannerProvider ? `; legacy --planner=${plannerProvider}` : ""}`}); mailbox ${mailboxDir}\n`,
  );

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
