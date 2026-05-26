# Results

Raw result files from eval runs. Not committed to the repo.

Each file is named `{task_id}__{condition}.json`.

## Generate results

```bash
cd evals
pip install anthropic pyyaml
export ANTHROPIC_API_KEY=...
python runner.py
```

## Score results

```bash
python scorer.py
```

Outputs a summary table and writes `results/scores.jsonl`.

## Result format

```json
{
  "task_id": "repo-debug-401",
  "condition": "method-index-plus-skills",
  "model": "claude-opus-4-7",
  "output": "...",
  "tokens_in": 1200,
  "tokens_out": 800,
  "latency_ms": 12000
}
```

## Score format

```json
{
  "task_id": "repo-debug-401",
  "condition": "method-index-plus-skills",
  "model": "claude-opus-4-7",
  "route_plan_emitted": true,
  "critical_recall": 1.0,
  "critical_found": ["work-gate candidate analysis", "work-gate"],
  "critical_missing": [],
  "must_explain_recall": 1.0,
  "must_explain_found": ["work-gate candidate analysis"],
  "must_explain_missing": [],
  "expected_topology": "single_agent",
  "topology_matched": true,
  "avoid_violated": false,
  "avoid_violations": [],
  "artifact_score": 0.67,
  "artifacts_present": ["CandidateAnalysis", "ChangePlan"],
  "artifacts_missing": [],
  "word_count": 412,
  "debate_misuse": false,
  "tokens_total": 2000
}
```
