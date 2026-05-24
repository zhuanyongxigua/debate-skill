# Method Card: `edit-plan`

## Purpose

Turn a selected requirement or localization path into an executable plan before
code changes.

## Use When

- The task requires repo-level edits.
- Multiple files, APIs, tests, migrations, or rollout concerns are involved.
- A user asks for a plan before implementation.

## Avoid When

- Root cause is still unclear. Run `multipath-localization` first.
- The change is trivial and the target file is already obvious.

## Inputs

- Feature request, selected `PathCard`, repo orientation, constraints, and risk
  level

## Outputs

- `EditPlan`: goal, non-goals, current behavior, desired behavior, files and
  symbols, implementation order, validation commands, risks, rollback, and open
  questions

## Composes With

- `multipath-localization`: plan from a selected root-cause path.
- `hard-verifier`: attach validation commands.
- `multi-judge`: review alternative plans with a rubric.

## Failure Modes

- Planning before diagnosis.
- Omitting validation commands.
- Writing a plan that depends on unstated context.

## Evaluation

- Another agent could execute the plan without prior discussion.
- Each milestone is independently verifiable.
- Risks and rollback are explicit for high-impact changes.

## Minimal Example

```text
Input:
Selected PathCard: cookie domain mismatch causes login cookie not to persist.

Method:
Plan config change, regression test, and rollout validation.

Output:
EditPlan with files, order, test commands, and rollback.
```

## Skill Implementation

- `skills/edit-plan/SKILL.md`
