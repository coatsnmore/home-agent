# Agent Architecture Documentation

This document describes the AI agent constructs in the home automation system.

## Overview

The system consists of multiple AI agents that work together to provide smart home automation capabilities. Agents communicate using two primary protocols:
- **A2A (Agent-to-Agent)**: For inter-agent communication and coordination
- **MCP (Model Context Protocol)**: For exposing tools and capabilities to agents

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface Layer                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Interactive Agent (hubitat.py)                      │  │
│  │  - Voice I/O (Speech Recognition + TTS)              │  │
│  │  - Direct MCP tool access                            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent Coordination Layer                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Home Agent (home_a2a.py)                           │  │
│  │  - Port: 9001                                        │  │
│  │  - Coordinates other agents via A2A                 │  │
│  │  - No direct tools, delegates to specialized agents │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (A2A Protocol)
┌─────────────────────────────────────────────────────────────┐
│                    Specialized Agent Layer                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Hubitat Agent (hubitat_a2a.py)                     │  │
│  │  - Port: 9002                                        │  │
│  │  - Exposes Hubitat tools via A2A                    │  │
│  │  - Connects to Hubitat MCP Server                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (MCP Protocol)
┌─────────────────────────────────────────────────────────────┐
│                    Tool Provider Layer                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Hubitat MCP Server (hubitat_mcp.py)                │  │
│  │  - Port: 8888                                        │  │
│  │  - Exposes Hubitat API tools                         │  │
│  │  - FastMCP implementation                            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (HTTP API)
                    ┌───────────────┐
                    │  Hubitat Hub  │
                    │  (Smart Home) │
                    └───────────────┘
```

## Agents

### 1. Interactive Agent (`src/hubitat.py`)

**Type**: Standalone interactive agent with voice capabilities

**Purpose**: Provides a direct user interface for interacting with the smart home system through text or voice input.

**Key Features**:
- **Voice Input**: Uses Google Speech Recognition API for speech-to-text
- **Voice Output**: Uses local Piper TTS server for text-to-speech
- **Direct Tool Access**: Connects directly to Hubitat MCP server for tool access
- **Interactive Loop**: Command-line interface with voice mode support

**Capabilities**:
- List and query Hubitat devices
- Control smart home devices
- Voice-based interaction
- Text-based interaction

**Entry Point**: `python src/hubitat.py` or `uv run src/hubitat.py`

**Configuration**:
- `PIPER_URL`: Piper TTS server URL (default: `http://localhost:10200`)
- Uses `llm_provider` for LLM backend (default: Ollama)

**Usage**:
```bash
# Start the interactive agent
uv run src/hubitat.py

# Commands:
# - Type prompts normally
# - Type 'voice' to use microphone input
# - Type 'quit', 'exit', or 'bye' to exit
```

---

### 2. Home Agent (`src/agents/home_a2a.py`)

**Type**: Coordinator agent (A2A server)

**Purpose**: Acts as a central coordinator that connects to and delegates tasks to specialized agents around the home.

**Key Features**:
- **Agent Discovery**: Discovers and connects to other agents via A2A protocol
- **Task Delegation**: Delegates tasks to specialized agents based on capabilities
- **No Direct Tools**: Does not have direct tools; uses tools from other agents
- **Streaming Support**: A2A server with streaming enabled by default

**Network Configuration**:
- **Host**: `127.0.0.1`
- **Port**: `9001`
- **Protocol**: A2A (Agent-to-Agent)

**Known Agent Connections**:
- Hubitat Agent: `http://127.0.0.1:9002`

**System Prompt**:
- Instructs the agent to discover and use tools from other agents
- Emphasizes delegation over direct action
- Focuses on coordination and task routing

**Entry Point**: `uv run home-agent` or `python -m src.agents.home_a2a`

**Dependencies**:
- Requires other agents (like Hubitat Agent) to be running
- Uses `A2AClientToolProvider` to connect to other agents

---

### 3. Hubitat Agent (`src/agents/hubitat_a2a.py`)

**Type**: Specialized agent (A2A server)

**Purpose**: Provides smart home device control and monitoring capabilities through the Hubitat platform.

**Key Features**:
- **Device Control**: Turn devices on/off, adjust settings
- **Device Monitoring**: Query device status, temperature, humidity, motion
- **Device Information**: Access device details, capabilities, commands, and history
- **A2A Server**: Exposes Hubitat tools to other agents via A2A protocol

