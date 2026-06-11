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
- `skills/cli-delegator` — submits bounded one-shot delegated work through the
  daemon request-file mailbox and reads daemon-written artifacts.
- `runners/debate-agent` — an optional, separately-permissioned thin execution
  adapter (TypeScript/Node). Its `watch` daemon runs **outside** the sandbox and
  launches `claude`/`codex` on behalf of sandboxed parent agents (which cannot
  spawn them themselves). It handles `debate-router`'s `debate_request` mailbox
  and the first `cli-delegator` `delegate_request` mailbox slice. **This is the
  only runtime in the repo.**
- `evals/` — paired evals for the routing/boundary behavior.

## Core invariants (do not break)

1. **Skills are prompts, not code.** `skills/*/SKILL.md` are model instructions.
   Installing or changing the runner never changes a skill's behavior on its
   own — the SKILL.md must say so. Keep that in mind when wiring new behavior.
2. **The mailbox/daemon split exists to bypass the parent's top-level command
   reviewer.** `debate-router` and `cli-delegator` can run inside a sandboxed
   parent whose top-level reviewer (e.g. Codex Rules / execpolicy) kills any
   attempt to spawn a process. So sandboxed skills may **only write high-level
   request files and reason in-context — they must never spawn a CLI directly.**
   ALL execution happens in the separately-whitelisted `debate-agent` daemon,
   **outside** the sandbox, reached only through file mailboxes under
   `~/.debate-router/` (`debate_request`) and `~/.cli-delegator/`
   (`delegate_request`, currently `mode: "once"` only). The daemon plans and runs
   debates; the skills submit requests and present results.
3. **Debate STRATEGY lives in the skill; debate FORMAT and execution live in the
   daemon.** The daemon may run a **one-shot planner** — a CLI that loads
   `debate-router`'s strategy (its planner mode) to design the debate — then
   validate the plan and execute it. But: (a) the daemon never hardcodes debate
   strategy (entry cases, when to cross-review, arbitration/degrade rules); that
   stays in the skill, loaded by the planner. (b) The daemon owns the plan
   **format/schema**, its validator, and the planner's strict-format prompt + the
   CLI's native JSON-Schema flag (claude `--json-schema`, codex `--output-schema`)
   — the skill never records the plan format. (c) **One** planning call
   (plus bounded retries), then **mechanical** execution: the daemon substitutes an
   earlier phase's output into a later prompt as text (`{{id.output}}`) and
   branches only on execution **status**, never by parsing a worker's text content.
   A per-step planner is the retired brain loop (and its JSON-format failures) —
   don't. Keep generic execution primitives (`run`, `run-batch`); don't add a
   `proposal_attack` / `multi_path` / `provider: auto` API. (d) **Provider
   failure fallback is the daemon's, not the primitives'.** When a worker or the
   planner cannot launch or fails to produce output (for example `rate_limited`,
   `nonzero_exit`, `timeout`, `missing_cli`, or `exception`), the daemon re-runs
   the *same task* on the next available engine — but that swap lives in
   `debate.ts` / `planner.ts` and branches **only on execution status/category**,
   never on a worker's text. Rejections (policy/schema validation failures) are
   not swapped. The primitives still do not retry or rebalance; they only label
   failures, including the refinement `rate_limited`. The request/batch schema
   gains **no** field and there is still no `provider: auto`. Detection signatures
   for the `rate_limited` label and the fallback order are allowlist config, not
   code.
   (e) **Structured-output calls are named + resumable.** When a call needs the
   CLI's native JSON-Schema structured output, an invalid result must be **fixed,
   not regenerated** — so the call runs in a **named, resumable session**: the
   claude planner sets a runner-generated `--session-id` on the first attempt and
   `--resume`s it on an invalid-plan retry, sending only the validator error so the
   model patches in-context. The plan is currently the ONLY structured-output
   artifact. The session id is runner-generated (not a request value), so the
   static-argv rule (#5) still holds — but note this does introduce persistent
   claude session state between plan attempts (a deliberate exception to the
   otherwise-stateless children). `codex exec` cannot pin a session id for a
   non-interactive structured run, so codex is **not** resumed — it regenerates
   each attempt (asymmetry on purpose), and a resume that fails drops the session
   so the next attempt regenerates fresh.
   Any future structured-output call MUST follow this rule (named + resumable, with
   a regenerate fallback when the CLI cannot resume).
   (f) **`fast` requests skip the planner — a deliberate exception to (a)/(c) and
   to #2's "the daemon plans … the whole debate."** The debate-router skill
   defaults to writing `fast: true`; a fast `debate_request` runs a **fixed,
   hardcoded lean 2-phase shape** (two parallel reviewers → one arbiter,
   `debate.ts buildFastPlan`) with **generic worker prompts** — no planner call at
   all. This is a speed/token-vs-depth tradeoff: the fast path is shallower (no
   planner-designed, task-specific prompts). The hardcoded shape MIRRORS
   debate-router's FAST workflow **by hand** (same pattern as `launch.ts`
   mirroring `cli-launch`); keep them in sync. The fixed roles consume the
   effective request `providers` order positionally: P1 uses `providers[0]`, P2
   uses `providers[1]` or falls back to `providers[0]`, A1 uses `providers[2]` or
   falls back to `providers[0]`; extra providers are ignored by this fixed role
   assignment. The **full** planner path (one planning call + mechanical
   execution, per (c)) still runs for `fast: false`, used only when the human
   explicitly asks for a serious/thorough debate. For hand-authored daemon
   requests, the raw omitted-field default remains conservative `fast: false`; the
   skill must write `fast: true` when it wants the lean default. `fast` only
   chooses this fixed workflow; it MUST NOT add Codex speed/reasoning overrides.
   Codex model, reasoning effort, and service tier come from the user's Codex
   config/profile unless a low-level request or planner launch explicitly sets
   `effort`, in which case only `model_reasoning_effort` is overridden. Codex
   workers use `codex exec --json` for live progress streams, while codex planner
   calls keep the structured `--output-schema/-o` path.
   (g) **The intermediates sidecar is canonical execution state.** The daemon
   writes `responses/<id>.intermediates.json` incrementally with the validated
   plan (or fixed fast plan) and each clean worker `output_markdown`. Later phase
   prompt substitution reads from that persisted sidecar, not from a parallel
   in-memory-only representation. The sidecar MUST be validated before reuse:
   schema version, request id, normalized request digest, plan shape/semantics,
   output row shape, duplicate items, and item/phase/provider lineage must all
   match the current request and allowlist. On restart, orphaned `processing/`
   requests are resumed through the
   normal plan→execute path: reuse a valid persisted plan, skip only completed
   launch rows that match that plan, and run missing/incomplete downstream
   launches. This applies to both `fast: true` and `fast: false`. Do not
   reintroduce a second source of truth for intermediate outputs.
