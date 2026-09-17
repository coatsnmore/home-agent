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

    def device_events(self, device_id: Union[int, str], days: float = 1.0) -> List[Dict[str, Any]]:
        """Get event history for a device filtered within the specified number of days."""
        raw_events = self.device_history(device_id)
        if not raw_events or not isinstance(raw_events, list):
            return []
        
        import datetime
        from dateutil import parser as dt_parser
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
        filtered = []
        for ev in raw_events:
            if not isinstance(ev, dict):
                continue
            date_str = ev.get("date") or ev.get("timestamp")
            if date_str:
                try:
                    dt = dt_parser.parse(str(date_str))
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=datetime.timezone.utc)
                    if dt >= cutoff:
                        filtered.append(ev)
                except Exception:
                    filtered.append(ev)
            else:
                filtered.append(ev)
        return filtered

    def get_metric_dataframe(
        self,
        device_ids: Union[int, str, List[Union[int, str]]],
        attribute: str = "temperature",
        days: float = 1.0,
    ):
        """Build a clean pandas DataFrame from historical events for one or more devices.
        
        Returns a DataFrame with columns: ['timestamp', 'device_id', 'device_name', 'attribute', 'value', 'unit']
        """
        import pandas as pd
        from dateutil import parser as dt_parser
        
        if not isinstance(device_ids, list):
            device_ids = [device_ids]
            
        all_rows = []
        for did in device_ids:
            events = self.device_events(did, days=days)
            # Fetch device name
            d_name = f"Device {did}"
            try:
                details = self.device_details(did)
                d_name = details.get("label") or details.get("name") or d_name
            except Exception:
                pass
                
            attr_clean = attribute.strip().lower()
            for ev in events:
                ev_name = str(ev.get("name", "")).strip().lower()
                if ev_name == attr_clean:
                    val = ev.get("value")
                    try:
                        val_num = float(val)
                    except (ValueError, TypeError):
                        val_num = val
                        
                    date_val = ev.get("date") or ev.get("timestamp")
                    try:
                        dt = dt_parser.parse(str(date_val))
                    except Exception:
                        dt = pd.NaT
                        
                    all_rows.append({
                        "timestamp": dt,
                        "device_id": str(did),
                        "device_name": d_name,
                        "attribute": ev.get("name"),
                        "value": val_num,
                        "unit": ev.get("unit", ""),
                    })
                    
        if not all_rows:
            return pd.DataFrame(columns=["timestamp", "device_id", "device_name", "attribute", "value", "unit"])
            
        df = pd.DataFrame(all_rows)
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.sort_values(by="timestamp").reset_index(drop=True)
        return df

    def temperature_summary(
        self,
        device_ids: Optional[List[Union[int, str]]] = None,
        days: float = 1.0,
    ):
        """Calculate statistical temperature metrics (min, max, delta, mean, std) across rooms."""
        import pandas as pd
        
        if not device_ids:
            all_devs = self.list_devices()
            target_ids = []
            for d in all_devs:
                did = d.get("id")
                try:
                    caps = self.device_capabilities(did)
                    if "temperature" in caps or "temperaturemeasurement" in caps:
                        target_ids.append(did)
                except Exception:
                    pass
            device_ids = target_ids
            
        if not device_ids:
            return pd.DataFrame(columns=["device_name", "current", "min", "max", "delta", "mean", "std"])
            
        df = self.get_metric_dataframe(device_ids, attribute="temperature", days=days)
        if df.empty:
            return pd.DataFrame(columns=["device_name", "current", "min", "max", "delta", "mean", "std"])
            
        summaries = []
        for name, group in df.groupby("device_name"):
            numeric_vals = pd.to_numeric(group["value"], errors="coerce").dropna()
            if numeric_vals.empty:
                continue
            cur = numeric_vals.iloc[-1]
            mn = numeric_vals.min()
            mx = numeric_vals.max()
            delta = mx - mn
            mean_val = numeric_vals.mean()
            std_val = numeric_vals.std() if len(numeric_vals) > 1 else 0.0
            
            summaries.append({
                "device_name": name,
                "current": round(cur, 1),
                "min": round(mn, 1),
                "max": round(mx, 1),
                "delta": round(delta, 1),
                "mean": round(mean_val, 1),
                "std": round(std_val, 2),
            })
            
        return pd.DataFrame(summaries).sort_values(by="delta", ascending=False).reset_index(drop=True)

    def energy_consumption(
        self,
        device_ids: Optional[List[Union[int, str]]] = None,
        days: float = 7.0,
    ):
        """Integrate power wattage readings into kilowatt-hours (kWh) consumed."""
        import pandas as pd
        
        if not device_ids:
            all_devs = self.list_devices()
            target_ids = []
            for d in all_devs:
                did = d.get("id")
                try:
                    caps = self.device_capabilities(did)
                    if "power" in caps or "powermeter" in caps:
                        target_ids.append(did)
                except Exception:
                    pass
            device_ids = target_ids
            
        if not device_ids:
            return pd.DataFrame(columns=["device_name", "total_kwh", "avg_watts", "peak_watts"])
            
        df = self.get_metric_dataframe(device_ids, attribute="power", days=days)
        if df.empty:
            return pd.DataFrame(columns=["device_name", "total_kwh", "avg_watts", "peak_watts"])
            
        results = []
        for name, group in df.groupby("device_name"):
            group = group.sort_values(by="timestamp").dropna(subset=["value"])
            vals = pd.to_numeric(group["value"], errors="coerce").dropna()
            if vals.empty:
                continue
                
            total_kwh = 0.0
            if len(group) >= 2:
                dt_hours = group["timestamp"].diff().dt.total_seconds().iloc[1:] / 3600.0
                avg_p = (vals.iloc[:-1].values + vals.iloc[1:].values) / 2.0
                valid_mask = (dt_hours <= 12.0) & (dt_hours >= 0.0)
                total_kwh = float((avg_p[valid_mask] * dt_hours[valid_mask].values).sum() / 1000.0)
            else:
                total_kwh = float((vals.mean() * (days * 24)) / 1000.0)
                
            results.append({
                "device_name": name,
                "total_kwh": round(total_kwh, 3),
                "avg_watts": round(vals.mean(), 1),
                "peak_watts": round(vals.max(), 1),
            })
            
        return pd.DataFrame(results).sort_values(by="total_kwh", ascending=False).reset_index(drop=True)

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
