# Method Card: `multi-judge`

## Purpose

Evaluate candidates with independent rubric-based judgments and aggregate the
results.

## Use When

- Multiple outputs, plans, proposals, or answers need ranking.
- The task is subjective but can be scored with a rubric.
- You want review diversity without open-ended debate.

## Avoid When

- A hard verifier can decide correctness.
- There is only one candidate and no rubric.
- The rubric is vague or changes during scoring.

## Inputs

- Candidate artifacts
- Rubric, weights, constraints, and evaluation context

## Outputs

- `JudgeScorecard`: independent scores, rationales, disagreements, aggregate result,
  and recommended follow-up

## Composes With

- `multi-proposal-synthesis`: judge proposals before synthesis.
- `edit-plan`: review competing implementation plans.
- `creative-curator`: evaluate creative finalists.
- `structured-debate`: resolve high-value disagreements after judging.

## Failure Modes

- Judges reuse the same reasoning instead of independent criteria.
- Rubric is too vague to constrain judgment.
- Aggregation hides important disagreement.

## Evaluation

- Scores map to explicit rubric criteria.
- Disagreements are visible.
- Final ranking is reproducible enough to audit.

## Minimal Example

```text
Input:
Three README openings for the same repo.

Method:
Score each against clarity, differentiation, audience fit, and credibility.

Output:
JudgeScorecard with aggregate ranking and improvement notes.
```

## Skill Implementation

- `skills/multi-judge/SKILL.md`
