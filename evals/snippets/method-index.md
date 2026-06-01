# Method Skills Index Snippet

Paste this block into your `AGENTS.md`, `CLAUDE.md`, or system prompt to give
your agent compact awareness of the current skills.

---

```
[Method Skills Index] root: ./skills
debate-router: explicit-only debate router. Use only when the user or parent workflow explicitly asks to route/run a debate. Caller signals like "讨论", "辩论", "discuss", or "debate" select heterogeneous_cli_agents and cli-launch for proposal generation and debate execution. Build DebateRoute as classifier state (classify entry_case as requirement_debate, single_proposal_debate, candidate_debate, or judgment_debate), freeze candidates/judgments, run bounded critique + cross-review + arbitration, and produce DebateRecord and DebateSummary as audit state. DebateRecord contains phase-level cli_participation when external CLIs were selected or attempted. External CLI proposal_generation uses cli-launch phase-aware timeout 1800s by default; do not mark quiet proposers failed/no_output before the configured timeout unless concretely blocked. DebateSummary contains status, final_recommendation, source_proposals, sourced_amendments, and derivation; status reports run health, while arbiter.decision reports the arbitration action and uses blocked only with status: blocked. Preserve any caller-required or implied final format, template, schema, checklist, journal shape, wiki/archive format, table, frontmatter, YAML, or JSON. Treat review/re-review/复盘/归档/更新/整理/重审 of Diary, relationship, llmwiki, daily notes, reports, or existing documents as caller_format even when the template is not repeated. Use the human-first sections (Decision, Rationale, Dissent, Open Questions, optional Next Step, Archive, then Trace last) only when no caller/source format exists. Archive the audit envelope under ~/.debate-router/<run-id>/audit.yaml and reference that path only when the visible format allows it; the visible answer must match DebateSummary.final_recommendation and Trace, if shown, must match DebateRecord.cli_participation.
cli-launch: CLI launch helper for selected external agent CLIs; owns non-interactive command specs, env/profile isolation, sandbox, network, phase-aware timeout, and redacted commands; does not decide whether to use CLIs or whether debate is useful. Artifact: AgentLaunchPlan.
self-check: explicit debate request means debate runs or a blocker is recorded; do not down-route to a non-debate workflow, RoutePlan, or broad entry gate.
```

---

See `evals/configs/method-index.yaml` for how this is used in eval conditions.
