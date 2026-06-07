// Allowlist definition, defaults, and loading.
//
// The allowlist is the runner's policy surface. It is intentionally data, not
// code: a request can never widen it. Operators widen it by editing
// allowlist.json (or passing --config), which is a deliberate, reviewable
// change.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, sep } from "node:path";

import { expandUser, realpathLenient } from "./paths";
import { DEFAULT_RATE_LIMIT_PATTERNS, RateLimitPatternError, compilePatterns } from "./ratelimit";

// Providers the runner knows how to launch. Adding one here is not enough; it
// also needs a static argv builder in launch.ts. Both edits are deliberate.
// `copilot` is supported but OPT-IN: it is not in the default allowlist below,
// so an operator must add it to `providers` explicitly to enable it.
export const SUPPORTED_PROVIDERS = ["claude", "codex", "copilot"] as const;
export type Provider = (typeof SUPPORTED_PROVIDERS)[number];
// Providers that can produce the daemon's native JSON-Schema structured plan.
// Workers may use any supported provider; the planner is limited to this set.
export const PLANNER_PROVIDERS = ["claude", "codex"] as const;
export type PlannerProvider = (typeof PLANNER_PROVIDERS)[number];

// Only Codex has local profiles the runner can honor (claude strips
// CLAUDE_CONFIG_DIR; copilot has no profile concept here).
const PROVIDERS_WITH_PROFILES = new Set(["codex"]);

export const VALID_PHASES = [
  "proposal_generation",
  "debate_execution",
  "critique",
  "cross_review",
  "arbitration",
  "other",
] as const;

// Capabilities map (in launch.ts) to a fixed sandbox/permission posture for the
// child CLI. They are the runner's blast-radius control: debate participants get
// read_only_review by default so an automated run can never edit the repo unless
// the operator both allowlists workspace_write and a request asks for it.
export const VALID_CAPABILITIES = ["read_only_review", "workspace_write"] as const;
export type Capability = (typeof VALID_CAPABILITIES)[number];
export const DEFAULT_CAPABILITY: Capability = "read_only_review";

// Optional per-launch thinking overrides. If omitted, the child CLI's own
// profile/config/default applies (Codex especially should usually use its
// configured profile). Copilot has no effort flag, but the same validation set is
// useful if a planner supplies one.
export const VALID_EFFORTS: Record<string, readonly string[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh"],
};
export function validEffortsFor(provider: string): readonly string[] {
  return VALID_EFFORTS[provider] ?? VALID_EFFORTS.claude!;
}

// Phase-aware timeout defaults. Mirrors cli-launch Provider Defaults on
// purpose (kept in sync by hand; see README "static provider->argv mapping").
export const PHASE_DEFAULT_TIMEOUT: Record<string, number> = {
  proposal_generation: 1800,
  debate_execution: 900,
  critique: 900,
  cross_review: 900,
  arbitration: 900,
  other: 900,
};
export const FALLBACK_DEFAULT_TIMEOUT = 900;

// Fixed sanity cap on an explicit `timeout_seconds` (not a configurable knob):
// just keeps a request from asking for a negative/absurd wall. The phase
// defaults above are the values that actually matter in the debate flow.
export const MAX_TIMEOUT_SECONDS = 86400;

export class AllowlistError extends Error {}

// Provider fallback policy. When a worker (or the planner) cannot launch or fails
// to produce output, the orchestrator re-runs the SAME task on the next provider in
// `order` (filtered to allowlisted, not-yet-tried providers). This is execution
// resilience driven purely by execution status — NOT a `provider: auto` request
// API and NOT a change to the run/run-batch primitives, which never rebalance.
export interface FallbackPolicy {
  // When false, a failed launch is left to degrade/error instead of swapping.
  enabled: boolean;
  // Preference order for picking a substitute provider. Filtered to allowlisted
  // providers at use-site; defaults to `providers` order when unset.
  order: string[];
}

export const VALID_DELEGATE_MODES = ["once", "supervised_loop"] as const;
export type DelegateMode = (typeof VALID_DELEGATE_MODES)[number];

export interface DelegatePolicy {
  enabled: boolean;
  modes: string[];
  maxMinutes: number;
  maxWorkspaceWriteMinutes: number;
}

