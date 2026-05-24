# Method Card: `creative-curator`

## Purpose

Generate, curate, remix, and polish creative candidates without turning taste
work into premature debate.

## Use When

- Naming, copy, slogans, titles, tone variants, stories, or positioning language
  need diversity.
- The user benefits from multiple directions before choosing.

## Avoid When

- The task needs factual grounding first.
- A single objective answer can be verified.
- The user asked for strict compliance review rather than creative exploration.

## Inputs

- Creative brief, audience, constraints, tone, examples, and forbidden directions

## Outputs

- `CreativeBoard`: candidate pool, clusters, selection rationale, remixes, and
  polished finalists

## Composes With

- `multi-judge`: score finalists with a taste or brand rubric.
- `rag-claim-check`: verify factual claims in marketing copy.
- `multi-proposal-synthesis`: choose a broader positioning direction.

## Failure Modes

- Producing near-duplicates.
- Critiquing too early and collapsing diversity.
- Ignoring audience or tone constraints.

## Evaluation

- Candidate set spans distinct directions.
- Finalists preserve useful diversity.
- Selection rationale maps to the brief.

## Minimal Example

```text
Input:
Name a lightweight method-card library for AI agents.

Method:
Generate directions, cluster them, remix strongest ideas, polish finalists.

Output:
CreativeBoard of names with rationale.
```

## Skill Implementation

- `skills/creative-curator/SKILL.md`
