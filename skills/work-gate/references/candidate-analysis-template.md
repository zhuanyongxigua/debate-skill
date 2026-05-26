# CandidateAnalysis Template

```yaml
CandidateAnalysis:
  mode: "diagnosis|decision|evaluation"
  criteria:
    - ""
  candidates:
    - id: "A"
      title: ""
      hypothesis_or_proposal: ""
      evidence_or_goal_fit: ""
      negative_evidence_or_tradeoffs: ""
      probe_or_validation_trigger: ""
      risk: ""
      confidence: "low|medium|high"
  scorecard:
    rubric:
      - criterion: ""
        weight: ""
        scale: ""
        disqualifier: ""
    scores:
      - candidate_id: ""
        criterion_scores: {}
        evidence: []
        concerns: []
    aggregate_ranking: []
    disagreements: []
    calibration_needed: false
  comparison:
    - criterion: ""
      best_candidate: ""
      notes: ""
  selected_candidate: ""
  synthesis: ""
  skipped_candidates:
    - id: ""
      reason: ""
  unresolved_questions:
    - ""
  next_action: ""
```

For diagnosis mode, emphasize causal chain, candidate files/configs, probes, and
patch shape. For decision mode, emphasize tradeoffs, constraints, risks, and
validation triggers. For evaluation mode, preserve the existing candidates,
define a rubric, score candidates against the same criteria, and only generate
new candidates if a missing baseline or control is needed.
