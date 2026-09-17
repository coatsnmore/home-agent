"""Tool for executing Python code in the sandboxed sidecar container."""

import os
from typing import Optional
import httpx
from strands import tool


def get_sandbox_url() -> str:
    """Resolve sandbox service URL."""
    sandbox_url = os.getenv("SANDBOX_URL", "http://code-sandbox:7777")
    # If running outside docker locally, fallback to localhost:7777
    if "code-sandbox" in sandbox_url and not os.getenv("RUNNING_IN_DOCKER"):
        sandbox_url = os.getenv("SANDBOX_LOCAL_URL", "http://localhost:7777")
    return sandbox_url.rstrip("/")


@tool
def execute_code(code: str, timeout: Optional[float] = 30.0) -> str:
    """Execute Python code in an isolated sandbox environment with pre-installed smart home libraries.

    Use this tool (Code Mode) when you need to:
    - Inspect or filter multiple devices at once (e.g. find all lights currently on or battery levels < 20%).
    - Perform conditional or sequential device operations (e.g. turn off all downstairs lights).
    - Perform data processing, summaries, or calculations on device states.
    - Run timed animations, color cycling, or loops (pass appropriate timeout, up to 180s).
    - Combine multiple data sources (Hubitat + Weather + Search) in a single step.

    Pre-imported modules and helpers available in the sandbox:
    - from home import hubitat, weather, search
      * hubitat.list_devices() -> list[dict]
      * hubitat.device_details(id) -> dict
      * hubitat.device_capabilities(id) -> list
      * hubitat.device_commands(id) -> list
      * hubitat.control_device(id, command, value=None) -> dict
      * hubitat.set_color(id, hue, saturation=100, level=None) -> dict
      * hubitat.device_history(id) -> list[dict]
      * weather.get_weather(location=None) -> dict
      * search.search(query, max_results=5) -> list[dict]
      * search.fetch_content(url) -> str
    - Pre-installed packages: httpx, requests, aiohttp, pydantic, pandas, jmespath, python-dateutil, pytz.

    Args:
        code: The complete Python script to execute. Be sure to use print() to output results.
        timeout: Execution timeout in seconds (default: 30s, max: 180s for light animations, loops, or multi-step delays).
    """
    actual_timeout = min(max(1.0, float(timeout or 30.0)), 180.0)
    url = f"{get_sandbox_url()}/execute"
    payload = {
        "code": code,
        "timeout": actual_timeout,
    }

    try:
        with httpx.Client(timeout=actual_timeout + 15.0) as client:
            res = client.post(url, json=payload)
            res.raise_for_status()
            data = res.json()

        success = data.get("success", False)
        stdout = data.get("stdout", "").strip()
        stderr = data.get("stderr", "").strip()
        duration_ms = data.get("duration_ms", 0)

        if success:
            if stdout:
                return f"Execution succeeded ({duration_ms}ms):\n{stdout}"
            return f"Execution succeeded ({duration_ms}ms) with no stdout output."
        else:
            return f"Execution failed ({duration_ms}ms):\n{stderr}\n\nStdout:\n{stdout}".strip()

    except httpx.ConnectError:
        return (
            f"Error: Could not connect to the Code Sandbox Sidecar at {url}. "
            "Ensure the 'code-sandbox' container is running on the Docker network."
        )
    except Exception as e:
        return f"Error executing code in sandbox: {str(e)}"
