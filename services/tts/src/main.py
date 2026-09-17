"""FastAPI service exposing Piper Neural Text-to-Speech via standard HTTP endpoints."""

import io
import os
import wave
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
import requests

VOICES_DIR = Path(os.getenv("VOICES_DIR", "/app/voices"))
VOICES_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_VOICE = os.getenv("DEFAULT_VOICE", "en_US-lessac-medium")

# Piper model download URLs from Hugging Face / piper-voices
VOICE_URLS = {
    "en_US-lessac-medium": {
        "onnx": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
        "json": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json",
    },
    "en_US-amy-medium": {
        "onnx": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx",
        "json": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json",
    },
}

app = FastAPI(title="Home Agent Neural TTS Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

piper_voice = None


def ensure_voice_model(voice_name: str) -> tuple[Path, Path]:
    """Ensure ONNX and JSON config files are downloaded for the selected voice."""
    onnx_path = VOICES_DIR / f"{voice_name}.onnx"
    json_path = VOICES_DIR / f"{voice_name}.onnx.json"

    if onnx_path.exists() and json_path.exists():
        return onnx_path, json_path

    if voice_name not in VOICE_URLS:
        raise ValueError(f"Unknown voice model: {voice_name}")

    print(f"Downloading voice model '{voice_name}'...")
    urls = VOICE_URLS[voice_name]
    
    # Download ONNX model
    res_onnx = requests.get(urls["onnx"], timeout=60)
    res_onnx.raise_for_status()
    onnx_path.write_bytes(res_onnx.content)

    # Download JSON config
    res_json = requests.get(urls["json"], timeout=30)
    res_json.raise_for_status()
    json_path.write_bytes(res_json.content)

    print(f"Downloaded voice model '{voice_name}' successfully.")
    return onnx_path, json_path


def get_loaded_voice():
    """Load and cache the PiperVoice instance."""
    global piper_voice
    if piper_voice is None:
        try:
            from piper import PiperVoice
            onnx_path, json_path = ensure_voice_model(DEFAULT_VOICE)
            piper_voice = PiperVoice.load(str(onnx_path), config_path=str(json_path))
            print(f"Loaded Piper voice: {DEFAULT_VOICE}")
        except Exception as e:
            print(f"Warning: Failed to load PiperVoice: {e}")
            piper_voice = None
    return piper_voice


class SpeechRequest(BaseModel):
    input: str
    voice: Optional[str] = None
    model: Optional[str] = None
    speed: Optional[float] = 1.0


class SynthesizeRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = 1.0


@app.get("/health")
def health():
    voice = get_loaded_voice()
    return {
        "status": "healthy" if voice else "initializing",
        "engine": "piper-tts",
        "default_voice": DEFAULT_VOICE,
        "is_ready": voice is not None,
    }


def synthesize_speech(text: str, speed: float = 1.0) -> bytes:
    """Synthesize text into WAV byte buffer."""
    voice = get_loaded_voice()
    if voice is None:
        raise HTTPException(status_code=503, detail="TTS Engine voice model is not loaded.")

    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Empty text provided.")

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize_wav(clean_text, wav_file)
    buf.seek(0)
    return buf.read()


@app.post("/v1/audio/speech")
def openai_speech_endpoint(req: SpeechRequest):
    """OpenAI-compatible speech synthesis endpoint."""
    wav_bytes = synthesize_speech(req.input, speed=req.speed or 1.0)
    return Response(content=wav_bytes, media_type="audio/wav")


@app.post("/synthesize")
def synthesize_endpoint(req: SynthesizeRequest):
    """Direct speech synthesis endpoint."""
    wav_bytes = synthesize_speech(req.text, speed=req.speed or 1.0)
    return Response(content=wav_bytes, media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("TTS_HOST", "0.0.0.0")
    port = int(os.getenv("TTS_PORT", "8001"))
    print(f"Starting Neural TTS Engine on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")
