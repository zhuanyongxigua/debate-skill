#!/usr/bin/env python3
"""
Scorer for Method Skills eval (Layer 1 routing + Layer 2 artifact quality).

Usage:
    python scorer.py                                            # Layer 1, routing-tasks
    python scorer.py --tasks tasks/artifact-tasks.jsonl        # Layer 2, heuristic checks
    python scorer.py --tasks tasks/artifact-tasks.jsonl --llm-judge  # Layer 2 + LLM quality score
    python scorer.py --task art_repo_401
    python scorer.py --out results/scores.jsonl
"""

import argparse
import json
import re
from pathlib import Path

EVALS_DIR = Path(__file__).parent
DEFAULT_TASKS_FILE = EVALS_DIR / "routing-tasks.jsonl"
RESULTS_DIR = EVALS_DIR / "results"

METHOD_TO_ARTIFACT = {
    "agent-dispatch": "AgentDispatchPlan",
    "work-gate candidate analysis": "CandidateAnalysis",
    "work-gate change plan": "ChangePlan",
    "work-gate direct": "DirectResult",
    "work-gate final answer": "FinalAnswer",
    "work-gate": "RoutePlan",
    "work-gate debate": "DebateRecord",
}

ARTIFACT_PATTERNS = {
    "AgentDispatchPlan": r"agentdispatchplan|agent[\s\-_]*dispatch[\s\-_]*plan|heterogeneous[\s\-_]*cli|codex exec|claude\\s+(-p|--print)",
    "RoutePlan": r"routeplan\s*:",
    "CandidateAnalysis": r"candidateanalysis|candidate[\s\-_]*analysis|candidate\s+[a-c1-3]|hypothesis|proposal|option|root cause",
    "ChangePlan": r"changeplan\s*:|change[\s\-_]*plan|scoped file changes",
    "SourceCheckTable": r"source[\s\-_]*check|source table|citation[\s\-_]*check",
    "DirectResult": r"directresult|work-gate\s+direct|direct[\s\-_]*(answer|action|local)",
    "FinalAnswer": r"finalanswer|final[\s\-_]*answer",
    "DebateRecord": r"debaterecord|debate[\s\-_]*record",
    "CandidateAnalysisScorecard": r"scorecard|rubric|criterion[\s\-_]*scores|aggregate[\s\-_]*ranking",
}


def normalize_key(value):
    return re.sub(r"[\s\-_]+", "", value.lower())


def load_tasks(tasks_file=None):
    path = Path(tasks_file) if tasks_file else DEFAULT_TASKS_FILE
    if not path.is_absolute():
        path = EVALS_DIR / path
    tasks = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        task = json.loads(line)
        tasks[task["id"]] = task
    return tasks


# ---------------------------------------------------------------------------
# Layer 2: heuristic artifact quality checks
# ---------------------------------------------------------------------------

def _count_pattern(output, pattern):
    return len(re.findall(pattern, output, re.IGNORECASE))


def score_pathcards_quality(output):
    path_count = max(
        _count_pattern(output, r"\bpath\s*\d+\b"),
        _count_pattern(output, r"\bhypothesis\s*\d+\b"),
        _count_pattern(output, r"##?\s*(path|hypothesis|root cause)\b"),
    )
    has_hypothesis = bool(re.search(r"\bhypothes[ie]s\b|\broot cause\b", output, re.IGNORECASE))
    has_evidence = bool(re.search(r"\bevidence\b|\bprobe\b|\bcheck\b|\bcommand\b|\brun\b", output, re.IGNORECASE))
    has_invalidation = bool(re.search(r"\binvalidat|\brules?\s+out\b|\beliminate|\bdisprove\b|\bif\s+\w+\s+then\s+rule", output, re.IGNORECASE))
    path_score = min(path_count / 3, 1.0)
    return {
        "path_count": path_count,
        "has_hypothesis": has_hypothesis,
        "has_evidence": has_evidence,
        "has_invalidation": has_invalidation,
        "quality_score": round(path_score * 0.4 + has_hypothesis * 0.2 + has_evidence * 0.2 + has_invalidation * 0.2, 2),
    }


