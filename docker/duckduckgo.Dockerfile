# Fast Python container for DuckDuckGo MCP Server
FROM python:3.12-slim

RUN pip install --no-cache-dir duckduckgo-mcp-server

EXPOSE 7070

CMD ["duckduckgo-mcp-server", "--transport", "streamable-http", "--host", "0.0.0.0", "--port", "7070", "--disable-dns-rebinding-protection"]
