"""Hubitat Smart Home Agent implementation using Strands, LiteLLM, and AgentSkills."""

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from strands import Agent
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


def create_hubitat_agent(
    mcp_client: Optional[MCPClient] = None,
    ddg_client: Optional[MCPClient] = None,
) -> Agent:
    """Create the Hubitat Strands Agent with Hubitat MCP, DuckDuckGo MCP, and Weather tools."""
    hubitat = mcp_client or create_hubitat_mcp_client()
    ddg = ddg_client or create_duckduckgo_mcp_client()
    plugins = get_agent_plugins()
    model = get_llm_model()

    system_prompt = """You are Hubitat Agent, a dedicated smart home AI controller for Hubitat Elevation.
Your mission is to control, inspect, and automate home devices, monitor indoor/outdoor environments, and answer web intelligence questions.

Workflows & Capabilities:
1. Hubitat Smart Home Control:
   - Access to Hubitat Maker API tools (list_devices, device_details, device_capabilities, device_commands, device_history, control_device).
   - Follow the 'controlling-hubitat' skill. Always execute the 4-step pre-flight rule:
     * Step 1 (Discover): Call list_devices to find device labels and exact integer IDs. Never guess an ID.
     * Step 2 (Inspect Details): Call device_details(id) to check current state, level, temperature, or attributes.
     * Step 3 (Verify Capabilities): Call device_capabilities(id) and device_commands(id) before issuing commands.
     * Step 4 (Control): Call control_device(id, command) using the exact command syntax (e.g. 'on', 'off', 'setLevel/50', 'setHue/<val>').
   - Keep responses concise, helpful, and confirm exact actions taken with device names and current states.

2. Outdoor Weather:
   - Access to the 'get_outside_weather' tool.
   - When asked about the weather, temperature outside, rain, or forecast, call get_outside_weather().
   - If no specific location is mentioned, omit the location argument to automatically infer the home client's location.

3. Internet Search & Information:
   - Access to DuckDuckGo search tools (search, fetch_content).
   - When asked questions about general facts, news, guides, or external topics, use the search tool to retrieve fresh internet results.

Presentation & Voice Formatting Guidelines:
- The UI features a rich Markdown renderer with styled tables, bold text, and lists.
- When listing devices or tabular data, ALWAYS use standard Markdown tables with header columns (e.g. | Metric | Value | or | ID | Label | Type | Room | Status |).
- Voice Assistant Strategy: When providing a table or long breakdown, ALWAYS start with a concise 1-sentence spoken summary first (e.g. "The current weather in Columbus is 81°F and mostly sunny:"), followed by the markdown table.
"""

    return Agent(
        name="Hubitat Agent",
        description="Smart home control, outdoor weather, and internet search agent.",
        system_prompt=system_prompt,
        model=model,
        tools=[hubitat, ddg, get_outside_weather],
        plugins=plugins,
    )
