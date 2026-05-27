---
name: debate-router
description: Route an explicitly requested debate into requirement, single-proposal, candidate, or judgment debate, then run the bounded debate and produce DebateRecord. Use only when the user or a parent workflow explicitly invokes debate-router or asks to route/run a debate; do not use it to decide whether debate is necessary.
---

# Debate Router

## Overview

Use `debate-router` after the user or a parent workflow has already selected
debate. This skill does not decide whether debate is worth doing.

It answers one question:

```text
What kind of debate input is this, and how should the bounded debate run?
```

When `debate-router` is explicitly invoked, run a debate. Do not replace it
with another non-debate workflow because the task seems simple, checkable, or
expensive. If the debate cannot run, record the concrete blocker in the
`DebateRecord`.

If the caller uses explicit discussion or debate signals such as "discuss",
"debate", "argue about", "讨论", or "辩论", treat that as an instruction to use
multiple external CLI agents. This is not a model judgment about whether CLIs
are worthwhile; the caller has selected the multi-CLI path. Use the multi-CLI
path for both proposal generation and debate execution unless the caller
explicitly disables external CLIs or the selected CLIs are blocked or
unavailable.

## Required Output

The first visible block must be `DebateRoute:`:

```yaml
DebateRoute:
  entry_case: "requirement_debate|single_proposal_debate|candidate_debate|judgment_debate"
  debate_style: "parallel_positions|proposal_attack|frozen_candidates"
  topology: "current_session|same_runtime_multi_agent|single_external_cli_agent|heterogeneous_cli_agents|sequential_isolated"
  selected_cli_agents: []
  why: ""
  next: "DebateRecord"
```

Then run the debate, return `DebateRecord`, and finish with a short
`DebateSummary`.

Do not stop after `DebateRoute` unless a required input, CLI, permission, or
artifact is unavailable. In that case, still return a `DebateRecord` with
`arbiter.decision: "blocked"` or `arbiter.decision: "escalate"` and the reason.

End every run with:

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
  derivation:
    explanation: ""
