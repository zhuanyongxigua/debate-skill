// Versioned, strict request validation.
//
// A request is rejected before any launch if: the schema version is wrong, any
// unknown top-level field is present, or any field violates the allowlist. The
// runner never reads a field that is not declared here.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  Allowlist,
  DEFAULT_CAPABILITY,
  DEFAULT_EFFORT,
  FALLBACK_DEFAULT_TIMEOUT,
  MAX_TIMEOUT_SECONDS,
  PHASE_DEFAULT_TIMEOUT,
  VALID_PHASES,
  repoRootMatch,
  validEffortsFor,
} from "./allowlist";
import { expandUser, realpathLenient } from "./paths";
import { REQUEST_SCHEMA_VERSION } from "./version";

// Exactly the fields the runner understands. Anything else is a hard reject so
// a typo or an injected extra key can never silently change behavior.
const ALLOWED_REQUEST_FIELDS = new Set([
  "schema_version",
  "run_id",
  "phase",
  "provider",
  "mode",
  "repo",
  "profile",
  "capability",
  "effort",
  "fast",
  "prompt",
  "timeout_seconds",
]);
const REQUIRED_REQUEST_FIELDS = [
  "schema_version",
  "run_id",
  "phase",
  "provider",
  "mode",
  "repo",
  "prompt",
];

// Must start with an alphanumeric and contain only safe path-segment chars.
// Combined with the explicit ".." reject below, this prevents run_id from being
// ".", "..", ".hidden", or any value that could escape the audit root when used
// as a directory name.
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class RequestRejected extends Error {}

export interface ValidatedRequest {
  runId: string;
  phase: string;
  provider: string;
  mode: string;
  repo: string; // realpath-resolved, confirmed under an allowed root
  repoRoot: string;
  profile: string | null;
  capability: string;
  effort: string;
  fast: boolean;
  prompt: string;
  timeoutSeconds: number;
  requestDigest: string;
}

function req(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new RequestRejected(message);
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonical).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

export function computeDigest(raw: unknown): string {
  return "sha256:" + createHash("sha256").update(canonical(raw)).digest("hex");
}

