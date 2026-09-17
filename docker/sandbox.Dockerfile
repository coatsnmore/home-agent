# Fast Python container with uv for Code Execution Sandbox Sidecar
FROM astral/uv:python3.12-bookworm-slim

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV UV_TOOL_BIN_DIR=/usr/local/bin
ENV RUNNING_IN_DOCKER=1

# Copy sandbox files
COPY services/sandbox ./services/sandbox

WORKDIR /app/services/sandbox
RUN uv venv /app/.venv && uv pip install --python /app/.venv -e .

# Bake SDK and source into PYTHONPATH and prevent dynamic package downloads
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/services/sandbox/sdk:/app/services/sandbox/src"
ENV PIP_NO_INDEX=1
ENV SANDBOX_HOST=0.0.0.0
ENV SANDBOX_PORT=7777

EXPOSE 7777

CMD ["python", "-m", "services.sandbox.src.main"]
