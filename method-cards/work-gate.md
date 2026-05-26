# Method Card: `work-gate`

## Purpose

Act as the work-entry gate for agent tasks. It turns method selection from
optional advice into a checkable protocol: emit a RoutePlan first, pass the
gate, then execute only the selected method stack.

Direct answering and direct local tool use are allowed through one internal
mode, `work-gate direct`, but only when selected explicitly by the gate. Direct
is a narrow low-frequency fast path, not the default.

## Use When

- The user explicitly invokes `work-gate`.
- The task could be solved by different workflows.
- An agent may otherwise answer directly without choosing a method.
- There is a risk of premature debate, premature editing, unsupported claims, or
  verbose unfocused output.
- The user names, links, tags, or invokes a skill and the route must honor that
  request.
- You need an audit trail for why a method stack was chosen.

## Avoid When

- A previous RoutePlan has already selected a method and the current step is
  simply executing that method.
- The user explicitly requests one narrow method and no routing decision remains.

Even when avoided, direct mode should still be named explicitly if a gate is
already active.

## Inputs

- User task
- Explicitly requested skills or constraints
- Available tools, project checks, evidence sources, and risk level
- Whether independent or heterogeneous agents are needed

## Outputs

- Short `RoutePlan` by default:
  - `stack`
  - `why`
  - `skipped`
  - `topology`
  - `next`
- Full RoutePlan only for audits, evals, handoffs, or requested detail.
- Revised RoutePlan when the selected method stack becomes impossible or
  unnecessary.
- Built-in final answer gate when prior method work is long or noisy.

## Gate Pass Criteria

A RoutePlan passes only when:

- The first visible block is `RoutePlan:` when `work-gate` is explicitly invoked.
- `stack` names the selected method skill or `work-gate` mode.
- `why` ties the stack to concrete task signals.
- `skipped` names relevant methods that are not selected.
- `topology` states the execution topology.
- `next` names the next expected artifact or action.
- Every selected method is actually executed afterward.

## Composes With

- Every other card. `work-gate` selects and orders them.
- `agent-launch`: CLI launch helper used after a selected mode or explicit user
  request chooses one or more external CLI agents.
- `work-gate candidate analysis`: internal mode for diagnosis, decision, and
  evaluation.
- `work-gate debate`: internal mode for requirement, single-proposal, candidate,
  and judgment debate.
- `work-gate direct`: selected only for simple self-contained answers or one
  obvious low-risk local action.
- Work-gate final answer gate: selected after long or noisy method work.

## Failure Modes

- Producing advice about methods without emitting a RoutePlan.
- Treating `work-gate direct` as a bypass instead of a selected method.
- Routing broad, ambiguous, current, or project-dependent work to direct
  too often.
- Listing a method in `stack` but not producing its artifact.
- Using final answer formatting to hide missing evidence, failed checks, or
  unresolved conflict.
- Selecting debate before evidence, probes, validators, or concrete candidates.
- Confusing multi-agent execution topology with a method stack.
- Treating `agent-launch` as a candidate method or topology chooser.
- Launching external CLI agents without an explicit `agent-launch` plan.
- Ignoring a user-explicitly requested skill instead of using it as the method
  frame or explaining why it cannot be used.

## Evaluation

- RoutePlan appears before substantive work.
- Direct work is explicitly routed as `work-gate direct`.
- Direct mode is used only for simple low-risk self-contained questions or one
  obvious low-risk local action.
- Route covers the main task risk and uses available project checks.
- Agent execution topology is selected by `work-gate`; external CLI startup
  goes through `agent-launch` when single external CLI or heterogeneous CLI
  agents are selected.
- Selected and skipped relevant methods have concrete reasons.
- The next artifact matches the first selected non-gate method.
- Execution follows the selected stack.
- Long method work is compressed into a concise final answer without losing
  material risk or uncertainty.
- Human reviewer would accept the chosen stack.

## Minimal Example

```yaml
RoutePlan:
  stack: [work-gate candidate analysis, work-gate]
  why: "Repo bug has uncertain auth root cause; localize before writing a change plan."
  skipped: [work-gate debate, work-gate direct]
  topology: "single_agent"
  next: "CandidateAnalysis"
```

## Skill Implementation

- `skills/work-gate/SKILL.md`
