#!/usr/bin/env python3
"""
Layer 3 eval runner for Method Skills.
Gives Claude buggy source code, asks for a corrected patch,
applies the patch to a temp copy of the fixture, then runs pytest.

Usage:
    python layer3_runner.py                               # all fixtures, all conditions
    python layer3_runner.py --fixture rate-limiter        # single fixture
    python layer3_runner.py --condition baseline          # single condition
    python layer3_runner.py --dry-run                     # show prompts, no API/tests
    python layer3_runner.py --model claude-opus-4-7

Note: This runner gives Claude source code as text, not a real filesystem.
It tests whether the model can identify and fix bugs from reading code,
not full agentic tool-use debugging.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import anthropic
import yaml

EVALS_DIR = Path(__file__).parent
FIXTURES_DIR = EVALS_DIR / "fixtures"
CONFIGS_DIR = EVALS_DIR / "configs"
RESULTS_DIR = EVALS_DIR / "results" / "layer3"

DEFAULT_MODEL = "claude-opus-4-7"
MAX_TOKENS = 4096

FILE_MARKER_RE = re.compile(r"===FILE:\s*(.+?)===\n(.*?)===END FILE===", re.DOTALL)


def load_fixture(fixture_dir: Path) -> dict:
    meta = json.loads((fixture_dir / "meta.json").read_text())
    task = (fixture_dir / "task.md").read_text()
    src_files = {}
    for f in sorted((fixture_dir / "src").glob("*.py")):
        if f.name != "__init__.py":
            src_files[f"src/{f.name}"] = f.read_text()
    expected = {}
    expected_path = fixture_dir / "expected.json"
    if expected_path.exists():
        expected = json.loads(expected_path.read_text())
    return {**meta, "task": task, "src_files": src_files, "dir": fixture_dir, "expected": expected}


def build_prompt(fixture: dict) -> str:
    src_section = "\n\n".join(
        f"### {path}\n```python\n{content.rstrip()}\n```"
        for path, content in fixture["src_files"].items()
    )
    return f"""{fixture['task']}

## Source Files

