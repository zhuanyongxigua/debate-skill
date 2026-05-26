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
gate may pass with `work-gate direct`. The `DirectResult` must state whether
the direct work is `kind: answer` or `kind: local_action`.

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

- `stack` names the selected method or `work-gate` mode.
- `why` ties the stack to concrete task signals, risks, evidence needs,
  validators, or expected artifacts.
- `skipped` names relevant methods that might be tempting but are not selected.
- `topology` states current-session single agent, single external CLI agent,
  same-runtime multi-agent, or heterogeneous CLI agents.
- `next` names the next artifact or action required by the selected stack.
- Direct answering and direct local tool execution appear only as
  `work-gate direct`.

If any criterion fails, stop and restart from `RoutePlan:`.

## Execution Contract

After the RoutePlan passes, execute only the selected stack. `work-gate` owns
the lightweight method modes directly; do not require the agent to jump to
separate candidate-analysis or debate skills.

Each selected method must produce or update its expected artifact:

- `work-gate direct` -> `DirectResult` with `kind: answer|local_action`
- `work-gate` change plan -> scoped file changes, validation commands, risks
- `work-gate final answer` -> concise result, rationale, risk, next action
- `work-gate candidate analysis` -> `CandidateAnalysis`
- `work-gate debate` -> `DebateRecord`
- `agent-launch` -> `AgentLaunchPlan` only as a CLI launch substep after the
  user or selected `work-gate` mode has chosen external CLI agents

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
3. Candidate analysis: independent diagnosis paths, decision options, existing
   candidate evaluation, or branch search.
4. Critique, self-refine, pre-mortem, or review.
5. Debate only when the debate entry case is explicit and checks/evidence cannot
   decide cheaply.

## Hard Routing Rules

- If the user explicitly names, links, tags, or invokes a skill or method mode,
  include that request in the RoutePlan and use its method frame to reason about
  the task.
- If an explicitly requested skill or mode is unavailable, irrelevant, or unsafe
  to use, say why in `skipped` or `why`, then choose the closest safe fallback.
- If the task is simple, low-risk, and self-contained, or if the next action is
  a simple, low-risk, obvious local tool action, select `work-gate direct`
  explicitly. Treat it as a narrow low-frequency fast path rather than the
  default route.
- Latest or factual claims require source checks or other evidence handling, but
  this is a work constraint rather than a separate skill.
- Repo debugging with uncertain root cause requires candidate analysis
  before work-gate change planning.
- Project-required tests, build checks, lint, schemas, or source checks outrank
  debate.
- High-risk medical, legal, financial, safety, security, or compliance work is
  not a dedicated skill here; route conservatively, require authoritative
  sources where applicable, and preserve human-review boundaries.
- Creative tasks usually do not need a dedicated method skill; generate options
  directly or use `work-gate candidate analysis` when candidate comparison is
  useful.
- Multi-agent work is an execution topology, not a substitute for retrieval,
  tests, schemas, or clear artifacts.
- Use `agent-launch` only after the user or selected method mode has chosen
  external CLI agents. Do not ask `agent-launch` to decide whether CLI agents
  are worth using, and do not treat it as a candidate method, mock candidate,
  or standalone answer path.
- If the user explicitly asks for Claude Code, Codex CLI, Copilot CLI, or other
  external CLI agents, preserve that launch intent unless the selected CLI is
  unavailable, unsafe, or blocked by permissions.
- For coding agent work, prefer independent diagnosis or patch candidates plus
  project checks before language debate.
- Do not mix different harnesses and different models unless the task is
  explicitly evaluating full-stack agent performance.

## Default Routing Table

| Task signal | Preferred stack |
| --- | --- |
| Simple low-risk answer | `work-gate direct` |
| Simple low-risk local tool action | `work-gate direct` |
| Math, logic, multiple choice | `work-gate direct` for simple tasks, otherwise `work-gate` with explicit checks |
| Factual research or citations | `work-gate` with source/citation constraints |
| Open strategy, product, business decision | `work-gate candidate analysis -> work-gate debate only if unresolved -> work-gate final answer` |
| Repo bug, uncertain root cause | `work-gate candidate analysis -> work-gate change plan` |
| Repo feature or architecture plan | `work-gate change plan -> work-gate candidate analysis evaluation mode or work-gate debate if tradeoffs conflict` |
| Single-file testable code | `work-gate direct` when obvious, otherwise `work-gate change plan` |
| Web, shell, browser, or tool operation | `work-gate direct` for one obvious step, otherwise plan the tool loop in the RoutePlan |
| Evaluation, ranking, review, judging | `work-gate candidate analysis` in evaluation mode |
| Cross-agent review, debate, or explicit CLI agents | selected `work-gate` mode with `agent-launch` for concrete CLI startup |
| Medical, legal, financial, safety, security, compliance | `work-gate` with conservative source and human-review boundaries |
| Puzzle, search, planning with backtracking | `work-gate` with explicit branch/check strategy |
| Long, noisy, multi-candidate, or executive output | `work-gate final answer` after the selected method stack |
| Skill/method selection | `work-gate` |

## Execution Topology

Choose execution topology after choosing the method stack.

- Use `single_agent` when the task is simple, tool-bound, or has a strong
  project check.
- Use `single_external_cli_agent` when the user or selected parent mode has
  chosen exactly one external CLI agent. Preserve explicit named-CLI requests
  unless the selected CLI is unavailable, unsafe, or blocked by permissions.