export interface Allowlist {
  // Absolute, realpath-resolved roots. A request repo must resolve under one.
  repoRoots: string[];
  modes: string[];
  providers: string[];
  // provider -> allowed profile names (besides null, which is always allowed).
  profiles: Record<string, string[]>;
  // Permitted child sandbox postures. An operator can lock the runner to
  // read-only by listing only "read_only_review".
  capabilities: string[];
  maxPromptChars: number;
  // run-batch resource bounds (matter most under Codex Rules `allow`).
  maxBatchItems: number;
  maxParallel: number;
  maxParallelPerProvider: number;
  // provider -> compiled rate-limit signatures. A FAILED child whose output
  // matches one is reclassified `rate_limited`; fallback itself applies to any
  // provider launch/completion failure. Empty for a provider => detection off for it.
  rateLimitPatterns: Record<string, RegExp[]>;
  fallback: FallbackPolicy;
  // High-level cli-delegator mailbox support. Disabled by default so adding a
  // second mailbox does not silently widen who can ask the daemon to spawn CLIs.
  delegate: DelegatePolicy;
}

/** Default per-provider rate-limit signatures (the same conservative set for
 * every supported provider). Compiled fresh so each Allowlist owns its regexes. */
function defaultRateLimitPatterns(): Record<string, RegExp[]> {
  const compiled = compilePatterns(DEFAULT_RATE_LIMIT_PATTERNS);
  return { claude: [...compiled], codex: [...compiled], copilot: [...compiled] };
}

// Conservative built-in defaults. With no repo roots configured, every repo is
// rejected: the runner is closed by default and must be opened explicitly.
export const DEFAULT_ALLOWLIST: Allowlist = {
  repoRoots: [],
  modes: ["debate-proposal", "debate-critique", "debate-cross-review"],
  providers: ["claude", "codex"], // copilot is supported but opt-in: add it here to enable
  profiles: { claude: [], codex: [], copilot: [] },
  // Read-only by default. workspace_write is supported but OPT-IN (like copilot):
  // an operator must add it here before any request can ask for child writes.
  capabilities: [DEFAULT_CAPABILITY],
  maxPromptChars: 200000,
  maxBatchItems: 8,
  maxParallel: 4,
  maxParallelPerProvider: 2,
  rateLimitPatterns: defaultRateLimitPatterns(),
  // Swap engines on provider failure by default; order follows `providers`.
  fallback: { enabled: true, order: ["claude", "codex"] },
  delegate: { enabled: false, modes: ["once"], maxMinutes: 30, maxWorkspaceWriteMinutes: 30 },
};

export function repoRootMatch(allow: Allowlist, resolvedRepo: string): string | null {
  for (const root of allow.repoRoots) {
    if (resolvedRepo === root || resolvedRepo.startsWith(root + sep)) {
      return root;
    }
  }
  return null;
}

function isSupportedProvider(name: string): name is Provider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(name);
}

function resolveRoot(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new AllowlistError(`repo_root must be a string: ${JSON.stringify(raw)}`);
  }
  const expanded = expandUser(raw);
  if (!isAbsolute(expanded)) {
    throw new AllowlistError(`repo_root must be absolute: ${raw}`);
  }
  return realpathLenient(expanded);
}

// --- shape guards ----------------------------------------------------------
// The allowlist is the policy surface, so a malformed config must fail closed,
// never get silently coerced. Without these, e.g. `"modes": "debate-proposal"`
// (a string, not an array) survives the cast and turns the later
// `allow.modes.includes(mode)` into a *substring* match, widening the policy.

function expectObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AllowlistError(`${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function expectStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new AllowlistError(`${field} must be an array of strings`);
  }
  return value as string[];
}

function expectNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AllowlistError(`${field} must be a number`);
  }
  return value;
}

function expectBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new AllowlistError(`${field} must be a boolean`);
  }
  return value;
}

/** Parse the optional `rate_limit_patterns` map. Starts from the per-provider
 * defaults and overrides only the providers present in config, so an operator can
 * tune one provider (or disable detection for it with an empty list) without
 * re-listing the rest. Compiles eagerly so a bad regex fails closed at load. */
function parseRateLimitPatterns(raw: unknown): Record<string, RegExp[]> {
  const result = defaultRateLimitPatterns();
  if (raw === undefined) return result;
  const obj = expectObject(raw, "rate_limit_patterns");
  for (const [provider, value] of Object.entries(obj)) {
    if (!isSupportedProvider(provider)) {
      throw new AllowlistError(`rate_limit_patterns names unknown provider ${JSON.stringify(provider)}`);
    }
    const strings = expectStringArray(value, `rate_limit_patterns.${provider}`);
    try {
      result[provider] = compilePatterns(strings);
    } catch (err) {
      if (err instanceof RateLimitPatternError) {
        throw new AllowlistError(`rate_limit_patterns.${provider}: ${err.message}`);
      }
      throw err;
    }
  }
  return result;
}

/** Parse the optional `fallback` block. `order` defaults to `providers` and every
 * entry must itself be an allowlisted provider (an unreachable substitute is a
 * misconfiguration, so fail closed rather than silently skip it). */
function parseFallback(raw: unknown, providers: string[]): FallbackPolicy {
  if (raw === undefined) return { enabled: true, order: [...providers] };
  const obj = expectObject(raw, "fallback");
  // Reject unknown nested keys so a typo like "enable" (not "enabled") fails closed
  // instead of silently leaving fallback enabled. (Top-level keys still allow the
  // `_comment`/`_note` config convention, so we only tighten inside `fallback`.)
  const extra = Object.keys(obj).filter((k) => k !== "enabled" && k !== "order");
  if (extra.length) throw new AllowlistError(`fallback has unknown field(s): ${JSON.stringify(extra.sort())}`);
  const enabled = obj.enabled === undefined ? true : expectBoolean(obj.enabled, "fallback.enabled");
  const order = obj.order === undefined ? [...providers] : expectStringArray(obj.order, "fallback.order");
  for (const provider of order) {
    if (!providers.includes(provider)) {
      throw new AllowlistError(
        `fallback.order entry ${JSON.stringify(provider)} is not in providers ${JSON.stringify(providers)}`,
      );
    }
  }
  return { enabled, order };
}

function parseDelegate(raw: unknown, base: DelegatePolicy): DelegatePolicy {
  if (raw === undefined) return { ...base, modes: [...base.modes] };
  const obj = expectObject(raw, "delegate");
  const extra = Object.keys(obj).filter(
    (k) => !["enabled", "modes", "max_minutes", "max_workspace_write_minutes"].includes(k),
  );
  if (extra.length) throw new AllowlistError(`delegate has unknown field(s): ${JSON.stringify(extra.sort())}`);
  const enabled = obj.enabled === undefined ? base.enabled : expectBoolean(obj.enabled, "delegate.enabled");
  const modes = obj.modes === undefined ? [...base.modes] : expectStringArray(obj.modes, "delegate.modes");
  for (const mode of modes) {
    if (!(VALID_DELEGATE_MODES as readonly string[]).includes(mode)) {
      throw new AllowlistError(
        `delegate.modes entry ${JSON.stringify(mode)} is not supported ` +
          `(supported: ${VALID_DELEGATE_MODES.join(", ")})`,
      );
    }
  }
  const maxMinutes =
    obj.max_minutes === undefined ? base.maxMinutes : expectNumber(obj.max_minutes, "delegate.max_minutes");
  const maxWorkspaceWriteMinutes =
    obj.max_workspace_write_minutes === undefined
      ? base.maxWorkspaceWriteMinutes
      : expectNumber(obj.max_workspace_write_minutes, "delegate.max_workspace_write_minutes");
  if (!Number.isInteger(maxMinutes) || maxMinutes < 1) {
    throw new AllowlistError("delegate.max_minutes must be a positive integer");
  }
  if (!Number.isInteger(maxWorkspaceWriteMinutes) || maxWorkspaceWriteMinutes < 1) {
    throw new AllowlistError("delegate.max_workspace_write_minutes must be a positive integer");
  }
  if (maxWorkspaceWriteMinutes > maxMinutes) {
    throw new AllowlistError("delegate.max_workspace_write_minutes must be <= delegate.max_minutes");
  }
  return { enabled, modes, maxMinutes, maxWorkspaceWriteMinutes };
}

/**
 * Load an Allowlist from a JSON file, falling back to conservative defaults.
 *
 * A missing path returns DEFAULT_ALLOWLIST (closed: no repo roots). A present
 * but malformed file throws AllowlistError rather than silently widening.
 */
export function loadAllowlist(configPath: string | null | undefined): Allowlist {
  if (!configPath || !existsSync(configPath)) {
    return DEFAULT_ALLOWLIST;
  }

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new AllowlistError(`cannot read allowlist config ${configPath}: ${String(err)}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new AllowlistError("allowlist config must be a JSON object");
  }
  const obj = data as Record<string, unknown>;
  const base = DEFAULT_ALLOWLIST;

  const repoRoots = (obj.repo_roots === undefined ? [] : expectStringArray(obj.repo_roots, "repo_roots")).map(
    resolveRoot,
  );

  const providers = obj.providers === undefined ? base.providers : expectStringArray(obj.providers, "providers");
  for (const provider of providers) {
    if (!isSupportedProvider(provider)) {
      throw new AllowlistError(
        `provider ${JSON.stringify(provider)} is not supported by this runner ` +
          `(supported: ${SUPPORTED_PROVIDERS.join(", ")})`,
      );
    }
  }

  const modes = obj.modes === undefined ? base.modes : expectStringArray(obj.modes, "modes");

  const capabilities =
    obj.capabilities === undefined ? base.capabilities : expectStringArray(obj.capabilities, "capabilities");
  for (const cap of capabilities) {
    if (!(VALID_CAPABILITIES as readonly string[]).includes(cap)) {
      throw new AllowlistError(
        `capability ${JSON.stringify(cap)} is not supported by this runner ` +
          `(supported: ${VALID_CAPABILITIES.join(", ")})`,
      );
    }
  }

  const rawProfiles = obj.profiles === undefined ? {} : expectObject(obj.profiles, "profiles");
  const profiles: Record<string, string[]> = { claude: [], codex: [], copilot: [] };
  for (const [provider, names] of Object.entries(rawProfiles)) {
    if (!isSupportedProvider(provider)) {
      throw new AllowlistError(`profiles names unknown provider ${JSON.stringify(provider)}`);
    }
    const profileNames = expectStringArray(names, `profiles.${provider}`);
    if (!PROVIDERS_WITH_PROFILES.has(provider) && profileNames.length > 0) {
      // Only Codex profiles can be honored. Configuring a profile the runner
      // would silently ignore is a footgun, so reject it.
      throw new AllowlistError(
        `${provider} profiles are not supported by this runner; ` +
          `leave profiles.${provider} empty (children use the default account)`,
      );
    }
    profiles[provider] = profileNames;
  }

  const limits = obj.limits === undefined ? {} : expectObject(obj.limits, "limits");
  const limit = (key: string, fallback: number): number =>
    limits[key] === undefined ? fallback : expectNumber(limits[key], `limits.${key}`);

  const rateLimitPatterns = parseRateLimitPatterns(obj.rate_limit_patterns);
  const fallback = parseFallback(obj.fallback, providers);
  const delegate = parseDelegate(obj.delegate, base.delegate);

  return {
    repoRoots,
    modes,
    providers,
    profiles,
    capabilities,
    maxPromptChars: limit("max_prompt_chars", base.maxPromptChars),
    maxBatchItems: limit("max_batch_items", base.maxBatchItems),
    maxParallel: limit("max_parallel", base.maxParallel),
    maxParallelPerProvider: limit("max_parallel_per_provider", base.maxParallelPerProvider),
    rateLimitPatterns,
    fallback,
    delegate,
  };
}

/**
 * Reload the allowlist, but never let a malformed/half-saved edit break
 * processing: on any error, keep the last-known-good allowlist and warn. This is
 * what makes per-request reload safe — an in-flight bad save just pins the prior
 * policy until the file is valid again, rather than failing requests.
 */
export function safeReloadAllowlist(
  configPath: string,
  lastGood: Allowlist,
  onWarn: (message: string) => void,
): Allowlist {
  try {
    return loadAllowlist(configPath);
  } catch (err) {
    onWarn(`allowlist reload failed (${configPath}); keeping last good config: ${String(err)}`);
    return lastGood;
  }
}

/**
 * Standard search order for the allowlist config.
 *   1. $DEBATE_AGENT_CONFIG if set.
 *   2. ~/.config/debate-agent/allowlist.json.
 * Returns null if neither exists (defaults apply).
 */
export function defaultConfigPath(): string | null {
  const env = process.env.DEBATE_AGENT_CONFIG;
  if (env) {
    return expandUser(env);
  }
  const user = join(homedir(), ".config", "debate-agent", "allowlist.json");
  return existsSync(user) ? user : null;
}
