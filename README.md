# Home Automation

## Preprequisites

* Docker
* Python
* UV package manager

## Docker Compose

```bash
docker compose up -d
```

## Open Web UI

1. Open the Open Web UI application in your browser at [`http://localhost:3000`](http://localhost:3000)
1. Sign up an account. This stays local, but use credentials you don't care about. Use `admin@admin.com/admin`

## Agent Setup

Install uv. On Mac, you will need to install PortAudio via `brew install portaudio`.

```bash
uv venv
source .venv/bin/activate
uv sync --all-packages
```

## Example Prompts for Home Agent

```
With Hubitat Agent, list_devices and device_details. For each smart outlet, use device_commands and control_device to turn them off. 
```

## Run Basic Demo

* Run Ollama (Run the App via Finder or whatever)
* uv run hubitat-mcp
* uv run src/hubitat.py