- Use `same_runtime_multi_agent` when independent candidates, judges, critics,
  or path generators are useful and heterogeneity is not required.
- When the user explicitly asks for external CLI agents, or when the selected
  method sets `topology: single_external_cli_agent` or
  `topology: heterogeneous_cli_agents`, use `agent-launch` for the concrete
  non-interactive CLI startup plan. Do not use `agent-launch` to decide whether
  the work should stay in the current session.
- For heterogeneous CLI work, prefer two selected CLIs by default: Claude Code
  first, Codex CLI second. Use non-interactive commands only. Add more CLIs only
  when the user explicitly asks.
- Do not use extra agents to replace a project check, source check, cheap probe,
  or user approval.

## Candidate Analysis Mode

Use `work-gate candidate analysis` when the task needs multiple candidates
before selecting, synthesizing, or planning.

Modes:

- `diagnosis`: unclear bug, failure, regression, performance issue, or system
  behavior. Generate 2-5 root-cause candidates with causal chains, evidence,
  negative evidence, probes, likely patch shape, risk, and confidence.
- `decision`: open-ended strategy, product, architecture, positioning, creative
  direction, or planning decision. Generate 2-5 proposals with goal fit,
  assumptions, tradeoffs, risks, cost, and validation triggers.
- `evaluation`: candidates already exist. Preserve them, normalize labels,
  define a rubric, score each candidate on the same criteria, then select,
  combine, split, defer, or escalate.

If candidates already exist, skip generation unless a missing baseline or
control candidate is needed. Do not generate new options just to make the
process look multi-path.

Return `CandidateAnalysis`. Use `references/candidate-analysis-template.md` for
the full artifact shape.

## Debate Mode

Use `work-gate debate` when the user asks for debate or when candidate analysis,
review, or external evidence leaves a meaningful unresolved conflict.

Select the debate entry case first:

- `requirement_debate`: no candidates exist. First generate 2-4 candidate
  positions or plans, freeze them, then debate only if the choice still matters.
- `single_proposal_debate`: one proposal exists. Freeze it and debate
  adopt/revise/reject/probe using support, opposition, risk, and testability
  views.
- `candidate_debate`: multiple proposals, paths, plans, answers, or patches
  already exist. Freeze the existing candidates and debate their conflicts
  without adding new candidates by default.
- `judgment_debate`: the artifact may be singular, but there are conflicting
  judgments or claims about it. Freeze those judgments as the debate candidates.

Select the debate style:

- `parallel_positions`: each side independently states a position first, then
  cross-reviews the others. Use for requirement debates and broad decisions.
- `proposal_attack`: one frozen proposal is attacked and defended. Use for
  single-proposal review.
- `frozen_candidates`: multiple existing candidates are cross-critiqued and
  arbitrated. Use when A/B/C already exist.

Debate gates:

- Use project checks, source checks, tests, schemas, calculators, or cheap
  probes before debate when they can decide.
- Do not use open-ended debate when a rubric evaluation is enough.
- Do not let critics rewrite frozen candidates during critique.
- Cross-review is required: each critic must inspect the other critic findings
  before arbitration.
- The arbiter decides from evidence, risk, reversibility, constraints, and probe
  availability. Do not decide by vote count, confidence, or consensus pressure.
- Cap the debate to one independent critique round, one cross-review round, and
  arbitration unless the user explicitly asks for more.

When the user asks whether to use debate, multi-agent, heterogeneous models, or
different CLI harnesses, select the relevant work mode and topology first. If
the selected topology uses external CLIs, use `agent-launch` for the startup
plan.

Return `DebateRecord`. Use `references/debate-protocol.md` for the full artifact
shape.

## Direct Mode

Use `work-gate direct` only for simple, low-risk work that can be answered or
acted on without a broader method stack.

For `kind: answer`, all are true:

- The task is simple, self-contained, and low risk.
- No current facts, citations, or external evidence are needed.
- No code/file changes or broad tool use are needed.
- No project check, calculation, source check, or other external feedback would
  materially improve the answer.
- No multiple plausible workflows need comparison.

For `kind: local_action`, all are true:

- The task is simple, local, and low risk.
- The next action is obvious.
- A short tool check or user-visible result can verify completion.
- Extra planning, debate, or multi-agent work would add more overhead than risk
  reduction.

Direct should be rare under strict mode. It is for genuinely small questions or
obvious local actions, not a way to avoid routing. If many broad, current,
ambiguous, project-dependent, or multi-step tasks are being routed to
`work-gate direct`, the gate is failing and must choose a non-direct stack
stack instead.

Return a `DirectResult`:

```yaml
DirectResult:
  kind: "answer|local_action"
  result: ""
  verification: ""
```

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
  stack: [work-gate direct]
  why: "Simple, self-contained, low-risk concept question."
  skipped: [work-gate candidate analysis, work-gate debate]
  topology: "single_agent"
  next: "DirectResult"
```

Bad:

```text
I will use candidate analysis.
Final answer: ...
```

Good:

```yaml
RoutePlan:
  stack: [work-gate candidate analysis, work-gate final answer]
  why: "Open-ended decision with multiple plausible positions and verbosity risk."
  skipped: [work-gate direct, work-gate debate]
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
- Read `references/candidate-analysis-template.md` when producing
  `CandidateAnalysis`.
- Read `references/debate-protocol.md` when producing `DebateRecord`.
- Read `references/route-plan-schema.md` when producing a formal RoutePlan.
- Read `references/evidence-index.md` when the user asks for the evidence behind
  a routing choice.
