---
name: agent-dispatch
description: Decide whether work should stay in the current session, use same-runtime multi-agent passes, or launch heterogeneous CLI agents. Use for debate, cross-agent review, independent candidate generation, rubric evaluation, benchmarking, or any task that may need Claude Code, Codex CLI, or other external agent CLIs. Prefer non-interactive CLI modes and default to two CLIs: Claude Code first, Codex second.
---

# Agent Dispatch

## Overview

Use `agent-dispatch` to choose where agent work runs. It is an execution
topology skill, not a reasoning method. It decides between:

- current session
- same-runtime fresh sessions or subagents
- heterogeneous CLI agents

When robust independence matters, prefer heterogeneous CLI agents over
role-played agents in the same context, unless a project check, source check, or
cheap probe can decide the task directly.

## Dispatch Rules

- Use the current session for simple, tool-bound, low-risk, or already
  checkable tasks.
- Use same-runtime multi-agent when independent candidates, critics, or scoring
  help and heterogeneity is not important.
- Use heterogeneous CLI agents when model/tool/harness diversity materially
  reduces correlated error, the user asks for cross-agent work, or the task is
  debate, adversarial review, benchmark comparison, high-risk second opinion, or
  full-stack agent evaluation.
- Default heterogeneous dispatch uses two CLIs, not more.
- Priority order is Claude Code, then Codex CLI, then other available CLIs.
- Add more than two CLIs only when the user explicitly asks.
- Do not use extra agents as a substitute for tests, source checks, schemas,
  calculators, cheap probes, or user approval.

## CLI Invocation Rules

Always use non-interactive child-agent commands.

- Claude Code: `claude -p` or `claude --print`
- Codex CLI: `codex exec`

Do not launch interactive TUI sessions for child agents.

Use read-only, plan, or no-edit modes when available. Do not let child agents
edit files unless the user explicitly requested implementation.

Use a 5 minute timeout by default for child-agent CLI calls. Retry once with a
shorter, narrower prompt if a CLI times out. Stop early only when the process is
clearly blocked on login, OAuth, browser auth, credentials, stdin, an
interactive prompt, or repeated no-output/no-progress behavior.

If a selected CLI is unavailable or blocked, record that fact. Do not silently
substitute a different CLI unless the user already asked for fallback CLIs.

Ask before invoking external CLIs when they require network access, credentials,
broad filesystem access, or other elevated permissions.

## Workflow

1. Identify whether independent agent work is actually needed.
2. Inspect available CLIs when heterogeneous dispatch is plausible.
3. Choose dispatch mode:
   - `current_session`
   - `same_runtime_multi_agent`
   - `heterogeneous_cli_agents`
4. If using heterogeneous CLI agents, select at most two CLIs by default:
   - first available Claude Code command
   - first available Codex CLI command
   - other CLIs only if needed or explicitly requested
5. Produce an `AgentDispatchPlan`.
6. Execute child agents only after permission and command constraints are clear.
7. Capture each child output as an artifact and return control to the parent
   method for evaluation, debate, or final synthesis.

## Output

Return an `AgentDispatchPlan`:

```yaml
AgentDispatchPlan:
  mode: "current_session|same_runtime_multi_agent|heterogeneous_cli_agents"
  reason: ""
  default_bias: "prefer_heterogeneous_when_independence_matters"
  selected_agents:
    - name: "claude-code"
      command: "claude -p"
      mode: "non_interactive"
      timeout_seconds: 300
      role: ""
      status: "planned|available|unavailable|blocked"
    - name: "codex-cli"
      command: "codex exec"
      mode: "non_interactive"
      timeout_seconds: 300
      role: ""
      status: "planned|available|unavailable|blocked"
  permission_needed: false
  permission_reason: ""
  max_cli_agents: 2
  fallback: ""
```

## Avoid / Escalate

- Avoid heterogeneous CLI dispatch for trivial tasks.
- Avoid heterogeneous CLI dispatch when a deterministic check can decide now.
- Avoid mixing harnesses when the experiment is meant to isolate model behavior.
- Escalate back to `work-gate` when dispatch would require credentials,
  irreversible changes, sensitive data access, or user approval.

