# Home Agent

An intelligent, privacy-first smart home assistant and environmental automation system powered by **Strands Agents**, **AG-UI Protocol**, **A2UI (Generative UI)**, and **LiteLLM**.

Home Agent combines direct **Hubitat Elevation** control, an isolated **Code Execution Sandbox** with Pandas analytics, local **DuckDuckGo Web Search**, **Open-Meteo Outdoor Weather**, real-time **System Telemetry & Observability**, and fully offline **Neural Text-to-Speech (Piper)** and **Speech-to-Text (Whisper)**.

---

## Architecture & Service Interactions

The platform runs as a coordinated microservice architecture orchestrated via [docker-compose.yml](docker-compose.yml). All web traffic terminates at an Nginx SSL reverse proxy, routing browser interactions through SSE streams, REST endpoints, and streamable MCP protocol bridges.

```mermaid
graph TD
    User((User Browser)) -->|HTTPS / 443| Nginx[Nginx SSL Reverse Proxy]

    %% Web Dashboard Routing
    Nginx -->|/ (HTTP / Vite HMR)| WebUI["Web Dashboard (:5173)<br/>React 19 + Vite + A2UI"]
    Nginx -->|/agent & /api (HTTP & SSE)| HomeAgent["Home Agent (:9002)<br/>Strands v1.55 + AG-UI + FastAPI"]
    Nginx -->|/tts (HTTP REST & WAV)| TTSService["Piper TTS Sidecar (:8001)<br/>FastAPI + ONNX Neural Audio"]
    Nginx -->|/mcp (HTTP JSON-RPC)| HubitatMCP["Hubitat MCP Server (:8888)<br/>FastMCP Streamable Bridge"]

    %% Client-Side Voice Engine
    subgraph ClientAudio ["In-Browser Audio Engine (Offline)"]
        WebUI --> LocalWhisper["Whisper STT (Transformers.js / ONNX)"]
        WebUI --> AudioContext["Web AudioContext (Neural Piper WAV)"]
        WebUI -.->|Automatic Fallback| NativeTTS["Web SpeechSynthesis API"]
    end

    %% Agent Core & Tools
    subgraph AgentCore ["Home Agent Service (:9002)"]
        HomeAgent --> TelemetryHook["AfterToolCallEvent Hook"]
        TelemetryHook --> TelemetryDB[("SQLite Telemetry DB<br/>telemetry.db")]
        HomeAgent --> SkillsPlugin["AgentSkills Plugin<br/>(controlling-hubitat)"]
        HomeAgent --> WeatherTool["Outdoor Weather Tool<br/>(Open-Meteo API)"]
        HomeAgent --> TimeTool["Real-Time Clock Tool<br/>(Timezone Anchored)"]
        HomeAgent --> TelemetryTool["get_system_telemetry Tool"]
        HomeAgent --> CodeTool["execute_code Tool"]
    end

    %% Code Execution Sandbox
    subgraph SandboxEnv ["Code Sandbox Sidecar (:7777)"]
        CodeTool -->|HTTP POST /execute| Sandbox["FastAPI Runner + Process Isolation"]
        Sandbox --> HomeSDK["Home SDK (from home import ...)"]
        HomeSDK --> PandasAnalytics["Pandas 2.0+ & Tabulate<br/>(Energy & Temperature Math)"]
    end

    %% MCP Bridges & External APIs
    HomeAgent -->|MCP Streamable HTTP| HubitatMCP
    HomeAgent -->|MCP Streamable HTTP| DDGMCP["DuckDuckGo MCP (:7070)"]
    Sandbox -->|MCP HTTP JSON-RPC| HubitatMCP
    Sandbox -->|MCP HTTP JSON-RPC| DDGMCP
    Sandbox -->|HTTPS REST| ExtWeather["Open-Meteo Weather API"]
    WeatherTool -->|HTTPS REST| ExtWeather

    %% Hardware Hub
    HubitatMCP -->|HTTP REST Maker API| HubitatHub["Hubitat Elevation Hub"]

    %% Model Gateway
    subgraph ModelRouting ["Decoupled Model Gateway (:4000)"]
        HomeAgent -->|OpenAI Chat Completions REST| LiteLLM["LiteLLM Proxy Container"]
        LiteLLM -->|Ollama REST API| Ollama["Local Ollama (:11434)<br/>(gpt-oss:20b / llama3.1)"]
        LiteLLM -.->|Optional Cloud Fallback| CloudLLM["OpenRouter / OpenAI / Anthropic"]
    end
```

### Protocol & Port Matrix

