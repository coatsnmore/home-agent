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
