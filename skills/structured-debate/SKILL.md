---
name: structured-debate
description: Bounded, artifact-centered debate for resolving conflicts among existing candidates. Use only after independent candidates, localization paths, plans, judgments, or claims already exist and cannot be decided by a project check, source check, or cheap probe. Use agent-dispatch for current-session versus heterogeneous CLI critic selection.
---

# Structured Debate

## Overview

Use debate as a conflict-resolution tool, not as the engine for generating first answers. Keep it short, evidence-based, and tied to explicit artifacts.

## Workflow

1. Confirm all preconditions:
   - There are at least two concrete candidates.
   - Candidates conflict in a decision-relevant way.
   - Available project checks or probes are absent, inconclusive, or too expensive.
   - The debate can be capped to one independent critique round, one cross-review round, and arbitration.

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

5. Run a required cross-review round:
   - Show each critic the other critic findings.
   - Ask each critic to identify which opposing criticism is valid, invalid, missing evidence, or decision-relevant.
   - Ask each critic to update only its critique, not rewrite the frozen candidate.
   - Keep the round bounded; no open-ended back-and-forth.

6. Arbiter decides using rubric and evidence. Do not reward rhetorical confidence, consensus, or vote count.

7. Output one of:
   - Select candidate A/B/C
   - Combine compatible steps
   - Run a probe before deciding
   - Escalate to human review

## Execution Topology

- Use `agent-dispatch` to decide whether debate critics run in the current
  session, same-runtime agents, or heterogeneous CLI agents.
- Use same-runtime fresh sessions for critics when independence matters and heterogeneity is not required.
- Prefer heterogeneous CLI agents when cross-agent independence or reduced
  correlated error is important. The default heterogeneous debate uses two CLIs:
  Claude Code first, Codex CLI second.
- Invoke external CLI agents only through `agent-dispatch`, in non-interactive
  mode, with a 5 minute default timeout.
- Capture each child output as a critic artifact, then arbitrate in the parent
  session.

## Avoid / Escalate

- Avoid debate before candidate artifacts exist.
- Avoid debate when a project check, source check, or cheap probe can decide.
- Avoid letting rhetorical confidence overrule failing tests, unsupported citations, or missing reproduction.
- Escalate to `multi-candidate-analysis` evaluation mode when a rubric can rank candidates without adversarial interaction.

## Output

Return a `DebateRecord` with frozen candidates, debate reason, dispatch mode,
bounded critic findings, arbiter decision, evidence basis, rejected candidates
and reasons, and next action.

Read `references/debate-protocol.md` for the full artifact format.
