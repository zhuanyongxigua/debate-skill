# Method Card: `react-reflexion`

## Purpose

Run reason-act-observe loops and use observations to revise the plan during
tool-using tasks.

## Use When

- The task requires browser, shell, web, file, data, or environment interaction.
- External observations should update the next action.
- The workflow may fail and need reflection before retrying.

## Avoid When

- The answer can be produced from existing context without tool use.
- The action is destructive or high-risk without explicit approval.
- The loop is being used instead of a direct verifier.

## Inputs

- Goal
- Available tools
- Constraints, permissions, and stopping condition

## Outputs

- `TrajectoryLog`: plan, action, observation, reflection, revised plan, and
  completion evidence

## Composes With

- `hard-verifier`: turn observations into checks.
- `rag-claim-check`: gather sources with traceable evidence.
- `edit-plan`: execute or validate implementation steps.

## Failure Modes

- Continuing tool loops without a stopping condition.
- Ignoring observations that contradict the plan.
- Retrying the same failed action without reflection.

## Evaluation

- Every action has a purpose.
- Observations change the plan when warranted.
- Completion evidence is concrete.

## Minimal Example

```text
Input:
Inspect a local web app and verify the login flow.

Method:
Open page, act, observe UI state, adjust plan, record verification.

Output:
TrajectoryLog with final pass/fail evidence.
```

## Skill Implementation

- `skills/react-reflexion/SKILL.md`
