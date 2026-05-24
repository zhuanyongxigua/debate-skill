# Method Card: `direct-execution`

## Purpose

Execute one obvious, low-risk local action with cheap confirmation after the
router explicitly selects direct execution.

## Use When

- The next action is obvious.
- The task is local, low risk, and reversible or read-only.
- One command or tool action can satisfy the request.
- The result can be confirmed immediately.

## Avoid When

- The action needs network, credentials, paid APIs, production access, broad file access, or destructive writes.
- The task is ambiguous or has multiple possible workflows.
- The task requires repo-wide changes, research, judging, or debate.

## Inputs

- User task
- Current working context
- Permission constraints

## Outputs

- `DirectExecutionRecord`: action, result, verification if any, and whether
  further routing is needed

## Composes With

- `work-gate`: must select direct-execution when routing is required.
- `hard-verifier`: verifies the result when a cheap check exists.
- `react-reflexion`: takes over when the work becomes multi-step.

## Failure Modes

- Treating an ambiguous task as obvious.
- Running permission-bound tools without approval.
- Continuing after the first action reveals new risk.

## Evaluation

- The action was narrow and safe.
- The result is visible or verified.
- The agent stopped instead of expanding into a workflow without routing again.

## Minimal Example

```text
Input:
Show me the current git status.

Method:
Run git status.

Output:
DirectExecutionRecord with the status result.
```

## Skill Implementation

- `skills/direct-execution/SKILL.md`
