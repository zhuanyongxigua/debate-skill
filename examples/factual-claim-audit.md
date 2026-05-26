# Example: Factual Claim Audit

## User Task

Summarize what changed in the latest API pricing rules, with sources.

## Common Failure

The agent answers from memory, cites sources near the topic, and leaves several
material claims unsupported.

## RoutePlan

```yaml
RoutePlan:
  stack: [work-gate]
  why: "Latest factual answer needs sources; date and citation checks can catch stale claims."
  skipped: [work-gate direct, work-gate debate]
  topology: "single_agent"
  next: "source-check table"
```

## Better Workflow

1. Gather primary sources first.
2. Extract material claims.
3. Build a source-check table:
   - claim
   - supporting source
   - contradiction
   - confidence
   - action: keep, qualify, remove, investigate
4. Draft the final answer only from supported claims.

## Success Signal

Every material claim is supported, qualified, or removed, and dates are visible
where recency matters.