export function loadRequestDict(requestPath: string): Record<string, unknown> {
  req(existsSync(requestPath), `request file not found: ${requestPath}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(requestPath, "utf8"));
  } catch (err) {
    throw new RequestRejected(`cannot parse request JSON: ${String(err)}`);
  }
  req(typeof raw === "object" && raw !== null && !Array.isArray(raw), "request must be a JSON object");
  return raw as Record<string, unknown>;
}

export function validateRequest(raw: Record<string, unknown>, allow: Allowlist): ValidatedRequest {
  // --- schema version + strict field set ---------------------------------
  req("schema_version" in raw, "missing schema_version");
  req(
    raw.schema_version === REQUEST_SCHEMA_VERSION,
    `unsupported schema_version ${JSON.stringify(raw.schema_version)}; ` +
      `this runner supports ${REQUEST_SCHEMA_VERSION}`,
  );

  const unknown = Object.keys(raw).filter((k) => !ALLOWED_REQUEST_FIELDS.has(k));
  req(unknown.length === 0, `unknown request field(s): ${JSON.stringify(unknown.sort())}`);
  const missing = REQUIRED_REQUEST_FIELDS.filter((k) => !(k in raw));
  req(missing.length === 0, `missing required field(s): ${JSON.stringify(missing)}`);

  // --- run_id (used as a path segment) -----------------------------------
  const runId = raw.run_id;
  req(typeof runId === "string" && RUN_ID_RE.test(runId), `run_id must match ${RUN_ID_RE.source}`);
  req(!(runId as string).includes(".."), "run_id must not contain '..'");

  // --- phase --------------------------------------------------------------
  const phase = raw.phase as string;
  req(
    (VALID_PHASES as readonly string[]).includes(phase),
    `invalid phase ${JSON.stringify(phase)}; allowed: ${VALID_PHASES.join(", ")}`,
  );

  // --- provider -----------------------------------------------------------
  const provider = raw.provider as string;
  req(
    allow.providers.includes(provider),
    `provider ${JSON.stringify(provider)} not in allowlist ${JSON.stringify(allow.providers)}`,
  );

  // --- mode ---------------------------------------------------------------
  const mode = raw.mode as string;
  req(
    allow.modes.includes(mode),
    `mode ${JSON.stringify(mode)} not in allowlist ${JSON.stringify(allow.modes)}`,
  );

  // --- repo: realpath + must resolve under an allowed root ---------------
  const repo = raw.repo;
  req(typeof repo === "string" && isAbsolute(repo), "repo must be an absolute path");
  const resolved = realpathLenient(expandUser(repo as string));
  req(
    existsSync(resolved) && statSync(resolved).isDirectory(),
    `repo does not resolve to a directory: ${resolved}`,
  );
  const matchedRoot = repoRootMatch(allow, resolved);
  req(
    matchedRoot !== null,
    `repo ${resolved} is not under any allowed repo root ` +
      `${allow.repoRoots.length ? JSON.stringify(allow.repoRoots) : "(none configured)"}`,
  );

  // --- profile ------------------------------------------------------------
  // Only Codex profiles can be honored. Claude strips CLAUDE_CONFIG_DIR and
  // Copilot has no profile concept here, so a non-null profile for any other
  // provider is rejected (fail closed rather than accept-and-ignore).
  const profileRaw = raw.profile;
  let profile: string | null = null;
  if (profileRaw !== undefined && profileRaw !== null) {
    req(typeof profileRaw === "string", "profile must be a string or null");
    const allowedProfiles = allow.profiles[provider] ?? [];
    if (provider === "codex") {
      req(
        allowedProfiles.includes(profileRaw),
        `profile ${JSON.stringify(profileRaw)} not allowed for provider "codex"; ` +
          `allowed: ${allowedProfiles.length ? JSON.stringify(allowedProfiles) : "(none)"}`,
      );
    } else {
      req(
        false,
        `${provider} profiles are not supported; the runner uses the default ` +
          "account config (set profile to null)",
      );
    }
    profile = profileRaw;
  }

  // --- capability ---------------------------------------------------------
  // Defaults to the safe read-only posture. The effective capability (after
  // defaulting) must be allowlisted, so an operator who lists only
  // read_only_review guarantees no automated child can write.
  const capabilityRaw = raw.capability;
  if (capabilityRaw !== undefined && capabilityRaw !== null) {
    req(typeof capabilityRaw === "string", "capability must be a string");
  }
  const capability = (capabilityRaw as string | undefined) ?? DEFAULT_CAPABILITY;
  req(
    allow.capabilities.includes(capability),
    `capability ${JSON.stringify(capability)} not in allowlist ${JSON.stringify(allow.capabilities)}`,
  );

  // --- fast (turbo mode) --------------------------------------------------
  let fast = false;
  if (raw.fast !== undefined && raw.fast !== null) {
    req(typeof raw.fast === "boolean", "fast must be a boolean");
    fast = raw.fast as boolean;
  }

  // --- effort (per-launch thinking depth) ---------------------------------
  // The planner picks this per worker; valid values depend on the provider.
  let effort: string;
  if (raw.effort !== undefined && raw.effort !== null) {
    req(typeof raw.effort === "string", "effort must be a string");
    const allowed = validEffortsFor(provider);
    req(
      allowed.includes(raw.effort as string),
      `effort ${JSON.stringify(raw.effort)} not allowed for provider "${provider}"; allowed: ${JSON.stringify(allowed)}`,
    );
    effort = raw.effort as string;
  } else {
    effort = DEFAULT_EFFORT[provider] ?? "high";
  }

  // --- prompt -------------------------------------------------------------
  const prompt = raw.prompt;
  req(typeof prompt === "string" && prompt.trim() !== "", "prompt must be a non-empty string");
  req(
    (prompt as string).length <= allow.maxPromptChars,
    `prompt exceeds max_prompt_chars (${allow.maxPromptChars})`,
  );

  // --- timeout ------------------------------------------------------------
  let timeout: number;
  if (raw.timeout_seconds !== undefined && raw.timeout_seconds !== null) {
    const t = raw.timeout_seconds;
    req(typeof t === "number" && Number.isInteger(t), "timeout_seconds must be an integer");
    timeout = t as number;
  } else {
    timeout = PHASE_DEFAULT_TIMEOUT[phase] ?? FALLBACK_DEFAULT_TIMEOUT;
  }
  req(
    timeout >= 1 && timeout <= MAX_TIMEOUT_SECONDS,
    `timeout_seconds ${timeout} outside [1, ${MAX_TIMEOUT_SECONDS}]`,
  );

  return {
    runId: runId as string,
    phase,
    provider,
    mode,
    repo: resolved,
    repoRoot: matchedRoot,
    profile,
    capability,
    effort,
    fast,
    prompt: prompt as string,
    timeoutSeconds: timeout,
    requestDigest: computeDigest(raw),
  };
}

// --- batch envelope --------------------------------------------------------
// A batch is a thin wrapper: it carries N independent requests plus a parallel
// hint. The envelope is validated here (shape only); each inner request is
// validated per-item by the runner so one bad item degrades rather than failing
// the whole batch.

const BATCH_ALLOWED_FIELDS = new Set(["schema_version", "batch_id", "max_parallel", "items"]);
const ITEM_ALLOWED_FIELDS = new Set(["item_id", "request"]);

export interface BatchItemEnvelope {
  itemId: string;
  request: Record<string, unknown>;
}

export interface ValidatedBatchEnvelope {
  batchId: string;
  maxParallel: number | null; // null => use allowlist default
  items: BatchItemEnvelope[];
}

export function loadBatchDict(batchPath: string): Record<string, unknown> {
  return loadRequestDict(batchPath);
}

/**
 * Validate the batch envelope shape (not the inner requests). Throws
 * RequestRejected for whole-batch problems: bad version, unknown field, missing
 * or non-array items, too many items, duplicate/ill-formed item ids.
 */
export function validateBatchEnvelope(raw: Record<string, unknown>, allow: Allowlist): ValidatedBatchEnvelope {
  req("schema_version" in raw, "missing schema_version");
  req(
    raw.schema_version === REQUEST_SCHEMA_VERSION,
    `unsupported schema_version ${JSON.stringify(raw.schema_version)}; this runner supports ${REQUEST_SCHEMA_VERSION}`,
  );
  const unknown = Object.keys(raw).filter((k) => !BATCH_ALLOWED_FIELDS.has(k));
  req(unknown.length === 0, `unknown batch field(s): ${JSON.stringify(unknown.sort())}`);

  const batchId = raw.batch_id;
  req(typeof batchId === "string" && RUN_ID_RE.test(batchId) && !batchId.includes(".."), "batch_id must match " + RUN_ID_RE.source);

  let maxParallel: number | null = null;
  if (raw.max_parallel !== undefined && raw.max_parallel !== null) {
    req(typeof raw.max_parallel === "number" && Number.isInteger(raw.max_parallel) && raw.max_parallel >= 1, "max_parallel must be a positive integer");
    maxParallel = raw.max_parallel;
  }

  req(Array.isArray(raw.items), "items must be an array");
  const rawItems = raw.items as unknown[];
  req(rawItems.length >= 1, "batch must contain at least one item");
  req(
    rawItems.length <= allow.maxBatchItems,
    `batch has ${rawItems.length} items, exceeds max_batch_items (${allow.maxBatchItems})`,
  );

  const seen = new Set<string>();
  const items: BatchItemEnvelope[] = rawItems.map((item, idx) => {
    req(typeof item === "object" && item !== null && !Array.isArray(item), `item[${idx}] must be an object`);
    const obj = item as Record<string, unknown>;
    const extra = Object.keys(obj).filter((k) => !ITEM_ALLOWED_FIELDS.has(k));
    req(extra.length === 0, `item[${idx}] has unknown field(s): ${JSON.stringify(extra.sort())}`);
    const itemId = obj.item_id;
    req(typeof itemId === "string" && RUN_ID_RE.test(itemId) && !itemId.includes(".."), `item[${idx}].item_id must match ${RUN_ID_RE.source}`);
    req(!seen.has(itemId), `duplicate item_id ${JSON.stringify(itemId)}`);
    seen.add(itemId);
    req(
      typeof obj.request === "object" && obj.request !== null && !Array.isArray(obj.request),
      `item[${idx}].request must be an object`,
    );
    return { itemId, request: obj.request as Record<string, unknown> };
  });

  return { batchId, maxParallel, items };
}