| Service | Container Name | Port | Internal Protocol | External Route | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Nginx SSL** | `nginx-ssl` | 80, 443 | HTTPS, WSS, TLS 1.3 | `/` | Reverse proxy and SSL termination gateway |
| **Web Dashboard** | `home-page` | 5173 | HTTP / SSE | `/` | React 19 + Vite dashboard with A2UI cards & Telemetry HUD |
| **Home Agent** | `home-agent` | 9002 | AG-UI over SSE & REST | `/agent`, `/api/*` | Strands universal agent core with conversational diagnostics |
| **Piper TTS** | `tts-engine` | 8001 | HTTP REST (`audio/wav`) | `/tts/*` | Offline high-fidelity neural speech synthesis sidecar |
| **Code Sandbox** | `code-sandbox` | 7777 | HTTP POST (`/execute`) | Internal only | Isolated Python 3.12 runner with pre-baked `home` SDK |
| **Hubitat MCP** | `hubitat-mcp` | 8888 | Streamable HTTP / JSON-RPC | `/mcp/*` | Model Context Protocol gateway to Hubitat Elevation Maker API |
| **DuckDuckGo MCP** | `duckduckgo-mcp` | 7070 | Streamable HTTP / JSON-RPC | Internal only | Live privacy-preserving web search & article fetcher |
| **LiteLLM Gateway** | `litellm` | 4000 | OpenAI REST API | Internal only | Model proxy abstracting local Ollama and cloud LLMs |
| **Open-WebUI** | `open-webui` | 3000 | HTTP | `:3000` | Optional standalone chat UI for direct model testing |

---

## Core Features & Capabilities

### 1. Offline Neural Text-to-Speech (Piper TTS Engine)
* **Sidecar Engine**: Containerized FastAPI service powered by `piper-tts` using the natural `en_US-lessac-medium` voice model.
* **WAV Streaming**: Emits 16-bit 22050Hz Microsoft PCM WAV audio via `POST /tts/v1/audio/speech`.
* **Zero-Interruption Automatic Fallback**: The frontend (`useTTS.js`) checks health on load and every 15 seconds. If the neural container is down or times out (>6s), it automatically and seamlessly falls back to native browser `SpeechSynthesis`.
* **Visual Status Pill**: Glowing cyan **`Neural TTS`** pill in the top header indicates neural readiness.

### 2. System Telemetry & Conversational Observability
* **Automated Instrumentation**: Hooked directly into Strands `AfterToolCallEvent` to record 100% of tool calls across MCP servers, code execution, weather, and time.
* **Persistent SQLite Storage**: Saved in `services/agent/data/telemetry.db` with queryable latency percentiles ($p50$, $p95$), error rates, and failure messages.
* **Conversational Diagnostics (`get_system_telemetry`)**: Ask the agent directly:
  * *"Why did the last light command fail?"*
  * *"What is our average code execution latency over the past 24 hours?"*
  * *"What tool has had the highest error rate today?"*
* **Telemetry HUD**: Glassmorphic modal accessible via the Activity (⚡) button in the header, displaying real-time metrics cards, tool breakdowns, and an execution waterfall log.

### 3. Environmental & Energy Analytics with Pandas
* **Pre-Baked Home SDK**: Available inside the isolated Code Execution Sandbox via `from home import hubitat, weather, search`.
* **Historical Metrics DataFrame**: `hubitat.get_metric_dataframe(device_ids, attribute, days=1.0)` produces time-indexed Pandas DataFrames from Hubitat event logs.
* **Room Temperature Summary**: `hubitat.temperature_summary(ids=None, days=1.0)` computes min, max, diurnal delta, mean, and standard deviation across temperature sensors.
* **Energy Consumption Integration**: `hubitat.energy_consumption(ids=None, days=7.0)` performs trapezoidal numerical integration ($\int P dt / 1000$) to calculate total kilowatt-hours ($kWh$), average wattage, and peak load.
* **Tabular Presentation**: Automatic rendering in styled Markdown tables using `tabulate`.

### 4. Smart Home Control (Hubitat Elevation)
* **Pre-Flight Safety Sequence**: Strict 4-step execution rule enforced via the `controlling-hubitat` Agent Skill:
  1. *Discover*: `list_devices` to verify labels and exact integer IDs.
  2. *Inspect*: `device_details` to verify state, battery, and current attributes.
  3. *Verify*: `device_capabilities` and `device_commands` prior to command execution.
  4. *Control*: `control_device` using exact syntax (`on`, `off`, `setLevel/50`, `setHue/180`).
* **Interactive A2UI Cards**: Direct UI cards for real-time toggles, brightness sliders, and sensor telemetry.

### 5. Temporal Intelligence & Internet Research
* **Real-Time Clock (`time_tool.py`)**: Continuously injects current date, day of week, and timezone to eliminate model training cutoff hallucination.
* **Temporal Search Anchoring**: Agent anchors current-events queries to the real-world month and year (e.g., "September 2026") to pull current headlines from DuckDuckGo rather than stale historical archives.
* **Spoken Executive Summaries**: Automatic cleaning and sentence-bounded summaries formatted for audio playback while delivering complete Markdown data tables in the UI.

---

## Prerequisites

