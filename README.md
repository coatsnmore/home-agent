# Home Automation Agent System

A sophisticated multi-agent system for home automation, featuring a smarter "brain" for Hubitat control and long-term memory.

## Architecture Overview

This system utilizes the **Model Context Protocol (MCP)** and **Agent-to-Agent (A2A)** communication to provide a robust, extensible automation platform.

### Smarter Hubitat Brain
The Hubitat Agent has been enhanced with deep reasoning and persistence capabilities by integrating three distinct MCP servers:
*   **Hubitat Control**: Direct device management via the [hubitat-mcp](https://github.com/coatsnmore/hubitat-mcp) repository.
*   **Sequential Thinking**: Advanced multi-step reasoning for complex automation logic.
*   **Memory / Knowledge Graph**: Persistence for user preferences and home state observations.

## Prerequisites

*   **Docker & Docker Compose**
*   **Ollama**: For running local LLMs (e.g., `llama3.1`, `mistral`).
*   **Python 3.12+** (with `uv` package manager).

## Getting Started

### 1. Infrastructure Setup
Spin up the core services (Nginx proxy, Frontend, Hubitat MCP):
```bash
docker compose up -d
```

### 2. Local Environment Setup
Install dependencies using the `uv` package manager:
```bash
uv sync --all-packages
```

### 3. Configuration
Create a `.env` file in the root directory:
```ini
HUB_HOST=http://<YOUR_HUB_IP>/apps/api/<APP_ID>/
HUB_ACCESS_TOKEN=<YOUR_ACCESS_TOKEN>
HOST_URL=https://<YOUR_DOCKER_HOST_IP>
OLLAMA_ENDPOINT=http://localhost:11434
```

## Usage

### Web Interface
Access the home dashboard via the secure Nginx proxy:
*   **Frontend**: `https://<YOUR_IP>`
*   **Agent Interaction**: Controlled via the relative `/agent` path.

### Example Prompts
*   "Turn off the office lights and remember that I prefer them at 20% in the evening."
*   "Think about the most energy-efficient way to manage my thermostat during a heatwave."
*   "List all sensors in the kitchen and tell me the current temperature."

## Components
*   **[hubitat-mcp](https://github.com/coatsnmore/hubitat-mcp)**: The official MCP server implementation for Hubitat.
*   **A2A Server**: High-performance agent communication layer.
*   **Nginx Proxy Layer**: Secure SSL termination and path-based routing.