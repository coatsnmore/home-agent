#!/bin/bash

# Start Home Agent service
cd /app
source .venv/bin/activate
uv run home-agent
