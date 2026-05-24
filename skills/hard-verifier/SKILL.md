---
name: hard-verifier
description: Select, run, or design hard checks for candidate outputs. Use when tests, compilers, linters, typecheckers, schemas, parsers, calculators, SQL engines, benchmarks, web responses, local commands, or other external validators can decide correctness more reliably than debate.
---

# Hard Verifier

## Overview

Prefer executable checks over verbal judgment. If a candidate can be tested, parsed, calculated, compiled, or checked against a source of truth, use that before debate.

## Workflow

1. Identify the claim or candidate to verify.

2. Choose the strongest available verifier:
   - Unit, integration, regression, snapshot, or property tests
   - Compiler, linter, typechecker, static analyzer
   - JSON/schema parser
   - Calculator, solver, SQL query, spreadsheet recalculation
   - HTTP response, browser behavior, CLI output
   - Citation check or source comparison

3. Run or specify the command/check exactly.

4. Interpret results conservatively:
   - Pass means the checked property holds, not that the whole task is solved.
   - Fail means inspect the failure before revising.
   - Inconclusive means design a narrower probe.

5. Record:
   - Verifier
   - Command or procedure
   - Expected result
   - Actual result
   - Decision

## Safety Gate

- Prefer read-only, local, deterministic checks first.
- Ask for permission before running checks that need network access, credentials, paid APIs, external CLIs, broad filesystem access, long-running jobs, production systems, or destructive writes.
- Do not invent a verifier result. If a command cannot be run, specify the exact command and mark the result as `not_run`.
- Do not treat a passing narrow check as full task completion; state what property was and was not verified.

## Avoid / Escalate

- Avoid this skill as the final judge for preference-only creative or strategy choices unless a concrete measurable criterion exists.
- Escalate to `rag-claim-check` when the verifier is a source or citation check.
- Escalate to `react-reflexion` when verification requires multiple observe-act tool steps.
- Escalate to user approval before irreversible or sensitive verification actions.

## Output

Return a `VerificationRecord` with the verifier used, command or procedure, expected result, actual result, interpretation, and decision. If the result is inconclusive, include the next narrower probe.

Read `references/verifier-catalog.md` for examples by task type.
