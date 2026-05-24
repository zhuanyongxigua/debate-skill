# Meta Method Skills

**Meta skills and method cards for AI agents.**

Agents often fail before they start.

They debate when they should verify.  
They edit when they should localize.  
They answer from memory when they should retrieve.  
They judge by taste when they should use a rubric.  
They give one polished answer when they should generate alternatives.

Meta Method Skills help agents pass a work gate before they choose the answer.

> Do not ask only which model should answer. Ask which method the task needs.

## What This Is

This repo packages practical agent workflows as small, reusable **meta skills**.

Each meta skill helps an agent decide, guide, or structure how work should be
done. Each **Method Card** is the human-readable specification for one method.

- `skills/` contains the installable agent-facing skill implementations.
- `method-cards/` contains the human-facing method specs, contribution format,
  and public catalog.
- `recipes/` shows how cards compose into common workflows.
- `evals/` contains starter tasks and rubrics for measuring routing quality.

No runtime. No framework. No orchestration engine.

Just composable meta skills, method cards, and routing rules for choosing better
agent workflows.

## The Core Idea

Method selection is the missing layer in many agent workflows. The root skill is
not just a recommendation prompt; it is a work-entry protocol.

```text
Task
  -> RoutePlan
  -> Method stack
  -> Artifacts
  -> Project checks or review
```

The root meta skill is `work-gate`.

It emits a short `RoutePlan`, checks that the gate passes, then executes the
smallest sufficient method stack:

- answer directly only when direct answer is explicitly selected
- execute one obvious local action only when the work gate selects a direct local action
- verify sources and citations for factual claims
- localize before editing code
- produce a scoped change plan before risky code/file changes
- follow project-required checks when they exist
- use rubrics for judging
- debate only when concrete candidates conflict and no cheaper check can decide
- use the built-in final answer gate to compress long intermediate work

Debate is a method card, not the default method.

## Strict Mode

Some agents skip method selection and answer directly. Use strict mode for those
agents:

```text
Use work-gate strict mode.
The first visible block must be RoutePlan:
Do not answer, edit, research, judge, critique, use tools, or debate before RoutePlan.
Direct answers are allowed only when selected as work-gate direct answer.
Simple local tool actions are allowed only when the RoutePlan selects a work-gate direct local action.
Final answers after long method work should use the work-gate final answer gate.
Keep the RoutePlan under 7 lines.
Execute only the selected stack.
```

Default RoutePlan:

```yaml
RoutePlan:
  stack: [multi-candidate-analysis, work-gate]
  why: "Unclear repo bug; probes can falsify guesses before edits."
  skipped: [work-gate direct answer, structured-debate]
  topology: "single_agent"
  next: "CandidateAnalysis"
```

## Quick Example

For an intermittent repo bug:

```text
Bad default:
  Jump to the first plausible file and patch it.

Better method stack:
  multi-candidate-analysis -> work-gate change plan

Why:
  The root cause is uncertain.
  Cheap probes can falsify guesses.
  The change plan should come after localization.

Debate:
  Not yet. Use it only if the top paths remain tied after probes.
```

The full machine-readable `RoutePlan` schema lives in
[`skills/work-gate/references/route-plan-schema.md`](skills/work-gate/references/route-plan-schema.md).

## Common Routes

| Task | Default route |
| --- | --- |
| Simple low-risk question | `work-gate direct answer` |
| One obvious local action | `work-gate` direct local action |
| Current factual answer | `work-gate` with source/citation constraints |
| Contest math or logic | `work-gate direct answer` for simple tasks, otherwise `work-gate` with explicit checks |
| Repo bug with unclear cause | `multi-candidate-analysis -> work-gate` change plan |
| Repo feature plan | `work-gate` change plan |
| Open-ended product or strategy decision | `multi-candidate-analysis -> work-gate final answer` |
| Creative naming or copy with many options | `multi-candidate-analysis -> work-gate final answer` |
| Subjective evaluation or ranking | `multi-candidate-analysis` in evaluation mode |
| Cross-agent review or CLI agent choice | `agent-dispatch` |
| Concrete candidates still tied | `agent-dispatch -> structured-debate`, capped and evidence-based |
| High-risk medical, legal, financial, safety, or compliance question | `work-gate` with source and human-review boundaries |
| Long or noisy intermediate work | `work-gate final answer` |

