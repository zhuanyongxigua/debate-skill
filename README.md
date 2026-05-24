# Meta Method Skills

**Meta skills and method cards for AI agents.**

Agents often fail before they start.

They debate when they should verify.  
They edit when they should localize.  
They answer from memory when they should retrieve.  
They judge by taste when they should use a rubric.  
They give one polished answer when they should generate alternatives.

Meta Method Skills help agents choose the method before they choose the answer.

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

Method selection is the missing layer in many agent workflows.

```text
Task
  -> Method stack
  -> Artifacts
  -> Verifier or review
```

The root meta skill is `method-router`.

It chooses the smallest sufficient method stack:

- answer directly only when direct answer is explicitly selected
- execute one obvious action only when direct execution is explicitly selected
- retrieve evidence for factual claims
- sample independently for single-answer reasoning
- localize before editing code
- write an edit plan before risky changes
- run hard verifiers when they exist
- use rubrics for judging
- debate only when concrete candidates conflict and no cheaper check can decide
- finalize long intermediate work into concise answers

Debate is a method card, not the default method.

## Strict Mode

Some agents skip method selection and answer directly. Use strict mode for those
agents:

```text
Use method-router strict mode.
Route before work.
Direct answers are allowed only when selected as direct-answer.
Direct tool actions are allowed only when selected as direct-execution.
Keep the RoutePlan under 12 lines.
After the selected method stack, use answer-finalizer if the output is noisy.
```

## Quick Example

For an intermittent repo bug:

```text
Bad default:
  Jump to the first plausible file and patch it.

Better method stack:
  multipath-localization -> hard-verifier -> edit-plan

Why:
  The root cause is uncertain.
  Cheap probes can falsify guesses.
  The edit plan should come after localization.

Debate:
  Not yet. Use it only if the top paths remain tied after probes.
```

The full machine-readable `RoutePlan` schema lives in
[`skills/method-router/references/route-plan-schema.md`](skills/method-router/references/route-plan-schema.md).

## Common Routes

| Task | Default route |
| --- | --- |
| Simple low-risk question | `direct-answer` |
| One obvious local action | `direct-execution` |
| Current factual answer | `rag-claim-check -> hard-verifier` |
| Contest math or logic | `self-consistency -> hard-verifier` |
| Repo bug with unclear cause | `multipath-localization -> hard-verifier -> edit-plan` |
| Repo feature plan | `edit-plan -> hard-verifier` |
| Open-ended product or strategy decision | `multi-proposal-synthesis -> multi-judge -> answer-finalizer` |
| Creative naming or copy | `creative-curator` |
| Subjective evaluation or ranking | `multi-judge` |
| Concrete candidates still tied | `structured-debate`, capped and evidence-based |
| High-risk medical, legal, financial, safety, or compliance question | `high-risk-evidence -> rag-claim-check` |
| Long or noisy intermediate work | `answer-finalizer` |

## Meta Skills and Method Cards

Each method has two layers:

1. A **Method Card**: the human-readable spec.
2. A **Skill Implementation**: the installable agent-facing `SKILL.md`.

| Method | Use it for | Primary artifact |
| --- | --- | --- |
| [`method-router`](method-cards/method-router.md) | Selecting the method stack | RoutePlan |
| [`direct-answer`](method-cards/direct-answer.md) | Simple self-contained answers | DirectAnswer |
| [`direct-execution`](method-cards/direct-execution.md) | One obvious low-risk local action | DirectExecutionRecord |
| [`hard-verifier`](method-cards/hard-verifier.md) | Tests, schemas, calculators, compilers, source checks | VerificationRecord |
| [`multipath-localization`](method-cards/multipath-localization.md) | Unclear code/system root causes | PathCards |
| [`edit-plan`](method-cards/edit-plan.md) | Planning repo changes before editing | EditPlan |
| [`rag-claim-check`](method-cards/rag-claim-check.md) | Factual work with sources | ClaimTable |
| [`self-consistency`](method-cards/self-consistency.md) | Independent attempts and aggregation | VoteRecord |
| [`multi-proposal-synthesis`](method-cards/multi-proposal-synthesis.md) | Open-ended strategy and tradeoffs | DecisionMemo |
| [`creative-curator`](method-cards/creative-curator.md) | Creative generation and selection | CreativeBoard |
| [`multi-judge`](method-cards/multi-judge.md) | Rubric-based evaluation | JudgeScorecard |
| [`structured-debate`](method-cards/structured-debate.md) | Resolving unresolved candidate conflicts | DebateRecord |
| [`high-risk-evidence`](method-cards/high-risk-evidence.md) | Medical, legal, finance, safety, compliance | RiskMemo |
| [`tree-search`](method-cards/tree-search.md) | Branching search and backtracking | BranchTable |
| [`react-reflexion`](method-cards/react-reflexion.md) | Tool-using observe/act loops | TrajectoryLog |
| [`answer-finalizer`](method-cards/answer-finalizer.md) | Concise final answers after method work | FinalAnswer |

## Recipes

Recipes compose cards into common agent workflows:

- [`coding-bug-fix`](recipes/coding-bug-fix.md): localize before editing
- [`factual-claim-audit`](recipes/factual-claim-audit.md): retrieve, extract, audit, remove unsupported claims
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

Start with one strong agent unless independence changes the result. Use
same-runtime multi-agent runs for cheap independent candidates, judges, or
critics. Use heterogeneous CLI agents only when model/tool diversity is a real
requirement; inspect available CLIs first and ask the user before running
external tools that need extra permissions.

## Contributing

New method cards should follow the [Method Card template](method-cards/TEMPLATE.md).

A good card is not just a prompt. It has clear use/avoid conditions, a named
artifact, composition rules, failure modes, and at least one evaluation hook.

## License

MIT. See [`LICENSE`](LICENSE).
