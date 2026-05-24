# Method Card: `answer-finalizer`

## Purpose

Compress long or multi-step method output into a concise final answer that keeps
only the decision-relevant result.

## Use When

- The method stack generated multiple candidates, critiques, or evidence tables.
- The model is likely to over-explain.
- The user needs a concise recommendation, answer, risk, and next action.
- Debate, judging, or synthesis produced a lot of intermediate material.

## Avoid When

- Evidence is missing or unresolved.
- A conflict still needs a verifier, source check, judge, or debate.
- The user explicitly asks for full reasoning, audit trail, or detailed alternatives.

## Inputs

- Prior method output
- User's requested level of detail
- Any final answer format constraints

## Outputs

- `FinalAnswer`: answer or recommendation, why, tradeoff/risk, and next action
  when useful

## Composes With

- `work-gate`: can add finalization when verbosity risk is high.
- `multi-proposal-synthesis`: compresses the decision memo into a final recommendation.
- `multi-judge`: summarizes the winning candidate and key disagreement.
- `structured-debate`: turns the debate record into a decision.
- `rag-claim-check`: keeps only supported claims in the final answer.

## Failure Modes

- Hiding uncertainty.
- Dropping a caveat that changes the decision.
- Making the answer look more certain than the method output supports.

## Evaluation

- The final answer is shorter than the intermediate output.
- It preserves the decision, reason, risk, and next step.
- It removes process recap and generic background.

## Minimal Example

```text
Input:
Three proposals, judge scores, and a debate record.

Method:
Keep only the selected recommendation, why, risk, and next action.

Output:
FinalAnswer.
```

## Skill Implementation

- `skills/answer-finalizer/SKILL.md`
