#!/usr/bin/env python3
"""
Scorer for Layer 3 E2E eval.
Reads results/layer3/*.json and prints pass rates by condition and fixture.

Usage:
    python layer3_scorer.py
    python layer3_scorer.py --fixture rate-limiter
"""

import argparse
import json
import statistics
from pathlib import Path

EVALS_DIR = Path(__file__).parent
RESULTS_DIR = EVALS_DIR / "results" / "layer3"


def main():
    parser = argparse.ArgumentParser(description="Score Layer 3 E2E eval results")
    parser.add_argument("--fixture", help="Score only a specific fixture")
    args = parser.parse_args()

    result_files = sorted(f for f in RESULTS_DIR.glob("*.json") if f.name != "README.md")
    if not result_files:
        print(f"No Layer 3 results found in {RESULTS_DIR}.")
        print("Run: python layer3_runner.py")
        return

    if args.fixture:
        result_files = [f for f in result_files if f.name.startswith(args.fixture + "__")]

    all_results = [json.loads(f.read_text()) for f in result_files]
    print(f"Scored {len(all_results)} results\n")

    # Summary by condition — all tasks
    by_condition: dict = {}
    for r in all_results:
        by_condition.setdefault(r["condition"], []).append(r)

    col = [35, 4, 10, 10, 8, 9, 9]
    headers = ["Condition", "N", "AllPass%", "HidPass%", "AvgTok", "MedPatch", "Disallwd"]
    header_line = "  ".join(
        h.ljust(w) if i == 0 else h.rjust(w)
        for i, (h, w) in enumerate(zip(headers, col))
    )
    print("--- Pass rate by condition (all tasks) ---")
    print(header_line)
    print("-" * len(header_line))

    for cond in sorted(by_condition.keys()):
        results = by_condition[cond]
        n = len(results)
        all_pass = sum(r.get("all_tests_pass", r["passed"]) for r in results) / n
        hid_pass = sum(r.get("hidden_tests_pass", r["passed"]) for r in results) / n
        avg_tok = round(sum(r.get("tokens_in", 0) + r.get("tokens_out", 0) for r in results) / n)
        patch_vals = [r.get("patch_lines", 0) for r in results]
        med_patch = round(statistics.median(patch_vals)) if patch_vals else 0
        disallowed = sum(1 for r in results if r.get("disallowed_change", False))
        print("  ".join([
            cond.ljust(col[0]),
            str(n).rjust(col[1]),
            f"{all_pass * 100:.1f}%".rjust(col[2]),
            f"{hid_pass * 100:.1f}%".rjust(col[3]),
            str(avg_tok).rjust(col[4]),
            str(med_patch).rjust(col[5]),
            str(disallowed).rjust(col[6]),
        ]))

    # Simple vs complex breakdown
    simple_results = [r for r in all_results if r.get("is_simple", False)]
    complex_results = [r for r in all_results if not r.get("is_simple", False)]

    if simple_results:
        print("\n--- Simple task breakdown (negative controls) ---")
        by_cond_simple: dict = {}
        for r in simple_results:
            by_cond_simple.setdefault(r["condition"], []).append(r)

        scol = [35, 4, 10, 8, 9]
        sheaders = ["Condition", "N", "Pass%", "AvgTok", "MedPatch"]
        sh_line = "  ".join(
            h.ljust(w) if i == 0 else h.rjust(w)
            for i, (h, w) in enumerate(zip(sheaders, scol))
        )
        print(sh_line)
        print("-" * len(sh_line))
        for cond in sorted(by_cond_simple.keys()):
            rs = by_cond_simple[cond]
            n = len(rs)
            pass_rate = sum(r.get("all_tests_pass", r["passed"]) for r in rs) / n
            avg_tok = round(sum(r.get("tokens_in", 0) + r.get("tokens_out", 0) for r in rs) / n)
            med_patch = round(statistics.median([r.get("patch_lines", 0) for r in rs]))
            print("  ".join([
                cond.ljust(scol[0]),
                str(n).rjust(scol[1]),
                f"{pass_rate * 100:.1f}%".rjust(scol[2]),
                str(avg_tok).rjust(scol[3]),
                str(med_patch).rjust(scol[4]),
            ]))

    if complex_results:
        print("\n--- Complex task breakdown ---")
        by_cond_complex: dict = {}
        for r in complex_results:
            by_cond_complex.setdefault(r["condition"], []).append(r)

        ch_line = "  ".join(
            h.ljust(w) if i == 0 else h.rjust(w)
            for i, (h, w) in enumerate(zip(headers, col))
        )
        print(ch_line)
        print("-" * len(ch_line))
        for cond in sorted(by_cond_complex.keys()):
            rs = by_cond_complex[cond]
            n = len(rs)
            all_pass = sum(r.get("all_tests_pass", r["passed"]) for r in rs) / n
            hid_pass = sum(r.get("hidden_tests_pass", r["passed"]) for r in rs) / n
            avg_tok = round(sum(r.get("tokens_in", 0) + r.get("tokens_out", 0) for r in rs) / n)
            patch_vals = [r.get("patch_lines", 0) for r in rs]
            med_patch = round(statistics.median(patch_vals)) if patch_vals else 0
            disallowed = sum(1 for r in rs if r.get("disallowed_change", False))
            print("  ".join([
                cond.ljust(col[0]),
                str(n).rjust(col[1]),
                f"{all_pass * 100:.1f}%".rjust(col[2]),
                f"{hid_pass * 100:.1f}%".rjust(col[3]),
                str(avg_tok).rjust(col[4]),
                str(med_patch).rjust(col[5]),
                str(disallowed).rjust(col[6]),
            ]))

    # Fixture × condition matrix
    by_fixture: dict = {}
    for r in all_results:
        by_fixture.setdefault(r["fixture_id"], {})[r["condition"]] = r

    print("\n--- Pass/fail by fixture × condition (A=all_pass H=hidden_pass) ---")
    conditions = sorted(by_condition.keys())
    print(f"  {'Fixture':<22}" + "".join(f"  {c[:13]:>13}" for c in conditions))
    print("  " + "-" * (22 + 15 * len(conditions)))
    for fixture_id in sorted(by_fixture.keys()):
        row = f"  {fixture_id:<22}"
        for cond in conditions:
            r = by_fixture[fixture_id].get(cond)
            if r is None:
                cell = "     -"
            else:
                a = "A" if r.get("all_tests_pass", r["passed"]) else "."
                h = "H" if r.get("hidden_tests_pass", r["passed"]) else "."
                cell = f"[{a}{h}]"
            row += f"  {cell:>13}"
        print(row)
    print("\n  Legend: A=all_tests_pass  H=hidden_tests_pass  .=fail  -=not run")


if __name__ == "__main__":
    main()
