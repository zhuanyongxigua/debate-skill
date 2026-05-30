# Artifact Quality Rubric

Layer 2 eval rubric for debate artifacts. Each criterion is scored 0-3:

- **0**: absent or wrong
- **1**: present but vague or generic
- **2**: present and mostly correct
- **3**: present, concrete, and complete

The audit envelope (`DebateRoute`, `DebateRecord`, `DebateSummary`) is the
required state these criteria score. It must be archived under
`~/.debate-router/<run-id>/audit.yaml`, while the visible answer includes only
the archive path. Each criterion below is scored against the archived audit
envelope; absence of an archive path or retrievable record counts as missing.

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
| CLI participation | Missing when external CLIs were selected or attempted | Separates proposal-generation and debate-execution CLIs, including ran, failed, blocked, and unavailable statuses |
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
| Status/decision split | Conflates run health with arbitration action | Uses `status: degraded` for partial-but-usable debates, `status: blocked` only when completion was impossible, and `arbiter.decision: blocked` only with blocked status |
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
| Timeout | Missing | Records timeout or wait policy, including 1800s default for external CLI proposal generation |
| Boundary | Wrong owner | Does not decide whether debate or CLIs are useful |

## Visible Output

If the caller supplied a fixed output format, score preservation of that format
instead of requiring the default human-first sections.

| Criterion | Score 0 | Score 3 |
| --- | --- | --- |
| Caller format preservation | Replaced a fixed caller template/schema with debate-router sections | Preserves the caller format and maps the debate outcome into its fields |
| Decision section | Missing or buried under YAML | Leads the visible output; matches `DebateSummary.final_recommendation` |
| Rationale section | Missing | Names base proposal and accepted amendments by ID, plus the deciding evidence or constraint |
| Trace table | Missing or placed before the answer sections | Final visible section; compact rows that trace back to `DebateRecord.cli_participation`, `frozen_candidates`, `source_proposals`, `sourced_amendments`, critic findings, or the arbiter decision; no invented rows |
| Dissent section | Missing | Names rejected proposals and challenged-but-accepted fragments with reasons matching `arbiter.rejected_candidates` and `debate_basis.arbiter_reason` |
| Open Questions section | Missing | Lists remaining probes or evidence gaps, reusing `arbiter.evidence_basis`/`next_action` when applicable |
| Next Step (when applicable) | Missing when `arbiter.decision` is `probe`/`escalate` | One concrete action consistent with `arbiter.next_action` |
| Audit archive | No archive path or retrievable record | Audit envelope archived under `~/.debate-router/<run-id>/audit.yaml` and referenced without inlining YAML |

## Failure Flags

- No `DebateRoute`.
- No `DebateRecord`.
- No `DebateSummary`.
- Caller supplied a fixed output format, but the answer replaced it with
  `Decision`, `Rationale`, `Trace`, or `Archive` sections.
- No caller fixed format exists, and the audit envelope is produced but
  human-first sections are missing (visible output leads with YAML).
- Human-first sections produced but no audit envelope is reachable from a
  `~/.debate-router/` archive path.
- Normal final answer appends a full `## Audit` section or inlines the full
  YAML instead of archiving it.
- `Trace` appears before `Dissent`, `Open Questions`, applicable `Next Step`,
  or `Archive` instead of being the final visible section.
- External CLI selected or attempted but no visible `Trace` row for it.
- Failed, blocked, or unavailable selected CLI omitted from `Trace`.
- Proposal-generation and debate-execution CLI participation collapsed into one
  ambiguous `Trace` phase when both phases used external CLIs.
- `Decision` or `Trace` disagrees with the audit envelope.
- `Trace` rows that do not appear in `frozen_candidates`,
  `source_proposals`, `sourced_amendments`, `DebateRecord.cli_participation`,
  critic findings, or the arbiter decision.
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
- `arbiter.decision: blocked` used for a degraded partial debate, or
  `status: completed` used despite recorded candidate, CLI, archive, or
  evidence limitations.
- `source_proposals` is ordered by pre-debate rank rather than final
  contribution.
- A proposer is the sole critic validating its own proposal without recording
  the limitation.
- External CLI selected but no `AgentLaunchPlan`.
- External CLI proposal generation is marked `failed/no_output` before the
  configured timeout without a concrete blocker.
- `cli-launch` used as a reasoning method rather than a launch helper.
