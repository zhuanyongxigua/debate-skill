# VoteRecord Template

```yaml
vote_record:
  task: ""
  sample_count: 5
  independence: "fresh_sessions|separate_calls|single_context_variants"
  execution_topology: "same_runtime_multi_agent|separate_calls|sequential_isolated"
  independence_limitations: ""
  candidates:
    - id: "A"
      final_answer: ""
      rationale_summary: ""
      verifier_result: "pass|fail|not_run|inconclusive"
  clusters:
    - answer: ""
      candidate_ids: []
      count: 0
  aggregation:
    method: "majority|weighted_vote|verifier_selected|judge_tiebreak"
    winner: ""
    confidence: "low|medium|high"
  dissent:
    - candidate_id: ""
      why_it_matters: ""
  next_step: ""
```

Use exact voting only for comparable answers. For open-ended answers, cluster first or switch to `multi-judge`.
