# Method Card: `method-router`

## Purpose

Classify a task and choose the smallest sufficient method stack before the agent
starts working. Direct answering is a method choice, not a bypass.

## Use When

- The task could be solved by different workflows.
- An agent may otherwise answer directly without choosing a method.
- The user asks how an agent should approach a task.
- There is a risk of premature debate, premature editing, or unsupported claims.
- The user explicitly names, links, tags, or invokes a skill and the route must honor that request.

## Avoid When

- The next method is obvious, low risk, and already explicitly selected as
  `direct-answer` or `direct-execution`.
- The user explicitly asks for one narrow method.

## Inputs

- User task
- Constraints, available tools, risk level, and expected artifact
- Whether independent or heterogeneous agents are needed

## Outputs

- `RoutePlan`: task fingerprint, selected stack, execution topology, skipped
  methods, escalation conditions, expected artifacts, and next action
- Short RoutePlan by default: task type, selected stack, skipped methods,
  reason, and next step
- Each selected method must include a concrete selection reason.
- User-explicitly requested skills must be marked and handled directly, or the route must explain why they cannot be used.

## Composes With

- Every other card. `method-router` selects and orders them.
- `direct-answer`: selected only for trivial self-contained answers.
- `direct-execution`: selected only for one obvious low-risk local action.
- `answer-finalizer`: selected after long or noisy method work.

## Failure Modes

- Over-routing simple work into a heavy process.
- Letting direct answer bypass routing instead of selecting `direct-answer`.
- Selecting debate before evidence, probes, or validators.
- Producing a route without a concrete next artifact.
- Confusing multi-agent execution with a method stack.
- Ignoring a user-explicitly requested skill instead of using it as the method frame.

## Evaluation

- Route covers the main task risk.
- Route uses available verifiers.
- Route avoids unnecessary cards.
- Direct work is explicitly routed as `direct-answer` or `direct-execution`.
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

- `skills/method-router/SKILL.md`
