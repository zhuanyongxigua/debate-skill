# Method Card: `work-gate debate`

## Purpose

Resolve conflicts between concrete candidate artifacts when evidence, probes, or
project checks cannot decide cheaply.

This is an internal `work-gate` mode, not a separate installable skill.

## Use When

- The debate entry case is explicit:
  - `requirement_debate`: no candidates exist yet, so generate and freeze them first.
  - `single_proposal_debate`: one proposal exists and needs adopt/revise/reject/probe review.
  - `candidate_debate`: multiple candidates already exist and conflict.
  - `judgment_debate`: conflicting judgments or claims exist about one artifact.
- A cheaper project check, source check, or probe cannot resolve the conflict.

## Avoid When

- No debate entry case is clear.
- The task is factual and sources can decide.
- The task is testable and a project check can decide.
- The conflict is low stakes.

## Inputs

- Candidate artifacts
- Conflict statement
- Decision criteria and debate budget
- Debate style: `parallel_positions`, `proposal_attack`, or `frozen_candidates`

## Outputs

- `DebateRecord`: claims by side, strongest objections, concessions, unresolved
  points, arbiter decision, and next check

## Composes With

- `agent-launch`: prepares external CLI critic launches when the parent route
  has already selected single external CLI or heterogeneous CLI agents.
- `work-gate candidate analysis`: generates or evaluates candidates before
  debate when needed.

## Failure Modes

- Using unbounded debate to generate first ideas.
- Rewarding eloquence over evidence.
- Skipping cross-review.
- Letting debate continue after a project check becomes available.

## Evaluation

- Debate is bounded.
- Candidates or judgments are frozen before critique.
- Each critic cross-reviews opposing criticism before arbitration.
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

- `skills/work-gate/SKILL.md`
- `skills/work-gate/references/debate-protocol.md`
