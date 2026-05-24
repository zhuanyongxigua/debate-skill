---
name: method-router
description: Required route-before-work skill for non-trivial tasks. Use before answering, coding, researching, judging, critiquing, or debating to choose the smallest sufficient method stack. Select direct-answer or direct-execution explicitly for simple low-risk work.
---

# Method Router

## Overview

Select the smallest sufficient method stack for the user's task. Treat routing as structured classification, evidence gathering, and planning; do not default to debate, voting, or all-skills loading.

## Mandatory Routing Contract

For every non-trivial task, route before solving.

The first artifact must be a concise RoutePlan unless the task is trivial. A
task is trivial only when all are true:

- No external or current evidence is needed.
- No code or file change is needed.
- No high-risk domain is involved.
- User intent is clear.
- There are no competing plausible workflows.
- The answer or action can be completed safely in one short response.

Direct answering is allowed only when the selected stack explicitly includes
`direct-answer`. Direct tool execution is allowed only when the selected stack
explicitly includes `direct-execution`.

Keep the default RoutePlan under 12 lines. Use the full schema only for audits,
evals, handoffs, or when the user asks for details.

## Strict Mode

Use strict mode when the user asks for it, when the model tends to skip routing,
or when task risk/ambiguity is medium or high.

In strict mode:

- Do not answer, edit files, run broad implementation commands, or start debate before the RoutePlan.
- Do not choose `direct-answer` or `direct-execution` unless the Direct gates pass.
- Execute only the selected stack after routing.
- Finish with `answer-finalizer` when the intermediate work is long, multi-candidate, or likely to produce noisy output.

## Routing Priorities

Use this priority order unless the user explicitly asks otherwise:

1. Hard verifier, tool result, test, schema, calculator, or executable check.
2. External evidence, retrieval, citations, or authoritative source checking.
3. Task decomposition, route planning, implementation planning, or edit planning.
4. Independent candidate generation, multipath localization, or branch search.
5. Critique, self-refine, pre-mortem, or review.
6. Structured debate only when candidates conflict and cannot be resolved by evidence.

## Workflow

1. Classify the task into a task fingerprint:
   - `task_type`
   - `artifact_type`
   - `needs_current_info`
   - `needs_external_evidence`
   - `has_hard_verifier`
   - `requires_codebase_context`
   - `requires_tool_use`
   - `needs_multi_agent`
   - `needs_heterogeneous_agents`
   - `risk_level`
   - `ambiguity_level`
   - `budget_preference`

2. Apply hard routing rules before subjective judgment:
   - If the user explicitly names, links, tags, or invokes a skill, include that skill in the RoutePlan and use that skill's method frame to reason about the task.
   - If an explicitly requested skill is unavailable, irrelevant, or unsafe to use, say why and choose the closest safe fallback.
   - If the task is simple, low-risk, and self-contained, select `direct-answer` explicitly.
   - If the task is a simple, low-risk, obvious tool action, select `direct-execution` explicitly and add a cheap verifier when useful.
   - Latest or factual claims require retrieval or evidence checking.
   - Repo debugging with uncertain root cause requires multipath localization before edit planning.
   - Hard verifiers outrank debate.
   - High-risk medical, legal, financial, safety, or compliance work requires authoritative evidence and human review language.
   - Creative tasks require generation and curation, not adversarial critique first.
   - Multi-agent work is an execution topology, not a substitute for retrieval, tests, schemas, or clear artifacts.
   - For reasoning or answer-selection tasks, compare against independent sampling and voting before using debate.
   - For coding agent work, prefer independent diagnosis or patch candidates plus tests before language debate.
   - Do not mix different harnesses and different models unless the task is explicitly evaluating full-stack agent performance.

3. Read `references/method-catalog.md` when the selected stack is not obvious.

