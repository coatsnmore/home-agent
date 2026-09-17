"""Isolated script execution engine with timeouts and output bounds."""

import asyncio
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict

MAX_OUTPUT_BYTES = 16 * 1024  # 16 KB max stdout/stderr cap
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_TIMEOUT_SECONDS = 30.0

CURRENT_DIR = Path(__file__).resolve().parent
SDK_DIR = CURRENT_DIR.parent / "sdk"


async def run_python_code(code: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> Dict[str, Any]:
    """Execute Python code in an isolated subprocess with strict timeouts and output caps.

    Args:
        code: Python script string to execute.
        timeout: Execution timeout in seconds (capped at MAX_TIMEOUT_SECONDS).

    Returns:
        Dict with execution results: success, stdout, stderr, exit_code, duration_ms.
    """
    actual_timeout = min(max(1.0, float(timeout)), MAX_TIMEOUT_SECONDS)

    env = os.environ.copy()
    current_pythonpath = env.get("PYTHONPATH", "")
    sdk_path = str(SDK_DIR)
    env["PYTHONPATH"] = f"{sdk_path}:{current_pythonpath}" if current_pythonpath else sdk_path
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    # Prevent pip downloads in child processes
    env["PIP_NO_INDEX"] = "1"

    start_time = time.perf_counter()

    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            code,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        try:
            stdout_data, stderr_data = await asyncio.wait_for(
                proc.communicate(),
                timeout=actual_timeout,
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return {
                "success": False,
                "stdout": "",
                "stderr": f"Execution timed out after {actual_timeout}s.",
                "exit_code": -1,
                "duration_ms": duration_ms,
            }

        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

        def _decode_and_cap(data: bytes) -> str:
            if len(data) > MAX_OUTPUT_BYTES:
                return data[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace") + "\n... [Output truncated: exceeded 16KB limit]"
            return data.decode("utf-8", errors="replace")

        stdout_str = _decode_and_cap(stdout_data or b"")
        stderr_str = _decode_and_cap(stderr_data or b"")
        exit_code = proc.returncode if proc.returncode is not None else 0

        return {
            "success": exit_code == 0,
            "stdout": stdout_str,
            "stderr": stderr_str,
            "exit_code": exit_code,
            "duration_ms": duration_ms,
        }

    except Exception as e:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Failed to execute code: {str(e)}",
            "exit_code": -1,
            "duration_ms": duration_ms,
        }
