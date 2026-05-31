// File mailbox between debate-router (writes requests) and this processor
// (writes responses). Lives under ~/.debate-router/ by default; override with
// $DEBATE_AGENT_MAILBOX. Requests and responses correlate by id.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { Allowlist, VALID_PHASES, repoRootMatch } from "./allowlist";
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

// --- run-batch request (written by debate-router) --------------------------
//
// The skill plans the whole debate in its OWN context and sends the daemon one
// batch of independent read-only worker launches per phase (proposers, critics,
// an arbiter run, …). This is the generic execution primitive over the mailbox:
// the runner does NOT know these are proposers/critics/arbiters — it just runs N
// prompts in a repo, read-only, and returns each worker's output for the skill
// to compose. No debate semantics live here (invariant: the runner owns
// execution, never debate semantics).

export class MailboxRequestRejected extends Error {}

export interface RunBatchItem {
  itemId: string;
  provider: string;
  prompt: string;
  phase: string; // audit label; maps to a mode + a default timeout internally
  timeoutSeconds: number | null;
}

export interface RunBatchRequest {
  id: string;
  repo: string; // realpath-resolved, under an allowed root
  repoRoot: string;
  fast: boolean; // turbo mode: launch every worker CLI in its fast mode
  maxParallel: number | null; // null => allowlist default
  items: RunBatchItem[];
}

const ALLOWED_BATCH_REQUEST_FIELDS = new Set([
  "schema_version",
  "id",
  "kind",
  "repo",
  "fast",
  "max_parallel",
  "items",
]);
const ALLOWED_BATCH_ITEM_FIELDS = new Set(["item_id", "provider", "prompt", "phase", "timeout_seconds"]);

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

export function validateRunBatchRequest(raw: Record<string, unknown>, allow: Allowlist): RunBatchRequest {
  const req = (cond: boolean, msg: string): void => {
    if (!cond) throw new MailboxRequestRejected(msg);
  };
  req(raw.schema_version === 1, "request schema_version must be 1");
  req(raw.kind === "run_batch_request", 'kind must be "run_batch_request"');
  const unknown = Object.keys(raw).filter((k) => !ALLOWED_BATCH_REQUEST_FIELDS.has(k));
  req(unknown.length === 0, `unknown request field(s): ${JSON.stringify(unknown.sort())}`);

  const id = raw.id;
  req(typeof id === "string" && SLUG_RE.test(id) && !id.includes(".."), "id must be a safe slug");

  const repo = raw.repo;
  req(typeof repo === "string" && isAbsolute(repo), "repo must be an absolute path");
  const resolved = realpathLenient(expandUser(repo as string));
  req(existsSync(resolved) && statSync(resolved).isDirectory(), `repo does not resolve to a directory: ${resolved}`);
  const root = repoRootMatch(allow, resolved);
  req(root !== null, `repo ${resolved} is not under any allowed repo root`);

  let fast = false;
  if (raw.fast !== undefined && raw.fast !== null) {
    req(typeof raw.fast === "boolean", "fast must be a boolean");
    fast = raw.fast as boolean;
  }

  let maxParallel: number | null = null;
  if (raw.max_parallel !== undefined && raw.max_parallel !== null) {
    req(
      typeof raw.max_parallel === "number" && Number.isInteger(raw.max_parallel) && raw.max_parallel >= 1,
      "max_parallel must be a positive integer",
    );
    maxParallel = raw.max_parallel as number;
  }

  req(Array.isArray(raw.items), "items must be an array");
  const rawItems = raw.items as unknown[];
  req(rawItems.length >= 1, "items must contain at least one launch");
  req(
    rawItems.length <= allow.maxBatchItems,
    `items has ${rawItems.length}, exceeds max_batch_items (${allow.maxBatchItems})`,
  );

  const seen = new Set<string>();
  const items: RunBatchItem[] = rawItems.map((it, idx) => {
    req(typeof it === "object" && it !== null && !Array.isArray(it), `items[${idx}] must be an object`);
    const obj = it as Record<string, unknown>;
    const extra = Object.keys(obj).filter((k) => !ALLOWED_BATCH_ITEM_FIELDS.has(k));
    req(extra.length === 0, `items[${idx}] has unknown field(s): ${JSON.stringify(extra.sort())}`);

    const itemId = obj.item_id;
    req(
      typeof itemId === "string" && SLUG_RE.test(itemId) && !(itemId as string).includes(".."),
      `items[${idx}].item_id must be a safe slug`,
    );
    req(!seen.has(itemId as string), `duplicate item_id ${JSON.stringify(itemId)}`);
    seen.add(itemId as string);

    const provider = obj.provider;
    req(
      typeof provider === "string" && allow.providers.includes(provider),
      `items[${idx}].provider ${JSON.stringify(provider)} not in allowlist providers ${JSON.stringify(allow.providers)}`,
    );

    const prompt = obj.prompt;
    req(typeof prompt === "string" && (prompt as string).trim() !== "", `items[${idx}].prompt must be a non-empty string`);
    req(
      (prompt as string).length <= allow.maxPromptChars,
      `items[${idx}].prompt exceeds max_prompt_chars (${allow.maxPromptChars})`,
    );

    let phase = "other";
    if (obj.phase !== undefined && obj.phase !== null) {
      req(typeof obj.phase === "string", `items[${idx}].phase must be a string`);
      req(
        (VALID_PHASES as readonly string[]).includes(obj.phase as string),
        `items[${idx}].phase ${JSON.stringify(obj.phase)} invalid; allowed: ${VALID_PHASES.join(", ")}`,
      );
      phase = obj.phase as string;
    }

    let timeoutSeconds: number | null = null;
    if (obj.timeout_seconds !== undefined && obj.timeout_seconds !== null) {
      req(
        typeof obj.timeout_seconds === "number" && Number.isInteger(obj.timeout_seconds),
        `items[${idx}].timeout_seconds must be an integer`,
      );
      timeoutSeconds = obj.timeout_seconds as number;
    }

    return { itemId: itemId as string, provider: provider as string, prompt: prompt as string, phase, timeoutSeconds };
  });

  return { id: id as string, repo: resolved, repoRoot: root as string, fast, maxParallel, items };
}
