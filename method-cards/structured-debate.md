# Method Card: `structured-debate`

## Purpose

Resolve conflicts between concrete candidate artifacts when evidence, probes, or
hard verifiers cannot decide cheaply.

## Use When

- There are at least two concrete candidates, paths, plans, or judgments.
- They conflict in a meaningful way.
- A cheaper verifier, source check, or probe cannot resolve the conflict.

## Avoid When

- No candidates exist yet. Generate candidates first.
- The task is factual and sources can decide.
- The task is testable and a hard verifier can decide.
- The conflict is low stakes.

## Inputs

- Candidate artifacts
- Conflict statement
- Decision criteria and debate budget

## Outputs

- `DebateRecord`: claims by side, strongest objections, concessions, unresolved
  points, arbiter decision, and next check

## Composes With

- `multipath-localization`: resolve tied paths after probes.
- `multi-proposal-synthesis`: resolve tradeoff conflicts between top proposals.
- `multi-judge`: investigate judge disagreement.

## Failure Modes

- Using debate to generate the first ideas.
- Rewarding eloquence over evidence.
- Letting debate continue after a verifier becomes available.

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