* **Docker & Docker Compose** (v24+)
* **Python 3.12+** with [uv](https://github.com/astral-sh/uv)
* **Node.js 20+** (for local web development)
* **Local Ollama** (optional, if running models locally on `http://localhost:11434`)
* **Hubitat Elevation Hub** with Maker API installed

---

## Getting Started

### 1. Configuration
Create a `.env` file from the provided template:
```bash
cp .env.example .env
```

Configure your local environment variables in `.env`:
```ini
# Hubitat Elevation Hub Configuration
HUB_HOST=http://192.168.86.XX/apps/api/XXXX/
HUB_ACCESS_TOKEN=your-maker-api-access-token

# Host and Network Configuration
HOST_URL=https://192.168.86.YY
DOCKER_HOST_IP=192.168.86.YY

# LLM Gateway Configuration
LLM_PROVIDER=litellm
LITELLM_URL=http://litellm:4000/v1
LITELLM_MODEL=default-model
LITELLM_API_KEY=sk-home-agent-litellm-key
OLLAMA_ENDPOINT=http://host.docker.internal:11434

# Web Client Wake Word
VITE_WAKE_WORD=Skeletron
```

### 2. Launching the Multi-Container Stack
Start all services using Docker Compose:
```bash
docker compose up -d --build
```

### 3. Accessing the Dashboard
Open your browser and navigate to:
```text
https://<YOUR_DOCKER_HOST_IP>
```
*(Accept the self-signed SSL development certificate generated by Nginx).*

---

## Example Interactions

### Smart Home & Energy Analytics
* *"What lights are currently turned on downstairs?"*
* *"Show me a temperature summary for all rooms over the past 24 hours."*
* *"Calculate the energy consumption in kWh for my office outlet over the past week."*
* *"Turn off the living room lights and set the hallway dimmer to 30%."*

### System Diagnostics & Telemetry
* *"Show me system telemetry for the past 24 hours."*
* *"What is our average latency and error rate across all tools?"*
* *"Did any Hubitat commands fail recently?"*

### Weather & Current Information
* *"What's the weather forecast outside today?"*
* *"What are the top news headlines for today?"*
* *"What is today's date and what time is it?"*

---

## Repository Structure

```text
home-agent/
├── docker-compose.yml              # Unified multi-service orchestrator
├── AGENTS.md                       # Architectural documentation & agent guidelines
├── README.md                       # System overview, architecture & setup guide
├── pyproject.toml                  # Root project workspace configuration
├── docker/
│   ├── agent.Dockerfile            # Python 3.12 / uv container for Home Agent
│   ├── sandbox.Dockerfile          # Isolated runner container for Code Sandbox
│   ├── tts.Dockerfile              # Fast Piper neural TTS engine container
│   ├── web.Dockerfile              # Node container for React dashboard
│   ├── litellm_config.yaml         # LiteLLM routing matrix
│   └── home-agent.sh               # CLI lifecycle helper
├── nginx/
│   ├── Dockerfile                  # SSL proxy container
│   └── nginx.conf                  # Path routing, WebSockets, and SSL termination
├── services/
│   ├── agent/                      # Home Strands Agent (FastAPI + AG-UI)
│   │   ├── pyproject.toml
│   │   ├── data/                   # Persistent SQLite telemetry storage
│   │   └── src/
│   │       ├── main.py             # AG-UI and telemetry REST endpoints
│   │       ├── home_agent.py       # Agent definition, system prompt, and hooks
│   │       ├── code_tool.py        # execute_code sandbox bridge
│   │       ├── telemetry_tool.py   # get_system_telemetry diagnostic tool
│   │       ├── weather_tool.py     # Open-Meteo localized weather tool
│   │       └── time_tool.py        # Real-time clock and timezone tool
│   ├── sandbox/                    # Code Execution Sandbox Sidecar
│   │   ├── pyproject.toml
│   │   ├── sdk/home/               # Pre-baked SDK (hubitat, weather, search)
│   │   └── src/
│   │       ├── main.py             # Sandbox FastAPI HTTP service
│   │       └── runner.py           # Subprocess execution with process isolation
│   ├── tts/                        # Offline Neural TTS Sidecar (Piper Engine)
│   │   ├── pyproject.toml
│   │   ├── voices/                 # Cached ONNX voice models
│   │   └── src/
│   │       └── main.py             # OpenAI-compatible /v1/audio/speech endpoint
│   └── web/                        # React 19 + Vite Dashboard
│       ├── package.json
│       ├── vite.config.js
│       └── src/
│           ├── components/         # TelemetryHUD, ChatStream, VoiceHUD, Header
│           ├── hooks/              # useTTS, useAguiChat, useSTT
│           └── styles/             # Dark theme design system & glassmorphism
├── skills/
│   └── controlling-hubitat/        # 4-step pre-flight Hubitat agent skill
└── tests/
    └── test_analytics.py           # Unit tests for Pandas energy & temperature SDK
```

---

## License
MIT License. Developed for privacy-first, local-first smart home automation.