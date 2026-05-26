# Example: Repo Debugging 401

## User Task

Users sometimes get `401` after login. Give me a plan before editing code.

## Common Failure

The agent jumps to the first plausible auth file and patches middleware before
it has localized the root cause.

## RoutePlan

```yaml
RoutePlan:
  stack: [work-gate candidate analysis, work-gate]
  why: "Intermittent auth bug with uncertain root cause; localize before writing a change plan."
  skipped: [work-gate direct, work-gate debate, heterogeneous_cli_agents]
  topology: "single_agent"
  next: "CandidateAnalysis"
```

## Better Workflow

1. Generate a `CandidateAnalysis` in `mode: diagnosis`:
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
4. Produce a work-gate change plan with validation commands.

## Success Signal

The final plan names files, tests, and rollback steps only after a path has
stronger evidence than its alternatives.
