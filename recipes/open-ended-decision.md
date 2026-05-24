# Recipe: Open-Ended Decision

## Task Shape

Use this for strategy, product, architecture, positioning, planning, or tradeoff
questions where no single answer can be mechanically verified.

Common signals:

- multiple viable options
- subjective or strategic tradeoffs
- need for recommendation and rationale
- uncertainty about constraints or audience

## Method Stack

```text
work-gate
  -> multi-candidate-analysis
  -> structured-debate only if top candidates remain unresolved
  -> work-gate final answer
  -> work-gate change plan when execution begins
```

## Required Artifacts

- `RoutePlan`
- distinct proposals
- tradeoff table
- critique
- synthesized recommendation
- validation triggers
- concise final answer

## Do Not Do Too Early

- Do not produce one polished answer before exploring alternatives.
- Do not debate before concrete proposals exist.
- Do not average proposals into a vague compromise.

## Minimal Example

```text
Input:
How should I position this open-source agent skills repo?

Route:
multi-candidate-analysis -> work-gate final answer

Output:
CandidateAnalysis comparing "work gate", "method standard library", and
"method cards" positioning with rubric scoring, then selecting the strongest
public narrative.
```

## Success Criteria

- Proposals are genuinely different.
- The recommendation preserves a sharp point of view.
- Validation triggers explain what evidence would change the decision.
