# Evals

Paired routing eval for Method Skills. Tests whether an agent selects the right
method stack before working — not whether the final output is correct.

## Conditions

Eight conditions run against the same tasks:

| Condition | Description |
| --- | --- |
| `baseline` | No skills, no method index, no routing instruction |
| `passive-skills` | Skills listed by name, no explicit routing instruction |
| `explicit-router` | Requires RoutePlan but no method definitions |
| `method-index` | Always-on compact method index in system prompt |
| `method-index-plus-skills` | Method index plus brief method execution descriptions |
| `always-debate` | Work-gate debate forced for every task |
| `generic-long-prompt` | Generic best-practices prompt (ablation baseline) |
| `oracle-skill` | Per-fixture: injects the correct method stack, tests skill execution ceiling |

`generic-long-prompt` is important: if `method-index-plus-skills` only wins
because of prompt length, it should not beat a generic prompt of similar size.

`oracle-skill` is the ceiling arm. For each fixture it injects the exact correct
method stack (`expected_methods` from `meta.json`). If this arm does not
outperform others, the skills themselves need redesign, not the router.

## Metrics

| Metric | What it measures |
| --- | --- |
| RoutePlan rate | Did the agent emit RoutePlan before substantive work? |
| Critical recall | Were the expected methods selected? |
| Avoid violation rate | Were methods the task forbids used anyway? |
| Artifact score | Were the required structured artifacts produced? |
| Debate misuse rate | Was debate used when not expected? |
| Avg word count | Response verbosity |
| Avg token cost | API cost per run |

Layer 3 additional metrics:

| Metric | What it measures |
| --- | --- |
| `all_tests_pass` | All pytest tests pass after patch |
| `hidden_tests_pass` | Boundary-condition tests pass (true root-cause coverage) |
| `public_tests_pass` | Symptom-revealing tests pass |
| `patch_lines` | Lines of code changed (proxy for fix scope) |
| `files_changed_count` | Number of source files modified |
| `disallowed_change` | Model modified test files or inserted skip/xfail markers |
| `expected_method_used` | Did the output mention the expected method names? |

## Layers

**Layer 1 — Routing eval** (`routing-tasks.jsonl`, 28 tasks):
Tests whether the agent selects the right method stack. Scoring is string
matching: do expected method names and artifact names appear in the output?

**Layer 2 — Artifact quality eval** (`tasks/artifact-tasks.jsonl`, 10 tasks):
Tests whether artifacts have the right internal structure. Two scoring modes:
- Heuristic: regex checks for sub-components (hypothesis, source column, etc.)
- LLM judge: Claude Haiku rates quality 0–3 per rubric criterion (`--llm-judge`)

**Layer 3 — E2E coding eval** (`fixtures/`, seeded-bug repos):
Gives the model buggy source code, asks for a corrected patch, applies it to a
temp copy of the fixture, and runs pytest. Result is deterministic pass/fail.

Each fixture has:
- `task.md` — issue description shown to the model
- `src/` — buggy source files
- `tests/` — pytest test suite
- `meta.json` — fixture metadata including `public_tests`, `hidden_tests`,
  `expected_methods`, `true_root_cause`, `is_simple`
- `expected.json` — validation constraints (`max_files_changed`,
  `max_patch_lines_soft`, `disallowed_changes`) — **not shown to the model**

Public tests expose the symptom. Hidden tests cover the true root-cause
boundary: a model that band-aids the obvious failure can pass public tests
but fail hidden tests. The gap between `public_tests_pass` and
`hidden_tests_pass` across conditions is a key signal.

> **Limitation**: Layer 3 gives Claude code as text and asks for a patch output.
> It does not test real agentic file-browsing or iterative debugging.

## Current Fixtures (3)

| Fixture | Category | Difficulty | Key bug |
| --- | --- | --- | --- |
| `rate-limiter` | concurrency_state | medium | Global list instead of per-user dict |
| `event-filter` | logic_inversion | easy | Inverted `not in` condition |
| `word-freq` | text_processing | easy | Missing punctuation strip in tokenizer |

3 fixtures are smoke-test scale. See the roadmap below for the expansion plan.

## Layer 3 Expansion Roadmap

### Why expand?

With 3 fixtures, one wrong answer is 33.3 percentage points. 24 fixtures bring
that to 4.2 pp per fixture, which is enough to show reliable trends. 30+ lets
you bucket by bug category. The expansion goal is:

> On deterministic seeded bug fixtures, `method-index-plus-skills` improves
> test-pass rate over `baseline`, `generic-long-prompt`, and `always-debate`.

Scale thresholds:

| N fixtures | Status | What you can claim |
| --- | --- | --- |
| 3 | current | smoke test, runner works |
| 10 | early signal | internal record only |
| 18 | v0 credible | "initial outcome eval" |
| 24–30 | v1 recommended | show pass-rate trends, README-worthy |
| 50+ | serious benchmark | stability + category breakdown |

### Planned fixture categories (target: 24–30)

**A. Auth / Session / Security (6 fixtures)**

Complex enough that `work-gate candidate analysis` should identify multiple plausible
root causes before narrowing to the correct fix.

