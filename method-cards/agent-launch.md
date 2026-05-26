# Method Card: `agent-launch`

## Purpose

Prepare or run bounded non-interactive launches for selected local agent CLIs.
It centralizes empirical launch defaults such as profile isolation, sandbox and
network intent, timeout policy, prompt transport, and redacted command logging.

This is a launch helper, not a method-selection or topology-decision helper.
The user, `work-gate`, `cli-debate`, `cli-delegator`, review, benchmarking, or
another parent method decides which CLI agents should run.

## Use When

- The user explicitly asks for Claude Code, Codex CLI, Copilot CLI, or another
  local agent CLI.
- A parent method has already selected `single_external_cli_agent` or
  `heterogeneous_cli_agents`.
- An explicit CLI request must be preserved rather than down-routed to the
  current session because a cheaper check seems available.
- A debate, review, benchmark, or delegated task needs a consistent child CLI
  command spec.
- You need shared defaults for profile, environment, sandbox, network, timeout,
  stop policy, prompt transport, or command redaction.

## Avoid When

- The question is whether CLI agents should be used at all.
- The work needs debate turns, judging, transcript management, supervision,
  PID tracking, resume/stop, or long-running polling.
- A deterministic project check, source check, or local tool result is the work
  itself rather than a child agent launch.
- The selected CLI needs credentials, broad filesystem access, full sandbox
  bypass, or elevated permissions that have not been approved.

## Inputs

- Selected CLI agent names or providers
- Caller or user launch intent
- Prompt, cwd, role, and expected prompt transport
- Filesystem, network, sandbox, approval, and credential constraints
- Optional timeout or stop-policy override

## Outputs

- `AgentLaunchPlan`: selected agents, provider command specs, redacted display
  commands, profile/env policy, sandbox/network intent, timeout, status,
  permission needs, and fallback permission.

## Composes With

- `work-gate`: selects the method stack and execution topology. When the
  topology is `single_external_cli_agent` or `heterogeneous_cli_agents`, use
  `agent-launch` for the concrete CLI startup details.
- `work-gate debate`: owns debate protocol and frozen candidates; uses
  `agent-launch` only to start external CLI critic agents when selected.
- `cli-debate`: owns role choreography, transcript, fallback ensembles, and
  judging; can reuse `agent-launch` defaults for provider startup.
- `cli-delegator`: owns supervisor lifecycle, logs, PID tracking, resume, stop,
  and kill controls; can reuse `agent-launch` defaults for child process specs.

## Failure Modes

- Letting `agent-launch` decide whether to use CLI agents.
- Silently replacing or skipping a selected CLI because another path is cheaper.
- Down-routing an explicit CLI request to the current session instead of
  reporting the selected CLI as blocked or unavailable.
- Launching interactive CLI sessions for child agents.
- Letting child agents edit files when only review or planning was requested.
- Treating ordinary Codex sandbox network access as `danger-full-access`.
- Using Codex `danger-full-access` without a separate full-access approval from
  the user.
- Treating a transient parent-harness parser/router warning as child failure
  before timeout, final failure, interactive block, or sustained no progress.
- Absorbing supervisor, debate, transcript, PID, resume, stop, or judging
  responsibilities from the parent orchestrator.

## Evaluation

- A user-selected or parent-selected CLI is preserved unless blocked or
  unavailable.
- The launch is non-interactive and bounded.
- Profile and environment policy are explicit.
- Sandbox, network, approval, and timeout are explicit.
- Prompts and secrets are redacted from display commands and logs.
- Blocked or unavailable CLIs are reported instead of silently substituted.
- Lifecycle ownership remains with the parent orchestrator.

## Minimal Example

```yaml
AgentLaunchPlan:
  launch_intent: "user_requested"
  owner: "work-gate debate"
  selected_agents:
    - name: "claude-code"
      provider: "claude-code"
      role: "critic"
      mode: "non_interactive"
      command: ["claude", "--name", "risk-review-critic", "--print", "--permission-mode", "plan"]
      display_command: "claude --name risk-review-critic --print --permission-mode plan <redacted-prompt>"
      prompt_transport: "argv"
      env_policy: "claude_personal"
      launch:
        sandbox: "profile_default"
        network: "not_needed"
        approval: "profile_default"
        timeout_seconds: 900
        stop_policy: "final|timeout|blocked_interactive|long_no_progress"
      status: "planned"
    - name: "codex-cli"
      provider: "codex-cli"
      role: "implementation-reviewer"
      mode: "non_interactive"
      command: ["codex", "--profile", "azure", "--ask-for-approval", "never", "-c", "model_reasoning_effort=\"xhigh\"", "-c", "sandbox_workspace_write.network_access=true", "exec", "--sandbox", "workspace-write", "--color", "never", "-C", "<cwd>"]
      display_command: "codex --profile azure --ask-for-approval never -c 'model_reasoning_effort=\"xhigh\"' -c sandbox_workspace_write.network_access=true exec --sandbox workspace-write --color never -C <cwd> <redacted-prompt>"
      prompt_transport: "argv"
      profile: "azure"
      launch:
        sandbox: "workspace-write"
        network: "needed_enabled"
        approval: "never"
        timeout_seconds: 900
        stop_policy: "final|timeout|blocked_interactive|long_no_progress"
      status: "planned"
  permission_needed: false
  fallback_allowed: false
```

## Skill Implementation

- `skills/agent-launch/SKILL.md`
