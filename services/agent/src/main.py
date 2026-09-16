"""Main FastAPI entry point exposing Hubitat Agent via the AG-UI streaming protocol."""

import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ag_ui_strands import StrandsAgent, create_strands_app, add_strands_fastapi_endpoint

from .hubitat_agent import (
    create_hubitat_agent,
    create_hubitat_mcp_client,
    create_duckduckgo_mcp_client,
    get_agent_plugins,
)

load_dotenv()

# Global instances
mcp_client = None
ddg_client = None
hubitat_agent = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage lifecycle of MCP client connections."""
    global mcp_client, ddg_client
    print("Initializing Hubitat Agent service...")
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
    print("Shutting down Hubitat Agent service...")
    for client in (mcp_client, ddg_client):
        if client:
            try:
                client.__exit__(None, None, None)
            except Exception:
                pass


def build_app() -> FastAPI:
    """Build the AG-UI FastAPI application."""
    global mcp_client, ddg_client, hubitat_agent
    
    mcp_client = create_hubitat_mcp_client()
    ddg_client = create_duckduckgo_mcp_client()
    hubitat_agent = create_hubitat_agent(mcp_client=mcp_client, ddg_client=ddg_client)
    plugins = get_agent_plugins()
    
    # Wrap agent with AG-UI protocol adapter
    agui_agent = StrandsAgent(
        agent=hubitat_agent,
        name="Hubitat Agent",
        description="Smart home control and monitoring agent for Hubitat Elevation devices.",
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
            "service": "hubitat-agent",
            "protocol": "ag-ui",
            "version": "0.2.0",
        }
        
    return app


def main():
    """Run the Uvicorn web server."""
    host = os.getenv("AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("AGENT_PORT", "9002"))
    app = build_app()
    
    print(f"Starting Hubitat AG-UI Agent on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
