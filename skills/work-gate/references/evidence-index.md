# Evidence Index

Use this file when a user asks why a method is prioritized. These references
justify routing heuristics; they are not exhaustive. Treat entries with
`source_status: secondary_or_unverified` as hypotheses to validate before using
their numbers in public claims.

Default `checked_at`: 2026-05-24. Prefer primary papers, official docs, or
author/project pages. When a number comes from a secondary summary or has not
been table-checked, mark it explicitly.

## Candidate Generation and Aggregation

- Self-consistency improves chain-of-thought prompting by sampling multiple reasoning paths and aggregating answers. Reported gains include GSM8K +17.9%, SVAMP +11.0%, AQuA +12.2%, StrategyQA +6.4%, and ARC-Challenge +3.9%. source_status: primary_paper. Source: Wang et al., "Self-Consistency Improves Chain of Thought Reasoning in Language Models", https://arxiv.org/abs/2203.11171
- AlphaCode emphasizes large-scale sampling, behavior filtering, clustering, and reranking; it reports average top 54.3% ranking in simulated Codeforces competitions. This supports sampling plus filtering as a strong baseline before debate in code-like search spaces. source_status: primary_paper. Source: Li et al., "Competition-Level Code Generation with AlphaCode", https://arxiv.org/abs/2203.07814

## Evidence Grounding

- RAG combines parametric and non-parametric memory, sets state of the art on three open-domain QA tasks in the original paper, and produces more specific, diverse, and factual text than a parametric-only baseline. source_status: primary_paper. Source: Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", https://arxiv.org/abs/2005.11401

## Search and Tool Feedback

- Tree of Thoughts reports 74% success on Game of 24 with GPT-4 versus 4% for standard chain-of-thought in the cited setup. source_status: primary_paper. Source: Yao et al., "Tree of Thoughts", https://arxiv.org/abs/2305.10601
- ReAct shows gains from reason-act-observe loops, including ALFWorld and WebShop improvements over act-only prompting. source_status: primary_paper. Source: Yao et al., "ReAct", https://arxiv.org/abs/2210.03629
- Reflexion uses verbal feedback after failures and reports 91% pass@1 on HumanEval versus an 80% GPT-4 baseline in the paper. source_status: primary_paper. Source: Shinn et al., https://arxiv.org/abs/2303.11366

## Structured Refinement and Schemas

- Self-Refine reports about 20% absolute average task-performance improvement across seven tasks using generate-feedback-refine loops. source_status: primary_paper. Source: Madaan et al., https://arxiv.org/abs/2303.17651
- OpenAI Structured Outputs reports 100% schema match on OpenAI's complex JSON schema eval for `gpt-4o-2024-08-06` with strict structured outputs. source_status: official_engineering_doc. Source: https://openai.com/index/introducing-structured-outputs-in-the-api/

## Coding and Repo Work

- SWE-agent reports SWE-bench pass@1 12.5% and HumanEvalFix 87.7%, emphasizing the value of agent-computer interfaces for repo navigation, editing, and tests. source_status: primary_paper. Source: Yang et al., https://arxiv.org/abs/2405.15793
- CodePlan frames repository-level coding as a planning problem and provides data/evaluation scripts for FSE 2024. source_status: author_project. Source: Microsoft CodePlan, https://github.com/microsoft/CodePlan
- SWE-Debate reports 41.4% Pass@1 on SWE-Bench-Verified; secondary summaries report ablations where removing multiple chain generation drops to 31.4%, removing edit plan drops to 35.4%, and removing debate drops to 37.2%. Use as a heuristic until primary paper tables are checked. source_status: secondary_or_unverified. Source: https://arxiv.org/abs/2507.23348

## Debate and Routing

- Multiagent Debate studies debate among multiple LLM instances and reports improvements on arithmetic, GSM8K, biographies, and MMLU; project material also illustrates cross-model debate between ChatGPT and Bard. Use as support that debate can help, not as proof that debate beats independent sampling in every task. source_status: primary_paper_or_author_project. Source: Du et al., "Improving Factuality and Reasoning in Language Models through Multiagent Debate", https://arxiv.org/abs/2305.14325
- "Voting or Consensus?" reports voting protocols improve reasoning tasks by 13.2%, consensus improves knowledge tasks by 2.8%, increasing agent count helps, and more discussion rounds before voting can reduce performance. source_status: primary_paper. Source: https://arxiv.org/abs/2502.19130
- "Debate or Vote?" finds majority voting accounts for most gains often attributed to multi-agent debate across seven NLP benchmarks. source_status: primary_paper. Source: https://arxiv.org/abs/2508.17536
- M3MAD-Bench evaluates multi-agent debate across domains and modalities and explicitly tracks token consumption and inference time. It supports treating MAD as task-dependent and cost-sensitive rather than a default. source_status: primary_paper. Source: https://arxiv.org/abs/2601.02854
- SkillRouter finds the full skill body is decisive for routing; removing the body causes 29-44 percentage point degradation, and the system reports 74.0% top-1 routing accuracy. source_status: primary_paper. Source: https://arxiv.org/abs/2603.22455

## Heterogeneous Model Aggregation

- Mixture-of-Agents reports strong multi-model aggregation results, including open-source MoA scoring 65.1% on AlpacaEval 2.0 compared with 57.5% for GPT-4 Omni in the cited setup. Use as evidence that multi-model aggregation can help open-ended output quality. source_status: primary_paper. Source: https://arxiv.org/abs/2406.04692
- "Rethinking Mixture-of-Agents" reports Self-MoA outperforming standard heterogeneous MoA by 6.6% on AlpacaEval 2.0 and by 3.8% on average across MMLU, CRUX, and MATH. Use as evidence that one strong model with multiple independent outputs is a serious baseline and that weak-model mixing can hurt. source_status: primary_paper. Source: https://arxiv.org/abs/2502.00674

## Routing Heuristics Derived From The Evidence

- Always compare debate against independent candidates plus aggregation or project checks.
- Prefer project checks, source checks, tests, and schemas over language debate.
- Use heterogeneous models when diversity is the variable or when critics/test writers are useful; avoid weak-model majority voting as a default.
- Treat different CLI harnesses as full-stack agent comparisons, not clean model comparisons.
