---
name: work-gate
description: Mandatory work-entry gate. Required first visible step before answering, coding, researching, judging, critiquing, tool use, or debate when a task is non-trivial or this skill is explicitly invoked. Emit RoutePlan first, then execute only the selected method stack.
---

# Work Gate

## Overview

Use `work-gate` as the entry protocol for agent work. It selects the smallest
sufficient method stack, makes direct work explicit, and gives the rest of the
task a checkable artifact contract.

## Gate Protocol

This skill is a gate, not advice.

For non-trivial tasks, route before work. When `work-gate` is explicitly
invoked, strict mode is mandatory. The first visible block must be `RoutePlan:`.
Do not skip the gate by deciding the task is trivial. If the task is simple, the
gate may pass with `direct-answer` or `direct-execution`, but that direct method
must be selected explicitly.

No substantive answer, code edit, broad tool command, research synthesis,
critique, judgment, or debate may happen before the RoutePlan.

Default RoutePlan:

```yaml
RoutePlan:
  stack: []
  why: ""
  skipped: []
  topology: "single_agent"
  next: ""
```

Keep the default RoutePlan under 7 lines. Use the full schema only for audits,
evals, handoffs, or when the user asks for detail.

## Gate Pass Criteria

A RoutePlan passes only when all are true:

- `stack` names the selected method skills or direct method.
- `why` ties the stack to concrete task signals, risks, evidence needs,
  validators, or expected artifacts.
- `skipped` names relevant methods that might be tempting but are not selected.
- `topology` states single agent, same-runtime multi-agent, or heterogeneous CLI
  agents.
- `next` names the next artifact or action required by the selected stack.
- Direct answering appears only as `direct-answer`.
- Direct tool execution appears only as `direct-execution`.

If any criterion fails, stop and restart from `RoutePlan:`.

## Execution Contract

After the RoutePlan passes, execute only the selected stack.

Each selected method must produce or update its expected artifact:

- `direct-answer` -> `DirectAnswer`
- `direct-execution` -> `DirectExecutionRecord`
- `rag-claim-check` -> `ClaimTable`
- `self-consistency` -> `VoteRecord`
- `multipath-localization` -> `PathCards`
- `edit-plan` -> `EditPlan`
- `hard-verifier` -> `VerificationRecord`
- `multi-proposal-synthesis` -> `DecisionMemo`
- `creative-curator` -> `CreativeBoard`
- `multi-judge` -> `JudgeScorecard`
- `structured-debate` -> `DebateRecord`
- `high-risk-evidence` -> `RiskMemo`
- `tree-search` -> `BranchTable`
- `react-reflexion` -> `TrajectoryLog`
- `answer-finalizer` -> `FinalAnswer`

Do not list a method in `stack` unless you will follow its method frame. If the
selected stack becomes impossible or unnecessary, emit a revised RoutePlan
before changing methods.

## Self-Check

Before any substantive output, check:

- Did I emit `RoutePlan:` first?
- Did I select direct work explicitly if I am answering or acting directly?
- Did I explain why each selected method fits this task?
- Did I name relevant skipped methods and why they are skipped?
- Am I about to produce the artifact required by the selected method?

If not, stop and restart from `RoutePlan:`.

## Workflow

1. Emit the short `RoutePlan:` block first.
2. Check the RoutePlan against the Gate Pass Criteria.
3. Execute only the selected stack.
4. Produce the artifact required by the current method.
5. Emit a revised RoutePlan before switching methods.
6. Use `answer-finalizer` when intermediate method work would make the final
   response long, noisy, or process-heavy.

## Routing Priorities

Use this priority order unless the user explicitly asks otherwise:

1. Hard verifier, tool result, test, schema, calculator, or executable check.
2. External evidence, retrieval, citations, or authoritative source checking.
3. Task decomposition, route planning, implementation planning, or edit
   planning.
4. Independent candidate generation, multipath localization, or branch search.
5. Critique, self-refine, pre-mortem, or review.
6. Structured debate only when candidates conflict and cannot be resolved by
   evidence.

## Hard Routing Rules

- If the user explicitly names, links, tags, or invokes a skill, include that
  skill in the RoutePlan and use that skill's method frame to reason about the
  task.
- If an explicitly requested skill is unavailable, irrelevant, or unsafe to use,
  say why in `skipped` or `why`, then choose the closest safe fallback.
- If the task is simple, low-risk, and self-contained, select `direct-answer`
  explicitly.
- If the task is a simple, low-risk, obvious tool action, select
  `direct-execution` explicitly and add a cheap verifier when useful.
- Latest or factual claims require retrieval or evidence checking.
- Repo debugging with uncertain root cause requires multipath localization
  before edit planning.
- Hard verifiers outrank debate.
- High-risk medical, legal, financial, safety, security, or compliance work
  requires authoritative evidence and human review language.
- Creative tasks require generation and curation, not adversarial critique
  first.
