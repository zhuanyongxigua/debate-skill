---
name: agent-launch
description: Launch local agent CLIs with consistent non-interactive command specs, profile and environment isolation, sandbox and network intent, timeout policy, prompt transport, and redacted display commands. Use after the user or a parent method has already selected external CLI agents. Do not use to decide whether CLI agents are worth using.
---

# Agent Launch

## Overview

Use `agent-launch` when a user or parent method has already selected one or
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

`agent-launch` owns bounded CLI startup details:

- provider command shape
- non-interactive mode
- profile and environment isolation
- sandbox, network, and approval intent
- per-call timeout and wait policy
- prompt transport and redacted display commands
- blocked or unavailable CLI reporting

`agent-launch` does not own orchestration lifecycle:

- no debate turn protocol
- no judging or arbitration
- no long-running supervisor loop
- no PID tracking, resume, stop, or kill controls
- no transcript or artifact directory format beyond launch metadata
- no repeated polling strategy

Use a parent orchestrator such as `debate-router`, `cli-debate`,
`cli-delegator`, review, benchmarking, or a project-specific harness for those
responsibilities.

## Launch Rules

- Always use non-interactive child-agent commands.
- Use plan or no-edit modes by default where the provider supports them. For
  Codex, default to `workspace-write` because the narrow sandbox network knob is
  scoped to that sandbox.
- Let child agents edit files only when the user explicitly requested
  implementation.
- Default Codex launches should allow sandbox network access with
  `workspace-write` plus `-c sandbox_workspace_write.network_access=true`.
  Do not map ordinary network access to `danger-full-access`.
- Ask before launching a CLI that requires credentials, broad filesystem access,
  package installation, remote hosts, or other elevated permissions.
- Use Codex `danger-full-access` only when the user explicitly approves broad
  filesystem and network access as a separate full-access escalation.
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
claude --name <session-name> --print --permission-mode plan <prompt>
```

Supported environment policies:

- `personal`: set `CLAUDE_CONFIG_DIR=~/.claude-personal` and unset
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and
  `ANTHROPIC_MODEL`.
- `inherit`: use the caller's current Claude environment unchanged.
- `company`: inherit gateway environment variables and optionally set a
  separate `CLAUDE_CONFIG_DIR`.

Use `--permission-mode plan` for read-only thinking. Use broader permission
modes only when the user explicitly requested a coding or edit task.

### Codex CLI

Use Codex CLI in exec mode:

```shell
codex --profile azure --ask-for-approval never \
  -c 'model_reasoning_effort="xhigh"' \
  -c sandbox_workspace_write.network_access=true \
  exec --sandbox workspace-write --color never -C <cwd> <prompt>
```

Defaults:

- profile: `azure`
- reasoning effort: `xhigh`
- approval: `never`
- sandbox: `workspace-write`
- network: `needed_enabled`
- config override: `sandbox_workspace_write.network_access=true`

The default Codex launch path is network-capable while keeping the Codex sandbox
enabled:

```shell
codex --profile azure --ask-for-approval never \
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
  owner: "debate-router|cli-debate|cli-delegator|review|benchmark|other"
  selected_agents:
    - name: "codex-cli"
      provider: "codex-cli"
      role: ""
      mode: "non_interactive"
      command:
        - "codex"
        - "--profile"
        - "azure"
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
      display_command: "codex --profile azure --ask-for-approval never -c 'model_reasoning_effort=\"xhigh\"' -c sandbox_workspace_write.network_access=true exec --sandbox workspace-write --color never -C <cwd> <redacted-prompt>"
      prompt_transport: "argv|stdin|file"
      cwd: ""
      profile: "azure"
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

Use `scripts/agent_launch.py` as the shared implementation surface for CLI
startup details. It provides provider launch specs, Claude environment
isolation, Codex sandbox/network checks, redacted display commands, default
and phase-aware timeouts, and thin `run_spec` / `popen_spec` startup helpers.

Parent orchestrators such as `cli-debate` and `cli-delegator` should call this
helper for child CLI startup instead of duplicating provider command builders.
They still own debate flow, transcript shape, supervisor state, PID tracking,
resume/stop, polling, and final judging.

## Avoid / Escalate

- Do not use `agent-launch` to decide whether a CLI should be used.
- Do not use `agent-launch` as a debate, review, candidate, or judging method.
- Do not silently skip a user-selected CLI because a current-session answer
  would be cheaper.
- Use a supervisor such as `cli-delegator` for long-running observation,
  sparse polling, PID tracking, resume, stop, or kill behavior.
- Use a debate orchestrator such as `cli-debate` for multi-role argument,
  transcript management, fallback ensembles, and final judging.
