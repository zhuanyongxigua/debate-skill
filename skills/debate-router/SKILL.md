---
name: debate-router
description: Route an explicitly requested debate into requirement, single-proposal, candidate, or judgment debate, then run the bounded debate, archive DebateRecord, and preserve any caller-required or implied final output format. Use only when the user or a parent workflow explicitly invokes debate-router or asks to route/run a debate; do not use it to decide whether debate is necessary.
---

# Debate Router

## Overview

Use `debate-router` after the user or a parent workflow has already selected
debate. This skill does not decide whether debate is worth doing.

It answers one question:

```text
What kind of debate input is this, and how should the bounded debate run?
```

When `debate-router` is explicitly invoked, run a debate. Do not replace it
with another non-debate workflow because the task seems simple, checkable, or
expensive. If the debate cannot run, record the concrete blocker in the
`DebateRecord`.

If the caller uses explicit discussion or debate signals such as "discuss",
"debate", "argue about", "讨论", or "辩论", that selects an external
CLI-backed debate. Provider choice defaults to **codex only** in every execution
path; use multiple providers only when the caller explicitly asks for
heterogeneous / multi-provider CLI debate. This skill runs in one of **three
modes** (see `Execution Path`):

- **Mode 2 — emit a request file (DEFAULT).** You are sandboxed and cannot spawn
  a CLI, so you only write ONE high-level `debate_request` to
  `~/.debate-router/requests/`, watch for the response, and present it. The
  out-of-sandbox `debate-agent` daemon does everything in between — it plans the
  debate (calling you back in Mode 3) and executes it. You do not run the debate.
- **Mode 3 — planner.** The daemon's planner step invokes you (read-only, out of
  sandbox) to design the debate as a structured **plan**. You apply the debate
  STRATEGY below; the daemon supplies the exact output format and validates it.
- **Mode 1 — cli-launch in-session.** Only when the human explicitly asks to run
  the debate via local CLIs in a non-sandboxed parent: you run the whole bounded
  debate yourself, spawning CLIs through `cli-launch`.

## Required Output

> **Scope.** This section and everything below about *running* the debate
> (`DebateRoute` / `DebateRecord` / `DebateSummary`, proposal generation,
> critique, arbitration) applies only when you actually **run** the debate
> in-session — i.e. **Mode 1** (`cli-launch`). In **Mode 2** you only write the
> request file and later *present* the daemon's `answer_markdown` (re-rendering to
> a caller-required format here); you do not run the debate or produce a
> `DebateRecord` / `Trace`. In **Mode 3** you output a structured plan in the
> format the daemon gives you (no `DebateRecord`).

Caller output format outranks the debate-router visible layout. This is a
mandatory final-output gate, not a style preference.

Before choosing the visible layout, classify the final output contract:

- `caller_format`: use when the original task, parent workflow, repository,
  source artifact, or user message specifies or implies a final format.
- `default_debate_layout`: use only when no caller/source format exists and the
  user is asking for an open chat answer.

Treat these as `caller_format` even if the exact template is not repeated in
the current message:

- the task says to review, re-review,复盘,归档,更新,整理,重审, or rewrite an
  existing document or note
- the task names a structured artifact type such as `Diary`, `relationship`,
  llmwiki, daily note, journal, report, memo, PR template, checklist, YAML,
  JSON, frontmatter, table, or archive
- the source document already has headings, frontmatter, fields, bullets, or
  other visible structure
- a parent tool, project convention, or previous instruction owns the output
  shape

If the format is uncertain, preserve the source or parent format. Do not fall
back to the default `Decision` / `Rationale` / `Trace` layout merely because
the exact template was not included in the latest user message.

If the original task, parent workflow, repository, or user message specifies a
fixed final format, template, schema, frontmatter, checklist, journal entry
shape, archive format, or "output exactly like this" contract, preserve that
format exactly. Run the debate as internal work, archive the structured audit
envelope, then render the final answer in the caller's required format. Do not
replace the caller's format with `Decision` / `Rationale` / `Dissent` /
`Open Questions` / `Archive` / `Trace`. Add an archive reference only if the
caller format has a compatible metadata, notes, provenance, or footer field;
otherwise keep the archive path out of the visible output and rely on the
written audit file.

When the final output contract is `default_debate_layout`, the default output is
human-first. Lead with what the human needs in order to act, then archive the
structured audit envelope behind it. The full YAML (`DebateRoute`,
`DebateRecord`, `DebateSummary`) is still produced as audit state, but it is not
part of the normal final answer.

Default visible layout when no caller format exists:

