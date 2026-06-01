---
name: cli-launch
description: Launch local agent CLIs with consistent non-interactive command specs, profile and environment isolation, sandbox and network intent, timeout policy, prompt transport, and redacted display commands. Use after the user or a parent method has already selected external CLI agents. Do not use to decide whether CLI agents are worth using.
---

# CLI Launch

## Overview

Use `cli-launch` when a user or parent method has already selected one or
more external agent CLIs such as Claude Code, Codex CLI, GitHub Copilot CLI, or
another local CLI agent.

This skill answers: "How should the selected CLI be launched?"

It does not answer:

- whether the work should stay in the current session
- whether same-runtime agents would be cheaper
- whether a debate, review, or multi-proposal exploration is useful
- how child outputs should be judged or merged

Do not down-route an explicit CLI request to the current session because the
task seems simple, checkable, or expensive. If the selected CLI cannot be
launched safely, record it as `blocked` or `unavailable` instead.

## Responsibilities

`cli-launch` owns bounded CLI startup details:

- provider command shape
- non-interactive mode
- profile and environment isolation
- sandbox, network, and approval intent
- per-call timeout and wait policy
- prompt transport and redacted display commands
- blocked or unavailable CLI reporting

`cli-launch` does not own orchestration lifecycle:

- no debate turn protocol
- no judging or arbitration
- no long-running supervisor loop
- no PID tracking, resume, stop, or kill controls
- no transcript or artifact directory format beyond launch metadata
- no repeated polling strategy

Use a parent orchestrator such as `debate-router`, review, benchmarking, or a
project-specific harness for those responsibilities.

## Launch Rules

- Always use non-interactive child-agent commands.
- Use non-interactive, non-editing launches by default. For Claude Code, use
  `--permission-mode default` for delegated text, review, debate, and critique
  tasks; `plan` is a planning mode and may return a plan or no final answer in
  `--print` mode. For Codex, default to `workspace-write` because the narrow
  sandbox network knob is scoped to that sandbox.
- Let child agents edit files only when the user explicitly requested
  implementation.
- Default Codex launches should allow sandbox network access with
  `workspace-write` plus `-c sandbox_workspace_write.network_access=true`.
  Do not map ordinary network access to `danger-full-access`.
- Ask before launching a CLI that requires credentials, broad filesystem access,
  package installation, remote hosts, or other elevated permissions.
- Use Codex `danger-full-access` only when the user explicitly approves broad
  filesystem and network access as a separate full-access escalation.
- Apply human-specified CLI options only as explicit structured overrides, such
  as Codex `profile`, `model`, `reasoning effort`, `sandbox`, `network`,
  `approval`, timeout, or prompt transport. Do not pass arbitrary free-form CLI
  arguments through to child CLIs merely because they appeared in user text.
- Use the caller's current Claude Code login/config by default. Switch
  `CLAUDE_CONFIG_DIR` or Claude environment profiles only when the human or
  parent orchestrator explicitly selects that config directory or profile. The
  override name is `CLAUDE_CONFIG_DIR`; do not invent `CLAUDE_CONFIG`.
- If a selected CLI is missing, unauthenticated, blocked on login, or unsafe for
  the requested capability, record that status. Do not silently replace it with
  another CLI unless fallback was already approved.
- Do not treat transient parent-harness parser/router warnings as child-agent
  failure when the child later retries, enters command execution, or produces
  useful output.

## Timeout And Stop Policy

Use `timeout_seconds: 900` by default for ordinary model CLI calls. Use
`timeout_seconds: 1800` for `proposal_generation`, because proposer agents
often need to inspect context before producing an independent proposal. Parent
orchestrators may override this for best-effort passes or long delegated runs.

Phase-aware defaults:

| Phase | Default timeout |
| --- | ---: |
| `proposal_generation` | 1800 seconds |
| `debate_execution` / critique / cross-review | 900 seconds |
| ordinary single CLI call | 900 seconds |
| explicitly long delegated run | caller-selected; record the value |

Do not decide a child CLI is stuck because one poll has no output or because 1-2
minutes have passed. Stop early only when the process is clearly blocked on:

- login, OAuth, browser auth, credentials, or stdin
- an interactive prompt in a non-interactive launch
- a permission or sandbox requirement that cannot be satisfied
- sustained no-output or no-progress behavior up to the configured timeout

If a child is stopped before the configured timeout for a practical reason,
record the actual wait time, the configured timeout, the early stop reason, and
which outputs were available. Do not report `failed/no_output` for a process
that merely had quiet periods before the configured timeout.

## Provider Defaults

### Claude Code

Use Claude Code in print mode:

```shell
claude --print --permission-mode default <prompt>
```

Do not pass `--name` by default for short delegated non-interactive calls.
Use `--name <session-name>` or `--resume <session-id>` only when the human or
parent orchestrator explicitly requests a named or resumed Claude session.