| id | Symptom | Hidden root cause |
| --- | --- | --- |
| `auth_cookie_domain` | Sub-domain pages get 401 after login | Cookie domain excludes parent domain |
| `token_refresh_race` | Intermittent 401 near token expiry | Refresh doesn't update request context token |
| `csrf_header_case` | Some POST requests return 403 | Header lookup is case-sensitive |
| `session_store_ttl` | Session disappears shortly after login | TTL units mismatch (seconds vs milliseconds) |
| `role_inheritance` | Admin sub-role can't access admin API | Permission resolver doesn't expand inherited roles |
| `oauth_state_reuse` | OAuth callback intermittently fails | State token deleted on first read before second use |

**B. Cache / State / Data Flow (5 fixtures)**

Tests work-gate change planning and project checks: fix requires understanding
state transitions before making a minimal patch.

| id | Symptom | Hidden root cause |
| --- | --- | --- |
| `stale_profile_cache` | Avatar update not reflected in page | Cache not invalidated after profile mutation |
| `search_cache_key` | Different filter params return same results | Cache key missing filter fields |
| `feature_flag_default` | New users see deprecated feature | Flag default fallback value is inverted |
| `optimistic_update_rollback` | Save failure still shows success in UI | Optimistic update not rolled back on error |
| `nested_config_merge` | Partial config override drops unrelated keys | Shallow merge used instead of deep merge |

**C. Data / Query / Time (5 fixtures)**

Tests whether the model identifies subtle boundary conditions. `baseline` often
guesses a plausible but wrong single fix; `method-index-plus-skills` should
localize multiple candidate paths first.

| id | Symptom | Hidden root cause |
| --- | --- | --- |
| `pagination_off_by_one` | Page 2 duplicates or omits one record | Page index 0/1 inconsistency in offset calc |
| `timezone_date_filter` | Orders near UTC midnight filtered wrong | Naive datetime compared with local timezone |
| `sql_where_precedence` | Deleted users appear in active search | `A AND B OR C` missing parentheses |
| `decimal_price_rounding` | Invoice totals off by 1 cent | `float` rounding used instead of `Decimal.quantize` |
| `locale_sort_natural` | `item10` sorts before `item2` | Lexicographic sort instead of natural sort |

**D. Webhook / Jobs / Idempotency (4 fixtures)**

Multi-path root causes: bug could be in handler, queue, repository, or state
machine. Good for measuring `work-gate candidate analysis` value.

| id | Symptom | Hidden root cause |
| --- | --- | --- |
| `webhook_idempotency` | Replayed Stripe webhook ships order twice | No deduplication by event ID |
| `background_retry_backoff` | Retry delays are wrong despite correct count | Exponential backoff formula off-by-one |
| `email_deduplication` | Bulk import sends duplicate emails | Dedup key not normalized (case/whitespace) |
| `inventory_reservation_timeout` | Cancelled order doesn't release inventory | Cleanup query filters `pending` but not `expired` |

**E. Validation / API Contract (4 fixtures)**

Tests work-gate change-plan precision: fix must preserve API contract without overcorrecting.

| id | Symptom | Hidden root cause |
| --- | --- | --- |
| `form_schema_coercion` | String `"false"` is treated as truthy | Bool coercion uses Python truthiness |
| `api_version_fallback` | Old clients fail on new API version | Version comparison uses string order, not semver |
| `file_upload_mime` | Non-image file accepted as image | Only extension checked, not content-type/magic bytes |
| `batch_import_partial_fail` | One failing row aborts entire import | No per-row error handling; bad transaction boundary |

**F. Simple / Negative Control (6 fixtures)**

These should NOT need `CandidateAnalysis` or `ChangePlan`. The goal is to confirm that
`method-index-plus-skills` does not over-route simple tasks and inflate token
cost for trivial fixes.

| id | Symptom | Correct fix |
| --- | --- | --- |
| `simple_typo_config_key` | Config value not found | Typo in key name (`timout` → `timeout`) |
| `simple_validator_min_length` | 2-char password accepted | Off-by-one: `>= 2` → `>= 8` |
| `simple_missing_import` | `NameError` on startup | Add missing `import` |
| `simple_wrong_status_code` | Create returns 200 instead of 201 | Change HTTP status constant |
| `simple_env_default` | Crash when env var unset | Add default value to `os.getenv()` |
| `simple_error_message` | Error text doesn't match test | Fix message string literal |

For simple fixtures, expected behavior per condition:
- `method-index-plus-skills` should not generate CandidateAnalysis or ChangePlan
- Token cost should be comparable to `baseline`
- `always-debate` should show obvious over-routing here

### Fixture file structure

```
evals/fixtures/<fixture-id>/
  task.md           issue shown to the model
  meta.json         category, difficulty, is_simple, expected_methods,
                    avoid_methods, true_root_cause, public_tests, hidden_tests
  expected.json     max_files_changed, max_patch_lines_soft,
                    disallowed_changes  [NOT shown to model]
  src/              buggy Python source files
  tests/
    test_public.py  symptom-revealing tests (new fixtures)
    test_hidden.py  root-cause boundary tests (new fixtures)
```

