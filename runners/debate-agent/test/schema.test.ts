// Schema strictness and allowlist enforcement tests.

import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { RequestRejected, validateRequest } from "../src/schema";
import { baseRequest, cleanup, makeAllowlist, makeTempDir } from "./helpers";

let repo: string;
let allow: ReturnType<typeof makeAllowlist>;
let tmpDirs: string[] = [];

beforeEach(() => {
  repo = makeTempDir();
  tmpDirs = [repo];
  allow = makeAllowlist(repo);
});

afterEach(() => {
  for (const d of tmpDirs) cleanup(d);
});

function expectReject(req: Record<string, unknown>, re: RegExp): void {
  assert.throws(() => validateRequest(req, allow), (err) => err instanceof RequestRejected && re.test(err.message));
}

test("valid request", () => {
  const req = validateRequest(baseRequest(repo), allow);
  assert.equal(req.provider, "claude");
  assert.equal(req.baseProvider, "claude");
  assert.equal(req.model, null);
  assert.equal(req.effort, null);
  assert.equal(req.timeoutSeconds, 1800); // phase default
  assert.ok(req.requestDigest.startsWith("sha256:"));
});

test("wrong schema version rejected", () => {
  expectReject({ ...baseRequest(repo), schema_version: 2 }, /schema_version/);
});

test("unknown field rejected", () => {
  expectReject({ ...baseRequest(repo), extra: "nope" }, /unknown request field/);
});

test("missing required field rejected", () => {
  const r = baseRequest(repo);
  delete r.prompt;
  expectReject(r, /missing required field/);
});

test("run_id traversal rejected", () => {
  expectReject({ ...baseRequest(repo), run_id: "../../etc" }, /run_id/);
});

test("run_id dot segments rejected", () => {
  for (const bad of [".", "..", "...", ".hidden", "a..b", "-leading"]) {
    expectReject({ ...baseRequest(repo), run_id: bad }, /run_id/);
  }
});

test("normal run_id accepted", () => {
  for (const ok of ["20260530-165017-slug", "r1", "Run_2.0"]) {
    assert.equal(validateRequest({ ...baseRequest(repo), run_id: ok }, allow).runId, ok);
  }
});

test("provider not in allowlist rejected", () => {
  expectReject({ ...baseRequest(repo), provider: "copilot" }, /provider/);
});

test("mode not in allowlist rejected", () => {
  expectReject({ ...baseRequest(repo), mode: "rm-rf" }, /mode/);
});

test("repo outside root rejected", () => {
  const other = makeTempDir();
  tmpDirs.push(other);
  expectReject({ ...baseRequest(repo), repo: other }, /not under/);
});

test("relative repo rejected", () => {
  expectReject({ ...baseRequest(repo), repo: "relative/path" }, /absolute/);
});

test("codex profile must be allowlisted", () => {
  expectReject({ ...baseRequest(repo), provider: "codex", profile: "root" }, /profile/);
});

test("allowed codex profile ok", () => {
  const req = validateRequest({ ...baseRequest(repo), provider: "codex", profile: "work" }, allow);
  assert.equal(req.profile, "work");
  assert.equal(req.baseProvider, "codex");
});

test("claude profile rejected (unsupported)", () => {
  expectReject({ ...baseRequest(repo), profile: "anything" }, /claude profiles are not supported/);
});

test("copilot rejected by default allowlist (opt-in)", () => {
  // default makeAllowlist providers = claude, codex
  expectReject({ ...baseRequest(repo), provider: "copilot" }, /provider .* not in allowlist/);
});

test("copilot accepted when allowlisted", () => {
  const withCopilot = makeAllowlist(repo, { providers: ["claude", "codex", "copilot"] });
  const req = validateRequest({ ...baseRequest(repo), provider: "copilot" }, withCopilot);
  assert.equal(req.provider, "copilot");
  assert.equal(req.baseProvider, "copilot");
  assert.equal(req.capability, "read_only_review");
});

test("provider alias resolves to base provider, model, and fixed profile", () => {
  const withAliases = makeAllowlist(repo, {
    providers: ["claude-opus", "codex-gpt52"],
    profiles: { claude: [], codex: ["azure"], copilot: [] },
    providerAliases: {
      "claude-opus": { base: "claude", model: "claude-opus-4-8", profile: null },
      "codex-gpt52": { base: "codex", model: "gpt-5.2-codex", profile: "azure" },
    },
  });

  const claude = validateRequest({ ...baseRequest(repo), provider: "claude-opus", effort: "max" }, withAliases);
  assert.equal(claude.provider, "claude-opus");
  assert.equal(claude.baseProvider, "claude");
  assert.equal(claude.model, "claude-opus-4-8");
  assert.equal(claude.profile, null);

  const codex = validateRequest({ ...baseRequest(repo), provider: "codex-gpt52" }, withAliases);
  assert.equal(codex.provider, "codex-gpt52");
  assert.equal(codex.baseProvider, "codex");
  assert.equal(codex.model, "gpt-5.2-codex");
  assert.equal(codex.profile, "azure");
  assert.throws(
    () => validateRequest({ ...baseRequest(repo), provider: "codex-gpt52", profile: "work" }, withAliases),
    (err) => err instanceof RequestRejected && /already fixes profile/.test(err.message),
  );
});

