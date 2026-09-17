# Home Agent: Future Ideas & Architectural Roadmap

This document captures the concepts, architectural plans, and feature extrapolations discussed for the evolution of **Home Agent**.

---

## 1. System Telemetry & Conversational Observability (OTEL)

### Overview
Add deep observability into agent reasoning, tool execution latencies, device communication status, and error states over time—with both a visual dashboard and a conversational self-diagnostic interface.

### Key Capabilities
* **OpenTelemetry Instrumentation**:
  * Utilize Strands' built-in OpenTelemetry lifecycle to trace agent execution loops, model calls, and tool runs.
  * Record request duration, exit codes, token consumption, and full error stack traces.
* **Persistent Telemetry Store (SQLite / DuckDB)**:
  * Mount a lightweight persistent database (e.g. `services/agent/data/telemetry.db`) to record time-series tool executions and system health events.
* **Conversational Diagnostics Tool (`get_system_telemetry`)**:
  * Give the agent an inspection tool allowing users to ask conversational questions about recent system performance:
    * *"Why did the office light command fail earlier?"*
    * *"What tool has had the highest failure rate today?"*
    * *"What is the average response time for code execution?"*
* **Dashboard Telemetry HUD**:
  * A collapsible drawer in the React web UI displaying real-time metrics: latency percentiles, error rate indicators, and an execution trace waterfall.

---

## 2. General-Purpose Renaming & Evolution ("Home Agent")

### Overview
Transition the project identity from a hub-specific controller (*"Hubitat Agent"*) to a true universal intelligence platform (*"Home Agent"*). Hubitat becomes one modular capability provider among several.

### Renaming Scope
* **Container & Service**: `hubitat-agent` &rarr; `home-agent` in `docker-compose.yml` and Dockerfiles.
* **Agent Source**: `services/agent/src/hubitat_agent.py` &rarr; `services/agent/src/home_agent.py`.
* **System Prompt Identity**: Decouple the prompt from a Hubitat-only identity to *"Home Agent — your universal smart home controller, environmental monitor, and automation intelligence"*.
* **UI Branding**: Update the header badge from `Skill: Hubitat` to an ecosystem status indicator showing active integrations (`Hubitat Elevation`, `Open-Meteo`, `DuckDuckGo`, `Code Sandbox`).

---

## 3. Persistent Routine & Scene Synthesizer

### Overview
Allow the agent to dynamically generate, test, and save multi-step Python automation scripts into a persistent routine library.

### Key Capabilities
* **Dynamic Routine Creation**:
  * User asks: *"Create a 'Late Night Movie' routine that turns off the office lights, dims living room lights to 15% warm white, and locks the front door."*
  * Agent verifies the devices, writes the script, tests it in the sandbox, and persists it to `/app/routines/late_night_movie.py`.
* **Instant Execution**:
  * Subsequent requests (*"Run Movie Routine"*) execute the pre-saved script directly in `<50ms` without requiring LLM reasoning or device discovery steps.

---

## 4. Environmental & Energy Analytics with Pandas

### Overview
Leverage the pre-baked `pandas`, `python-dateutil`, and `beautifulsoup4` packages in the `code-sandbox` sidecar to perform deep historical analysis on smart home telemetry.

### Key Capabilities
* **Sensor Aggregation**:
  * Aggregate 24–72 hours of Hubitat event logs (`hubitat.device_history(id)`) across temperature, humidity, motion, and power-monitoring outlets.
* **Analytical Queries**:
  * *"Which room fluctuated in temperature the most today?"*
  * *"How much power did the office setup consume over the past 7 days?"*
  * *"Did any exterior doors open between 2 PM and 5 PM?"*
* **Markdown Data Visualizations**: Output structured comparison tables and statistical summaries directly in the chat stream.

---

## 5. Proactive & Scheduled Background Automations (Local Cron)

### Overview
Enable background automations that trigger based on time of day, astronomical events (sunset/sunrise), or sensor state changes without requiring manual user prompts.

### Key Capabilities
* **Scheduled Job Runner**:
  * A lightweight background cron runner in the agent or sandbox.
* **Intelligent Triggers**:
  * *"Every day at sunset, check outside weather; turn the porch light warm white if clear, or blue if it's raining."*
  * *"At 11:00 PM, verify all exterior doors are locked; if any are unlocked, lock them and notify me."*

---

## 6. Multi-Ecosystem Integrations

### Overview
Expand the `from home import ...` SDK abstraction to connect additional local home ecosystems:

| Module | Integration Target | Example Capabilities |
| :--- | :--- | :--- |
| `home.homeassistant` | Home Assistant Core | Zigbee2MQTT, ESPHome, Z-Wave JS devices |
| `home.media` | Local LAN Media Players | Play/pause/volume control for Apple TV, Roku, Sonos, or Spotify |
| `home.calendar` | CalDAV / Local ICS | Schedule-aware greetings and morning briefing routines |

---

## 7. Offline Neural Text-to-Speech (TTS Sidecar)

### Overview
Complement the in-browser Whisper STT with a dedicated, high-performance local neural TTS engine running as a Docker sidecar container.

### Key Capabilities
* **Containerized Voice Engine**: Deploy a lightweight local container using **Piper** or **Kokoro**.
* **High-Fidelity Audio**: Provides natural, expressive, low-latency synthesized speech without reliance on cloud APIs or browser speech synthesis variability.
* **Unified Speech Pipeline**: True 100% offline, private, and local voice interaction loop (Local Whisper STT &rarr; Local Ollama &rarr; Local Piper TTS).