```markdown
## Decision
<one paragraph or short bullet list stating the final recommendation>

## Rationale
<2-5 short sentences naming the base proposal and any accepted amendments by
ID, plus the key evidence or constraint that decided it>

## Dissent
- P2: rejected, short reason
- challenged fragment from P4: who challenged, why the arbiter still accepted
  or rejected it

## Open Questions
- next probe, missing evidence, or unresolved constraint

## Next Step  (optional, only when the arbiter set a concrete next_action)
- one short action

## Archive
- Full debate record: `~/.debate-router/<run-id>/audit.yaml`

## Trace
| ID | Phase | Source | Status | Role | Note |
|----|-------|--------|--------|------|------|
| P1 | proposal_generation | codex-cli | ran | base proposal | main structure |
| P3 | proposal_generation | claude-code | unavailable | proposer | login required |
| A1 | debate_execution | copilot-cli | ran | amendment (constraint) | accepted because ... |
| — | debate_execution | claude-code | failed | critic | timed out before critique |
| — | arbitration | arbiter | ran | decision | select(P1) + adopt(A1 from P3) |
```

The `Trace` table is the compact human-readable form of the audit state and
CLI participation. It is generated from `DebateRecord.cli_participation`,
`frozen_candidates`, `source_proposals`, `sourced_amendments`, critic findings,
and the arbiter decision. Every row that names a proposal, amendment, or
fragment must trace back to a corresponding ID in the audit envelope; every
row that names a CLI must trace back to `DebateRecord.cli_participation` or
launch results. The table is not free narration.

When external CLI agents were selected, planned, launched, or attempted,
`Trace` must include those CLIs even if they failed or were unavailable. Keep
`proposal_generation` and `debate_execution` as separate phases so the caller
can see whether the multi-path proposal phase and the debate phase used the
same or different CLIs. Use `status: ran|failed|blocked|unavailable` for CLI
rows and include a short note for failures or missing agents. Keep `Trace` as
the final visible section so the output leads with the actionable answer and
puts provenance after the archive pointer.

`Dissent` must name rejected proposals and any challenged fragment the arbiter
nevertheless accepted, with the reason. `Open Questions` lists probes or
unresolved evidence gaps. `Next Step` is optional and only included when the
arbiter set a concrete next action.

The structured audit envelope (`DebateRoute`, `DebateRecord`, `DebateSummary`)
is still required, but as archived audit state rather than final-answer
content. Write it to `~/.debate-router/<run-id>/audit.yaml`, where `<run-id>`
is stable enough to find later (for example, `YYYYMMDD-HHMMSS-<short-slug>`).
When the default layout is used, the final answer includes only a compact
`Archive` reference with that path. When a caller-required format is used, add
the archive reference only if that format provides a compatible field. Never
append the full YAML as `## Audit`.
Create the archive directory if it does not exist. If the archive cannot be
written, state that failure in `Decision`/`Open Questions` and record the
archive failure in the debate status instead of silently dropping the envelope.

When the user later asks for debate details, read the archived YAML and answer
from it. Do not dump the full YAML into the conversation unless the user
explicitly asks for the raw record.

Do not stop after visible output if a required input, CLI, permission, or
artifact is unavailable. Still emit the audit envelope with
`DebateSummary.status: "blocked"` (or `"degraded"`) and `status_reason`, and
state the same in the default `Decision` and `Dissent` sections or in the
equivalent fields of the caller-required format.

The audit envelopes keep their existing shapes:

```yaml
DebateRoute:
  entry_case: "requirement_debate|single_proposal_debate|candidate_debate|judgment_debate"
  debate_style: "parallel_positions|proposal_attack|frozen_candidates"
  topology: "current_session|same_runtime_multi_agent|single_external_cli_agent|heterogeneous_cli_agents|sequential_isolated"
  selected_cli_agents: []
  why: ""
  next: "DebateRecord"
```

`DebateRecord` must include `cli_participation` when any external CLI was
selected or attempted. Use separate `proposal_generation` and
`debate_execution` lists; each item names the CLI, phase role, status
(`ran|failed|blocked|unavailable`), configured timeout, observed wait when
available, and a short note.

```yaml
DebateSummary:
  input_classification: "requirement|single_proposal|multiple_candidates|conflicting_judgments"
  status: "completed|degraded|blocked"
  status_reason: ""
  classification_reason: ""
  process_summary: ""
  final_recommendation:
    summary: ""
    rationale: ""
  source_proposals:
    - id: "P1"
      contribution: ""
  base_proposal_id: "P1" # optional; omit or null for pure synthesis
  sourced_amendments:
    - amendment_id: "A1"
      kind: "adopt|override|constraint|caution"
      source_proposal_id: "P3"
      source_excerpt: ""
      interpretation: ""
      rationale: ""
      debate_basis:
        supported_by: []
        challenged_by: []
        arbiter_reason: ""
  derivation:
    explanation: ""
```

