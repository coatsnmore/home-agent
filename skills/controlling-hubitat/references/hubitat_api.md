# Hubitat Maker API & MCP Reference Guide

This document provides a technical reference for the Hubitat Maker API endpoints and the corresponding Hubitat MCP server tools.

---

## 1. Hubitat MCP Tool Specifications

The Hubitat MCP server (`hubitat`) communicates with Hubitat Elevation via the Maker API built-in application.

### `list_devices()`
- **MCP Description:** List the Hubitat Devices
- **Parameters:** None
- **Returns:** JSON array of device objects.
- **Example Object:**
  ```json
  [
    {
      "id": "12",
      "name": "Generic Z-Wave Plus Dimmer",
      "label": "Living Room Ceiling Light",
      "type": "Generic Z-Wave Plus Dimmer"
    },
    {
      "id": "25",
      "name": "Zooz 4-in-1 Sensor",
      "label": "Hallway Motion & Temp Sensor",
      "type": "Zooz 4-in-1 Sensor"
    }
  ]
  ```

---

### `device_details(device_id)`
- **MCP Description:** Check Specific Device Details
- **Parameters:**
  - `device_id` *(string or integer, required)*: The Hubitat device ID.
- **Returns:** JSON object containing device metadata, capabilities list, and current attribute values.
- **Key Attributes to Look For:**
  - `temperature`: Current temperature value (number in °F or °C).
  - `illuminance`: Current ambient light level in lux (number).
  - `switch`: Current power state (`"on"` or `"off"`).
  - `level`: Current dimmer brightness level (`0` to `100`).
  - `colorTemperature`: Color temperature in Kelvin (e.g. `2700`, `4000`, `5000`).
  - `hue`: Color hue value (`0` to `100`).
  - `saturation`: Color saturation value (`0` to `100`).
  - `lock`: Lock status (`"locked"` or `"unlocked"`).
  - `battery`: Battery percentage (`0` to `100`).
  - `motion`: Motion status (`"active"` or `"inactive"`).
  - `contact`: Contact sensor status (`"open"` or `"closed"`).

---

### `device_capabilities(device_id)`
- **MCP Description:** Get Capabilities for a Specific Device
- **Parameters:**
  - `device_id` *(string or integer, required)*: The Hubitat device ID.
- **Returns:** JSON array of capability names or capability objects.
- **Standard Capabilities:**
  - `Switch`: Basic power control (`on`, `off`).
  - `SwitchLevel`: Dimming capability (`setLevel`).
  - `ColorTemperature`: Tunable white light (`setColorTemp`).
  - `ColorControl`: Full RGB color manipulation (`setColor`, `setHue`, `setSaturation`).
  - `TemperatureMeasurement`: Temperature reporting.
  - `IlluminanceMeasurement`: Ambient light measurement.
  - `Lock`: Electronic door lock control.
  - `Thermostat`: Climate control setpoints and modes.

---

### `device_commands(device_id)`
- **MCP Description:** Check Commands for a Specific Device
- **Parameters:**
  - `device_id` *(string or integer, required)*: The Hubitat device ID.
- **Returns:** JSON array of supported commands and expected parameters for this specific device driver.

---

### `device_history(device_id)`
- **MCP Description:** Check Event History for a Specific Device
- **Parameters:**
  - `device_id` *(string or integer, required)*: The Hubitat device ID.
- **Returns:** JSON array of past state change events (timestamp, attribute name, value, unit).

---

### `control_device(device_id, command)`
- **MCP Description:** Command the Hubitat Devices
- **Parameters:**
  - `device_id` *(string or integer, required)*: The Hubitat device ID.
  - `command` *(string, required)*: The command path string passed directly into `/devices/{device_id}/{command}`.
- **Returns:**
  ```json
  {
    "status": "ok"
  }
  ```

---

## 2. Command Formatting Syntax

Hubitat Maker API constructs command URLs in the format:
```text
{HOST}/devices/{device_id}/{command}?access_token={ACCESS_TOKEN}
```
In the `control_device(device_id, command)` MCP tool, provide the command segment as the second argument:

| Intent | `command` Argument | Notes |
|---|---|---|
| **Turn Off** | `"off"` | Standard switch off |
| **Turn On** | `"on"` | Standard switch on |
| **Toggle** | `"toggle"` | Toggles switch state |
| **Set Level (Dim)** | `"setLevel/50"` | Level 0–100 |
| **Set Level with Transition** | `"setLevel/50/2"` | Level 50%, 2-second transition |
| **Set Color Temp** | `"setColorTemp/2700"` | Kelvin (2000–6500) |
| **Set Color (Blue)** | `"setHue/240"` then `"setSaturation/100"` | Blue (240° hue, 100% sat) |
| **Set Color (Red)** | `"setHue/0"` then `"setSaturation/100"` | Red (0° hue, 100% sat) |
| **Set Color (Green)** | `"setHue/120"` then `"setSaturation/100"` | Green (120° hue, 100% sat) |
| **Set Hue** | `"setHue/240"` | 0–360° hue scale |
| **Set Saturation** | `"setSaturation/100"` | Saturation 0–100 |
| **Lock Door** | `"lock"` | Engages deadbolt |
| **Unlock Door** | `"unlock"` | Retracts deadbolt |
| **Set Lock Code** | `"setCode/1,1234,Family"` | Position, PIN, Label |

> [!NOTE]
> **RGB Colors:** Do not use `setColor/r/g/b` or `setColor/0/0/255` as Maker API endpoint paths do not support raw RGB triplets. Always use sequential calls to `setHue/<value>` and `setSaturation/100`.

