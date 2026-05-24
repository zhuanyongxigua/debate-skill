---
name: direct-execution
description: Execute one obvious, low-risk local action after method-router explicitly selects direct-execution. Use for simple commands or tool actions with cheap confirmation; do not use for ambiguous, destructive, networked, credentialed, broad, or high-risk work.
---

# Direct Execution

## Overview

Use the shortest safe tool path for simple local work. Direct execution is a
method, not a bypass around routing or permission checks.

## Workflow

1. Confirm the Direct Execution Gate:
   - The task is simple, local, and low risk.
   - The next action is obvious.
   - The action is read-only or trivially reversible.
   - A short tool check or user-visible result can verify completion.

2. Run only the narrow action needed.

3. Verify the result when useful.

4. Report the result without extra method discussion.

## Safety Gate

- Prefer read-only local actions.
- Ask before network access, credentials, paid APIs, external CLIs, destructive writes, broad filesystem access, production systems, or long-running jobs.
- Stop and route again if the action reveals ambiguity, risk, or missing context.

## Avoid / Escalate

- Escalate to `method-router` when the task has multiple plausible workflows.
- Escalate to `react-reflexion` when the work needs multiple observe-act steps.
- Escalate to `hard-verifier` when the action result needs deterministic checking.
- Escalate to `edit-plan` before non-trivial file or code changes.

## Output

Return a `DirectExecutionRecord` with the action, result, verification if any,
and whether further routing is needed.

Read `references/direct-execution-template.md` when preserving an audit trail is useful.