Keep `DebateSummary` brief. `input_classification` says whether this concrete
input was treated as a requirement, one proposal, multiple proposals, or
conflicting judgments. `status` is `completed` for normal arbitration,
`degraded` when the debate could not meet its normal candidate or evidence
threshold, and `blocked` when a required input, permission, CLI, or artifact
was unavailable. Use the same envelope in all cases; empty `source_proposals`
and `sourced_amendments` are valid when nothing survived debate.
`process_summary` should be one or two sentences about what was frozen, which
critique/cross-review shape ran, and how arbitration ended. `source_proposals`
contains at most two frozen proposal IDs that materially contributed to the
final recommendation; they are not pre-debate rankings or runners-up.
`sourced_amendments` may salvage useful fragments from non-selected, weak, or
rejected proposals only when the debate and arbiter explicitly accepted that
fragment.

Status and arbiter decision have separate jobs:

- `DebateSummary.status` describes run health.
  - `completed`: normal proposal generation, critique, cross-review, archive,
    and arbitration completed.
  - `degraded`: the debate ran with a recorded limitation, such as fewer than
    two distinct normalized proposals, one selected CLI unavailable while other
    independent evidence remained, an unrestarted coverage gap, or weaker role
    separation than requested.
  - `blocked`: a required input, permission, selected CLI, archive file, or
    required artifact was unavailable, so the requested debate could not be
    completed.
- `DebateRecord.arbiter.decision` describes the arbitration action.
  - For `status: completed`, use the actual action:
    `select|combine|revise|reject|probe|escalate`.
  - For `status: degraded`, still use the actual best available action:
    `select|combine|revise|reject|probe|escalate`; do not use `blocked`
    merely because the result is degraded.
  - Use `arbiter.decision: "blocked"` only when `status: blocked` and no
    responsible arbitration could be completed. Put the concrete blocker in
    `status_reason`, `arbiter.next_action`, and the visible `Decision` or
    `Open Questions`.

The visible final answer must stay consistent with
`DebateSummary.final_recommendation`. In the default layout, `Decision` and
`Rationale` carry that consistency requirement. `Trace` rows, when shown, must
stay consistent with `DebateRecord.execution_topology`,
`DebateRecord.proposal_generation`, `DebateRecord.cli_participation`,
`frozen_candidates`, `source_proposals`, `sourced_amendments`, critic findings,
and the arbiter decision. If visible output and audit state disagree, the audit
envelope wins and the visible output must be revised to match before the run is
considered complete.

## Entry Cases

Classify the input shape only:

- `requirement_debate`: the user provided a raw requirement, problem, question,
  or goal, but no concrete proposal. Generate 2-4 candidate positions or
  proposals first, freeze them, then debate. If external CLI agents were
  selected, use those selected agents as independent proposers where practical.
- `single_proposal_debate`: the user provided one proposal, plan, patch,
  design, review, or claim. Freeze it and debate adopt, revise, reject, or
  probe.
- `candidate_debate`: the user provided multiple proposals, plans, patches,
  answers, or approaches. Preserve and freeze the existing candidates before
  critique.
- `judgment_debate`: the artifact may be singular, but there are conflicting
  reviews, judgments, findings, or claims about it. Freeze those judgments as
  the debate candidates.

If the input is ambiguous, choose the nearest case and record the assumption in
`DebateRoute.why`. Ask a question only when the missing information makes all
four cases impossible.

## Debate Styles

- `parallel_positions`: independent candidate positions are presented first,
  then cross-reviewed. Use for `requirement_debate` and broad tradeoffs.
- `proposal_attack`: one frozen proposal is defended, attacked, and revised or
  rejected. Use for `single_proposal_debate`.
- `frozen_candidates`: existing candidates or judgments are cross-critiqued and
  arbitrated. Use for `candidate_debate` and `judgment_debate`.

## Debate Rules

- Freeze candidates or judgments before critique.
- Do not let critics rewrite frozen candidates during critique.
- Cross-review is required: each critic must inspect the other critic findings
  before arbitration.
- The arbiter decides from evidence, risk, reversibility, constraints, and
  probe availability. Do not decide by vote count, confidence, or consensus
  pressure.
- Cap the debate to one independent critique round, one cross-review round, and
  arbitration unless the user explicitly asks for more.
- Project checks, source checks, tests, schemas, calculators, or cheap probes
  may be used as evidence or recommended as next probes. They are not a reason
  to cancel the debate once this skill is active.
- Requirement debates own candidate generation for that debate. This is not a
  separate multi-path analysis method: generate only the positions needed for
  the debate, then freeze them.
- For `requirement_debate`, run proposal generation as four phases:
  `proposal_generation`, `proposal_normalization`, `debate_execution`, then
  `degraded_or_reopen`.
- `proposal_generation` produces raw proposals from selected external CLI
  proposers when provided; otherwise use same-runtime or current-session
  proposers. External CLI proposal generation is usually slower than a critic
  pass; spawn it via `cli-launch` with `phase: "proposal_generation"` and a
  default `timeout_seconds: 1800` unless the caller explicitly chose another
  budget. Do not mark a proposer `failed/no_output` merely because a short poll
  has no readable output.