4. Choose the execution topology after choosing the method stack:
   - Default to one strong agent when the task is simple, tool-bound, or easily verified.
   - Use same-runtime fresh sessions when independent candidates, judges, critics, or path generators are useful and heterogeneity is not a strong requirement.
   - Use heterogeneous models in the same harness when model diversity is the variable being tested or weak models are used as critics/test writers rather than final voters.
   - Use heterogeneous CLI agents only when model/tool/harness diversity materially reduces risk, the user asks for it, or a benchmark/review requires cross-agent independence.
   - Before using heterogeneous CLI agents, inspect what CLIs are available in the environment and ask the user for permission when commands need broader filesystem, network, credentials, or other elevated access.
   - Do not use extra agents to replace a hard verifier, source check, cheap probe, or user approval.
   - Treat different harnesses plus different models as a full-stack agent comparison, not as clean evidence that one model is better.

5. Generate up to 3 candidate method stacks only when ambiguity is medium or high:
   - Minimal stack
   - Robust verification stack
   - High-risk/conservative stack

6. Score candidate stacks with this rubric:
   - Covers user intent: 0-5
   - Matches task type: 0-5
   - Uses available validators: 0-5
   - Avoids unnecessary complexity: 0-3
   - Controls cost and latency: 0-3
   - Reduces main risk: 0-5
   - Produces clear artifacts: 0-3
   - Has fallback/escalation conditions: 0-3

7. Output a concise RoutePlan before solving. Use `references/route-plan-schema.md` for the short and full schemas.
   - Mark any user-explicitly requested skill as requested and explain how it shaped the route.
   - For every selected skill, state why it was selected for this task.
   - For every relevant skipped skill, state why it was not selected.
   - Tie reasons to concrete task signals, risks, validators, evidence needs, or artifact needs.
   - Do not list a skill without a selection reason.

## Default Routing Table

| Task signal | Preferred stack |
| --- | --- |
| Simple low-risk answer | `direct-answer` |
| Simple low-risk tool action | `direct-execution -> hard-verifier if useful` |
| Math, logic, multiple choice | `self-consistency -> hard-verifier` |
| Factual research or citations | `rag-claim-check -> hard-verifier` |
| Open strategy, product, business decision | `multi-proposal-synthesis -> multi-judge when a rubric is useful -> structured-debate only if top candidates remain unresolved` |
| Creative writing, naming, copy | `creative-curator` |
| Repo bug, uncertain root cause | `multipath-localization -> edit-plan -> hard-verifier` |
| Repo feature or architecture plan | `edit-plan -> multi-judge or structured-debate if tradeoffs conflict -> hard-verifier` |
| Single-file testable code | `self-consistency -> hard-verifier` |
| Web, shell, browser, or tool operation | `react-reflexion -> hard-verifier` |
| Evaluation, ranking, review, judging | `multi-judge` |
| Medical, legal, financial, compliance | `high-risk-evidence -> rag-claim-check -> multi-judge if useful` |
| Puzzle, search, planning with backtracking | `tree-search -> hard-verifier if available` |
| Long, noisy, multi-candidate, or executive output | `answer-finalizer` after the selected method stack |
| Skill/method selection | `method-router` |

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

## Direct Execution Gate

Use `direct-execution` only when all are true:

- The task is simple, local, and low risk.
- The next action is obvious.
- A short tool check or user-visible result can verify completion.
- Extra planning, debate, or multi-agent work would add more overhead than risk reduction.

## Direct Answer Gate

Use `direct-answer` only when all are true:

- The task is simple, self-contained, and low risk.
- No current facts, citations, or external evidence are needed.
- No code/file changes or broad tool use are needed.
- No hard verifier would materially improve the answer.
- No multiple plausible workflows need comparison.

If any condition fails, produce a RoutePlan and choose the smallest sufficient
method stack.

## Output

For normal routing tasks, output:

- Task fingerprint
- Selected stack
- Why this stack
- Why each selected skill was chosen
- Skipped skills and why
- Conditions that would escalate to another skill
- Execution topology
- Expected artifacts
- Immediate next action

If the user asked for implementation, continue into the selected stack after emitting a concise RoutePlan.

## References

- Read `references/method-catalog.md` for method descriptions, selection rules, and compositions.
- Read `references/debate-agent-policy.md` for debate, ensemble, heterogeneous model, and harness-selection rules.
- Read `references/route-plan-schema.md` when producing a formal RoutePlan.
- Read `references/evidence-index.md` when the user asks for the evidence behind a routing choice.
