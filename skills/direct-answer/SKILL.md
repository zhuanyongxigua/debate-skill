---
name: direct-answer
description: Directly answer simple, low-risk, self-contained questions after work-gate explicitly selects direct-answer. Use when no external evidence, tool use, code edits, verifier, or multi-step method would materially improve the result.
---

# Direct Answer

## Overview

Answer directly only when directness is the selected method, not a bypass around
routing.

## Workflow

1. Confirm the Direct Answer Gate:
   - The task is simple, self-contained, and low risk.
   - No current facts, citations, or external evidence are needed.
   - No code/file changes or broad tool use are needed.
   - No hard verifier would materially improve the answer.
   - No multiple plausible workflows need comparison.

2. Answer in the shortest useful form.

3. Include only:
   - The answer or recommendation
   - One or two key reasons when useful
   - A caveat only if it changes the decision

4. Stop when the user has the answer.

## Avoid / Escalate

- Escalate to `rag-claim-check` for current facts, citations, source disputes, or factual claims with stale-risk.
- Escalate to `hard-verifier` when a calculation, schema, parser, test, command, or other check can decide.
- Escalate to `edit-plan` for code/file changes beyond a tiny obvious edit.
- Escalate to `multi-proposal-synthesis` or `multi-judge` when multiple plausible approaches or subjective comparisons matter.
- Escalate to `high-risk-evidence` for medical, legal, financial, safety, security, compliance, or irreversible decisions.

## Output

Return a `DirectAnswer` with the concise answer, minimal reasoning if useful,
and any decision-changing caveat.

Read `references/direct-answer-template.md` when a durable answer record is useful.