def score_changeplan_quality(output):
    has_goal = bool(re.search(r"\bgoal\b|\bobjective\b|\baim\b|\bfix\b", output, re.IGNORECASE))
    has_files = bool(re.search(r"\.(py|ts|js|go|rb|java|rs|yaml|yml|json|toml|conf|nginx)\b|src/|lib/|app/", output, re.IGNORECASE))
    has_validation = bool(re.search(r"\b(npm|pnpm|yarn|pytest|go test|cargo test|mvn|gradle)\b|run tests|pnpm test|npm test", output, re.IGNORECASE))
    has_rollback = bool(re.search(r"\brollback\b|\brevert\b|\bnon.goal\b|\bout of scope\b", output, re.IGNORECASE))
    return {
        "has_goal": has_goal,
        "has_files": has_files,
        "has_validation": has_validation,
        "has_rollback": has_rollback,
        "quality_score": round(has_goal * 0.2 + has_files * 0.3 + has_validation * 0.35 + has_rollback * 0.15, 2),
    }


def score_sourcecheck_quality(output):
    has_table = bool(re.search(r"\|.+\|.+\|", output))
    has_source_col = bool(re.search(r"\|\s*source\b|\|\s*reference\b|\|\s*citation\b", output, re.IGNORECASE))
    has_status_col = bool(re.search(r"\|\s*support|\|\s*status\b|\|\s*verified\b|\|\s*confirmed\b", output, re.IGNORECASE))
    has_unsupported = bool(re.search(r"\bunsupported\b|\bunverified\b|\buncertain\b|\bcannot confirm\b", output, re.IGNORECASE))
    return {
        "has_table": has_table,
        "has_source_col": has_source_col,
        "has_status_col": has_status_col,
        "has_unsupported_flag": has_unsupported,
        "quality_score": round(has_table * 0.2 + has_source_col * 0.3 + has_status_col * 0.3 + has_unsupported * 0.2, 2),
    }


def score_decisionmemo_quality(output):
    proposal_count = max(
        _count_pattern(output, r"\b(proposal|option|approach)\s+[a-c1-3]\b"),
        _count_pattern(output, r"##?\s*(proposal|option|approach)\s+[a-c1-3\:]"),
    )
    has_critic = bool(re.search(r"\bcritic\b|\bcritique\b|\bweakness\b|\bcon\b|\bdisadvantage\b", output, re.IGNORECASE))
    has_synthesis = bool(re.search(r"\bsynthesis\b|\brecommend\b|\bconclusion\b|\bchose\b|\bbest\b|\bprefer\b", output, re.IGNORECASE))
    has_triggers = bool(re.search(r"\bvalidation trigger\b|\bpremortem\b|\bpre.mortem\b|\bif\s+\w+\s+(changes?|fails?|grows?)\b", output, re.IGNORECASE))
    proposal_score = min(proposal_count / 2, 1.0)
    return {
        "proposal_count": proposal_count,
        "has_critic_table": has_critic,
        "has_synthesis": has_synthesis,
        "has_validation_triggers": has_triggers,
        "quality_score": round(proposal_score * 0.35 + has_critic * 0.25 + has_synthesis * 0.25 + has_triggers * 0.15, 2),
    }


def score_candidateanalysis_quality(output, expected=None):
    expected = expected or {}
    diagnosis = score_pathcards_quality(output)
    decision = score_decisionmemo_quality(output)
    if "min_paths" in expected:
        return {"mode_detected": "diagnosis", **diagnosis}
    if "min_proposals" in expected:
        return {"mode_detected": "decision", **decision}
    if diagnosis["quality_score"] >= decision["quality_score"]:
        return {"mode_detected": "diagnosis", **diagnosis}
    return {"mode_detected": "decision", **decision}


ARTIFACT_QUALITY_SCORERS = {
    "CandidateAnalysis": score_candidateanalysis_quality,
    "ChangePlan": score_changeplan_quality,
    "SourceCheckTable": score_sourcecheck_quality,
}


