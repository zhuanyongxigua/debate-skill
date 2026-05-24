---
name: multipath-localization
description: Generate and compare multiple root-cause localization paths before planning a code or system fix. Use for repo bugs, intermittent failures, performance problems, state/cache/auth/data-flow issues, cross-file defects, unclear failing tests, or any debugging task where guessing one file too early is risky.
---

# Multipath Localization

## Overview

Create competing causal paths from symptom to likely code location. Decide with probes, evidence scoring, and synthesis; use voting only as a last resort.

## Workflow

1. Orient in the repo or system:
   - Entry points
   - Failing tests or symptoms
   - Relevant logs
   - Call paths, data paths, state paths, config paths

2. Generate 3-5 Path Cards. Each must include:
   - Hypothesis
   - Causal chain from symptom to code
   - Candidate files, functions, classes, schemas, or jobs
   - Supporting evidence
   - Negative evidence
   - Probe or falsification test
   - Expected minimal patch shape
   - Risk and confidence

3. Run cheap probes when possible before choosing a path.

4. Score each path:
   - Explains all symptoms: 0-5
   - Repo evidence support: 0-5
   - Probe quality: 0-5
   - Matches failing tests/logs: 0-5
   - Patch minimality: 0-3
   - Risk/impact: 0-3
   - Existing architecture fit: 0-3
   - Negative evidence: 0-3
   - Reversibility: 0-2

5. Select, combine, or split paths:
   - Combine only when paths are layers of the same causal chain.
   - Probe first when paths are mutually exclusive.
   - Split into milestones when multiple independent bugs exist.

## Probe Budget

- Generate 3-5 Path Cards by default; use 2 for small local bugs and more only when the system is broad or symptoms conflict.
- Prefer cheap read-only probes before tests or edits.
- Stop probing when one path clearly explains the symptoms and has a concrete verifier, or when additional probes stop changing the ranking.
- Do not write a patch until a path is selected or the user explicitly asks for speculative patch candidates.

## Avoid / Escalate

- Avoid this skill when the failing file, cause, and patch shape are already proven.
- Escalate to `edit-plan` after selecting a path.
- Escalate to `hard-verifier` for reproduction, regression tests, logs, traces, or other probes.
- Escalate to `structured-debate` only when top Path Cards remain tied after cheap probes.

## Output

Return Path Cards, score table, selected path, skipped paths and why, and the next probe or `edit-plan` handoff.

Read `references/path-card-schema.md` for the exact structure.
