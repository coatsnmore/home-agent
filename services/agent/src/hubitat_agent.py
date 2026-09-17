"""Backwards-compatibility shim re-exporting from home_agent."""

from .home_agent import (
    CURRENT_FILE,
    AGENT_DIR,
    REPO_ROOT,
    SKILLS_DIR,
    get_llm_model,
    create_hubitat_mcp_client,
    create_duckduckgo_mcp_client,
    get_agent_plugins,
    create_home_agent,
    create_hubitat_agent,
)

