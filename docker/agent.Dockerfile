# Fast Python container with uv for Home Agent
FROM astral/uv:python3.12-bookworm-slim

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV UV_TOOL_BIN_DIR=/usr/local/bin
ENV RUNNING_IN_DOCKER=1

# Copy dependency specifications first for optimal Docker layer caching
COPY pyproject.toml uv.lock ./
COPY services/agent/pyproject.toml ./services/agent/

# Install dependencies
RUN uv sync --frozen --no-dev --no-install-project || uv sync --no-dev --no-install-project

# Copy project source code and skills
COPY services/agent ./services/agent
COPY skills ./skills

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 9002

CMD ["uv", "run", "python", "-m", "services.agent.src.main"]
