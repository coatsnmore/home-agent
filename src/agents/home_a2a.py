import os

from strands import Agent
from strands.multiagent.a2a import A2AServer
from strands_tools.a2a_client import A2AClientToolProvider
from fastapi.middleware.cors import CORSMiddleware

from dotenv import load_dotenv
load_dotenv()

from .llm_provider import get_model

model = get_model(provider="ollama")

# Use Docker service name when running in Docker, localhost otherwise
hubitat_agent_url = os.getenv("HUBITAT_AGENT_URL", "http://127.0.0.1:9002")
hubitat_provider = A2AClientToolProvider(known_agent_urls=[hubitat_agent_url])

agent = Agent(
    name="Home Agent",
    description="""
    A Home Agent that connects to other agents around the home. 
    One such agent is the Hubitat Home Assistant which can control devices, sense temperature and other metrics around the house.
    """,
    system_prompt="""
    You are a Smart Home Agent that connects to other agents around the home.
    You only use the tools of other agents to perform tasks and do not yourself have any tools.
    One such agent is the Hubitat Agent which can control devices, sense temperature and other metrics around the house.
    Discover and List the agents you have access to and its skills. Only use those skills to perform tasks.
    Ask the agents you discover what they can do and use their skills to perform tasks.
    """,
    model=model,
    tools=hubitat_provider.tools
)

# Create A2A server (streaming enabled by default)
# Bind to 0.0.0.0 to allow access from outside the container (Docker)
# a2a_host = os.getenv("A2A_HOST", "0.0.0.0")
# # Use localhost for the public URL (0.0.0.0 is not a valid URL for browsers)
# a2a_http_url = os.getenv("A2A_HTTP_URL", "http://localhost:9001")
# a2a_server = A2AServer(
#     agent=agent,
#     host=a2a_host,
#     port=9001,
#     http_url=a2a_http_url,
# )

a2a_host = os.getenv("A2A_HOST", "0.0.0.0")
host_url=os.getenv("HOST_URL", "http://localhost:9001")
a2a_http_url = os.getenv("A2A_HTTP_URL", host_url + ":9001")
a2a_server = A2AServer(
    agent=agent,
    host=a2a_host,
    port=9001,
    http_url=a2a_http_url,
)

def main():
    """Main entry point for the home agent."""
    # Enable CORS for all origins
    app = a2a_server.to_fastapi_app()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins
        allow_credentials=False,  # Must be False when using allow_origins=["*"]
        allow_methods=["*"],  # Allow all methods
        allow_headers=["*"],  # Allow all headers
    )

    # Start the server with the modified app
    import uvicorn
    uvicorn.run(app, host=a2a_host, port=9001)

if __name__ == "__main__":
    main()