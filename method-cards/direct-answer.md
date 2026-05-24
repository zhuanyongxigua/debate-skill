# Method Card: `direct-answer`

## Purpose

Answer simple, low-risk, self-contained questions without method overhead after
the router explicitly selects direct answering.

## Use When

- The task is simple, self-contained, and low risk.
- No current facts, citations, or external evidence are needed.
- No code/file changes or broad tool use are needed.
- No verifier would materially improve the answer.
- The user likely wants a quick answer.

## Avoid When

- Current facts, citations, source disputes, or stale facts matter.
- Code changes, repo exploration, or tool actions are needed.
- Multiple plausible workflows or strategies need comparison.
- The domain is medical, legal, financial, safety, security, compliance, or irreversible.
- A hard verifier can decide the answer.

## Inputs

- User task
- Any explicit constraints on length, tone, or format

## Outputs

- `DirectAnswer`: concise answer, minimal reasoning if useful, and any
  decision-changing caveat

## Composes With

- `work-gate`: must select direct-answer when routing is required.
- `answer-finalizer`: can compress a direct answer further when the user asks for brevity.

## Failure Modes

- Premature simplification.
- Skipping evidence when evidence is actually required.
- Overconfident answers without a verifier.

## Evaluation

- The answer is short and useful.
- No required method was skipped.
- A human would agree that extra routing would add overhead without reducing risk.

## Minimal Example

```text
Input:
What does "idempotent" mean in APIs?

Method:
Direct answer.

Output:
An idempotent API operation can be repeated multiple times with the same effect
as running it once.
```

## Skill Implementation

- `skills/direct-answer/SKILL.md`
