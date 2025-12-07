#!/bin/bash

# Start the hubitat-agent
cd /app
uv venv
source .venv/bin/activate
uv sync --all-packages
uv run hubitat-mcp