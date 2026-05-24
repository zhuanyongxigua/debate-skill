# Example: Factual Claim Audit

## User Task

Summarize what changed in the latest API pricing rules, with sources.

## Common Failure

The agent answers from memory, cites sources near the topic, and leaves several
material claims unsupported.

## RoutePlan

```yaml
RoutePlan:
  stack: [rag-claim-check, hard-verifier]
  why: "Latest factual answer needs sources; date and citation checks can catch stale claims."
  skipped: [direct-answer, structured-debate]
  topology: "single_agent"
  next: "ClaimTable"
```

## Better Workflow

1. Retrieve primary sources first.
2. Extract material claims.
3. Build a ClaimTable:
   - claim
   - supporting source
   - contradiction
   - confidence
   - action: keep, qualify, remove, investigate
4. Draft the final answer only from supported claims.

## Success Signal

Every material claim is supported, qualified, or removed, and dates are visible
where recency matters.
