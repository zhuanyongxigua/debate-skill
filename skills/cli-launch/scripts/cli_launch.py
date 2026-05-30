#!/usr/bin/env python3
# This helper centralizes local agent CLI startup defaults so orchestration
# skills can share provider launch behavior without sharing lifecycle policy.

from __future__ import annotations

import concurrent.futures
import os
import re
import shlex
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence


DEFAULT_TIMEOUT_SECONDS = 900
DEFAULT_PROPOSAL_GENERATION_TIMEOUT_SECONDS = 1800
PHASE_TIMEOUT_SECONDS = {
    "proposal_generation": DEFAULT_PROPOSAL_GENERATION_TIMEOUT_SECONDS,
    "debate_execution": DEFAULT_TIMEOUT_SECONDS,
    "critique": DEFAULT_TIMEOUT_SECONDS,
    "cross_review": DEFAULT_TIMEOUT_SECONDS,
    "arbitration": DEFAULT_TIMEOUT_SECONDS,
}
DEFAULT_CODEX_PROFILE: str | None = None
DEFAULT_CODEX_EFFORT = "xhigh"
DEFAULT_CODEX_APPROVAL = "never"
DEFAULT_CODEX_SANDBOX = "workspace-write"
DEFAULT_CODEX_NETWORK_ACCESS = True
CODEX_WORKSPACE_NETWORK_OVERRIDE = "sandbox_workspace_write.network_access=true"
DEFAULT_CLAUDE_PROFILE = "inherit"
DEFAULT_PERSONAL_CLAUDE_CONFIG_DIR = "~/.claude-personal"
CLAUDE_COMPANY_ENV_VARS = (
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
)
NETWORK_TASK_RE = re.compile(
    r"(?i)(\bssh\b|\bscp\b|\brsync\b|\bcurl\b|\bwget\b|\bping\b|\bnc\b|\btelnet\b|"
    r"\bgit\s+(fetch|pull|ls-remote)\b|https?://|\b\d{1,3}(?:\.\d{1,3}){3}\b|"
    r"\b[a-z0-9._%+-]+@[a-z0-9.-]+\b)"
)


@dataclass(frozen=True)
class LaunchSpec:
    provider: str
    label: str
    command: list[str]
    display_command: str
    stdin: str | None = None
    env: dict[str, str] | None = None
    profile: str | None = None
    prompt_transport: str = "argv"
    sandbox: str = "profile_default"
    network: str = "not_needed"
    approval: str = "profile_default"
    phase: str | None = None
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS
    summary_source: str = "stdout"
    metadata: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "label": self.label,
            "command": list(self.command),
            "display_command": self.display_command,
            "stdin": self.stdin,
            "env": self.env,
            "profile": self.profile,
            "prompt_transport": self.prompt_transport,
            "sandbox": self.sandbox,
            "network": self.network,
            "approval": self.approval,
            "phase": self.phase,
            "timeout_seconds": self.timeout_seconds,
            "summary_source": self.summary_source,
            "metadata": dict(self.metadata),
        }


def require_cli(binary: str) -> None:
    if shutil.which(binary) is None:
        raise SystemExit(f"Required CLI not found on PATH: {binary}")


def quote_command(argv: Sequence[str]) -> str:
    return " ".join(shlex.quote(str(item)) for item in argv)


def redact_argv(argv: Sequence[str], *, prompt: str | None = None) -> list[str]:
    redacted: list[str] = []
    skip_next = False
    for raw in argv:
        item = str(raw)
        if skip_next:
            redacted.append("<prompt>")
            skip_next = False
            continue
        if item in {"-p", "--prompt"}:
            redacted.append(item)
            skip_next = True
            continue
        if item.startswith("--prompt="):
            redacted.append("--prompt=<prompt>")
            continue
        if prompt is not None and item == prompt:
            redacted.append("<prompt>")
            continue
        if len(item) > 120 and ("\n" in item or item.count(" ") > 8):
            redacted.append("<prompt>")
            continue
        redacted.append(item)
    return redacted


def display_argv(argv: Sequence[str], *, prompt: str | None = None, stdin_prompt: bool = False) -> str:
    parts = redact_argv(argv, prompt=prompt)
    if stdin_prompt:
        parts = list(parts) + ["<stdin-prompt>"]
    return quote_command(parts)