- `proposal_normalization` validates proposals, removes near-duplicates,
  trims or supplements to 2-4 distinct proposals, assigns stable IDs, and
  records proposer source and fallback reasons. It may normalize; it must not
  rank, score, or choose a winner.
- If fewer than two distinct usable proposals survive normalization, return a
  degraded `DebateRecord` instead of pretending to debate a single proposal.
- Debate execution is read-only over the frozen proposal set. If a major
  coverage gap appears, record it in `DebateSummary`. Restart
  `proposal_generation` at most once, only when the caller explicitly allows a
  restart and the rationale is recorded in `degraded_or_reopen`. If restart is
  unavailable or the one allowed restart has already been used, finish with
  `status: degraded`.
- Do not add new candidates to `candidate_debate` or `judgment_debate` unless a
  missing baseline or control candidate is necessary; if added, label it as
  generated after the user-provided candidates.

## Final Synthesis

Final synthesis can combine proposals, but only with traceable debate support.

Proposal state terms:

- `non_selected`: a proposal was not chosen as the base or a primary source.
- `weak`: critics or the arbiter found the proposal insufficient as a full
  answer, but not all of its parts were invalidated.
- `rejected`: the arbiter explicitly rejected the proposal as a solution.

`weak` and `rejected` proposals may contribute only through
`sourced_amendments`.

- Select a `base_proposal_id` when the final recommendation is primarily
  derived from one frozen proposal. Leave it null only for explicit synthesis
  cases.
- Fill `source_proposals` with 0-2 frozen proposal IDs whose content,
  structure, or constraints materially contributed to the final recommendation.
  Commit these before writing the final rationale. Use ID plus one short
  contribution sentence only; full proposal text stays in `DebateRecord`.
  Treat the list as contribution-ordered: base proposal first when present,
  then other material contributors. Never preserve pre-debate rank as the
  ordering key.
- Useful fragments from non-selected, weak, or rejected proposals may enter the
  final recommendation only as `sourced_amendments`.
- Each `sourced_amendment` must include a verbatim `source_excerpt`, a separate
  `interpretation`, a `rationale`, and `debate_basis`. The `debate_basis` names
  which critic findings supported it, which challenged it, and why the arbiter
  accepted it.
- A challenged fragment can be accepted only when `arbiter_reason` explains why
  the challenge does not defeat the fragment. Conditional acceptance must be
  recorded as a constraint or caution amendment.
- Amendments must point back to an original frozen proposal, not to another
  amendment. Do not create amendment-of-amendment chains.
- Rejected proposals do not become `source_proposals` merely because one
  fragment was salvaged. Cite the fragment through `sourced_amendments`.
- `arbiter_notes`, when used in the full protocol, may resolve conflicts or
  record external constraints and assumptions. They must not introduce a
  replacement design.
- The final recommendation should visibly credit salvaged fragments, for
  example `[from P3]`, so valid fragments from weak proposals are not laundered
  into the result without attribution.

## Execution Path

This skill runs in three modes. **Default to Mode 2 (emit a request file).**

### Mode 2 (default): emit a debate_request, watch, present

You are sandboxed: you can read/write files but cannot spawn a CLI (the parent's
top-level reviewer would kill that). So you do **not** run the debate — you write
ONE high-level request and let the out-of-sandbox `debate-agent` daemon plan and
run it. Do not invoke any other skill or spawn anything.

**Step 1 — Write the request file.** Create `~/.debate-router/requests/` if needed
and write ONE request with the task, the target repo, and the human's language.
Pick a unique `<id>` (`YYYYMMDD-HHMMSS-slug`).

`~/.debate-router/requests/<id>.json`:

```json
{
  "schema_version": 1,
  "id": "<YYYYMMDD-HHMMSS-slug>",
  "kind": "debate_request",
  "prompt": "<the requirement / candidates / question to debate>",
  "repo": "<absolute repo path>",
  "language": "<the human's primary language, e.g. 中文 / English>",
  "fast": true
}
```

- `prompt`: the whole task to debate — do **not** pre-plan phases or write worker
  prompts. In the full (`fast: false`) flow the daemon's planner does that (it calls
  you back in Mode 3); in the default `fast` flow there is no planner — the daemon
  wraps your `prompt` into the fixed 2-phase shape directly.
- `repo`: an **absolute** path under an allowlisted root — resolve it yourself
  (e.g. from the cwd); a relative path or one outside the roots comes back rejected.
- `language`: the language the human is using; the debate answers in it. Omit if
  unsure.
