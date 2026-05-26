# Work-Gate Debate Protocol

```yaml
debate_record:
  entry_case: "requirement_debate|single_proposal_debate|candidate_debate|judgment_debate"
  debate_style: "parallel_positions|proposal_attack|frozen_candidates"
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
        sandbox: "read-only|workspace-write|danger-full-access|profile_default|unknown"
        network: "not_needed|needed_enabled|needed_blocked|unknown"
        status: "planned|ran|blocked|unavailable"
      - name: "claude"
        command: "claude -p|claude --print"
        mode: "non_interactive"
        timeout_seconds: 300
        sandbox: "read-only|workspace-write|danger-full-access|profile_default|unknown"
        network: "not_needed|needed_enabled|needed_blocked|unknown"
        status: "planned|ran|blocked|unavailable"
  frozen_candidates:
    - id: "A"
      artifact_type: "path|plan|answer|judgment|proposal"
      summary: ""
  generated_before_freeze:
    used: false
    reason: ""
    candidate_source: "user_provided|work-gate_candidate_analysis|critic_generated"
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

- Choose the debate entry case before running the debate.
- For `requirement_debate`, generate 2-4 candidates first, then freeze them.
- For `single_proposal_debate`, freeze the proposal and debate adopt, revise,
  reject, or probe.
- For `candidate_debate`, use the provided candidates by default. Do not add
  new candidates unless a missing baseline or control is needed.
- For `judgment_debate`, freeze the conflicting judgments or claims as the
  debate candidates.
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
- For Codex CLI, do not assume the default sandbox/profile can use network. If
  the critic task needs SSH, package installs, external APIs, web access, or
  remote docs, record sandbox/profile and network status before launch. Mark the
  Codex critic `blocked` if network is needed but unavailable.
- Do not launch interactive TUI sessions for child agents.
- Use read-only, plan, or no-edit modes when available. Do not let child agents
  edit files unless implementation was explicitly requested.
- Wait patiently for non-interactive CLI agents. Use a long timeout for normal
  model latency; 5 minutes is a reasonable default.
- Do not kill a child agent only because the parent harness prints a transient
  parser/router warning such as `failed to parse function arguments`, `unknown
  variant`, or a tool-call parse warning. Continue waiting if the child retries,
  enters command execution, or produces useful output.
- Kill the child agent early only when it is clearly blocked on login, OAuth,
  browser auth, credentials, stdin, an interactive prompt, or repeated
  no-output/no-progress behavior.
- If a CLI times out, retry once with a shorter, narrower prompt before marking
  the agent `unavailable`.
- If a CLI blocks on login, OAuth, browser auth, credentials, or stdin, stop
  that agent and record it as `blocked` or `unavailable`.
- Do not invoke external CLI agents without permission when they need network,
  credentials, broad filesystem access, or other elevated permissions.
