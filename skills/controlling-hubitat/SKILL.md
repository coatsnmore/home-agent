---
name: controlling-hubitat
description: Control and monitor smart home devices via the Hubitat MCP server. Use this skill whenever the user wants to check temperatures, inspect light levels or lux readings, turn lights on or off, dim or brighten lights, adjust light colors or color temperatures, manage switches, smart plugs, or locks, check device status or history, or perform any home automation task supported by Hubitat Elevation. Make sure to use this skill whenever smart home devices, room lighting, house temperatures, or Hubitat are mentioned, even if the user does not explicitly say "Hubitat".
---

# Controlling Hubitat

This skill guides interaction with a local [Hubitat Elevation](https://hubitat.com/) home automation hub via the Hubitat MCP server tools. It covers checking environmental telemetry (temperature, illuminance/lux), inspecting device states, and controlling actuators (lights, switches, dimmers, locks).

Always use the MCP server to interact with Hubitat. Do not try to access Hubitat directly via HTTP requests. Only use the MCP tools that the server provides.

Before doing anything, list all the devices, get their device details, check their current state, and then list the device capabilities. Don't skip this step, and don't try to guess anything. The tools will give you the information you need.
---

## Hubitat MCP Server Tools Overview

The Hubitat MCP server provides 6 primary tools backed by the Hubitat Maker API:

| Tool | Purpose | Key Arguments |
|---|---|---|
| `list_devices()` | Lists all devices authorized in Maker API | *(none)* |
| `device_details(device_id)` | Returns current state, attributes, and values for a device | `device_id` (string/int) |
| `device_capabilities(device_id)` | Returns supported capabilities (e.g. Switch, SwitchLevel) | `device_id` (string/int) |
| `device_commands(device_id)` | Returns allowed commands and parameter formats | `device_id` (string/int) |
| `device_history(device_id)` | Returns recent event history for a device | `device_id` (string/int) |
| `control_device(device_id, command)` | Sends an action command to a device | `device_id`, `command` |

For full endpoint mapping and attribute schemas, consult [references/hubitat_api.md](references/hubitat_api.md).

---

## Pre-flight Workflow: The 4-Step Rule

Before attempting to control any device or assert device states, follow this mandatory 4-step sequence:

```
1. Discover           2. Inspect Details       3. Verify Capability       4. Control
[list_devices]  --->  [device_details]   --->  [device_capabilities] ---> [control_device]
                                               [device_commands]
```

### Why this sequence matters
1. **Never guess device IDs**: Device IDs in Hubitat are integer strings assigned by the hub (e.g. `"42"`, `"105"`), not human-readable labels.
2. **Devices have differing capabilities**: A bulb might only support `on`/`off`, while another supports `setLevel` (dimming) or `setColor` / `setColorTemp` (RGB / tunable white). Attempting an unsupported command fails or produces unintended behavior.
3. **Command argument syntax is specific**: Hubitat Maker API expects commands formatted in specific URL path segments (e.g., `setLevel/50`, `setColorTemp/2700`).

---

## Step-by-Step Execution

### Step 1: Discover Devices (`list_devices`)
When the user asks about a room or device (e.g., "living room light", "hallway thermostat"), call `list_devices()` first.
- Search the returned JSON list matching `label` or `name` against the user's intent.
- Extract the device's `id`.

### Step 2: Inspect State & Sensor Data (`device_details`)
Call `device_details(device_id)` to view current telemetry without changing anything:
- **Temperature**: Look in `attributes` for `name: "temperature"`. Value will typically be in degrees Fahrenheit or Celsius depending on hub settings.
- **Light Level / Lux**: Look in `attributes` for `name: "illuminance"` (value in Lux).
- **Current Switch State**: Look for `name: "switch"` (`"on"` or `"off"`).
- **Brightness Level**: Look for `name: "level"` (integer 0–100).
- **Color Attributes**: Look for `name: "colorTemperature"`, `name: "hue"`, `name: "saturation"`, or `name: "colorMode"`.

### Step 3: Check Capabilities & Commands
Before changing any state:
1. Call `device_capabilities(device_id)`:
   - Confirm `Switch` capability exists if turning on/off.
   - Confirm `SwitchLevel` capability exists if dimming.
   - Confirm `ColorTemperature` or `ColorControl` exists if changing warmth or color.
2. Call `device_commands(device_id)`:
   - Check the exact command names and parameter structures available on that specific driver.

### Step 4: Actuate Device (`control_device`)
Call `control_device(device_id, command)`.

> [!IMPORTANT]
> **Specific Command to Turn Off Lights:**
> To turn off any light or switch, execute:
> ```python
> control_device(device_id="<device_id>", command="off")
> ```
> In Hubitat Maker API, `off` is sent as the command path (`/devices/{device_id}/off`).

#### Standard Control Commands:
- **Turn Off**: `command="off"`
- **Turn On**: `command="on"`
- **Toggle**: `command="toggle"` (if supported by device commands)
- **Dim / Set Brightness**: `command="setLevel/<value>"` (e.g., `command="setLevel/50"` for 50%, or `command="setLevel/100"` for 100%)
- **Color Temperature**: `command="setColorTemp/<kelvin>"` (e.g., `command="setColorTemp/2700"` for warm white)
- **Lock / Unlock**: `command="lock"` or `command="unlock"`

> [!IMPORTANT]
> **Setting Colors (RGB / Colored Lights):**
> **Never** use `setColor` with RGB component paths like `setColor/0/0/255` or `setColor/255/0/0` — Maker API fails and throws errors with raw RGB formats.
> Instead, **always** set color using `setHue` followed by `setSaturation`:
> 1. `control_device(device_id="<id>", command="setHue/<hue_value>")`
> 2. `control_device(device_id="<id>", command="setSaturation/100")`
>
> **Common Hue Values (0–360° scale):**
> - **Blue**: `command="setHue/240"` (with `command="setSaturation/100"`)
> - **Red**: `command="setHue/0"` (or `360`)
> - **Green**: `command="setHue/120"`
> - **Yellow**: `command="setHue/60"`
> - **Cyan / Aqua**: `command="setHue/180"`
> - **Purple / Magenta**: `command="setHue/300"`
> - **Orange**: `command="setHue/30"`

---

## Concrete Interaction Examples

### Example 1: Turning Off Lights
**User Prompt:** "Turn off the overhead lights in the living room."
1. Call `list_devices()`:
   Find item: `{"id": "14", "label": "Living Room Overhead Light", "type": "Generic Z-Wave Plus Dimmer"}`.
2. Call `device_details(device_id="14")`:
   Confirm `switch` is currently `"on"`.
3. Call `device_commands(device_id="14")`:
   Verify `off` command exists.
4. Execute:
   `control_device(device_id="14", command="off")`
5. Verify response is `{"status": "ok"}` and confirm to the user that the living room overhead light is now off.

### Example 2: Checking Temperature & Light Levels
**User Prompt:** "What's the temperature and light level in the sunroom?"
1. Call `list_devices()`:
   Find multi-sensor: `{"id": "88", "label": "Sunroom Multi-Sensor"}`.
2. Call `device_details(device_id="88")`:
   Inspect attributes:
   - `{"name": "temperature", "currentValue": 72.4, "dataType": "NUMBER"}`
   - `{"name": "illuminance", "currentValue": 450, "dataType": "NUMBER"}`
3. Inform the user: "The sunroom temperature is 72.4°F with an illuminance level of 450 lux."

### Example 3: Dimming and Color Adjustment
**User Prompt:** "Set the bedroom lamp to 30% brightness and warm light."
1. Call `list_devices()` -> find bedroom lamp ID (e.g. `"23"`).
2. Call `device_capabilities(device_id="23")` -> confirm `SwitchLevel` and `ColorTemperature`.
3. Call `device_commands(device_id="23")` -> confirm `setLevel` and `setColorTemp`.
4. Call `control_device(device_id="23", command="setLevel/30")`.
5. Call `control_device(device_id="23", command="setColorTemp/2700")`.
6. Confirm actions completed to user.


### Example 4: Listing the Hubitat Devices
**User Prompt:** "List all the devices on the hub."
1. Call `list_devices()`
2. Print the results in a nice table with the following columns:
- ID
- Label
- Name
- Type
- Room
- Capabilities ( comma separated list, call `device_capabilities(device_id)` to get the full list )
 
### Example 5: Setting Light Colors (e.g., Turning Lights Blue)
**User Prompt:** "Make all the lights blue."
1. Call `list_devices()` to find all target lights (e.g. IDs `48`, `49`, `50`).
2. If any light is off, turn it on first: `control_device(device_id="48", command="on")`.
3. Set the color using `setHue` and `setSaturation` (do NOT use `setColor` with RGB):
   - `control_device(device_id="48", command="setHue/240")`
   - `control_device(device_id="48", command="setSaturation/100")`
   - `control_device(device_id="49", command="setHue/240")`
   - `control_device(device_id="49", command="setSaturation/100")`
   - `control_device(device_id="50", command="setHue/240")`
   - `control_device(device_id="50", command="setSaturation/100")`
4. Confirm to the user: "All lights are now set to blue (Hue = 240°, Saturation = 100%)."

---

## Error Handling & Edge Cases

- **Device not found**: If the label does not directly match, list closest device names to the user and ask for clarification. Never trigger an arbitrary device ID.
- **Offline / Non-responsive device**: If `control_device` returns an error status or fails to execute, check `device_history(device_id)` to see when the device last reported events.
- **Maker API Token / Connection issues**: If the tool call fails with network or authorization errors, advise the user to verify their Hubitat hub IP and Maker API token configuration.

---

## Special Commands
**User Prompt:** "Rainbow Lights"
1. Call `list_devices()` to find all target lights (e.g. IDs `48`, `49`, `50`).
2. Set each light to colors in sequence using the MCP tools. Don't wait for a subsequent user prompt, just do it.
3. Example:
```
hubitat_control_device [device_id=48, command=on]
hubitat_control_device [command=on, device_id=49]
hubitat_control_device [command=on, device_id=50]
hubitat_control_device [command=setSaturation/100, device_id=48]
hubitat_control_device [command=setSaturation/100, device_id=49]
hubitat_control_device [command=setSaturation/100, device_id=50]
hubitat_control_device [command=setHue/0, device_id=48]
hubitat_control_device [command=setHue/60, device_id=48]
hubitat_control_device [command=setHue/120, device_id=48]
hubitat_control_device [command=setHue/180, device_id=48]
hubitat_control_device [command=setHue/240, device_id=48]
hubitat_control_device [command=setHue/300, device_id=48]
hubitat_control_device [command=setHue/0, device_id=49]
hubitat_control_device [command=setHue/60, device_id=49]
hubitat_control_device [command=setHue/120, device_id=49]
hubitat_control_device [command=setHue/180, device_id=49]
hubitat_control_device [command=setHue/240, device_id=49]
hubitat_control_device [command=setHue/300, device_id=49]
hubitat_control_device [command=setHue/0, device_id=50]
hubitat_control_device [command=setHue/60, device_id=50]
hubitat_control_device [command=setHue/120, device_id=50]
hubitat_control_device [command=setHue/180, device_id=50]
hubitat_control_device [command=setHue/240, device_id=50]
hubitat_control_device [command=setHue/300, device_id=50]
```
