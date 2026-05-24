---
name: edit-plan
description: Produce executable implementation plans before code edits. Use for repo-level coding, feature implementation, bug fixes after localization, architecture changes, migrations, Claude/Codex plan-mode work, and any task that needs file-level changes, validation commands, non-goals, risks, and rollback before execution.
---

# Edit Plan

## Overview

Turn a selected localization path or feature requirement into an implementation spec that an executor can follow without inheriting all prior discussion.

## Workflow

1. Confirm the plan is not premature:
   - If root cause is unclear, run `multipath-localization` first.
   - If the task is trivial and file target is obvious, produce a lightweight plan.
   - If high-risk migration/security/data changes are involved, include rollback and staged validation.

2. Produce an EditPlan:
   - Goal
   - Non-goals
   - Current behavior
   - Desired behavior
   - Repo orientation
   - Files and symbols to modify
   - Proposed changes by file
   - API/data/type/config changes
   - Implementation order
   - Validation commands
   - Risks
   - Rollback
   - Open questions

3. Keep every milestone independently verifiable.

4. Add tests before or alongside behavior changes when risk warrants it.

5. Do not execute code edits unless the user or surrounding workflow requests implementation.

## Avoid / Escalate

- Avoid full EditPlan overhead for simple, low-risk, obvious one-file changes; use a concise plan or direct execution with validation.
- Escalate to `multipath-localization` when root cause, file ownership, or current behavior is uncertain.
- Escalate to `high-risk-evidence` or user approval when the plan touches production data, credentials, billing, security, compliance, or irreversible migrations.
- Do not use an EditPlan as evidence that the implementation is correct; hand off to `hard-verifier` for tests, builds, typechecks, or probes.

## Output

Return a concise plan for small tasks and a full plan for repo-level or risky tasks. Read `references/edit-plan-template.md` for the durable template.
