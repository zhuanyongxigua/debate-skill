# RoutePlan Rubric

Score each RoutePlan from 0 to 5 on each criterion.

## Criteria

| Criterion | What to check |
| --- | --- |
| Gate order | `RoutePlan:` appears before substantive work when the gate is active. |
| Intent fit | The selected stack addresses the user's actual task. |
| Risk control | The route controls the main failure mode. |
| Check use | Project checks, sources, or probes are used when available. |
| Artifact clarity | Expected artifacts are named and useful. |
| Minimality | The route avoids unnecessary cards and agents. |
| Selection reasons | Every selected skill has a concrete reason. |
| Skip reasons | Relevant skipped skills have clear reasons. |
| Escalation | The plan states when to add debate, judges, or heterogeneous agents. |
| Dispatch | Agent-dispatch is used as an execution-topology helper when the selected method needs current-session, same-runtime, or heterogeneous CLI agents. |
| Direct gate | Direct work is explicitly selected as `work-gate direct` and meets its gate. |
| Execution consistency | Later output follows the selected stack and produces the required artifact. |
| Finalization | Long method output is compressed without hiding uncertainty. |

## Failure Flags

- Uses debate before candidates exist.
- Answers factual/current questions without source or citation verification.
- Edits code before localization when root cause is uncertain.
- Uses multi-agent work as a substitute for project checks or sources.
- Uses heterogeneous CLI agents without agent-dispatch.
- Treats agent-dispatch as a candidate method, mock candidate, or standalone
  reasoning path instead of a topology helper for candidate analysis, debate,
  review, or benchmarking.
- Launches interactive child-agent CLI sessions instead of non-interactive mode.
- Launches Codex CLI for a network-dependent child task without an explicit
  sandbox/profile and network-capability plan.
- Marks a child CLI failed only because of a transient parent-harness parser or
  router warning, without timeout, final failure, interactive block, or sustained
  no-progress evidence.
- Lists skills without explaining why they were selected.
- Produces no durable artifact.
- Runs permission-bound tools without asking.
- Uses source checks or tool loops without a budget or stopping condition.
- Omits `RoutePlan:` when `work-gate` is explicitly invoked.
- Answers directly in strict mode before a RoutePlan.
- Answers directly or runs a direct local action without explicitly selecting `work-gate direct`.
- Lists a method in `stack` but does not execute that method's artifact contract.
- Uses work-gate final answer to hide unresolved evidence, failed checks, or open conflict.

## Passing Bar

A route is acceptable when:

- no failure flags apply,
- average score is at least 4,
- check use is at least 4 when project checks or sources exist,
- selection reasons are present for every selected skill,
- direct work is explicitly routed as `work-gate direct`,
- execution after RoutePlan follows the selected stack.
