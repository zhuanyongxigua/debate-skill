---
name: answer-finalizer
description: Compress long, noisy, multi-candidate, or debate/review-heavy work into a concise final answer. Use after another method stack when the user needs the decision, rationale, tradeoff, and next action without process recap.
---

# Answer Finalizer

## Overview

Finalize output after the method work is done. This controls verbosity and
turns intermediate analysis into a short, actionable answer.

## Workflow

1. Identify the final user-facing decision or answer.

2. Keep only:
   - Recommendation or answer
   - Why it is the best supported result
   - Main tradeoff or risk
   - Next action, if useful

3. Remove:
   - Process recap
   - Generic background
   - Duplicate caveats
   - Rejected options unless they change the decision
   - Long meta commentary

4. Preserve uncertainty only when it changes the decision or next action.

5. Keep the final answer concise by default.

## Avoid / Escalate

- Avoid using this skill to hide unresolved uncertainty, failed verification, or missing evidence.
- Escalate back to `hard-verifier`, `rag-claim-check`, `multi-judge`, or `structured-debate` when finalization reveals an undecided conflict.
- Do not invent a cleaner conclusion than the evidence supports.

## Output

Return a `FinalAnswer` with the concise recommendation or answer, reason,
tradeoff/risk, and next action when useful.

Read `references/final-answer-template.md` when a durable final answer shape is useful.