**Network Configuration**:
- **Host**: `127.0.0.1`
- **Port**: `9002`
- **Protocol**: A2A (Agent-to-Agent)

**Tool Source**: Connects to Hubitat MCP Server at `http://localhost:8888/mcp`

**System Prompt**:
- Focuses on Hubitat smart home system control
- Emphasizes device information and capabilities
- Mentions multisensors with temperature, humidity, and motion data

**Entry Point**: `uv run hubitat-agent` or `python -m src.agents.hubitat_a2a`

**Dependencies**:
- Requires Hubitat MCP Server to be running
- Requires Hubitat Hub to be accessible via API

---

## MCP Server

### Hubitat MCP Server (`src/mcp/hubitat_mcp.py`)

**Type**: Model Context Protocol (MCP) server

**Purpose**: Exposes Hubitat smart home API functionality as tools that agents can use.

**Implementation**: FastMCP framework

**Network Configuration**:
- **Transport**: Streamable HTTP
- **Port**: `8888`
- **Endpoint**: `http://localhost:8888/mcp`

**Available Tools**:

1. **`list_devices()`**
   - Lists all devices from Hubitat Maker API
   - Returns device information including name, ID, and type
   - Description: "List the Hubitat Devices"

2. **`device_details(device_id)`**
   - Returns detailed information for a specific device
   - Description: "Check Specific Device Details"

3. **`device_history(device_id)`**
   - Returns event history for a specific device
   - Description: "Check Event History for a Specific Device"

4. **`device_capabilities(device_id)`**
   - Returns capabilities for a specific device
   - Description: "Get Capabilities for a Specific Device"

5. **`device_commands(device_id)`**
   - Returns available commands for a specific device
   - Description: "Check Commands for a Specific Device"

6. **`control_device(device_id, command)`**
   - Sends a command to a Hubitat device
   - Examples:
     - Turn on: `/devices/1/on`
     - Set level: `/devices/1/setLevel/50`
     - Set lock code: `/devices/1321/setCode/3,4321,Guest`
   - Description: "Command the Hubitat Devices"

**Configuration**:
- `HUB_HOST`: Hubitat Hub base URL (from environment)
- `HUB_ACCESS_TOKEN`: Hubitat Maker API access token (from environment)

**Entry Point**: `uv run hubitat-mcp` or `python -m src.mcp.hubitat_mcp`

---

## Supporting Infrastructure

### LLM Provider (`src/agents/llm_provider.py`)

**Purpose**: Centralized abstraction for LLM backends

**Supported Providers**:
1. **Ollama** (default)
   - Environment variables: `OLLAMA_HOST`, `OLLAMA_MODEL_ID`
   - Default host: `http://localhost:11434`
   - Temperature: `0.3`

2. **OpenRouter**
   - Environment variables: `OPENROUTER_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL_ID`
   - Base URL: `https://openrouter.ai/api/v1`

3. **OpenAI**
   - Environment variables: `OPENAI_API_KEY`, `OPENAI_MODEL_ID`

**Usage**:
```python
from agents.llm_provider import get_model

# Use default provider (Ollama)
model = get_model()

# Specify provider
model = get_model(provider="ollama")
model = get_model(provider="openrouter")
model = get_model(provider="openai")
```

---

### Infrastructure Services (Docker Compose)

#### Piper TTS Server
- **Image**: `lscr.io/linuxserver/piper:latest`
- **Port**: `10200`
- **Purpose**: Local text-to-speech synthesis
- **Voice**: `en_US-lessac-medium` (configurable)
- **Volume**: `./piper/config` (voice models and configuration)

#### Open WebUI
- **Image**: `ghcr.io/open-webui/open-webui:main`
- **Port**: `3000` (mapped to container port `8080`)
- **Purpose**: Web interface for Ollama
- **Network**: `ollama-network`

#### Ollama (Optional, commented out)
- **Image**: `ollama/ollama`
- **Port**: `11435` (mapped to container port `11434`)
- **Purpose**: Local LLM inference
- **Note**: Currently commented out in docker-compose.yml (likely running locally)

---

## Communication Protocols

### A2A (Agent-to-Agent)

**Purpose**: Enables agents to communicate and share tools with each other

**Implementation**: `strands.multiagent.a2a.A2AServer` and `strands_tools.a2a_client.A2AClientToolProvider`

**Features**:
- Streaming support enabled by default
- Tool discovery and sharing
- Remote agent invocation