- Multi-agent work is an execution topology, not a substitute for retrieval,
  tests, schemas, or clear artifacts.
- For reasoning or answer-selection tasks, compare against independent sampling
  and voting before using debate.
- For coding agent work, prefer independent diagnosis or patch candidates plus
  tests before language debate.
- Do not mix different harnesses and different models unless the task is
  explicitly evaluating full-stack agent performance.

## Default Routing Table

| Task signal | Preferred stack |
| --- | --- |
| Simple low-risk answer | `direct-answer` |
| Simple low-risk tool action | `direct-execution -> hard-verifier if useful` |
| Math, logic, multiple choice | `self-consistency -> hard-verifier` |
| Factual research or citations | `rag-claim-check -> hard-verifier` |
| Open strategy, product, business decision | `multi-proposal-synthesis -> multi-judge when a rubric is useful -> structured-debate only if top candidates remain unresolved -> answer-finalizer` |
| Creative writing, naming, copy | `creative-curator` |
| Repo bug, uncertain root cause | `multipath-localization -> hard-verifier -> edit-plan` |
| Repo feature or architecture plan | `edit-plan -> multi-judge or structured-debate if tradeoffs conflict -> hard-verifier` |
| Single-file testable code | `self-consistency -> hard-verifier` |
| Web, shell, browser, or tool operation | `react-reflexion -> hard-verifier` |
| Evaluation, ranking, review, judging | `multi-judge` |
| Medical, legal, financial, safety, security, compliance | `high-risk-evidence -> rag-claim-check -> multi-judge if useful` |
| Puzzle, search, planning with backtracking | `tree-search -> hard-verifier if available` |
| Long, noisy, multi-candidate, or executive output | `answer-finalizer` after the selected method stack |
| Skill/method selection | `work-gate` |

## Execution Topology

Choose execution topology after choosing the method stack.

- Use `single_agent` when the task is simple, tool-bound, or has a strong
  verifier.
- Use `same_runtime_multi_agent` when independent candidates, judges, critics,
  or path generators are useful and heterogeneity is not required.
- Use heterogeneous models in the same harness when model diversity is the
  variable being tested or weak models are used as critics/test writers rather
  than final voters.
- Use `heterogeneous_cli_agents` only when model/tool/harness diversity
  materially reduces risk, the user asks for it, or a benchmark/review requires
  cross-agent independence.
- Before using heterogeneous CLI agents, inspect what CLIs are available and ask
  the user for permission when commands need broader filesystem, network,
  credentials, or other elevated access.
- Do not use extra agents to replace a hard verifier, source check, cheap probe,
  or user approval.

## Debate Gate

Use structured debate only when all are true:

- There are at least two concrete candidates, paths, plans, or judgments.
- They conflict in a way that matters.
- A hard verifier, source check, or cheap probe cannot decide immediately.
- The cost of choosing wrong is meaningful.
- The debate can be capped to one critique round plus an arbiter.

Do not use debate to create the first candidates.

When the user asks whether to use debate, multi-agent, heterogeneous models, or
different CLI harnesses, read `references/debate-agent-policy.md`.

## Direct Gates

Use `direct-answer` only when all are true:

- The task is simple, self-contained, and low risk.
- No current facts, citations, or external evidence are needed.
- No code/file changes or broad tool use are needed.
- No hard verifier would materially improve the answer.
- No multiple plausible workflows need comparison.

Use `direct-execution` only when all are true:

- The task is simple, local, and low risk.
- The next action is obvious.
- A short tool check or user-visible result can verify completion.
- Extra planning, debate, or multi-agent work would add more overhead than risk
  reduction.

If any direct gate condition fails, select a non-direct method stack.

## Good And Bad Patterns

Bad:

```text
I can answer directly...
```

Good:

```yaml
RoutePlan:
  stack: [direct-answer]
  why: "Simple, self-contained, low-risk concept question."
  skipped: [rag-claim-check, structured-debate]
  topology: "single_agent"
  next: "DirectAnswer"
```

Bad:

```text
I will use multi-proposal-synthesis.
Final answer: ...
```

Good:

```yaml
RoutePlan:
  stack: [multi-proposal-synthesis, answer-finalizer]
  why: "Open-ended decision with multiple plausible positions and verbosity risk."
  skipped: [hard-verifier, structured-debate]
  topology: "single_agent"
  next: "DecisionMemo"
```

Then produce the `DecisionMemo`, not just a final answer.

## Output

For active gate tasks, the first output is always the short `RoutePlan:` block.
After that, output the artifact required by the selected method stack. If the
stack includes `answer-finalizer`, finish with a concise `FinalAnswer`.

## References

- Read `references/method-catalog.md` for method descriptions, selection rules,
  and compositions.
- Read `references/debate-agent-policy.md` for debate, ensemble, heterogeneous
  model, and harness-selection rules.
- Read `references/route-plan-schema.md` when producing a formal RoutePlan.
- Read `references/evidence-index.md` when the user asks for the evidence behind
  a routing choice.
