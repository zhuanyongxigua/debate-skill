// cli-delegator mailbox handler. This owns high-level delegation semantics;
// low-level CLI launch remains in runner.ts/launch.ts.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { Allowlist, DEFAULT_CAPABILITY, VALID_DELEGATE_MODES, repoRootMatch } from "./allowlist";
import { MailboxHandler } from "./handler";
import { Mailbox, MailboxRequestRejected, writeResponse } from "./mailbox";
import { expandUser, realpathLenient } from "./paths";
import { runValidated } from "./runner";
import { ValidatedRequest, computeDigest } from "./schema";
import { RESULT_SCHEMA_VERSION } from "./version";

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$/;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const ALLOWED_DELEGATE_FIELDS = [
  "schema_version",
  "id",
  "kind",
  "repo",
  "provider",
  "profile",
  "capability",
  "mode",
  "skill_hint",
  "task",
  "max_minutes",
] as const;
const ALLOWED_DELEGATE_FIELD_SET = new Set<string>(ALLOWED_DELEGATE_FIELDS);

export interface DelegateRequest {
  id: string;
  repo: string;
  repoRoot: string;
  provider: string;
  profile: string | null;
  capability: string;
  mode: "once" | "supervised_loop";
  skillHint: string | null;
  task: string;
  maxMinutes: number;
  requestDigest: string;
}

export interface DelegateResponse {
  schema_version: number;
  request_id: string;
  kind: "delegate_result";
  status: "completed" | "timed_out" | "error";
  status_reason: string;
  answer_markdown: string;
  artifacts_dir: string | null;
  trace: Array<Record<string, unknown>>;
  execution_result?: Record<string, unknown>;
  finished_at: string;
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(path, PRIVATE_DIR_MODE);
}

function writePrivateText(path: string, value: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, value, { mode: PRIVATE_FILE_MODE });
  chmodSync(tmp, PRIVATE_FILE_MODE);
  renameSync(tmp, path);
}

function writePrivateJson(path: string, value: Record<string, unknown>): void {
  writePrivateText(path, JSON.stringify(value, null, 2) + "\n");
}

function computeDelegateDigest(req: Omit<DelegateRequest, "requestDigest">): string {
  return computeDigest({
    schema_version: 1,
    kind: "delegate_request",
    id: req.id,
    repo: req.repo,
    provider: req.provider,
    profile: req.profile,
    capability: req.capability,
    mode: req.mode,
    skill_hint: req.skillHint,
    task: req.task,
    max_minutes: req.maxMinutes,
  });
}

