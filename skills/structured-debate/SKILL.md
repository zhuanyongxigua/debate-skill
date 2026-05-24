---
name: structured-debate
description: Bounded, artifact-centered debate for resolving conflicts among existing candidates. Use only after independent candidates, localization paths, plans, judgments, or claims already exist and cannot be decided by a hard verifier, source check, or cheap probe; useful for plan review, path disambiguation, and tradeoff conflicts.
---

# Structured Debate

## Overview

Use debate as a conflict-resolution tool, not as the engine for generating first answers. Keep it short, evidence-based, and tied to explicit artifacts.

## Workflow

1. Confirm all preconditions:
   - There are at least two concrete candidates.
   - Candidates conflict in a decision-relevant way.
   - Available hard verifiers or probes are absent, inconclusive, or too expensive.
   - The debate can be capped to one critique round plus arbitration.

2. Freeze candidates. Do not let debaters rewrite their own plan during critique.

3. Assign each critic a limited role:
   - Evidence critic
   - Risk critic
   - Cost/reversibility critic
   - User-intent critic
   - Testability critic

4. Ask each critic only:
   - What does this candidate assume?
   - What evidence supports or weakens it?
   - Where can it fail?
   - What cheaper probe would decide it?

5. Arbiter decides using rubric and evidence. Do not reward rhetorical confidence.

6. Output one of:
   - Select candidate A/B/C
   - Combine compatible steps
   - Run a probe before deciding
   - Escalate to human review

## Execution Topology

- Use same-runtime fresh sessions for critics when independence matters and heterogeneity is not required.
- Use heterogeneous CLI agents only when model/tool diversity materially reduces correlated error or the user explicitly asks for cross-agent debate.
- Ask for permission before invoking external CLI agents that need network, credentials, broad filesystem access, or other elevated permissions.

## Avoid / Escalate

- Avoid debate before candidate artifacts exist.
- Avoid debate when a hard verifier, source check, or cheap probe can decide.
- Avoid letting rhetorical confidence overrule failing tests, unsupported citations, or missing reproduction.
- Escalate to `multi-judge` when a rubric can rank candidates without adversarial interaction.

## Output

Return a `DebateRecord` with frozen candidates, debate reason, bounded critic findings, arbiter decision, evidence basis, rejected candidates and reasons, and next action.

Read `references/debate-protocol.md` for the full artifact format.
