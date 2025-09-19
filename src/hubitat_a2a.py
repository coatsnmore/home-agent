from strands import Agent, tool
from strands.models.openai import OpenAIModel
from strands_tools import calculator
from strands_tools import file_read
from strands_tools import file_write
from strands_tools.mcp_client import MCPClient
from mcp import stdio_client, StdioServerParameters
from mcp.client.sse import sse_client
from strands.models.ollama import OllamaModel
from strands.multiagent.a2a import A2AServer
# from strands_tools.browser import LocalChromiumBrowser

import os
import speech_recognition as sr
import threading
from dotenv import load_dotenv

load_dotenv()

# For Windows - Spotify MCP Server:# Connect to an MCP server using SSE transport
hubitat_mcp_client = MCPClient(lambda: sse_client("http://localhost:8000/sse"))

# # Create an agent with MCP tools
# with hubitat_mcp_client:
#     # Get the tools from the MCP server
#     tools = hubitat_mcp_client.list_tools_sync()

ollama_model = OllamaModel(
    host="http://localhost:11434",  # Ollama server address
    model_id="gpt-oss:20b"               # Specify which model to use
)

# Create an OpenRouter model instance
# openrouter_model = OpenAIModel(
#     client_args={
#         "api_key": os.getenv("OPENROUTER_KEY"),
#         "base_url": "https://openrouter.ai/api/v1",
#     },
#     # model_id="openai/gpt-oss-20b:free",  # no tool use
#     model_id="z-ai/glm-4.5-air:free",  # tool use!!!
#     # model_id="qwen/qwen3-coder:free", # tool use!!!
#     # model_id="moonshotai/kimi-vl-a3b-thinking:free", # no tool use
#     # client_args={
#     #     "api_key": os.getenv("OPENAI_API_KEY")
#     # },
#     # model_id="gpt-4o-mini",
#     params={
#         "max_tokens": 1000,
#         "temperature": 0.7,
#     }
# )

with hubitat_mcp_client:
        # Get the tools from the MCP server
    tools = hubitat_mcp_client.list_tools_sync()
    agent = Agent(
        name="Hubitat Agent",
        description="An Agent that can control and monitor a Hubitat smart home system. It can turn devices on and off, adjust settings, and provide status updates.",
        model=ollama_model,
        tools=tools
    )

    # Create A2A server (streaming enabled by default)
    a2a_server = A2AServer(agent=agent)

    # Start the server
    a2a_server.serve()