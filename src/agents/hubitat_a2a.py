from strands import Agent
from strands_tools.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from strands.multiagent.a2a import A2AServer
from .llm_provider import get_model
from fastapi.middleware.cors import CORSMiddleware

from dotenv import load_dotenv
import os

load_dotenv()

# Use Docker service name when running in Docker, localhost otherwise
mcp_host = os.getenv("MCP_SERVER_HOST", "localhost")
mcp_url = f"http://{mcp_host}:8888/mcp"
hubitat_mcp_client = MCPClient(lambda: streamablehttp_client(mcp_url))
model = get_model(provider="ollama")

def main():
    """Main entry point for the hubitat agent."""
    # Enter MCP client context - must stay open while server runs
    hubitat_mcp_client.__enter__()
    
    try:
        # Get the tools from the MCP server
        tools = hubitat_mcp_client.list_tools_sync()
        agent = Agent(
            name="Hubitat Agent",
            description="""
            An Agent that can control and monitor a Hubitat smart home system. 
            It can turn devices on and off, adjust settings, and provide information.
            Has information from various sensors and devices, including names, IDs, and capabilities.
            Multisensors have temperature, humidity, and motion information.
            """,
            system_prompt="""
            You are a Hubitat Agent that can control and monitor a Hubitat smart home system. 
            List the tools you have access to.
            """,
            model=model,
            tools=tools
        )

        # Create A2A server (streaming enabled by default)
        # Bind to 0.0.0.0 to allow access from outside the container (Docker)
        a2a_host = os.getenv("A2A_HOST", "0.0.0.0")
        host_url=os.getenv("HOST_URL", "http://localhost:9002")
        # Use localhost for the public URL (0.0.0.0 is not a valid URL for browsers)
        a2a_http_url = os.getenv("A2A_HTTP_URL", host_url + ":9002")
        a2a_server = A2AServer(
            agent=agent,
            host=a2a_host,
            port=9002,
            http_url=a2a_http_url,
        )

        # Enable CORS for all origins
        app = a2a_server.to_fastapi_app()
        
        # Add CORS middleware - must be added first (before other middleware)
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # Allow all origins
            allow_credentials=False,  # Must be False when using allow_origins=["*"]
            allow_methods=["*"],  # Allow all methods
            allow_headers=["*"],  # Allow all headers
        )

        # Start the server with the modified app
        # The server will run until interrupted, keeping the MCP client context open
        import uvicorn
        uvicorn.run(app, host=a2a_host, port=9002, log_level="info")
    finally:
        # Clean up MCP client when server stops
        hubitat_mcp_client.__exit__(None, None, None)

if __name__ == "__main__":
    main()