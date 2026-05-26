# Method Card: `agent-dispatch`

## Purpose

Choose the execution topology for a selected work mode: current session,
same-runtime multi-agent, or heterogeneous CLI agents. This is a sub-protocol
used by candidate analysis, debate, review, and benchmarking. It is not a
candidate method or standalone reasoning path.

## Use When

- A selected `work-gate` mode may benefit from independent agents, critics,
  judges, reviewers, or candidate generators.
- The user asks for Claude Code, Codex CLI, cross-agent debate, or heterogeneous
  review.
- `work-gate debate` or `work-gate candidate analysis` needs independent child
  agents.
- You need to decide whether CLI agents are worth the cost and permission
  boundary.

## Avoid When

- The task is simple, low risk, or directly checkable.
- No parent `work-gate` mode has been selected yet.
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
- `work-gate candidate analysis`: uses dispatch for independent candidates or
  rubric scoring.
- `work-gate debate`: uses dispatch for heterogeneous critic agents.

## Failure Modes

- Launching interactive CLI sessions.
- Using too many CLIs by default.
- Treating heterogeneous agents as a substitute for deterministic checks.
- Treating `agent-dispatch` as one of the candidates being compared.
- Routing to `agent-dispatch` as the work itself instead of attaching it to
  candidate analysis, debate, review, or benchmarking.
- Silently replacing a blocked CLI with another agent.
- Letting child agents edit files when only review was requested.
- Launching Codex CLI for a network-dependent task without checking whether the
  selected profile/config/sandbox actually permits network access.
- Killing a child agent because of a transient parent-harness parser/router
  warning before timeout, final failure, or sustained no-progress evidence.

## Evaluation

- The dispatch mode matches the task risk and independence need.
- Dispatch is attached to a parent work mode and is not scored as a candidate.
- Heterogeneous CLI use is explicit, non-interactive, and bounded.
- Default heterogeneous runs use at most Claude Code plus Codex CLI.
- Codex CLI plans record sandbox and network capability when the child task
  needs SSH, package installs, external APIs, web access, or remote docs.
- Permission boundaries and unavailable CLIs are reported.
- Transient tool-call or router warnings are not treated as child-agent failure
  when the child is still retrying, entering command execution, or producing
  useful output.

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
      sandbox: "profile_default"
      network: "not_needed"
  max_cli_agents: 2
```

## Skill Implementation

- `skills/agent-dispatch/SKILL.md`
