# Method Cards Catalog

Method Cards are human-readable specs for Meta Method Skills.

Each card names one reusable method, defines when to use it, states when to
avoid it, and declares the artifact it should produce. The installable
agent-facing implementations live in `../skills/`.

Cards can be composed into method stacks by the root meta skill,
`work-gate`.

## Card Index

| Card | Method type | Primary artifact |
| --- | --- | --- |
| [`work-gate`](work-gate.md) | Work-entry gate | RoutePlan |
| [`direct-answer`](direct-answer.md) | Direct answer | DirectAnswer |
| [`direct-execution`](direct-execution.md) | Direct execution | DirectExecutionRecord |
| [`hard-verifier`](hard-verifier.md) | Verification | VerificationRecord |
| [`multipath-localization`](multipath-localization.md) | Debugging / diagnosis | PathCards |
| [`edit-plan`](edit-plan.md) | Implementation planning | EditPlan |
| [`rag-claim-check`](rag-claim-check.md) | Evidence grounding | ClaimTable |
| [`self-consistency`](self-consistency.md) | Independent sampling | VoteRecord |
| [`multi-proposal-synthesis`](multi-proposal-synthesis.md) | Strategy synthesis | DecisionMemo |
| [`creative-curator`](creative-curator.md) | Creative generation | CreativeBoard |
| [`multi-judge`](multi-judge.md) | Rubric evaluation | JudgeScorecard |
| [`structured-debate`](structured-debate.md) | Conflict resolution | DebateRecord |
| [`high-risk-evidence`](high-risk-evidence.md) | High-stakes evidence | RiskMemo |
| [`tree-search`](tree-search.md) | Branch search | BranchTable |
| [`react-reflexion`](react-reflexion.md) | Tool loop | TrajectoryLog |
| [`answer-finalizer`](answer-finalizer.md) | Output control | FinalAnswer |

## Routing Rules

Prefer the smallest card stack that controls the main risk:

- If the task is trivial and self-contained, explicitly select direct-answer.
- If one local low-risk action is enough, explicitly select direct-execution.
- If a hard verifier exists, use it before debate.
- If claims can be checked against sources, retrieve and audit them.
- If code root cause is uncertain, localize before editing.
- If the output is subjective, define a rubric before judging.
- If there are no candidates yet, generate candidates before critique or debate.
- If candidates conflict and no cheaper check can decide, use structured debate.
- If method work is long or noisy, use answer-finalizer.

## Card Format

Use [`TEMPLATE.md`](TEMPLATE.md) for new cards.
