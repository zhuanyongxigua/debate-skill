// File mailbox between debate-router (writes requests) and this processor
// (writes responses). Lives under ~/.debate-router/ by default; override with
// $DEBATE_AGENT_MAILBOX. Requests and responses correlate by id.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { Allowlist, repoRootMatch } from "./allowlist";
import { expandUser, realpathLenient } from "./paths";

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$/;

export interface Mailbox {
  root: string;
  requestsDir: string;
  processingDir: string;
  responsesDir: string;
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
  };
  for (const d of [mb.requestsDir, mb.processingDir, mb.responsesDir]) {
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

/** Remove a processing/ entry (after it has been finished or recovered). */
export function clearProcessing(mb: Mailbox, id: string): void {
  try {
    unlinkSync(join(mb.processingDir, `${id}.json`));
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
  fast: boolean; // turbo mode: launch every CLI (planner + workers) in its fast mode
}

const ALLOWED_DEBATE_FIELDS = new Set(["schema_version", "id", "kind", "prompt", "repo", "language", "fast"]);

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
  const unknown = Object.keys(raw).filter((k) => !ALLOWED_DEBATE_FIELDS.has(k));
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

  return { id: id as string, prompt: prompt as string, repo: resolved, repoRoot: root as string, language, fast };
}
