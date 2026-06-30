#!/usr/bin/env python3
# This client submits cli-delegator request files for the out-of-sandbox
# daemon, then reads daemon-written compatibility artifacts.

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

DEFAULT_STATE_DIR = "~/.cli-delegator"
DEFAULT_BACKEND = "codex"
DEFAULT_PROFILE = "azure"
DEFAULT_MAX_MINUTES = 30
DELEGATE_REQUEST_VERSION = 1
DELEGATE_RESPONSE_POLL_SECONDS = 1


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def utc_timestamp_id() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("delegate-%Y%m%d-%H%M%S")


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text())


def write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    tmp.replace(path)


def write_private_json_atomic(path: Path, data: Any) -> None:
    write_json_atomic(path, data)
    try:
        path.chmod(0o600)
    except OSError:
        pass


def run_id_from_args(args: argparse.Namespace) -> str:
    return args.run_id or utc_timestamp_id()


def mailbox_root_from_args(args: argparse.Namespace) -> Path:
    state_dir = Path(getattr(args, "state_dir", DEFAULT_STATE_DIR)).expanduser()
    if state_dir.is_absolute():
        return state_dir
    cwd = Path(getattr(args, "cwd", ".")).expanduser().resolve()
    return cwd / state_dir


def run_dir_from_args(args: argparse.Namespace, run_id: str | None = None) -> Path:
    return mailbox_root_from_args(args) / (run_id or run_id_from_args(args))


def response_path_for(args: argparse.Namespace, run_id: str) -> Path:
    return mailbox_root_from_args(args) / "responses" / f"{run_id}.json"


def response_log_path_for(args: argparse.Namespace, run_id: str) -> Path:
    return mailbox_root_from_args(args) / "responses" / f"{run_id}.log"


def load_task(args: argparse.Namespace) -> str:
    parts: list[str] = []
    if getattr(args, "task", None):
        parts.append(args.task)
    if getattr(args, "task_file", None):
        parts.append(Path(args.task_file).expanduser().read_text())
    task = "\n\n".join(part.strip() for part in parts if part.strip())
    if not task:
        raise SystemExit("Provide --task or --task-file.")
    return task


def daemon_provider_from_args(args: argparse.Namespace) -> str:
    if args.backend not in {"codex", "claude"}:
        raise SystemExit(f"daemon mailbox mode supports codex or claude, got: {args.backend}")
    return args.backend


def build_delegate_request(args: argparse.Namespace, run_id: str) -> dict[str, Any]:
    provider = daemon_provider_from_args(args)
    request: dict[str, Any] = {
        "schema_version": DELEGATE_REQUEST_VERSION,
        "id": run_id,
        "kind": "delegate_request",
        "repo": str(Path(args.cwd).expanduser().resolve()),
        "provider": provider,
        "capability": args.capability,
        "mode": "once",
        "skill_hint": args.skill,
        "task": load_task(args),
        "timeout_minutes": args.max_minutes,
    }
    if provider == "codex" and args.profile:
        request["profile"] = args.profile
    return request


def submit_delegate_request(args: argparse.Namespace, run_id: str) -> Path:
    root = mailbox_root_from_args(args)
    requests = root / "requests"
    responses = root / "responses"
    for directory in [root, requests, responses]:
        directory.mkdir(parents=True, exist_ok=True)
        try:
            directory.chmod(0o700)
        except OSError:
            pass
    path = requests / f"{run_id}.json"
    if path.exists() and not args.force:
        raise SystemExit(f"Delegate request already exists: {path}")
    write_private_json_atomic(path, build_delegate_request(args, run_id))
    return path


def wait_for_delegate_response(args: argparse.Namespace, run_id: str) -> dict[str, Any]:
    response_path = response_path_for(args, run_id)
    deadline = time.monotonic() + max(1, args.max_minutes * 60 + 30)
    while time.monotonic() < deadline:
        if response_path.exists():
            return json.loads(response_path.read_text())
        time.sleep(DELEGATE_RESPONSE_POLL_SECONDS)
    raise SystemExit(f"Timed out waiting for daemon response: {response_path}")


def print_delegate_response(response: dict[str, Any]) -> int:
    status = response.get("status")
    if response.get("answer_markdown"):
        print(str(response["answer_markdown"]).rstrip())
    print(f"status: {status}")
    if response.get("status_reason"):
        print(f"status_reason: {response['status_reason']}")
    if response.get("artifacts_dir"):
        print(f"Run dir: {response['artifacts_dir']}")
    return 0 if status == "completed" else 1


def once(args: argparse.Namespace) -> int:
    run_id = run_id_from_args(args)
    request_path = mailbox_root_from_args(args) / "requests" / f"{run_id}.json"
    if args.dry_run:
        print(f"Request: {request_path}")
        print(json.dumps(build_delegate_request(args, run_id), indent=2, sort_keys=True))
        return 0
    request_path = submit_delegate_request(args, run_id)
    print(f"Submitted delegate request: {request_path}")
    print(f"Waiting for daemon response: {response_path_for(args, run_id)}")
    response = wait_for_delegate_response(args, run_id)
    return print_delegate_response(response)


