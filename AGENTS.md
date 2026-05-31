# AGENTS.md

Project rules for agents working in this repository. This file is about how to
change *this codebase*; it is not a skill block to copy into other projects.

## What this repo is

A small, deliberately narrow set of method skills for bounded multi-CLI debate,
plus one optional execution adapter:

- `skills/debate-router` — classifies an explicitly requested debate and runs a
  bounded critique/cross-review/arbitration flow.
- `skills/cli-launch` — builds non-interactive launch specs for selected local
  agent CLIs.
- `runners/debate-agent` — an optional, separately-permissioned thin execution
  adapter (TypeScript/Node) that launches `claude`/`codex` from inside a
  sandboxed parent agent. **This is the only runtime in the repo.**
- `evals/` — paired evals for the routing/boundary behavior.

## Core invariants (do not break)

1. **Skills are prompts, not code.** `skills/*/SKILL.md` are model instructions.
   Installing or changing the runner never changes a skill's behavior on its
   own — the SKILL.md must say so. Keep that in mind when wiring new behavior.
2. **The runner owns execution, never debate semantics.** `runners/debate-agent`
   may own allowlists, realpath cwd, static argv, env hygiene, timeout,
   process-group kill, capability/sandbox posture, parallel fan-out, and audit.
   It must **not** know about debate modes, candidate freezing, roles,
   `DebateRecord`, arbitration, or provider allocation. Those live in
   `debate-router`. Do not add a `proposal_attack` / `multi_path` /
   `provider: auto` API to the runner; add generic primitives (`run`,
   `run-batch`) and let the caller compose them.
3. **The runner is closed by default and fails closed.** No `repo_roots` ⇒ every
   request rejected. Malformed config raises at startup; the daemon's per-request
   allowlist reload instead keeps the last-good config and warns — neither path
   ever silently widens. Unknown request/batch fields are rejected. Default
   `capability` is `read_only_review`. Preserve these when editing.
4. **Static argv only.** No request value is ever spliced into a child `argv` as
   a flag; the prompt goes on stdin. Capability/profile select among fixed safe
   templates. Keep it that way.
5. **Two audit trails, linked by id only.** Protocol audit
   (`~/.debate-router/<run-id>/`) is the skill's; execution audit
   (`~/.debate-agent/<run-id|batch-id>/`) is the runner's. The runner never
   writes into `~/.debate-router/`.
6. **Zero runtime dependencies for the runner.** Dev deps are `typescript` and
   `@types/node` only. Do not add runtime packages.

## Working on the runner (`runners/debate-agent`)

- TypeScript → CommonJS via `tsc`; Node `>=18`; tests on the built-in
  `node:test` runner. Source in `src/`, tests in `test/`, build output in
  `dist/` (gitignored).
- Build: `npm run build`. Test: `test/run_tests.sh` (`--unit` / `--integration`),
  or `npm test`. The opt-in Codex Rules check needs
  `DEBATE_AGENT_CODEX_RULES_TEST=1` and `codex` on PATH.
- Every behavior change needs a test. Security-relevant changes (path handling,
  env, argv, allowlist, audit) need a regression test that fails without the fix.
- Do not commit `dist/` or `node_modules/`.

### Testing the debate daemon (the `watch` step loop)

The execution core (`run` / `run-batch`) is tested with **stub CLI binaries**
(a fake `claude`/`codex` that echoes argv/stdin) — keep that.

The **daemon** (`watch`: read `~/.debate-router/requests/`, run the debate, write
`responses/`) is tested by **mocking the LLM at the brain/worker seam**, in the
spirit of `~/Documents/Code/codex` (`codex-rs/core/tests/common/responses.rs`) —
script the responses, drive the loop end-to-end, assert on both the prompts sent
and the response written:
- `test/debate.test.ts` — the step loop with an **injected scripted brain**
  (`BrainFn`) and **stubbed workers** (`DebateDeps.runItems`): asserts multi-phase
  flow + feedback, capability forced read-only, provider passthrough, degraded on
  step cap, error on brain failure.
- `test/brain.test.ts` — the brain's JSON step-decision parser.
- `test/watch.test.ts` — mailbox primitives (validate / claim / snapshot / atomic
  write) + `processNewRequests` end-to-end via injected `makeDeps`.

Keep these deterministic seams: `runDebate(req, allow, deps)` takes an injectable
`brain` and `runItems`; `processNewRequests(..., { makeDeps })` injects per-request
deps. No real model calls, no login. When extending the protocol, add a scripted
brain case that exercises the new behavior. (An HTTP/SDK mock — codex's `wiremock`
analog — would only be needed if a future brain talks to an LLM over HTTP.)

## Conventions

- Keep the privileged surface small and auditable; prefer clarity over cleverness
  in `src/`.
- When behavior changes, update the relevant `SKILL.md`, the runner `README.md`,
  any directly referenced files, and at least one eval or test that protects the
  new boundary.
- Match the surrounding code's style; do not introduce a formatter/linter config
  or reorganize files without reason.
