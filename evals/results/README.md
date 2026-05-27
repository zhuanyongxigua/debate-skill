# Results

Raw result files from eval runs. Not committed to the repo.

Each file is named `{task_id}__{condition}.json`.

## Generate Results

```bash
cd evals
pip install anthropic pyyaml
export ANTHROPIC_API_KEY=...
python runner.py
```

## Score Results

```bash
python scorer.py
```

Outputs a summary table and writes `results/scores.jsonl`.

## Result Format

```json
{
  "task_id": "explicit-candidate-debate",
  "condition": "method-index-plus-skills",
  "model": "claude-opus-4-7",
  "output": "...",
  "tokens_in": 1200,
  "tokens_out": 800,
  "latency_ms": 12000
}
```

## Score Format

```json
{
  "task_id": "explicit-candidate-debate",
  "condition": "method-index-plus-skills",
  "model": "claude-opus-4-7",
  "debate_route_emitted": true,
  "critical_recall": 1.0,
  "critical_found": ["debate-router"],
  "critical_missing": [],
  "must_explain_recall": 1.0,
  "must_explain_found": ["candidate_debate", "frozen_candidates"],
  "must_explain_missing": [],
  "expected_topology": "same_runtime_multi_agent",
  "topology_matched": true,
  "avoid_violated": false,
  "avoid_violations": [],
  "artifact_score": 1.0,
  "artifacts_present": ["DebateRoute", "DebateRecord", "DebateSummary"],
  "artifacts_missing": [],
  "layer2_heuristic": {
    "per_artifact": {
      "DebateSummary": {
        "has_final_recommendation": true,
        "has_status": true,
        "has_source_proposals": true,
        "has_sourced_amendments": true,
        "has_debate_basis": true,
        "has_derivation": true
      }
    }
  },
  "word_count": 412,
  "debate_misuse": false,
  "tokens_total": 2000
}
```
