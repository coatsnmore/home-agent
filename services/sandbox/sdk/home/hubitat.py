"""Hubitat smart home client for programmatic tool execution.

Provides both synchronous and asynchronous helper functions for discovering,
inspecting, and controlling Hubitat Elevation devices via Maker API or MCP.
"""

import os
from typing import Any, Dict, List, Optional, Union
import httpx


class CaseInsensitiveList(list):
    """List of strings that supports case-insensitive, whitespace-agnostic containment checks."""

    def __contains__(self, item: Any) -> bool:
        if isinstance(item, str):
            target = item.strip().lower().replace(" ", "").replace("_", "")
            for x in self:
                if isinstance(x, str):
                    cand = x.strip().lower().replace(" ", "").replace("_", "")
                    if cand == target or target in cand or cand in target:
                        return True
        return super().__contains__(item)

STANDARD_COLORS: Dict[str, Union[int, Dict[str, int]]] = {
    "red": 0,
    "orange": 30,
    "amber": 45,
    "yellow": 60,
    "lime": 90,
    "chartreuse": 90,
    "green": 120,
    "spring green": 150,
    "cyan": 180,
    "sky blue": 210,
    "blue": 240,
    "indigo": 260,
    "purple": 280,
    "violet": 280,
    "magenta": 300,
    "pink": 330,
    # Color temperature presets (Kelvin)
    "warm white": {"colorTemperature": 2700},
    "soft white": {"colorTemperature": 3000},
    "white": {"colorTemperature": 4000},
    "daylight": {"colorTemperature": 5000},
    "cool white": {"colorTemperature": 6000},
}


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

    def _extract_capabilities(self, raw: Any) -> CaseInsensitiveList:
        """Recursively extract capability names from nested Maker API or MCP payloads."""
        caps: List[str] = []
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict) and "capabilities" in item:
                    caps.extend(self._extract_capabilities(item["capabilities"]))
                elif isinstance(item, str):
                    caps.append(item)
        elif isinstance(raw, dict):
            if "capabilities" in raw:
                caps.extend(self._extract_capabilities(raw["capabilities"]))
        return CaseInsensitiveList(caps)

    def _extract_commands(self, raw: Any) -> CaseInsensitiveList:
        """Recursively extract command names from nested Maker API or MCP payloads."""
        cmds: List[str] = []
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, dict) and "command" in item:
                    cmds.append(item["command"])
                elif isinstance(item, str):
                    cmds.append(item)
        elif isinstance(raw, dict):
            if "commands" in raw:
                cmds.extend(self._extract_commands(raw["commands"]))
        return CaseInsensitiveList(cmds)

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

    def get_lights(self, query: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return only controllable light devices, filtering out sensors, outlets, or non-light devices.

        Args:
            query: Optional string filter to match device label, name, or room (e.g. 'office').
        """
        all_devices = self.list_devices()
        lights: List[Dict[str, Any]] = []
        q = (query or "").strip().lower()

        for d in all_devices:
            label = (d.get("label") or d.get("name") or "").lower()
            room = (d.get("room") or "").lower()
            dev_type = (d.get("type") or "").lower()

            # Filter out non-light devices
            if any(non_light in dev_type or non_light in label for non_light in ["sensor", "outlet", "plug", "lock", "thermostat"]):
                continue

            # Query match
            if q and (q not in label and q not in room):
                continue

            caps = self.device_capabilities(d["id"])
            if "ColorControl" in caps or "Light" in caps or "SwitchLevel" in caps or "Switch" in caps:
                lights.append(d)

        return lights

    def device_details(self, device_id: Union[int, str]) -> Dict[str, Any]:
        """Get complete details, attributes, and current states for a device."""
        if self.hub_host:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(self._maker_url(f"devices/{device_id}"))
                res.raise_for_status()
                return res.json()
        return self._call_mcp_sync("device_details", {"device_id": str(device_id)})

    def device_capabilities(self, device_id: Union[int, str]) -> CaseInsensitiveList:
        """Get clean list of capabilities supported by a device (supports case-insensitive checks)."""
        if self.hub_host:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(self._maker_url(f"devices/{device_id}/capabilities"))
                res.raise_for_status()
                return self._extract_capabilities(res.json())
        res = self._call_mcp_sync("device_capabilities", {"device_id": str(device_id)})
        return self._extract_capabilities(res)

    def device_commands(self, device_id: Union[int, str]) -> CaseInsensitiveList:
        """Get clean list of available commands for a device (supports case-insensitive checks)."""
        if self.hub_host:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.get(self._maker_url(f"devices/{device_id}/commands"))
                res.raise_for_status()
                return self._extract_commands(res.json())
        res = self._call_mcp_sync("device_commands", {"device_id": str(device_id)})
        return self._extract_commands(res)

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
        """Send a control command to a device (e.g. 'on', 'off', 'setLevel', 50, 'setHue', 240, 'setSaturation', 100)."""
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
        color: Union[str, int, float],
        saturation: Union[int, float] = 100,
        level: Optional[Union[int, float]] = None,
    ) -> Dict[str, Any]:
        """Convenience method to set device color.
        
        Args:
            device_id: Hubitat device ID.
            color: Color name string (e.g. 'blue', 'green', 'red', 'orange', 'purple', 'pink', 'warm white', 'daylight')
                   OR numeric hue value in 0–360° degrees (0=red, 30=orange, 60=yellow, 120=green, 180=cyan, 240=blue, 280=purple).
            saturation: Color saturation 0–100 (default 100).
            level: Optional brightness level 0–100.
        """
        # 1. Handle named colors and color temperature presets
        if isinstance(color, str):
            clean_name = color.strip().lower()
            if clean_name in STANDARD_COLORS:
                preset = STANDARD_COLORS[clean_name]
                if isinstance(preset, dict) and "colorTemperature" in preset:
                    if level is not None:
                        self.control_device(device_id, "setLevel", int(round(float(level))))
                    return self.control_device(device_id, "setColorTemperature", preset["colorTemperature"])
                hue_val = float(preset)
            else:
                try:
                    hue_val = float(color)
                except ValueError:
                    raise ValueError(f"Unknown color name '{color}'. Supported presets: {', '.join(STANDARD_COLORS.keys())}")
        else:
            hue_val = float(color)

        # 2. Hubitat Elevation uses 0–360° for setHue on RGBW lights
        hue_deg = int(round(hue_val % 360))
        sat_val = int(round(min(max(0.0, float(saturation)), 100.0)))

        # Reliable control sequence: setHue, setSaturation, and setLevel
        self.control_device(device_id, "setHue", hue_deg)
        res = self.control_device(device_id, "setSaturation", sat_val)
        if level is not None:
            self.control_device(device_id, "setLevel", int(round(float(level))))
        return res

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