Supported environment policies:

- `inherit` (default): use the caller's current Claude Code login and
  environment unchanged.
- `inherit` plus explicit `config_dir`: set `CLAUDE_CONFIG_DIR=<path>` while
  otherwise inheriting the caller's environment.
- `personal`: set `CLAUDE_CONFIG_DIR=~/.claude-personal` and unset
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and
  `ANTHROPIC_MODEL`.
- `company`: inherit gateway environment variables and optionally set a
  separate `CLAUDE_CONFIG_DIR`.

Use `--permission-mode default` for normal read-only reasoning, review, debate,
and critique. Use `plan` only when the human or parent orchestrator explicitly
wants Claude's plan-mode behavior. Use broader permission modes only when the
user explicitly requested a coding or edit task.

If the human explicitly selects a Claude config directory, pass it as a
structured environment override rather than changing the default:

```yaml
profile: "inherit"
config_dir: "~/.claude-work"
env:
  CLAUDE_CONFIG_DIR: "~/.claude-work"
```

### Codex CLI

Use Codex CLI in exec mode:

```shell
codex --ask-for-approval never \
  -c 'model_reasoning_effort="xhigh"' \
  -c sandbox_workspace_write.network_access=true \
  exec --sandbox workspace-write --color never -C <cwd> <prompt>
```

Defaults:

- profile: default Codex profile; pass `--profile <name>` only when the caller
  explicitly selects a local profile
- reasoning effort: `xhigh`
- approval: `never`
- sandbox: `workspace-write`
- network: `needed_enabled`
- config override: `sandbox_workspace_write.network_access=true`

If the human explicitly selects a local Codex profile, pass it as a structured
override:

```shell
codex --profile <name> --ask-for-approval never \
  -c 'model_reasoning_effort="xhigh"' \
  -c sandbox_workspace_write.network_access=true \
  exec --sandbox workspace-write --color never -C <cwd> <prompt>
```

The default Codex launch path is network-capable while keeping the Codex sandbox
enabled:

```shell
codex --ask-for-approval never \
  -c 'model_reasoning_effort="xhigh"' \
  -c sandbox_workspace_write.network_access=true \
  exec --sandbox workspace-write --color never -C <cwd> <prompt>
```

Use `read-only` plus `network: not_needed` only when the parent explicitly wants
a no-network Codex launch.

`danger-full-access` is not the default network path. Use it only after the user
has explicitly approved full filesystem and network access, and record that
approval in the parent orchestrator.

### GitHub Copilot CLI

Use Copilot in plan/no-ask mode by default:

```shell
copilot --no-color --silent --mode=plan --no-ask-user --prompt=<prompt>
```

Do not pass broad tool permissions such as allow-all-tools unless the user
explicitly asked for Copilot to execute tools.

## Output

Return an `AgentLaunchPlan`:

```yaml
AgentLaunchPlan:
  launch_intent: "user_requested|parent_selected|fallback_selected"
  owner: "debate-router|review|benchmark|other"
  selected_agents:
    - name: "codex-cli"
      provider: "codex-cli"
      role: ""
      mode: "non_interactive"
      command:
        - "codex"
        - "--ask-for-approval"
        - "never"
        - "-c"
        - "model_reasoning_effort=\"xhigh\""
        - "-c"
        - "sandbox_workspace_write.network_access=true"
        - "exec"
        - "--sandbox"
        - "workspace-write"
        - "--color"
        - "never"
        - "-C"
        - "<cwd>"
      display_command: "codex --ask-for-approval never -c 'model_reasoning_effort=\"xhigh\"' -c sandbox_workspace_write.network_access=true exec --sandbox workspace-write --color never -C <cwd> <redacted-prompt>"
      prompt_transport: "argv|stdin|file"
      cwd: ""
      profile: null # set only when the human explicitly selects a local profile
      human_overrides:
        claude_config_dir: null
        claude_profile: null
        claude_permission_mode: null
        profile: null
        model: null
        reasoning_effort: null
        sandbox: null
        network: null
        approval: null
        timeout_seconds: null
        prompt_transport: null
        rejected_freeform_args: []
      env_policy: "none|inherit|claude_personal|claude_company"
      launch:
        sandbox: "workspace-write|read-only|danger-full-access|profile_default|unknown"
        network: "not_needed|needed_enabled|needed_blocked|unknown"
        approval: "never|on-request|profile_default|unknown"
        phase: "proposal_generation|debate_execution|critique|cross_review|arbitration|other"
        timeout_seconds: 900 # use 1800 for proposal_generation unless overridden
        stop_policy: "final|timeout|blocked_interactive|long_no_progress"
        early_stop_wait_seconds: null
        early_stop_reason: ""
      status: "planned|available|launched|unavailable|blocked"
      blocked_reason: ""
  permission_needed: false
  permission_reason: ""
  fallback_allowed: false
  fallback: ""
```

