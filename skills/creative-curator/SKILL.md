---
name: creative-curator
description: Candidate generation, curation, remixing, and polishing for creative tasks. Use for naming, copywriting, slogans, stories, positioning language, title generation, tone alternatives, creative variants, and taste-sensitive output where diversity matters more than adversarial debate.
---

# Creative Curator

## Overview

Generate broadly before judging. Delay critique until there is enough variety, then curate against the target audience and constraints.

## Workflow

1. Capture the creative brief:
   - Audience
   - Tone
   - Constraints
   - Forbidden styles or words
   - Reference examples
   - Output length and format

2. Generate a broad pool:
   - At least 12 candidates for small tasks.
   - 20-50 candidates when naming or slogans matter.
   - Keep variants meaningfully different.

3. Cluster and remove near-duplicates.

4. Curate with a rubric:
   - Fit to brief
   - Memorability
   - Clarity
   - Freshness
   - Risk of confusion or cliche
   - Practical constraints

5. Remix the top 3-5. Preserve the best parts, not the exact wording.

6. Polish final options and include a short rationale only when useful.

## Debate Rule

Do not run adversarial debate for early creative exploration. Use taste checks after curation.

## Avoid / Escalate

- Avoid this skill as the primary method for factual, current, safety-critical, or correctness-first tasks; route those through evidence or verification first.
- Escalate to `multi-judge` only after a shortlist exists and selection criteria matter.
- Escalate to `rag-claim-check` when creative output includes factual claims, product promises, dates, prices, legal claims, or citations.
- Stop expanding candidates when new options are near-duplicates or no longer improve coverage of the brief.

## Output

Return a `CreativeBoard` with the brief, raw candidates, clusters, curated shortlist, remixes, final options, and short rationale when useful.

Read `references/creative-board-template.md` for a durable option board.
