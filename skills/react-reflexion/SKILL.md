---
name: react-reflexion
description: Reason-act-observe loops plus failure reflection for tool-using agents. Use for web/browser tasks, shell workflows, data gathering, debugging with commands, multi-step environment interaction, task automation, and cases where external observations should update the plan.
---

# ReAct Reflexion

## Overview

Use the environment as feedback. Alternate planned action, observation, and plan update; after failure, write a concise reflection before retrying.

## Workflow

1. State the current goal and next observable checkpoint.

2. Choose one action:
   - Browser navigation
   - Shell command
   - Search
   - File inspection
   - API call
   - Test run

3. Observe the result. Do not assume success.

4. Update the plan:
   - What changed?
   - What is now ruled out?
   - What is the next cheapest useful action?

5. On failure, write a short reflection:
   - Failed action
   - Likely cause
   - New constraint
   - Next attempt

6. Verify final state with `hard-verifier` when possible.

## Safety Gate

- Prefer read-only and reversible actions first.
- Ask for permission before network requests, credential use, paid APIs, external CLIs, destructive file operations, production systems, or actions that affect user accounts.
- Do not continue a tool loop after an action reveals sensitive data unless the user requested that scope and it is necessary.

## Budget And Stop Conditions

- Set a checkpoint before each action and stop when the checkpoint is reached.
- Retry a failed action at most twice unless the user asks for deeper automation.
- Stop when two consecutive actions add no new information, when the next action is destructive or permission-bound, or when a hard verifier gives a decisive result.

## Avoid / Escalate

- Avoid this skill for pure offline reasoning where tools cannot change the answer.
- Escalate to `hard-verifier` for final checks and deterministic validation.
- Escalate to `high-risk-evidence` before tool actions that affect medical, legal, financial, safety, security, compliance, or irreversible decisions.

## Output

Return a `TrajectoryLog` with goal, checkpoints, action-observation steps, plan updates, short failure reflections, final state, and verification evidence.

Read `references/trajectory-template.md` when preserving an audit trail matters.
