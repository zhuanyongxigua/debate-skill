# Artifact Quality Rubric

Layer 2 eval rubric for debate artifacts. Each criterion is scored 0-3:

- **0**: absent or wrong
- **1**: present but vague or generic
- **2**: present and mostly correct
- **3**: present, concrete, and complete

## DebateRoute

| Criterion | Score 0 | Score 3 |
| --- | --- | --- |
| Entry case | Missing or wrong | Correctly names one of the four entry cases |
| Style | Missing | Names the matching debate style |
| Topology | Missing | Preserves current-session, same-runtime, single CLI, or heterogeneous CLI topology |
| Next artifact | Missing | Points to `DebateRecord` |

## DebateRecord

| Criterion | Score 0 | Score 3 |
| --- | --- | --- |
| Frozen candidates | Missing | Preserves or generates candidates before critique |
| Proposal normalization | Missing for raw requirements | Records proposer source, deduplication, stable IDs, and degraded state when needed |
| Degraded or reopen | Missing for raw requirements | Records reopen count, reopen limit, degraded terminal reason, or not-needed status |
| Critic findings | Missing | Includes role-specific findings with evidence, risk, or assumptions |
| Cross-review | Missing | Critics inspect and respond to opposing findings |
| Arbiter decision | Missing | Selects, combines, revises, rejects, probes, escalates, or blocks with reasons |
| Evidence basis | Missing | Cites evidence, checks, constraints, risks, or next probes |

## DebateSummary

| Criterion | Score 0 | Score 3 |
| --- | --- | --- |
| Input classification | Missing | Says requirement, single proposal, multiple candidates, or conflicting judgments |
| Status envelope | Missing | Uses `completed`, `degraded`, or `blocked` with a concise reason |
| Classification reason | Missing | Briefly explains why this input shape was chosen |
| Process summary | Missing | Briefly summarizes freeze, critique, cross-review, and arbitration |
| Final recommendation | Missing | Provides the final recommendation and rationale |
| Source proposals | Missing | Names up to two frozen proposal IDs that materially contributed |
| Sourced amendments | Missing when fragments are salvaged | Cites source proposal, excerpt, interpretation, rationale, and debate basis |
| Derivation | Missing | Explains how the final came from source proposals and amendments |

## AgentLaunchPlan

| Criterion | Score 0 | Score 3 |
| --- | --- | --- |
| Selected agents | Missing | Names selected CLI agents and roles |
| Command spec | Missing | Uses non-interactive command shape |
| Sandbox/network | Missing for Codex | Records sandbox and network intent |
| Timeout | Missing | Records timeout or wait policy |
| Boundary | Wrong owner | Does not decide whether debate or CLIs are useful |

## Failure Flags

- No `DebateRoute`.
- No `DebateRecord`.
- No `DebateSummary`.
- No frozen candidates or judgments.
- Raw requirement debate enters normal debate with fewer than two distinct
  normalized proposals.
- Cross-review omitted.
- Arbiter decides by vote count or confidence only.
- Final recommendation salvages a fragment without debate basis and arbiter
  acceptance.
- Rejected proposal appears as a source proposal when only one amendment was
  accepted from it.
- Degraded or blocked output changes shape instead of using the normal
  `DebateSummary` envelope with status.
- `source_proposals` is ordered by pre-debate rank rather than final
  contribution.
- A proposer is the sole critic validating its own proposal without recording
  the limitation.
- External CLI selected but no `AgentLaunchPlan`.
- `agent-launch` used as a reasoning method rather than a launch helper.