export function validateDelegateRequest(raw: Record<string, unknown>, allow: Allowlist): DelegateRequest {
  const req: (cond: boolean, msg: string) => asserts cond = (cond, msg) => {
    if (!cond) throw new MailboxRequestRejected(msg);
  };
  req(raw.schema_version === 1, "request schema_version must be 1");
  req(raw.kind === "delegate_request", 'kind must be "delegate_request"');
  req(allow.delegate.enabled, "delegate mailbox is not enabled in allowlist");
  const unknown = Object.keys(raw).filter((k) => !ALLOWED_DELEGATE_FIELD_SET.has(k));
  req(unknown.length === 0, `unknown delegate request field(s): ${JSON.stringify(unknown.sort())}`);

  const id = raw.id;
  req(typeof id === "string" && SLUG_RE.test(id) && !id.includes(".."), "id must be a safe slug");

  const repo = raw.repo;
  req(typeof repo === "string" && isAbsolute(repo), "repo must be an absolute path");
  const resolved = realpathLenient(expandUser(repo as string));
  req(existsSync(resolved) && statSync(resolved).isDirectory(), `repo does not resolve to a directory: ${resolved}`);
  const root = repoRootMatch(allow, resolved);
  req(root !== null, `repo ${resolved} is not under any allowed repo root`);

  const provider = raw.provider === undefined || raw.provider === null ? "codex" : raw.provider;
  req(typeof provider === "string", "provider must be a string");
  req(allow.providers.includes(provider), `provider ${JSON.stringify(provider)} not in allowlist ${JSON.stringify(allow.providers)}`);

  let profile: string | null = null;
  if (raw.profile !== undefined && raw.profile !== null) {
    req(typeof raw.profile === "string", "profile must be a string or null");
    if (provider !== "codex") {
      throw new MailboxRequestRejected(`${provider} profiles are not supported; set profile to null`);
    }
    const allowedProfiles = allow.profiles[provider] ?? [];
    req(
      allowedProfiles.includes(raw.profile),
      `profile ${JSON.stringify(raw.profile)} not allowed for provider "codex"; allowed: ${JSON.stringify(allowedProfiles)}`,
    );
    profile = raw.profile;
  }

  const capability = raw.capability === undefined || raw.capability === null ? DEFAULT_CAPABILITY : raw.capability;
  req(typeof capability === "string", "capability must be a string");
  req(
    allow.capabilities.includes(capability),
    `capability ${JSON.stringify(capability)} not in allowlist ${JSON.stringify(allow.capabilities)}`,
  );

  const mode = raw.mode === undefined || raw.mode === null ? "once" : raw.mode;
  req(typeof mode === "string", "mode must be a string");
  req((VALID_DELEGATE_MODES as readonly string[]).includes(mode), `mode must be one of ${JSON.stringify([...VALID_DELEGATE_MODES])}`);
  req(allow.delegate.modes.includes(mode), `delegate mode ${JSON.stringify(mode)} not in allowlist ${JSON.stringify(allow.delegate.modes)}`);
  req(mode === "once", "delegate mode supervised_loop is not implemented yet");

  let skillHint: string | null = null;
  if (raw.skill_hint !== undefined && raw.skill_hint !== null) {
    req(typeof raw.skill_hint === "string", "skill_hint must be a string");
    req(raw.skill_hint.trim() !== "", "skill_hint must not be empty");
    req(raw.skill_hint.length <= 4096, "skill_hint exceeds 4096 characters");
    skillHint = raw.skill_hint;
  }

  const task = raw.task;
  req(typeof task === "string" && task.trim() !== "", "task must be a non-empty string");
  req(task.length <= allow.maxPromptChars, `task exceeds max_prompt_chars (${allow.maxPromptChars})`);

  let maxMinutes = allow.delegate.maxMinutes;
  if (raw.max_minutes !== undefined && raw.max_minutes !== null) {
    req(typeof raw.max_minutes === "number" && Number.isInteger(raw.max_minutes), "max_minutes must be an integer");
    maxMinutes = raw.max_minutes;
  }
  req(maxMinutes >= 1 && maxMinutes <= allow.delegate.maxMinutes, `max_minutes outside [1, ${allow.delegate.maxMinutes}]`);
  if (capability === "workspace_write") {
    req(
      maxMinutes <= allow.delegate.maxWorkspaceWriteMinutes,
      `workspace_write max_minutes must be <= ${allow.delegate.maxWorkspaceWriteMinutes}`,
    );
  }

  const normalized = {
    id: id as string,
    repo: resolved,
    repoRoot: root as string,
    provider,
    profile,
    capability,
    mode: mode as DelegateRequest["mode"],
    skillHint,
    task,
    maxMinutes,
  };
  return { ...normalized, requestDigest: computeDelegateDigest(normalized) };
}

