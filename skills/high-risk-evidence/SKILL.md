---
name: high-risk-evidence
description: Conservative evidence-first workflow for high-stakes domains. Use for medical, legal, financial, tax, safety, security, compliance, regulated, or irreversible decisions where current authoritative sources, uncertainty statements, risk boundaries, and human expert review are required.
---

# High Risk Evidence

## Overview

Reduce harm before optimizing completeness. Use authoritative evidence, independent review, and clear uncertainty; do not let model debate become final authority.

## Workflow

1. Classify the risk:
   - Medical
   - Legal
   - Financial/tax/investment
   - Security/safety
   - Compliance/regulatory
   - Irreversible operational decision

2. Retrieve authoritative sources before analysis.

3. Build an evidence table:
   - Source
   - Date/version/jurisdiction
   - Supported claim
   - Confidence
   - Caveat

4. Use independent analysis or critique only after sources are assembled.

5. Synthesize conservatively:
   - What is supported
   - What is uncertain
   - What action is reversible
   - What requires professional review
   - What should not be decided by the model

6. Recommend human expert review for decisions with material risk.

## Avoid / Escalate

- Avoid giving definitive medical, legal, financial, security, compliance, or safety instructions when current authoritative evidence, jurisdiction, version, or user-specific facts are missing.
- Escalate to `rag-claim-check` for source gathering and citation audit.
- Escalate to `multi-judge` only after sources are assembled, and only for independent critique of the memo, not as final authority.
- Escalate to human expert review for material, irreversible, regulated, or user-specific decisions.

## Output

Return a `RiskMemo` with domain and scope, authoritative sources checked, supported conclusions, uncertainty, reversible actions, irreversible or high-cost actions, expert-review boundaries, conservative recommendation, and do-not-do boundary.

Read `references/risk-memo-template.md` for the final memo shape.
