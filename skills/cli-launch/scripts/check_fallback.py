#!/usr/bin/env python3
# Mock-based smoke checks for cli_launch's rate-limit detection and same-task
# engine fallback. Stubs require_cli + subprocess.Popen so we can verify, in
# milliseconds and without real CLIs, that: a failed run matching a provider's
# rate-limit signature is labeled "rate_limited" (and only then); a rate_limited
# slot is re-run on its pre-built fallback engine; ordinary failures never trigger
# a swap; and the mechanical run_specs_parallel stays detection-off by default.

from __future__ import annotations

import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import cli_launch
from cli_launch import (
    DEFAULT_RATE_LIMIT_PATTERNS,
    LaunchSpec,
    ParallelSpec,
    classify_rate_limit,
    compile_rate_limit_patterns,
    run_specs_parallel,
    run_specs_parallel_with_fallback,
)


class FakePopen:
    def __init__(self, *, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.pid = 12345
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr

    def communicate(self, input: Any = None, timeout: float | None = None):
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


def make_spec(binary: str, *, provider: str, timeout_seconds: int = 60) -> LaunchSpec:
    return LaunchSpec(
        provider=provider,
        label=binary,
        command=[binary, "arg"],
        display_command=f"{binary} arg",
        timeout_seconds=timeout_seconds,
    )


RL_STDERR = "Error: usage limit reached (HTTP 429 Too Many Requests)"


def check_classify_pure() -> None:
    pats = compile_rate_limit_patterns()["claude"]
    assert classify_rate_limit(RL_STDERR, "", pats) is True
    assert classify_rate_limit("segfault in module", "", pats) is False
    assert classify_rate_limit(RL_STDERR, "", []) is False  # empty patterns => off
    assert classify_rate_limit("", "you hit your quota", pats) is True  # scans stdout too


def check_detect_only_when_patterns_given() -> None:
    p = Patcher()
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(cli_launch.subprocess, "Popen", make_popen_factory({"c": {"returncode": 1, "stderr": RL_STDERR}}))
        spec = ParallelSpec(spec=make_spec("c", provider="claude"))
        # default run_specs_parallel: detection OFF, so a matching failure stays nonzero_exit
        assert run_specs_parallel([spec])[0].error_category == "nonzero_exit"
        # opt in with patterns: same failure becomes rate_limited
        assert run_specs_parallel([spec], rate_limit_patterns=DEFAULT_RATE_LIMIT_PATTERNS)[0].error_category == "rate_limited"
    finally:
        p.restore_all()


def check_ordinary_failure_not_rate_limited() -> None:
    p = Patcher()
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(cli_launch.subprocess, "Popen", make_popen_factory({"c": {"returncode": 2, "stderr": "boom: nil deref"}}))
        spec = ParallelSpec(spec=make_spec("c", provider="claude"))
        r = run_specs_parallel([spec], rate_limit_patterns=DEFAULT_RATE_LIMIT_PATTERNS)[0]
        assert r.error_category == "nonzero_exit", r.error_category
    finally:
        p.restore_all()


def check_fallback_swaps_engine_in_order() -> None:
    p = Patcher()
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(
            cli_launch.subprocess,
            "Popen",
            make_popen_factory(
                {
                    "ok0": {"returncode": 0, "stdout": "A0"},
                    "climited": {"returncode": 1, "stderr": RL_STDERR},  # claude rate-limited
                    "cok1": {"returncode": 0, "stdout": "B1"},  # codex fallback ok
                    "ok2": {"returncode": 0, "stdout": "C2"},
                }
            ),
        )
        specs = [
            ParallelSpec(spec=make_spec("ok0", provider="claude")),
            ParallelSpec(
                spec=make_spec("climited", provider="claude"),
                fallbacks=(ParallelSpec(spec=make_spec("cok1", provider="codex")),),
            ),
            ParallelSpec(spec=make_spec("ok2", provider="codex")),
        ]
        results = run_specs_parallel_with_fallback(specs)
        assert [r.status for r in results] == ["completed", "completed", "completed"]
        assert [r.stdout for r in results] == ["A0", "B1", "C2"]  # input order; slot 1 swapped to codex
    finally:
        p.restore_all()


def check_fallback_exhausted_stays_rate_limited() -> None:
    p = Patcher()
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(
            cli_launch.subprocess,
            "Popen",
            make_popen_factory(
                {
                    "climited": {"returncode": 1, "stderr": RL_STDERR},
                    "climited2": {"returncode": 1, "stderr": RL_STDERR},  # fallback ALSO limited
                }
            ),
        )
        spec = ParallelSpec(
            spec=make_spec("climited", provider="claude"),
            fallbacks=(ParallelSpec(spec=make_spec("climited2", provider="codex")),),
        )
        r = run_specs_parallel_with_fallback([spec])[0]
        assert r.error_category == "rate_limited", r.error_category  # no engine left => degrade
    finally:
        p.restore_all()


def check_no_swap_for_ordinary_failure() -> None:
    p = Patcher()
    try:
        p.patch(cli_launch, "require_cli", lambda _: None)
        p.patch(
            cli_launch.subprocess,
            "Popen",
            make_popen_factory(
                {
                    "cfail": {"returncode": 1, "stderr": "boom"},  # NOT a rate-limit signature
                    "cok": {"returncode": 0, "stdout": "FALLBACK_RAN"},
                }
            ),
        )
        spec = ParallelSpec(
            spec=make_spec("cfail", provider="claude"),
            fallbacks=(ParallelSpec(spec=make_spec("cok", provider="codex")),),
        )
        r = run_specs_parallel_with_fallback([spec])[0]
        assert r.error_category == "nonzero_exit", r.error_category
        assert r.stdout != "FALLBACK_RAN", "fallback must NOT run for an ordinary failure"
    finally:
        p.restore_all()


def check_empty_input() -> None:
    assert run_specs_parallel_with_fallback([]) == []


CHECKS = [
    check_classify_pure,
    check_detect_only_when_patterns_given,
    check_ordinary_failure_not_rate_limited,
    check_fallback_swaps_engine_in_order,
    check_fallback_exhausted_stays_rate_limited,
    check_no_swap_for_ordinary_failure,
    check_empty_input,
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
