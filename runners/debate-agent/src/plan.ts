// The debate PLAN: the one strict structured artifact in the daemon.
//
// A planner CLI (planner.ts) emits a plan; the daemon validates it here and, on
// invalid output, retries. The plan is a static DAG of phases. Each phase has
// independent worker launches; a launch's prompt may embed an EARLIER launch's
// output with the placeholder `{{<id>.output}}`. The daemon executes the plan
// mechanically (debate.ts): run a phase, substitute its outputs forward as text,
// run the next — no LLM between phases. Debate STRATEGY is not encoded here (it
// lives in the debate-router skill, which the planner loads); this file owns only
// the plan FORMAT and its validation.

import { Allowlist, validEffortsFor } from "./allowlist";

export class PlanInvalid extends Error {}

export interface PlanLaunch {
  id: string;
  provider: string;
  prompt: string; // a template; may contain `{{<id>.output}}` referencing earlier launches
  effort?: string; // thinking depth the planner picked (per provider's valid set)
  fast?: boolean; // codex turbo (claude/copilot ignore it)
}

export interface PlanPhase {
  name: string; // audit label (e.g. proposal_generation, critique, arbitration)
  launches: PlanLaunch[];
}

export interface Plan {
  phases: PlanPhase[];
  answerItem: string; // the launch id whose output is the final answer
  complexity?: string; // the planner's "simple" | "complex" judgment (audit metadata)
}

// The plan's JSON Schema — the SHAPE only. Passed to the planner CLI's native
// structured-output flag (claude `--json-schema`, codex `--output-schema`) as the
// first line of defense, so the CLI itself emits well-formed JSON. It deliberately
// does NOT encode the policy/semantic checks (provider allowlist, unique ids
// across phases, `{{id.output}}` referencing an earlier phase, answer_item
// validity) — a JSON Schema can't express those; validatePlan does, with retry.
export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["phases", "answer_item"],
  properties: {
    phases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "launches"],
        properties: {
          name: { type: "string" },
          launches: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "provider", "prompt"],
              properties: {
                id: { type: "string" },
                provider: { type: "string" },
                prompt: { type: "string" },
                effort: { type: "string" },
                fast: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    answer_item: { type: "string" },
    complexity: { type: "string" },
  },
} as const;

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9._-]+)\.output\s*\}\}/g;
const MAX_PHASES = 8;

const ALLOWED_PLAN_FIELDS = new Set(["phases", "answer_item", "complexity"]);
const ALLOWED_PHASE_FIELDS = new Set(["name", "launches"]);
const ALLOWED_LAUNCH_FIELDS = new Set(["id", "provider", "prompt", "effort", "fast"]);

