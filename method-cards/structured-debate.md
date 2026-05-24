# Method Card: `structured-debate`

## Purpose

Resolve conflicts between concrete candidate artifacts when evidence, probes, or
project checks cannot decide cheaply.

## Use When

- There are at least two concrete candidates, paths, plans, or judgments.
- They conflict in a meaningful way.
- A cheaper project check, source check, or probe cannot resolve the conflict.

## Avoid When

- No candidates exist yet. Generate candidates first.
- The task is factual and sources can decide.
- The task is testable and a project check can decide.
- The conflict is low stakes.

## Inputs

- Candidate artifacts
- Conflict statement
- Decision criteria and debate budget

## Outputs

- `DebateRecord`: claims by side, strongest objections, concessions, unresolved
  points, arbiter decision, and next check

## Composes With

- `agent-dispatch`: decides whether critics run in current session,
  same-runtime agents, or heterogeneous CLI agents.
- `multi-candidate-analysis`: resolve tied diagnosis paths, tradeoff conflicts,
  or rubric-scoring disagreements between top candidates.

## Failure Modes

- Using debate to generate the first ideas.
- Rewarding eloquence over evidence.
- Letting debate continue after a project check becomes available.

## Evaluation

- Debate is bounded.
- Each side argues from concrete artifacts.
- Arbiter decision cites criteria, not vibes.

## Minimal Example

```text
Input:
Two edit plans remain plausible after tests are inconclusive.

Method:
Run one bounded critique round and arbiter decision.

Output:
DebateRecord with chosen plan and follow-up verification.
```

## Skill Implementation

- `skills/structured-debate/SKILL.md`
