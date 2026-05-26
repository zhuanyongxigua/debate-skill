# Method Cards Catalog

Method Cards are human-readable specs for Meta Method Skills.

Each card names one reusable method, defines when to use it, states when to
avoid it, and declares the artifact it should produce. Some cards are internal
`work-gate` modes rather than separate installable skills.

Cards can be composed into method stacks by the root meta skill,
`work-gate`.

## Card Index

| Card | Method type | Primary artifact |
| --- | --- | --- |
| [`work-gate`](work-gate.md) | Work-entry gate | RoutePlan |
| [`agent-dispatch`](agent-dispatch.md) | Execution topology helper for selected work-gate modes | AgentDispatchPlan |
| [`candidate-analysis`](candidate-analysis.md) | Internal work-gate candidate generation, comparison, and rubric evaluation | CandidateAnalysis |
| [`debate`](debate.md) | Internal work-gate debate and conflict resolution | DebateRecord |

`work-gate` also owns direct mode, change planning, candidate analysis, debate,
and final answer formatting as internal gate modes. They are not separate
installable skills.

## Routing Rules

Prefer the smallest card stack that controls the main risk:

- If the task is trivial and self-contained, or if one local low-risk action is
  enough, explicitly select `work-gate direct`, but do not treat it as the
  default route.
- If a project check exists, follow it before debate.
- If claims can be checked against sources, verify sources and citations.
- If code root cause is uncertain, localize before editing.
- If candidates already exist, use `work-gate candidate analysis` evaluation
  mode and skip generation.
- If the output is subjective, define a rubric before judging candidates.
- If there are no candidates yet and debate is requested, use
  `requirement_debate`: generate candidates, freeze them, then debate.
- If candidates conflict and no cheaper check can decide, use `work-gate debate`.
- If independent agents or external CLIs may be useful, use `agent-dispatch`
  inside the selected `work-gate` mode; do not treat it as a candidate method.
- If method work is long or noisy, use the work-gate final answer gate.

## Card Format

Use [`TEMPLATE.md`](TEMPLATE.md) for new cards.
