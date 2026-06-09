---
name: cli-delegator
description: Explicitly delegate bounded one-shot tasks to local agent CLIs such as Codex and Claude Code through the daemon request-file mailbox, with daemon-written artifacts and status/tail inspection.
---

# CLI Delegator

Use this skill only when the user or a parent workflow explicitly selects
`cli-delegator`, asks to delegate to a local CLI agent, or asks to start,
resume, stop, kill, tail, or inspect a `cli-delegator` run. Do not invoke this
skill merely because a task is long, expensive, parallelizable, or could benefit
from another agent. In ordinary tasks, keep the work in the current session
unless delegation was explicitly requested.

If `cli-delegator` is explicitly selected, you must actually delegate by
submitting a `delegate_request` to the daemon mailbox unless a concrete blocker
prevents submission. Do not replace an explicit delegation request with a normal
in-session answer because the task seems simple, because the child might take
time, or because current-session work would be easier. If delegation cannot run,
report the blocker and the request path or condition that failed.

Delegated work can include long observation loops, sparse polling, log following
on demand, waiting for another agent/run to finish, or short scoped
coding/review tasks.

The bundled script now writes request files under `~/.cli-delegator/requests/`; the out-of-sandbox `debate-agent` daemon claims those files and launches the selected CLI. The current daemon-backed implementation supports `once` only. Background `start`, `resume`, `stop`, and `kill-agent` are reserved for the next daemon control/supervised-loop slice and must not fall back to direct CLI spawning.

Codex remains the script default for generic non-code daemon requests. For code-related delegated work -- implementation, code review, debugging, test writing, refactoring, repo investigation, or any coding task that can reasonably be outsourced -- submit the request with `--backend claude` so it uses Claude Code normal default account. Do not use Claude Personal, `claude-personal`, personal config directories, or Claude Personal background sessions for `cli-delegator`; those are separate workflows and must not be selected here.

## Parent Session Default: Do Not Track

By default, the parent conversation should only launch the delegated run, report the `run_id` and artifact directory, and then stop watching. Do not tail `current.log`, repeatedly poll status, or wait on the child just because the child is running.

Only inspect the delegated run from the parent conversation when one of these is true:

- The user explicitly asks for status, logs, progress, or a final result.
- The task is short and the user clearly expects the current turn to include the completed outcome.
- Safety requires intervention, such as a runaway child, destructive command drift, or a real failure signal.

If the user asks to delegate open-ended background work, report that daemon-backed supervised loops are not implemented yet. Use `once` only for bounded tasks that should finish in the current turn.

## Observation Cadence

Delegation is useful because the child CLI owns the detailed work and writes artifacts. For the current daemon-backed `once` path, wait for the response unless the user explicitly only wants the request submitted.

Use one of these observation modes:

- Normal once run: submit the request, wait for `responses/<run-id>.json`, and present the daemon result.
- Status/tail: inspect daemon-written artifacts only when the user asks.
- Background loop: currently blocked until daemon-side supervised_loop/control is implemented.

If the parent agent watches a delegated run so closely that it is effectively doing the work itself, stop and switch back to no active observation or a much lower polling cadence.

## Parallel Work On One Repo

When delegating multiple CLI agents to work on the same project at the same time,
the parent prompt must strongly constrain each child to its assigned module,
directory, feature area, or file set. Do not submit broad overlapping prompts
such as "implement this feature in the repo" to several writers against the same
checkout.

Do not delegate to too many CLI agents at once. Prefer one or two delegated
agents for ordinary parallel work; use three only when the work naturally splits
into clearly independent modules. More than three concurrent writers is usually
not worth the coordination cost and sharply increases conflict risk.

For parallel development, each `--task` must include:

- The exact module/directory/file ownership for this delegated agent.
- A clear instruction not to edit outside that owned area unless it first reports
  a blocker or asks the parent to coordinate.
- Any shared interfaces or cross-module assumptions it may read but must not
  modify.
- The expected handoff artifact, such as a patch summary, test result, or list of
  required follow-up changes in other modules.

This is especially important for `workspace_write` requests. Parallel delegated
writers that touch unrelated modules can coexist; parallel delegated writers that
can freely edit the whole project will race each other and create merge or
working-tree conflicts.

## Quick Start

```shell
python3 ~/.agents/skills/cli-delegator/scripts/cli_delegate.py once \
  --cwd "$PWD" \
  --skill use-devboard-project-agent \
  --task "Inspect the current run logs and report the final conclusion." \
  --run-id delegate-example \
  --timeout-minutes 20
```

This submits `~/.cli-delegator/requests/delegate-example.json` and waits for `~/.cli-delegator/responses/delegate-example.json`. For quick scoped tasks, return the daemon result in the current turn. Background observation loops are not daemon-backed yet.

Defaults:
- script default backend: `codex` for generic non-code requests
- code-related delegated backend: pass `--backend claude` (Claude Code normal default account, not Claude Personal)
- Codex profile: `azure` when backend is `codex`
- once timeout: 30 minutes unless `--timeout-minutes` is set
- launch policy: daemon static runner templates, aligned with `cli-launch`
- artifacts: `~/.cli-delegator/<run-id>/`

