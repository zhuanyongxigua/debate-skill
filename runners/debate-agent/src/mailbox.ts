// File mailbox between debate-router (writes requests) and this processor
// (writes responses). Lives under ~/.debate-router/ by default; override with
// $DEBATE_AGENT_MAILBOX. Requests and responses correlate by id.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
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

/** Atomically write a response (temp file + rename) so readers never see a
 * half-written file. */
export function writeResponse(mb: Mailbox, id: string, response: Record<string, unknown>): string {
  const finalPath = join(mb.responsesDir, `${id}.json`);
  const tmpPath = join(mb.responsesDir, `.${id}.json.tmp`);
  writeFileSync(tmpPath, JSON.stringify(response, null, 2));
  renameSync(tmpPath, finalPath);
  return finalPath;
}

// --- debate request (written by debate-router) -----------------------------

export class DebateRequestRejected extends Error {}

export interface DebateRequest {
  id: string;
  prompt: string;
  repo: string; // realpath-resolved, under an allowed root
  repoRoot: string;
  outputContract: Record<string, unknown> | null;
}

const ALLOWED_DEBATE_FIELDS = new Set(["schema_version", "id", "kind", "prompt", "repo", "output_contract"]);

export function loadDebateRequest(path: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new DebateRequestRejected(`cannot parse debate request JSON: ${String(err)}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DebateRequestRejected("debate request must be a JSON object");
  }
  return raw as Record<string, unknown>;
}

export function validateDebateRequest(raw: Record<string, unknown>, allow: Allowlist): DebateRequest {
  const req = (cond: boolean, msg: string): void => {
    if (!cond) throw new DebateRequestRejected(msg);
  };
  req(raw.schema_version === 1, "debate request schema_version must be 1");
  const unknown = Object.keys(raw).filter((k) => !ALLOWED_DEBATE_FIELDS.has(k));
  req(unknown.length === 0, `unknown debate request field(s): ${JSON.stringify(unknown.sort())}`);

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

  let outputContract: Record<string, unknown> | null = null;
  if (raw.output_contract !== undefined && raw.output_contract !== null) {
    req(
      typeof raw.output_contract === "object" && !Array.isArray(raw.output_contract),
      "output_contract must be an object",
    );
    outputContract = raw.output_contract as Record<string, unknown>;
  }

  return { id: id as string, prompt: prompt as string, repo: resolved, repoRoot: root as string, outputContract };
}
