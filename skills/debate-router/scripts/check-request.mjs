#!/usr/bin/env node
// debate-router request-file checker.
//
// Validates the FORMAT of a debate_request file (the thing this skill writes in
// Mode 2) before it is dropped in ~/.debate-router/requests/. Catches the common
// drift — e.g. adding a stale `output_contract` field — without a round-trip to
// the daemon. It checks shape only; the daemon still enforces policy (repo under
// an allowlisted root, realpath, etc.).
//
// Usage:  node scripts/check-request.mjs <request.json>
//   exit 0 = valid format; exit 1 = invalid (reasons on stderr); exit 2 = usage.
//
// IMPORTANT — keep in sync: ALLOWED/REQUIRED below mirror the debate-agent
// daemon's validateDebateRequest (ALLOWED_DEBATE_FIELDS in
// runners/debate-agent/src/mailbox.ts). A test pins them together; if the daemon
// format changes, update this file AND SKILL.md's Mode 2 example (see AGENTS.md).

import { readFileSync } from "node:fs";

const ALLOWED = ["schema_version", "id", "kind", "prompt", "repo", "language", "fast"];
const REQUIRED = ["schema_version", "id", "kind", "prompt", "repo"];
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$/;

function check(raw) {
  const errs = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return ["request must be a JSON object"];
  }
  if (raw.schema_version !== 1) errs.push("schema_version must be 1");
  if (raw.kind !== "debate_request") errs.push('kind must be "debate_request"');

  const unknown = Object.keys(raw).filter((k) => !ALLOWED.includes(k));
  if (unknown.length) {
    errs.push(
      `unknown field(s): ${JSON.stringify(unknown.sort())} — only [${ALLOWED.join(", ")}] are allowed. ` +
        `Put any output-format / template requirements inside "prompt", not in a separate field (a common mistake is adding "output_contract").`,
    );
  }
  for (const k of REQUIRED) if (!(k in raw)) errs.push(`missing required field: ${k}`);

  if ("id" in raw && (typeof raw.id !== "string" || !SLUG_RE.test(raw.id) || raw.id.includes(".."))) {
    errs.push("id must be a safe slug (e.g. 20260601-120000-my-debate)");
  }
  if ("prompt" in raw && (typeof raw.prompt !== "string" || raw.prompt.trim() === "")) {
    errs.push("prompt must be a non-empty string");
  }
  if ("repo" in raw && (typeof raw.repo !== "string" || !raw.repo.startsWith("/"))) {
    errs.push("repo must be an absolute path (resolve it yourself; a relative path is rejected)");
  }
  if ("language" in raw && raw.language !== null && typeof raw.language !== "string") {
    errs.push("language must be a string or null");
  }
  if ("fast" in raw && typeof raw.fast !== "boolean") errs.push("fast must be a boolean");
  return errs;
}

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: node scripts/check-request.mjs <request.json>\n");
  process.exit(2);
}
let raw;
try {
  raw = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  process.stderr.write(`INVALID: cannot parse JSON: ${err.message}\n`);
  process.exit(1);
}
const errs = check(raw);
if (errs.length) {
  process.stderr.write("INVALID debate_request:\n- " + errs.join("\n- ") + "\n");
  process.exit(1);
}
process.stdout.write("OK: valid debate_request format\n");
process.exit(0);
