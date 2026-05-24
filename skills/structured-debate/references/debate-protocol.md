# Structured Debate Protocol

```yaml
debate_record:
  execution_topology:
    mode: "same_runtime_multi_agent|heterogeneous_cli_agents|sequential_isolated"
    dispatch_skill: "agent-dispatch"
    permission_needed: false
    permission_status: "not_needed|requested|approved|blocked"
    cli_agents:
      - name: "codex"
        command: "codex exec"
        mode: "non_interactive"
        timeout_seconds: 300
        status: "planned|ran|blocked|unavailable"
      - name: "claude"
        command: "claude -p|claude --print"
        mode: "non_interactive"
        timeout_seconds: 300
        status: "planned|ran|blocked|unavailable"
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
  cross_review:
    - critic_role: "evidence_critic"
      reviewed_critic_role: "risk_critic"
      valid_opposing_points:
        - ""
      invalid_or_unsupported_points:
        - ""
      decision_relevant_updates:
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
- Use `agent-dispatch` before launching child agents.
- Cap to one independent critique round, one cross-review round, and
  arbitration unless the user explicitly asks otherwise.
- Ask critics for evidence, risk, assumptions, and probes.
- Cross-review is required. Show each critic the other critic findings, then ask
  which opposing points are valid, invalid, unsupported, missing evidence, or
  decision-relevant.
- During cross-review, critics may update their critique but may not rewrite the
  frozen candidates.
- Do not use consensus pressure as evidence.
- Do not decide by vote count. The arbiter decides from evidence, risk,
  assumptions, reversibility, user constraints, and probe availability.
- For default heterogeneous CLI debate in this repo, use at most two CLIs:
  Claude Code first, Codex CLI second. Use other CLIs only when explicitly
  requested or when a selected default CLI is unavailable and fallback is
  approved.
- Use non-interactive CLI modes:
  - Claude Code: `claude -p` or `claude --print`
  - Codex CLI: `codex exec`
- Do not launch interactive TUI sessions for child agents.
- Use read-only, plan, or no-edit modes when available. Do not let child agents
  edit files unless implementation was explicitly requested.
- Wait patiently for non-interactive CLI agents. Use a long timeout for normal
  model latency; 5 minutes is a reasonable default.
- Kill the child agent early only when it is clearly blocked on login, OAuth,
  browser auth, credentials, stdin, an interactive prompt, or repeated
  no-output/no-progress behavior.
- If a CLI times out, retry once with a shorter, narrower prompt before marking
  the agent `unavailable`.
- If a CLI blocks on login, OAuth, browser auth, credentials, or stdin, stop
  that agent and record it as `blocked` or `unavailable`.
- Do not invoke external CLI agents without permission when they need network,
  credentials, broad filesystem access, or other elevated permissions.
