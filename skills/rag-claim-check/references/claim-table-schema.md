# ClaimTable Schema

```yaml
claim_table:
  query: ""
  source_policy: "primary_sources_preferred"
  conflict_policy: "show_conflicts_and_qualify_uncertain_claims"
  sources:
    - id: "S1"
      title: ""
      url_or_path: ""
      date_or_version: ""
      source_type: "primary|secondary|user_provided|local"
  claims:
    - id: "C1"
      text: ""
      support:
        - source_id: "S1"
          note: ""
      contradiction:
        - source_id: ""
          note: ""
      confidence: "low|medium|high"
      action: "keep|qualify|remove|investigate"
  unsupported_claims:
    - ""
  final_answer_requirements:
    cite_sources: true
    mention_uncertainty: true
    include_dates_when_relevant: true
```

If source support is weak, qualify the answer instead of letting a critic invent certainty.