- `fast`: **this skill's default is `true`** — write it explicitly for the lean
  flow. When `true`, the daemon **skips the planner entirely** and runs a fixed
  lean 2-phase shape (two independent reviewers in parallel, then one arbiter),
  which is much faster and cheaper but **shallower** (generic worker prompts, no
  planner-designed debate). Set **`fast: false`** ONLY when the human explicitly
  asks for a serious / heavy / thorough debate — signals like "认真", "重度",
  "彻底", "深入", "详尽", "严谨", "全面", "thorough", "comprehensive", "rigorous",
  "in-depth", "deep dive", "exhaustive" or equivalent — which runs the
  **planner-designed debate**: the
  planner judges complexity and designs the phases (the full proposal → critique →
  cross-review → arbitration for a substantial task; it may still choose a leaner
  shape for one it judges genuinely simple). `fast` is purely about flow leanness;
  it does **not** control codex/claude turbo (codex always runs turbo). The raw
  daemon default when a hand-written request omits `fast` is conservative
  `false`, so this skill must write `fast: true` for default quick debates.
- `planner_provider`: optional; use only when the human explicitly asks to choose
  the planner CLI for a full debate. Set `fast: false` and then set
  `"planner_provider": "claude"` or `"codex"`. The value must also be in the
  effective `providers` list (omitted `providers` defaults to `["codex"]`). The
  daemon rejects it with `fast: true`, because fast requests skip the planner
  entirely.
- `providers`: optional. Normally omit it: omitted means `["codex"]`, so every
  daemon-launched role is codex by default. Use it only when the human explicitly
  asks for heterogeneous / multi-provider CLI debate or a non-codex engine is
  needed. It can only narrow the daemon's allowlist. Add multiple providers when
  needed, for example `"providers": ["codex", "claude"]`. In full mode
  (`fast: false`), the planner defaults to the first provider unless
  `planner_provider` is set. If you also set `planner_provider`, it must be
  included in `providers`.

> **Exactly these fields, nothing else.** The request has ONLY
> `schema_version, id, kind, prompt, repo, language, fast, planner_provider,
> providers`. Do **not** add any other field — a common mistake is a stale
> `output_contract`; the daemon rejects unknown fields. Put any required
> **output format / template** inside `prompt`.

**Step 1b — Check the request file.** After writing it, validate the format with
this skill's bundled checker (it catches the field mistake above before the daemon
round-trip):

```bash
node <this-skill-dir>/scripts/check-request.mjs ~/.debate-router/requests/<id>.json
```

Exit 0 = good; exit 1 prints the problem — fix and re-check. If your environment
cannot run `node` here, re-read the file and confirm it has only the fields
above; the daemon also rejects a bad request with a clear `error` response.

**Step 2 — Watch for the response.** Poll `~/.debate-router/responses/` for
**`<id>.json`** (a human may instead drop a plain `<id>.md`). The companion
**`<id>.log`** is a live progress log (plan attempts, each phase, each worker) —
you, or any other agent, can tail it for status, but it is **not** the response.
Open-ended listening: do **not** stop merely because a few polls produced no
response, and do **not** treat `<id>.log` as the response. Reading the same path
repeatedly is fine; do **not** spawn anything to wait.

Stop polling only when: `<id>.json` (or `<id>.md`) appears; the human gives a wait
limit that expires; the human interrupts / redirects / asks for status only; or
the parent forces the turn to end. If you stop for a non-response reason, read
`~/.debate-router/responses/<id>.log` and report the latest progress plus the
`<id>`, request path, expected response path, and that it is still pending.

**Step 3 — Present the result.** `responses/<id>.json` is a `debate_result`:
render `answer_markdown`; if `status` is not `completed`, say so briefly with
`status_reason`. `trace` is a faithful per-launch record (phase, item, provider,
status; plus `planned_provider` when the daemon moved a launch to another engine,
and `error_category` on a non-completed launch) you may surface if useful.
If the original task had a required output
format, render the answer in that format here (this is where Mode 2 still owns
caller-format preservation). Do **not** run the debate yourself or fabricate a
result.

### Mode 3: planner (invoked by the daemon's planner step)

The daemon runs the debate by first asking YOU (read-only, out of sandbox) to
design it as a structured **plan**, then executing that plan as read-only worker
CLIs. You enter this mode when the prompt says you are the planner and gives the
exact output format. You **never spawn or write files**; you only output the plan.

> **Only the full (`fast: false`) flow reaches this mode.** A `fast` request (the
> default) skips the planner entirely — the daemon runs a fixed lean 2-phase shape
> without calling you back — so Mode 3 is exercised only when the human explicitly
> asked for a serious/thorough debate.

Apply the debate STRATEGY in this skill (Entry Cases, Debate Styles, Debate Rules,
Final Synthesis) to design THIS task's debate: which phases, how many
proposers/critics, which providers, and each worker's full prompt. Then output the
plan in **exactly the format the daemon gave you** — the plan FORMAT lives in the
daemon, not in this skill, so follow its spec literally.

