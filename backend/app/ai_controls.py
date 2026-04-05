from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


DEFAULT_AI_PROVIDER = "ollama"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_ENGINEERING_MODEL = "qwen2.5-coder:7b"
DEFAULT_RESEARCH_MODEL = "llama3.1:8b"
DEFAULT_EMBEDDING_MODEL = "nomic-embed-text:latest"

ENGINEERING_MODEL_PREFERENCES = [
    "qwen2.5-coder",
    "deepseek-coder",
    "codellama",
    "llama3.1",
    "mistral",
]

RESEARCH_MODEL_PREFERENCES = [
    "llama3.1",
    "qwen2.5",
    "mistral",
    "phi4",
]

EMBEDDING_MODEL_PREFERENCES = [
    "nomic-embed-text",
    "mxbai-embed-large",
    "snowflake-arctic-embed",
]


@dataclass(frozen=True)
class AIProviderStatus:
    provider: str
    endpoint: str
    available: bool
    installed_models: list[str]
    engineering_model: str
    research_model: str
    embedding_model: str
    deployment_status: str
    rag_status: str
    next_step_hint: str


def load_ai_provider_status() -> AIProviderStatus:
    provider = os.getenv("INTEGRITY_AI_PROVIDER", DEFAULT_AI_PROVIDER).strip().lower()
    if provider != "ollama":
        return _build_generic_provider_status(provider or DEFAULT_AI_PROVIDER)
    return _build_ollama_provider_status()


def _build_ollama_provider_status() -> AIProviderStatus:
    endpoint = os.getenv("INTEGRITY_OLLAMA_URL", DEFAULT_OLLAMA_URL).strip() or DEFAULT_OLLAMA_URL
    available, installed_models = _fetch_ollama_models(endpoint)

    engineering_model = _select_model(
        installed_models,
        os.getenv("INTEGRITY_OLLAMA_ENGINEERING_MODEL", "").strip(),
        ENGINEERING_MODEL_PREFERENCES,
        DEFAULT_ENGINEERING_MODEL,
    )
    research_model = _select_model(
        installed_models,
        os.getenv("INTEGRITY_OLLAMA_RESEARCH_MODEL", "").strip(),
        RESEARCH_MODEL_PREFERENCES,
        DEFAULT_RESEARCH_MODEL,
    )
    embedding_model = _select_model(
        installed_models,
        os.getenv("INTEGRITY_OLLAMA_EMBEDDING_MODEL", "").strip(),
        EMBEDDING_MODEL_PREFERENCES,
        DEFAULT_EMBEDDING_MODEL,
        allow_installed_fallback=False,
    )

    has_embedding_model = any(
        model_name == embedding_model or model_name.startswith(embedding_model.split(":", 1)[0])
        for model_name in installed_models
    )

    if not available:
        return AIProviderStatus(
            provider="ollama",
            endpoint=endpoint,
            available=False,
            installed_models=[],
            engineering_model=engineering_model,
            research_model=research_model,
            embedding_model=embedding_model,
            deployment_status="Ollama endpoint offline",
            rag_status="Waiting for local embedding service",
            next_step_hint=(
                f"Start Ollama at {endpoint}, then pull {engineering_model}, "
                f"{research_model}, and {embedding_model}."
            ),
        )

    if not installed_models:
        return AIProviderStatus(
            provider="ollama",
            endpoint=endpoint,
            available=True,
            installed_models=[],
            engineering_model=engineering_model,
            research_model=research_model,
            embedding_model=embedding_model,
            deployment_status="Ollama online, models pending",
            rag_status="Embedding model not pulled yet",
            next_step_hint=(
                f"Run `ollama pull {engineering_model}` plus the research and embedding models."
            ),
        )

    return AIProviderStatus(
        provider="ollama",
        endpoint=endpoint,
        available=True,
        installed_models=installed_models,
        engineering_model=engineering_model,
        research_model=research_model,
        embedding_model=embedding_model,
        deployment_status="Local Ollama ready",
        rag_status=(
            "Local embeddings ready"
            if has_embedding_model
            else "Embedding model not pulled yet"
        ),
        next_step_hint=(
            "Attach system, site, and zone documents to pgvector and keep agent actions read-only."
        ),
    )


def _build_generic_provider_status(provider: str) -> AIProviderStatus:
    normalized_provider = provider or DEFAULT_AI_PROVIDER
    engineering_model = os.getenv("INTEGRITY_AI_ENGINEERING_MODEL", "local-engineering")
    research_model = os.getenv("INTEGRITY_AI_RESEARCH_MODEL", "local-research")
    embedding_model = os.getenv("INTEGRITY_AI_EMBEDDING_MODEL", "local-embedding")
    return AIProviderStatus(
        provider=normalized_provider,
        endpoint="configured externally",
        available=True,
        installed_models=[engineering_model, research_model, embedding_model],
        engineering_model=engineering_model,
        research_model=research_model,
        embedding_model=embedding_model,
        deployment_status=f"{normalized_provider.title()} ready",
        rag_status="Provider-configured embeddings ready",
        next_step_hint="Verify retrieval filters and tool permissions before enabling generated actions.",
    )


def _fetch_ollama_models(endpoint: str) -> tuple[bool, list[str]]:
    try:
        with urlopen(f"{endpoint.rstrip('/')}/api/tags", timeout=0.35) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError):
        return False, []

    models = [
        model.get("name", "").strip()
        for model in payload.get("models", [])
        if isinstance(model, dict) and model.get("name")
    ]
    return True, models


def _select_model(
    installed_models: list[str],
    explicit_model: str,
    preferences: list[str],
    fallback: str,
    *,
    allow_installed_fallback: bool = True,
) -> str:
    if explicit_model:
        return explicit_model

    for preferred in preferences:
        for model_name in installed_models:
            if model_name == preferred or model_name.startswith(preferred):
                return model_name

    if installed_models and allow_installed_fallback:
        return installed_models[0]

    return fallback
