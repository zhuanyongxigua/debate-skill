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
"debate", "argue about", "讨论", or "辩论", that selects a multi-CLI debate. By
default you **plan and run the bounded debate yourself in this session**, but you
do not spawn CLIs directly (the parent is sandboxed): you delegate each phase's
worker launches to an out-of-sandbox daemon by writing a `run_batch_request` to
`~/.debate-router/requests/`, reading the workers' outputs back, and composing
the debate (normalization, critique, cross-review, arbitration) here. See
`Execution Path`. Spawn the CLIs yourself in-session via `cli-launch` only when
the human explicitly asks for the in-session CLI debate (a non-sandboxed parent).

## Required Output

> **Scope.** This section and everything below about *running* the debate
> (`DebateRoute` / `DebateRecord` / `DebateSummary`, proposal generation,
> critique, arbitration) applies whenever you run the debate — which is **both**
> execution paths: the **default** run-batch-over-the-mailbox path *and* the
> explicit in-session `cli-launch` path. You produce the `DebateRecord` / `Trace`
> in-session in both. The two paths differ only in how worker CLIs are launched
> (a `run_batch_request` to the daemon vs a direct `cli-launch` spawn).

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

You run the bounded debate **yourself** (entry case, candidate freeze, critique,
cross-review, arbitration, `DebateRecord`). The daemon only **executes worker
CLIs** — it owns no debate semantics. How you launch those workers depends on the
parent environment; everything else (Entry Cases, Debate Styles, Debate Rules,
Phase Concurrency, Final Synthesis) is identical either way.

- **Default — run-batch over the mailbox (sandboxed parent).** You cannot spawn a
  CLI, but you can read/write files. Plan the debate, then launch each phase's
  independent workers by writing a `run_batch_request`, polling for the response,
  and reading the embedded outputs. Compose the rest here.
- **Only on explicit request — `cli-launch` in-session (non-sandboxed parent).**
  When the human explicitly asks to spawn the CLIs directly, run the same debate
  but launch workers through `cli-launch` instead of the mailbox.

### Default: plan, execute workers via run-batch, compose, present

Plan and run the whole bounded debate in THIS context; delegate only the actual
CLI worker launches to the out-of-sandbox daemon through the file mailbox.
Writing/reading files is allowed in a sandboxed parent; spawning CLIs is not,
which is why workers go through the mailbox.

**Step 1 — Write a `run_batch_request` for the phase.** Create
`~/.debate-router/requests/` if needed and write one batch file holding all of
ONE phase's independent workers. Pick a unique `<id>` per phase
(`YYYYMMDD-HHMMSS-slug`, e.g. `…-proposals`, `…-critique`).

`~/.debate-router/requests/<id>.json`:

```json
{
  "schema_version": 1,
  "id": "<YYYYMMDD-HHMMSS-slug>",
  "kind": "run_batch_request",
  "repo": "<absolute repo path>",
  "fast": false,
  "items": [
    { "item_id": "P1", "provider": "codex",  "prompt": "<full worker prompt>", "phase": "proposal_generation" },
    { "item_id": "P2", "provider": "claude", "prompt": "<full worker prompt>", "phase": "proposal_generation" }
  ]
}
```

- Each item is an **independent read-only worker**: write the COMPLETE prompt it
  needs (workers do not run this skill — they only answer the prompt you give).
  Write every worker prompt in the **human's language** (their primary language in
  this conversation), and bake any required output shape into the prompt.
- `repo`: an **absolute** path under an allowlisted root — resolve it yourself
  (e.g. from the cwd); a relative path, or a path outside the roots, is rejected.
- `provider`: **allocate providers yourself** (e.g. 2 `codex` + 2 `claude`). A
  non-allowlisted provider returns as a `rejected` item — adapt around it.
- `phase`: optional audit label; pick the matching phase so the worker gets a
  sensible default timeout.
- `fast`: set `true` on urgency signals ("快一点", "尽快", "hurry", "fast"); it
  launches every worker in turbo mode. You separately decide whether to also run a
  leaner debate (fewer agents, merged phases).
- Capability is **forced read-only** by the daemon; never ask a worker to edit.
- One request fans out in parallel (capped by the allowlist), so put a whole
  phase's independent workers in ONE request — not one request per worker.

**Step 2 — Watch for the response.** Poll `~/.debate-router/responses/` for
**`<id>.json`**. The companion **`<id>.log`** is a live progress log (you, or any
other agent, can read/tail it to see how far the daemon has gotten); it is **not**
the response and appears before/during processing. Open-ended listening: do
**not** stop merely because a few polls produced no response, and do **not** treat
`<id>.log` as the response. Reading the same path repeatedly is fine; do **not**
spawn anything to wait.

**Step 3 — Read the outputs.** The response is a `run_batch_result`; each
`items[].output` is that worker's **full stdout**, embedded so you read it
directly from the mailbox (you do **not** need access to `~/.debate-agent/`).

```json
{
  "schema_version": 1,
  "request_id": "<same id>",
  "kind": "run_batch_result",
  "status": "completed|degraded|error",
  "status_reason": "",
  "items": [
    { "item_id": "P1", "provider": "codex",  "status": "completed", "output": "<worker stdout>" },
    { "item_id": "P2", "provider": "claude", "status": "completed", "output": "<worker stdout>" }
  ]
}
```