`--timeout-minutes` (or legacy `--max-minutes`) writes `timeout_minutes` into the `delegate_request` file and caps that daemon `once` request. If omitted, cli-delegator writes 30 minutes. The daemon allowlist must enable `delegate.enabled=true`, and the requested timeout cannot exceed `delegate.max_minutes` there. Codex profile/capability choices must also be allowlisted.

## Timeout Policy

Before submitting a `once` request, choose the timeout deliberately.

Use the 30 minute default for small reviews, quick investigations, and narrow
single-step coding tasks. Add `--timeout-minutes <minutes>` when the delegated
task may reasonably exceed 30 minutes, such as a large code review, broad repo
investigation, long test/debug loop, remote log inspection, or any user request
that explicitly asks the child agent to keep working for longer.

If the task looks long-running and the user did not specify a timeout, set a
reasonable explicit value instead of relying on the default, and mention it in
the parent response. The daemon still enforces its allowlist caps:
`delegate.max_minutes` for all delegate requests, and the usually smaller
`delegate.max_workspace_write_minutes` for `workspace_write` and `remote_ops`.
If the requested timeout exceeds those caps, report the allowlist blocker rather
than silently lowering the user's requested duration.

Compatibility: the old path `~/.agents/skills/azure-codex-observer/scripts/codex_observe.py` is kept as a symlink for existing automations.
If you need to inspect or resume an older run created before this default changed, pass `--state-dir <cwd>/.codex-observe`.

## Network Or SSH Tasks

Network and sandbox launch checks are enforced by the daemon allowlist and static runner launch templates. Daemon-backed `once` defaults to `read_only_review`; request `--capability workspace_write` only when the daemon allowlist permits it and the task genuinely needs writes or Codex sandbox network access:

```shell
python3 ~/.agents/skills/cli-delegator/scripts/cli_delegate.py once \
  --capability workspace_write \
  --cwd "$PWD" \
  --skill use-devboard-project-agent \
  --task "SSH to ubuntu@10.2.100.230 and inspect the remote run logs with read-only commands."
```

Do not represent `--allow-network` as danger-full-access consent. In daemon mailbox mode, broad network/write posture is controlled by `--capability workspace_write` plus the daemon allowlist, not by arbitrary CLI flags from this skill.

Codex may print a transient router warning like `failed to parse function arguments: unknown variant `` ... use_default ...` before a later `command_execution` succeeds. Do not stop the child solely because of that warning. Treat it as fatal only if the child exits, the run times out, or no `command_execution` / final status appears by the configured timeout.

Do not escalate this specific warning into a separate debate/review skill by default. The normal response is to keep observing the delegated child until it either produces a real tool result, finishes, or reaches the configured timeout. Use another skill only when the child has actually failed or the user asks for a design/review discussion.

## Claude Backend

Use `--backend claude` for code-related delegated tasks whenever they can be outsourced. This uses Claude Code normal default account, not Claude Personal:

```shell
python3 ~/.agents/skills/cli-delegator/scripts/cli_delegate.py once \
  --backend claude \
  --cwd "$PWD" \
  --skill use-devboard-project-agent \
  --timeout-minutes 20 \
  --task "Review the current patch and report findings, risks, and verification suggestions."
```

The Claude backend is submitted as a daemon request and inherits Claude Code normal default configuration from the daemon environment. `--claude-config-dir`, `--claude-profile`, and `--claude-permission-mode` are accepted only for legacy CLI compatibility and are not part of the current daemon request schema; do not use them to point at Claude Personal. Prefer Claude default account for code review, debugging, implementation, test work, refactoring, and repo investigation. For write tasks, request `--capability workspace_write` only when the daemon allowlist permits it; otherwise delegate a read-only review/plan or report the write-capability blocker.

## Commands

```shell
python3 ~/.agents/skills/cli-delegator/scripts/cli_delegate.py status --run-id delegate-example
python3 ~/.agents/skills/cli-delegator/scripts/cli_delegate.py tail --run-id delegate-example --file observations --follow
python3 ~/.agents/skills/cli-delegator/scripts/cli_delegate.py tail --run-id delegate-example --file current --follow
```

`start`, `resume`, `stop`, and `kill-agent` currently report that daemon-side supervised-loop/control is not implemented. Do not use a legacy direct supervisor as a workaround.

## Artifact Layout

```text
~/.cli-delegator/<run-id>/
  config.json
  state.json
  observations.md
  current.log
```

`observations.md` and `current.log` contain the daemon worker answer for the `once` request. The canonical response is `~/.cli-delegator/responses/<run-id>.json`.

## Skill Selection

Pass `--skill <name-or-path>` as a prompt-only `skill_hint` for the delegated agent. The script does not hardcode DevBoard or any other project skill. The hint never becomes argv. If the skill cannot be found, the child must say so in the run output.

## Safety

- The script must not spawn Codex, Claude, shell, or any supervisor directly. It writes `delegate_request` files and waits for daemon responses.
- The request schema rejects arbitrary `argv`, `env`, shell strings, and request-controlled PIDs.
- Default daemon capability is `read_only_review`. Use `--capability workspace_write` only when the daemon allowlist permits it and the user actually wants write/network posture.
- For Claude, daemon launches inherit Claude Code default configuration unless the runner service has private provider env configured.
- The delegator may cause the selected backend to read files or logs from `--cwd`; only use it when that data-sharing boundary is acceptable.
- The canonical result is the daemon response JSON; compatibility artifacts are copied under `~/.cli-delegator/<run-id>/`.
