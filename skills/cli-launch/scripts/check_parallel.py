#!/usr/bin/env python3
# Mock-based smoke checks for cli_launch.run_specs_parallel. Stubs require_cli,
# subprocess.Popen, and _terminate_process_group so the orchestration contract
# (status mapping, metadata pass-through, input-order preservation, timeout
# escalation) can be verified in milliseconds without spawning real children.

from __future__ import annotations

import subprocess
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import cli_launch
from cli_launch import (
    LaunchSpec,
    ParallelSpec,
    run_specs_parallel,
)


class FakePopen:
    def __init__(
        self,
        *,
        returncode: int = 0,
        stdout: str = "",
        stderr: str = "",
        timeout_first_call: bool = False,
        delay_seconds: float = 0.0,
    ) -> None:
        self.pid = 12345
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr
        self._timeout_first = timeout_first_call
        self._delay = delay_seconds
        self._calls = 0

    def communicate(self, input: Any = None, timeout: float | None = None):
        self._calls += 1
        if self._timeout_first and self._calls == 1:
            raise subprocess.TimeoutExpired(cmd="fake", timeout=timeout)
        if self._delay > 0:
            time.sleep(self._delay)
        return (self._stdout, self._stderr)

    def kill(self) -> None:
        pass


def make_popen_factory(scenarios: dict[str, dict[str, Any]]):
    def factory(command, *args, **kwargs):
        cfg = scenarios.get(command[0], {})
        return FakePopen(
            returncode=cfg.get("returncode", 0),
            stdout=cfg.get("stdout", ""),
            stderr=cfg.get("stderr", ""),
            timeout_first_call=cfg.get("timeout_first", False),
            delay_seconds=cfg.get("delay", 0.0),
        )
    return factory


class Patcher:
    def __init__(self) -> None:
        self._restores: list[Callable[[], None]] = []

    def patch(self, target_obj: Any, attr: str, value: Any) -> None:
        original = getattr(target_obj, attr)
        self._restores.append(lambda: setattr(target_obj, attr, original))
        setattr(target_obj, attr, value)

    def restore_all(self) -> None:
        while self._restores:
            self._restores.pop()()


def make_spec(name: str, *, timeout_seconds: int = 60) -> LaunchSpec:
    return LaunchSpec(
        provider="fake",
        label=name,
        command=[name, "arg"],
        display_command=f"{name} arg",
        timeout_seconds=timeout_seconds,
    )


def check_empty_input() -> None:
    assert run_specs_parallel([]) == []


def check_caller_metadata_passthrough() -> None:
    p = Patcher()
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(cli_launch.subprocess, "Popen", make_popen_factory({"a": {}, "b": {}}))
        specs = [
            ParallelSpec(spec=make_spec("a"), caller_metadata={"role": "proposer", "id": "P1"}),
            ParallelSpec(spec=make_spec("b"), caller_metadata={"role": "proposer", "id": "P2"}),
        ]
        results = run_specs_parallel(specs)
        assert [r.caller_metadata for r in results] == [
            {"role": "proposer", "id": "P1"},
            {"role": "proposer", "id": "P2"},
        ]
    finally:
        p.restore_all()


def check_input_order_preserved() -> None:
    p = Patcher()
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(
            cli_launch.subprocess,
            "Popen",
            make_popen_factory(
                {
                    "slow": {"delay": 0.10},
                    "fast": {"delay": 0.0},
                    "mid": {"delay": 0.05},
                }
            ),
        )
        specs = [
            ParallelSpec(spec=make_spec("slow"), caller_metadata={"i": 0}),
            ParallelSpec(spec=make_spec("fast"), caller_metadata={"i": 1}),
            ParallelSpec(spec=make_spec("mid"), caller_metadata={"i": 2}),
        ]
        results = run_specs_parallel(specs, max_parallel=3)
        assert [r.caller_metadata["i"] for r in results] == [0, 1, 2]
        assert [r.display_command for r in results] == ["slow arg", "fast arg", "mid arg"]
    finally:
        p.restore_all()