def timeout_seconds_for_phase(phase: str | None = None, timeout_seconds: int | None = None) -> int:
    if timeout_seconds is not None:
        return int(timeout_seconds)
    if phase is None:
        return DEFAULT_TIMEOUT_SECONDS
    return PHASE_TIMEOUT_SECONDS.get(phase, DEFAULT_TIMEOUT_SECONDS)


def claude_env(
    *,
    profile: str = DEFAULT_CLAUDE_PROFILE,
    config_dir: str | None = None,
    base_env: dict[str, str] | None = None,
) -> dict[str, str] | None:
    if profile == "inherit":
        if config_dir:
            env = dict(os.environ if base_env is None else base_env)
            env["CLAUDE_CONFIG_DIR"] = str(Path(config_dir).expanduser())
            return env
        return None

    env = dict(os.environ if base_env is None else base_env)
    if profile == "personal":
        for name in CLAUDE_COMPANY_ENV_VARS:
            env.pop(name, None)
        env["CLAUDE_CONFIG_DIR"] = str(Path(config_dir or DEFAULT_PERSONAL_CLAUDE_CONFIG_DIR).expanduser())
    elif profile == "company":
        if config_dir:
            env["CLAUDE_CONFIG_DIR"] = str(Path(config_dir).expanduser())
    else:
        raise ValueError(f"Unsupported Claude profile: {profile}")
    return env


def task_looks_networked(task: str) -> bool:
    return bool(NETWORK_TASK_RE.search(task))


def resolve_codex_sandbox(
    *,
    task: str,
    sandbox: str = DEFAULT_CODEX_SANDBOX,
    network_access: bool = DEFAULT_CODEX_NETWORK_ACCESS,
    allow_danger_full_access: bool = False,
    enforce_network_heuristic: bool = True,
) -> str:
    if sandbox == "danger-full-access" and not allow_danger_full_access:
        raise SystemExit(
            "Codex danger-full-access removes the local filesystem sandbox and enables broad access. "
            "Ask the user to approve full access, then re-run with the explicit danger-full-access opt-in flag."
        )
    if network_access:
        if sandbox == "danger-full-access":
            return sandbox
        if sandbox == "read-only":
            raise SystemExit(
                "Codex read-only sandbox cannot use sandbox_workspace_write.network_access=true. "
                "Use the default workspace-write sandbox for network access, or pass the no-network option with read-only."
            )
        return sandbox
    if enforce_network_heuristic and sandbox != "danger-full-access" and task_looks_networked(task):
        raise SystemExit(
            "This delegated task appears to require network or SSH, but Codex sandbox network access is not enabled. "
            "Re-run with --allow-network to use workspace-write plus "
            f"-c {CODEX_WORKSPACE_NETWORK_OVERRIDE!r}. Use danger-full-access only after explicit user approval "
            "and the explicit danger-full-access opt-in flag."
        )
    return sandbox


def codex_config_overrides_for_launch(
    *,
    sandbox: str,
    network: str = "not_needed",
    config_overrides: Sequence[str] | None = None,
) -> list[str]:
    overrides: list[str] = []
    if network == "needed_enabled" and sandbox != "danger-full-access":
        if sandbox == "read-only":
            raise ValueError(
                "Codex network-enabled launches must use workspace-write or danger-full-access. "
                "Call resolve_codex_launch_policy before build_codex_spec."
            )
        overrides.append(CODEX_WORKSPACE_NETWORK_OVERRIDE)
    overrides.extend(str(item) for item in (config_overrides or []))

    deduped: list[str] = []
    seen: set[str] = set()
    for item in overrides:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped


