# Method Card: `hard-verifier`

## Purpose

Use executable or externally grounded checks before relying on verbal judgment.

## Use When

- Tests, typecheckers, compilers, schemas, parsers, calculators, SQL queries,
  HTTP responses, source checks, or benchmark results can decide a claim.
- Candidates are easy to falsify with a small command or probe.

## Avoid When

- No meaningful verifier exists and the task is inherently subjective.
- The verifier checks only a tiny property but is being treated as complete proof.

## Inputs

- Candidate output, claim, patch, or plan
- Available validation tools or source of truth

## Outputs

- `VerificationRecord`: verifier, command or procedure, expected result, actual
  result, interpretation, and decision

## Composes With

- `edit-plan`: validate planned or completed code changes.
- `rag-claim-check`: verify claims against sources.
- `self-consistency`: decide between answer clusters.
- `multipath-localization`: run probes that eliminate path candidates.

## Failure Modes

- Running a broad test suite without checking what it actually proves.
- Treating a passing check as proof that all requirements are satisfied.
- Ignoring failures instead of narrowing the probe.

## Evaluation

- Check is reproducible.
- Interpretation is scoped to what the check proves.
- Inconclusive results trigger a narrower verifier.

## Minimal Example

```text
Input:
Two implementations disagree on an edge case.

Method:
Write or run the smallest test that covers the edge case.

Output:
VerificationRecord with pass/fail result and decision.
```

## Skill Implementation

- `skills/hard-verifier/SKILL.md`
