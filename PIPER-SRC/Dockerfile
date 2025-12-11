FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python packages
RUN pip install --no-cache-dir flask piper-tts

# Copy application files
COPY . /app

# Expose port
EXPOSE 8000

# Run the server
CMD ["python3", "piper_server.py"]
