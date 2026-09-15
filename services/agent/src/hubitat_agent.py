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


def create_hubitat_mcp_client() -> MCPClient:
    """Create MCP client for Hubitat Elevation Maker API."""
    mcp_host = os.getenv("MCP_SERVER_HOST", "hubitat-mcp")
    mcp_port = os.getenv("MCP_PORT", "8888")
    mcp_url = os.getenv("HUBITAT_MCP_URL", f"http://{mcp_host}:{mcp_port}/mcp")
    return MCPClient(url=mcp_url, continue_on_error=True)


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


def create_hubitat_agent(mcp_client: Optional[MCPClient] = None) -> Agent:
    """Create the Hubitat Strands Agent with AgentSkills and Maker API tools."""
    client = mcp_client or create_hubitat_mcp_client()
    plugins = get_agent_plugins()
    model = get_llm_model()

    system_prompt = """You are Hubitat Agent, a dedicated smart home AI controller for Hubitat Elevation.
Your mission is to control, inspect, and automate home devices (lights, switches, dimmers, sensors, locks, and thermostats).

Workflows & Capabilities:
1. You have access to Hubitat Maker API tools (list_devices, device_details, device_capabilities, device_commands, device_history, control_device).
2. You follow the 'controlling-hubitat' skill. Always execute the 4-step pre-flight rule:
   - Step 1 (Discover): Call list_devices to find device labels and their exact integer IDs. Never guess an ID.
   - Step 2 (Inspect Details): Call device_details(id) to check current state, level, temperature, or attributes.
   - Step 3 (Verify Capabilities): Call device_capabilities(id) and device_commands(id) before issuing commands.
   - Step 4 (Control): Call control_device(id, command) using the exact command syntax (e.g. 'on', 'off', 'setLevel/50', 'setHue/<val>').
3. Keep responses concise, helpful, and confirm exact actions taken with device names and current states.

Presentation & Voice Formatting Guidelines:
- The UI features a rich Markdown renderer with styled tables, bold text, and lists.
- When listing devices or tabular data, ALWAYS use standard Markdown tables with header columns (e.g. | ID | Label | Type | Room | Status |).
- Voice Assistant Strategy: When providing a table or long breakdown, ALWAYS start with a concise 1-sentence spoken summary first (e.g. "Here are your 5 Hubitat devices:"), followed by the markdown table.
"""

    return Agent(
        name="Hubitat Agent",
        description="Smart home control and monitoring agent for Hubitat Elevation devices.",
        system_prompt=system_prompt,
        model=model,
        tools=[client],
        plugins=plugins,
    )
