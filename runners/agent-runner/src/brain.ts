// The "brain": debate-router running in read-only plan/step mode. Given the
// current debate state, it returns the SINGLE next action — either a set of
// read-only CLI launches to run next, or the final answer. It never spawns or
// writes; the daemon does all execution. This keeps every CLI read-only.

import { buildChildLaunch } from "./launch";
import { execute } from "./runner";

export interface BrainLaunch {
  id: string;
  provider: string;
  prompt: string;
}

export type StepDecision =
  | { kind: "run"; phase: string; launches: BrainLaunch[] }
  | {
      kind: "final";
      status: string; // completed | degraded | blocked
      status_reason?: string;
      answer_markdown: string;
      debate_record?: unknown;
    };

export interface PhaseResult {
  id: string;
  provider: string;
  status: string;
  output: string;
}

export interface DebateState {
  request: { id: string; prompt: string; repo: string; output_contract: Record<string, unknown> | null };
  history: { phase: string; results: PhaseResult[] }[];
}

export class BrainError extends Error {}

const CONTRACT = `You are debate-router operating in PLAN/STEP mode (read-only).
Apply the debate-router protocol to decide the SINGLE next action for this debate,
given the state below. You do NOT run anything yourself — you only return the next
action as one JSON object, and the runner executes it.

Output EXACTLY one JSON object and nothing else (no prose, no markdown fences):

To run the next phase (independent read-only CLI workers, fanned out in parallel):
{"kind":"run","phase":"proposal_generation|critique|cross_review|arbitration|other",
 "launches":[{"id":"P1","provider":"claude|codex","prompt":"<full prompt for this worker>"}]}

When the debate is done:
{"kind":"final","status":"completed|degraded|blocked","status_reason":"",
 "answer_markdown":"<final answer, in the caller's required output format if any>"}

Rules:
- Each launch is an independent, read-only worker; write the complete prompt it needs.
- Allocate providers per the protocol (e.g. 4 agents = 2 codex + 2 claude).
- Read prior phase outputs from state.history to write the next phase's prompts and
  to decide normalization / critique / cross-review / arbitration / degrade.
- Capability is forced to read-only by the runner; never ask a worker to edit files.`;

export function buildBrainPrompt(state: DebateState): string {
  return `${CONTRACT}\n\n## Debate state\n\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`;
}

/** Tolerantly extract + validate a StepDecision from brain stdout. */
export function parseStepDecision(stdout: string): StepDecision {
  const text = stripFences(stdout).trim();
  const json = extractFirstJsonObject(text);
  if (json === null) throw new BrainError(`brain output is not a JSON object: ${truncate(text)}`);
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (err) {
    throw new BrainError(`brain output is not valid JSON: ${String(err)}`);
  }
  if (typeof obj !== "object" || obj === null) throw new BrainError("brain output must be an object");
  const d = obj as Record<string, unknown>;

  if (d.kind === "final") {
    if (typeof d.answer_markdown !== "string") throw new BrainError("final decision needs answer_markdown");
    const status = typeof d.status === "string" ? d.status : "completed";
    return {
      kind: "final",
      status,
      status_reason: typeof d.status_reason === "string" ? d.status_reason : "",
      answer_markdown: d.answer_markdown,
      debate_record: d.debate_record,
    };
  }
  if (d.kind === "run") {
    const phase = typeof d.phase === "string" ? d.phase : "other";
    if (!Array.isArray(d.launches) || d.launches.length === 0) {
      throw new BrainError("run decision needs a non-empty launches array");
    }
    const launches: BrainLaunch[] = d.launches.map((l, i) => {
      const o = l as Record<string, unknown>;
      if (typeof o.provider !== "string" || typeof o.prompt !== "string") {
        throw new BrainError(`launch[${i}] needs string provider and prompt`);
      }
      const id = typeof o.id === "string" && o.id.trim() ? o.id : `L${i + 1}`;
      return { id, provider: o.provider, prompt: o.prompt };
    });
    return { kind: "run", phase, launches };
  }
  throw new BrainError(`brain decision kind must be "run" or "final", got ${JSON.stringify(d.kind)}`);
}

function stripFences(s: string): string {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence ? fence[1]! : s;
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Injectable brain function so tests can substitute a scripted brain. */
export type BrainFn = (state: DebateState) => Promise<StepDecision>;

export interface BrainOptions {
  provider: string; // claude (default) or codex
  baseEnv?: Record<string, string | undefined>;
  timeoutSeconds?: number;
}

/** Default brain: spawn the configured CLI read-only on the brain prompt and
 * parse its stdout as a StepDecision. */
export function makeCliBrain(repo: string, opts: BrainOptions): BrainFn {
  return async (state: DebateState): Promise<StepDecision> => {
    const launch = buildChildLaunch({
      provider: opts.provider,
      cwd: repo,
      profile: null,
      capability: "read_only_review",
      prompt: buildBrainPrompt(state),
      baseEnv: opts.baseEnv ?? process.env,
    });
    const result = await execute(launch, opts.timeoutSeconds ?? 1800);
    if (result.status !== "completed") {
      throw new BrainError(`brain CLI ${result.status} (${result.errorCategory ?? "?"}): ${truncate(result.stderr)}`);
    }
    return parseStepDecision(result.stdout);
  };
}
