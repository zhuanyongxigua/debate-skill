# Example: Positioning Decision

## User Task

How should I position this open-source project?

## Common Failure

The agent gives one polished recommendation before exploring alternatives, then
defends it with generic marketing language.

## RoutePlan

```yaml
route_plan:
  task_fingerprint:
    task_type: "open_ended_decision"
    artifact_type: "decision_memo"
    needs_current_info: false
    needs_external_evidence: false
    has_hard_verifier: false
    requires_codebase_context: true
    requires_tool_use: false
    needs_multi_agent: true
    needs_heterogeneous_agents: false
    risk_level: "medium"
    ambiguity_level: "high"
    budget_preference: "balanced"
  selected_stack:
    - skill_or_method: "multi-proposal-synthesis"
      purpose: "Generate distinct positioning options and synthesize a recommendation."
      expected_artifact: "DecisionMemo"
      selection_reason: "The task is open-ended and benefits from comparing alternatives."
      user_requested: false
      requested_skill_handling: "used"
    - skill_or_method: "multi-judge"
      purpose: "Score options against clarity, differentiation, and credibility."
      expected_artifact: "JudgeScorecard"
      selection_reason: "A rubric is useful because there is no single correct answer."
      user_requested: false
      requested_skill_handling: "used"
  why_this_stack:
    - "The task is an open-ended strategy decision."
    - "Independent proposals and rubric judging reduce first-answer lock-in."
  skipped_skills:
    - skill: "structured-debate"
      reason: "Debate should wait until concrete proposals remain unresolved after judging."
  debate:
    use: false
    condition: "Use only if the top proposals remain tied after rubric judging."
    max_rounds: 1
  execution_topology:
    mode: "same_runtime_multi_agent"
    reason: "Independent proposal and judge roles are useful; heterogeneous CLIs are not required."
    agents:
      - role: "proposal_generator"
        runtime: "same_runtime"
        model_or_cli: ""
        purpose: "Generate distinct positioning options."
      - role: "rubric_judge"
        runtime: "same_runtime"
        model_or_cli: ""
        purpose: "Score options against the rubric."
    permission_needed: false
    permission_reason: ""
    cli_discovery:
      needed: false
      approach: ""
  escalation_conditions:
    - "Escalate to structured-debate only if top proposals remain unresolved after judging."
  expected_artifacts:
    - "DecisionMemo"
    - "JudgeScorecard"
  immediate_next_action: "Generate distinct positioning proposals before judging."
```

## Better Workflow

1. Generate distinct frames:
   - method router
   - method standard library
   - method cards deck
   - workflow linter
2. Judge each frame with a rubric:
   - clarity
   - differentiation
   - audience fit
   - credibility
   - demo strength
3. Synthesize the strongest narrative and state what evidence would change it.

## Success Signal

The recommendation keeps a sharp point of view and explains why rejected frames
were weaker for the current launch.
