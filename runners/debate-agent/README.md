# debate-agent

An **optional, thin execution adapter** that runs already-decided CLI launch
requests outside a parent agent sandbox, under a narrow allowlist.

It exists so that `debate-router` can run `claude` and `codex` CLIs as debate
participants even though it lives in a **sandboxed parent agent whose top-level
reviewer (e.g. Codex Rules) would kill a direct spawn**. The skill never spawns:
it only writes request files. This separately-whitelisted daemon does the
spawning **outside** the sandbox, reached only through the file mailbox — without
granting the parent agent broad `bash`, `node`, `python`, `claude`, or `codex`
access. (See AGENTS.md invariant #2.)

This is **not** a framework, an orchestrator, or a second router. The skill
layer in `skills/` stays runtime-free and framework-free. This runner is the
only component in the repo that is meant to be granted execution privilege, and
it is deliberately small enough to audit in one sitting.

Implemented in **TypeScript**, compiled to CommonJS with `tsc`, and run under
Node (`>=18`). It has **zero runtime dependencies**; the only dev dependencies
are `typescript` and `@types/node`.

---

## What it owns vs. what it must never own

This boundary is the whole point of the runner. It comes straight from the
design debate (`~/.debate-router/20260530-165017-external-debate-agent-design/audit.yaml`).

| Layer | Owner | Responsibility |
| --- | --- | --- |
| Debate protocol | `skills/debate-router` | entry-case classification, candidate freeze, critique/cross-review/arbitration, `DebateRecord`, `DebateSummary` |
| Launch conventions | `skills/cli-launch` | provider command shape, non-interactive flags, profiles, phase-aware timeout defaults |
| **Execution boundary** | **`runners/debate-agent` (this)** | allowlist enforcement, `realpath` cwd, static argv construction, env allowlist, timeout, process-group kill, **execution audit** |

The runner **must never**:

- accept an arbitrary shell string, dynamic launch spec, or request-controlled
  `argv` / `env`;
- interpret debate roles, freeze candidates, generate or edit `DebateRecord`,
  or decide topology/strategy;
- import `cli-launch` as a generic "run any launch spec" executor. It keeps
  its **own static provider→argv mapping** (`src/launch.ts`) and only *declares*
  that the mapping follows `cli-launch` Provider Defaults. Keep the two in
  sync by hand on purpose — the privileged surface stays self-contained and
  reviewable.

## Relationship to the two audit trails (constraint A1)

There are two separate audit directories, linked only by `run_id`:

```
~/.debate-router/<run-id>/audit.yaml          # protocol audit  (owned by debate-router)
~/.debate-agent/<run-id>/                    # execution audit  (owned by this runner)
  exec-<phase>-<provider>-<ts>-<pid>-<seq>.yaml   # one file per launched child
  exec-<...>.stdout.txt
  exec-<...>.stderr.txt
```

Audit filenames carry a `pid` + process-local sequence and are created with an
exclusive `wx` open, so two launches in the same second never overwrite each
other — the "one file per launched child" guarantee holds. The runner never
writes into `~/.debate-router/`; `debate-router` references the execution audit
by `run_id` from its `DebateRecord.cli_participation` rows.

## CLI

```
debate-agent [--config <allowlist.json>] run       --request <request.json>
debate-agent [--config <allowlist.json>] run-batch  --request <batch.json>
debate-agent [--config <allowlist.json>] validate   --request <request.json>
debate-agent [--config <allowlist.json>] watch       [--planner claude|codex]
debate-agent print-rules [--path <installed-path>]
```

`run` / `run-batch` are the low-level executors. `watch` is the **mailbox
daemon** that takes a high-level `debate_request` and runs the whole debate —
plan then execute — on behalf of a sandboxed `debate-router`; see
[watch](#watch-the-plan--execute-daemon).

`run` prints a single **result JSON** object to stdout and exits non-zero if the
request was rejected or the child failed. `run-batch` runs N requests in parallel
and prints a batch envelope (see [run-batch](#run-batch-parallel-execution)). The
child's own stdout/stderr go to files in the execution audit dir, never to the
runner's stdout, so the caller always gets a clean machine-readable envelope.

## Request schema (versioned — constraint A3)

`schema_version` is required and must equal the supported version. **Unknown
top-level fields are rejected** (strict). The runner never reads anything not
listed here.

```json
{
  "schema_version": 1,
  "run_id": "20260530-165017-external-debate-agent-design",
  "phase": "proposal_generation",
  "provider": "claude",
  "mode": "debate-proposal",
  "repo": "/Users/you/5xflm-fwsap/Codes/Crawler",
  "profile": null,
  "capability": "read_only_review",
  "prompt": "Independently propose ...",
  "timeout_seconds": 1800
}
```

| Field | Type | Validation |
| --- | --- | --- |
| `schema_version` | int | must equal `REQUEST_SCHEMA_VERSION` (1) |
| `run_id` | string | matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and contains no `..`; must start alphanumeric, so `.`, `..`, and `.hidden` are rejected (used as a path segment) |
| `phase` | string | one of `proposal_generation`, `debate_execution`, `critique`, `cross_review`, `arbitration`, `other` |
| `provider` | string | in the provider allowlist (`claude`, `codex` by default; `copilot` is supported but opt-in — see below) |
| `mode` | string | in the mode allowlist (audit/policy label only; does not change argv) |
| `repo` | string | absolute path; `realpath` must resolve under an allowed repo root and be an existing directory |
| `profile` | string \| null | `null`, or in the profile allowlist for that provider. **Only Codex has profiles the runner can honor** — Claude profiles (strips `CLAUDE_CONFIG_DIR`) and Copilot profiles are rejected |
| `capability` | string | `read_only_review` (default) or `workspace_write`; must be in the `capabilities` allowlist. Controls the child sandbox posture (see below) |
| `effort` | string | optional thinking depth (`--effort` / `model_reasoning_effort`). claude: `low\|medium\|high\|xhigh\|max` (default `high`); codex: `low\|medium\|high\|xhigh` (default `xhigh`). The planner picks this per launch |
| `fast` | bool | default `false`. When `true`, **codex** launches in turbo mode via per-invocation flags (`-c service_tier="fast" -c features.fast_mode=true`; no global config change). **claude and copilot are exempt** — claude's fast mode needs an API token, but the runner strips API keys and runs children on the logged-in account, so a fast flag could not take effect |
| `prompt` | string | non-empty, length ≤ `max_prompt_chars`; transported to the child via **stdin only** |
| `timeout_seconds` | int | a positive integer ≤ `86400` (fixed internal sanity cap, not configurable); if omitted, the phase-aware default is used |

Thinking effort is **per-launch** (the planner picks it): codex generally `xhigh`,
claude usually `high` (xhigh/max only when a launch needs deep reasoning). The
planner itself always runs `xhigh`. `fast` is independent of effort.

`provider` selects the binary. `mode` is only a coarse allowlisted intent label
recorded in the audit — it never selects a different binary or alters argv.
Adding a new provider or mode is a deliberate edit to `allowlist.json` and (for
providers) `src/launch.ts`, not something a request can do.

### Copilot (opt-in provider)

The standalone GitHub Copilot CLI is supported but **off by default**: the
default `providers` list is `["claude", "codex"]`, so a `copilot` request is
rejected unless the operator adds `"copilot"` to `providers`. Requires
`copilot login`.

Copilot is **lower-assurance** than Codex: it has no OS-level filesystem
sandbox, so the runner never grants it `--allow-all-*`, arbitrary shell, or
broadened paths/urls. Capability maps to Copilot's tool-permission flags
(`read_only_review` → `--deny-tool=write --deny-tool=shell`; `workspace_write` →
`--allow-tool=write --add-dir <repo> --deny-tool=shell`, i.e. file edits but
never shell). `COPILOT_ALLOW_ALL` is dropped from the child env so a parent
environment cannot override these. Keep it off unless you specifically want it.

### Capability (child sandbox posture)

`capability` is the runner's blast-radius control. It defaults to the safe
read-only posture, so a debate participant can never edit the repo unless the
operator **both** allowlists `workspace_write` **and** a request asks for it.

| capability | codex | claude | copilot | use |
| --- | --- | --- | --- | --- |
| `read_only_review` (default) | `exec --sandbox read-only` (no network) | `--permission-mode default` + deny `Edit/Write/MultiEdit/NotebookEdit` + allow `Read/Grep/Glob` and read-only git (`Bash(git diff:*)` / `log` / `show` / `status` / `blame`) | `--deny-tool=write --deny-tool=shell` | proposer / critic / reviewer — reads + read-only git, cannot edit |
| `workspace_write` | `--sandbox workspace-write` + network | `--permission-mode acceptEdits` | `--allow-tool=write --add-dir <repo>` (no shell) | implementation — may edit the repo |

**Assurance differs by provider.** Codex read-only is an **OS-level** sandbox
(`--sandbox read-only`) — a kernel guarantee — so it can run **any** read-only
command (git, build, tests, broad inspection). Claude has no OS sandbox here, so
its read-only posture is a **harness-level permission boundary**: writes are
denied (`--disallowedTools Edit/Write/MultiEdit/NotebookEdit`) and only read tools
+ a small set of **read-only git** subcommands are allowed (`Read/Grep/Glob`,
`Bash(git diff:*)`/`log`/`show`/`status`/`blame`) — verified that writes and
arbitrary shell stay denied, but it is not a kernel boundary, and read-only git
still trusts the repo's own git config (prefer codex for untrusted repos). Copilot
is similar (tool-permission flags, no OS sandbox). Treat codex as hard-isolated and
claude/copilot as permission-listed when reasoning about blast radius.

The **default allowlist lists only `read_only_review`**, so no automated child
can ever write — important once Codex Rules are set to `allow` (unattended).
`workspace_write` is OPT-IN: add it to `capabilities` only if you explicitly want
children to edit repos. The argv stays static: capability only selects among
fixed, safe templates.

### Prompt transport

For `claude` and `codex` the prompt is passed on the child's **stdin**, never as
an argv element — a prompt on stdin cannot be misparsed as a CLI flag, so there
is no flag-injection surface even if the prompt is attacker-influenced. Copilot
has no documented stdin prompt entry, so its prompt is bound to a single
`-p <text>` argv element; that is still one token (no flag injection) and is
redacted in `display_command`, but unlike stdin it is visible in `ps`.

## Result schema (versioned — constraint A3)

```json
{
  "schema_version": 1,
  "run_id": "...",
  "request_digest": "sha256:...",
  "provider": "claude",
  "phase": "proposal_generation",
  "mode": "debate-proposal",
  "status": "completed",
  "error_category": null,
  "returncode": 0,
  "elapsed_seconds": 54.1,
  "timeout_seconds": 1800,
  "display_command": "claude --print --permission-mode default <stdin-prompt>",
  "stripped_env_keys": ["ANTHROPIC_API_KEY", "..."],
  "stdout_path": "/Users/you/.debate-agent/<run-id>/exec-...stdout.txt",
  "stderr_path": "/Users/you/.debate-agent/<run-id>/exec-...stderr.txt",
  "audit_path": "/Users/you/.debate-agent/<run-id>/exec-....yaml"
}
```

`status` ∈ `completed | timed_out | error | rejected`.
`error_category` ∈ `null | rejected | timeout | missing_cli | nonzero_exit | rate_limited | exception`.
A `rejected` result is produced for any allowlist/schema failure and the child
is never launched. `rate_limited` is a refinement of a failed run: a non-zero,
non-timeout child whose stderr/stdout matches a provider's configured rate-limit
signature (see [Rate-limit fallback](#rate-limit-fallback)). It only **labels**
the result; `run` / `run-batch` never act on it — the daemon does.

## run-batch (parallel execution)

`run-batch` is the runner's one concurrency primitive: run N already-decided
requests in parallel. It is deliberately **semantics-free** — it does not know
whether the items are multi-path proposers, debate critics, or an eval sweep.
The caller (`debate-router`) decides roles, provider allocation (e.g. 2 codex +
2 claude), and how many surviving items are "enough". This is what lets a
sandboxed parent agent fan out to multiple CLIs through the single allowed path,
instead of `cli-launch`'s parent-side spawn (which the sandbox blocks).

Batch request:

```json
{
  "schema_version": 1,
  "batch_id": "20260530-debate",
  "max_parallel": 4,
  "items": [
    { "item_id": "P1", "request": { "...": "a full request object" } },
    { "item_id": "P2", "request": { "...": "..." } }
  ]
}
```

- Each `item.request` is a complete request, validated **individually**.
- **Envelope** problems (bad version, too many items > `max_batch_items`,
  duplicate `item_id`) reject the whole batch (no item runs).
- A single **item** that fails validation becomes a `rejected` item result and
  consumes no concurrency; valid items still run. The batch is then `degraded`,
  never wholly failed — matching degraded-debate semantics.
- Concurrency is capped by `min(max_parallel, allowlist.max_parallel)` globally
  and `max_parallel_per_provider` per provider.

Batch result (items in **input order**):

```json
{
  "schema_version": 1,
  "kind": "batch",
  "batch_id": "20260530-debate",
  "status": "completed | degraded | rejected",
  "item_count": 2,
  "max_parallel": 4,
  "items": [
    { "item_id": "P1", "status": "completed", "...": "full single result" },
    { "item_id": "P2", "status": "rejected", "reject_reason": "..." }
  ],
  "audit_path": "/Users/you/.debate-agent/<batch-id>/exec-...yaml"
}
```

Exit code is `0` only when every item completed; `degraded` / `rejected` exit
`1`, but the envelope is always parseable so the caller can inspect per-item
status. Provider allocation is the **caller's** job: the runner has no
`provider: auto` and never rebalances. (The `watch` daemon, a higher layer, *does*
swap a `rate_limited` launch onto another engine — see
[Rate-limit fallback](#rate-limit-fallback) — but `run-batch` itself never does.)

## watch (the plan + execute daemon)

`watch` is the out-of-sandbox engine for the file mailbox under
`~/.debate-router/` (override with `$DEBATE_AGENT_MAILBOX`). The sandboxed
`debate-router` skill writes ONE high-level `debate_request` (the task + repo);
the daemon then **plans** the debate (a one-shot planner CLI) and **executes** it
(read-only worker CLIs), and writes the final answer. This is what lets a
sandboxed parent get a multi-CLI debate without ever spawning a CLI itself — its
top-level reviewer would kill that (see AGENTS.md invariant #2).

```
~/.debate-router/
  requests/    debate-router writes <id>.json (a debate_request) here
  processing/  daemon claims a request by atomic rename (in-flight marker)
  responses/   daemon writes <id>.json result + <id>.log progress here
    <id>.streams/  per-launch live CLI debug streams (tail -f a slow worker)
  archive/     finished requests are MOVED here (durable record), never deleted
```

Each worker (and each planner attempt) streams its raw CLI output **live** to
`responses/<id>.streams/<launch>.log`, so you can `tail -f` a slow or hung worker
to see what it is doing. claude workers run with `--output-format stream-json`
for this (the runner extracts the clean final answer from the stream; the answer
path is unchanged). These files are **debug-only** and can grow large.

> **Audit caveat (planner).** Worker launches go through `runValidated`, so each is
> written to the execution audit dir (`~/.debate-agent/<run-id>/`). **Planner
> launches do not** — they call `execute()` directly, so a planner attempt (and any
> rate-limit provider rotation) is recorded only in the live `planner-<n>.log`
> stream and the progress `<id>.log`, not in the structured execution audit. This is
> a known exception to "every launch is audited"; rely on those logs for planner
> provenance.

On start it **recovers any orphaned `processing/` entries** (a request claimed
before a previous crash/restart gets an `error` response so the caller stops
waiting), then **snapshots existing requests and ignores them** (submit after the
daemon is up). It then polls `requests/`, and for each NEW request: claims it
(atomic rename into `processing/`), runs the whole debate, atomically writes
`responses/<id>.json`, and **moves the request into `archive/`** — `requests/`
stays a clean work queue, but every request is preserved (prompt and all). One
debate at a time. The claim-rename is also the exactly-once guard (a second claim
of the same id fails) and the crash-recovery marker.

The allowlist is **re-read for each new request**, so config edits (e.g. adding a
`repo_root`) apply to the next debate without restarting the daemon. A
malformed/half-saved edit is ignored — the last-good config stays in effect and a
warning is logged — so an in-progress edit never breaks processing.

Alongside each response the daemon streams a **live progress log** to
`responses/<id>.log` (timestamped: plan attempts, each phase's launches, each
worker's status, final status). It is created at claim time, so another agent can
`tail -f responses/<id>.log` to watch a debate in flight. The **response** is
`<id>.json` — pollers wait for that, not the `.log`.

### The request (written by debate-router, Mode 2)

The sandboxed skill emits one tiny, high-level request — no plan, no worker
prompts; the daemon produces those.

```json
{
  "schema_version": 1,
  "id": "20260531-120000-auth-debate",
  "kind": "debate_request",
  "prompt": "<the task / question / candidates to debate>",
  "repo": "/Users/you/Code/app",
  "language": "中文",
  "fast": false
}
```

| Field | Type | Validation |
| --- | --- | --- |
| `id` | string | safe slug; response/log are named `<id>.json` / `<id>.log` |
| `prompt` | string | non-empty, ≤ `max_prompt_chars` — the task to debate |
| `repo` | string | absolute; `realpath` must resolve under an allowed repo root |
| `language` | string | optional; the human's language (workers + answer use it) |
| `fast` | bool | optional; turbo mode for codex CLIs (claude/copilot exempt) plus a leaner debate |

### How the daemon runs a debate

**No agent ever spawns another agent** — only the daemon (code) spawns, and every
CLI it spawns (the planner and every worker) is **read-only**.

1. **Plan (one-shot, with retry).** The daemon spawns a **planner** CLI
   (`--planner claude|codex`, default `claude`) that loads the `debate-router`
   skill's STRATEGY and designs this debate. The daemon constrains the output with
   the CLI's **native JSON-Schema** structured output as a first line (claude
   `--output-format json --json-schema`, reading the result from the envelope's
   `structured_output`; codex `--output-schema <file> -o <file>`, reading the
   result file), then **validates** the returned plan (`src/plan.ts`) and, on
   invalid output, **retries** feeding the error back. The native schema enforces
   the SHAPE; `validatePlan` enforces what a JSON Schema can't — provider
   allowlist, unique ids, `answer_item` validity, and that every `{{id.output}}`
   references a STRICTLY earlier phase. The plan is the ONE strict-format artifact
   — and the only place retry is needed. A plan is a static DAG of phases:

   ```json
   {
     "phases": [
       { "name": "proposal_generation",
         "launches": [ { "id": "P1", "provider": "codex",  "prompt": "<worker prompt>" },
                       { "id": "P2", "provider": "claude", "prompt": "<worker prompt>" } ] },
       { "name": "arbitration",
         "launches": [ { "id": "A1", "provider": "claude",
           "prompt": "Proposals:\n{{P1.output}}\n{{P2.output}}\nDecide and write the final answer." } ] }
     ],
     "answer_item": "A1"
   }
   ```

2. **Execute (mechanical).** The daemon runs each phase's launches as read-only
   workers (capability **forced** `read_only_review` in code), in order. A later
   prompt may reference an EARLIER launch's output with `{{<id>.output}}`; the
   daemon substitutes the actual text — **no LLM runs between phases**. It branches
   only on execution **status**, never by parsing a worker's text content. The
   `answer_item` launch's output is the final answer.

When `fast` is true, **codex** launches in turbo mode (`service_tier`/`fast_mode`)
and the planner is asked for a leaner debate. **claude and copilot are exempt**
(claude's fast mode needs an API token the runner does not provide).

### Response format

`responses/<id>.json` is a `debate_result`. `answer_markdown` is the answer
worker's output (already in the caller's language/layout, since the planner wrote
that worker's prompt); `trace` is the faithful per-launch record.

```json
{
  "schema_version": 1,
  "request_id": "20260531-120000-auth-debate",
  "kind": "debate_result",
  "status": "completed",
  "status_reason": "",
  "answer_markdown": "## Decision …",
  "trace": [
    { "phase": "proposal_generation", "item": "P1", "provider": "codex",  "status": "completed" },
    { "phase": "proposal_generation", "item": "P2", "provider": "codex",  "status": "completed",
      "planned_provider": "claude" },
    { "phase": "arbitration",         "item": "A1", "provider": "claude", "status": "completed" }
  ],
  "finished_at": "2026-05-31T12:00:41Z"
}
```

A `trace` row's `provider` is the engine that actually ran. After a rate-limit
swap it carries `planned_provider` (the engine the plan assigned, when it differs)
so the swap is visible in the response, not only the live log; a non-completed row
carries `error_category` (e.g. `rate_limited` when every engine was exhausted).

`status` is `completed` when every launch completed and the answer is non-empty,
otherwise `degraded` (a failed worker substitutes as empty text; the debate still
finishes); a request that cannot be planned or validated becomes `status: error`.
The response is always written, so the sandboxed side never hangs. `debate-router`
reads `answer_markdown` and presents it (re-rendering to a caller-required format
only if the original task demanded one).

## Rate-limit fallback

A subscription can hit a usage/rate limit mid-debate. Rather than let that worker
(or the planner) fail and degrade the whole debate, the daemon re-runs the **same
task on the next available engine** — claude's task → codex, and vice versa.

The split is deliberate and preserves the runner's invariants:

- **Detection lives in the execution primitive** (`runner.ts`, `_run_one_parallel`
  in cli-launch): a failed, non-timeout child whose stderr/stdout matches a
  provider's configured signature is **labeled** `error_category: "rate_limited"`.
  That is the *only* change to `run` / `run-batch`; they still launch exactly the
  provider they were told and never rebalance.
- **The swap lives in the orchestrator** (`debate.ts` for workers, `planner.ts`
  for the plan). After a phase runs, any `rate_limited` launch is rebuilt with the
  **same substituted prompt** on the next provider in `fallback.order` (allowlisted
  and not yet tried) and re-run, bounded by the provider count. The planner rotates
  the same way across its plan attempts. The decision branches **only on
  `error_category`** — never on a worker's text — so it does not become debate
  strategy or a `provider: auto` request API. When switching engines the per-launch
  `effort` is dropped to the new provider's default (e.g. claude `max` is invalid
  for codex). If every provider for a launch is rate-limited, it degrades as before.

Tuning (allowlist, hot-reloaded per request):

- `rate_limit_patterns` — `provider -> [regex]` signatures, case-insensitive.
  Conservative built-in defaults ship for every provider; **verify them against
  your real claude/codex limit output and tune here** (no code change). An empty
  list for a provider turns detection off for it.
- `fallback` — `{ "enabled": bool, "order": [provider…] }`. `enabled: false`
  restores the prior "rate limit → degrade" behavior. `order` is the substitute
  preference (filtered to allowlisted providers; defaults to `providers`).

## Security model

1. **Static argv.** The runner builds the child command itself from a fixed
   per-provider template (`src/launch.ts`). The request contributes only
   validated, allowlisted fields plus the stdin prompt. No request value is ever
   spliced into `argv` as a flag.
2. **realpath cwd.** `repo` is resolved with `realpath` and must sit under an
   allowed repo root after resolution, defeating symlink and `..` escapes. The
   child runs with `cwd` set to that resolved path.
3. **Env allowlist.** The child environment is rebuilt from scratch: only an
   allowlist of non-secret variables (`PATH`, `HOME`, `LANG`, `TERM`, `XDG_*`,
   …) is copied. Known secret-bearing variables (`ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, `GH_TOKEN`, `AWS_*`, `SSH_AUTH_SOCK`, …) are dropped, so
   children authenticate with the **default logged-in account config**
   (`~/.claude`, `~/.codex`) rather than any injected key.
4. **Process-group isolation.** Each child runs in its own process group
   (`detached`). On timeout the group gets `SIGTERM`, then `SIGKILL` after a 10s
   grace period, so no orphan model processes survive.
5. **Schema strictness.** Wrong `schema_version` or any unknown field is a hard
   reject before launch.
6. **Audit before exit.** Every launch — including rejects — is recorded in the
   execution audit dir.

The runner is **not** a complete sandbox. Codex Rules allowing a fixed runner
path is necessary but not sufficient; this runner adds the allowlist, realpath,
schema, env hygiene, and audit layers on top of that path-based gate.

## Build

```bash
cd runners/debate-agent
npm install      # dev deps: typescript, @types/node
npm run build    # tsc -> dist/
```

The compiled output in `dist/` is what runs; it has zero runtime dependencies.

## Install (fixed path for Codex Rules)

Codex Rules match an `argv` prefix, so the privileged entry must live at a
**stable absolute path**, not inside the repo. The entry installs at
`~/.local/bin/debate-agent`.

```bash
runners/debate-agent/install.sh            # frozen snapshot install (recommended)
runners/debate-agent/install.sh --symlink  # live symlink to the repo (development)
```

Both modes build first. The default install is a **frozen snapshot**: it copies
the compiled `dist/` to `~/.local/share/debate-agent/` and writes a real
(non-symlink) Node launcher to `~/.local/bin/debate-agent` pinned to that
snapshot. Repo edits then do **not** change the privileged entry until you
re-install. The `--symlink` mode links the live repo (rebuild to pick up edits);
use it only while iterating.

Then allow only that fixed path in `~/.codex/rules/default.rules`:

```python
prefix_rule(
    pattern = ["/Users/<you>/.local/bin/debate-agent"],
    decision = "prompt",   # use "allow" only for unattended automation
    justification = "Allow only the controlled debate agent outside the parent Codex sandbox.",
)
```

See `rules/codex-rules.default.rules.example`. Verify matching with:

```bash
codex execpolicy check --pretty --rules ~/.codex/rules/default.rules -- \
  /Users/<you>/.local/bin/debate-agent run --request /abs/request.json
```

Do **not** allow `bash`, `node`, `python`, `claude`, or `codex` directly, and do
not invoke the runner through `bash -lc "..."` — that wrapper would defeat the
prefix match.

## Configuration & prerequisites

Installing the runner is **not** zero-config. To make `debate-router` route
through it, all of the following must be in place. This is the full list.

1. **Build + install** the runner (above): `install.sh` →
   `~/.local/bin/debate-agent`. Ensure `~/.local/bin` is on `PATH`.
2. **Allowlist** at `~/.config/debate-agent/allowlist.json` (or `--config` /
   `$DEBATE_AGENT_CONFIG`). JSON; loaded from `--config`, then
   `$DEBATE_AGENT_CONFIG`, then the default path. **With no `repo_roots`, every
   request is rejected** (closed by default). Copy `config/allowlist.example.json`
   and set at least `repo_roots`. Keys:

   | key | meaning | default |
   | --- | --- | --- |
   | `repo_roots` | abs dirs a request `repo` may resolve under | `[]` (closed) |
   | `modes` | allowed audit labels | `debate-proposal`, `debate-critique`, `debate-cross-review` |
   | `providers` | launchable CLIs | `claude`, `codex` |
   | `profiles` | per-provider local profiles (claude must be empty) | `{}` |
   | `capabilities` | child sandbox postures | `read_only_review` (workspace_write opt-in) |
   | `limits.max_prompt_chars` | prompt size cap | 200000 |
   | `limits.max_batch_items` | items per `run-batch` | 8 |
   | `limits.max_parallel` | global batch concurrency | 4 |
   | `limits.max_parallel_per_provider` | per-provider concurrency | 2 |
   | `rate_limit_patterns` | `provider -> [regex]` limit signatures (tune to your CLIs) | conservative built-ins per provider |
   | `fallback` | `{enabled, order}` for rate-limit engine swap | `{enabled: true, order: providers}` |

3. **Codex Rules** at `~/.codex/rules/default.rules` allowing **only** the fixed
   runner path (see Install). `decision = "prompt"` asks each time;
   `decision = "allow"` is unattended. Do not allow `bash`/`node`/`claude`/`codex`.
4. **Logged-in default accounts**: `claude` and `codex` must already be
   authenticated. The runner strips API-key env vars, so children use the default
   account config (`~/.claude`, `~/.codex`), never an injected key.
5. **Re-install after updates**: the default install is a frozen snapshot, so a
   `git pull` / edit does not take effect until you re-run `install.sh`.

### Codex `auto` — the three permission layers

Running unattended ("codex auto") means understanding three independent layers;
do not conflate them:

| Layer | Controls | For full auto |
| --- | --- | --- |
| Parent Codex `--ask-for-approval` | whether the **parent** Codex asks you | your choice |
| **Codex Rules** `prompt`/`allow` | whether the fixed runner path may run outside the parent sandbox | set to `allow` |
| Child `--ask-for-approval never` | whether the **child** CLI asks | always `never` (runner sets it) |

Once Rules are `allow` (no prompt), the runner's **allowlist is the entire
security boundary** between the parent agent and arbitrary CLI runs in
allowlisted repos. So before going `allow`: tighten `repo_roots`, and leave
`capabilities` at its read-only default — `workspace_write` is opt-in, so add it
only if you explicitly want automated children to be able to edit repos.

## How debate-router reaches this runner (file mailbox)

`debate-router` does **not** invoke this runner directly. It writes one
high-level `debate_request` to `~/.debate-router/requests/<id>.json` and watches
`~/.debate-router/responses/` until the matching `<id>.json` result appears, then
presents `answer_markdown`. The `watch` daemon — out of sandbox — does everything
in between (plan, then execute). The skill never plans or executes itself; it only
submits and presents.

If the parent session is interrupted before a response appears, `debate-router`
does not fabricate one: it reports the request id and the expected response path
and leaves the request pending for a later re-check.

## Layout

```
runners/debate-agent/
  README.md                 # this spec
  package.json  tsconfig.json
  bin/debate-agent         # Node launcher (installed to ~/.local/bin)
  src/
    version.ts              # schema version constants
    paths.ts                # expandUser / realpathLenient helpers
    allowlist.ts            # allowlist type + JSON config loading + defaults
    schema.ts               # versioned request/result schema + strict validation
    launch.ts               # static provider->argv mapping + env allowlist
    audit.ts                # execution audit writer (~/.debate-agent/<run-id>/)
    runner.ts               # validate -> build -> exec (process group) -> audit -> result; run-batch
    mailbox.ts              # file mailbox + debate_request validation
    plan.ts                 # the plan schema: parse + validate + {{id.output}} substitution
    planner.ts              # one-shot planner CLI + plan-format prompt + retry
    debate.ts               # orchestrator: plan-with-retry -> mechanical templated execution
    watch.ts                # the watch daemon (claim/run/respond, per-request reload, orphan recovery)
    cli.ts                  # run | run-batch | validate | watch | print-rules
  config/
    allowlist.example.json  # repo/mode/provider/profile/capability + batch limits
  rules/
    codex-rules.default.rules.example
  install.sh
  test/
    run_tests.sh
    helpers.ts
    schema.test.ts  allowlist.test.ts  launch.test.ts  audit.test.ts
    runner.test.ts          # in-process launch via a stub binary
    batch.test.ts           # run-batch envelope + parallel execution
    watch.test.ts           # mailbox primitives + request->response via injected workers
    watch-e2e.test.ts       # daemon batch execution with REAL worker subprocess spawns
    integration.test.ts     # real bin/ subprocess, install, signals, run-batch
  dist/                     # compiled output (gitignored)
```

## Tests

```bash
runners/debate-agent/test/run_tests.sh                # unit + integration
runners/debate-agent/test/run_tests.sh --unit         # fast unit tests only
runners/debate-agent/test/run_tests.sh --integration  # integration only
# or: npm test / npm run test:unit / npm run test:integration
```

Built on the `node:test` runner (no test-framework dependency).

**Unit tests** cover: schema version mismatch, unknown-field rejection, `run_id`
traversal + dot-segment rejection, repo-root + symlink escape rejection,
provider/mode/profile allowlist enforcement (incl. Claude-profile fail-closed),
static argv shape per provider, the env allowlist (secrets dropped, PATH kept),
audit uniqueness + root-containment, and an in-process launch via a stub binary
asserting stdin prompt transport plus execution-audit output.

**Integration tests** cross the process boundary — they invoke the real
`bin/debate-agent` the way Codex Rules will, with on-disk JSON config and a stub
CLI on PATH:

- `run` success / rejection, `validate`, and all config-resolution paths;
- **child env** dump proving no secret reaches the child;
- the **`watch` daemon end-to-end**: start the real `bin/debate-agent watch`
  subprocess against a scratch mailbox (one stub CLI serving as both planner and
  worker), drop a `debate_request`, and assert the whole flow across the process
  boundary — **planner retry** (an invalid plan first, then valid), **multi-phase
  `{{id.output}}` substitution** (phase-1 output embedded in phase-2's prompt),
  read-only argv on the spawned children, and the cleared `processing/` entry;
- **timeout + process-group kill**: a stub backgrounds a grandchild whose marker
  file never appears, proving the whole group is signalled;
- `install.sh` frozen vs `--symlink`, then invoking the installed launcher —
  including a **direct exec** (no `node` prefix) that relies on the exec bit and
  shebang;
- *(opt-in)* `codex execpolicy check` confirming the generated example Rules
  match the runner argv (`decision: prompt`) — skipped unless
  `DEBATE_AGENT_CODEX_RULES_TEST=1` and `codex` is on PATH.

All tests use a stubbed CLI binary, so none require a real `claude` / `codex`
login. `--unit` is the fast inner loop; the full run takes ~12s (the timeout
test waits out a sleep).