Existing 3 fixtures use a single `tests/` file; `public_tests` and `hidden_tests`
in `meta.json` point to specific node IDs within it.

### Scoring goals for v1 (24-30 fixtures)

Primary claim:

```
On N seeded bug fixtures spanning 5 bug categories,
method-index-plus-skills achieves X% all_tests_pass vs Y% for baseline,
with hidden_tests_pass gap of Z pp, at W% lower token cost than always-debate.
```

Key tables:
- `all_tests_pass_rate` by condition (all tasks)
- `hidden_tests_pass_rate` by condition (complex tasks only)
- `median_patch_lines` by condition
- simple task `pass_rate` + `avg_tokens` (confirm no over-routing penalty)
- `oracle-skill` ceiling vs `method-index-plus-skills` gap (measures router quality)

## Phase 2: External Benchmark Integration (Future)

After v1 fixtures are complete and results are stable, connect to established
benchmarks for external validity. Do not attempt this before 18+ fixtures are
working deterministically.

**QuixBugs** (~10 tasks from 40 available)
- 40 Python/Java programs each with one seeded one-line defect
- Failing + passing test cases provided
- Good for lightweight algorithmic repair comparison
- Limitation: biased toward algorithmic problems, not repo-level multi-file bugs

**BugsInPy** (sample from 493 real bugs)
- Real bugs from 17 popular Python projects, reproducible via provided harness
- Closer to real-world debugging than seeded fixtures
- Use a 10–15 task sample to avoid long setup cost

**SWE-bench Verified** (small sample, 10–20 tasks)
- GitHub issues + codebase → model must generate a fixing patch
- Gold standard for agent coding benchmarks
- Run only after internal fixtures show consistent signal; full SWE-bench is
  expensive and slow

Integration approach:
1. Wrap each external benchmark task as a Layer 3 fixture with the same
   `meta.json` / `expected.json` schema
2. Add a `source: quixbugs|bugsinpy|swe-bench` field to `meta.json`
3. Keep the same 8-condition runner; no changes to scorer

## Usage

Install dependencies:

```bash
pip install anthropic pyyaml
```

Set your API key:

```bash
export ANTHROPIC_API_KEY=sk-...
```

**Layer 1** (~28 × 8 = 224 API calls):

```bash
python runner.py
python scorer.py
```

**Layer 2** (~10 × 8 = 80 API calls):

```bash
python runner.py --tasks tasks/artifact-tasks.jsonl
python scorer.py --tasks tasks/artifact-tasks.jsonl
```

**Layer 2 with LLM judge** (80 extra Haiku calls):

```bash
python scorer.py --tasks tasks/artifact-tasks.jsonl --llm-judge
```

**Dry run** (no API calls):

```bash
python runner.py --dry-run
python runner.py --tasks tasks/artifact-tasks.jsonl --dry-run
```

**Single task:**

```bash
python runner.py --task art_repo_401 --condition baseline
python scorer.py --task art_repo_401
```

**Layer 3** (~3 × 8 = 24 API calls + pytest for each):

```bash
python layer3_runner.py
python layer3_scorer.py
```

**Layer 3 single fixture:**

```bash
python layer3_runner.py --fixture rate-limiter --condition baseline
python layer3_scorer.py --fixture rate-limiter
```

## Files

```
evals/
  runner.py                        Layer 1 + Layer 2 harness
  scorer.py                        Layer 1 + Layer 2 scorer
  layer3_runner.py                 Layer 3 harness (applies patch, runs pytest)
  layer3_scorer.py                 Layer 3 scorer (pass rate by condition + fixture)
  routing-tasks.jsonl              28 Layer 1 routing tasks
  route-rubric.md                  manual rubric for RoutePlans
  tasks/
    artifact-tasks.jsonl           10 Layer 2 artifact quality tasks
  rubrics/
    artifact-rubric.md             per-artifact quality rubric (0–3 per criterion)
  fixtures/
    rate-limiter/                  per-user vs global rate limit bug
    event-filter/                  inverted filter logic bug
    word-freq/                     punctuation-not-stripped tokenizer bug
  configs/                         system prompt per eval condition
    oracle-skill.yaml              oracle arm: injects expected_methods per fixture
  snippets/method-index.md         always-on index block
  results/                         raw result JSON (not committed)
    layer3/                        Layer 3 results (fixture × condition)
```

## Interpretation

The goal is not to show that Method Skills always improve results. Prior work
(SkillsBench, SWE-Skills-Bench) shows skills can be neutral or harmful when
mismatched. The goal is to measure *when* method routing helps and when to skip it.

A meaningful result shows `method-index-plus-skills` outperforms both `baseline`
and `always-debate` on `hidden_tests_pass` for complex tasks, with lower token
cost than `always-debate`, higher routing accuracy than `generic-long-prompt`,
and no over-routing penalty on simple tasks.

The `oracle-skill` arm sets the ceiling. A large gap between `oracle-skill` and
`method-index-plus-skills` on complex fixtures points to a routing problem, not
a skill-design problem.
