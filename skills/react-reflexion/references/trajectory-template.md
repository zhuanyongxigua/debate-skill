# Trajectory Template

```yaml
trajectory:
  goal: ""
  budget:
    max_actions: 0
    max_retries_per_failed_action: 2
    permission_boundaries: []
  checkpoints:
    - ""
  steps:
    - step: 1
      intent: ""
      action: ""
      observation: ""
      plan_update: ""
      verifier_result: ""
  reflections:
    - failed_action: ""
      likely_cause: ""
      new_constraint: ""
      next_attempt: ""
  final_state:
    outcome: "complete|blocked|partial"
    verification: ""
    stop_reason: ""
```

Keep reflections short and operational. Do not turn them into retrospective essays.
