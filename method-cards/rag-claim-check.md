# Method Card: `rag-claim-check`

## Purpose

Ground factual work in retrieved evidence and audit claims against sources.

## Use When

- The task asks for factual, current, sourced, or document-grounded information.
- Unsupported claims or stale facts would materially harm the answer.
- Multiple sources need comparison.

## Avoid When

- The task is purely creative or subjective.
- The answer can be decided by a local hard verifier instead of external sources.

## Inputs

- User question or draft answer
- Source corpus, web access, documents, or authoritative references

## Outputs

- `ClaimTable`: claim list, evidence mapping, source quality notes, unsupported
  claims, conflicts, and conservative final synthesis

## Composes With

- `hard-verifier`: check citations, dates, calculations, or source-backed claims.
- `high-risk-evidence`: add conservative boundaries for regulated domains.
- `multi-judge`: review source quality with a rubric when stakes are high.

## Failure Modes

- Searching broadly but not mapping evidence to individual claims.
- Keeping polished unsupported claims.
- Treating weak or secondary sources as authoritative.

## Evaluation

- Every material claim is supported, qualified, or removed.
- Source conflicts are surfaced instead of hidden.
- Dates and source authority are explicit when recency matters.

## Minimal Example

```text
Input:
Summarize the latest pricing rules for a service.

Method:
Retrieve official sources, extract claims, map each claim to evidence.

Output:
ClaimTable and sourced answer with unsupported claims removed.
```

## Skill Implementation

- `skills/rag-claim-check/SKILL.md`
