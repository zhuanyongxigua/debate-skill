#!/usr/bin/env python3
"""
Scorer for debate-router and agent-launch evals.

Usage:
    python scorer.py
    python scorer.py --tasks tasks/artifact-tasks.jsonl
    python scorer.py --task explicit-candidate-debate
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
    "agent-launch": "AgentLaunchPlan",
    "debate-router": "DebateRecord",
}

ARTIFACT_PATTERNS = {
    "AgentLaunchPlan": (
        r"agentlaunchplan|agent[\s\-_]*launch[\s\-_]*plan|"
        r"codex exec|claude\s+(-p|--print)|copilot.+--prompt"
    ),
    "DebateRoute": r"(?m)^\s*debateroute\s*:",
    "DebateRecord": r"(?m)^\s*(?:debaterecord|debate[\s\-_]*record)\s*:",
    "DebateSummary": r"(?m)^\s*(?:debatesummary|debate[\s\-_]*summary)\s*:",
}

ARCHIVE_REF_RE = re.compile(
    r"(?P<path>(?:~|/)[^\s`\"']*?/\.debate-router/[^\s`\"']+/audit\.ya?ml)",
    re.IGNORECASE,
)

AUDIT_BLOCK_PATTERNS = {
    "DebateRoute": re.compile(r"^DebateRoute\s*:\s*$", re.MULTILINE),
    "DebateRecord": re.compile(r"^DebateRecord\s*:\s*$", re.MULTILINE),
    "DebateSummary": re.compile(r"^DebateSummary\s*:\s*$", re.MULTILINE),
}

DEBATE_APPEARED_RE = re.compile(
    r"debate[\s\-_]*router|debateroute\s*:|debaterecord|debate[\s\-_]*record",
    re.IGNORECASE,
)


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


def _count_pattern(output, pattern):
    return len(re.findall(pattern, output, re.IGNORECASE))


def _find_archive_refs(output):
    refs = []
    seen = set()
    for match in ARCHIVE_REF_RE.finditer(output):
        ref = match.group("path").rstrip(".,;:)]}")
        if ref not in seen:
            seen.add(ref)
            refs.append(ref)
    return refs


def _read_archive_blocks(path_text):
    if re.search(r"[<>{}]", path_text):
        return {
            "path": path_text,
            "status": "invalid_placeholder",
            "blocks": [],
            "reason": "archive path contains placeholder braces",
        }

    path = Path(path_text).expanduser()
    if not path.exists():
        return {
            "path": path_text,
            "status": "missing",
            "blocks": [],
            "reason": "archive file does not exist",
        }
    if not path.is_file():
        return {
            "path": path_text,
            "status": "invalid",
            "blocks": [],
            "reason": "archive path is not a file",
        }

    try:
        text = path.read_text()
    except OSError as exc:
        return {
            "path": path_text,
            "status": "unreadable",
            "blocks": [],
            "reason": str(exc),
        }

    blocks = sorted(
        artifact
        for artifact, pattern in AUDIT_BLOCK_PATTERNS.items()
        if pattern.search(text)
    )
    expected_blocks = set(AUDIT_BLOCK_PATTERNS)
    block_set = set(blocks)
    if block_set == expected_blocks:
        status = "valid"
        reason = ""
    elif blocks:
        status = "partial"
        missing = sorted(expected_blocks - block_set)
        reason = "archive missing audit blocks: " + ", ".join(missing)
    else:
        status = "empty_or_unrecognized"
        reason = "archive lacks recognized audit blocks"
    return {
        "path": path_text,
        "status": status,
        "blocks": blocks,
        "reason": reason,
    }


def _archive_audit_info(output):
    refs = _find_archive_refs(output)
    archive_results = [_read_archive_blocks(ref) for ref in refs]
    blocks = {
        block
        for result in archive_results
        for block in result["blocks"]
    }
    return {
        "refs_found": refs,
        "refs_valid": [
            result["path"]
            for result in archive_results
            if result["status"] == "valid"
        ],
        "refs_invalid": [
            result
            for result in archive_results
            if result["status"] != "valid"
        ],
        "artifacts_present": blocks,
    }


def score_debate_record_quality(output, expected=None):
    expected = expected or {}
    has_entry_case = bool(
        re.search(
            r"requirement_debate|single_proposal_debate|candidate_debate|judgment_debate",
            output,
            re.IGNORECASE,
        )
    )
    has_frozen = bool(re.search(r"frozen|freeze|candidate|judgment|proposal", output, re.IGNORECASE))
    has_generation = bool(re.search(r"proposal_generation|proposer|raw proposal|candidate positions", output, re.IGNORECASE))
    has_normalization = bool(re.search(r"proposal_normalization|dedup|distinct|stable id|normalized", output, re.IGNORECASE))
    has_degraded_or_reopen = bool(re.search(r"degraded_or_reopen|reopen_limit|reopen_count|terminal_reason", output, re.IGNORECASE))
    has_critics = bool(re.search(r"critic|critique|finding|risk|assumption", output, re.IGNORECASE))
    has_cross_review = bool(re.search(r"cross[\s\-_]*review|reviewed_critic_role", output, re.IGNORECASE))
    has_arbiter = bool(re.search(r"arbiter|arbitration|decision|selected_candidate", output, re.IGNORECASE))
    has_evidence = bool(re.search(r"evidence|basis|constraint|test|source|probe|risk", output, re.IGNORECASE))
    has_cli_participation = bool(
        re.search(
            r"cli[\s\-_]*participation|proposal_generation.+debate_execution|"
            r"debate_execution.+proposal_generation",
            output,
            re.IGNORECASE | re.DOTALL,
        )
    )
    requires_cli_participation = "cli_participation" in expected.get("required_fields", [])
    candidate_count = max(
        _count_pattern(output, r"\bcandidate\s+[a-d1-4]\b"),
        _count_pattern(output, r"\bid:\s*[\"']?[A-D1-4]"),
    )
    base_score = (
        has_entry_case * 0.15
        + has_frozen * 0.15
        + max(has_generation, has_normalization, has_degraded_or_reopen) * 0.1
        + has_critics * 0.15
        + has_cross_review * 0.2
        + has_arbiter * 0.15
        + has_evidence * 0.1
    )
    if requires_cli_participation:
        quality_score = round(base_score * 0.9 + has_cli_participation * 0.1, 2)
    else:
        quality_score = round(base_score, 2)
    return {
        "has_entry_case": has_entry_case,
        "has_frozen_candidates_or_judgments": has_frozen,
        "has_proposal_generation": has_generation,
        "has_proposal_normalization": has_normalization,
        "has_degraded_or_reopen": has_degraded_or_reopen,
        "has_cli_participation": has_cli_participation,
        "has_critics": has_critics,
        "has_cross_review": has_cross_review,
        "has_arbiter": has_arbiter,
        "has_evidence_basis": has_evidence,
        "candidate_count_hint": candidate_count,
        "quality_score": quality_score,
    }


def score_debate_summary_quality(output, expected=None):
    has_status = bool(re.search(r"\bstatus\b|status_reason|degraded|blocked|completed", output, re.IGNORECASE))
    has_final = bool(re.search(r"final_recommendation|final recommendation|recommendation", output, re.IGNORECASE))
    has_source_proposals = bool(re.search(r"source_proposals|source proposals|base_proposal_id", output, re.IGNORECASE))
    has_amendments = bool(re.search(r"sourced_amendments|sourced amendments|accepted amendment", output, re.IGNORECASE))
    has_debate_basis = bool(re.search(r"debate_basis|supported_by|challenged_by|arbiter_reason", output, re.IGNORECASE))
    has_derivation = bool(re.search(r"derivation|derived from|contribution", output, re.IGNORECASE))
    has_classification = bool(re.search(r"input_classification|requirement|single_proposal|multiple_candidates|conflicting_judgments", output, re.IGNORECASE))
    quality_score = round(
        has_final * 0.2
        + has_status * 0.05
        + has_source_proposals * 0.15
        + has_amendments * 0.15
        + has_debate_basis * 0.15
        + has_derivation * 0.2
        + has_classification * 0.1,
        2,
    )
    return {
        "has_final_recommendation": has_final,
        "has_status": has_status,
        "has_source_proposals": has_source_proposals,
        "has_sourced_amendments": has_amendments,
        "has_debate_basis": has_debate_basis,
        "has_derivation": has_derivation,
        "has_input_classification": has_classification,
        "quality_score": quality_score,
    }


ARTIFACT_QUALITY_SCORERS = {
    "DebateRecord": score_debate_record_quality,
    "DebateSummary": score_debate_summary_quality,
}


def score_layer2_heuristic(output, task):
    artifact_quality = task.get("artifact_quality", {})
    if not artifact_quality:
        return {}
    results = {}
    for artifact, scorer in ARTIFACT_QUALITY_SCORERS.items():
        if artifact in artifact_quality:
            results[artifact] = scorer(output, artifact_quality[artifact])
    avg = sum(v["quality_score"] for v in results.values()) / len(results) if results else 0.0
    return {"per_artifact": results, "avg_quality_score": round(avg, 2)}


def _avoid_violations(output_norm, avoid):
    violations = []
    for item in avoid:
        key_words = [
            normalize_key(w)
            for w in re.findall(r"[A-Za-z0-9_-]+", item.lower())
            if len(normalize_key(w)) > 4
        ]
        if key_words and all(word in output_norm for word in key_words):
            violations.append(item)
    return violations


def score_result(result, task):
    output = result["output"]
    output_norm = normalize_key(output)
    archive_audit_info = _archive_audit_info(output)
    archive_artifacts = archive_audit_info["artifacts_present"]

    debate_route_emitted = bool(
        re.search(ARTIFACT_PATTERNS["DebateRoute"], output, re.IGNORECASE)
        or "DebateRoute" in archive_artifacts
    )

    expected = task.get("expected_stack", [])
    critical_found = []
    for method in expected:
        if normalize_key(method) in output_norm:
            critical_found.append(method)
    critical_recall = len(critical_found) / len(expected) if expected else 1.0

    must_explain = task.get("must_explain", [])
    must_explain_found = []
    for item in must_explain:
        if normalize_key(item) in output_norm:
            must_explain_found.append(item)
    must_explain_recall = len(must_explain_found) / len(must_explain) if must_explain else 1.0

    expected_topology = task.get("expected_topology")
    topology_matched = True
    if expected_topology:
        topology_matched = normalize_key(expected_topology) in output_norm

    avoid_violations = _avoid_violations(output_norm, task.get("avoid", []))
    avoid_violated = bool(avoid_violations)

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
        if artifact in archive_artifacts or re.search(pattern, output, re.IGNORECASE):
            artifacts_present.append(artifact)
    artifact_score = len(artifacts_present) / len(required_artifacts) if required_artifacts else 1.0

    debate_expected = "debate-router" in expected
    debate_appeared = bool(DEBATE_APPEARED_RE.search(output))
    debate_misuse = debate_appeared and not debate_expected

    return {
        "task_id": task["id"],
        "condition": result["condition"],
        "model": result.get("model"),
        "debate_route_emitted": debate_route_emitted,
        "critical_recall": round(critical_recall, 2),
        "critical_found": critical_found,
        "critical_missing": [m for m in expected if m not in critical_found],
        "must_explain_recall": round(must_explain_recall, 2),
        "must_explain_found": must_explain_found,
        "must_explain_missing": [m for m in must_explain if m not in must_explain_found],
        "expected_topology": expected_topology,
        "topology_matched": topology_matched,
        "avoid_violated": avoid_violated,
        "avoid_violations": avoid_violations,
        "artifact_score": round(artifact_score, 2),
        "artifacts_present": artifacts_present,
        "artifacts_missing": [a for a in required_artifacts if a not in artifacts_present],
        "archive_refs_found": archive_audit_info["refs_found"],
        "archive_refs_valid": archive_audit_info["refs_valid"],
        "archive_refs_invalid": archive_audit_info["refs_invalid"],
        "archive_artifacts_present": sorted(archive_artifacts),
        "word_count": len(output.split()),
        "debate_misuse": debate_misuse,
        "tokens_total": result.get("tokens_in", 0) + result.get("tokens_out", 0),
    }


def aggregate(scores):
    if not scores:
        return {}
    n = len(scores)
    return {
        "n": n,
        "debate_route_rate": round(sum(s["debate_route_emitted"] for s in scores) / n, 3),
        "avg_critical_recall": round(sum(s["critical_recall"] for s in scores) / n, 3),
        "avg_must_explain_recall": round(sum(s["must_explain_recall"] for s in scores) / n, 3),
        "topology_match_rate": round(sum(s["topology_matched"] for s in scores) / n, 3),
        "avoid_violation_rate": round(sum(s["avoid_violated"] for s in scores) / n, 3),
        "avg_artifact_score": round(sum(s["artifact_score"] for s in scores) / n, 3),
        "debate_misuse_rate": round(sum(s["debate_misuse"] for s in scores) / n, 3),
        "avg_word_count": round(sum(s["word_count"] for s in scores) / n),
        "avg_tokens": round(sum(s["tokens_total"] for s in scores) / n),
    }


def main():
    parser = argparse.ArgumentParser(description="Score debate-router eval results")
    parser.add_argument("--task", help="Score only a specific task ID")
    parser.add_argument("--tasks", default=str(DEFAULT_TASKS_FILE), help="Path to tasks JSONL file")
    parser.add_argument("--out", default="results/scores.jsonl")
    args = parser.parse_args()

    tasks = load_tasks(args.tasks)
    result_files = sorted(f for f in RESULTS_DIR.glob("*.json") if f.name != "README.md")

    if not result_files:
        print(f"No result files found in {RESULTS_DIR}.")
        print("Run: python runner.py")
        return

    all_scores = []
    by_condition = {}

    for result_file in result_files:
        try:
            result = json.loads(result_file.read_text())
        except Exception as exc:
            print(f"  warning: could not read {result_file.name}: {exc}")
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

        all_scores.append(score)
        by_condition.setdefault(score["condition"], []).append(score)

    out_path = EVALS_DIR / args.out
    out_path.parent.mkdir(exist_ok=True)
    out_path.write_text("\n".join(json.dumps(s) for s in all_scores))
    print(f"Scored {len(all_scores)} results -> {out_path}\n")

    if not by_condition:
        return

    col = [35, 4, 12, 8, 8, 8, 10, 11, 11, 8]
    headers = [
        "Condition",
        "N",
        "DebateRoute%",
        "Stack",
        "Explain",
        "Topology",
        "Artifact",
        "AvoidViol%",
        "DebateMis%",
        "AvgTok",
    ]
    header_line = "  ".join(h.ljust(w) if i == 0 else h.rjust(w) for i, (h, w) in enumerate(zip(headers, col)))
    print(header_line)
    print("-" * len(header_line))

    for condition in sorted(by_condition.keys()):
        agg = aggregate(by_condition[condition])
        row = [
            condition.ljust(col[0]),
            str(agg["n"]).rjust(col[1]),
            f"{agg['debate_route_rate'] * 100:.1f}%".rjust(col[2]),
            f"{agg['avg_critical_recall']:.2f}".rjust(col[3]),
            f"{agg['avg_must_explain_recall']:.2f}".rjust(col[4]),
            f"{agg['topology_match_rate']:.2f}".rjust(col[5]),
            f"{agg['avg_artifact_score']:.2f}".rjust(col[6]),
            f"{agg['avoid_violation_rate'] * 100:.1f}%".rjust(col[7]),
            f"{agg['debate_misuse_rate'] * 100:.1f}%".rjust(col[8]),
            str(agg["avg_tokens"]).rjust(col[9]),
        ]
        print("  ".join(row))

    has_layer2 = any(s.get("layer2_heuristic") for s in all_scores)
    if has_layer2:
        print("\n--- Layer 2: Artifact Quality (heuristic, 0.0-1.0) ---")
        col2 = [35, 4, 12]
        headers2 = ["Condition", "N", "AvgQuality"]
        header2_line = "  ".join(h.ljust(w) if i == 0 else h.rjust(w) for i, (h, w) in enumerate(zip(headers2, col2)))
        print(header2_line)
        print("-" * len(header2_line))
        for condition in sorted(by_condition.keys()):
            scores = by_condition[condition]
            quality_scores = [
                s["layer2_heuristic"]["avg_quality_score"]
                for s in scores
                if s.get("layer2_heuristic")
            ]
            if not quality_scores:
                continue
            avg_quality = round(sum(quality_scores) / len(quality_scores), 2)
            print("  ".join([condition.ljust(col2[0]), str(len(quality_scores)).rjust(col2[1]), f"{avg_quality:.2f}".rjust(col2[2])]))


if __name__ == "__main__":
    main()
