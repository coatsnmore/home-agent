"""Main FastAPI entry point exposing Hubitat Agent via the AG-UI streaming protocol."""

import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ag_ui_strands import StrandsAgent, create_strands_app, add_strands_fastapi_endpoint

from .home_agent import (
    create_home_agent,
    create_hubitat_agent,
    create_hubitat_mcp_client,
    create_duckduckgo_mcp_client,
    get_agent_plugins,
)

load_dotenv()

# Global instances
mcp_client = None
ddg_client = None
home_agent = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage lifecycle of MCP client connections."""
    global mcp_client, ddg_client
    print("Initializing Home Agent service...")
    if mcp_client:
        try:
            mcp_client.__enter__()
            print("Connected to Hubitat MCP Server.")
        except Exception as e:
            print(f"Hubitat MCP Connection notice: {e}")
    if ddg_client:
        try:
            ddg_client.__enter__()
            print("Connected to DuckDuckGo MCP Server.")
        except Exception as e:
            print(f"DuckDuckGo MCP Connection notice: {e}")
    yield
    print("Shutting down Home Agent service...")
    for client in (mcp_client, ddg_client):
        if client:
            try:
                client.__exit__(None, None, None)
            except Exception:
                pass


def build_app() -> FastAPI:
    """Build the AG-UI FastAPI application."""
    global mcp_client, ddg_client, home_agent
    
    mcp_client = create_hubitat_mcp_client()
    ddg_client = create_duckduckgo_mcp_client()
    home_agent = create_home_agent(mcp_client=mcp_client, ddg_client=ddg_client)
    plugins = get_agent_plugins()
    
    # Wrap agent with AG-UI protocol adapter
    agui_agent = StrandsAgent(
        agent=home_agent,
        name="Home Agent",
        description="Universal smart home control, environmental monitoring, and automation agent.",
        plugins=plugins,
    )
    
    # Create base AG-UI app with CORS
    app = create_strands_app(
        agui_agent,
        path="/",
        ping_path="/ping",
        origins=["*"],
        cors_enabled=True,
    )
    
    # Also expose on /agent and /invocations for reverse-proxy compatibility
    add_strands_fastapi_endpoint(app, agui_agent, "/agent")
    add_strands_fastapi_endpoint(app, agui_agent, "/invocations")
    
    @app.get("/health")
    async def health_check():
        return {
            "status": "healthy",
            "service": "home-agent",
            "protocol": "ag-ui",
            "version": "0.3.0",
        }

    @app.get("/api/telemetry/stats")
    async def get_telemetry_metrics(hours: float = 24.0):
        from .telemetry import get_telemetry_stats
        return get_telemetry_stats(time_window_hours=hours)

    @app.get("/api/telemetry/recent")
    async def get_recent_telemetry_executions(limit: int = 50):
        from .telemetry import get_recent_executions
        return get_recent_executions(limit=limit)
        
    return app


def main():
    """Run the Uvicorn web server."""
    host = os.getenv("AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("AGENT_PORT", "9002"))
    app = build_app()
    
    print(f"Starting Home Agent AG-UI service on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
