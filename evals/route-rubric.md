# DebateRoute Rubric

Score each run (visible output plus audit envelope) from 0 to 5 on each
criterion.

## Criteria

| Criterion | What to check |
| --- | --- |
| Explicit trigger | `debate-router` is used only when debate was explicitly requested. |
| Format preservation | If the caller supplied a fixed output format, the visible answer preserves that format instead of using the debate-router default layout. |
| Implied format detection | Review/archive/wiki/diary/report/checklist/table/YAML/JSON tasks are treated as caller-format tasks even when the exact template is not repeated. |
| Human-first layout | When no caller format exists, the visible output leads with `Decision` and `Rationale`, then `Dissent`, `Open Questions`, optional `Next Step`, `Archive`, and ends with `Trace`; it does not lead with the YAML envelope. |
| CLI trace visibility | When external CLIs were selected or attempted, `Trace` names which CLIs participated in proposal generation and debate execution, including failed, blocked, or unavailable CLIs. |
| Audit archive | `DebateRoute`, `DebateRecord`, and `DebateSummary` are archived under `~/.debate-router/<run-id>/audit.yaml`; the visible answer includes the archive path only when the caller format allows it. |
| Audit consistency | The visible result matches `DebateSummary.final_recommendation`; `Trace` rows, when shown, match `DebateRecord.cli_participation`, `frozen_candidates`, `source_proposals`, `sourced_amendments`, critic findings, or the arbiter decision. |
| Entry case fit | The chosen case matches requirement, single proposal, candidates, or judgments. |
| Freeze discipline | User-provided proposals, candidates, or judgments are preserved before critique. |
| Debate execution | The output includes critic findings, cross-review, and arbitration. |
| Summary placement | `DebateSummary` in the archived envelope contains the input classification and compact process summary; the human-first sections name the decision and rationale. |
| Final synthesis | The final recommendation names status, source proposals, accepted amendments, and derivation. |
| Status/decision split | `DebateSummary.status` reports run health, while `DebateRecord.arbiter.decision` reports the arbitration action; `arbiter.decision: "blocked"` is used only with `status: blocked`. |
| Evidence use | Checks, tests, sources, or probes are used as evidence when relevant. |
| Topology preservation | Explicit CLI or same-runtime choices are preserved. |
| Discussion signal topology | "讨论", "辩论", "discuss", or "debate" signals select heterogeneous CLI agents unless external CLIs are explicitly disabled or blocked. |
| Agent launch boundary | External CLI startup uses `cli-launch`; `cli-launch` is not used to decide whether to debate. |
| Phase-aware timeout | External CLI proposal generation uses the longer proposal timeout and is not marked `failed/no_output` before the configured timeout without a concrete blocker. |
| Minimality | No broad entry gate or unrelated non-debate method is introduced. |
| Blocker handling | Unavailable CLIs or permissions are recorded instead of silently ignored. |

## Failure Flags

- Uses `debate-router` for a task that did not explicitly request debate.
- Says debate is unnecessary after `debate-router` was explicitly invoked.
- Skips the required debate after explicit invocation.
- Leads the visible output with a full `DebateRoute:`/`DebateRecord:` YAML
  block instead of the human-first `Decision` / `Rationale` sections and
  final `Trace`.
- Replaces the human-first sections with YAML or appends a full `## Audit`
  section in the normal final answer.
- Replaces a caller-required output format, journal template, schema, checklist,
  or archive format with the default debate-router sections.
- Treats `Diary`, `relationship`, llmwiki, daily note, report, checklist,
  frontmatter, table, YAML, JSON, archive, review, re-review,复盘,归档,更新,整理,
  or 重审 tasks as open chat answers because the template was not pasted again.
- Adds `Decision`, `Rationale`, `Trace`, or `Archive` sections when the caller's
  fixed format did not provide a compatible place for them.
- Places `Trace` before `Dissent`, `Open Questions`, applicable `Next Step`,
  or `Archive` instead of keeping it as the final visible section.
- Omits selected, planned, launched, or attempted external CLIs from `Trace`.
- Omits a failed, blocked, or unavailable selected CLI from `Trace`.
- Collapses proposal-generation and debate-execution CLI participation into one
  ambiguous `Trace` phase when both phases used external CLIs.
- Produces visible output that contradicts the audit envelope (for example, a
  `Decision` or caller-format conclusion that does not match
  `final_recommendation`, or `Trace` rows that do not appear in the audit
  state).
- Omits the audit archive entirely (no retrievable audit record, and no
  `~/.debate-router/` archive path when the visible format allows one).
- Omits the final `DebateSummary` from the audit envelope.
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
- Uses `arbiter.decision: "blocked"` for a degraded partial debate instead of
  reserving it for `status: blocked`.
- Marks a run `completed` when proposal generation, CLI participation, archive,
  or evidence limitations should make it `degraded` or `blocked`.
- Lets a proposer be the sole critic validating its own proposal without
  recording the limitation.
- Decides by vote count, confidence, or consensus pressure.
- Launches or plans external CLIs without `cli-launch`.
- Treats `cli-launch` as a topology chooser or reasoning method.
- Treats a discussion/debate signal as current-session or same-runtime debate
  while external CLIs are available.
- Silently replaces a selected CLI that is blocked or unavailable.
- Marks an external CLI proposer `failed/no_output` after a short quiet period
  instead of waiting for the configured proposal-generation timeout or naming a
  concrete blocker.

## Passing Bar

A route is acceptable when:

- no failure flags apply,
- average score is at least 4,
- the entry case matches the input shape,
- required artifacts are present,
- explicit CLI selections are preserved,
- the arbiter decision is grounded in evidence, constraints, or next probes.