test("explicit effort is accepted but omitted effort stays null", () => {
  const codexDefault = validateRequest({ ...baseRequest(repo), provider: "codex" }, allow);
  assert.equal(codexDefault.effort, null);
  const codexOverride = validateRequest({ ...baseRequest(repo), provider: "codex", effort: "xhigh" }, allow);
  assert.equal(codexOverride.effort, "xhigh");
  expectReject({ ...baseRequest(repo), provider: "codex", effort: "max" }, /effort .* not allowed/);
});

test("copilot profile rejected", () => {
  const withCopilot = makeAllowlist(repo, { providers: ["claude", "codex", "copilot"] });
  assert.throws(
    () => validateRequest({ ...baseRequest(repo), provider: "copilot", profile: "x" }, withCopilot),
    (err) => err instanceof RequestRejected && /copilot profiles are not supported/.test(err.message),
  );
});

test("capability defaults to read_only_review", () => {
  const req = validateRequest(baseRequest(repo), allow);
  assert.equal(req.capability, "read_only_review");
  assert.deepEqual(req.capabilities, ["read_only_review"]);
});

test("explicit workspace_write capability accepted when allowlisted", () => {
  const req = validateRequest({ ...baseRequest(repo), capability: "workspace_write" }, allow);
  assert.equal(req.capability, "workspace_write");
  assert.deepEqual(req.capabilities, ["workspace_write"]);
});

test("capabilities array accepts singleton and rejects implicit combinations", () => {
  const singleton = validateRequest({ ...baseRequest(repo), capabilities: ["workspace_write"] }, allow);
  assert.equal(singleton.capability, "workspace_write");
  assert.deepEqual(singleton.capabilities, ["workspace_write"]);
  assert.throws(
    () => validateRequest({ ...baseRequest(repo), capabilities: ["workspace_write", "remote_ops"] }, allow),
    (err) => err instanceof RequestRejected && /allowed_capability_sets/.test(err.message),
  );
  assert.throws(
    () => validateRequest({ ...baseRequest(repo), capability: "workspace_write", capabilities: ["workspace_write"] }, allow),
    (err) => err instanceof RequestRejected && /either capability or capabilities/.test(err.message),
  );
});

test("remote_ops is rejected for low-level run requests", () => {
  const withRemoteOps = makeAllowlist(repo, { capabilities: ["read_only_review", "remote_ops"] });
  assert.throws(
    () => validateRequest({ ...baseRequest(repo), capability: "remote_ops" }, withRemoteOps),
    (err) => err instanceof RequestRejected && /only supported for delegate_request/.test(err.message),
  );
  const withCombo = makeAllowlist(repo, {
    capabilities: ["read_only_review", "workspace_write", "remote_ops"],
    allowedCapabilitySets: [["read_only_review"], ["workspace_write"], ["remote_ops"], ["workspace_write", "remote_ops"]],
  });
  assert.throws(
    () => validateRequest({ ...baseRequest(repo), capabilities: ["workspace_write", "remote_ops"] }, withCombo),
    (err) => err instanceof RequestRejected && /only supported for delegate_request/.test(err.message),
  );
});

test("the retired low-level `fast` request field is now rejected as unknown", () => {
  // `fast` belongs only to high-level debate_request workflow selection, not to
  // low-level run/run-batch child CLI launch specs.
  expectReject({ ...baseRequest(repo), fast: true }, /unknown request field/);
});

test("capability not in allowlist rejected", () => {
  const ro = makeAllowlist(repo, { capabilities: ["read_only_review"] });
  assert.throws(
    () => validateRequest({ ...baseRequest(repo), capability: "workspace_write" }, ro),
    (err) => err instanceof RequestRejected && /capability/.test(err.message),
  );
});

test("unknown capability value rejected", () => {
  expectReject({ ...baseRequest(repo), capability: "root" }, /capability/);
});

test("empty prompt rejected", () => {
  expectReject({ ...baseRequest(repo), prompt: "   " }, /prompt/);
});

test("timeout out of bounds rejected", () => {
  expectReject({ ...baseRequest(repo), timeout_seconds: 999999 }, /timeout_seconds/);
});

test("timeout boundary: 86400 accepted, 86401 rejected", () => {
  assert.equal(validateRequest({ ...baseRequest(repo), timeout_seconds: 86400 }, allow).timeoutSeconds, 86400);
  expectReject({ ...baseRequest(repo), timeout_seconds: 86401 }, /timeout_seconds/);
});

test("symlink escape rejected after realpath", () => {
  const outside = makeTempDir();
  tmpDirs.push(outside);
  const link = join(repo, "escape");
  symlinkSync(outside, link);
  mkdirSync(join(outside, "x"), { recursive: true });
  expectReject({ ...baseRequest(repo), repo: link }, /not under/);
});
