# Recipe: Factual Claim Audit

## Task Shape

Use this when the answer depends on factual accuracy, current information,
sources, internal documents, or claim-level support.

Common signals:

- "latest", "current", "official", "source", "citation"
- research synthesis
- policy, product, pricing, standard, or release details
- draft answer may contain unsupported claims

## Method Stack

```text
task-router
  -> rag-claim-check
  -> hard-verifier
  -> high-risk-evidence when stakes require it
```

## Required Artifacts

- `RoutePlan`
- source list with authority notes
- extracted claims
- `ClaimTable` with source-to-claim mapping
- unsupported or conflicting claims
- final sourced synthesis

## Do Not Do Too Early

- Do not answer from memory when recency or authority matters.
- Do not cite sources without mapping them to claims.
- Do not keep a polished claim because it sounds plausible.

## Minimal Example

```text
Input:
Summarize what changed in the latest API pricing rules.

Route:
rag-claim-check -> hard-verifier

ClaimTable:
- claim
- supporting source
- date
- confidence
- conflicts
- action: keep, qualify, or remove
```

## Success Criteria

- Every material claim is supported, qualified, or removed.
- Source dates and authority are explicit.
- Conflicts are surfaced instead of smoothed over.
