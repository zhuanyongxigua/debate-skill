# Method Card: `multipath-localization`

## Purpose

Generate competing root-cause paths before planning a code or system fix.

## Use When

- A bug has unclear root cause.
- Symptoms may involve state, cache, auth, data flow, config, timing, or multiple
  files.
- Editing the first plausible file would be risky.

## Avoid When

- The failing line and fix are already proven.
- The task is a simple requested feature rather than a diagnosis.

## Inputs

- Symptom, failing test, logs, repo context, or system behavior

## Outputs

- `PathCards`: hypotheses with causal chains, candidate files, supporting and
  negative evidence, probes, expected patch shape, risk, and confidence
- Score table and selected path

## Composes With

- `edit-plan`: convert the selected path into a file-level plan.
- `hard-verifier`: run probes or regression tests.
- `structured-debate`: only if top paths remain tied after probes.

## Failure Modes

- Creating vague hypotheses without file or symbol anchors.
- Choosing a path before running cheap probes.
- Combining mutually exclusive paths instead of testing them.

## Evaluation

- Each path explains the observed symptom.
- Each path has a falsifiable probe.
- Selected path has better evidence than skipped paths.

## Minimal Example

```text
Input:
Intermittent 401 after login.

Method:
Generate paths for token refresh, cookie domain, CSRF mismatch, and session race.

Output:
PathCards plus probes to distinguish the paths before editing.
```

## Skill Implementation

- `skills/multipath-localization/SKILL.md`
