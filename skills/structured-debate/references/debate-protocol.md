# Structured Debate Protocol

```yaml
debate_record:
  execution_topology:
    mode: "same_runtime_multi_agent|heterogeneous_cli_agents|sequential_isolated"
    permission_needed: false
    permission_status: "not_needed|requested|approved|blocked"
  frozen_candidates:
    - id: "A"
      artifact_type: "path|plan|answer|judgment|proposal"
      summary: ""
  debate_reason: ""
  critics:
    - role: "evidence_critic"
      target_candidate: "A"
      findings:
        - ""
  arbiter:
    decision: "select|combine|probe|escalate"
    selected_candidate_ids: []
    evidence_basis:
      - ""
    rejected_candidates:
      - id: ""
        reason: ""
    next_action: ""
```

Rules:

- Freeze candidates before critique.
- Cap to one critique round unless the user asks otherwise.
- Ask critics for evidence, risk, assumptions, and probes.
- Do not use consensus pressure as evidence.
- Do not invoke external CLI agents without permission when they need network,
  credentials, broad filesystem access, or other elevated permissions.