```

Keep `DebateSummary` brief. `input_classification` says whether this concrete
input was treated as a requirement, one proposal, multiple proposals, or
conflicting judgments. `status` is `completed` for normal arbitration,
`degraded` when the debate could not meet its normal candidate or evidence
threshold, and `blocked` when a required input, permission, CLI, or artifact
was unavailable. Use the same envelope in all cases; empty `source_proposals`
and `sourced_amendments` are valid when nothing survived debate.
`process_summary` should be one or two sentences about what was frozen, which
critique/cross-review shape ran, and how arbitration ended. `source_proposals`
contains at most two frozen proposal IDs that materially contributed to the
final recommendation; they are not pre-debate rankings or runners-up.
`sourced_amendments` may salvage useful fragments from non-selected, weak, or
rejected proposals only when the debate and arbiter explicitly accepted that
fragment.

## Entry Cases

Classify the input shape only:

- `requirement_debate`: the user provided a raw requirement, problem, question,
  or goal, but no concrete proposal. Generate 2-4 candidate positions or
  proposals first, freeze them, then debate. If external CLI agents were
  selected, use those selected agents as independent proposers where practical.
- `single_proposal_debate`: the user provided one proposal, plan, patch,
  design, review, or claim. Freeze it and debate adopt, revise, reject, or
  probe.
- `candidate_debate`: the user provided multiple proposals, plans, patches,
  answers, or approaches. Preserve and freeze the existing candidates before
  critique.
- `judgment_debate`: the artifact may be singular, but there are conflicting
  reviews, judgments, findings, or claims about it. Freeze those judgments as
  the debate candidates.

If the input is ambiguous, choose the nearest case and record the assumption in
`DebateRoute.why`. Ask a question only when the missing information makes all
four cases impossible.

## Debate Styles

- `parallel_positions`: independent candidate positions are presented first,
  then cross-reviewed. Use for `requirement_debate` and broad tradeoffs.
- `proposal_attack`: one frozen proposal is defended, attacked, and revised or
  rejected. Use for `single_proposal_debate`.
- `frozen_candidates`: existing candidates or judgments are cross-critiqued and
  arbitrated. Use for `candidate_debate` and `judgment_debate`.

## Debate Rules

- Freeze candidates or judgments before critique.
- Do not let critics rewrite frozen candidates during critique.
- Cross-review is required: each critic must inspect the other critic findings
  before arbitration.
- The arbiter decides from evidence, risk, reversibility, constraints, and
  probe availability. Do not decide by vote count, confidence, or consensus
  pressure.
- Cap the debate to one independent critique round, one cross-review round, and
  arbitration unless the user explicitly asks for more.
- Project checks, source checks, tests, schemas, calculators, or cheap probes
  may be used as evidence or recommended as next probes. They are not a reason
  to cancel the debate once this skill is active.
- Requirement debates own candidate generation for that debate. This is not a
  separate multi-path analysis method: generate only the positions needed for
  the debate, then freeze them.
- For `requirement_debate`, run proposal generation as four phases:
  `proposal_generation`, `proposal_normalization`, `debate_execution`, then
  `degraded_or_reopen`.
- `proposal_generation` produces raw proposals from selected external CLI
  proposers when provided; otherwise use same-runtime or current-session
  proposers.
- `proposal_normalization` validates proposals, removes near-duplicates,
  trims or supplements to 2-4 distinct proposals, assigns stable IDs, and
  records proposer source and fallback reasons. It may normalize; it must not
  rank, score, or choose a winner.
- If fewer than two distinct usable proposals survive normalization, return a
  degraded `DebateRecord` instead of pretending to debate a single proposal.
- Debate execution is read-only over the frozen proposal set. If a major
  coverage gap appears, record it in `DebateSummary`. Restart
  `proposal_generation` at most once, only when the caller explicitly allows a
  restart and the rationale is recorded in `degraded_or_reopen`. If restart is
  unavailable or the one allowed restart has already been used, finish with
  `status: degraded`.
- Do not add new candidates to `candidate_debate` or `judgment_debate` unless a
  missing baseline or control candidate is necessary; if added, label it as
  generated after the user-provided candidates.

## Final Synthesis

Final synthesis can combine proposals, but only with traceable debate support.

Proposal state terms:

- `non_selected`: a proposal was not chosen as the base or a primary source.
- `weak`: critics or the arbiter found the proposal insufficient as a full
  answer, but not all of its parts were invalidated.
- `rejected`: the arbiter explicitly rejected the proposal as a solution.

`weak` and `rejected` proposals may contribute only through
`sourced_amendments`.

- Select a `base_proposal_id` when the final recommendation is primarily
  derived from one frozen proposal. Leave it null only for explicit synthesis
  cases.
- Fill `source_proposals` with 0-2 frozen proposal IDs whose content,
  structure, or constraints materially contributed to the final recommendation.
  Commit these before writing the final rationale. Use ID plus one short
  contribution sentence only; full proposal text stays in `DebateRecord`.
  Treat the list as contribution-ordered: base proposal first when present,
  then other material contributors. Never preserve pre-debate rank as the
  ordering key.
- Useful fragments from non-selected, weak, or rejected proposals may enter the
  final recommendation only as `sourced_amendments`.
- Each `sourced_amendment` must include a verbatim `source_excerpt`, a separate
  `interpretation`, a `rationale`, and `debate_basis`. The `debate_basis` names
  which critic findings supported it, which challenged it, and why the arbiter
  accepted it.
- A challenged fragment can be accepted only when `arbiter_reason` explains why
  the challenge does not defeat the fragment. Conditional acceptance must be
  recorded as a constraint or caution amendment.
- Amendments must point back to an original frozen proposal, not to another
  amendment. Do not create amendment-of-amendment chains.
- Rejected proposals do not become `source_proposals` merely because one
  fragment was salvaged. Cite the fragment through `sourced_amendments`.
- `arbiter_notes`, when used in the full protocol, may resolve conflicts or
  record external constraints and assumptions. They must not introduce a
  replacement design.
- The final recommendation should visibly credit salvaged fragments, for
  example `[from P3]`, so valid fragments from weak proposals are not laundered
  into the result without attribution.

## CLI Topology

`debate-router` does not decide whether external CLI agents are worth using.

Use the user or parent workflow's selected topology:

- Discussion/debate signals such as "discuss", "debate", "argue about", "讨论",
  or "辩论" count as selected `heterogeneous_cli_agents`. Plan two or more
  external CLI agents through `agent-launch`. Prefer the locally configured
  debate CLIs, and record any unavailable selected CLI as blocked instead of
  silently falling back to current-session debate.
- If no external CLI agents are selected, run the bounded debate in the current
  session or same runtime.
- If one or more external CLI agents are selected, use `agent-launch` for the
  concrete non-interactive startup plan.
- Preserve explicit named-CLI requests such as Claude Code, Codex CLI, or
  Copilot CLI unless the selected CLI is unavailable, unsafe, or blocked.
- A proposer must not be the sole critic validating its own proposal. If the
  selected topology cannot provide role separation, record the limitation in
  `DebateRecord` and treat any self-review as weak evidence only.
- Do not launch interactive child-agent sessions.
- Do not let child agents edit files unless implementation was explicitly
  requested.

## Workflow

1. Identify whether the input is a requirement, one proposal, multiple
   candidates, or conflicting judgments.
2. Emit `DebateRoute:`.
3. For `requirement_debate`, generate 2-4 candidate positions or proposals
   using the selected current-session, same-runtime, or external CLI agents,
   then freeze them.
   If the trigger was a discussion/debate signal, use the selected external CLI
   agents as proposers before normalization.
4. For the other entry cases, freeze the user-provided proposal, candidates, or
   judgments before critique.
5. Run one independent critique round. If the trigger was a discussion/debate
   signal, run this round through the selected external CLI agents.
6. Run one cross-review round.
7. Arbitrate and return `DebateRecord`.
8. End with `DebateSummary`, including final recommendation, source proposals,
   accepted amendments, and derivation.

## Anti-Patterns

- Treating `debate-router` as a general entry gate.
- Asking "is debate needed?" after the skill was explicitly invoked.
- Treating "讨论", "辩论", "discuss", or "debate" as permission to stay in the
  current session when external CLIs are available.
- Returning only a recommendation without `DebateRoute`, `DebateRecord`, and
  `DebateSummary`.
- Salvaging a fragment because the summarizer likes it, without debate support
  and arbiter acceptance.
- Calling a rejected proposal one of the top proposals when only a small
  amendment was accepted from it.
- Generating new options for a `candidate_debate` without preserving the user's
  candidates.
- Letting critics edit the candidates they are critiquing.
- Using model votes, confidence, or consensus as the arbiter's evidence.
- Calling `agent-launch` to decide whether CLI agents should be used.

## References

- Read `references/debate-agent-policy.md` when external CLI agents,
  same-runtime roles, or harness differences matter.
- Read `references/debate-protocol.md` when producing `DebateRecord`.
