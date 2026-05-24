# Path Card Schema

```yaml
path_card:
  id: "A"
  hypothesis: ""
  causal_chain:
    - ""
  candidate_locations:
    - path: ""
      symbol: ""
      why_relevant: ""
  supporting_evidence:
    - ""
  negative_evidence:
    - ""
  probe:
    command_or_test: ""
    expected_if_true: ""
    expected_if_false: ""
    cost: "cheap|moderate|expensive"
    permission_needed: false
  minimal_patch_shape:
    - ""
  risk: "low|medium|high"
  confidence: "low|medium|high"
  score:
    explains_symptoms: 0
    repo_evidence: 0
    probe_quality: 0
    matches_tests_or_logs: 0
    patch_minimality: 0
    risk_impact: 0
    architecture_fit: 0
    negative_evidence: 0
    reversibility: 0
```

## Arbiter Rule

Choose the path with the strongest evidence and cheapest falsification path, not the path that sounds most confident. If the top two paths are close, design a probe before writing a patch.
