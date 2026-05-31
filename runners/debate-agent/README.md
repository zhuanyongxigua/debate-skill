# debate-agent

An **optional, thin execution adapter** that runs already-decided CLI launch
requests outside a parent agent sandbox, under a narrow allowlist.

It exists so that `debate-router` (and only deliberately permissioned setups)
can launch the `claude` and `codex` CLIs as debate participants from inside a
sandboxed parent agent, without granting that parent agent broad `bash`, `node`,
`python`, `claude`, or `codex` access.

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
debate-agent [--config <allowlist.json>] watch      [--brain claude|codex]
debate-agent print-rules [--path <installed-path>]
```

`run` / `run-batch` are the low-level executors. `watch` is the **mailbox
daemon** that processes whole debates — see [watch](#watch-the-debate-daemon).

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
| `fast` | bool | default `false`. When `true`, the child CLI launches in turbo mode via per-invocation flags (no global config change): codex `-c service_tier="fast" -c features.fast_mode=true`, claude `--settings '{"fastMode":true}'`. Copilot is exempt |
| `prompt` | string | non-empty, length ≤ `max_prompt_chars`; transported to the child via **stdin only** |
| `timeout_seconds` | int | a positive integer ≤ `86400` (fixed internal sanity cap, not configurable); if omitted, the phase-aware default is used |

Thinking effort is always `xhigh` (codex `model_reasoning_effort="xhigh"`, claude
`--effort xhigh`). `fast` is independent of effort.

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
| `read_only_review` (default) | `exec --sandbox read-only` (no network) | `--permission-mode default --disallowedTools "Edit Write MultiEdit NotebookEdit Bash"` | `--deny-tool=write --deny-tool=shell` | proposer / critic — reasons, cannot edit |
| `workspace_write` | `--sandbox workspace-write` + network | `--permission-mode acceptEdits` | `--allow-tool=write --add-dir <repo>` (no shell) | implementation — may edit the repo |

**Assurance differs by provider.** Codex read-only is an **OS-level** sandbox
(`--sandbox read-only`) — a kernel guarantee. Claude has no OS sandbox here, so
its read-only posture is a **harness-level deny**: `--disallowedTools` explicitly
forbids the edit/write/shell tools (deterministic, far stronger than relying on
"won't edit non-interactively", but not a kernel boundary). Copilot is similar
(tool-permission flags, no OS sandbox). Treat codex as hard-isolated and
claude/copilot as deny-listed when reasoning about blast radius.

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
`error_category` ∈ `null | rejected | timeout | missing_cli | nonzero_exit | exception`.
A `rejected` result is produced for any allowlist/schema failure and the child
is never launched.

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
`provider: auto` and never rebalances.

## watch (the debate daemon)

`watch` runs the whole debate out of the sandbox so the in-session `debate-router`
never has to spawn a CLI. It is the human's out-of-sandbox processor for the file
mailbox under `~/.debate-router/` (override with `$DEBATE_AGENT_MAILBOX`):

```
~/.debate-router/
  requests/    debate-router writes <id>.json here
  processing/  daemon claims a request by atomic rename
  responses/   daemon writes <id>.json result + <id>.log progress here
```

On start it **recovers any orphaned `processing/` entries** (a request claimed
before a previous crash/restart gets an `error` response so the caller stops
waiting), then **snapshots existing requests and ignores them** (submit after the
daemon is up). It then polls `requests/`, and for each NEW request: claims it
(atomic rename), runs the debate, and atomically writes `responses/<id>.json`.
One debate at a time.

The allowlist is **re-read for each new request**, so config edits (e.g. adding a
`repo_root`) apply to the next debate without restarting the daemon. A
malformed/half-saved edit is ignored — the last-good config stays in effect and a
warning is logged — so an in-progress edit never breaks processing.

Alongside each response the daemon streams a **live progress log** to
`responses/<id>.log` (timestamped: claim, each step's phase + worker launches,
each worker's status + audit path, final status). It is created at claim time, so
another agent can `tail -f responses/<id>.log` to watch a debate in flight. The
**response** is `<id>.json` — pollers wait for that, not the `.log`.

### How a debate runs: the read-only step loop

Crucially, **no agent ever spawns another agent** — only the daemon (code)
spawns, and every CLI it spawns is **read-only**:

1. The daemon calls the **brain** — `debate-router` in read-only plan/step mode
   (default `claude`, or `--brain codex`) — with the current debate state.
2. The brain returns the single next action as JSON: either a set of read-only
   worker launches (`{"kind":"run", phase, launches:[...]}`) or the final answer
   (`{"kind":"final", status, answer_markdown}`).
3. For a `run`, the daemon builds a request per launch with **capability forced
   to `read_only_review` in code**, validates each against the allowlist, and
   runs them via `run-batch` (read-only workers).
4. It feeds the workers' outputs back into the state and calls the brain again,
   until the brain returns `final` (or a step cap → `degraded`).

So the debate protocol stays authored in the `debate-router` skill (the brain
applies it); the daemon is a pure executor. The brain authors each worker's
prompt and allocates providers; the workers just answer. Every launch — brain
and workers — is read-only, so this is safe even with a sandbox enabled.

The debate request may carry `language` (the human's primary language — the
brain writes every worker prompt and the final answer in it) and `fast` (turbo
mode). When `fast` is true the brain runs a leaner debate **and** every CLI it
spawns — the brain and all workers — launches in turbo mode (codex
`service_tier`/`fast_mode`, claude `--settings fastMode`; copilot exempt). All via
per-invocation flags; no global config is touched.

The response is always written (brain/exec failures and the step cap become
`status: error|degraded`), so the in-session side never hangs.

### Response format (matches the debate skill)

`responses/<id>.json` carries `request_id`, `status`, `status_reason`, `steps`,
and:

- `answer_markdown` — the debate-skill **human-first layout**: the brain's
  `## Decision` / `## Rationale` / `## Dissent` / `## Open Questions` (/ optional
  `## Next Step`), followed by a runner-built `## Archive` and `## Trace`.
- `cli_participation` — the structured **ground-truth** process record (one row
  per launch: `step`, `phase`, `worker`, `provider`, `status`).

The `Trace` is built by the daemon from what it actually ran — not the brain's
recollection — so the process summary is faithful (provider per worker, per-phase
status, rejected/degraded launches included). `debate-router` presents
`answer_markdown` as-is.

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

`debate-router` does **not** invoke this runner directly. By default it writes a
request file to `~/.debate-router/requests/<id>.json` and keeps watching
`~/.debate-router/responses/` until the matching result appears. This runner is
the human's out-of-sandbox processor for that mailbox (the `watch` daemon is the
next piece to build; today the human runs `run` / `run-batch` and writes the
response).

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
    cli.ts                  # run | run-batch | validate | print-rules
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
