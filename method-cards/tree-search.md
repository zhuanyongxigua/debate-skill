# Method Card: `tree-search`

## Purpose

Explore branching solution paths, evaluate intermediate states, prune weak
branches, and backtrack when early choices can trap the agent.

## Use When

- The task is a puzzle, constraint problem, planning problem, or multi-step
  strategy search.
- Early choices strongly affect later possibilities.
- A single chain of thought is likely to get stuck.

## Avoid When

- A hard verifier can directly solve the task.
- The task only needs independent samples rather than stateful branching.
- The search space is too large without pruning criteria.

## Inputs

- Initial state
- Goal condition
- Expansion rules
- Scoring or pruning criteria

## Outputs

- `BranchTable`: branches, intermediate scores, pruned paths, backtracks, chosen
  path, and verifier handoff

## Composes With

- `hard-verifier`: check candidate states or final answer.
- `self-consistency`: sample independent trees for small problems.
- `multi-judge`: evaluate branches when criteria are subjective.

## Failure Modes

- Expanding too many branches without pruning.
- Pruning based on weak heuristics.
- Losing track of state constraints.

## Evaluation

- Branch state is explicit.
- Pruning criteria are stated.
- Final path satisfies constraints or is handed to a verifier.

## Minimal Example

```text
Input:
Solve a scheduling puzzle with constraints.

Method:
Expand assignments, score constraint satisfaction, prune contradictions.

Output:
BranchTable with selected complete assignment.
```

## Skill Implementation

- `skills/tree-search/SKILL.md`
