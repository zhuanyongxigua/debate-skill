# Rubric Schema

```yaml
rubric:
  task: ""
  judge_count: 3
  execution_topology: "same_runtime_fresh_sessions|sequential_isolated|heterogeneous_cli"
  independence_limitations: ""
  criteria:
    - name: "correctness"
      weight: 0.4
      scale: "0-5"
      disqualifier: ""
    - name: "completeness"
      weight: 0.2
      scale: "0-5"
    - name: "clarity"
      weight: 0.2
      scale: "0-5"
    - name: "risk"
      weight: 0.2
      scale: "0-5"
judgments:
  - judge_id: "J1"
    blind_order: []
    scores:
      - candidate_id: ""
        criterion_scores: {}
        evidence: []
        concerns: []
aggregate:
  winner: ""
  score_summary: {}
  disagreements: []
  calibration_needed: false
```

Shuffle order for pairwise comparisons when possible. Use human calibration for high-stakes evaluation.
