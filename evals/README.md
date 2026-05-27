# Evals

Starter evals for the `debate-router` and `agent-launch` boundary.

These evals test whether an agent:

- uses `debate-router` only when debate was explicitly requested,
- emits `DebateRoute` before `DebateRecord`,
- ends with `DebateSummary` explaining the input classification and process,
- explains final synthesis with status, final recommendation, source proposals,
  accepted sourced amendments, and derivation,
- treats "讨论", "辩论", "discuss", or "debate" as multi-CLI debate signals
  unless external CLIs are explicitly disabled or blocked,
- classifies the input as requirement, single proposal, multiple candidates, or
  conflicting judgments,
- preserves selected external CLI agents and routes concrete startup details
  through `agent-launch`,
- avoids treating `agent-launch` as a debate or topology decision maker.

## Conditions

| Condition | Description |
| --- | --- |
| `baseline` | No skills, no method index, no routing instruction |
| `passive-skills` | Skills listed by name, explicit-only trigger still required |
| `explicit-router` | Requires `DebateRoute` for explicit debate tasks but gives no full skill definitions |
| `method-index` | Always-on compact skill index |
| `method-index-plus-skills` | Method index plus brief execution descriptions |
| `always-debate` | Forces a debate for every task, including negative controls |
| `generic-long-prompt` | Generic best-practices prompt (ablation baseline) |
| `oracle-skill` | Per-task method stack injection for execution ceiling tests |

## Metrics

| Metric | What it measures |
| --- | --- |
| DebateRoute rate | Did the output emit `DebateRoute:` before the debate result? |
| Critical recall | Were expected skill names mentioned? |
| Explanation recall | Were required entry-case/topology terms mentioned? |
| Topology match | Did the output preserve the expected topology? |
| Artifact score | Were required artifacts present? |
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
