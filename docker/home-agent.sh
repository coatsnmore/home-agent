#!/bin/bash

# Start the home-agent
cd /app
uv venv
source .venv/bin/activate
uv sync --all-packages
uv run home-agent