# RoutePlan Rubric

Score each RoutePlan from 0 to 5 on each criterion.

## Criteria

| Criterion | What to check |
| --- | --- |
| Gate order | `RoutePlan:` appears before substantive work when the gate is active. |
| Intent fit | The selected stack addresses the user's actual task. |
| Risk control | The route controls the main failure mode. |
| Validator use | Hard verifiers, sources, or probes are used when available. |
| Artifact clarity | Expected artifacts are named and useful. |
| Minimality | The route avoids unnecessary cards and agents. |
| Selection reasons | Every selected skill has a concrete reason. |
| Skip reasons | Relevant skipped skills have clear reasons. |
| Escalation | The plan states when to add debate, judges, or heterogeneous agents. |
| Direct gate | Direct answers/actions are explicitly selected and meet their gates. |
| Execution consistency | Later output follows the selected stack and produces the required artifact. |
| Finalization | Long method output is compressed without hiding uncertainty. |

## Failure Flags

- Uses debate before candidates exist.
- Answers factual/current questions without retrieval.
- Edits code before localization when root cause is uncertain.
- Uses multi-agent work as a substitute for a verifier.
- Lists skills without explaining why they were selected.
- Produces no durable artifact.
- Runs permission-bound tools without asking.
- Uses search or tool loops without a budget or stopping condition.
- Omits `RoutePlan:` when `work-gate` is explicitly invoked.
- Answers directly in strict mode before a RoutePlan.
- Uses direct-answer or direct-execution without explicitly selecting it.
- Lists a method in `stack` but does not execute that method's artifact contract.
- Uses answer-finalizer to hide unresolved evidence, failed verification, or open conflict.

## Passing Bar

A route is acceptable when:

- no failure flags apply,
- average score is at least 4,
- validator use is at least 4 when a verifier exists,
- selection reasons are present for every selected skill,
- direct work is explicitly routed as `direct-answer` or `direct-execution`,
- execution after RoutePlan follows the selected stack.
