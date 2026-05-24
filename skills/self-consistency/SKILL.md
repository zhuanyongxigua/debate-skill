---
name: self-consistency
description: Independent multi-sample reasoning with answer extraction, voting, clustering, and verifier handoff. Use for math, logic, multiple-choice questions, single-answer reasoning, small testable coding tasks, and any low-risk task where many independent attempts plus aggregation are more useful than debate.
---

# Self Consistency

## Overview

Generate independent candidates first, then aggregate. Keep candidates isolated until after final answers, patches, or choices are extracted.

## Workflow

1. Decide sample count:
   - Low cost: 3
   - Balanced: 5-8
   - Robust: 10-20

2. Run independent fresh attempts. Do not show candidates to each other.

3. Extract the comparable final unit:
   - Multiple choice letter
   - Numeric answer
   - Boolean judgment
   - SQL query
   - Patch candidate
   - Short recommendation

4. Aggregate:
   - Use exact majority for discrete answers.
   - Cluster semantically equivalent answers before voting.
   - Prefer verifier-selected winners when a hard verifier exists.

5. Escalate only on disagreement:
   - If tied, use `hard-verifier` if available.
   - If no verifier exists, ask for one short judge pass.
   - Do not start a free-form debate.

## Execution Topology

- Prefer fresh sessions, separate calls, or same-runtime subagents when independence matters.
- If only one context is available, generate candidates sequentially without showing earlier candidates, then mark independence as limited.
- Do not use heterogeneous models as majority voters by default; use weaker or cheaper models as critics or alternative proposers when useful.

## Avoid / Escalate

- Avoid this skill for open-ended strategy, taste, or creative tasks where candidates are not directly comparable.
- Avoid it for current factual questions unless retrieval happens first.
- Escalate to `hard-verifier` whenever a test, calculation, schema, or source check can decide the winner.
- Escalate to `multi-judge` for open-ended outputs that require rubric-based evaluation rather than exact voting.

## Output

Return:

- Candidate count
- Aggregation method
- Vote table or cluster table
- Winner and confidence
- Dissenting candidates worth noting
- Verifier result or reason no verifier was used

Read `references/vote-record-template.md` when a durable audit trail is useful.
