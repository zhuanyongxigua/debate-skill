# Method Card: `multi-candidate-analysis`

## Purpose

Generate or evaluate multiple candidates before selecting a path, proposal, or
recommendation. If candidates already exist, skip generation and score them
with a rubric.

## Use When

- A repo/system bug has unclear root cause.
- A strategy, product, architecture, positioning, or creative decision has
  multiple plausible options.
- The user already has multiple outputs, plans, proposals, patches, reviews, or
  answers and wants them evaluated or ranked.
- The first plausible answer could anchor the result too early.
- The user needs alternatives, tradeoffs, probes, or validation triggers before
  committing.

## Avoid When

- The task is simple, self-contained, and low risk.
- A project check, source check, or explicit user rule can decide directly.
- There is only one obvious candidate and the risk of being wrong is low.

## Inputs

- User task
- Constraints, symptoms, available context, evidence, and project checks
- Optional existing candidates
- Mode: `diagnosis`, `decision`, or `evaluation`

## Outputs

- `CandidateAnalysis`: mode, candidates, comparison table or scorecard,
  selected candidate or synthesis, skipped candidates, unresolved questions, and
  next action

## Composes With

- `work-gate`: selects the mode and converts the selected candidate into a
  direct action or change plan.
- `agent-dispatch`: decides current session, same-runtime agents, or
  heterogeneous CLI agents when independent candidates or scoring need external
  agents.
- `structured-debate`: resolves unresolved conflict between top candidates.
- `work-gate final answer`: compresses the analysis into a concise recommendation.

## Failure Modes

- Candidates differ only in wording.
- Diagnosis candidates do not include falsifiable probes.
- Decision candidates omit tradeoffs or validation triggers.
- Evaluation mode invents new options when the task was to judge existing
  candidates.
- Rubric scores are not tied to evidence or task constraints.
- Synthesis averages away the meaningful disagreement.

## Evaluation

- Candidates are genuinely distinct.
- Comparison criteria match the task.
- Existing candidates are preserved and judged on the same rubric.
- Selected candidate is better supported than skipped candidates.
- Next action is concrete and compatible with the selected mode.

## Minimal Example

```text
Input:
Users intermittently get 401 after login.

Mode:
diagnosis

Output:
CandidateAnalysis with token refresh, cookie domain, CSRF/session mismatch, and
session race candidates, plus probes to distinguish them.
```

## Skill Implementation

- `skills/multi-candidate-analysis/SKILL.md`