/** Item ids a prompt references via `{{id.output}}` (deduplicated, in order). */
export function placeholderRefs(prompt: string): string[] {
  const ids: string[] = [];
  for (const m of prompt.matchAll(PLACEHOLDER_RE)) {
    const id = m[1]!;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Replace every `{{id.output}}` with outputs[id] (missing => empty string). */
export function substitute(prompt: string, outputs: Record<string, string>): string {
  return prompt.replace(PLACEHOLDER_RE, (_full, id: string) => outputs[id] ?? "");
}

/**
 * Best-effort extraction of the plan JSON object from raw planner output.
 * Accepts a bare JSON object, or one wrapped in prose / ```json fences, by
 * slicing the first `{` to the last `}`. Throws PlanInvalid if nothing parses.
 */
export function parsePlan(text: string): unknown {
  const trimmed = text.trim();
  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  let parsed = tryParse(trimmed);
  if (parsed === undefined) {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) parsed = tryParse(trimmed.slice(first, last + 1));
  }
  if (parsed === undefined) {
    throw new PlanInvalid("planner output is not valid JSON (expected a single plan object)");
  }
  return parsed;
}

/**
 * Validate a parsed plan against the schema and the allowlist. Returns a typed
 * Plan or throws PlanInvalid with a precise reason (fed back to the planner on
 * retry). Enforces: strict fields, unique ids, allowlisted providers, non-empty
 * prompts within size, and that every `{{id.output}}` references a launch from a
 * STRICTLY earlier phase (acyclic, no same-phase or forward refs).
 */
export function validatePlan(raw: unknown, allow: Allowlist): Plan {
  const bad = (msg: string): never => {
    throw new PlanInvalid(msg);
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) bad("plan must be a JSON object");
  const obj = raw as Record<string, unknown>;
  const unknown = Object.keys(obj).filter((k) => !ALLOWED_PLAN_FIELDS.has(k));
  if (unknown.length) bad(`unknown plan field(s): ${JSON.stringify(unknown.sort())}`);

  if (!Array.isArray(obj.phases) || obj.phases.length === 0) bad("phases must be a non-empty array");
  const rawPhases = obj.phases as unknown[];
  if (rawPhases.length > MAX_PHASES) bad(`too many phases (${rawPhases.length} > ${MAX_PHASES})`);

  const allIds = new Set<string>();
  const idsBeforePhase: Set<string>[] = []; // ids available to phase i (defined strictly earlier)
  const phases: PlanPhase[] = [];

  // First pass: shape + ids, recording which ids exist before each phase.
  rawPhases.forEach((p, pi) => {
    if (typeof p !== "object" || p === null || Array.isArray(p)) bad(`phases[${pi}] must be an object`);
    const phase = p as Record<string, unknown>;
    const extra = Object.keys(phase).filter((k) => !ALLOWED_PHASE_FIELDS.has(k));
    if (extra.length) bad(`phases[${pi}] has unknown field(s): ${JSON.stringify(extra.sort())}`);
    if (typeof phase.name !== "string" || phase.name.trim() === "") bad(`phases[${pi}].name must be a non-empty string`);
    if (!Array.isArray(phase.launches) || phase.launches.length === 0) bad(`phases[${pi}].launches must be a non-empty array`);
    const rawLaunches = phase.launches as unknown[];
    if (rawLaunches.length > allow.maxBatchItems) {
      bad(`phases[${pi}] has ${rawLaunches.length} launches, exceeds max_batch_items (${allow.maxBatchItems})`);
    }

    idsBeforePhase[pi] = new Set(allIds); // snapshot before adding this phase's ids
    const launches: PlanLaunch[] = rawLaunches.map((l, li) => {
      if (typeof l !== "object" || l === null || Array.isArray(l)) bad(`phases[${pi}].launches[${li}] must be an object`);
      const launch = l as Record<string, unknown>;
      const lExtra = Object.keys(launch).filter((k) => !ALLOWED_LAUNCH_FIELDS.has(k));
      if (lExtra.length) bad(`phases[${pi}].launches[${li}] has unknown field(s): ${JSON.stringify(lExtra.sort())}`);

      const id = launch.id;
      if (typeof id !== "string" || !SLUG_RE.test(id) || id.includes("..")) {
        bad(`phases[${pi}].launches[${li}].id must be a safe slug`);
      }
      if (allIds.has(id as string)) bad(`duplicate launch id ${JSON.stringify(id)}`);
      allIds.add(id as string);

      const provider = launch.provider;
      if (typeof provider !== "string" || !allow.providers.includes(provider)) {
        bad(`phases[${pi}].launches[${li}].provider ${JSON.stringify(provider)} not in allowlist ${JSON.stringify(allow.providers)}`);
      }

      const prompt = launch.prompt;
      if (typeof prompt !== "string" || prompt.trim() === "") bad(`phases[${pi}].launches[${li}].prompt must be a non-empty string`);
      if ((prompt as string).length > allow.maxPromptChars) {
        bad(`phases[${pi}].launches[${li}].prompt exceeds max_prompt_chars (${allow.maxPromptChars})`);
      }

      let effort: string | undefined;
      if (launch.effort !== undefined && launch.effort !== null) {
        const allowed = validEffortsFor(provider as string);
        if (typeof launch.effort !== "string" || !allowed.includes(launch.effort)) {
          bad(`launch ${id} effort ${JSON.stringify(launch.effort)} not allowed for provider "${provider}"; allowed: ${JSON.stringify(allowed)}`);
        }
        effort = launch.effort as string;
      }
      let fast: boolean | undefined;
      if (launch.fast !== undefined && launch.fast !== null) {
        if (typeof launch.fast !== "boolean") bad(`launch ${id} fast must be a boolean`);
        fast = launch.fast as boolean;
      }

      return { id: id as string, provider: provider as string, prompt: prompt as string, effort, fast };
    });
    phases.push({ name: phase.name as string, launches });
  });

  // Second pass: every placeholder must reference an id defined in an earlier phase.
  phases.forEach((phase, pi) => {
    const available = idsBeforePhase[pi]!;
    for (const launch of phase.launches) {
      for (const ref of placeholderRefs(launch.prompt)) {
        if (!allIds.has(ref)) bad(`launch ${launch.id} references unknown output {{${ref}.output}}`);
        if (!available.has(ref)) {
          bad(`launch ${launch.id} references {{${ref}.output}} from the same or a later phase (only earlier phases allowed)`);
        }
      }
    }
  });

  const answerItem = obj.answer_item;
  if (typeof answerItem !== "string" || !allIds.has(answerItem)) {
    bad(`answer_item ${JSON.stringify(answerItem)} must be one of the launch ids`);
  }

  let complexity: string | undefined;
  if (obj.complexity !== undefined && obj.complexity !== null) {
    if (typeof obj.complexity !== "string") bad("complexity must be a string");
    complexity = obj.complexity as string;
  }

  return { phases, answerItem: answerItem as string, complexity };
}
