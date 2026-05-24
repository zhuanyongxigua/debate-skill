# Example: Repo Debugging 401

## User Task

Users sometimes get `401` after login. Give me a plan before editing code.

## Common Failure

The agent jumps to the first plausible auth file and patches middleware before
it has localized the root cause.

## RoutePlan

```yaml
RoutePlan:
  stack: [multipath-localization, hard-verifier, edit-plan]
  why: "Intermittent auth bug with uncertain root cause; probes can falsify guesses before edits."
  skipped: [direct-answer, structured-debate, heterogeneous_cli_agents]
  topology: "single_agent"
  next: "PathCards"
```

## Better Workflow

1. Generate PathCards:
   - Token refresh bug
   - Cookie domain or `SameSite` mismatch
   - CSRF/session mismatch
   - Session store race
2. Run cheap probes:
   - inspect `Set-Cookie`
   - check refresh timing
   - reproduce with server logs
   - add a focused regression test
3. Select the best-supported path.
4. Produce an EditPlan with validation commands.

## Success Signal

The final plan names files, tests, and rollback steps only after a path has
stronger evidence than its alternatives.