def resolve_codex_launch_policy(
    *,
    task: str,
    sandbox: str = DEFAULT_CODEX_SANDBOX,
    network_access: bool = DEFAULT_CODEX_NETWORK_ACCESS,
    allow_danger_full_access: bool = False,
    enforce_network_heuristic: bool = True,
) -> dict[str, Any]:
    resolved_sandbox = resolve_codex_sandbox(
        task=task,
        sandbox=sandbox,
        network_access=network_access,
        allow_danger_full_access=allow_danger_full_access,
        enforce_network_heuristic=enforce_network_heuristic,
    )
    network = "needed_enabled" if network_access else "not_needed"
    if resolved_sandbox == "danger-full-access" and task_looks_networked(task):
        network = "needed_enabled"
    config_overrides = codex_config_overrides_for_launch(sandbox=resolved_sandbox, network=network)
    return {
        "sandbox": resolved_sandbox,
        "network": network,
        "config_overrides": config_overrides,
        "danger_full_access": resolved_sandbox == "danger-full-access",
    }


def build_claude_spec(
    *,
    prompt: str,
    session_name: str | None = None,
    resume: bool = False,
    claude_bin: str = "claude",
    profile: str = DEFAULT_CLAUDE_PROFILE,
    config_dir: str | None = None,
    permission_mode: str = "default",
    prompt_transport: str = "argv",
    input_format: str | None = None,
    output_format: str | None = None,
    model: str | None = None,
    effort: str | None = None,
    phase: str | None = None,
    timeout_seconds: int | None = None,
) -> LaunchSpec:
    resolved_timeout_seconds = timeout_seconds_for_phase(phase=phase, timeout_seconds=timeout_seconds)
    cmd = [claude_bin]
    if resume and session_name:
        cmd.extend(["--resume", session_name])
    elif session_name:
        cmd.extend(["--name", session_name])
    cmd.append("--print")
    if input_format:
        cmd.extend(["--input-format", input_format])
    cmd.extend(["--permission-mode", permission_mode])
    if output_format:
        cmd.extend(["--output-format", output_format])
    if effort and effort != "inherit":
        cmd.extend(["--effort", effort])
    if model:
        cmd.extend(["--model", model])
    stdin = None
    if prompt_transport == "argv":
        cmd.append(prompt)
    elif prompt_transport == "stdin":
        stdin = prompt
    else:
        raise ValueError(f"Unsupported prompt_transport: {prompt_transport}")
    return LaunchSpec(
        provider="claude",
        label="Claude Code",
        command=cmd,
        display_command=display_argv(cmd, prompt=prompt, stdin_prompt=stdin is not None),
        stdin=stdin,
        env=claude_env(profile=profile, config_dir=config_dir),
        profile=profile,
        prompt_transport=prompt_transport,
        sandbox="profile_default",
        network="not_needed",
        approval="profile_default",
        phase=phase,
        timeout_seconds=resolved_timeout_seconds,
        metadata={
            "session_name": session_name,
            "resume": resume,
            "permission_mode": permission_mode,
            "model": model,
            "effort": effort,
        },
    )


def build_codex_spec(
    *,
    prompt: str,
    codex_bin: str = "codex",
    profile: str | None = DEFAULT_CODEX_PROFILE,
    approval: str = DEFAULT_CODEX_APPROVAL,
    effort: str = DEFAULT_CODEX_EFFORT,
    sandbox: str = DEFAULT_CODEX_SANDBOX,
    cwd: str = ".",
    model: str | None = None,
    prompt_transport: str = "argv",
    json_output: bool = False,
    summary_path: str | Path | None = None,
    network: str = "needed_enabled",
    config_overrides: Sequence[str] | None = None,
    phase: str | None = None,
    timeout_seconds: int | None = None,
) -> LaunchSpec:
    resolved_timeout_seconds = timeout_seconds_for_phase(phase=phase, timeout_seconds=timeout_seconds)
    cmd = [codex_bin]
    if profile:
        cmd.extend(["--profile", profile])
    cmd.extend(["--ask-for-approval", approval])
    if effort != "inherit":
        cmd.extend(["-c", f'model_reasoning_effort="{effort}"'])
    effective_config_overrides = codex_config_overrides_for_launch(
        sandbox=sandbox,
        network=network,
        config_overrides=config_overrides,
    )
    for override in effective_config_overrides:
        cmd.extend(["-c", override])
    cmd.extend(["exec", "--sandbox", sandbox, "--color", "never"])
    if json_output:
        cmd.append("--json")
    cmd.extend(["-C", cwd])
    if summary_path is not None:
        cmd.extend(["-o", str(summary_path)])
    if model:
        cmd.extend(["--model", model])
    stdin = None
    if prompt_transport == "argv":
        cmd.append(prompt)
    elif prompt_transport == "stdin":
        cmd.append("-")
        stdin = prompt
    else:
        raise ValueError(f"Unsupported prompt_transport: {prompt_transport}")
    return LaunchSpec(
        provider="codex",
        label="Codex CLI",
        command=cmd,
        display_command=display_argv(cmd, prompt=prompt, stdin_prompt=stdin is not None),
        stdin=stdin,
        env=None,
        profile=profile,
        prompt_transport=prompt_transport,
        sandbox=sandbox,
        network=network,
        approval=approval,
        phase=phase,
        timeout_seconds=resolved_timeout_seconds,
        summary_source="summary_file" if summary_path is not None else "stdout",
        metadata={
            "cwd": cwd,
            "model": model,
            "effort": effort,
            "json_output": json_output,
            "summary_path": str(summary_path) if summary_path is not None else None,
            "config_overrides": effective_config_overrides,
        },
    )


