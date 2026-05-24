---
name: multi-judge
description: Rubric-based independent judging and aggregation. Use for evaluating, ranking, reviewing, scoring, or comparing multiple outputs; LLM-as-a-judge workflows; open-ended response evaluation; PR/code review support; proposal selection; and subjective tasks where multiple independent assessments are useful.
---

# Multi Judge

## Overview

Evaluate with a rubric before aggregation. Keep judges independent, shuffle positions when comparing outputs, and separate scoring from synthesis.

## Workflow

1. Write the rubric:
   - Criteria
   - Scale
   - Disqualifiers
   - Required evidence
   - Weighting

2. Prepare blind inputs:
   - Remove model/source identity when possible.
   - Randomize order for pairwise comparisons.
   - Keep the same context for each judge.

3. Run independent judges:
   - Correctness judge
   - Completeness judge
   - Clarity judge
   - Risk judge
   - User-intent judge

4. Aggregate:
   - Average numeric scores only after checking disqualifiers.
   - Summarize disagreements.
   - Prefer evidence-backed judgments over confidence.

5. Calibrate with human review when the result will guide high-stakes action.

## Execution Topology

- Use 3-5 independent judges for balanced evaluations; use fewer only when budget is tight and the rubric is simple.
- Prefer same-runtime fresh sessions or subagents when available so judges do not see each other's reasoning.
- If independent agents are unavailable, run sequential isolated judge passes, hide prior judgments, and mark independence as lower.
- Use heterogeneous CLI agents only when model/tool diversity is part of the requirement or the user explicitly asks for cross-agent review.

## Avoid / Escalate

- Avoid judging before candidate artifacts and a rubric exist.
- Avoid this skill when a hard verifier, source check, or cheap probe can decide the issue directly.
- Escalate to `structured-debate` only when top candidates remain tied after rubric scoring and no cheaper check can decide.
- Escalate to `high-risk-evidence` when the judgment affects regulated, safety, medical, legal, financial, or irreversible action.

## Output

Return a `JudgeScorecard` with the rubric, blind ordering, independent judgments, criterion scores, evidence, concerns, aggregate winner or ranking, disagreements, and calibration needs.

Read `references/rubric-schema.md` for the scorecard format.
