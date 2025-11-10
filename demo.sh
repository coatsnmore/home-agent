#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    uv venv
fi

# Activate the virtual environment
source .venv/bin/activate

# Sync all packages
echo "Syncing dependencies..."
uv sync --all-packages

# Run hubitat-mcp in the background
echo "Starting hubitat-mcp..."
uv run hubitat-mcp &
MCP_PID=$!

# Wait a moment for MCP to start
sleep 2

# Run hubitat.py
echo "Starting hubitat agent..."
uv run python src/hubitat.py

# Cleanup: kill MCP process when hubitat.py exits
kill $MCP_PID 2>/dev/null

