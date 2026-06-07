// Delegate request validation: the high-level cli-delegator mailbox is opt-in
// and never accepts argv/env-shaped request fields.

import assert from "node:assert/strict";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { validateDelegateRequest } from "../src/delegate";
import { MailboxRequestRejected } from "../src/mailbox";
import { cleanup, makeAllowlist, makeTempDir } from "./helpers";

let root: string;
let repo: string;

beforeEach(() => {
  root = makeTempDir();
  repo = join(root, "repo");
  mkdirSync(repo);
});

afterEach(() => {
  cleanup(root);
});

function base(): Record<string, unknown> {
  return {
    schema_version: 1,
    id: "delegate-test",
    kind: "delegate_request",
    repo: realpathSync(repo),
    provider: "codex",
    mode: "once",
    task: "inspect the project",
  };
}

test("delegate_request is rejected unless the allowlist explicitly enables delegation", () => {
  assert.throws(() => validateDelegateRequest(base(), makeAllowlist(repo)), /delegate mailbox is not enabled/);
});

test("delegate_request accepts a bounded once task when enabled", () => {
  const allow = makeAllowlist(repo, {
    providers: ["codex"],
    delegate: { enabled: true, modes: ["once"], maxMinutes: 20, maxWorkspaceWriteMinutes: 5 },
  });
  const req = validateDelegateRequest({ ...base(), max_minutes: 7 }, allow);
  assert.equal(req.id, "delegate-test");
  assert.equal(req.provider, "codex");
  assert.equal(req.capability, "read_only_review");
  assert.equal(req.maxMinutes, 7);
  assert.ok(req.requestDigest.startsWith("sha256:"));
});

test("delegate_request rejects argv/env-like unknown fields and write windows beyond policy", () => {
  const allow = makeAllowlist(repo, {
    providers: ["codex"],
    capabilities: ["read_only_review", "workspace_write"],
    delegate: { enabled: true, modes: ["once"], maxMinutes: 20, maxWorkspaceWriteMinutes: 5 },
  });
  assert.throws(() => validateDelegateRequest({ ...base(), argv: ["codex"] }, allow), /unknown delegate request field/);
  assert.throws(() => validateDelegateRequest({ ...base(), env: { OPENAI_API_KEY: "x" } }, allow), /unknown delegate request field/);
  assert.throws(
    () => validateDelegateRequest({ ...base(), capability: "workspace_write", max_minutes: 6 }, allow),
    /workspace_write max_minutes/,
  );
  assert.throws(
    () => validateDelegateRequest({ ...base(), mode: "supervised_loop" }, allow),
    (err) => err instanceof MailboxRequestRejected && /not in allowlist|not implemented/.test(err.message),
  );
});
