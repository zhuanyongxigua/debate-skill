---
name: multi-proposal-synthesis
description: Generate independent proposals, critique them structurally, synthesize a decision memo, and define validation triggers. Use for open-ended strategy, product decisions, business analysis, architecture direction, planning, tradeoff analysis, and non-code decisions without a single correct answer.
---

# Multi Proposal Synthesis

## Overview

Use independent options before critique. The goal is not to pick the most persuasive proposal; it is to expose assumptions, tradeoffs, risks, and next validation actions.

## Workflow

1. Frame the problem:
   - Goal
   - Constraints
   - Non-goals
   - Success metric
   - Unacceptable outcomes

2. Generate 3-5 independent proposals. Each proposal must include:
   - Name
   - Core judgment
   - Assumptions
   - Steps
   - Benefits
   - Risks
   - Cost/time
   - Failure conditions
   - Biggest uncertainty

3. Critique proposals without rewriting them:
   - Missing constraint
   - Fragile assumption
   - Failure mode
   - Cheaper or more reversible alternative

4. Synthesize:
   - Recommended option or hybrid
   - Excluded options and why
   - Risks
   - Validation actions
   - Switch triggers

5. Run a pre-mortem for high ambiguity or high cost:
   - Assume the recommendation failed.
   - Identify the most likely failure causes.
   - Add mitigations or validation experiments.

## Avoid / Escalate

- Avoid this skill for tasks with a single correct answer, direct hard verifier, or simple obvious action.
- Escalate to `multi-judge` when a rubric is useful for selecting among final proposals.
- Escalate to `structured-debate` only after distinct proposals exist, rubric judging is insufficient, and no cheaper validation can decide.
- Escalate to `hard-verifier` when proposals make measurable claims or suggest validation experiments.

## Output

Return a decision memo, not a debate transcript. Use `references/decision-memo-template.md` when the output should be durable.