{src_section}"""


def render_system_prompt(config: dict, fixture: dict) -> str:
    if config.get("is_oracle"):
        template = config.get("system_prompt_template", "")
        methods = fixture.get("expected_methods", [])
        return template.format(methods=", ".join(methods))
    return config.get("system_prompt") or ""


def run_tests_subset(test_ids: list, tmpdir: str, timeout: int) -> dict:
    """Run specific pytest node IDs and return pass/fail + stdout."""
    cmd = [sys.executable, "-m", "pytest", *test_ids, "-v", "--tb=short", "--no-header"]
    try:
        result = subprocess.run(
            cmd, cwd=tmpdir, capture_output=True, text=True, timeout=timeout
        )
        return {"passed": result.returncode == 0, "stdout": result.stdout[-1500:]}
    except subprocess.TimeoutExpired:
        return {"passed": False, "stdout": "TIMEOUT"}


def check_disallowed(corrections: list, output: str) -> bool:
    """Return True if the model made a disallowed change."""
    for rel_path, _ in corrections:
        if rel_path.strip().startswith("tests/"):
            return True
    lowered = output.lower()
    if any(marker in lowered for marker in ["pytest.skip", "pytest.mark.skip", "xfail", "@skip"]):
        return True
    return False


def apply_and_test(fixture: dict, corrections: list, timeout: int = 60) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        shutil.copytree(str(fixture["dir"]), tmpdir, dirs_exist_ok=True)

        applied = []
        patch_lines = 0
        for rel_path, content in corrections:
            target = Path(tmpdir) / rel_path.strip()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content.strip() + "\n")
            applied.append(rel_path.strip())
            patch_lines += len(content.splitlines())

        # All tests
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pytest", "tests/", "-v", "--tb=short", "--no-header"],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            all_tests_pass = result.returncode == 0
            test_stdout = result.stdout[-3000:]
            test_returncode = result.returncode
        except subprocess.TimeoutExpired:
            all_tests_pass = False
            test_stdout = "TIMEOUT"
            test_returncode = -1

        # Public tests
        public_ids = fixture.get("public_tests", [])
        if public_ids:
            pub = run_tests_subset(public_ids, tmpdir, timeout)
            public_tests_pass = pub["passed"]
        else:
            public_tests_pass = all_tests_pass

        # Hidden tests
        hidden_ids = fixture.get("hidden_tests", [])
        if hidden_ids:
            hid = run_tests_subset(hidden_ids, tmpdir, timeout)
            hidden_tests_pass = hid["passed"]
        else:
            hidden_tests_pass = all_tests_pass

        return {
            "passed": all_tests_pass,
            "all_tests_pass": all_tests_pass,
            "public_tests_pass": public_tests_pass,
            "hidden_tests_pass": hidden_tests_pass,
            "files_corrected": applied,
            "corrections_count": len(corrections),
            "files_changed_count": len(applied),
            "patch_lines": patch_lines,
            "test_stdout": test_stdout,
            "test_returncode": test_returncode,
        }


def check_expected_method_used(output: str, fixture: dict) -> bool:
    expected = fixture.get("expected_methods", [])
    if not expected:
        return True
    lowered = output.lower()
    return any(m.lower() in lowered for m in expected)


def run_fixture_condition(fixture: dict, config: dict, model: str, client, dry_run: bool = False) -> dict | None:
    prompt = build_prompt(fixture)
    system = render_system_prompt(config, fixture)

    if dry_run:
        print(f"\n[DRY RUN] fixture={fixture['id']}  condition={config['name']}")
        print(f"  SYSTEM ({len(system)} chars): {system[:120].replace(chr(10), ' ')}{'...' if len(system) > 120 else ''}")
        print(f"  PROMPT ({len(prompt)} chars): {prompt[:200].replace(chr(10), ' ')}...")
        return None

    start = time.time()
    response = client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    elapsed_ms = int((time.time() - start) * 1000)
    output = response.content[0].text

    corrections = FILE_MARKER_RE.findall(output)
    test_result = apply_and_test(fixture, corrections)
    disallowed_change = check_disallowed(corrections, output)
    expected_method_used = check_expected_method_used(output, fixture)

    return {
        "fixture_id": fixture["id"],
        "category": fixture.get("category", ""),
        "is_simple": fixture.get("is_simple", False),
        "condition": config["name"],
        "model": model,
        "output": output,
        "tokens_in": response.usage.input_tokens,
        "tokens_out": response.usage.output_tokens,
        "latency_ms": elapsed_ms,
        "expected_method_used": expected_method_used,
        "disallowed_change": disallowed_change,
        **test_result,
    }


def load_configs(condition: str | None = None) -> dict:
    configs = {}
    for path in sorted(CONFIGS_DIR.glob("*.yaml")):
        cfg = yaml.safe_load(path.read_text()) or {}
        cfg["name"] = path.stem
        if condition is None or path.stem == condition:
            configs[path.stem] = cfg
    return configs


def main():
    parser = argparse.ArgumentParser(description="Method Skills Layer 3 E2E eval runner")
    parser.add_argument("--fixture", help="Run a single fixture by ID")
    parser.add_argument("--condition", help="Run a single condition by name")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not FIXTURES_DIR.exists():
        print(f"No fixtures/ directory found at {FIXTURES_DIR}.")
        return

    fixture_dirs = sorted(
        d for d in FIXTURES_DIR.iterdir()
        if d.is_dir() and (d / "meta.json").exists()
    )
    if args.fixture:
        fixture_dirs = [d for d in fixture_dirs if d.name == args.fixture]
    if not fixture_dirs:
        print(f"No fixtures found{f' matching --fixture={args.fixture}' if args.fixture else ''}.")
        return

    fixtures = [load_fixture(d) for d in fixture_dirs]
    configs = load_configs(args.condition)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    total = len(fixtures) * len(configs)
    print(f"Fixtures: {len(fixtures)} | Conditions: {len(configs)} | Total runs: {total}")

    client = None if args.dry_run else anthropic.Anthropic()
    done = 0

    for fixture in fixtures:
        for name, config in configs.items():
            out_path = RESULTS_DIR / f"{fixture['id']}__{name}.json"
            if out_path.exists() and not args.dry_run:
                print(f"  skip {out_path.name} (exists)")
                done += 1
                continue

            result = run_fixture_condition(fixture, config, args.model, client, args.dry_run)
            if result:
                out_path.write_text(json.dumps(result, indent=2))
                done += 1
                status = "PASS" if result["passed"] else "FAIL"
                hid = "H+" if result.get("hidden_tests_pass") else "H-"
                tok = result["tokens_in"] + result["tokens_out"]
                fixes = result["corrections_count"]
                print(
                    f"  [{done}/{total}] {out_path.name}  {status} {hid}"
                    f"  fixes={fixes}  lines={result.get('patch_lines', '?')}"
                    f"  {tok} tok  {result['latency_ms']}ms"
                )

    if not args.dry_run:
        print(f"\nDone. Results in {RESULTS_DIR}")
        print("Run: python layer3_scorer.py")


if __name__ == "__main__":
    main()