`work-gate direct answer` is a narrow fast path for simple, self-contained,
low-risk questions. It is not the default route.

## Meta Skills and Method Cards

Each method has two layers:

1. A **Method Card**: the human-readable spec.
2. A **Skill Implementation**: the installable agent-facing `SKILL.md`.

The current core set is intentionally small: 4 installable skills.

| Method | Use it for | Primary artifact |
| --- | --- | --- |
| [`work-gate`](method-cards/work-gate.md) | Work-entry gate and method selection | RoutePlan |
| [`agent-dispatch`](method-cards/agent-dispatch.md) | Current session vs same-runtime agents vs heterogeneous CLI agents | AgentDispatchPlan |
| [`multi-candidate-analysis`](method-cards/multi-candidate-analysis.md) | Generate or evaluate multiple diagnosis paths, options, outputs, or plans | CandidateAnalysis |
| [`structured-debate`](method-cards/structured-debate.md) | Resolving unresolved candidate conflicts | DebateRecord |

Built into `work-gate`: direct answer, direct local action, change planning,
source/check constraints, and final answer formatting. These are gate modes, not
separate installable skills.

Built into `multi-candidate-analysis`: candidate generation and rubric scoring.
If candidates already exist, use evaluation mode and skip generation.

## Recipes

Recipes compose cards into common agent workflows:

- [`coding-bug-fix`](recipes/coding-bug-fix.md): localize before editing
- [`factual-claim-audit`](recipes/factual-claim-audit.md): verify sources, audit claims, remove unsupported claims
- [`open-ended-decision`](recipes/open-ended-decision.md): generate proposals, critique, synthesize, verify

## Examples

Examples show before/after routing for concrete tasks:

- [`repo-debugging-401`](examples/repo-debugging-401.md): localize intermittent auth failures before editing
- [`factual-claim-audit`](examples/factual-claim-audit.md): map current claims to sources before answering
- [`positioning-decision`](examples/positioning-decision.md): compare positioning options before recommending one

## Evals

The starter routing eval lives in [`evals/`](evals/):

- [`routing-tasks.jsonl`](evals/routing-tasks.jsonl): seed tasks with expected stacks and topology
- [`route-rubric.md`](evals/route-rubric.md): rubric for judging RoutePlans

## Project Layout

```text
skills/
  <skill-name>/        installable agent-facing meta skill implementations
    SKILL.md
    agents/
    references/
method-cards/
  *.md                 human-facing method card specs
recipes/
  *.md                 card compositions for common workflows
examples/
  *.md                 before/after routed examples
evals/
  *.jsonl, *.md        route selection eval seed and rubric
```

## What This Is Not

This is not an agent framework.

It does not run agents, schedule tasks, manage memory, or replace coding tools.
It is a lightweight control layer for agent behavior: a way to name, choose, and
compose the methods an agent should use.

It is also not a prompt pack. A good method card is not just a prompt; it
defines use and avoid conditions, required inputs, produced artifacts,
composition rules, failure modes, and evaluation hooks.

Debate is included, but it is not centered. Debate is a fallback for unresolved
conflicts between concrete candidates, not a default way to think.

## Multi-Agent Use

Multi-agent work is an execution topology, not a method by itself.

Use `agent-dispatch` when a task may need independent agents or external CLI
agents. It chooses current session, same-runtime agents, or heterogeneous CLI
agents. For heterogeneous CLI work, the default is two non-interactive CLIs:
Claude Code first and Codex CLI second. Add more CLIs only when explicitly
requested.

## Contributing

New method cards should follow the [Method Card template](method-cards/TEMPLATE.md).

A good card is not just a prompt. It has clear use/avoid conditions, a named
artifact, composition rules, failure modes, and at least one evaluation hook.

## License

MIT. See [`LICENSE`](LICENSE).
