#!/usr/bin/env python3
"""
Eval runner for debate-router and cli-launch routing evals.
Runs each task against each condition and saves raw results.

Usage:
    python runner.py                            # all tasks, all conditions
    python runner.py --task explicit-candidate-debate         # single task
    python runner.py --condition baseline                      # single condition
    python runner.py --tasks tasks/artifact-tasks.jsonl       # artifact tasks
    python runner.py --dry-run                                 # print prompts, no API calls
    python runner.py --model claude-opus-4-7
"""

import argparse
import json
import os
import re
import time
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError:
    yaml = None

EVALS_DIR = Path(__file__).parent
DEFAULT_TASKS_FILE = EVALS_DIR / "routing-tasks.jsonl"
CONFIGS_DIR = EVALS_DIR / "configs"
RESULTS_DIR = EVALS_DIR / "results"

DEFAULT_MODEL = "claude-opus-4-7"
MAX_TOKENS = 2048


def load_tasks(tasks_file, task_id=None):
    tasks = []
    for line in Path(tasks_file).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        task = json.loads(line)
        if task_id is None or task["id"] == task_id:
            tasks.append(task)
    return tasks


def parse_scalar(value):
    value = value.strip()
    if value == "true":
        return True
    if value == "false":
        return False
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def load_simple_yaml(text):
    result = {}
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        index += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$", line)
        if not match:
            raise ValueError(f"Unsupported config line: {line!r}")
        key, raw_value = match.groups()
        raw_value = raw_value or ""
        if raw_value.strip() == "|":
            block = []
            while index < len(lines):
                block_line = lines[index]
                if block_line and not block_line.startswith(" "):
                    break
                index += 1
                block.append(block_line[2:] if block_line.startswith("  ") else block_line.lstrip())
            result[key] = "\n".join(block).rstrip() + "\n"
        else:
            result[key] = parse_scalar(raw_value)
    return result


def load_config_file(path):
    text = path.read_text()
    if yaml is not None:
        return yaml.safe_load(text) or {}
    return load_simple_yaml(text)


def load_configs(condition=None):
    configs = {}
    for path in sorted(CONFIGS_DIR.glob("*.yaml")):
        cfg = load_config_file(path)
        cfg["name"] = path.stem
        if condition is None or path.stem == condition:
            configs[path.stem] = cfg
    return configs


def run_task(task, config, model, client, dry_run=False):
    if config.get("is_oracle"):
        methods = ", ".join(task.get("expected_stack", [])) or "none"
        system = (config.get("system_prompt_template") or "").format(methods=methods)
    else:
        system = config.get("system_prompt") or ""
    prompt = task["task"]

    if dry_run:
        print(f"\n[DRY RUN] task={task['id']}  condition={config['name']}")
        print(f"  SYSTEM ({len(system)} chars): {system[:120].replace(chr(10), ' ')}{'...' if len(system) > 120 else ''}")
        print(f"  USER: {prompt}")
        return None

    start = time.time()
    response = client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    elapsed_ms = int((time.time() - start) * 1000)

    return {
        "task_id": task["id"],
        "condition": config["name"],
        "model": model,
        "output": response.content[0].text,
        "tokens_in": response.usage.input_tokens,
        "tokens_out": response.usage.output_tokens,
        "latency_ms": elapsed_ms,
    }


def main():
    parser = argparse.ArgumentParser(description="Debate-router routing eval runner")
    parser.add_argument("--task", help="Run a single task by ID")
    parser.add_argument("--tasks", default=str(DEFAULT_TASKS_FILE), help="Path to tasks JSONL file")
    parser.add_argument("--condition", help="Run a single condition by name")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    tasks_file = EVALS_DIR / args.tasks if not Path(args.tasks).is_absolute() else Path(args.tasks)
    tasks = load_tasks(tasks_file, args.task)
    configs = load_configs(args.condition)

    if not tasks:
        print(f"No tasks found{f' with id={args.task}' if args.task else ''}.")
        return
    if not configs:
        print(f"No configs found{f' with name={args.condition}' if args.condition else ''}.")
        return

    RESULTS_DIR.mkdir(exist_ok=True)

    total = len(tasks) * len(configs)
    print(f"Tasks: {len(tasks)} | Conditions: {len(configs)} | Total runs: {total}")

    if args.dry_run:
        client = None
    else:
        import anthropic

        client = anthropic.Anthropic()
    done = 0

    for task in tasks:
        for name, config in configs.items():
            out_path = RESULTS_DIR / f"{task['id']}__{name}.json"
            if out_path.exists() and not args.dry_run:
                print(f"  skip {out_path.name} (exists)")
                done += 1
                continue

            result = run_task(task, config, args.model, client, args.dry_run)
            if result:
                out_path.write_text(json.dumps(result, indent=2))
                done += 1
                tok = result["tokens_in"] + result["tokens_out"]
                print(f"  [{done}/{total}] {out_path.name}  {tok} tokens  {result['latency_ms']}ms")

    if not args.dry_run:
        print(f"\nDone. Results in {RESULTS_DIR}")
        print("Run: python scorer.py")


if __name__ == "__main__":
    main()
