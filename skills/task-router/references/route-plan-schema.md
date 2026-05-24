# RoutePlan Schema

Use this structure when the user asks how a task should be handled, or when several method skills may apply.

```yaml
route_plan:
  task_fingerprint:
    task_type: ""
    artifact_type: ""
    needs_current_info: false
    needs_external_evidence: false
    has_hard_verifier: false
    requires_codebase_context: false
    requires_tool_use: false
    needs_multi_agent: false
    needs_heterogeneous_agents: false
    risk_level: "low|medium|high"
    ambiguity_level: "low|medium|high"
    budget_preference: "cheap|balanced|robust"
  selected_stack:
    - skill_or_method: ""
      purpose: ""
      expected_artifact: ""
      selection_reason: ""
      user_requested: false
      requested_skill_handling: "used|unavailable|unsafe|irrelevant|fallback"
  why_this_stack:
    - ""
  skipped_skills:
    - skill: ""
      reason: ""
  debate:
    use: false
    condition: ""
    max_rounds: 1
  execution_topology:
    mode: "single_agent|same_runtime_multi_agent|heterogeneous_cli_agents"
    reason: ""
    agents:
      - role: ""
        runtime: "current_session|same_runtime|external_cli"
        model_or_cli: ""
        purpose: ""
    permission_needed: false
    permission_reason: ""
    cli_discovery:
      needed: false
      approach: ""
  escalation_conditions:
    - ""
  expected_artifacts:
    - ""
  immediate_next_action: ""
```

## Selection Rules

If a task is simple and one method is obviously sufficient, output a short RoutePlan and continue.

If candidate stacks score within 2 points on the rubric, prefer the stack that:

1. Gathers missing evidence first.
2. Uses available validators.
3. Minimizes irreversible action.
4. Produces structured artifacts.
5. Has a clear fallback.

Use voting only to decide which cheap exploration to try first when evidence is unavailable.

## Explicit Skill Requests

When the user explicitly names, links, tags, or invokes a skill, include it in
`selected_stack` unless it is unavailable, irrelevant, or unsafe. Set
`user_requested: true` and explain how that skill shaped the route in
`selection_reason`.

If the requested skill cannot be used directly, keep it visible in the
RoutePlan, set `requested_skill_handling` to the reason, and name the closest
safe fallback.

## Execution Topology Rules

Choose execution topology after selecting the method stack.

Use `single_agent` when the task is simple, tool-bound, or has a strong verifier.

Use `same_runtime_multi_agent` when independent generation or judging is useful
but the task does not require different model families, different tools, or
external CLIs. This covers most candidate generation, judging, critique, and
path exploration. In agent environments that support sub-agents in the current
session, use that before reaching for external CLIs.

Use `heterogeneous_cli_agents` only when model or tool diversity is part of the
requirement: adversarial review across systems, benchmark comparison, high-risk
review, or explicit user request for different agents such as Codex and Claude
Code. Inspect available CLIs first. Ask the user before running external CLI
commands when they require network access, credentials, broader filesystem
access, or other elevated permissions.
