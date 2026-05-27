# Debate Router Protocol

`debate-router` emits a `DebateRoute` first, then a `DebateRecord`, then a
brief `DebateSummary`.

```yaml
DebateRoute:
  entry_case: "requirement_debate|single_proposal_debate|candidate_debate|judgment_debate"
  debate_style: "parallel_positions|proposal_attack|frozen_candidates"
  topology: "current_session|same_runtime_multi_agent|single_external_cli_agent|heterogeneous_cli_agents|sequential_isolated"
  selected_cli_agents:
    - "claude-code"
    - "codex-cli"
  why: ""
  next: "DebateRecord"
```

```yaml
DebateRecord:
  entry_case: "requirement_debate|single_proposal_debate|candidate_debate|judgment_debate"
  debate_style: "parallel_positions|proposal_attack|frozen_candidates"
  execution_topology:
    mode: "current_session|same_runtime_multi_agent|single_external_cli_agent|heterogeneous_cli_agents|sequential_isolated"
    launch_skill: "none|agent-launch"
    permission_needed: false
    permission_status: "not_needed|requested|approved|blocked"
    cli_agents:
      - name: "codex"
        command: "codex exec"
        mode: "non_interactive"
        timeout_seconds: 900
        sandbox: "read-only|workspace-write|danger-full-access|profile_default|unknown"
        network: "not_needed|needed_enabled|needed_blocked|unknown"
        status: "planned|ran|blocked|unavailable"
  frozen_candidates:
    - id: "A"
      artifact_type: "path|plan|answer|judgment|proposal"
      summary: ""
  proposal_generation:
    source: "external_cli_proposers|same_runtime_proposers|parent_generated|not_needed"
    agents: []
    raw_proposal_ids: []
    fallback_reason: ""
  proposal_normalization:
    normalized_proposal_ids: []
    rejected_as_duplicate: []
    degraded: false
    degraded_reason: ""
    coverage_gap: ""
  degraded_or_reopen:
    status: "not_needed|reopened|degraded"
    reopen_count: 0
    reopen_limit: 1
    terminal_reason: ""
  generated_before_freeze:
    used: false
    reason: ""
    candidate_source: "user_provided|parent_provided|debate_router_generated|critic_generated"
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
    decision: "select|combine|revise|reject|probe|escalate|blocked"
    selected_candidate_ids: []
    evidence_basis:
      - ""
    rejected_candidates:
      - id: ""
        reason: ""
    next_action: ""
```

```yaml
DebateSummary:
  input_classification: "requirement|single_proposal|multiple_candidates|conflicting_judgments"
  status: "completed|degraded|blocked"
  status_reason: ""
  classification_reason: ""
  process_summary: ""
  final_recommendation:
    summary: ""
    rationale: ""
  source_proposals:
    - id: "P1"
      contribution: ""
  base_proposal_id: "P1" # optional; omit or null for pure synthesis
  sourced_amendments:
    - amendment_id: "A1"
      kind: "adopt|override|constraint|caution"
      source_proposal_id: "P3"
      source_excerpt: ""
      interpretation: ""
      rationale: ""
      debate_basis:
        supported_by: []
        challenged_by: []
        arbiter_reason: ""
  arbiter_notes:
    - kind: "conflict_resolution|external_constraint|assumption"
      note: ""
      evidence_refs: []
  derivation:
    explanation: ""
```

Rules:

- `DebateRoute` is a classifier, not a debate/no-debate gate.
- Once `debate-router` is active, run a debate or record why the debate is
  blocked. Do not skip the debate instead.
- End with `DebateSummary`, briefly stating how the input was classified and
  what debate process was actually run.
- Use the same `DebateSummary` envelope for normal, degraded, and blocked
  outcomes. Empty `source_proposals` and `sourced_amendments` are valid when no
  proposal or amendment survived. Set `status_reason` instead of changing the
  shape.
- Choose the debate entry case before running the debate.
- For `requirement_debate`, generate 2-4 candidate positions or proposals
  first, then freeze them. If external CLI agents were selected, use those
  agents as independent proposers where practical.
- `requirement_debate` has four phases: `proposal_generation`,
  `proposal_normalization`, `debate_execution`, and `degraded_or_reopen`.
- `proposal_normalization` validates, deduplicates, trims or supplements to 2-4
  distinct proposals, assigns stable IDs, and records proposer source and
  fallback reasons. It must not rank or choose a winner.
- If fewer than two distinct usable proposals survive normalization, return a
  degraded result with reason instead of entering normal debate.
