# Method Card: `task-router`

## Purpose

Classify a task and choose the smallest sufficient method stack before the agent
starts working.

## Use When

- The task could be solved by different workflows.
- The user asks how an agent should approach a task.
- There is a risk of premature debate, premature editing, or unsupported claims.
- The user explicitly names, links, tags, or invokes a skill and the route must honor that request.

## Avoid When

- The next method is obvious and low risk.
- The user explicitly asks for one narrow method.

## Inputs

- User task
- Constraints, available tools, risk level, and expected artifact
- Whether independent or heterogeneous agents are needed

## Outputs

- `RoutePlan`: task fingerprint, selected stack, execution topology, skipped
  methods, escalation conditions, expected artifacts, and next action
- Each selected method must include a concrete selection reason.
- User-explicitly requested skills must be marked and handled directly, or the route must explain why they cannot be used.

## Composes With

- Every other card. `task-router` selects and orders them.

## Failure Modes

- Over-routing simple work into a heavy process.
- Selecting debate before evidence, probes, or validators.
- Producing a route without a concrete next artifact.
- Confusing multi-agent execution with a method stack.
- Ignoring a user-explicitly requested skill instead of using it as the method frame.

## Evaluation

- Route covers the main task risk.
- Route uses available verifiers.
- Route avoids unnecessary cards.
- Each selected and skipped relevant card has an explicit reason.
- Human reviewer would accept the chosen stack.

## Minimal Example

```text
Input:
Users get intermittent 401s after login. Plan before editing.

Method:
Classify as repo debugging with uncertain root cause and available probes.

Output:
multipath-localization -> edit-plan -> hard-verifier
```

## Skill Implementation

- `skills/task-router/SKILL.md`
