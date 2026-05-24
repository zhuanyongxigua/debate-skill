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
method-router
  -> multi-proposal-synthesis
  -> multi-judge when a rubric is available
  -> structured-debate only if top candidates remain unresolved
  -> answer-finalizer
  -> edit-plan or hard-verifier when execution begins
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
multi-proposal-synthesis -> multi-judge -> answer-finalizer

Output:
DecisionMemo comparing "method router", "method standard library", and
"method cards" positioning, then selecting the strongest public narrative.
```

## Success Criteria

- Proposals are genuinely different.
- The recommendation preserves a sharp point of view.
- Validation triggers explain what evidence would change the decision.
