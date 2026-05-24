# Method Card: `work-gate`

## Purpose

Act as the work-entry gate for agent tasks. It turns method selection from
optional advice into a checkable protocol: emit a RoutePlan first, pass the
gate, then execute only the selected method stack.

Direct answering and direct tool use are allowed, but only when selected as
explicit methods.

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

Even when avoided, direct answer and direct execution should still be named
explicitly if a gate is already active.

## Inputs

- User task
- Explicitly requested skills or constraints
- Available tools, verifiers, evidence sources, and risk level
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

## Gate Pass Criteria

A RoutePlan passes only when:

- The first visible block is `RoutePlan:` when `work-gate` is explicitly invoked.
- `stack` names the selected method skills or direct method.
- `why` ties the stack to concrete task signals.
- `skipped` names relevant methods that are not selected.
- `topology` states the execution topology.
- `next` names the next expected artifact or action.
- Every selected method is actually executed afterward.

## Composes With

- Every other card. `work-gate` selects and orders them.
- `direct-answer`: selected only for simple self-contained answers.
- `direct-execution`: selected only for one obvious low-risk local action.
- `answer-finalizer`: selected after long or noisy method work.

## Failure Modes

- Producing advice about methods without emitting a RoutePlan.
- Treating `direct-answer` as a bypass instead of a selected method.
- Listing a method in `stack` but not producing its artifact.
- Selecting debate before evidence, probes, validators, or concrete candidates.
- Confusing multi-agent execution topology with a method stack.
- Ignoring a user-explicitly requested skill instead of using it as the method
  frame or explaining why it cannot be used.

## Evaluation

- RoutePlan appears before substantive work.
- Direct work is explicitly routed as `direct-answer` or `direct-execution`.
- Route covers the main task risk and uses available verifiers.
- Selected and skipped relevant methods have concrete reasons.
- The next artifact matches the first selected non-gate method.
- Execution follows the selected stack.
- Human reviewer would accept the chosen stack.

## Minimal Example

```yaml
RoutePlan:
  stack: [multipath-localization, hard-verifier, edit-plan]
  why: "Repo bug has uncertain auth root cause; probes can falsify guesses before edits."
  skipped: [structured-debate, direct-answer]
  topology: "single_agent"
  next: "PathCards"
```

## Skill Implementation

- `skills/work-gate/SKILL.md`
