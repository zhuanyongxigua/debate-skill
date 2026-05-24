# Example: Repo Debugging 401

## User Task

Users sometimes get `401` after login. Give me a plan before editing code.

## Common Failure

The agent jumps to the first plausible auth file and patches middleware before
it has localized the root cause.

## RoutePlan

```yaml
route_plan:
  task_fingerprint:
    task_type: "repo_debugging"
    artifact_type: "implementation_plan"
    needs_current_info: false
    needs_external_evidence: false
    has_hard_verifier: true
    requires_codebase_context: true
    requires_tool_use: true
    needs_multi_agent: false
    needs_heterogeneous_agents: false
    risk_level: "medium"
    ambiguity_level: "high"
    budget_preference: "balanced"
  selected_stack:
    - skill_or_method: "multipath-localization"
      purpose: "Generate competing root-cause paths before editing."
      expected_artifact: "PathCards"
      selection_reason: "The symptom is intermittent and may involve auth, cookies, state, or timing."
      user_requested: false
      requested_skill_handling: "used"
    - skill_or_method: "hard-verifier"
      purpose: "Design probes that distinguish candidate paths."
      expected_artifact: "VerificationRecord"
      selection_reason: "Cookie headers, session state, logs, and regression tests can falsify paths."
      user_requested: false
      requested_skill_handling: "used"
    - skill_or_method: "edit-plan"
      purpose: "Turn the selected path into scoped file changes."
      expected_artifact: "EditPlan"
      selection_reason: "The user asked for a plan before code edits."
      user_requested: false
      requested_skill_handling: "used"
  why_this_stack:
    - "The task is a repo bug with uncertain root cause."
    - "Hard probes can distinguish candidate paths before edits."
  skipped_skills:
    - skill: "structured-debate"
      reason: "Debate is premature until PathCards exist and probes are inconclusive."
  debate:
    use: false
    condition: "Use only if top paths remain tied after probes."
    max_rounds: 1
  execution_topology:
    mode: "single_agent"
    reason: "Hard probes are more valuable than model diversity for this task."
    agents: []
    permission_needed: false
    permission_reason: ""
    cli_discovery:
      needed: false
      approach: ""
  escalation_conditions:
    - "Escalate to structured-debate if mutually exclusive paths remain tied after probes."
  expected_artifacts:
    - "PathCards"
    - "VerificationRecord"
    - "EditPlan"
  immediate_next_action: "Inspect auth entry points and generate PathCards."
```

## Better Workflow

1. Generate PathCards:
   - Token refresh bug
   - Cookie domain or `SameSite` mismatch
   - CSRF/session mismatch
   - Session store race
2. Run cheap probes:
   - inspect `Set-Cookie`
   - check refresh timing
   - reproduce with server logs
   - add a focused regression test
3. Select the best-supported path.
4. Produce an EditPlan with validation commands.

## Success Signal

The final plan names files, tests, and rollback steps only after a path has
stronger evidence than its alternatives.