**Usage Pattern**:
```python
# Server side
a2a_server = A2AServer(agent=agent, host="127.0.0.1", port=9002)
a2a_server.serve()

# Client side
provider = A2AClientToolProvider(known_agent_urls=["http://127.0.0.1:9002"])
tools = provider.tools
```

### MCP (Model Context Protocol)

**Purpose**: Standardized protocol for exposing tools to AI agents

**Implementation**: FastMCP framework with streamable HTTP transport

**Features**:
- Tool registration and discovery
- Standardized tool interface
- HTTP-based communication

**Usage Pattern**:
```python
# Server side
mcp = FastMCP("Server Name")
@mcp.tool(description="Tool description")
def tool_function():
    pass
mcp.run(transport="streamable-http", port=8888)

# Client side
mcp_client = MCPClient(lambda: streamablehttp_client("http://localhost:8888/mcp"))
with mcp_client:
    tools = mcp_client.list_tools_sync()
```

---

## Running the System

### Prerequisites

1. **Docker** - For infrastructure services
2. **Python 3.12+** - For agents
3. **UV package manager** - For dependency management
4. **PortAudio** (Mac) - `brew install portaudio` for voice I/O
5. **Ollama** - Running locally (not in Docker)

### Setup Steps

1. **Start Infrastructure**:
   ```bash
   docker compose up -d
   ```

2. **Install Dependencies**:
   ```bash
   uv venv
   source .venv/bin/activate
   uv sync --all-packages
   ```

3. **Configure Environment**:
   Create a `.env` file with:
   ```
   HUB_HOST=<your-hubitat-hub-url>
   HUB_ACCESS_TOKEN=<your-hubitat-token>
   PIPER_URL=http://localhost:10200
   LLM_PROVIDER=ollama
   OLLAMA_HOST=http://localhost:11434
   ```

### Running Agents

**Option 1: Interactive Agent (Direct)**
```bash
# Terminal 1: Start MCP Server
uv run hubitat-mcp

# Terminal 2: Start Interactive Agent
uv run src/hubitat.py
```

**Option 2: Multi-Agent System (A2A)**
```bash
# Terminal 1: Start MCP Server
uv run hubitat-mcp

# Terminal 2: Start Hubitat Agent
uv run hubitat-agent

# Terminal 3: Start Home Agent (coordinator)
uv run home-agent

# Terminal 4: Connect to Home Agent (via A2A client or interactive interface)
```

---

## Agent Capabilities Summary

| Agent | Direct Tools | A2A Server | Voice I/O | Purpose |
|-------|-------------|------------|-----------|---------|
| Interactive Agent | ✅ (MCP) | ❌ | ✅ | Direct user interaction |
| Home Agent | ❌ | ✅ (Port 9001) | ❌ | Agent coordination |
| Hubitat Agent | ✅ (via MCP) | ✅ (Port 9002) | ❌ | Smart home control |

---

## Tool Availability

### Hubitat Tools (via MCP)
- `list_devices` - List all Hubitat devices
- `device_details` - Get device information
- `device_history` - Get device event history
- `device_capabilities` - Get device capabilities
- `device_commands` - Get available device commands
- `control_device` - Send commands to devices

### Standard Tools (via strands_tools)
- `calculator` - Mathematical calculations
- `file_read` - Read files from filesystem
- `file_write` - Write files to filesystem

---

## Development Notes

### Adding New Agents

1. Create agent file in `src/agents/`
2. Use `llm_provider.get_model()` for LLM backend
3. For A2A agents, use `A2AServer` on a unique port
4. For MCP tools, create MCP server in `src/mcp/`
5. Update `pyproject.toml` with new script entry if needed

### Adding New Tools

1. For MCP tools: Add `@mcp.tool()` decorated functions in MCP server
2. For direct tools: Use `@tool` decorator from `strands`
3. Tools are automatically discovered by agents

### Testing

- Test individual agents in isolation
- Test agent-to-agent communication via A2A
- Test tool availability and functionality
- Verify voice I/O with Interactive Agent

---

## Version Information

- **Project Version**: 0.1.0
- **Strands Agents**: 1.9.0
- **Strands Tools**: 0.2.8
- **MCP**: >=1.12.3
- **FastMCP**: >=1.0
- **Python**: >=3.12

---

## Future Enhancements

Potential areas for expansion:
- Additional specialized agents (e.g., weather, calendar, media)
- Enhanced voice capabilities (wake word detection)
- Agent persistence and memory
- Multi-user support
- Security and authentication
- Agent monitoring and observability

