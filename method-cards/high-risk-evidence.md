# Method Card: `high-risk-evidence`

## Purpose

Use conservative, source-first handling for high-stakes domains where wrong
answers can cause real harm.

## Use When

- The task touches medical, legal, finance, tax, safety, security, compliance,
  regulated, or irreversible decisions.
- The user needs boundaries, uncertainty, and expert-review language.

## Avoid When

- The task is low-stakes and ordinary routing is sufficient.
- The user asks for professional advice that should be provided only by a
  qualified expert.

## Inputs

- User question
- Jurisdiction, date, context, and risk level
- Authoritative sources or retrieval path

## Outputs

- `RiskMemo`: scoped answer, authoritative evidence, uncertainty,
  exclusions, risk boundaries, and human expert referral language

## Composes With

- `rag-claim-check`: retrieve and audit authoritative sources.
- `multi-judge`: review conservative wording against a rubric.
- `hard-verifier`: check calculations, dates, or regulatory references.

## Failure Modes

- Sounding certain when evidence is limited.
- Omitting jurisdiction, date, or applicability constraints.
- Replacing professional judgment instead of setting boundaries.

## Evaluation

- Sources are authoritative for the domain.
- Uncertainty and scope are explicit.
- The answer avoids unsafe individualized instructions.

## Minimal Example

```text
Input:
Can I use this tax deduction this year?

Method:
Identify jurisdiction/date, retrieve official guidance, state boundaries.

Output:
RiskMemo with source-backed summary and professional-review caveat.
```

## Skill Implementation

- `skills/high-risk-evidence/SKILL.md`
