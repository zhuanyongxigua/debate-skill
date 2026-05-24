# Branch Table Schema

```yaml
search_state:
  goal: ""
  constraints: []
  invalid_state_tests: []
  depth_limit: 0
  branch_limit: 0
  beam_width: 0
  stop_conditions: []
branches:
  - id: "B1"
    parent_id: ""
    state: ""
    move_or_thought: ""
    validity: "valid|invalid|unknown"
    score:
      progress: 0
      constraint_fit: 0
      cost: 0
      dead_end_risk: 0
    next_actions:
      - ""
decision:
  expanded_branch_ids: []
  pruned_branch_ids: []
  final_path: []
  verifier_result: ""
  stop_reason: ""
```

Prefer explicit branch state over long narrative reasoning.
