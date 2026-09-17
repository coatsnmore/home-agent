"""Internet search and page extraction client for programmatic tool execution."""

import os
from typing import Any, Dict, List, Optional
import httpx


class SearchClient:
    """Client for DuckDuckGo search and article content extraction."""

    def __init__(self, mcp_url: Optional[str] = None, timeout: float = 12.0):
        ddg_host = os.getenv("DDG_MCP_HOST", "duckduckgo-mcp")
        ddg_port = os.getenv("DDG_MCP_PORT", "7070")
        self.mcp_url = mcp_url or os.getenv("DDG_MCP_URL", f"http://{ddg_host}:{ddg_port}/mcp")
        self.timeout = timeout

    def search(self, query: str, max_results: int = 5) -> List[Dict[str, Any]]:
        """Search DuckDuckGo and return top matching results."""
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "search",
                "arguments": {
                    "query": query,
                    "max_results": max_results,
                },
            },
        }
        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(self.mcp_url, json=payload)
                res.raise_for_status()
                data = res.json()
                if "error" in data:
                    raise RuntimeError(f"DDG MCP error: {data['error']}")
                return data.get("result", [])
        except Exception as e:
            return [{"error": str(e), "query": query}]

    def fetch_content(self, url: str) -> str:
        """Fetch and extract readable text from a webpage."""
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "fetch_content",
                "arguments": {
                    "url": url,
                },
            },
        }
        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.post(self.mcp_url, json=payload)
                res.raise_for_status()
                data = res.json()
                if "error" in data:
                    raise RuntimeError(f"DDG fetch error: {data['error']}")
                return str(data.get("result", ""))
        except Exception:
            # Fallback to direct HTTP request with trafilatura if available
            try:
                import trafilatura
                with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
                    html = client.get(url).text
                    extracted = trafilatura.extract(html)
                    return extracted or html[:2000]
            except Exception as ex:
                return f"Failed to fetch content from {url}: {ex}"


search = SearchClient()