Rules in this mode:

- **Judge complexity first** and set `complexity`. **Simple** task (focused
  question, small/single-area change, clearly-scoped review) → emit the **FAST
  workflow**: Phase 1 = two independent reviewers in parallel; Phase 2 = one
  arbiter that reads `{{P1.output}}`+`{{P2.output}}` and writes the final answer.
  No separate critique/cross-review for a simple task — that lean shape mirrors
  `parallel_positions` + arbitration and is the whole point of going fast.
  Provider allocation still follows the request provider constraint: default
  codex-only means P1/P2/A1 are all `codex` at `xhigh`; if the caller explicitly
  requested heterogeneous providers and the constraint includes them, allocate
  across those providers.
  **Complex** task → design the full bounded debate (proposal → normalization →
  critique → cross-review → arbitration).
- **Pick `effort` per launch** (the daemon no longer hardcodes it). A launch has
  only `id`, `provider`, `effort`, `prompt` — there is **no per-launch `fast`
  field** (codex always runs in turbo mode in code; do not try to set it):
  - `codex`: generally `xhigh` (codex is fast and token-cheap).
  - `claude`: usually `high` is enough; use `xhigh`/`max` only when that launch
    needs deep reasoning.
- **Know what each provider can do**, and allocate accordingly:
  - `claude` worker = Read/Grep/Glob **and read-only git** (`git diff`/`log`/
    `show`/`status`/`blame`), but **no arbitrary shell**.
  - `codex` worker = read-only OS sandbox; can run **any read-only command**.
    Give tasks needing shell beyond git (build, run tests, broad inspection) to
    `codex`.
- **Write focused worker prompts**: give each a concrete anchor (which change /
  artifact to look at) and tell it to read the affected code **and its
  callers/dependents** to assess impact. Do **not** say "explore the whole repo",
  and do **not** restrict it to only the diff — a real review needs the
  surrounding code.
- Each launch is one independent read-only worker: write its COMPLETE,
  self-contained prompt (workers do not run this skill; they only answer your
  prompt). Write every worker prompt and the final answer in the human's language.
- A later phase's prompt may embed an EARLIER launch's output via the placeholder
  the daemon specifies (e.g. `{{P1.output}}`); write the surrounding framing
  yourself ("Here are the proposals:\n{{P1.output}}\n…\nCritique them."). Launches
  within one phase run in **parallel** and must not depend on each other.
- Designate the launch whose output is the final answer; its prompt must instruct
  that worker to write the final answer in the required layout and language.
- Do **not** call `cli-launch`, do **not** write files, do **not** execute
  anything, do **not** include a Trace. Output **only** the plan.

### Mode 1 (only on explicit request): cli-launch in-session

If — and only if — the human explicitly asks to run the debate via local CLIs
(e.g. "use the CLI debate", "spawn the CLIs directly") in a non-sandboxed parent,
run the whole bounded debate yourself and spawn the selected CLIs directly through
`cli-launch`. Here `debate-router` owns the full flow — entry case, candidate
freeze, roles, provider allocation, proposal generation, critique, cross-review,
and arbitration — and the `CLI Topology`, `Phase Concurrency`, and workflow
sections below apply. **Allocate providers yourself**: default every CLI role to
`codex`; add `claude` or other providers only for an explicit heterogeneous
request. `cli-launch` only launches what this skill decides and never balances
providers.

## CLI Topology

> Applies only to **Mode 1** (running the debate in-session via `cli-launch`). In
> Mode 2 you only write the request file; in Mode 3 you output a plan (its
> per-launch `provider` choices follow the same allocation rules).

`debate-router` does not decide whether external CLI agents are worth using.

When the human has explicitly asked to run the debate in-session:

- Discussion/debate signals select external CLI-backed debate, but the default
  provider set is **codex only**. Plan codex roles by default and spawn them
  through `cli-launch`. Select `heterogeneous_cli_agents` and add multiple
  providers (for example codex + claude) only when the human explicitly asks for
  heterogeneous / multi-provider CLI debate, or names additional CLIs. Record any
  unavailable selected CLI as blocked instead of silently falling back to
  current-session debate.
- If no external CLI agents are selected, run the bounded debate in the current
  session or same runtime.
- Record each selected or attempted CLI in `DebateRecord.cli_participation`.
  Separate `proposal_generation` from `debate_execution`; include failed,
  blocked, or unavailable CLIs instead of dropping them from the visible output.
  A `proposal_generation` row should use a proposer role, and a
  `debate_execution` row should use critic, cross-review, or other debate
  roles. Do not label a proposal-generation attempt as `critic`.
- Preserve explicit named-CLI requests such as Claude Code, Codex CLI, or
  Copilot CLI unless the selected CLI is unavailable, unsafe, or blocked.
