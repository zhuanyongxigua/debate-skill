# Method Card: `multi-proposal-synthesis`

## Purpose

Generate independent proposals, critique their tradeoffs, and synthesize a
decision memo for open-ended work.

## Use When

- There is no single correct answer.
- Product, strategy, architecture, business, or planning tradeoffs matter.
- The user needs options before a recommendation.

## Avoid When

- A hard verifier or source check can decide the answer directly.
- The task is creative generation where curation matters more than decision.
- The user already chose a direction and needs an implementation plan.

## Inputs

- Decision prompt, constraints, goals, audience, and risk tolerance

## Outputs

- `DecisionMemo`: candidate proposals, tradeoff table, critique, synthesized
  recommendation, validation triggers, and open risks

## Composes With

- `multi-judge`: score proposals with a rubric.
- `structured-debate`: resolve unresolved conflict between top proposals.
- `edit-plan`: turn the chosen proposal into implementation steps.

## Failure Modes

- Proposals differ only in wording.
- Synthesis averages away the hard tradeoff.
- Recommendation omits validation triggers.

## Evaluation

- Proposals are genuinely distinct.
- Tradeoffs are explicit.
- Final recommendation says what would change the decision.

## Minimal Example

```text
Input:
Choose a launch strategy for a small developer tool.

Method:
Generate three independent strategies, critique each, synthesize one plan.

Output:
DecisionMemo with validation triggers.
```

## Skill Implementation

- `skills/multi-proposal-synthesis/SKILL.md`
