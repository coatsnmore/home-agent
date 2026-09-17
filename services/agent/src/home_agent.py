import json
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from strands import Agent
from strands.hooks import AfterToolCallEvent
from strands.models.openai import OpenAIModel
from strands.models.ollama import OllamaModel
from strands.tools.mcp import MCPClient
from strands.vended_plugins.skills import AgentSkills

load_dotenv()

# Find project root and skills directory
CURRENT_FILE = Path(__file__).resolve()
AGENT_DIR = CURRENT_FILE.parent.parent  # services/agent
REPO_ROOT = AGENT_DIR.parent.parent    # repo root
SKILLS_DIR = os.getenv("SKILLS_DIR", str(REPO_ROOT / "skills" / "controlling-hubitat"))


def get_llm_model():
    """Configure model via LiteLLM proxy (default) or direct Ollama fallback."""
    provider = os.getenv("LLM_PROVIDER", "litellm").lower()
    
    if provider == "litellm":
        litellm_url = os.getenv("LITELLM_URL", "http://litellm:4000/v1")
        # In non-docker local environments, fallback to localhost:4000 if needed
        if "litellm" in litellm_url and not os.getenv("RUNNING_IN_DOCKER"):
            litellm_url = os.getenv("LITELLM_LOCAL_URL", "http://localhost:4000/v1")
            
        api_key = os.getenv("LITELLM_API_KEY", "sk-home-agent-litellm-key")
        model_name = os.getenv("LITELLM_MODEL", "default-model")
        
        return OpenAIModel(
            model_id=model_name,
            client_args={
                "base_url": litellm_url,
                "api_key": api_key,
            },
        )
    elif provider == "ollama":
        ollama_host = os.getenv("OLLAMA_ENDPOINT") or os.getenv("OLLAMA_HOST") or "http://host.docker.internal:11434"
        model_name = os.getenv("OLLAMA_MODEL_ID", "gpt-oss:20b")
        return OllamaModel(
            host=ollama_host,
            model_id=model_name,
            temperature=0.3,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")


from .weather_tool import get_outside_weather
from .code_tool import execute_code
from .time_tool import get_current_datetime
from .telemetry_tool import get_system_telemetry
from .telemetry import record_tool_execution


def create_hubitat_mcp_client() -> MCPClient:
    """Create MCP client for Hubitat Elevation Maker API."""
    mcp_host = os.getenv("MCP_SERVER_HOST", "hubitat-mcp")
    mcp_port = os.getenv("MCP_PORT", "8888")
    mcp_url = os.getenv("HUBITAT_MCP_URL", f"http://{mcp_host}:{mcp_port}/mcp")
    return MCPClient(url=mcp_url, continue_on_error=True)


def create_duckduckgo_mcp_client() -> MCPClient:
    """Create MCP client for DuckDuckGo Internet Search."""
    ddg_host = os.getenv("DDG_MCP_HOST", "duckduckgo-mcp")
    ddg_port = os.getenv("DDG_MCP_PORT", "7070")
    ddg_url = os.getenv("DDG_MCP_URL", f"http://{ddg_host}:{ddg_port}/mcp")
    return MCPClient(url=ddg_url, continue_on_error=True)


def get_agent_plugins():
    """Retrieve configured agent plugins like AgentSkills."""
    plugins = []
    if os.path.exists(SKILLS_DIR):
        print(f"Loading Agent Skill from: {SKILLS_DIR}")
        skills_plugin = AgentSkills(skills=[SKILLS_DIR])
        plugins.append(skills_plugin)
    else:
        print(f"Warning: Skills path not found at {SKILLS_DIR}")
    return plugins


def create_home_agent(
    mcp_client: Optional[MCPClient] = None,
    ddg_client: Optional[MCPClient] = None,
) -> Agent:
    """Create the Home Strands Agent with Hubitat MCP, DuckDuckGo MCP, Weather, Code Execution, and Time tools."""
    hubitat = mcp_client or create_hubitat_mcp_client()
    ddg = ddg_client or create_duckduckgo_mcp_client()
    plugins = get_agent_plugins()
    model = get_llm_model()

    system_prompt = """You are Home Agent, a universal smart home controller, environmental monitor, and automation intelligence.
Your mission is to control, inspect, and automate home devices across your ecosystem (including Hubitat Elevation), monitor indoor/outdoor environments, execute programmatic code in sandbox, and answer web intelligence questions.

Workflows & Capabilities:
1. Hubitat Smart Home Control:
   - Access to Hubitat Maker API tools (list_devices, device_details, device_capabilities, device_commands, device_history, control_device).
   - Follow the 'controlling-hubitat' skill. Always execute the 4-step pre-flight rule:
     * Step 1 (Discover): Call list_devices to find device labels and exact integer IDs. Never guess an ID.
     * Step 2 (Inspect Details): Call device_details(id) to check current state, level, temperature, or attributes.
     * Step 3 (Verify Capabilities): Call device_capabilities(id) and device_commands(id) before issuing commands.
     * Step 4 (Control): Call control_device(id, command) using the exact command syntax (e.g. 'on', 'off', 'setLevel/50', 'setHue/<val>').
   - Keep responses concise, helpful, and confirm exact actions taken with device names and current states.

2. Programmatic Tool Calling (Code Mode):
   - Access to the 'execute_code' tool, which runs Python code in an isolated sidecar sandbox.
   - PREFER Code Mode when:
     * Handling batch or multi-device queries (e.g. "What lights are on downstairs?", "Find all sensors with low battery").
     * Executing multi-step sequences or conditional automations (e.g. "If temperature is above 75, turn on ceiling fans").
     * Filtering or aggregating data to avoid dumping massive device lists into context.
   - Built-in Sandbox Libraries:
     * `from home import hubitat, weather, search`
     * Methods:
       - `hubitat.list_devices()` -> list of all device dicts
       - `hubitat.get_lights(room_or_query=None)` -> list of controllable light devices ONLY (filters out sensors, plugs, outlets)
       - `hubitat.device_details(id)` -> detailed device state
       - `hubitat.device_capabilities(id)` -> list of capability names (supports case-insensitive check like `'switch' in hubitat.device_capabilities(id)`)
       - `hubitat.device_commands(id)` -> list of command names (supports case-insensitive check like `'on' in hubitat.device_commands(id)`)
       - `hubitat.control_device(id, command, secondary_value=None)`
       - `hubitat.set_color(id, color, saturation=100, level=None)`
         * Supports named colors: 'blue', 'green', 'red', 'orange', 'yellow', 'purple', 'pink', 'cyan', 'warm white', 'daylight'
         * Or numeric hue in 0–360° degrees: Red=0, Orange=30, Yellow=60, Green=120, Cyan=180, Blue=240, Purple=280
       - `hubitat.device_history(id)` -> event list
       - `hubitat.device_events(id, days=1.0)` -> filtered event list within N days
       - `hubitat.get_metric_dataframe(ids, attribute='temperature', days=1.0)` -> Pandas DataFrame of historical events
       - `hubitat.temperature_summary(ids=None, days=1.0)` -> DataFrame with min, max, delta, mean, std per room
       - `hubitat.energy_consumption(ids=None, days=7.0)` -> DataFrame with total kWh, avg watts, peak watts
       - `weather.get_weather(location=None)` -> weather dict
       - `search.search(query, max_results=5)` -> list of search results
       - `search.fetch_content(url)` -> extracted text string
     * Available Python libraries: `httpx`, `requests`, `aiohttp`, `pydantic`, `pandas`, `tabulate`, `jmespath`, `python-dateutil`, `pytz`, `beautifulsoup4`.
     * Timed Automations & Loops: The sandbox supports execution timeouts up to 180 seconds. If running a loop with delays (e.g. rainbow effects for 1 minute), pass the timeout parameter: `execute_code(code, timeout=75)`.
     * Always print() the final summary or desired result (e.g. `print(df.to_markdown())`) at the end of the script so it is captured in stdout.

3. Outdoor Weather:
   - Access to the 'get_outside_weather' tool.
   - When asked about the weather, temperature outside, rain, or forecast, call get_outside_weather().
   - If no specific location is mentioned, omit the location argument to automatically infer the home client's location.

4. Internet Search & Information:
   - Access to DuckDuckGo search tools (search, fetch_content).
   - When asked questions about general facts, news, guides, or external topics, use the search tool to retrieve fresh internet results.
   - Temporal Anchoring for News: When searching for "latest news", headlines, or current events, ALWAYS include the current real-world year/month (e.g. "latest news September 2026") so search engines return current articles rather than outdated historical archives.

5. Current Real-World Date and Time:
   - Access to the 'get_current_datetime' tool.
   - You are continuously provided with the user's real-world current date, day of week, time, and timezone in your context.
   - NEVER assume an outdated training cutoff year (like 2024). When asked "what day is today?", "what is the date?", or "what time is it?", state the current real-world date and time accurately.

6. System Telemetry & Execution Diagnostics:
   - Access to the 'get_system_telemetry' tool.
   - When asked about system health, recent command failures, tool latencies, or error logs (e.g. "Why did the light command fail?", "What is our average latency?", "What tool fails most often?"), call get_system_telemetry(query_type, time_window_hours, tool_name).

Presentation & Voice Formatting Guidelines:
- The UI features a rich Markdown renderer with styled tables, bold text, and lists.
- Strict No-Monologue Rule:
  * NEVER emit internal thoughts, parameter syntax analysis, self-debugging commentary (e.g. "The long loop timed out...", "The command expects...", "Let's check docs...", "Let's try new code..."), or planning notes into the conversational response.
  * If a tool call fails, times out, or returns an error, DO NOT explain or discuss the error. Silently adjust your code or approach and execute the corrected tool immediately.
  * Execute tools and code silently without any conversational preambles or commentary.
  * Deliver ONLY the clean, final user-facing response once all tool operations and automations have concluded.
- Per-Task Voice Presentation:
  * For Weather: Provide the complete spoken weather report first (including current temperature, condition, feels-like, today's high and low, humidity, and wind speed) so the user hears the full weather forecast, followed by the Markdown metrics table.
  * For Internet Search & Research: Provide a clear, well-formed spoken executive summary of 2 to 3 complete sentences capturing the key findings and conclusions. Never cut off mid-thought or mid-sentence. Place exhaustive details, bullet points, citations, or data tables after the summary.
  * For Device Control: Keep spoken confirmations short and precise (e.g. "I've turned off the living room lights and set the thermostat to 72 degrees.").
- Tables: ALWAYS use standard Markdown tables with header rows for device listings or metric comparisons.
"""

    agent = Agent(
        name="Home Agent",
        description="Universal smart home control, outdoor weather, internet search, programmatic code execution, and real-time clock agent.",
        system_prompt=system_prompt,
        model=model,
        tools=[hubitat, ddg, get_outside_weather, execute_code, get_current_datetime, get_system_telemetry],
        plugins=plugins,
    )

    def on_after_tool_call(event: AfterToolCallEvent):
        """Universal telemetry hook capturing all tool executions (MCP, code, weather, time)."""
        try:
            tool_name = "unknown"
            if event.selected_tool and hasattr(event.selected_tool, "name"):
                tool_name = event.selected_tool.name
            elif hasattr(event, "tool_use") and isinstance(event.tool_use, dict):
                tool_name = event.tool_use.get("name", "unknown")

            duration_ms = (event.duration * 1000.0) if event.duration is not None else 0.0
            success = event.exception is None
            error_msg = str(event.exception) if event.exception else None
            args_input = event.tool_use.get("input", "") if hasattr(event, "tool_use") and isinstance(event.tool_use, dict) else ""
            args_summary = json.dumps(args_input)[:300] if isinstance(args_input, (dict, list)) else str(args_input)[:300]

            record_tool_execution(
                tool_name=tool_name,
                duration_ms=duration_ms,
                success=success,
                error_message=error_msg,
                args_summary=args_summary,
            )
        except Exception as e:
            print(f"[Telemetry Hook] Warning: {e}")

    agent.add_hook(on_after_tool_call)
    return agent


# Backwards compatibility alias
create_hubitat_agent = create_home_agent
