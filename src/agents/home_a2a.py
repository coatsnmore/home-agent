import os

from strands import Agent
from strands.multiagent.a2a import A2AServer
from strands_tools.a2a_client import A2AClientToolProvider

from dotenv import load_dotenv
load_dotenv()

from .llm_provider import get_model

model = get_model(provider="ollama")

hubitat_provider = A2AClientToolProvider(known_agent_urls=["http://127.0.0.1:9002"])

agent = Agent(
    name="Home Agent",
    description="""
    A Home Agent that connects to other agents around the home. 
    One such agent is the Hubitat Home Assistant which can control devices, sense temperature and other metrics around the house.
    """,
    system_prompt="""
    You are a Home Agent that connects to other agents around the home. 
    One such agent is the Hubitat Home Assistant which can control devices, sense temperature and other metrics around the house.
    List the agents you have access to and its capabilities.
    """,
    model=model,
    tools=hubitat_provider.tools
)

# Create A2A server (streaming enabled by default)
a2a_server = A2AServer(
    agent=agent,
    host="127.0.0.1",
    port=9001,
)

def main():
    """Main entry point for the home agent."""
    # Start the server
    a2a_server.serve()

if __name__ == "__main__":
    main()