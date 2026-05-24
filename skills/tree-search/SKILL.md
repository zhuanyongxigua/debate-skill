---
name: tree-search
description: Branch expansion, intermediate evaluation, pruning, and backtracking for search-like reasoning. Use for puzzles, planning problems, constraint satisfaction, complex strategy exploration, multi-step reasoning where early choices can trap the model, and tasks better solved by exploring a tree than by one chain or debate.
---

# Tree Search

## Overview

Explore multiple branches with explicit state evaluation. Prefer search when the task has intermediate states and early mistakes can make a single chain fail.

## Workflow

1. Define state:
   - Current partial solution
   - Remaining constraints
   - Goal test
   - Invalid-state test

2. Expand candidate branches.

3. Evaluate each branch:
   - Validity
   - Progress toward goal
   - Constraint satisfaction
   - Cost
   - Risk of dead end

4. Prune low-scoring branches and expand promising ones.

5. Backtrack when the current path fails.

6. Verify final answer when possible.

## Search Budget

- Set a depth limit, branch limit, and stopping condition before expansion.
- Default to a small beam: expand 2-4 promising branches per depth unless the task requires exhaustive search.
- Stop when a goal test passes, all viable branches fail, a hard verifier decides, or further expansion repeats equivalent states.
- Record pruned branches and why so backtracking is auditable.

## Avoid / Escalate

- Avoid this skill for simple single-step tasks or tasks with no explicit state, constraints, or branching choices.
- Escalate to `hard-verifier` when a goal test, solver, calculator, schema, or executable check exists.
- Escalate to `multi-proposal-synthesis` for open-ended strategy where branches are proposals rather than search states.
- Escalate to user approval before exploring actions that are destructive, permission-bound, or costly.

## Output

Return a `BranchTable` with search state, constraints, expanded branches, validity and scores, pruned branches, backtracks, final path, and verifier result when available.

Read `references/branch-schema.md` for a reusable branch table.
