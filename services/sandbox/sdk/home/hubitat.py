"""Hubitat smart home client for programmatic tool execution.

Provides both synchronous and asynchronous helper functions for discovering,
inspecting, and controlling Hubitat Elevation devices via Maker API or MCP.
"""

import os
from typing import Any, Dict, List, Optional, Union
import httpx


class HubitatClient:
    """Client for interacting with Hubitat devices."""

    def __init__(
        self,
        hub_host: Optional[str] = None,
        access_token: Optional[str] = None,
        mcp_url: Optional[str] = None,
        timeout: float = 10.0,
    ):
        self.hub_host = (hub_host or os.getenv("HUB_HOST") or "").rstrip("/")
        self.access_token = access_token or os.getenv("HUB_ACCESS_TOKEN") or ""
        mcp_host = os.getenv("MCP_SERVER_HOST", "hubitat-mcp")
        mcp_port = os.getenv("MCP_PORT", "8888")
        self.mcp_url = mcp_url or os.getenv("HUBITAT_MCP_URL", f"http://{mcp_host}:{mcp_port}/mcp")
        self.timeout = timeout

    def _maker_url(self, path: str) -> str:
        """Construct full Maker API URL."""
        clean_path = path.lstrip("/")
        base = self.hub_host
        sep = "&" if "?" in clean_path else "?"
        token_param = f"{sep}access_token={self.access_token}" if self.access_token else ""
        return f"{base}/{clean_path}{token_param}"

    # --- Synchronous Methods ---

    def list_devices(self) -> List[Dict[str, Any]]:
        """List all devices from Hubitat Maker API."""
        if self.hub_host:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(self._maker_url("devices"))
                res.raise_for_status()
                return res.json()
        # Fallback to MCP tool call
        return self._call_mcp_sync("list_devices", {})

    def device_details(self, device_id: Union[int, str]) -> Dict[str, Any]:
        """Get complete details, attributes, and current states for a device."""
        if self.hub_host:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(self._maker_url(f"devices/{device_id}"))
                res.raise_for_status()
                return res.json()
        return self._call_mcp_sync("device_details", {"device_id": str(device_id)})

    def device_capabilities(self, device_id: Union[int, str]) -> List[Any]:
        """Get capabilities supported by a device."""
        if self.hub_host:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(self._maker_url(f"devices/{device_id}/capabilities"))
                res.raise_for_status()
                return res.json()
        return self._call_mcp_sync("device_capabilities", {"device_id": str(device_id)})

    def device_commands(self, device_id: Union[int, str]) -> List[Any]:
        """Get available commands for a device."""
        if self.hub_host:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(self._maker_url(f"devices/{device_id}/commands"))
                res.raise_for_status()
                return res.json()
        return self._call_mcp_sync("device_commands", {"device_id": str(device_id)})

    def _encode_secondary_value(self, val: Any) -> str:
        """Properly encode secondary parameter for Maker API URL path."""
        import json
        import urllib.parse
        if isinstance(val, (dict, list)):
            return urllib.parse.quote(json.dumps(val))
        return urllib.parse.quote(str(val), safe="")

    def control_device(
        self,
        device_id: Union[int, str],
        command: str,
        secondary_value: Optional[Union[str, int, float, dict, list]] = None,
    ) -> Dict[str, Any]:
        """Send a control command to a device (e.g. 'on', 'off', 'setLevel', 50, 'setColor', {'hue': 50, 'saturation': 100})."""
        if self.hub_host:
            path = f"devices/{device_id}/{command}"
            if secondary_value is not None:
                encoded_val = self._encode_secondary_value(secondary_value)
                path += f"/{encoded_val}"
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(self._maker_url(path))
                res.raise_for_status()
                return res.json()
        args = {"device_id": str(device_id), "command": command}
        if secondary_value is not None:
            import json
            args["secondary_value"] = json.dumps(secondary_value) if isinstance(secondary_value, (dict, list)) else str(secondary_value)
        return self._call_mcp_sync("control_device", args)

    def set_color(
        self,
        device_id: Union[int, str],
        hue: int,
        saturation: int = 100,
        level: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Convenience method to set device color via COLOR_MAP or setHue/setSaturation."""
        color_map = {"hue": hue, "saturation": saturation}
        if level is not None:
            color_map["level"] = level
        try:
            return self.control_device(device_id, "setColor", color_map)
        except Exception:
            # Fallback to separate setHue and setSaturation commands
            self.control_device(device_id, "setHue", hue)
            return self.control_device(device_id, "setSaturation", saturation)

    def device_history(self, device_id: Union[int, str]) -> List[Dict[str, Any]]:
        """Get recent event history for a device."""
        if self.hub_host:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(self._maker_url(f"devices/{device_id}/events"))
                res.raise_for_status()
                return res.json()
        return self._call_mcp_sync("device_history", {"device_id": str(device_id)})

    # --- Asynchronous Methods ---

    async def a_list_devices(self) -> List[Dict[str, Any]]:
        """Async: List all devices from Hubitat Maker API."""
        if self.hub_host:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get(self._maker_url("devices"))
                res.raise_for_status()
                return res.json()
        return self.list_devices()

    async def a_device_details(self, device_id: Union[int, str]) -> Dict[str, Any]:
        """Async: Get device details and attributes."""
        if self.hub_host:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get(self._maker_url(f"devices/{device_id}"))
                res.raise_for_status()
                return res.json()
        return self.device_details(device_id)

    async def a_control_device(
        self,
        device_id: Union[int, str],
        command: str,
        secondary_value: Optional[Union[str, int, float]] = None,
    ) -> Dict[str, Any]:
        """Async: Send a control command to a device."""
        if self.hub_host:
            path = f"devices/{device_id}/{command}"
            if secondary_value is not None:
                path += f"/{secondary_value}"
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get(self._maker_url(path))
                res.raise_for_status()
                return res.json()
        return self.control_device(device_id, command, secondary_value)

    # --- Internal MCP Fallback Helper ---

    def _call_mcp_sync(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }
        with httpx.Client(timeout=self.timeout) as client:
            res = client.post(self.mcp_url, json=payload)
            res.raise_for_status()
            data = res.json()
            if "error" in data:
                raise RuntimeError(f"MCP tool error: {data['error']}")
            return data.get("result")


# Default singleton instance
hubitat = HubitatClient()
