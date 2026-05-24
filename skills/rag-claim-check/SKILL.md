---
name: rag-claim-check
description: Evidence-first answering with retrieval, source comparison, claim extraction, and citation audit. Use for factual questions, current information, research synthesis, document-grounded answers, internal knowledge-base tasks, and any task where unsupported claims or stale facts are a major risk.
---

# RAG Claim Check

## Overview

Ground the answer before polishing it. Treat every important factual assertion as a claim that needs support, contradiction checking, or removal.

## Workflow

1. Identify source requirements:
   - Current web
   - Official docs
   - Local repository or documents
   - Domain authority sources
   - User-provided materials

2. Retrieve before answering. Prefer primary sources.

3. Build a claim table:
   - Claim
   - Source support
   - Contradicting source
   - Confidence
   - Action: keep, qualify, remove, or investigate

4. Draft the answer using only supported claims.

5. Audit citations:
   - Every material claim has support.
   - Quotes are short and necessary.
   - Dates are explicit when recency matters.
   - Source quality is visible to the user.

## Debate Rule

Do not use model debate to decide facts when retrieval is possible. Use an adversarial checker only to find unsupported claims or missing evidence.

## Source Policy

- Prefer primary, official, current, and domain-authoritative sources.
- Include dates, versions, jurisdictions, or document revisions when recency changes the answer.
- When sources conflict, show the conflict and qualify the claim instead of synthesizing certainty.
- Treat user-provided documents as evidence for what they contain, not as universal truth.

## Avoid / Escalate

- Avoid this skill for pure creative work or tasks with no material factual claims.
- Escalate to `high-risk-evidence` for medical, legal, financial, tax, safety, security, compliance, or irreversible decisions.
- Escalate to `hard-verifier` when claims can be checked by tests, schemas, calculators, parsers, or executable commands.
- Escalate to an adversarial checker only to find citation gaps or unsupported claims, not to decide facts by debate.

## Output

Return:

- Sources used
- Claim table summary
- Final answer
- Unsupported or uncertain claims
- Follow-up retrieval needed

Read `references/claim-table-schema.md` for the full audit format.