- A proposer must not be the sole critic validating its own proposal. If the
  selected topology cannot provide role separation, record the limitation in
  `DebateRecord` and treat any self-review as weak evidence only.
- Do not launch interactive child-agent sessions.
- Do not let child agents edit files unless implementation was explicitly
  requested.

## Phase Concurrency

> Applies only to **Mode 1** (`cli-launch` in-session). In Mode 3 the same
> independence rule shapes the plan: put a phase's independent workers in the same
> plan phase (the daemon runs one phase's launches in parallel); never make one
> launch depend on another in the same phase.

When a phase has multiple selected CLIs whose outputs do not depend on each
other, fan them out in parallel via `cli-launch.run_specs_parallel`. Parallel is
the default for any independent phase; running independent CLIs serially is a
deviation and must be justified in `DebateRecord`.

The rule that decides parallel vs serial is one line: each child's output
must not read or depend on any other child's output within the same phase.

Phases that MUST fan out in parallel when more than one CLI runs them:

- `proposal_generation` — N proposers generate independent proposals from the
  same requirement.
- First independent `critique` round — each critic inspects the frozen
  candidates without seeing other critics' findings.
- Cross-CLI verification, voting, or ensemble probes where each CLI answers
  the same question independently.

Phases that MUST remain serial (even when multiple CLIs are involved):

- `proposal_normalization` — reads all proposals, produces one normalized
  list.
- `cross_review` — each critic reads the completed independent critique
  findings before producing their cross-review.
- `arbitration` — needs the full debate corpus to decide.
- Final rendering and archive write-out.
- Any phase that mutates shared state (transcripts, audit files, the same
  source artifact).

When fanning out, attach the per-call debate identifier through
`ParallelSpec.caller_metadata` (for example `{"phase": "proposal_generation",
"role": "proposer", "id": "P2"}`) so the returned `ParallelResult` can be
correlated back to the frozen-candidate ID without leaking debate semantics
into `cli-launch`. Results come back in input order, not completion order.

Per-spec failures, timeouts, retries, and "is this enough surviving evidence
to continue" decisions belong to this skill, not to `cli-launch`. The
parallel helper only guarantees mechanical fan-out (process group, SIGTERM
then SIGKILL after a 10s grace period) and per-spec status (`completed`,
`timed_out`, `error`, and the failure refinement `rate_limited`). Translate
those into `DebateRecord.cli_participation` rows.

**Rate-limit fallback — same task, swap engine.** A subscription can run out of
quota mid-debate. When a result comes back `error_category: "rate_limited"`, do
**not** treat it as an ordinary failure and degrade: re-run the *same task* on the
next available selected engine, because the work still needs doing — only the
engine changed. In the default codex-only posture there is no alternate provider;
fallback applies only when the human selected multiple providers. Build the
alternate spec yourself (you hold the prompt) and hand it to `cli-launch` as a
pre-built fallback:
`cli-launch.run_specs_parallel_with_fallback` consumes each `ParallelSpec.fallbacks`
in order, swapping only on `rate_limited` and branching on status alone — never on
a child's text. Drop a provider-specific `effort` when you switch (claude `max`
is invalid for codex). Only when **every** allowed engine for that launch is
rate-limited do you record it as degraded. In Mode 2 the daemon's fallback is
broader: it may swap engines for any provider launch/completion failure (for example
`rate_limited`, `nonzero_exit`, `timeout`, `missing_cli`, or `exception`) while
leaving `rejected` validation failures unswapped. You just present the result, and
the `trace` shows the engine that actually ran (which may differ from a plan's
suggested provider).

Even within phases that should fan out, parallelism is a default, not an
absolute. Skip it when only one CLI is selected for that phase, when the
caller has explicitly chosen sequential isolation
(`topology: sequential_isolated`), or when a shared rate-limited backend
would make concurrent calls counterproductive. Record the reason in
`DebateRecord` whenever the default fan-out is not used.

## Workflow

> This full workflow runs only in **Mode 1** (`cli-launch` in-session). In Mode 2
> you write a `debate_request` and present the result; in Mode 3 you express this
> same strategy as a plan for the daemon (the planner uses the steps below to
> decide phases/launches, but does not run them). See `Execution Path`.

1. Classify the final output contract as `caller_format` or
   `default_debate_layout`. If the task is a document/wiki/diary/review/archive
   transformation or names a structured artifact type, choose `caller_format`
   even when the exact template is not repeated.
2. Identify whether the input is a requirement, one proposal, multiple
   candidates, or conflicting judgments.
3. Build the `DebateRoute` classification (entry case, debate style, topology,
   selected CLIs) as internal state. It is no longer required as the first
   visible block.
