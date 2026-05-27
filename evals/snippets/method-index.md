# Method Skills Index Snippet

Paste this block into your `AGENTS.md`, `CLAUDE.md`, or system prompt to give
your agent compact awareness of the current skills.

---

```
[Method Skills Index] root: ./skills
debate-router: explicit-only debate router. Use only when the user or parent workflow explicitly asks to route/run a debate. Emit DebateRoute first, classify entry_case as requirement_debate, single_proposal_debate, candidate_debate, or judgment_debate, freeze candidates/judgments, run bounded critique + cross-review + arbitration, return DebateRecord, and end with DebateSummary containing status, final_recommendation, source_proposals, sourced_amendments, and derivation.
agent-launch: CLI launch helper for selected external agent CLIs; owns non-interactive command specs, env/profile isolation, sandbox, network, timeout, and redacted commands; does not decide whether to use CLIs or whether debate is useful. Artifact: AgentLaunchPlan.
self-check: explicit debate request means debate runs or a blocker is recorded; do not down-route to a non-debate workflow, RoutePlan, or broad entry gate.
```

---

See `evals/configs/method-index.yaml` for how this is used in eval conditions.
