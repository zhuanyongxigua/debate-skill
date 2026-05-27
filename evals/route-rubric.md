# DebateRoute Rubric

Score each `DebateRoute` and follow-on `DebateRecord` from 0 to 5 on each
criterion.

## Criteria

| Criterion | What to check |
| --- | --- |
| Explicit trigger | `debate-router` is used only when debate was explicitly requested. |
| Route order | `DebateRoute:` appears before substantive debate output. |
| Entry case fit | The chosen case matches requirement, single proposal, candidates, or judgments. |
| Freeze discipline | User-provided proposals, candidates, or judgments are preserved before critique. |
| Debate execution | The output includes critic findings, cross-review, and arbitration. |
| End summary | The output ends with a brief classification and process summary. |
| Final synthesis | The final recommendation names status, source proposals, accepted amendments, and derivation. |
| Evidence use | Checks, tests, sources, or probes are used as evidence when relevant. |
| Topology preservation | Explicit CLI or same-runtime choices are preserved. |
| Agent launch boundary | External CLI startup uses `agent-launch`; `agent-launch` is not used to decide whether to debate. |
| Minimality | No broad entry gate or unrelated non-debate method is introduced. |
| Blocker handling | Unavailable CLIs or permissions are recorded instead of silently ignored. |

## Failure Flags

- Uses `debate-router` for a task that did not explicitly request debate.
- Says debate is unnecessary after `debate-router` was explicitly invoked.
- Skips the required debate after explicit invocation.
- Omits the final `DebateSummary`.
- Emits a broad entry gate or `RoutePlan`.
- Produces no frozen candidates or judgments.
- Lets critics rewrite candidates during critique.
- Omits cross-review before arbitration.
- Salvages a fragment from a weak or rejected proposal without debate basis and
  arbiter acceptance.
- Calls a rejected proposal a source proposal when only a small amendment was
  accepted from it.
- Orders `source_proposals` by pre-debate rank instead of final contribution.
- Emits a degraded or blocked debate with a different output shape instead of
  the standard `DebateSummary` status envelope.
- Lets a proposer be the sole critic validating its own proposal without
  recording the limitation.
- Decides by vote count, confidence, or consensus pressure.
- Launches or plans external CLIs without `agent-launch`.
- Treats `agent-launch` as a topology chooser or reasoning method.
- Silently replaces a selected CLI that is blocked or unavailable.

## Passing Bar

A route is acceptable when:

- no failure flags apply,
- average score is at least 4,
- the entry case matches the input shape,
- required artifacts are present,
- explicit CLI selections are preserved,
- the arbiter decision is grounded in evidence, constraints, or next probes.
