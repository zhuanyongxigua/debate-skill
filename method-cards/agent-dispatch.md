# Method Card: `agent-dispatch`

## Purpose

Choose the execution topology for agent work: current session, same-runtime
multi-agent, or heterogeneous CLI agents.

## Use When

- A task may benefit from independent agents, critics, judges, reviewers, or
  candidate generators.
- The user asks for Claude Code, Codex CLI, cross-agent debate, or heterogeneous
  review.
- `structured-debate` or `multi-candidate-analysis` needs independent child
  agents.
- You need to decide whether CLI agents are worth the cost and permission
  boundary.

## Avoid When

- The task is simple, low risk, or directly checkable.
- A project check, source check, test, schema, calculator, or cheap probe can
  decide the issue.
- Running external CLIs would require credentials or broad access that the user
  has not approved.

## Inputs

- User task and selected method stack
- Required independence level
- Available CLIs
- Permission, filesystem, network, and credential constraints

## Outputs

- `AgentDispatchPlan`: mode, selected agents, non-interactive commands,
  timeout, permission needs, fallback, and reason

## Composes With

- `work-gate`: chooses when dispatch is needed.
- `multi-candidate-analysis`: uses dispatch for independent candidates or
  rubric scoring.
- `structured-debate`: uses dispatch for heterogeneous critic agents.

## Failure Modes

- Launching interactive CLI sessions.
- Using too many CLIs by default.
- Treating heterogeneous agents as a substitute for deterministic checks.
- Silently replacing a blocked CLI with another agent.
- Letting child agents edit files when only review was requested.

## Evaluation

- The dispatch mode matches the task risk and independence need.
- Heterogeneous CLI use is explicit, non-interactive, and bounded.
- Default heterogeneous runs use at most Claude Code plus Codex CLI.
- Permission boundaries and unavailable CLIs are reported.

## Minimal Example

```yaml
AgentDispatchPlan:
  mode: "heterogeneous_cli_agents"
  reason: "User asked for independent Codex and Claude Code review."
  selected_agents:
    - name: "claude-code"
      command: "claude -p"
      mode: "non_interactive"
      timeout_seconds: 300
    - name: "codex-cli"
      command: "codex exec"
      mode: "non_interactive"
      timeout_seconds: 300
  max_cli_agents: 2
```

## Skill Implementation

- `skills/agent-dispatch/SKILL.md`