4. For `requirement_debate`, generate 2-4 candidate positions or proposals
   using the selected current-session, same-runtime, or external CLI agents,
   then freeze them.
   If the trigger was a discussion/debate signal, use the selected external CLI
   agents as proposers before normalization; by default that selected set is
   codex-only unless the human explicitly requested heterogeneous providers.
   When two or more external CLI proposers are selected, fan them out in
   parallel via `cli-launch.run_specs_parallel`. See `Phase Concurrency`.
5. For the other entry cases, freeze the user-provided proposal, candidates, or
   judgments before critique.
6. Run one independent critique round. If the trigger was a discussion/debate
   signal, run this round through the selected external CLI agents; by default
   that selected set is codex-only. When two or more external critics are selected,
   fan them out in parallel via
   `cli-launch.run_specs_parallel`. See `Phase Concurrency`.
7. Run one cross-review round. This round must remain serial across critics —
   each cross-reviewer reads the completed independent critique findings
   before producing their cross-review.
8. Arbitrate and build `DebateRecord`.
9. Build `DebateSummary` with final recommendation, source proposals, accepted
   amendments, and derivation.
10. Archive the audit envelope to `~/.debate-router/<run-id>/audit.yaml`.
11. Emit the final visible output:
    - If the final output contract is `caller_format`, render that format.
      Do not add the default debate-router sections unless the caller's format
      explicitly has a compatible place for them.
    - If the final output contract is `default_debate_layout`, emit the
      human-first sections in this order: `Decision`,
      `Rationale`, `Dissent`, `Open Questions`, optional `Next Step`,
      `Archive`, then `Trace` as the final visible section. Include only the
      archive path in the visible `Archive` section. Do not append `## Audit`
      or inline the YAML in the normal final answer. Derive `Trace` rows from
      `DebateRecord.cli_participation`, launch results, frozen candidates,
      source proposals, sourced amendments, critic findings, and arbiter
      decision; do not invent rows.

## Anti-Patterns

- Treating `debate-router` as a general entry gate.
- Asking "is debate needed?" after the skill was explicitly invoked.
- Treating "讨论", "辩论", "discuss", or "debate" as permission to stay in the
  current session when Codex CLI/external CLI execution is available.
- Leading the visible output with a full `DebateRoute:` or `DebateRecord:` YAML
  block when a human-first `Decision` / `Rationale` and final `Trace` would
  serve the caller better. The YAML belongs in
  `~/.debate-router/<run-id>/audit.yaml`.
- Replacing the human-first sections with YAML, appending `## Audit`, or
  burying the actual decision under audit state.
- Replacing a caller-required output format, journal template, schema, or
  archive format with the default debate-router visible layout.
- Treating `Diary`, `relationship`, llmwiki, daily note, report, memo,
  checklist, frontmatter, or archive tasks as open chat answers merely because
  the exact template was not pasted in the latest user message.
- Adding `Decision`, `Rationale`, `Trace`, or `Archive` sections to a fixed
  caller format that did not provide a compatible place for those fields.
- Producing the human-first sections without backing audit envelopes, or
  producing audit envelopes whose `final_recommendation` disagrees with the
  visible `Decision`.
- Omitting a selected or attempted external CLI from `Trace`,
  especially a failed, blocked, or unavailable CLI.
- Collapsing proposal-generation and debate-execution CLI participation into
  one ambiguous `Trace` phase when both phases used external CLIs.
- Inventing `Trace` rows that do not appear in `frozen_candidates`,
  `source_proposals`, `sourced_amendments`, critic findings, or the arbiter
  decision.
- Returning only a recommendation without archiving the audit envelope
  (`DebateRoute`, `DebateRecord`, `DebateSummary`) under `~/.debate-router/`.
- Salvaging a fragment because the summarizer likes it, without debate support
  and arbiter acceptance.
- Calling a rejected proposal one of the top proposals when only a small
  amendment was accepted from it.
- Generating new options for a `candidate_debate` without preserving the user's
  candidates.
- Letting critics edit the candidates they are critiquing.
- Using model votes, confidence, or consensus as the arbiter's evidence.
- Calling `cli-launch` to decide whether CLI agents should be used.
- Running independent CLI proposers or independent critics serially when
  `cli-launch.run_specs_parallel` could fan them out — parallel is the
  default for any phase that does not read prior child output.
- Fanning out `cross_review`, `arbitration`, `proposal_normalization`, final
  rendering, or any shared-state mutation through `run_specs_parallel` —
  those depend on prior outputs or single-writer state and must stay serial.
- Treating a `rate_limited` result as an ordinary failure when another selected
  provider is available. Default codex-only debates have no alternate provider;
  heterogeneous debates should re-run the same task on another selected engine.
  Only a launch with no un-rate-limited selected engine left degrades.

## References

- Read `references/debate-agent-policy.md` when external CLI agents,
  same-runtime roles, or harness differences matter.
- Read `references/debate-protocol.md` when producing `DebateRecord`.
