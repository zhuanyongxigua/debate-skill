# Method Card: `self-consistency`

## Purpose

Generate independent attempts, extract answers, cluster them, and select or
verify the strongest answer.

## Use When

- The task has a single or narrow correct answer.
- Independent attempts are cheap.
- Math, logic, multiple-choice, or small testable coding tasks are involved.

## Avoid When

- The task needs external evidence first.
- The task is open-ended and should produce diverse proposals rather than a vote.
- Samples would copy the same flawed assumption.

## Inputs

- Problem statement
- Sampling count or budget
- Optional verifier or answer format

## Outputs

- `VoteRecord`: independent attempts, normalized answers, vote or cluster
  counts, dissenting answers, and verifier handoff

## Composes With

- `hard-verifier`: decide between clusters.
- `tree-search`: explore branches when reasoning paths depend on earlier choices.
- `multi-judge`: evaluate non-exact candidate outputs when voting is insufficient.

## Failure Modes

- Samples are not independent.
- Majority vote wins over a minority answer with stronger verification.
- Used for factual questions without retrieval.

## Evaluation

- Attempts are meaningfully independent.
- Final answer is extracted and checked.
- Disagreements trigger verification rather than hand-waving.

## Minimal Example

```text
Input:
Solve a logic puzzle with one correct answer.

Method:
Generate five independent solutions and cluster final answers.

Output:
VoteRecord with verifier handoff for the winning answer.
```

## Skill Implementation

- `skills/self-consistency/SKILL.md`
