// Rate-limit detection.
//
// Turns operator-configured signature strings into regexes and decides whether a
// FAILED child's output looks like a provider usage/rate limit (vs an ordinary
// error). Detection only LABELS a result with error_category "rate_limited"; the
// decision to switch providers ("same task, swap engine") lives in the
// orchestrator (debate.ts for workers, planner.ts for the plan), never here. That
// split keeps the runner's execution primitives free of any provider rebalancing.

export class RateLimitPatternError extends Error {}

// Case-insensitive default signatures, applied to claude and codex alike unless
// overridden per provider in the allowlist's `rate_limit_patterns`. These are a
// STARTING POINT: verify them against real claude/codex usage-limit output and tune
// via config — no code change needed.
//
// They deliberately FAVOR RECALL (broad words like `quota` / `overloaded` / `429`):
// in this use case a false positive is cheap — it just re-runs the SAME task on
// another available engine — while a false NEGATIVE is the failure we are trying to
// prevent (a real limit missed → the launch degrades instead of swapping engines).
// They are only ever tested against an already-FAILED (non-zero) child, which keeps
// the false-positive rate low. An operator who wants tighter matching (or to disable
// detection for a provider) overrides the list in config (empty list = off).
export const DEFAULT_RATE_LIMIT_PATTERNS: readonly string[] = [
  "rate[ -]?limit",
  "\\b429\\b",
  "too many requests",
  "quota",
  "usage limit",
  "overloaded",
];

/** Compile signature strings to case-insensitive regexes, failing closed on an
 * invalid pattern (so a bad operator config raises rather than silently matching
 * nothing). */
export function compilePatterns(patterns: readonly string[]): RegExp[] {
  return patterns.map((p) => {
    try {
      return new RegExp(p, "i");
    } catch (err) {
      throw new RateLimitPatternError(`invalid rate-limit pattern ${JSON.stringify(p)}: ${String(err)}`);
    }
  });
}

/**
 * True if a FAILED child's output matches any rate-limit signature. Scans stderr
 * and stdout together (a failed run's notice may land on either stream). Call this
 * ONLY for non-success results, so a successful answer that merely mentions "rate
 * limit" is never reclassified. With no patterns, detection is off (returns false).
 */
export function classifyRateLimit(stderr: string, stdout: string, patterns: readonly RegExp[]): boolean {
  if (patterns.length === 0) return false;
  const hay = `${stderr}\n${stdout}`;
  return patterns.some((re) => re.test(hay));
}
