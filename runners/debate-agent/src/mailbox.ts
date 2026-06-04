// File mailbox between debate-router (writes requests) and this processor
// (writes responses). Lives under ~/.debate-router/ by default; override with
// $DEBATE_AGENT_MAILBOX. Requests and responses correlate by id.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { Allowlist, PLANNER_PROVIDERS, repoRootMatch } from "./allowlist";
import { expandUser, realpathLenient } from "./paths";

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$/;

export interface Mailbox {
  root: string;
  requestsDir: string;
  processingDir: string;
  responsesDir: string;
  archiveDir: string;
}

export function mailboxRoot(): string {
  const override = process.env.DEBATE_AGENT_MAILBOX;
  return override ? expandUser(override) : join(homedir(), ".debate-router");
}

export function openMailbox(): Mailbox {
  const root = mailboxRoot();
  const mb: Mailbox = {
    root,
    requestsDir: join(root, "requests"),
    processingDir: join(root, "processing"),
    responsesDir: join(root, "responses"),
    archiveDir: join(root, "archive"),
  };
  for (const d of [mb.requestsDir, mb.processingDir, mb.responsesDir, mb.archiveDir]) {
    mkdirSync(d, { recursive: true });
  }
  return mb;
}

/** Request ids already present in the inbox (ignored per "process only new"). */
export function snapshotRequestIds(mb: Mailbox): Set<string> {
  return new Set(requestIds(mb));
}

