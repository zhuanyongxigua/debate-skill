// Real-LLM end-to-end eval. Drops a debate request into a self-contained local
// mailbox and runs the daemon's step loop against a REAL brain (claude/codex)
// and REAL workers, then prints the response. This exercises the whole flow with
// an actual model — unlike test/, which mocks the brain/worker seam.
//
//   npm run build && node dist/evals/run-eval.js [--brain claude|codex] [path/to/request.json]
//   node dist/evals/run-eval.js --mock        # offline wiring check, no real model
//
// Real runs require `claude` (and `codex`, if the brain allocates it) on PATH
// and logged in. The brain authors each worker's prompt; the brain itself works
// best with the debate-router skill installed, but the prompt also restates the
// plan/step contract so a bare model can still drive a basic debate.

import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Allowlist, DEFAULT_ALLOWLIST } from "../src/allowlist";
import { StepDecision } from "../src/brain";
import { DebateDeps } from "../src/debate";
import { openMailbox } from "../src/mailbox";
import { BatchItemResult } from "../src/runner";
import { processNewRequests } from "../src/watch";

const EVALS = resolve(__dirname, "..", "..", "evals"); // source evals/ dir
const fixtureRepo = realpathSync(join(EVALS, "fixture-repo"));
const mailboxDir = join(EVALS, "mailbox"); // scratch; never ~/.debate-router

function parseArgs(argv: string[]) {
  const mock = argv.includes("--mock");
  const bi = argv.indexOf("--brain");
  const brainProvider = bi >= 0 ? argv[bi + 1]! : "claude";
  const reqArg = argv.find((a) => a.endsWith(".json"));
  const reqPath = reqArg ?? join(EVALS, "requests", "sample-debate.json");
  return { mock, brainProvider, reqPath };
}

/** Fully stubbed deps for offline plumbing checks (no real model). */
function mockDeps(): DebateDeps {
  let n = 0;
  const brain = async (): Promise<StepDecision> => {
    n++;
    if (n === 1) {
      return {
        kind: "run",
        phase: "proposal_generation",
        launches: [
          { id: "P1", provider: "codex", prompt: "propose build-in-house" },
          { id: "P2", provider: "claude", prompt: "propose managed-provider" },
        ],
      };
    }
    if (n === 2) return { kind: "run", phase: "critique", launches: [{ id: "C1", provider: "claude", prompt: "critique both" }] };
    return { kind: "final", status: "completed", answer_markdown: "## Decision\n(MOCK) Use a managed provider for the deadline." };
  };
  const runItems: DebateDeps["runItems"] = async (items) =>
    items.map((it): BatchItemResult => {
      if (it.rejected !== undefined) return { item_id: it.itemId, status: "rejected", reject_reason: it.rejected };
      const p = join(mailboxDir, `${it.itemId}.out.txt`);
      writeFileSync(p, `mock output of ${it.itemId}`);
      return { item_id: it.itemId, status: "completed", provider: it.req!.provider, stdout_path: p };
    });
  return { brain, runItems, maxSteps: 8 };
}

async function main(): Promise<void> {
  const { mock, brainProvider, reqPath } = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(readFileSync(reqPath, "utf8").replace(/__FIXTURE_REPO__/g, fixtureRepo));
  const allow: Allowlist = {
    ...DEFAULT_ALLOWLIST,
    repoRoots: [fixtureRepo],
    modes: ["debate-proposal", "debate-critique", "debate-cross-review"],
    providers: ["claude", "codex"],
    capabilities: ["read_only_review"], // lock the eval to read-only (the debate flow forces it anyway)
  };

  // self-contained scratch mailbox
  process.env.AGENT_RUNNER_MAILBOX = mailboxDir;
  rmSync(mailboxDir, { recursive: true, force: true });
  const mb = openMailbox();
  writeFileSync(join(mb.requestsDir, `${raw.id}.json`), JSON.stringify(raw, null, 2));

  const opts = mock ? { makeDeps: mockDeps } : { brainProvider, maxSteps: 8 };
  process.stderr.write(`Running debate "${raw.id}" (brain=${mock ? "MOCK" : brainProvider}); mailbox ${mailboxDir}\n`);

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
