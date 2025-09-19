"""Lightweight LLM provider abstraction.

Usage:
    from llm_provider import get_model
    model = get_model()  # uses LLM_PROVIDER env or defaults to 'ollama'

This module centralizes creating `strands` model instances for different backends
like Ollama or OpenRouter (via strands.models.openai.OpenAIModel). It reads
configuration from environment variables: LLM_PROVIDER, OLLAMA_HOST, OPENROUTER_KEY,
OPENROUTER_BASE_URL, OPENAI_API_KEY, etc.
"""
from typing import Optional, Dict
import os

from strands.models.ollama import OllamaModel
from strands.models.openai import OpenAIModel


def get_default_provider() -> str:
    return os.getenv("LLM_PROVIDER", "ollama").lower()


def get_model(provider: Optional[str] = None, **options):
    """Return a strands-compatible model instance for the selected provider.

    provider: 'ollama' | 'openrouter' | 'openai'
    options: optional overrides (model_id, host, client_args, params)
    """
    provider = (provider or get_default_provider() or "ollama").lower()

    if provider == "ollama":
        host = options.get("host") or os.getenv("OLLAMA_ENDPOINT") or os.getenv("OLLAMA_HOST") or "http://localhost:11434"
        model_id = options.get("model_id") or os.getenv("OLLAMA_MODEL_ID")
        kwargs = {}
        if model_id:
            kwargs["model_id"] = model_id
        # Allow passing params through options
        if "params" in options:
            kwargs["params"] = options["params"]
        return OllamaModel(host=host, **kwargs)

    if provider in ("openrouter", "openai"):
        # Use strands' OpenAIModel for both OpenAI and OpenRouter-compatible hosts,
        # but keep configuration and env vars separate to avoid mixing credentials.
        client_args: Dict = options.get("client_args") or {}

        if provider == "openrouter":
            # OpenRouter-specific configuration
            client_args.setdefault("api_key", os.getenv("OPENROUTER_KEY"))
            client_args.setdefault("base_url", os.getenv("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1")
            model_id = options.get("model_id") or os.getenv("OPENROUTER_MODEL_ID")
        else:
            # OpenAI-specific configuration
            client_args.setdefault("api_key", os.getenv("OPENAI_API_KEY"))
            model_id = options.get("model_id") or os.getenv("OPENAI_MODEL_ID")

        # Validate API key presence for hosted providers
        if not client_args.get("api_key"):
            missing = "OPENROUTER_KEY" if provider == "openrouter" else "OPENAI_API_KEY"
            raise RuntimeError(f"Missing API key for {provider}. Please set the environment variable {missing}.")

        params = options.get("params")

        kwargs = {"client_args": client_args}
        if model_id:
            kwargs["model_id"] = model_id
        if params is not None:
            kwargs["params"] = params

        return OpenAIModel(**kwargs)

    raise ValueError(f"Unknown LLM provider: {provider}")