Prefer list-form `command` internally. Use `display_command` only for logs or
human-readable artifacts, with prompts and secrets redacted.

## Shared Helper

Use `scripts/cli_launch.py` as the shared implementation surface for CLI
startup details. It provides provider launch specs, Claude environment
isolation, Codex sandbox/network checks, redacted display commands, default
and phase-aware timeouts, and thin `run_spec` / `popen_spec` startup helpers.

Parent orchestrators such as `debate-router` should call this helper for child
CLI startup instead of duplicating provider command builders. They still own
debate flow, transcript shape, supervisor state, PID tracking, resume/stop,
polling, and final judging.

### Parallel fan-out

For phases where multiple selected CLIs run independently (e.g. several
proposer agents for `proposal_generation`, or several critics for the first
independent critique round), use `run_specs_parallel`:

```python
from cli_launch import ParallelSpec, run_specs_parallel

specs = [
    ParallelSpec(spec=codex_spec, caller_metadata={"role": "proposer", "id": "P1"}),
    ParallelSpec(spec=claude_spec, caller_metadata={"role": "proposer", "id": "P2"}),
    ParallelSpec(spec=copilot_spec, caller_metadata={"role": "proposer", "id": "P3"}),
]
results = run_specs_parallel(specs, max_parallel=3)
```

Contract:

- Results are returned in the same order as the input specs (not completion
  order), so callers can correlate by index.
- `caller_metadata` is opaque to `cli-launch`: it is returned unchanged on
  the matching `ParallelResult`. Use it to attach debate-level identifiers
  (phase, role, candidate id) without leaking those into this skill's schema.
- Each child runs in its own process group. On per-spec timeout the group
  receives `SIGTERM`, then `SIGKILL` after a 10-second grace period.
- `max_parallel` is a mechanical concurrency cap only. `run_specs_parallel`
  itself does no retry, queue policy, or partial-failure judgment — those belong
  to the caller (typically `debate-router`). It can optionally **label** a
  rate-limited failure (see below), but never acts on it.
- Per-spec `timeout_override` overrides `LaunchSpec.timeout_seconds`. The
  caller is responsible for picking phase-appropriate values; defaults remain
  the phase-aware values from `timeout_seconds_for_phase`.

`ParallelResult` carries: `status` (`completed` | `timed_out` | `error`),
`returncode`, `error_category` (`null` | `timeout` | `missing_cli` |
`nonzero_exit` | `rate_limited` | `exception`), `stdout`, `stderr`,
`elapsed_seconds`, `timeout_seconds`, `timed_out`, `display_command`, and
`caller_metadata`.

#### Rate-limit fallback (same task, swap engine)

A subscription can hit a usage/rate limit mid-run. Detection and the engine swap
are split so the mechanical primitive stays mechanical:

- Pass `rate_limit_patterns` (default `DEFAULT_RATE_LIMIT_PATTERNS`, a
  per-provider `{provider: [compiled regex]}` map) to either function. A failed
  (non-zero) child whose stderr/stdout matches its provider's signature is
  **labeled** `error_category="rate_limited"`. `run_specs_parallel` only labels;
  it still does not retry. The defaults are conservative — verify them against
  your real CLI limit output and override as needed (empty list = detection off).
- `run_specs_parallel_with_fallback(specs, *, max_parallel=None,
  rate_limit_patterns=DEFAULT_RATE_LIMIT_PATTERNS)` adds the swap: for any slot
  that comes back `rate_limited`, it re-runs that slot on the next pre-built
  alternate in `ParallelSpec.fallbacks` (same task, different engine), in order,
  until none is rate-limited or the fallbacks run out. Results stay in input
  order. It branches only on `error_category`, never on a child's text.

You build the alternates (you hold the prompt; this skill never reaches into a
built spec to change its provider). Build a codex-engine `LaunchSpec` for the same
task and attach it:

```python
ParallelSpec(spec=claude_spec, fallbacks=(ParallelSpec(spec=codex_same_task),))
```

A slot whose fallbacks are all exhausted keeps its `rate_limited` result for the
caller to degrade.

Use this helper only for phases that are genuinely independent. Sequential
stages such as proposal normalization, cross-review (which reads complete
critic findings), arbitration, and final rendering must remain serial in the
caller — they are not safe to fan out.

## Avoid / Escalate

- Do not use `cli-launch` to decide whether a CLI should be used.
- Do not use `cli-launch` as a debate, review, candidate, or judging method.
- Do not silently skip a user-selected CLI because a current-session answer
  would be cheaper.
- Use an external supervisor for long-running observation, sparse polling, PID
  tracking, resume, stop, or kill behavior.
- Use a debate orchestrator such as `debate-router` for multi-role argument,
  transcript management, fallback ensembles, and final judging. `debate-router`
  may compose this skill's `run_specs_parallel` for independent fan-out phases.