def score_layer2_heuristic(output, task):
    artifact_quality = task.get("artifact_quality", {})
    if not artifact_quality:
        return {}
    results = {}
    for artifact, scorer in ARTIFACT_QUALITY_SCORERS.items():
        if artifact in artifact_quality:
            if artifact == "CandidateAnalysis":
                results[artifact] = scorer(output, artifact_quality[artifact])
            else:
                results[artifact] = scorer(output)
    avg = sum(v["quality_score"] for v in results.values()) / len(results) if results else 0.0
    return {"per_artifact": results, "avg_quality_score": round(avg, 2)}


# ---------------------------------------------------------------------------
# Layer 2: LLM judge (optional, requires API key)
# ---------------------------------------------------------------------------

LLM_JUDGE_PROMPTS = {
    "CandidateAnalysis": """Score this CandidateAnalysis artifact from a work-gate candidate analysis method.

Task: {task}

Output:
{output}

Score each criterion 0-3 (0=absent, 1=vague, 2=mostly correct, 3=concrete and complete):
- candidate_independence: Are candidates genuinely distinct?
- task_fit: Do the candidate fields fit the task mode (diagnosis paths for bugs, proposals for decisions)?
- comparison_quality: Are candidates compared on concrete task-relevant criteria?
- selection_quality: Is the selected candidate or synthesis justified with evidence, tradeoffs, or validation triggers?

Respond in YAML only:
scores:
  candidate_independence: <0-3>
  task_fit: <0-3>
  comparison_quality: <0-3>
  selection_quality: <0-3>
total: <sum of scores>
max: 12
notes: <one sentence>""",

    "ChangePlan": """Score this ChangePlan artifact.

Task: {task}

Output:
{output}

Score each criterion 0-3 (0=absent, 1=vague, 2=mostly correct, 3=concrete and complete):
- goal_clarity: Is the goal specific and testable?
- file_specificity: Are specific files named with paths?
- validation_runnability: Are validation commands concrete and runnable?
- scope_definition: Are non-goals or rollback steps included?

Respond in YAML only:
scores:
  goal_clarity: <0-3>
  file_specificity: <0-3>
  validation_runnability: <0-3>
  scope_definition: <0-3>
total: <sum of scores>
max: 12
notes: <one sentence>""",

    "SourceCheckTable": """Score this source/citation check artifact.

Task: {task}

Output:
{output}

Score each criterion 0-3 (0=absent, 1=vague, 2=mostly correct, 3=concrete and complete):
- table_structure: Is it a proper table with headers?
- source_specificity: Does each row cite a specific authoritative source?
- status_accuracy: Does each row have a clear supported/unsupported/uncertain status?
- unsupported_flagging: Are at least some claims flagged as unverified (not everything rubber-stamped)?

Respond in YAML only:
scores:
  table_structure: <0-3>
  source_specificity: <0-3>
  status_accuracy: <0-3>
  unsupported_flagging: <0-3>
total: <sum of scores>
max: 12
notes: <one sentence>""",

}


def score_llm_judge(output, task, client):
    import yaml as _yaml
    artifact_quality = task.get("artifact_quality", {})
    if not artifact_quality:
        return {}

    results = {}
    for artifact in artifact_quality:
        prompt_template = LLM_JUDGE_PROMPTS.get(artifact)
        if not prompt_template:
            continue
        prompt = prompt_template.format(task=task["task"], output=output[:3000])
        try:
            resp = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text
            parsed = _yaml.safe_load(text)
            results[artifact] = {
                "scores": parsed.get("scores", {}),
                "total": parsed.get("total", 0),
                "max": parsed.get("max", 12),
                "normalized": round(parsed.get("total", 0) / parsed.get("max", 12), 2),
                "notes": parsed.get("notes", ""),
            }
        except Exception as e:
            results[artifact] = {"error": str(e)}

    if results:
        valid = [v["normalized"] for v in results.values() if "normalized" in v]
        avg = round(sum(valid) / len(valid), 2) if valid else 0.0
        results["avg_llm_quality"] = avg
    return results


