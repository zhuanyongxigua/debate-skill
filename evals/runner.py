#!/usr/bin/env python3
"""
Eval runner for Method Skills routing eval.
Runs each task against each condition and saves raw results.

Usage:
    python runner.py                            # all tasks, all conditions
    python runner.py --task repo-debug-401                    # single task
    python runner.py --condition baseline                      # single condition
    python runner.py --tasks tasks/artifact-tasks.jsonl       # layer 2 tasks
    python runner.py --dry-run                                 # print prompts, no API calls
    python runner.py --model claude-opus-4-7
"""

import argparse
import json
import os
import time
from pathlib import Path

import anthropic
import yaml

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


def load_configs(condition=None):
    configs = {}
    for path in sorted(CONFIGS_DIR.glob("*.yaml")):
        cfg = yaml.safe_load(path.read_text()) or {}
        cfg["name"] = path.stem
        if condition is None or path.stem == condition:
            configs[path.stem] = cfg
    return configs


def run_task(task, config, model, client, dry_run=False):
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
    parser = argparse.ArgumentParser(description="Method Skills routing eval runner")
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

    client = None if args.dry_run else anthropic.Anthropic()
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