`degraded` means one or more items did not complete (`rejected` / `error` /
`timed_out`); the others still ran. Adapt around a missing worker per the
protocol's degrade rules; do not silently drop it from the `Trace`.

**Step 4 — Run the next phase, then arbitrate.** Drive the protocol's phases:
proposal generation → normalization → independent critique → cross-review →
arbitration. Phases with **independent** workers each go out as one
`run_batch_request` (proposal generation, the first critique round, cross-CLI
probes). **Serial** phases — normalization, cross-review, arbitration, final
rendering — you do **yourself in this context**, reading the prior phase's
embedded outputs. You MAY delegate a heavy synthesis/arbitration pass to a CLI by
sending a one-item `run_batch_request`, but the default is to arbitrate here — it
needs no extra CLI round-trip.

**Step 5 — Archive + present.** Build `DebateRecord` / `DebateSummary` from the
phases you ran, archive to `~/.debate-router/<run-id>/audit.yaml`, then present
the final answer (the human-first layout, or the caller's required format if the
task demanded one). Build the visible `Trace` from the `run_batch` responses you
collected — one row per worker per phase (`provider`, `status`), including
rejected/failed workers. Do not fabricate rows.

**If the parent environment interrupts** before a phase response appears, tell the
user the pending `<id>`(s), the request path, and the expected response path, and
that the work is still pending. If asked for status only, read the latest line of
`~/.debate-router/responses/<id>.log` and report it. Do not fabricate a result.

### Only on explicit request: cli-launch (run the debate in-session)

If — and only if — the human explicitly asks to run the debate via local CLIs
(e.g. "use the CLI debate", "spawn the CLIs directly"), run the SAME bounded
debate but spawn the selected external CLIs directly through `cli-launch` instead
of the mailbox (requires a parent that can spawn CLIs, i.e. not sandboxed).
`debate-router` owns the full flow either way — entry case, candidate freeze,
roles, provider allocation, proposal generation, critique, cross-review, and
arbitration — and the `CLI Topology`, `Phase Concurrency`, and workflow sections
below apply. **Allocate providers yourself** (e.g. four agents = two `codex` +
two `claude`); `cli-launch` only launches what this skill decides and never
balances providers.

## CLI Topology

> Applies whenever you run the debate (both paths). The only difference: on the
> default path you "launch" a CLI by adding it as an item in a
> `run_batch_request`; on the explicit in-session path you spawn it via
> `cli-launch`. The role/allocation/recording rules are identical.

`debate-router` does not decide whether external CLI agents are worth using.

When the human has explicitly asked to run the debate in-session:

- Discussion/debate signals select `heterogeneous_cli_agents`. Plan two or more
  external CLI agents and spawn them through `cli-launch`. Prefer the locally
  configured debate CLIs, and record any unavailable selected CLI as blocked
  instead of silently falling back to current-session debate.
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

> Applies whenever you run the debate (both paths). On the default path,
> "fan out in parallel" means **put all of that phase's independent workers in one
> `run_batch_request`** (the daemon runs them concurrently, capped by the
> allowlist); on the in-session path it means `cli-launch.run_specs_parallel`.

When a phase has multiple selected CLIs whose outputs do not depend on each
other, fan them out in parallel — one `run_batch_request` holding all of them
(default path) or `cli-launch.run_specs_parallel` (in-session). Parallel is the
default for any independent phase; running independent CLIs serially is a
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
`timed_out`, `error`). Translate those into `DebateRecord.cli_participation`
rows.

Even within phases that should fan out, parallelism is a default, not an
absolute. Skip it when only one CLI is selected for that phase, when the
caller has explicitly chosen sequential isolation
(`topology: sequential_isolated`), or when a shared rate-limited backend
would make concurrent calls counterproductive. Record the reason in
`DebateRecord` whenever the default fan-out is not used.

## Workflow

> This full workflow runs on **both** execution paths. The only difference is how
> each phase's workers are launched: on the **default** path you write a
> `run_batch_request` per independent phase and read the embedded outputs back
> (see `Execution Path`); on the explicit in-session path you spawn them via
> `cli-launch`. Steps 1–3 (classification) and the serial steps (normalization,
> cross-review, arbitration, archive, render) you always do in-session.

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
   agents as proposers before normalization.
   When two or more external CLI proposers are selected, fan them out in
   parallel — one `run_batch_request` holding all proposers (default path) or
   `cli-launch.run_specs_parallel` (in-session). See `Phase Concurrency`.
5. For the other entry cases, freeze the user-provided proposal, candidates, or
   judgments before critique.
6. Run one independent critique round. If the trigger was a discussion/debate
   signal, run this round through the selected external CLI agents. When two
   or more external critics are selected, fan them out in parallel — one
   `run_batch_request` holding all critics (default path) or
   `cli-launch.run_specs_parallel` (in-session). See `Phase Concurrency`.
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
  current session when external CLIs are available.
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

## References

- Read `references/debate-agent-policy.md` when external CLI agents,
  same-runtime roles, or harness differences matter.
- Read `references/debate-protocol.md` when producing `DebateRecord`.