4. **The runner is closed by default and fails closed.** No `repo_roots` ⇒ every
   request rejected. Malformed config raises at startup; the daemon's per-request
   allowlist reload instead keeps the last-good config and warns — neither path
   ever silently widens. Unknown request/batch/delegate fields are rejected.
   Default `capabilities` is `["read_only_review"]` (`capability` remains only as
   a legacy singleton spelling). Capability combinations are allowed only when the
   exact set is listed in `allowlist.allowed_capability_sets`; listing individual
   capabilities must never silently permit their combination. `delegate_request`
   support is additionally gated by `allowlist.delegate.enabled`, which defaults to false.
   `remote_ops` is delegate-only, Claude-only, and gated by a separate
   `allowlist.remote_ops` block; never make SSH hosts or Bash argv request fields,
   and never allow debate workers to use `remote_ops`.
   Preserve these when editing.
5. **Static argv only.** No request value is ever spliced into a child `argv` as
   a flag; the prompt goes on stdin. Capabilities/profile and the optional
   `debate_request.planner_provider` / `debate_request.providers` select among
   fixed safe templates. `delegate_request.provider` / `profile` /
   `capabilities` / `capability` / `mode` also only select among fixed templates and allowlist
   policy; `skill_hint` is prompt-only and must never become argv. Omitted
   `debate_request.providers` defaults to `["codex"]`; add other engines
   explicitly in that array. Provider aliases are allowed only as allowlist-defined
   provider ids (`provider_aliases`); the alias's base provider, model, and codex
   profile are static operator config, and a request may only select the alias id,
   never supply argv flags or ad-hoc model/profile strings. Keep it that way.
   Child env is also rebuilt from a small allowlist. The only credential exception
   is provider env loaded by the runner itself from a regular-file
   `<repo>/.debate-agent/env` or `~/.config/debate-agent/env`, injecting only
   provider-specific keys into matching launches: `ANTHROPIC_*` for Claude, and
   `OPENAI_*` / `AZURE_OPENAI_*` for Codex. Invalid project env paths such as
   symlinks/directories are ignored and may fall back to global config; a valid
   project file is not merged with global config. The only other env exception is
   `remote_ops.inject_ssh_auth_sock`, which may re-inject `SSH_AUTH_SOCK` into a
   Claude delegate child when the operator enables it in allowlist config. Codex
   must not inherit `OPENAI_*` from the parent process; use the daemon provider
   env file instead. Do not add request-controlled env fields or generic shell
   sourcing.
