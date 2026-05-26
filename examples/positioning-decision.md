# Example: Positioning Decision

## User Task

How should I position this open-source project?

## Common Failure

The agent gives one polished recommendation before exploring alternatives, then
defends it with generic marketing language.

## RoutePlan

```yaml
RoutePlan:
  stack: [work-gate candidate analysis, work-gate final answer]
  why: "Open-ended positioning decision needs alternatives, rubric scoring, and a concise recommendation."
  skipped: [work-gate direct, work-gate debate]
  topology: "same_runtime_multi_agent"
  next: "CandidateAnalysis"
```

## Better Workflow

1. Generate distinct frames:
   - work gate
   - method standard library
   - method cards deck
   - workflow linter
2. Judge each frame with a rubric:
   - clarity
   - differentiation
   - audience fit
   - credibility
   - demo strength
3. Synthesize the strongest narrative and state what evidence would change it.

## Success Signal

The recommendation keeps a sharp point of view and explains why rejected frames
were weaker for the current launch.
