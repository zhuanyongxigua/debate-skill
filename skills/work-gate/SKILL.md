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
gate may pass with `work-gate direct answer` for simple answers or a `work-gate`
direct local action for simple tool work.

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
- Direct answering appears only as `work-gate direct answer`.
- Direct tool execution is handled as a `work-gate` direct local action, not as a
  separate skill.

If any criterion fails, stop and restart from `RoutePlan:`.

## Execution Contract

After the RoutePlan passes, execute only the selected stack.

Each selected method must produce or update its expected artifact:

- `work-gate direct answer` -> `ConciseAnswer`
- `work-gate` direct local action -> user-visible local result
- `work-gate` change plan -> scoped file changes, validation commands, risks
- `work-gate final answer` -> concise result, rationale, risk, next action
- `agent-dispatch` -> `AgentDispatchPlan`
- `multi-candidate-analysis` -> `CandidateAnalysis`
- `structured-debate` -> `DebateRecord`

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
6. Use the built-in final answer gate when intermediate method work would make
   the final response long, noisy, or process-heavy.

## Routing Priorities

Use this priority order unless the user explicitly asks otherwise:

1. Project-required checks, tool results, tests, schemas, calculators, source
   checks, or executable feedback.
2. Task decomposition, route planning, implementation planning, or edit
   planning.
3. Independent candidate generation, diagnosis paths, decision options, or branch search.
4. Critique, self-refine, pre-mortem, or review.
5. Structured debate only when candidates conflict and cannot be resolved by
   checks or evidence.

## Hard Routing Rules

- If the user explicitly names, links, tags, or invokes a skill, include that
  skill in the RoutePlan and use that skill's method frame to reason about the
  task.
- If an explicitly requested skill is unavailable, irrelevant, or unsafe to use,
  say why in `skipped` or `why`, then choose the closest safe fallback.
- If the task is simple, low-risk, and self-contained, select
  `work-gate direct answer` explicitly, but treat it as a narrow low-frequency
  fast path rather than the default route.
- If the task is a simple, low-risk, obvious local tool action, use `work-gate`
  as the direct local action gate and check the visible result when useful.
- Latest or factual claims require source checks or other evidence handling, but
  this is a work constraint rather than a separate skill.
- Repo debugging with uncertain root cause requires multi-candidate diagnosis
  before work-gate change planning.
- Project-required tests, build checks, lint, schemas, or source checks outrank
  debate.
- High-risk medical, legal, financial, safety, security, or compliance work is
  not a dedicated skill here; route conservatively, require authoritative
  sources where applicable, and preserve human-review boundaries.
- Creative tasks usually do not need a dedicated method skill; generate options
  directly or use `multi-candidate-analysis` when candidate comparison is useful.
- Multi-agent work is an execution topology, not a substitute for retrieval,
  tests, schemas, or clear artifacts.
- Use `agent-dispatch` whenever the route needs to decide between current
  session, same-runtime agents, or heterogeneous CLI agents.
- For coding agent work, prefer independent diagnosis or patch candidates plus
  project checks before language debate.
- Do not mix different harnesses and different models unless the task is
  explicitly evaluating full-stack agent performance.

## Default Routing Table

| Task signal | Preferred stack |
| --- | --- |
| Simple low-risk answer | `work-gate direct answer` |
| Simple low-risk local tool action | `work-gate direct action` |
| Math, logic, multiple choice | `work-gate direct answer` for simple tasks, otherwise `work-gate` with explicit checks |
| Factual research or citations | `work-gate` with source/citation constraints |
| Open strategy, product, business decision | `multi-candidate-analysis -> structured-debate only if top candidates remain unresolved -> work-gate final answer` |
| Repo bug, uncertain root cause | `multi-candidate-analysis -> work-gate change plan` |
| Repo feature or architecture plan | `work-gate change plan -> multi-candidate-analysis evaluation mode or structured-debate if tradeoffs conflict` |
| Single-file testable code | `work-gate direct action` when obvious, otherwise `work-gate change plan` |
| Web, shell, browser, or tool operation | `work-gate direct action` for one obvious step, otherwise plan the tool loop in the RoutePlan |
| Evaluation, ranking, review, judging | `multi-candidate-analysis` in evaluation mode |
| Cross-agent review, debate, or CLI agent choice | `agent-dispatch -> selected method` |
| Medical, legal, financial, safety, security, compliance | `work-gate` with conservative source and human-review boundaries |
| Puzzle, search, planning with backtracking | `work-gate` with explicit branch/check strategy |
| Long, noisy, multi-candidate, or executive output | `work-gate final answer` after the selected method stack |
| Skill/method selection | `work-gate` |