- Debate execution is read-only over the frozen proposal set. It must not add,
  remove, or rewrite proposals. Coverage gaps are recorded in `DebateSummary`
  unless the caller explicitly allowed one restart from `degraded_or_reopen`
  back to `proposal_generation`.
- `degraded_or_reopen` has a hard `reopen_limit` of 1 unless the user explicitly
  asks for more. If no restart is allowed or the limit has been used, finish
  with `status: degraded` and record the terminal reason.
- For `single_proposal_debate`, freeze the proposal and debate adopt, revise,
  reject, or probe.
- For `candidate_debate`, use the provided candidates by default. Do not add
  new candidates unless a missing baseline or control is needed.
- For `judgment_debate`, freeze the conflicting judgments or claims as the
  debate candidates.
- Candidate generation for `requirement_debate` belongs to this debate
  protocol. It is not a separate multi-path analysis method and should produce
  only the candidates needed for the debate.
- Freeze candidates before critique.
- Use `agent-launch` before launching selected external CLI child agents. Do
  not use `agent-launch` to decide whether external agents should be selected.
- Cap to one independent critique round, one cross-review round, and
  arbitration unless the user explicitly asks otherwise.
- Ask critics for evidence, risk, assumptions, and probes.
- Cross-review is required. Show each critic the other critic findings, then
  ask which opposing points are valid, invalid, unsupported, missing evidence,
  or decision-relevant.
- During cross-review, critics may update their critique but may not rewrite the
  frozen candidates.
- Do not use consensus pressure as evidence.
- Do not decide by vote count. The arbiter decides from evidence, risk,
  assumptions, reversibility, user constraints, and probe availability.
- Final synthesis uses base proposal plus sourced amendments. `source_proposals`
  contains at most two frozen proposal IDs that materially contributed to the
  final recommendation; it is not a pre-debate ranking or runner-up list.
- Treat `source_proposals` as contribution-ordered: base proposal first when
  present, then other material contributors. Never use pre-debate rank as the
  ordering key.
- A proposal belongs in `source_proposals` only if its content, structure, or
  constraints are present in the final recommendation in a way that would be
  absent if the proposal were removed from the frozen set.
- Proposal state terms are:
  - `non_selected`: not chosen as the base or a primary source.
  - `weak`: insufficient as a full answer, but not all parts were invalidated.
  - `rejected`: explicitly rejected by the arbiter as a solution.
- Useful fragments from non-selected, weak, or rejected proposals may appear
  only as `sourced_amendments` with verbatim `source_excerpt`, separate
  `interpretation`, `rationale`, and `debate_basis`.
- `debate_basis` must show that the fragment's usefulness was established by
  critique, cross-review, and arbiter acceptance. The summarizer may not
  salvage fragments on taste alone.
- A fragment that was challenged may still be accepted, but `arbiter_reason`
  must explain why the challenge does not defeat it. Conditional acceptance
  must be represented as a constraint or caution amendment.
- `sourced_amendments` must point back to an original frozen proposal. Do not
  create amendment-of-amendment chains.
- Rejected proposals stay rejected. If one of their fragments is accepted, cite
  it through `sourced_amendments`; do not promote the rejected proposal into
  `source_proposals`.
- `arbiter_notes` may resolve conflicts or record external constraints and
  assumptions. They must not introduce a replacement design.
- Preserve the external CLI set chosen by the user or parent workflow. If the
  selected CLI set is unavailable or unsafe, mark the affected agent `blocked`
  or `unavailable` instead of silently switching to another CLI.
- A proposer must not be the sole critic validating its own proposal. If the
  topology cannot provide role separation, record the limitation and treat
  self-review as weak evidence only.
- Use non-interactive CLI modes:
  - Claude Code: `claude -p` or `claude --print`
  - Codex CLI: `codex exec`
- For Codex CLI, the `agent-launch` default is a network-capable sandbox:
  `workspace-write` with `sandbox_workspace_write.network_access=true`. Record
  sandbox/profile and network status before launch. Mark the Codex critic
  `blocked` if a parent explicitly disabled network or the needed access is
  broader than this sandbox allows.
- Do not launch interactive TUI sessions for child agents.
- Use read-only, plan, or no-edit modes when available. Do not let child agents
  edit files unless implementation was explicitly requested.
- Wait patiently for non-interactive CLI agents. Use a long timeout for normal
  model latency; 900 seconds is the default for ordinary model CLI calls.
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