def resolve_existing_run_dir(args: argparse.Namespace) -> Path:
    if not getattr(args, "run_id", None):
        raise SystemExit("--run-id is required.")
    return run_dir_from_args(args, args.run_id)


def status(args: argparse.Namespace) -> int:
    run_dir = resolve_existing_run_dir(args)
    state = read_json(run_dir / "state.json", {})
    response = read_json(response_path_for(args, args.run_id), {})
    if not state and not response:
        raise SystemExit(f"No state or response found for run id: {args.run_id}")
    print(f"run: {args.run_id}")
    print(f"status: {state.get('status') or response.get('status')}")
    if response.get("status_reason"):
        print(f"status_reason: {response['status_reason']}")
    if response.get("artifacts_dir"):
        print(f"run_dir: {response['artifacts_dir']}")
    else:
        print(f"run_dir: {run_dir}")
    print(f"response: {response_path_for(args, args.run_id)}")
    return 0


def tail_file(path: Path, lines: int, follow: bool) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=True)
    content = path.read_text(errors="replace").splitlines()
    for line in content[-lines:]:
        print(line)
    if not follow:
        return 0
    with path.open("r") as f:
        inode = path.stat().st_ino
        f.seek(0, os.SEEK_END)
        while True:
            line = f.readline()
            if line:
                print(line, end="")
                continue
            stat = path.stat()
            if stat.st_ino != inode or stat.st_size < f.tell():
                f.close()
                f = path.open("r")
                inode = path.stat().st_ino
                continue
            time.sleep(1)


def tail(args: argparse.Namespace) -> int:
    run_dir = resolve_existing_run_dir(args)
    targets = {
        "observations": run_dir / "observations.md",
        "current": run_dir / "current.log",
        "response": response_path_for(args, args.run_id),
        "log": response_log_path_for(args, args.run_id),
    }
    return tail_file(targets[args.file], args.lines, args.follow)


# Slug regex: must start with alphanumeric, contain only [A-Za-z0-9._-], no slashes or path separators.
# This mirrors the daemon's SLUG_RE EXACTLY (including the 1+128 length bound) so an id the
# client accepts is the same set the daemon's cancelRequestIds() will act on — otherwise an
# over-long id would write a marker the daemon silently ignores (cancel never fires).
_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$")


def validate_slug(run_id: str) -> None:
    """Raise SystemExit if run_id is not a safe slug (mirrors daemon SLUG_RE)."""
    if not _SLUG_RE.match(run_id):
        raise SystemExit(
            f"Invalid run-id '{run_id}': must start with a letter or digit and contain only "
            "letters, digits, dots, underscores, or hyphens (no slashes or path separators)."
        )


def cancel(args: argparse.Namespace) -> int:
    """Write a cancel marker to <mailbox_root>/cancel/<run_id>.json.

    The daemon scans cancel/ each poll tick, sends SIGTERM to the matching
    child process (then SIGKILL after a 10-second grace period), and writes a
    status:cancelled response.  The caller only needs to drop this file.
    """
    run_id: str = args.run_id
    validate_slug(run_id)

    root = mailbox_root_from_args(args)
    cancel_dir = root / "cancel"
    cancel_dir.mkdir(parents=True, exist_ok=True)
    try:
        cancel_dir.chmod(0o700)
    except OSError:
        pass

    marker_path = cancel_dir / f"{run_id}.json"
    payload: dict = {"run_id": run_id, "requested_at": now()}
    if getattr(args, "reason", None):
        payload["reason"] = args.reason
    write_json_atomic(marker_path, payload)
    print(f"cancel requested for {run_id} -> {marker_path} (daemon will act within one poll tick)")
    return 0


def daemon_control_unimplemented(command: str) -> int:
    raise SystemExit(
        f"{command} now uses the daemon mailbox, but daemon-side supervised_loop/control is not implemented yet. "
        "Use `once` for the current request-file path."
    )


