# Artifact Quality Rubric

Layer 2 eval rubric. Each criterion scored 0–3:

- **0**: absent or wrong
- **1**: present but vague or generic
- **2**: present and mostly correct
- **3**: present, concrete, and complete

---

## CandidateAnalysis (work-gate candidate analysis)

### Diagnosis mode

| Criterion | Score 0 | Score 3 |
| --- | --- | --- |
| Path count | Only 1 path or none | 3+ distinct root cause paths |
| Hypothesis specificity | "Maybe the auth is broken" | "Cookie domain mismatch between api.example.com and example.com" |
| Evidence to collect | Missing or generic | Names a specific file, log line, or command to run |
| Invalidation condition | Missing | "Rules out if cookie domain matches in nginx config" |
| Path independence | All paths are variations of one idea | Each path represents a genuinely distinct failure mode |

**Minimum passing bar**: 2+ paths, each with a concrete hypothesis and at least one evidence probe.

### Decision mode

| Criterion | Score 0 | Score 3 |
| --- | --- | --- |
| Proposal count | 1 option or none | 2+ named, distinct proposals |
| Proposal independence | All proposals are the same idea reworded | Each proposal represents a genuinely different approach |
| Critic table | Missing | Table comparing proposals on key dimensions |
| Synthesis | "Both are fine" | Names a preferred option with concrete reasoning |
| Validation triggers | Missing | Names conditions that would change the recommendation |

**Minimum passing bar**: 2+ independent proposals, a comparison, and a named synthesis.

---

## ChangePlan (work-gate)

| Criterion | Score 0 | Score 3 |
| --- | --- | --- |
| Goal statement | Missing or circular | One sentence naming the specific behavior to fix |
| File list | Missing | Names specific files with paths |
| Change description | "Fix the bug" | Describes the exact change per file |
| Validation commands | Missing | Runnable commands: `pnpm test`, `pytest tests/auth.py`, etc. |
| Non-goals or rollback | Missing | States what is out of scope or how to revert |

**Minimum passing bar**: named files, at least one runnable validation command.

---

## SourceCheckTable (work-gate)

| Criterion | Score 0 | Score 3 |
| --- | --- | --- |
| Record structure | Free prose | Source-check table with headers |
| Claim column | Missing | Each row is a specific, testable claim |
| Source column | Missing | Names an authoritative URL or document |
| Support status column | Missing | Each claim marked: supported / unsupported / uncertain |
| Unsupported claims flagged | All claims treated as true | At least one claim flagged as unverified or uncertain |

**Minimum passing bar**: source-check table with claim + source + status columns, at least one claim explicitly flagged.

---

## Failure Flags (Layer 2)

- CandidateAnalysis with only one path.
- ChangePlan with no specific filenames.
- ChangePlan with no runnable validation command.
- SourceCheckTable with no source column.
- SourceCheckTable where every claim is marked "supported" without sources.
- CandidateAnalysis that names options but provides no comparison.
- CandidateAnalysis where "synthesis" is just "it depends."
