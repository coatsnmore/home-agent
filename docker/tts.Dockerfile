# Fast Python container for Piper Neural Text-to-Speech Engine
FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    "fastapi>=0.115.0" \
    "uvicorn>=0.30.0" \
    "pydantic>=2.10.0" \
    "requests>=2.32.4" \
    "piper-tts>=1.2.0"

COPY services/tts /app/services/tts

WORKDIR /app
ENV PYTHONPATH="/app"
ENV VOICES_DIR="/app/voices"
ENV TTS_HOST="0.0.0.0"
ENV TTS_PORT="8001"

EXPOSE 8001

CMD ["python", "-m", "services.tts.src.main"]