function buildDelegatePrompt(req: DelegateRequest): string {
  const skillBlock = req.skillHint
    ? `\nSkill hint: ${req.skillHint}\nResolve this only as a local skill name or SKILL.md path and follow it if available. If it is unavailable, say so in the result.\n`
    : "";
  return [
    "You are a delegated local CLI worker launched by cli-delegator.",
    "Work only on the task below and respect the requested repository boundary.",
    "Return a concise final result with changed files and verification when applicable.",
    skillBlock.trimEnd(),
    "",
    "Task:",
    req.task,
    "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function readText(path: unknown): string {
  if (typeof path !== "string") return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function writeDelegateArtifacts(mb: Mailbox, req: DelegateRequest, response: DelegateResponse): string {
  const dir = join(mb.root, req.id);
  ensurePrivateDir(dir);
  writePrivateJson(join(dir, "config.json"), {
    schema_version: 1,
    kind: "delegate_request",
    id: req.id,
    repo: req.repo,
    provider: req.provider,
    profile: req.profile,
    capability: req.capability,
    mode: req.mode,
    skill_hint: req.skillHint,
    max_minutes: req.maxMinutes,
    request_digest: req.requestDigest,
  });
  writePrivateJson(join(dir, "state.json"), {
    status: response.status,
    status_reason: response.status_reason,
    finished_at: response.finished_at,
    trace: response.trace,
    execution_result: response.execution_result ?? null,
  });
  writePrivateText(join(dir, "observations.md"), response.answer_markdown);
  writePrivateText(join(dir, "current.log"), response.answer_markdown);
  return dir;
}

function errorResponse(id: string, message: string): DelegateResponse {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    request_id: id,
    kind: "delegate_result",
    status: "error",
    status_reason: message,
    answer_markdown: "",
    artifacts_dir: null,
    trace: [],
    finished_at: new Date().toISOString(),
  };
}

export function createDelegateHandler(baseEnv?: Record<string, string | undefined>): MailboxHandler<DelegateRequest, DelegateResponse> {
  const pending = new Map<string, DelegateRequest>();
  return {
    kind: "delegate_request",
    mailboxName: "cli-delegator",
    resourceBudget: { maxConcurrent: 1, maxMinutes: 30 },
    invalidRequestDigest: "invalid-request",
    validate: (raw, id, allow) => {
      const req = validateDelegateRequest(raw, allow);
      if (req.id !== id) throw new MailboxRequestRejected(`request id "${req.id}" does not match file name "${id}"`);
      pending.set(id, req);
      return req;
    },
    requestDigest: (req) => req.requestDigest,
    run: async (req, ctx) => {
      ctx.log(`delegate once: ${req.provider} ${req.capability} ${req.maxMinutes}m`);
      const launchReq: ValidatedRequest = {
        runId: req.id,
        phase: "other",
        provider: req.provider,
        mode: "delegate-once",
        repo: req.repo,
        repoRoot: req.repoRoot,
        profile: req.profile,
        capability: req.capability,
        effort: null,
        prompt: buildDelegatePrompt(req),
        timeoutSeconds: req.maxMinutes * 60,
        requestDigest: req.requestDigest,
      };
      const result = await runValidated(
        launchReq,
        baseEnv,
        join(ctx.streamDir, "delegate.log"),
        ctx.allow.rateLimitPatterns[req.provider] ?? [],
      );
      const answer = readText(result.stdout_path);
      const status =
        result.status === "completed" ? "completed" : result.status === "timed_out" ? "timed_out" : "error";
      const response: DelegateResponse = {
        schema_version: RESULT_SCHEMA_VERSION,
        request_id: req.id,
        kind: "delegate_result",
        status,
        status_reason: status === "completed" ? "" : String(result.error_category ?? result.status),
        answer_markdown: answer,
        artifacts_dir: null,
        trace: [
          {
            phase: "delegation",
            item: req.id,
            provider: req.provider,
            status: result.status,
            error_category: result.error_category ?? null,
          },
        ],
        execution_result: result,
        finished_at: new Date().toISOString(),
      };
      response.artifacts_dir = writeDelegateArtifacts(ctx.mailbox, req, response);
      return response;
    },
    errorResponse,
    writeArtifacts: (mailbox, id, response) => {
      const req = pending.get(id);
      if (req && response.artifacts_dir === null) {
        response.artifacts_dir = writeDelegateArtifacts(mailbox, req, response);
      }
      pending.delete(id);
      writeResponse(mailbox, id, response as unknown as Record<string, unknown>);
    },
  };
}
