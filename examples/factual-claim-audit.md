# Example: Factual Claim Audit

## User Task

Summarize what changed in the latest API pricing rules, with sources.

## Common Failure

The agent answers from memory, cites sources near the topic, and leaves several
material claims unsupported.

## RoutePlan

```yaml
route_plan:
  task_fingerprint:
    task_type: "factual_research"
    artifact_type: "sourced_answer"
    needs_current_info: true
    needs_external_evidence: true
    has_hard_verifier: true
    requires_codebase_context: false
    requires_tool_use: true
    needs_multi_agent: false
    needs_heterogeneous_agents: false
    risk_level: "medium"
    ambiguity_level: "medium"
    budget_preference: "balanced"
  selected_stack:
    - skill_or_method: "rag-claim-check"
      purpose: "Retrieve sources and map each material claim to evidence."
      expected_artifact: "ClaimTable"
      selection_reason: "The task asks for latest factual information and citations."
      user_requested: false
      requested_skill_handling: "used"
    - skill_or_method: "hard-verifier"
      purpose: "Check dates, source authority, and claim-source alignment."
      expected_artifact: "VerificationRecord"
      selection_reason: "Citation and date checks can catch stale or unsupported claims."
      user_requested: false
      requested_skill_handling: "used"
  why_this_stack:
    - "The task depends on current factual information."
    - "Every material claim should be source-mapped before the answer is polished."
  skipped_skills:
    - skill: "structured-debate"
      reason: "Facts should be decided by sources, not debate."
  debate:
    use: false
    condition: "Do not use debate to decide factual claims when source checks are available."
    max_rounds: 1
  execution_topology:
    mode: "single_agent"
    reason: "Retrieval and citation verification are more important than model diversity."
    agents: []
    permission_needed: false
    permission_reason: ""
    cli_discovery:
      needed: false
      approach: ""
  escalation_conditions:
    - "Escalate to high-risk-evidence if the factual answer affects regulated or irreversible decisions."
  expected_artifacts:
    - "ClaimTable"
    - "VerificationRecord"
    - "sourced answer"
  immediate_next_action: "Retrieve primary sources before drafting the answer."
```

## Better Workflow

1. Retrieve primary sources first.
2. Extract material claims.
3. Build a ClaimTable:
   - claim
   - supporting source
   - contradiction
   - confidence
   - action: keep, qualify, remove, investigate
4. Draft the final answer only from supported claims.

## Success Signal

Every material claim is supported, qualified, or removed, and dates are visible
where recency matters.
