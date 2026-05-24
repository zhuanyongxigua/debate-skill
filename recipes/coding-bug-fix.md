# Recipe: Coding Bug Fix

## Task Shape

Use this when a user reports a repo or system bug and the root cause is not
already proven.

Common signals:

- intermittent failures
- auth, cache, state, data-flow, config, or timing issues
- failing tests with unclear source
- multiple plausible files or modules
- user asks for a plan before editing

## Method Stack

```text
work-gate
  -> multipath-localization
  -> hard-verifier
  -> edit-plan
  -> hard-verifier
  -> answer-finalizer when the plan is long
```

## Required Artifacts

- `RoutePlan`
- `PathCards`
- probe or test results
- selected path
- `EditPlan`
- validation commands
- concise final recommendation when useful

## Do Not Do Too Early

- Do not edit the first plausible file.
- Do not debate before PathCards exist.
- Do not write a large plan before root cause is narrowed.

## Minimal Example

```text
Input:
Users sometimes get 401 after login.

Route:
multipath-localization -> hard-verifier -> edit-plan

PathCards:
- token refresh bug
- cookie domain or SameSite mismatch
- CSRF/session mismatch
- session store race

Verifier:
Inspect Set-Cookie behavior and add a regression test for the selected path.

Output:
EditPlan with scoped file changes and validation commands.
```

## Success Criteria

- The selected path explains the symptom better than alternatives.
- A cheap probe or test supports the selected path.
- The implementation plan is small, ordered, and verifiable.