def build_copilot_spec(
    *,
    prompt: str,
    session_name: str,
    resume: bool = False,
    copilot_bin: str = "copilot",
    model: str | None = None,
    effort: str | None = None,
    allow_all_tools: bool = False,
    phase: str | None = None,
    timeout_seconds: int | None = None,
) -> LaunchSpec:
    resolved_timeout_seconds = timeout_seconds_for_phase(phase=phase, timeout_seconds=timeout_seconds)
    cmd = [copilot_bin, "--no-color", "--silent", "--mode=plan", "--no-ask-user"]
    if allow_all_tools:
        cmd.append("--allow-all-tools")
    if resume:
        cmd.append(f"--resume={session_name}")
    else:
        cmd.append(f"--name={session_name}")
    if model:
        cmd.append(f"--model={model}")
    if effort:
        cmd.append(f"--effort={effort}")
    cmd.append(f"--prompt={prompt}")
    return LaunchSpec(
        provider="copilot",
        label="GitHub Copilot CLI",
        command=cmd,
        display_command=display_argv(cmd, prompt=prompt),
        stdin=None,
        env=None,
        profile=None,
        prompt_transport="argv",
        sandbox="profile_default",
        network="not_needed",
        approval="profile_default",
        phase=phase,
        timeout_seconds=resolved_timeout_seconds,
        metadata={"session_name": session_name, "resume": resume, "model": model, "effort": effort},
    )


def run_spec(spec: LaunchSpec, *, cwd: str = ".", timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    require_cli(spec.command[0])
    return subprocess.run(
        spec.command,
        cwd=cwd,
        input=spec.stdin,
        env=spec.env,
        capture_output=True,
        text=True,
        timeout=timeout if timeout is not None else spec.timeout_seconds,
        check=False,
    )


def popen_spec(
    spec: LaunchSpec,
    *,
    cwd: str = ".",
    stdout: Any = subprocess.PIPE,
    stderr: Any = subprocess.STDOUT,
    text: bool = True,
    bufsize: int = 1,
    start_new_session: bool = True,
) -> subprocess.Popen[str]:
    require_cli(spec.command[0])
    return subprocess.Popen(
        spec.command,
        cwd=cwd,
        stdin=subprocess.PIPE if spec.stdin is not None else None,
        stdout=stdout,
        stderr=stderr,
        env=spec.env,
        text=text,
        bufsize=bufsize,
        start_new_session=start_new_session,
    )


@dataclass(frozen=True)
class ParallelSpec:
    """Bundles a LaunchSpec with per-call execution context for parallel fan-out.

    caller_metadata is opaque to cli-launch: it is returned verbatim on the
    matching ParallelResult so callers (e.g. debate-router) can attach phase,
    role, candidate id, or any other debate-level semantics without leaking
    those concepts into cli-launch's schema.
    """

    spec: LaunchSpec
    cwd: str = "."
    timeout_override: int | None = None
    caller_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ParallelResult:
    status: str  # "completed" | "timed_out" | "error"
    returncode: int | None
    error_category: str | None  # None | "timeout" | "missing_cli" | "nonzero_exit" | "exception"
    stdout: str
    stderr: str
    elapsed_seconds: float
    timeout_seconds: int
    timed_out: bool
    display_command: str
    caller_metadata: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "returncode": self.returncode,
            "error_category": self.error_category,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "elapsed_seconds": self.elapsed_seconds,
            "timeout_seconds": self.timeout_seconds,
            "timed_out": self.timed_out,
            "display_command": self.display_command,
            "caller_metadata": dict(self.caller_metadata),
        }


