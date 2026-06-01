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
  adapter (TypeScript/Node). Its `watch` daemon runs **outside** the sandbox and
  launches `claude`/`codex` on behalf of the sandboxed parent agent (which cannot
  spawn them itself). **This is the only runtime in the repo.**
- `evals/` — paired evals for the routing/boundary behavior.

## Core invariants (do not break)

1. **Skills are prompts, not code.** `skills/*/SKILL.md` are model instructions.
   Installing or changing the runner never changes a skill's behavior on its
   own — the SKILL.md must say so. Keep that in mind when wiring new behavior.
2. **The mailbox/daemon split exists to bypass the parent's top-level command
   reviewer.** `debate-router` runs inside a sandboxed parent whose top-level
   reviewer (e.g. Codex Rules / execpolicy) kills any attempt to spawn a process.
   So the skill (in the sandbox) may **only write a high-level `debate_request`
   file and reason in-context — it must never spawn a CLI or execute the debate.**
   ALL execution happens in the separately-whitelisted `debate-agent` daemon,
   **outside** the sandbox, reached only through the file mailbox under
   `~/.debate-router/`. The daemon plans and runs the whole debate; the skill just
   submits the request and presents the result. Do not have the skill invoke a CLI
   directly.
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
   `proposal_attack` / `multi_path` / `provider: auto` API. (d) **Rate-limit
   fallback is the daemon's, not the primitives'.** When a worker or the planner is
   `rate_limited`, the daemon re-runs the *same task* on the next available engine
   — but that swap lives in `debate.ts` / `planner.ts` and branches **only on
   `error_category`** (execution status, per (c)), never on a worker's text. The
   primitives only *label* a failure `rate_limited` (no retry, no rebalance); the
   request/batch schema gains **no** field and there is still no `provider: auto`.
   Detection signatures and the fallback order are allowlist config, not code.
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
   each attempt (asymmetry on purpose), and a resume that fails for any
   non-rate-limit reason drops the session so the next attempt regenerates fresh.
   Any future structured-output call MUST follow this rule (named + resumable, with
   a regenerate fallback when the CLI cannot resume).
   (f) **`fast` requests skip the planner — a deliberate exception to (a)/(c) and
   to #2's "the daemon plans … the whole debate."** `fast` is the **default**; a
   fast `debate_request` runs a **fixed, hardcoded lean 2-phase shape** (two
   parallel reviewers → one arbiter, `debate.ts buildFastPlan`) with **generic
   worker prompts** — no planner call at all. This is a speed/token-vs-depth
   tradeoff: the fast path is shallower (no planner-designed, task-specific
   prompts). The hardcoded shape MIRRORS debate-router's FAST workflow **by hand**
   (same pattern as `launch.ts` mirroring `cli-launch`); keep them in sync. The
   **full** planner path (one planning call + mechanical execution, per (c)) still
   runs for `fast: false`, used only when the human explicitly asks for a
   serious/thorough debate. Also: **codex always runs turbo (`service_tier=fast` /
   `fast_mode`) at xhigh** as its default posture — fully decoupled from the `fast`
   field; there is no per-request/per-launch turbo toggle.
4. **The runner is closed by default and fails closed.** No `repo_roots` ⇒ every
   request rejected. Malformed config raises at startup; the daemon's per-request
   allowlist reload instead keeps the last-good config and warns — neither path
   ever silently widens. Unknown request/batch fields are rejected. Default
   `capability` is `read_only_review`. Preserve these when editing.
5. **Static argv only.** No request value is ever spliced into a child `argv` as
   a flag; the prompt goes on stdin. Capability/profile select among fixed safe
   templates. Keep it that way.
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

### Testing the watch daemon (plan + execute)

The execution core (`run` / `run-batch`) is tested with **stub CLI binaries**
(a fake `claude`/`codex` that echoes argv/stdin) — keep that.

The **daemon** (`watch`: read a `debate_request`, **plan** via a one-shot planner
CLI, then **execute** the plan's worker batches, write `responses/`) is tested by
**injecting a scripted planner and stub workers** so the whole flow runs without a
real model:
- `test/plan.test.ts` — the plan parser + validator (the one strict-format
  surface): JSON extraction from prose/fences, unique ids, allowlisted providers,
  and that every `{{id.output}}` references a STRICTLY earlier phase.
- `test/debate.test.ts` — the orchestrator with a scripted `planner` and stub
  `runItems`: asserts mechanical templating (earlier outputs substituted into
  later prompts), planner retry-on-invalid, plan-failure → error response,
  status-based degrade, and capability forced read-only.
- `test/watch.test.ts` — mailbox primitives (validate `debate_request` / claim /
  snapshot / atomic write) + `processNewRequests` via injected `makeDeps`
  (scripted planner + stub workers): id-mismatch error, fail-closed planner
  provider, orphan recovery, per-request allowlist reload.
- `test/watch-e2e.test.ts` — scripted planner but **REAL worker subprocess spawns**
  (a bash stub CLI): asserts the answer = worker stdout, the claimed→cleared
  `processing/` entry, the live `<id>.log`, and the read-only argv on the child.
- `test/integration.test.ts` — the real `bin/debate-agent watch` subprocess, where
  one stub CLI serves as both planner and worker, driving a `debate_request`
  end-to-end across the process boundary.

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
