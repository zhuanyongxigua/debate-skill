// Rate-limit detection: signature matching is conservative and only labels a
// FAILED run, never a successful one.

import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_RATE_LIMIT_PATTERNS, RateLimitPatternError, classifyRateLimit, compilePatterns } from "../src/ratelimit";

const DEFAULTS = compilePatterns(DEFAULT_RATE_LIMIT_PATTERNS);

test("default patterns match common rate-limit phrasings (case-insensitive)", () => {
  for (const s of [
    "Rate limit exceeded",
    "rate-limited, retry later",
    "HTTP 429 Too Many Requests",
    "usage limit reached for this account",
    "the model is overloaded",
    "quota exceeded",
  ]) {
    assert.equal(classifyRateLimit(s, "", DEFAULTS), true, `should match: ${s}`);
  }
});

test("ordinary failures are NOT classified as rate limits", () => {
  for (const s of [
    "command not found",
    "panic: nil pointer dereference",
    "syntax error near unexpected token",
    "permission denied",
    "ENOENT: no such file or directory",
  ]) {
    assert.equal(classifyRateLimit(s, "", DEFAULTS), false, `should NOT match: ${s}`);
  }
});

test("scans stderr and stdout together", () => {
  const pats = compilePatterns(["usage limit"]);
  assert.equal(classifyRateLimit("", "you hit your usage limit", pats), true);
  assert.equal(classifyRateLimit("usage limit", "", pats), true);
  assert.equal(classifyRateLimit("clean", "clean", pats), false);
});

test("empty patterns mean detection is off", () => {
  assert.equal(classifyRateLimit("rate limit", "429", []), false);
});

test("an invalid pattern fails closed", () => {
  assert.throws(() => compilePatterns(["("]), RateLimitPatternError);
});
