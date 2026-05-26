# RoutePlan Schema

Use this structure when `work-gate` is invoked, when the user asks how a task
should be handled, or when several methods or modes may apply.

## Short RoutePlan

Use this by default. Keep it under 7 lines unless the user asks for detail or
the route is being audited. When `work-gate` is explicitly invoked, the first
visible block must be `RoutePlan:`.

```yaml
RoutePlan:
  stack: []
  why: ""
  skipped: []
  topology: "single_agent|same_runtime_multi_agent|heterogeneous_cli_agents"
  next: ""
```

Direct answering and direct local tool execution are valid only when `stack`
includes `work-gate direct`. Direct is one mode; its `DirectResult.kind` should
be `answer` or `local_action`.
Final answer compression is valid as `work-gate final answer`; it is a
work-gate output mode, not a separate skill.
Candidate analysis is valid as `work-gate candidate analysis`; it is a
work-gate mode, not a separate installable skill.
Debate is valid as `work-gate debate`; it is a work-gate mode, not a separate
installable skill.

The short RoutePlan passes only when:

- `stack` is non-empty.
- `why` ties the stack to concrete task signals.
- `skipped` names relevant but unselected methods.
- `topology` names the execution topology.
- `next` names the next expected artifact or action.

## Full RoutePlan

```yaml
RoutePlan:
  task_fingerprint:
    task_type: ""
    artifact_type: ""
    needs_current_info: false
    needs_external_evidence: false
    has_project_check: false
    requires_codebase_context: false
    requires_tool_use: false
    needs_agent_dispatch: false
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
    entry_case: "none|requirement_debate|single_proposal_debate|candidate_debate|judgment_debate"
    style: "none|parallel_positions|proposal_attack|frozen_candidates"
    condition: ""
    max_rounds: 1
  execution_topology:
    mode: "single_agent|same_runtime_multi_agent|heterogeneous_cli_agents"
    dispatch_method: "none|agent-dispatch"
    dispatch_role: "none|topology_helper_for_selected_method"
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

If a task is simple and one method is obviously sufficient, output a short
RoutePlan and continue.

If the task is trivial and low risk, choose `work-gate direct` for simple
answers or simple local tool work. Do not bypass routing by answering or acting
directly without naming the direct mode when routing is required.

Use `work-gate direct` sparingly. It is appropriate only for simple,
self-contained, low-risk tasks. Current, ambiguous, project-dependent,
multi-step, or high-risk tasks should route to a non-direct stack.

If `work-gate` is explicitly invoked, strict mode is mandatory. Do not skip the
RoutePlan by judging the task trivial; use `work-gate direct` inside the
RoutePlan instead.

If candidate stacks score within 2 points on the rubric, prefer the stack that:

1. Gathers missing evidence first.
2. Uses available project checks or source checks.
3. Minimizes irreversible action.
4. Produces structured artifacts.
5. Has a clear fallback.

Use candidate comparison only to decide which cheap exploration to try first
when evidence is unavailable.

Use `work-gate final answer` after execution when prior method work is long,
multi-candidate, debate/review-heavy, or likely to produce a noisy final answer.
It should compress the result without hiding missing evidence, failed checks, or
unresolved conflict.

## Execution Consistency

After a RoutePlan passes, execute only the selected stack. Each selected method
must produce or update its primary artifact. If that becomes impossible or
unnecessary, emit a revised RoutePlan before switching methods.

## Explicit Skill Requests

When the user explicitly names, links, tags, or invokes a skill or method mode,
include it in `selected_stack` unless it is unavailable, irrelevant, or unsafe. Set
`user_requested: true` and explain how that request shaped the route in
`selection_reason`.

If the requested skill cannot be used directly, keep it visible in the
RoutePlan, set `requested_skill_handling` to the reason, and name the closest
safe fallback.

## Execution Topology Rules

Choose execution topology after selecting the method stack.

Use `single_agent` when the task is simple, tool-bound, or has a strong project check.

Use `same_runtime_multi_agent` when independent generation or judging is useful
but the task does not need model, tool, or harness diversity.

Use `heterogeneous_cli_agents` when model, tool, or harness diversity can reduce
correlated error: adversarial review across systems, benchmark comparison,
high-risk review, debate with independent critics, or explicit user request for
different agents such as Claude Code and Codex. Inspect available CLIs first.
Ask before running external CLI commands when they require network access,
credentials, broader filesystem access, or other elevated permissions.

When the route needs a real current-session versus CLI decision, set
`dispatch_method: "agent-dispatch"` and keep dispatch attached to the selected
`work-gate` mode. Do not list `agent-dispatch` as the reasoning method or as a
candidate in a comparison. It is a topology helper for running candidate
analysis, judging, critic review, debate, or cross-agent review.

Default heterogeneous dispatch uses two non-interactive CLIs at most: Claude
Code first, Codex CLI second. Use additional CLIs only when explicitly
requested.