def score_result(result, task):
    output = result["output"]
    output_norm = normalize_key(output)

    # 1. RoutePlan emitted before substantive content
    route_plan_emitted = bool(re.search(r"routeplan\s*:", output, re.IGNORECASE))

    # 2. Critical method recall
    expected = task.get("expected_stack", [])
    critical_found = []
    for m in expected:
        m_norm = normalize_key(m)
        if m_norm in output_norm:
            critical_found.append(m)
    critical_recall = len(critical_found) / len(expected) if expected else 1.0

    # 3. Avoid violations (methods/patterns that should not appear)
    avoid = task.get("avoid", [])
    avoid_violations = []
    for a in avoid:
        key_words = [
            normalize_key(w)
            for w in re.findall(r"[A-Za-z0-9_-]+", a.lower())
            if len(normalize_key(w)) > 4
        ]
        if key_words and all(w in output_norm for w in key_words):
            avoid_violations.append(a)
    avoid_violated = len(avoid_violations) > 0

    # 4. Artifact presence
    required_artifacts = []
    for method in expected:
        artifact = METHOD_TO_ARTIFACT.get(method)
        if artifact and artifact not in required_artifacts:
            required_artifacts.append(artifact)
    for artifact in task.get("required_artifacts", []):
        if artifact not in required_artifacts:
            required_artifacts.append(artifact)

    artifacts_present = []
    for artifact in required_artifacts:
        pattern = ARTIFACT_PATTERNS.get(artifact, re.escape(artifact.lower()))
        if re.search(pattern, output, re.IGNORECASE):
            artifacts_present.append(artifact)
    artifact_score = len(artifacts_present) / len(required_artifacts) if required_artifacts else 1.0

    # 5. Debate misuse: debate appeared when not in expected stack
    debate_expected = "work-gate debate" in expected
    debate_appeared = bool(re.search(r"work-gate\s+debate|debate\s*record|debaterecord", output, re.IGNORECASE))
    debate_misuse = debate_appeared and not debate_expected

    # 6. Word count
    word_count = len(output.split())

    return {
        "task_id": task["id"],
        "condition": result["condition"],
        "model": result.get("model"),
        "route_plan_emitted": route_plan_emitted,
        "critical_recall": round(critical_recall, 2),
        "critical_found": critical_found,
        "critical_missing": [m for m in expected if m not in critical_found],
        "avoid_violated": avoid_violated,
        "avoid_violations": avoid_violations,
        "artifact_score": round(artifact_score, 2),
        "artifacts_present": artifacts_present,
        "artifacts_missing": [a for a in required_artifacts if a not in artifacts_present],
        "word_count": word_count,
        "debate_misuse": debate_misuse,
        "tokens_total": result.get("tokens_in", 0) + result.get("tokens_out", 0),
    }


def aggregate(scores):
    if not scores:
        return {}
    n = len(scores)
    return {
        "n": n,
        "route_plan_rate": round(sum(s["route_plan_emitted"] for s in scores) / n, 3),
        "avg_critical_recall": round(sum(s["critical_recall"] for s in scores) / n, 3),
        "avoid_violation_rate": round(sum(s["avoid_violated"] for s in scores) / n, 3),
        "avg_artifact_score": round(sum(s["artifact_score"] for s in scores) / n, 3),
        "debate_misuse_rate": round(sum(s["debate_misuse"] for s in scores) / n, 3),
        "avg_word_count": round(sum(s["word_count"] for s in scores) / n),
        "avg_tokens": round(sum(s["tokens_total"] for s in scores) / n),
    }


