// Shared test helpers.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Allowlist } from "../src/allowlist";
import { realpathLenient } from "../src/paths";

export function makeTempDir(prefix = "dr-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function makeStub(dir: string, name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

export const CLAUDE_STUB =
  "#!/usr/bin/env bash\n" +
  'echo "CWD=$(pwd)"\n' +
  'echo "ARGS=$*"\n' +
  "echo -n 'STDIN='\n" +
  "cat\n";

/**
 * A stub that records the fact it was launched by touching `markerPath`. Used
 * for the negative proof that a *rejected* request never spawns a child: the
 * marker path is baked into the script body, so it needs no env passthrough.
 */
export function makeMarkerStub(dir: string, name: string, markerPath: string): string {
  return makeStub(dir, name, `#!/usr/bin/env bash\necho launched > ${JSON.stringify(markerPath)}\n`);
}

export function makeAllowlist(repoRoot: string, overrides: Partial<Allowlist> = {}): Allowlist {
  return {
    repoRoots: [realpathLenient(repoRoot)],
    modes: ["debate-proposal"],
    providers: ["claude", "codex"],
    profiles: { claude: [], codex: ["work"] },
    capabilities: ["read_only_review", "workspace_write"],
    maxPromptChars: 200000,
    maxBatchItems: 8,
    maxParallel: 4,
    maxParallelPerProvider: 2,
    ...overrides,
  };
}

export function baseRequest(repo: string): Record<string, unknown> {
  return {
    schema_version: 1,
    run_id: "20260530-abc",
    phase: "proposal_generation",
    provider: "claude",
    mode: "debate-proposal",
    repo,
    prompt: "propose something",
  };
}

export function writeConfig(path: string, repoRoot: string): void {
  writeFileSync(
    path,
    JSON.stringify({
      repo_roots: [repoRoot],
      modes: ["debate-proposal"],
      providers: ["claude", "codex"],
      profiles: { claude: [], codex: [] },
      limits: { max_prompt_chars: 200000 },
    }),
  );
}

export function writeRequest(path: string, repo: string, overrides: Record<string, unknown> = {}): void {
  writeFileSync(
    path,
    JSON.stringify({
      schema_version: 1,
      run_id: "20260530-itest",
      phase: "proposal_generation",
      provider: "claude",
      mode: "debate-proposal",
      repo,
      prompt: "PROMPT-MARKER-XYZ",
      ...overrides,
    }),
  );
}

export function makeRequest(repo: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    run_id: "20260530-batch",
    phase: "proposal_generation",
    provider: "claude",
    mode: "debate-proposal",
    repo,
    prompt: "PROMPT-MARKER-XYZ",
    ...overrides,
  };
}

export function writeBatch(
  path: string,
  items: Array<{ item_id: string; request: Record<string, unknown> }>,
  envelope: Record<string, unknown> = {},
): void {
  writeFileSync(
    path,
    JSON.stringify({ schema_version: 1, batch_id: "20260530-batch", items, ...envelope }),
  );
}
