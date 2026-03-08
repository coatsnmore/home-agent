from strands import Agent
from strands_tools.mcp_client import MCPClient
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client
from mcp import StdioServerParameters
from strands.multiagent.a2a import A2AServer
from .llm_provider import get_model
from fastapi.middleware.cors import CORSMiddleware


from dotenv import load_dotenv
import os

load_dotenv()

# Use Docker service name when running in Docker, localhost otherwise
mcp_host = os.getenv("MCP_SERVER_HOST", "hubitat-mcp")

hubitat_token = os.getenv("HUB_ACCESS_TOKEN", "")
hubitat_host = os.getenv("HUB_HOST", "")
    
# Hubitat MCP (Docker)
mcp_url = f"http://{mcp_host}:8888/mcp"
hubitat_mcp_client = MCPClient(lambda: streamablehttp_client(mcp_url)) 

# Sequential Thinking MCP (npx)
seq_think_params = StdioServerParameters(
    command="npx",
    args=[
        "-y",
        "@modelcontextprotocol/server-sequential-thinking"
    ]
)
seq_think_client = MCPClient(lambda: stdio_client(seq_think_params))

# Memory MCP (npx)
memory_params = StdioServerParameters(
    command="npx",
    args=[
        "-y",
        "@modelcontextprotocol/server-memory"
    ]
)
memory_client = MCPClient(lambda: stdio_client(memory_params))

model = get_model(provider="ollama")

def main():
    """Main entry point for the hubitat agent."""
    # Enter MCP client contexts
    hubitat_mcp_client.__enter__()
    seq_think_client.__enter__()
    memory_client.__enter__()
    
    try:
        # Get the tools from the MCP servers
        tools = hubitat_mcp_client.list_tools_sync()
        tools.extend(seq_think_client.list_tools_sync())
        tools.extend(memory_client.list_tools_sync())

        agent = Agent(
            name="Hubitat Agent",
            description="""
            An Agent that can control and monitor a Hubitat smart home system, perform complex multi-step reasoning, and remember user preferences.
            It can turn devices on and off, adjust settings, and provide information.
            Has information from various sensors and devices, including names, IDs, and capabilities.
            Multisensors have temperature, humidity, and motion information.
            """,
            system_prompt="""
            You are a highly capable Hubitat Agent that can control and monitor a Hubitat smart home system.
            You have three main sets of tools available to you:
            1. Hubitat Control: Tools to list devices, get details, and send commands (turn on, off, set level, etc.).
            2. Sequential Thinking: Tools for complex problem solving or multi-step planning. Use this when you are asked to troubleshoot an issue or plan a complex automation.
            3. Memory: Tools to store and retrieve long-term facts, user preferences, and observations. Use this to remember things the user tells you (e.g., "I like the lights at 50% in the evening").
            
            Always list the tools you have access to when starting. Use the Sequential Thinking tool if the request requires planning, and refer to Memory if the user asks about preferences or past context.
            """,
            model=model,
            tools=tools
        )


        # Create A2A server (streaming enabled by default)
        # Bind to 0.0.0.0 to allow access from outside the container (Docker)
        a2a_host = os.getenv("A2A_HOST", "0.0.0.0")
        host_url=os.getenv("HOST_URL", "http://localhost")
        # Ensure the agent card publishes the proxied URL for the frontend
        a2a_http_url = os.getenv("A2A_HTTP_URL", host_url + "/agent")
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
        # Clean up MCP clients when server stops
        hubitat_mcp_client.__exit__(None, None, None)
        seq_think_client.__exit__(None, None, None)
        memory_client.__exit__(None, None, None)


if __name__ == "__main__":
    main()