## Execution Topology

Choose execution topology after choosing the method stack.

- Use `single_agent` when the task is simple, tool-bound, or has a strong
  project check.
- Use `same_runtime_multi_agent` when independent candidates, judges, critics,
  or path generators are useful and heterogeneity is not required.
- Use `agent-dispatch` for any non-trivial decision about current session versus
  same-runtime agents versus heterogeneous CLI agents.
- When `agent-dispatch` selects heterogeneous CLI agents, prefer two CLIs by
  default: Claude Code first, Codex CLI second. Use non-interactive commands
  only. Add more CLIs only when the user explicitly asks.
- Do not use extra agents to replace a project check, source check, cheap probe,
  or user approval.

## Debate Gate

Use structured debate only when all are true:

- There are at least two concrete candidates, paths, plans, or judgments.
- They conflict in a way that matters.
- A project check, source check, or cheap probe cannot decide immediately.
- The cost of choosing wrong is meaningful.
- The debate can be capped to one critique round plus an arbiter.

Do not use debate to create the first candidates.

When the user asks whether to use debate, multi-agent, heterogeneous models, or
different CLI harnesses, route through `agent-dispatch`.

## Direct Gates

Use `work-gate direct answer` only when all are true:

- The task is simple, self-contained, and low risk.
- No current facts, citations, or external evidence are needed.
- No code/file changes or broad tool use are needed.
- No project check, calculation, source check, or other external feedback would
  materially improve the answer.
- No multiple plausible workflows need comparison.

Direct answer should be rare under strict mode. It is for genuinely small
questions, not a way to avoid routing. If many broad, current, ambiguous,
project-dependent, or multi-step tasks are being routed to
`work-gate direct answer`, the gate is failing and must choose a non-direct
method stack instead.

Use a `work-gate` direct local action only when all are true:

- The task is simple, local, and low risk.
- The next action is obvious.
- A short tool check or user-visible result can verify completion.
- Extra planning, debate, or multi-agent work would add more overhead than risk
  reduction.

If any direct gate condition fails, select a non-direct method stack.

## Final Answer Gate

Use `work-gate final answer` after the selected method stack when the prior work
is long, multi-candidate, debate/review-heavy, or likely to include process
recap. This is an output gate inside `work-gate`, not a separate skill.

The final answer should keep only:

- decision, answer, or recommendation
- main reason or evidence
- material risk, uncertainty, or tradeoff
- next concrete action when useful

Do not use finalization to hide missing evidence, failed checks, unresolved
candidate conflicts, or important uncertainty. If those remain, say so briefly
instead of compressing them away.

## Good And Bad Patterns

Bad:

```text
I can answer directly...
```

Good:

```yaml
RoutePlan:
  stack: [work-gate direct answer]
  why: "Simple, self-contained, low-risk concept question."
  skipped: [multi-candidate-analysis, structured-debate]
  topology: "single_agent"
  next: "ConciseAnswer"
```

Bad:

```text
I will use multi-candidate-analysis.
Final answer: ...
```

Good:

```yaml
RoutePlan:
  stack: [multi-candidate-analysis, work-gate final answer]
  why: "Open-ended decision with multiple plausible positions and verbosity risk."
  skipped: [work-gate direct answer, structured-debate]
  topology: "single_agent"
  next: "CandidateAnalysis"
```

Then produce the `CandidateAnalysis`, not just a final answer.

## Output

For active gate tasks, the first output is always the short `RoutePlan:` block.
After that, output the artifact required by the selected method stack. If the
stack includes `work-gate final answer`, finish with a concise answer instead
of process recap.

## References

- Read `references/method-catalog.md` for method descriptions, selection rules,
  and compositions.
- Read `references/debate-agent-policy.md` for debate, ensemble, heterogeneous
  model, and harness-selection background.
- Read `references/route-plan-schema.md` when producing a formal RoutePlan.
- Read `references/evidence-index.md` when the user asks for the evidence behind
  a routing choice.
