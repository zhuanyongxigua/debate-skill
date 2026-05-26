# Meta Method Skills

**Meta skills and routing rules for AI agents.**

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
done. The routing catalog records the method choices and artifacts that
`work-gate` can select.

- `skills/` contains the installable agent-facing skill implementations.
- `skills/work-gate/references/method-catalog.md` contains the routing catalog.
- `evals/` contains starter tasks and rubrics for measuring routing quality.

No runtime. No framework. No orchestration engine.

Just composable meta skills, a method catalog, and routing rules for choosing better
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

- answer directly or execute one obvious local action only when `work-gate
  direct` is explicitly selected
- verify sources and citations for factual claims
- localize before editing code
- produce a scoped change plan before risky code/file changes
- follow project-required checks when they exist
- use rubrics for judging
- debate only when concrete candidates conflict and no cheaper check can decide
- use the built-in final answer gate to compress long intermediate work

Debate is a bounded `work-gate` mode, not the default method.

## Strict Mode

Some agents skip method selection and answer directly. Use strict mode for those
agents:

```text
Use work-gate strict mode.
The first visible block must be RoutePlan:
Do not answer, edit, research, judge, critique, use tools, or debate before RoutePlan.
Direct answers and simple local tool actions are allowed only when the RoutePlan
selects work-gate direct.
Final answers after long method work should use the work-gate final answer gate.
Keep the RoutePlan under 7 lines.
Execute only the selected stack.
```

Default RoutePlan:

```yaml
RoutePlan:
  stack: [work-gate candidate analysis, work-gate]
  why: "Unclear repo bug; probes can falsify guesses before edits."
  skipped: [work-gate direct, work-gate debate]
  topology: "single_agent"
  next: "CandidateAnalysis"
```

## Quick Example

For an intermittent repo bug:

```text
Bad default:
  Jump to the first plausible file and patch it.

Better method stack:
  work-gate candidate analysis -> work-gate change plan

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
| Simple low-risk question | `work-gate direct` |
| One obvious local action | `work-gate direct` |
| Current factual answer | `work-gate` with source/citation constraints |
| Contest math or logic | `work-gate direct` for simple tasks, otherwise `work-gate` with explicit checks |
| Repo bug with unclear cause | `work-gate candidate analysis -> work-gate change plan` |
| Repo feature plan | `work-gate change plan` |
| Open-ended product or strategy decision | `work-gate candidate analysis -> work-gate final answer` |
| Creative naming or copy with many options | `work-gate candidate analysis -> work-gate final answer` |
| Subjective evaluation or ranking | `work-gate candidate analysis` in evaluation mode |
| Cross-agent review or explicit CLI agents | selected `work-gate` mode with `agent-launch` for concrete CLI startup |
| Concrete candidates still tied | `work-gate debate`; use `agent-launch` only if external CLI critics are selected |
| High-risk medical, legal, financial, safety, or compliance question | `work-gate` with source and human-review boundaries |
| Long or noisy intermediate work | `work-gate final answer` |

`work-gate direct` is a narrow fast path for simple, self-contained,
low-risk questions. It is not the default route.

## Meta Skills and Method Catalog

Each method is either an installable agent-facing `SKILL.md` or an internal
`work-gate` mode. The compact routing catalog lives in
[`skills/work-gate/references/method-catalog.md`](skills/work-gate/references/method-catalog.md).

The current core set is intentionally small: 2 installable skills. Candidate
analysis and debate are internal `work-gate` modes, not separate skills.

| Method | Use it for | Primary artifact |
| --- | --- | --- |
| [`work-gate`](skills/work-gate/SKILL.md) | Work-entry gate and method selection | RoutePlan |
| [`agent-launch`](skills/agent-launch/SKILL.md) | CLI launch helper for selected external agent CLIs, including env, sandbox, network, timeout, and redacted commands | AgentLaunchPlan |
| `work-gate candidate analysis` | Internal mode for multiple diagnosis paths, options, outputs, or plans | CandidateAnalysis |
| `work-gate debate` | Internal mode for requirement, single-proposal, candidate, or judgment debate | DebateRecord |

Built into `work-gate`: direct mode, change planning, source/check constraints,
candidate analysis, debate, and final answer formatting. These are gate modes,
not separate installable skills.

Built into `work-gate candidate analysis`: candidate generation and rubric
scoring. If candidates already exist, use evaluation mode and skip generation.

Built into `work-gate debate`: requirement debate, single-proposal debate,
candidate debate, and judgment debate. Existing candidates are frozen directly;
raw requirements generate candidates first, then debate only if useful.

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
evals/
  *.jsonl, *.md        route selection eval seed and rubric
```

## What This Is Not

This is not an agent framework.

It does not run agents, schedule tasks, manage memory, or replace coding tools.
It is a lightweight control layer for agent behavior: a way to name, choose, and
compose the methods an agent should use.

It is also not a prompt pack. A good method entry is not just a prompt; it
defines use and avoid conditions, required artifacts, composition rules, failure
modes, and evaluation hooks in the skill docs, routing catalog, or evals.

Debate is included, but it is not centered. Debate is a fallback for unresolved
conflicts between concrete candidates, not a default way to think.

## Multi-Agent Use

Multi-agent work is an execution topology, not a method by itself.

`work-gate` owns execution topology: current session, single external CLI,
same-runtime agents, or heterogeneous CLI agents.

Use `agent-launch` only after the user or selected parent method has already
chosen external CLI agents. It prepares or runs bounded non-interactive CLI
launches with shared provider defaults for environment isolation, sandbox,
network, timeout, stop policy, prompt transport, and redacted commands. It does
not decide whether CLI agents are worth using. Explicit user requests for named
CLIs should be preserved unless the selected CLI is unavailable, unsafe, or
blocked by permissions. For heterogeneous CLI work, the default selected pair
remains Claude Code first and Codex CLI second unless the user requested a
different set.

## Contributing

New methods should update the relevant `SKILL.md`, the work-gate method catalog,
and at least one eval when behavior changes.

## License

MIT. See [`LICENSE`](LICENSE).