def check_missing_cli() -> None:
    p = Patcher()
    try:
        def raiser(binary: str) -> None:
            raise SystemExit(f"Required CLI not found on PATH: {binary}")
        p.patch(cli_launch, "require_cli", raiser)
        p.patch(cli_launch.subprocess, "Popen", make_popen_factory({}))
        results = run_specs_parallel([ParallelSpec(spec=make_spec("missing"))])
        r = results[0]
        assert r.status == "error", r.status
        assert r.error_category == "missing_cli", r.error_category
        assert r.returncode is None
        assert "Required CLI not found" in r.stderr
        assert r.timed_out is False
    finally:
        p.restore_all()


def check_nonzero_exit() -> None:
    p = Patcher()
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(
            cli_launch.subprocess,
            "Popen",
            make_popen_factory({"fail": {"returncode": 7, "stderr": "oops"}}),
        )
        results = run_specs_parallel([ParallelSpec(spec=make_spec("fail"))])
        r = results[0]
        assert r.status == "error", r.status
        assert r.error_category == "nonzero_exit", r.error_category
        assert r.returncode == 7, r.returncode
        assert r.stderr == "oops"
        assert r.timed_out is False
    finally:
        p.restore_all()


def check_successful_run() -> None:
    p = Patcher()
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(
            cli_launch.subprocess,
            "Popen",
            make_popen_factory({"ok": {"returncode": 0, "stdout": "hi"}}),
        )
        results = run_specs_parallel([ParallelSpec(spec=make_spec("ok"))])
        r = results[0]
        assert r.status == "completed", r.status
        assert r.error_category is None
        assert r.returncode == 0
        assert r.stdout == "hi"
        assert r.timed_out is False
    finally:
        p.restore_all()


def check_timeout_path() -> None:
    p = Patcher()
    terminate_calls: list[int] = []
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(
            cli_launch.subprocess,
            "Popen",
            make_popen_factory({"slow": {"timeout_first": True, "stderr": "killed"}}),
        )
        p.patch(
            cli_launch,
            "_terminate_process_group",
            lambda proc, sig: terminate_calls.append(sig),
        )
        spec = ParallelSpec(spec=make_spec("slow"), timeout_override=1)
        results = run_specs_parallel([spec])
        r = results[0]
        assert r.status == "timed_out", r.status
        assert r.error_category == "timeout", r.error_category
        assert r.timed_out is True
        assert r.timeout_seconds == 1
        # First communicate() raises TimeoutExpired; the second returns. Only
        # one SIGTERM is expected — SIGKILL is reserved for when the grace
        # communicate() also times out, which this fake does not exercise.
        import signal as _signal
        assert terminate_calls == [_signal.SIGTERM], terminate_calls
        assert r.stderr == "killed"
    finally:
        p.restore_all()


def check_timeout_override_beats_spec_timeout() -> None:
    p = Patcher()
    seen_timeouts: list[float | None] = []

    class RecordingPopen(FakePopen):
        def communicate(self, input: Any = None, timeout: float | None = None):
            seen_timeouts.append(timeout)
            return super().communicate(input=input, timeout=timeout)

    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(cli_launch.subprocess, "Popen", lambda command, *a, **k: RecordingPopen())
        spec = ParallelSpec(
            spec=make_spec("anything", timeout_seconds=900),
            timeout_override=5,
        )
        results = run_specs_parallel([spec])
        assert results[0].timeout_seconds == 5
        assert seen_timeouts == [5], seen_timeouts
    finally:
        p.restore_all()


CHECKS = [
    check_empty_input,
    check_caller_metadata_passthrough,
    check_input_order_preserved,
    check_missing_cli,
    check_nonzero_exit,
    check_successful_run,
    check_timeout_path,
    check_timeout_override_beats_spec_timeout,
]


def main() -> int:
    failures = 0
    for check in CHECKS:
        name = check.__name__
        try:
            check()
        except Exception:
            failures += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"PASS {name}")
    total = len(CHECKS)
    print(f"\n{total - failures}/{total} passed, {failures} failed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