def add_common_start_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--cwd", default=".", help="Workspace directory for delegated CLI calls.")
    parser.add_argument(
        "--state-dir",
        default=DEFAULT_STATE_DIR,
        help="Delegation mailbox/state directory. Default: ~/.cli-delegator. Relative paths are resolved under --cwd.",
    )
    parser.add_argument("--run-id", help="Stable delegation id. Default: timestamp.")
    parser.add_argument("--skill", required=True, help="Prompt-only skill hint: skill name or SKILL.md path.")
    parser.add_argument("--task", help="Delegated task.")
    parser.add_argument("--task-file", help="Read delegated task from a file.")
    parser.add_argument(
        "--max-minutes",
        "--timeout-minutes",
        dest="max_minutes",
        type=int,
        default=DEFAULT_MAX_MINUTES,
        help="Maximum daemon request runtime in minutes.",
    )
    parser.add_argument("--backend", choices=["codex", "claude"], default=DEFAULT_BACKEND, help="Delegated CLI backend. Default: codex.")
    parser.add_argument("--profile", default=DEFAULT_PROFILE, help=f"Codex profile for daemon requests. Default: {DEFAULT_PROFILE}.")
    parser.add_argument("--capability", choices=["read_only_review", "workspace_write"], default="read_only_review", help="Daemon launch capability. Default: read_only_review.")
    parser.add_argument("--force", action="store_true", help="Overwrite a still-pending request file with the same id.")
    # Legacy compatibility flags accepted so older invocations fail less often.
    parser.add_argument("--interval", type=int, default=120, help=argparse.SUPPRESS)
    parser.add_argument("--effort", default="inherit", help=argparse.SUPPRESS)
    parser.add_argument("--sandbox", default="read-only", help=argparse.SUPPRESS)
    parser.add_argument("--allow-network", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--no-network", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--allow-danger-full-access", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--approval", default="never", help=argparse.SUPPRESS)
    parser.add_argument("--model", help=argparse.SUPPRESS)
    parser.add_argument("--codex-bin", default="codex", help=argparse.SUPPRESS)
    parser.add_argument("--claude-bin", default="claude", help=argparse.SUPPRESS)
    parser.add_argument("--claude-profile", default="inherit", help=argparse.SUPPRESS)
    parser.add_argument("--claude-config-dir", help=argparse.SUPPRESS)
    parser.add_argument("--claude-permission-mode", default="plan", help=argparse.SUPPRESS)
    parser.add_argument("--claude-no-resume", action="store_true", help=argparse.SUPPRESS)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Delegate tasks to local agent CLIs through the daemon request mailbox.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_start = sub.add_parser("start", help="Reserved for daemon supervised_loop; currently reports unsupported.")
    add_common_start_args(p_start)
    p_start.add_argument("--foreground", action="store_true", help=argparse.SUPPRESS)
    p_start.set_defaults(func=lambda args: daemon_control_unimplemented("start"))

    p_once = sub.add_parser("once", help="Submit one delegate_request and wait for the daemon response.")
    add_common_start_args(p_once)
    p_once.add_argument("--dry-run", action="store_true", help="Print the delegate_request without submitting it.")
    p_once.set_defaults(func=once)

    p_resume = sub.add_parser("resume", help="Reserved for daemon control; currently reports unsupported.")
    p_resume.add_argument("--cwd", default=".")
    p_resume.add_argument("--state-dir", default=DEFAULT_STATE_DIR)
    p_resume.add_argument("--run-id", required=True)
    p_resume.add_argument("--foreground", action="store_true")
    p_resume.add_argument("--force", action="store_true")
    p_resume.set_defaults(func=lambda args: daemon_control_unimplemented("resume"))

    for name, func in [("status", status)]:
        p = sub.add_parser(name)
        p.add_argument("--cwd", default=".")
        p.add_argument("--state-dir", default=DEFAULT_STATE_DIR)
        p.add_argument("--run-id", required=True)
        p.set_defaults(func=func)

    for name in ["stop", "kill-agent"]:
        p = sub.add_parser(name, help="Reserved for daemon control; currently reports unsupported.")
        p.add_argument("--cwd", default=".")
        p.add_argument("--state-dir", default=DEFAULT_STATE_DIR)
        p.add_argument("--run-id", required=True)
        p.add_argument("--grace-seconds", type=int, default=3)
        p.add_argument("--force", action="store_true")
        p.set_defaults(func=lambda args, command=name: daemon_control_unimplemented(command))

    p_tail = sub.add_parser("tail")
    p_tail.add_argument("--cwd", default=".")
    p_tail.add_argument("--state-dir", default=DEFAULT_STATE_DIR)
    p_tail.add_argument("--run-id", required=True)
    p_tail.add_argument("--file", choices=["observations", "current", "response", "log"], default="observations")
    p_tail.add_argument("--lines", type=int, default=40)
    p_tail.add_argument("--follow", action="store_true")
    p_tail.set_defaults(func=tail)

    p_cancel = sub.add_parser(
        "cancel",
        help="Request cancellation of a running daemon task by writing a cancel marker file.",
    )
    p_cancel.add_argument("--cwd", default=".")
    p_cancel.add_argument(
        "--state-dir",
        default=DEFAULT_STATE_DIR,
        help=(
            "Delegation mailbox/state directory. Default: ~/.cli-delegator. "
            "Pass --state-dir ~/.debate-router to cancel a debate-router task."
        ),
    )
    p_cancel.add_argument("--run-id", required=True, help="The run id to cancel (must be a valid slug).")
    p_cancel.add_argument("--reason", default=None, help="Optional human-readable cancel reason recorded in the marker.")
    p_cancel.set_defaults(func=cancel)

    p_supervise = sub.add_parser("supervise", help=argparse.SUPPRESS)
    p_supervise.add_argument("--run-dir", required=True)
    p_supervise.set_defaults(func=lambda args: daemon_control_unimplemented("supervise"))

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
