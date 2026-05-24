---
name: multi-candidate-analysis
description: Generate, evaluate, compare, and synthesize multiple candidates before choosing one. Use for unclear repo/system diagnosis, open-ended strategy, architecture, product, positioning, creative option selection, rubric-based evaluation of existing candidates, and any task where the first plausible answer may anchor the result.
---

# Multi Candidate Analysis

## Overview

Generate or evaluate multiple candidates before selecting one. Use `mode:
diagnosis` for root-cause/path localization, `mode: decision` for options,
strategy, architecture, positioning, or creative direction, and `mode:
evaluation` when candidates already exist and should be scored with a rubric.

The shared method is the same: make candidates comparable, score or critique
them against task-specific criteria, then select, combine, split, or defer with
a concrete next action. If the user already provided candidates, do not generate
new ones unless a missing baseline or control candidate is needed.

## Modes

### Diagnosis Mode

Use when there is a symptom, failure, regression, performance issue, unclear
repo bug, or uncertain system behavior.

Each candidate should include:

- hypothesis
- causal chain from symptom to likely source
- candidate files, functions, configs, data flows, or jobs
- supporting evidence
- negative evidence
- probe or falsification check
- expected minimal patch shape
- risk and confidence

### Decision Mode

Use when there is no single correct answer and the user needs a recommendation
across options.

Each candidate should include:

- proposal or option
- goal fit
- constraints and assumptions
- tradeoffs
- risks and failure modes
- cost or effort
- validation trigger: what evidence would change the decision

### Evaluation Mode

Use when there are already multiple outputs, plans, proposals, reviews, patches,
or answers and the task is to evaluate, rank, review, or choose among them.

Each evaluation should include:

- normalized candidate IDs, preserving original labels where possible
- task-specific rubric criteria
- disqualifiers or must-pass constraints
- criterion scores or qualitative grades
- evidence for each score
- disagreements, ties, or calibration needs
- aggregate ranking and winner, if justified

When independence matters, use `agent-dispatch` to decide whether to stay in the
current session, use same-runtime agents, or launch heterogeneous CLI agents.
`agent-dispatch` should prefer heterogeneous CLI agents for robust independent
review when model/tool/harness diversity matters.

## Workflow

1. Select `mode: diagnosis`, `mode: decision`, or `mode: evaluation`.
2. If candidates are missing, generate 2-5 independent candidates. Use 3 by
   default.
3. If candidates already exist, skip generation and normalize them into a shared
   comparison shape.
4. Define task-specific criteria or a rubric before scoring.
5. Score, critique, or rank candidates against those criteria.
6. Decide:
   - select one candidate,
   - combine compatible candidates,
   - split into milestones,
   - or escalate to `structured-debate` if top candidates remain tied after
     scoring and no cheaper check can decide.
7. Hand implementation work back to `work-gate` as a change plan when code or
   file edits are needed.

## Avoid / Escalate

- Avoid this skill when the task is simple, low risk, and one answer is enough.
- Avoid this skill when a project check, source check, or user-specified rule can
  decide directly.
- Avoid diagnosis mode when there is no symptom or root-cause question.
- Avoid decision mode when the root cause must be localized before options make
  sense.
- Use evaluation mode, not a separate skill, when candidates already exist and a
  rubric-based ranking would improve selection.
- Escalate to `structured-debate` only after concrete candidates exist and remain
  unresolved after cheaper checks or rubric scoring.

## Output

Return a `CandidateAnalysis` with mode, candidate list, comparison or scorecard,
selected candidate or synthesis, skipped candidates and why, unresolved
questions, calibration needs when judging, and the next action.

Read `references/candidate-analysis-template.md` for the durable template.