6. **Two audit trails, linked by id only.** Protocol audit
   (`~/.debate-router/<run-id>/`) is the skill's; execution audit
   (`~/.debate-agent/<run-id|batch-id>/`) is the runner's. The runner never
   writes into `~/.debate-router/`.
7. **Zero runtime dependencies for the runner.** Dev deps are `typescript` and
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
- **A change to the agent's own runtime flow MUST add or update a cross-process
  integration test.** Anything touching the `watch` daemon, the mailbox
  request/response shapes, or the plan→execute pipeline must be covered by
  `test/integration.test.ts` (a REAL `bin/debate-agent` subprocess, stub CLI on
  PATH), not only an in-process unit test — the injected-deps seam can stay green
  while the real subprocess/CLI surface is broken. (This mirrors how the codex
  repo gates flow changes.)
- Do not commit `dist/` or `node_modules/`.

### Testing the watch daemon (mailbox handlers)

The execution core (`run` / `run-batch`) is tested with **stub CLI binaries**
(a fake `claude`/`codex` that echoes argv/stdin) — keep that.

The **daemon** (`watch`: read high-level mailbox requests, dispatch to a handler,
write `responses/`) is tested by **injecting a scripted planner and stub workers**
so the debate flow runs without a real model:
- `test/plan.test.ts` — the plan parser + validator (the one strict-format
  surface): JSON extraction from prose/fences, unique ids, allowlisted providers,
  and that every `{{id.output}}` references a STRICTLY earlier phase.
- `test/debate.test.ts` — the orchestrator with a scripted `planner` and stub
  `runItems`: asserts mechanical templating (earlier outputs substituted into
  later prompts), persisted-sidecar resume/skips, planner retry-on-invalid,
  plan-failure → error response, status-based degrade, and capability forced
  read-only.
- `test/watch.test.ts` — mailbox primitives (validate `debate_request` / claim /
  snapshot / atomic write) + `processNewRequests` / `recoverOrphans` via injected
  `makeDeps` (scripted planner + stub workers): id-mismatch error, fail-closed
  planner provider, orphan resume, per-request allowlist reload.
- `test/watch-e2e.test.ts` — scripted planner but **REAL worker subprocess spawns**
  (a bash stub CLI): asserts the answer = worker stdout, the claimed→cleared
  `processing/` entry, the live `<id>.log`, and the read-only argv on the child.
- `test/delegate.test.ts` — `delegate_request` validation: disabled by default,
  no argv/env fields, bounded `once` windows.
- `test/integration.test.ts` — the real `bin/debate-agent watch` subprocess,
  where one stub CLI serves as both planner and worker, driving a
  `debate_request` end-to-end across the process boundary, including orphan
  resume from persisted intermediates. It also covers the `~/.cli-delegator`
  mailbox first slice: `delegate_request` `mode: "once"` launches a stub worker
  and writes compatibility artifacts.

Keep these deterministic seams: `runDebate(req, allow, deps)` takes an injectable
`planner: PlannerFn`, `runItems` (defaults to the real `runPreparedItems`), and
`readOutput`; `processNewRequests(mb, ignore, allow, { makeDeps })` injects them.
No real model calls, no login. The plan FORMAT lives in `planner.ts` + `plan.ts`;
debate STRATEGY lives in the `debate-router` skill, not here.

## Conventions

- Keep the privileged surface small and auditable; prefer clarity over cleverness
  in `src/`.
- When behavior changes, update the relevant `SKILL.md`, the runner `README.md`,
  any directly referenced files, and at least one eval or test that protects the
  new boundary.
- **The `debate_request` format has one source of truth: `validateDebateRequest`
  (`ALLOWED_DEBATE_FIELDS` in `src/mailbox.ts`). If you change it, you MUST also
  update the debate-router skill's request-file checker
  (`skills/debate-router/scripts/check-request.mjs`) and SKILL.md's Mode 2
  example.** The pinning test `test/check-request.test.ts` fails until the skill
  checker's field set matches the daemon's — that is the mechanical guard against
  forgetting, so do not delete or weaken it.
- Match the surrounding code's style; do not introduce a formatter/linter config
  or reorganize files without reason.
