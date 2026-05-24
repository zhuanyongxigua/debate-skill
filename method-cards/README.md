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
| [`agent-dispatch`](agent-dispatch.md) | Agent execution topology | AgentDispatchPlan |
| [`multi-candidate-analysis`](multi-candidate-analysis.md) | Candidate generation, comparison, and rubric evaluation | CandidateAnalysis |
| [`structured-debate`](structured-debate.md) | Conflict resolution | DebateRecord |

`work-gate` also owns direct answer, direct local action, change planning, and
final answer formatting as internal gate modes. They are not separate cards.

## Routing Rules

Prefer the smallest card stack that controls the main risk:

- If the task is trivial and self-contained, explicitly select work-gate direct
  answer, but do not treat it as the default route.
- If one local low-risk action is enough, select a work-gate direct local action.
- If a project check exists, follow it before debate.
- If claims can be checked against sources, verify sources and citations.
- If code root cause is uncertain, localize before editing.
- If candidates already exist, use multi-candidate-analysis evaluation mode and
  skip generation.
- If the output is subjective, define a rubric before judging candidates.
- If there are no candidates yet, generate candidates before critique or debate.
- If candidates conflict and no cheaper check can decide, use structured debate.
- If independent agents or external CLIs may be useful, use agent-dispatch.
- If method work is long or noisy, use the work-gate final answer gate.

## Card Format

Use [`TEMPLATE.md`](TEMPLATE.md) for new cards.