def _terminate_process_group(proc: subprocess.Popen[str], sig: int) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), sig)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except (ProcessLookupError, OSError):
            pass


def _run_one_parallel(parallel: ParallelSpec) -> ParallelResult:
    spec = parallel.spec
    timeout_seconds = (
        parallel.timeout_override
        if parallel.timeout_override is not None
        else spec.timeout_seconds
    )
    start = time.monotonic()

    try:
        require_cli(spec.command[0])
    except SystemExit as exc:
        return ParallelResult(
            status="error",
            returncode=None,
            error_category="missing_cli",
            stdout="",
            stderr=str(exc),
            elapsed_seconds=time.monotonic() - start,
            timeout_seconds=timeout_seconds,
            timed_out=False,
            display_command=spec.display_command,
            caller_metadata=dict(parallel.caller_metadata),
        )

    try:
        proc = subprocess.Popen(
            spec.command,
            cwd=parallel.cwd,
            stdin=subprocess.PIPE if spec.stdin is not None else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=spec.env,
            text=True,
            start_new_session=True,
        )
    except (OSError, ValueError) as exc:
        return ParallelResult(
            status="error",
            returncode=None,
            error_category="exception",
            stdout="",
            stderr=f"{type(exc).__name__}: {exc}",
            elapsed_seconds=time.monotonic() - start,
            timeout_seconds=timeout_seconds,
            timed_out=False,
            display_command=spec.display_command,
            caller_metadata=dict(parallel.caller_metadata),
        )

    timed_out = False
    try:
        stdout, stderr = proc.communicate(input=spec.stdin, timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        _terminate_process_group(proc, signal.SIGTERM)
        try:
            stdout, stderr = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            _terminate_process_group(proc, signal.SIGKILL)
            stdout, stderr = proc.communicate()

    elapsed = time.monotonic() - start
    if timed_out:
        status = "timed_out"
        error_category: str | None = "timeout"
    elif proc.returncode != 0:
        status = "error"
        error_category = "nonzero_exit"
    else:
        status = "completed"
        error_category = None

    return ParallelResult(
        status=status,
        returncode=proc.returncode,
        error_category=error_category,
        stdout=stdout or "",
        stderr=stderr or "",
        elapsed_seconds=elapsed,
        timeout_seconds=timeout_seconds,
        timed_out=timed_out,
        display_command=spec.display_command,
        caller_metadata=dict(parallel.caller_metadata),
    )


def run_specs_parallel(
    specs: Sequence[ParallelSpec],
    *,
    max_parallel: int | None = None,
) -> list[ParallelResult]:
    """Fan out multiple CLI launches and join on per-spec timeouts.

    Results are returned in the same order as the input specs (not completion
    order). Each entry's caller_metadata is the dict that was attached to the
    matching ParallelSpec, returned unchanged so debate-style callers can
    correlate results to their own phase/role/candidate ids.

    cli-launch only owns mechanical fan-out: each child is started with a
    fresh process group and on timeout the group receives SIGTERM, then
    SIGKILL after a 10s grace period. There is no retry, no policy decision
    about whether to continue, no judging, no transcript shape.
    """
    if not specs:
        return []
    workers = max_parallel if max_parallel and max_parallel > 0 else len(specs)
    workers = max(1, min(workers, len(specs)))
    results: list[ParallelResult | None] = [None] * len(specs)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_index = {
            executor.submit(_run_one_parallel, parallel): idx
            for idx, parallel in enumerate(specs)
        }
        for future in concurrent.futures.as_completed(future_to_index):
            idx = future_to_index[future]
            results[idx] = future.result()
    assert all(r is not None for r in results)
    return [r for r in results if r is not None]
