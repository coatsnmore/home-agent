from strands import Agent
from strands_tools.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from strands.multiagent.a2a import A2AServer
from .llm_provider import get_model

from dotenv import load_dotenv

load_dotenv()

hubitat_mcp_client = MCPClient(lambda: streamablehttp_client("http://localhost:8888/mcp"))
model = get_model(provider="ollama")

def main():
    """Main entry point for the hubitat agent."""
    with hubitat_mcp_client:
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
        a2a_server = A2AServer(
            agent=agent,
            host="127.0.0.1",
            port=9002,
        )

        # Start the server
        a2a_server.serve()

if __name__ == "__main__":
    main()