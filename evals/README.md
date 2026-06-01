# Evals

Starter evals for the `debate-router` and `cli-launch` boundary.

These evals test whether an agent:

- uses `debate-router` only when debate was explicitly requested,
- preserves a caller-required or implied final output format when one exists;
  otherwise
  leads the visible output with the human-first sections (`Decision`,
  `Rationale`, `Dissent`, `Open Questions`, optional `Next Step`, `Archive`,
  then `Trace` as the final visible section) rather than YAML, and includes
  external CLI statuses in `Trace` when external CLIs were selected or
  attempted,
- still produces `DebateRoute`, `DebateRecord`, and `DebateSummary` as audit
  state archived under `~/.debate-router/<run-id>/audit.yaml`, while the
  visible answer includes only a compatible archive path when the visible
  format allows it,
- keeps the visible output consistent with the audit envelope; in the default
  layout, `Decision` matches `final_recommendation` and `Trace` rows trace back
  to `DebateRecord.cli_participation`, `frozen_candidates`, `source_proposals`,
  `sourced_amendments`, critic findings, or the arbiter decision,
- explains final synthesis with status, final recommendation, source proposals,
  accepted sourced amendments, and derivation,
- treats "讨论", "辩论", "discuss", or "debate" as multi-CLI debate signals
  unless external CLIs are explicitly disabled or blocked,
- marks phase-level CLI participation, separating proposal-generation CLIs from
  debate-execution CLIs and keeping failed, blocked, or unavailable selected
  CLIs visible,
- uses the longer phase-aware timeout for external CLI proposal generation and
  does not treat short quiet periods as `failed/no_output`,
- classifies the input as requirement, single proposal, multiple candidates, or
  conflicting judgments,
- preserves selected external CLI agents and routes concrete startup details
  through `cli-launch`,
- avoids treating `cli-launch` as a debate or topology decision maker.

## Conditions

| Condition | Description |
| --- | --- |
| `baseline` | No skills, no method index, no routing instruction |
| `passive-skills` | Skills listed by name, explicit-only trigger still required |
| `explicit-router` | Requires debate-router audit state for explicit debate tasks but gives no full skill definitions |
| `method-index` | Always-on compact skill index |
| `method-index-plus-skills` | Method index plus brief execution descriptions |
| `always-debate` | Forces a debate for every task, including negative controls |
| `generic-long-prompt` | Generic best-practices prompt (ablation baseline) |
| `oracle-skill` | Per-task method stack injection for execution ceiling tests |

## Metrics

| Metric | What it measures |
| --- | --- |
| DebateRoute rate | Did the run produce or reference a `DebateRoute` envelope in the `~/.debate-router/` archive? It is no longer required as the first visible block. |
| Critical recall | Were expected skill names mentioned? |
| Explanation recall | Were required entry-case/topology terms mentioned? |
| Topology match | Did the output preserve the expected topology? |
| Artifact score | Were required audit artifacts present or clearly archived under `~/.debate-router/`? |
| Avoid violation rate | Did forbidden methods or behaviors appear? |
| Debate misuse rate | Was debate used for tasks that did not request it? |
| Avg token cost | API cost per run |

## Files

- [`routing-tasks.jsonl`](routing-tasks.jsonl): debate-router routing tasks and
  negative controls.
- [`tasks/artifact-tasks.jsonl`](tasks/artifact-tasks.jsonl): DebateRecord and
  DebateSummary structure checks.
- [`route-rubric.md`](route-rubric.md): rubric for route and boundary quality.
- [`rubrics/artifact-rubric.md`](rubrics/artifact-rubric.md): artifact quality
  rubric.
- [`runner.py`](runner.py): runs tasks against prompt conditions.
- [`scorer.py`](scorer.py): string and heuristic scoring.