export function requestIds(mb: Mailbox): string[] {
  if (!existsSync(mb.requestsDir)) return [];
  return readdirSync(mb.requestsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

/** Ids left in processing/ — i.e. claimed before a crash/restart and never
 * finished. The daemon recovers these at startup. */
export function processingIds(mb: Mailbox): string[] {
  if (!existsSync(mb.processingDir)) return [];
  return readdirSync(mb.processingDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

/** Atomically claim a request by renaming it into processing/. Returns the new
 * path, or null if it could not be claimed (already taken / gone). */
export function claimRequest(mb: Mailbox, id: string): string | null {
  const from = join(mb.requestsDir, `${id}.json`);
  const to = join(mb.processingDir, `${id}.json`);
  try {
    renameSync(from, to);
    return to;
  } catch {
    return null;
  }
}

/** Move a finished processing/ entry into archive/ — a durable record of the
 * original request (prompt and all), kept after the debate completes (or is
 * recovered). The claim-rename keeps requests/ a clean work queue; archiving on
 * completion preserves the request without bloating that queue. Best-effort: a
 * missing entry is fine. A re-used id overwrites the prior archive entry. */
export function archiveProcessing(mb: Mailbox, id: string): void {
  try {
    renameSync(join(mb.processingDir, `${id}.json`), join(mb.archiveDir, `${id}.json`));
  } catch {
    /* already gone */
  }
}

/** Atomically write a response (temp file + rename) so readers never see a
 * half-written file. */
export function writeResponse(mb: Mailbox, id: string, response: Record<string, unknown>): string {
  const finalPath = join(mb.responsesDir, `${id}.json`);
  const tmpPath = join(mb.responsesDir, `.${id}.json.tmp`);
  writeFileSync(tmpPath, JSON.stringify(response, null, 2));
  renameSync(tmpPath, finalPath);
  return finalPath;
}

/** Per-request folder for live, streamed CLI debug output (one file per launch).
 * A sibling of `responses/<id>.json`, created lazily. Each worker/planner streams
 * its raw output here so you can `tail -f` a running CLI to debug a slow/hung
 * worker — separate from the answer path. Can grow large; it is debug-only. */
export function requestStreamDir(mb: Mailbox, id: string): string {
  const dir = join(mb.responsesDir, `${id}.streams`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Append-only progress log for one request, a sibling of `responses/<id>.json`
 * so another agent can `tail -f` a debate while it runs. Lines are timestamped;
 * logging never throws (a logging failure must not break the debate). */
export function openResponseLog(mb: Mailbox, id: string): { log: (line: string) => void; close: () => void } {
  const fd = openSync(join(mb.responsesDir, `${id}.log`), "a");
  return {
    log: (line: string) => {
      try {
        writeSync(fd, `[${new Date().toISOString()}] ${line}\n`);
      } catch {
        /* ignore */
      }
    },
    close: () => {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    },
  };
}

// --- debate request (written by debate-router, Mode 2) ---------------------
//
// The sandboxed skill emits ONE high-level request: the task to debate plus the
// repo (and the human's language). The daemon does everything else — plan, then
// execute. This file is deliberately tiny and low-strictness; the strict
// structured artifact is the PLAN, which the daemon produces and validates
// internally (see plan.ts), where retry on invalid output is cheap.

export class MailboxRequestRejected extends Error {}

export interface DebateRequest {
  id: string;
  prompt: string; // the task / question / candidates to debate
  repo: string; // realpath-resolved, under an allowed root
  repoRoot: string;
  language: string | null; // the human's primary language; the debate answers in it
  // Lean flow: when true the daemon SKIPS the planner and runs a fixed lean 2-phase
  // shape (see debate.ts buildFastPlan); when false it runs the full planner debate.
  // It does NOT control codex/claude turbo (codex always runs turbo regardless).
  fast: boolean;
  // Optional per-request primary planner provider for the full (fast=false) flow.
  // Validated against allowlist + PLANNER_PROVIDERS; ignored nowhere.
  plannerProvider: string | null;
}

// The exact accepted fields. Exported so the debate-router skill's request-file
// checker (skills/debate-router/scripts/check-request.mjs) can be pinned to this
// set by a test — if this changes, that test fails until the skill checker +
// SKILL.md example are updated too (see AGENTS.md).
export const ALLOWED_DEBATE_FIELDS = ["schema_version", "id", "kind", "prompt", "repo", "language", "fast", "planner_provider"] as const;
const ALLOWED_DEBATE_FIELD_SET = new Set<string>(ALLOWED_DEBATE_FIELDS);

/** Parse any mailbox request file into a raw object (kind-agnostic). */
export function loadRequestObject(path: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new MailboxRequestRejected(`cannot parse request JSON: ${String(err)}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MailboxRequestRejected("request must be a JSON object");
  }
  return raw as Record<string, unknown>;
}

export function validateDebateRequest(raw: Record<string, unknown>, allow: Allowlist): DebateRequest {
  const req = (cond: boolean, msg: string): void => {
    if (!cond) throw new MailboxRequestRejected(msg);
  };
  req(raw.schema_version === 1, "request schema_version must be 1");
  req(raw.kind === "debate_request", 'kind must be "debate_request"');
  const unknown = Object.keys(raw).filter((k) => !ALLOWED_DEBATE_FIELD_SET.has(k));
  req(unknown.length === 0, `unknown request field(s): ${JSON.stringify(unknown.sort())}`);

  const id = raw.id;
  req(typeof id === "string" && SLUG_RE.test(id) && !id.includes(".."), "id must be a safe slug");

  const prompt = raw.prompt;
  req(typeof prompt === "string" && prompt.trim() !== "", "prompt must be a non-empty string");
  req((prompt as string).length <= allow.maxPromptChars, `prompt exceeds max_prompt_chars (${allow.maxPromptChars})`);

  const repo = raw.repo;
  req(typeof repo === "string" && isAbsolute(repo), "repo must be an absolute path");
  const resolved = realpathLenient(expandUser(repo as string));
  req(existsSync(resolved) && statSync(resolved).isDirectory(), `repo does not resolve to a directory: ${resolved}`);
  const root = repoRootMatch(allow, resolved);
  req(root !== null, `repo ${resolved} is not under any allowed repo root`);

  let language: string | null = null;
  if (raw.language !== undefined && raw.language !== null) {
    req(typeof raw.language === "string", "language must be a string");
    language = (raw.language as string).slice(0, 64);
  }

  let fast = false;
  if (raw.fast !== undefined && raw.fast !== null) {
    req(typeof raw.fast === "boolean", "fast must be a boolean");
    fast = raw.fast as boolean;
  }

  let plannerProvider: string | null = null;
  if (raw.planner_provider !== undefined && raw.planner_provider !== null) {
    req(typeof raw.planner_provider === "string", "planner_provider must be a string");
    const provider = raw.planner_provider as string;
    req((PLANNER_PROVIDERS as readonly string[]).includes(provider), `planner_provider must be one of ${JSON.stringify([...PLANNER_PROVIDERS])}`);
    req(allow.providers.includes(provider), `planner_provider ${provider} is not in the allowlist providers (${allow.providers.join(", ")})`);
    plannerProvider = provider;
  }
  req(!(fast && plannerProvider !== null), "planner_provider requires fast=false because fast requests skip the planner");

  return { id: id as string, prompt: prompt as string, repo: resolved, repoRoot: root as string, language, fast, plannerProvider };
}