def main():
    parser = argparse.ArgumentParser(description="Score Method Skills eval results")
    parser.add_argument("--task", help="Score only a specific task ID")
    parser.add_argument("--tasks", default=str(DEFAULT_TASKS_FILE), help="Path to tasks JSONL file")
    parser.add_argument("--llm-judge", action="store_true", help="Run LLM quality judge (requires ANTHROPIC_API_KEY)")
    parser.add_argument("--out", default="results/scores.jsonl")
    args = parser.parse_args()

    tasks = load_tasks(args.tasks)
    result_files = sorted(f for f in RESULTS_DIR.glob("*.json") if f.name != "README.md")

    llm_client = None
    if args.llm_judge:
        import anthropic as _anthropic
        llm_client = _anthropic.Anthropic()

    if not result_files:
        print(f"No result files found in {RESULTS_DIR}.")
        print("Run: python runner.py")
        return

    all_scores = []
    by_condition = {}

    for result_file in result_files:
        try:
            result = json.loads(result_file.read_text())
        except Exception as e:
            print(f"  warning: could not read {result_file.name}: {e}")
            continue

        task_id = result.get("task_id")
        if args.task and task_id != args.task:
            continue
        task = tasks.get(task_id)
        if not task:
            print(f"  warning: no task found for id={task_id}")
            continue

        score = score_result(result, task)

        if task.get("artifact_quality"):
            score["layer2_heuristic"] = score_layer2_heuristic(result["output"], task)
            if llm_client:
                score["layer2_llm_judge"] = score_llm_judge(result["output"], task, llm_client)

        all_scores.append(score)
        cond = score["condition"]
        by_condition.setdefault(cond, []).append(score)

    out_path = EVALS_DIR / args.out
    out_path.parent.mkdir(exist_ok=True)
    out_path.write_text("\n".join(json.dumps(s) for s in all_scores))
    print(f"Scored {len(all_scores)} results → {out_path}\n")

    if not by_condition:
        return

    has_layer2 = any(s.get("layer2_heuristic") for s in all_scores)
    has_llm = any(s.get("layer2_llm_judge") for s in all_scores)

    if has_layer2:
        print("\n--- Layer 1: Routing ---")

    col = [35, 4, 10, 8, 10, 11, 11, 8]
    headers = ["Condition", "N", "RoutePlan%", "Recall", "Artifact", "AvoidViol%", "DebateMis%", "AvgTok"]
    header_line = "  ".join(h.ljust(w) if i == 0 else h.rjust(w) for i, (h, w) in enumerate(zip(headers, col)))
    print(header_line)
    print("-" * len(header_line))

    for cond in sorted(by_condition.keys()):
        agg = aggregate(by_condition[cond])
        row = [
            cond.ljust(col[0]),
            str(agg["n"]).rjust(col[1]),
            f"{agg['route_plan_rate']*100:.1f}%".rjust(col[2]),
            f"{agg['avg_critical_recall']:.2f}".rjust(col[3]),
            f"{agg['avg_artifact_score']:.2f}".rjust(col[4]),
            f"{agg['avoid_violation_rate']*100:.1f}%".rjust(col[5]),
            f"{agg['debate_misuse_rate']*100:.1f}%".rjust(col[6]),
            str(agg["avg_tokens"]).rjust(col[7]),
        ]
        print("  ".join(row))

    if has_layer2:
        print("\n--- Layer 2: Artifact Quality (heuristic, 0.0–1.0) ---")
        col2 = [35, 4, 12]
        headers2 = ["Condition", "N", "AvgQuality"]
        header2_line = "  ".join(h.ljust(w) if i == 0 else h.rjust(w) for i, (h, w) in enumerate(zip(headers2, col2)))
        print(header2_line)
        print("-" * len(header2_line))
        for cond in sorted(by_condition.keys()):
            scores = by_condition[cond]
            quality_scores = [s["layer2_heuristic"]["avg_quality_score"] for s in scores if s.get("layer2_heuristic")]
            if not quality_scores:
                continue
            avg_q = round(sum(quality_scores) / len(quality_scores), 2)
            print("  ".join([cond.ljust(col2[0]), str(len(quality_scores)).rjust(col2[1]), f"{avg_q:.2f}".rjust(col2[2])]))

    if has_llm:
        print("\n--- Layer 2: Artifact Quality (LLM judge, 0.0–1.0) ---")
        for cond in sorted(by_condition.keys()):
            scores = by_condition[cond]
            llm_scores = [s["layer2_llm_judge"].get("avg_llm_quality", 0) for s in scores if s.get("layer2_llm_judge") and "avg_llm_quality" in s.get("layer2_llm_judge", {})]
            if not llm_scores:
                continue
            avg_llm = round(sum(llm_scores) / len(llm_scores), 2)
            print(f"  {cond:<35} avg_llm_quality={avg_llm:.2f}")


if __name__ == "__main__":
    main()
