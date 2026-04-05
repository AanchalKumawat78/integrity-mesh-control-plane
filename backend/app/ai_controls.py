from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_AI_PROVIDER = "xai"
DEFAULT_XAI_URL = "https://api.x.ai/v1"
DEFAULT_XAI_ENGINEERING_MODEL = "grok-code-fast-1"
DEFAULT_XAI_RESEARCH_MODEL = "grok-4-1-fast-reasoning"
DEFAULT_EMBEDDING_MODEL = "xai-collections"

DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_ENGINEERING_MODEL = "qwen2.5-coder:7b"
DEFAULT_OLLAMA_RESEARCH_MODEL = "llama3.1:8b"
DEFAULT_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text:latest"

XAI_ENGINEERING_MODEL_PREFERENCES = [
    "grok-code-fast-1",
    "grok-4-1-fast-reasoning",
    "grok-4-fast-reasoning",
    "grok-4",
]

XAI_RESEARCH_MODEL_PREFERENCES = [
    "grok-4-1-fast-reasoning",
    "grok-4-fast-reasoning",
    "grok-4",
    "grok-3-mini",
]

OLLAMA_ENGINEERING_MODEL_PREFERENCES = [
    "qwen2.5-coder",
    "deepseek-coder",
    "codellama",
    "llama3.1",
    "mistral",
]

OLLAMA_RESEARCH_MODEL_PREFERENCES = [
    "llama3.1",
    "qwen2.5",
    "mistral",
    "phi4",
]

OLLAMA_EMBEDDING_MODEL_PREFERENCES = [
    "nomic-embed-text",
    "mxbai-embed-large",
    "snowflake-arctic-embed",
]


class AIProviderRequestError(RuntimeError):
    pass


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


@dataclass(frozen=True)
class AICompletionResult:
    provider: str
    model: str
    text: str


def load_ai_provider_status() -> AIProviderStatus:
    provider = os.getenv("INTEGRITY_AI_PROVIDER", DEFAULT_AI_PROVIDER).strip().lower()
    if provider == "xai":
        return _build_xai_provider_status()
    if provider == "ollama":
        return _build_ollama_provider_status()
    return _build_generic_provider_status(provider or DEFAULT_AI_PROVIDER)


def generate_ai_completion(
    *,
    purpose: str,
    system_prompt: str,
    conversation: list[dict[str, str]],
    user_prompt: str,
) -> AICompletionResult:
    provider = os.getenv("INTEGRITY_AI_PROVIDER", DEFAULT_AI_PROVIDER).strip().lower()
    if provider == "xai":
        return _generate_xai_completion(
            purpose=purpose,
            system_prompt=system_prompt,
            conversation=conversation,
            user_prompt=user_prompt,
        )
    raise AIProviderRequestError(
        f"The configured AI provider '{provider or DEFAULT_AI_PROVIDER}' does not support live completions here."
    )


def _build_xai_provider_status() -> AIProviderStatus:
    endpoint = os.getenv("INTEGRITY_AI_BASE_URL", DEFAULT_XAI_URL).strip() or DEFAULT_XAI_URL
    engineering_model = os.getenv(
        "INTEGRITY_XAI_ENGINEERING_MODEL",
        "",
    ).strip() or DEFAULT_XAI_ENGINEERING_MODEL
    research_model = os.getenv(
        "INTEGRITY_XAI_RESEARCH_MODEL",
        "",
    ).strip() or DEFAULT_XAI_RESEARCH_MODEL
    embedding_model = os.getenv(
        "INTEGRITY_AI_EMBEDDING_MODEL",
        "",
    ).strip() or DEFAULT_EMBEDDING_MODEL
    api_key = os.getenv("XAI_API_KEY", "").strip()

    if not api_key:
        return AIProviderStatus(
            provider="xai",
            endpoint=endpoint,
            available=False,
            installed_models=[],
            engineering_model=engineering_model,
            research_model=research_model,
            embedding_model=embedding_model,
            deployment_status="xAI key missing",
            rag_status="Waiting for Grok API access",
            next_step_hint=(
                "Set XAI_API_KEY, confirm the xAI team has credits or licenses, and keep "
                "retrieval answers read-only until pgvector grounding is attached."
            ),
        )

    try:
        payload = _request_json(
            f"{endpoint.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=4.0,
        )
    except AIProviderRequestError as exc:
        return AIProviderStatus(
            provider="xai",
            endpoint=endpoint,
            available=False,
            installed_models=[],
            engineering_model=engineering_model,
            research_model=research_model,
            embedding_model=embedding_model,
            deployment_status="xAI unavailable",
            rag_status="Waiting for Grok API access",
            next_step_hint=str(exc),
        )

    installed_models = [
        model.get("id", "").strip()
        for model in payload.get("data", [])
        if isinstance(model, dict) and model.get("id")
    ]

    resolved_engineering = _select_model(
        installed_models,
        engineering_model,
        XAI_ENGINEERING_MODEL_PREFERENCES,
        DEFAULT_XAI_ENGINEERING_MODEL,
    )
    resolved_research = _select_model(
        installed_models,
        research_model,
        XAI_RESEARCH_MODEL_PREFERENCES,
        DEFAULT_XAI_RESEARCH_MODEL,
    )

    return AIProviderStatus(
        provider="xai",
        endpoint=endpoint,
        available=True,
        installed_models=installed_models,
        engineering_model=resolved_engineering,
        research_model=resolved_research,
        embedding_model=embedding_model,
        deployment_status="Grok API ready",
        rag_status="Grok live, pgvector grounding still required",
        next_step_hint=(
            "Attach system, site, zone, approval-policy, and incident-runbook documents to "
            "pgvector or xAI collections before enabling any generated actions."
        ),
    )


def _build_ollama_provider_status() -> AIProviderStatus:
    endpoint = os.getenv("INTEGRITY_OLLAMA_URL", DEFAULT_OLLAMA_URL).strip() or DEFAULT_OLLAMA_URL
    available, installed_models = _fetch_ollama_models(endpoint)

    engineering_model = _select_model(
        installed_models,
        os.getenv("INTEGRITY_OLLAMA_ENGINEERING_MODEL", "").strip(),
        OLLAMA_ENGINEERING_MODEL_PREFERENCES,
        DEFAULT_OLLAMA_ENGINEERING_MODEL,
    )
    research_model = _select_model(
        installed_models,
        os.getenv("INTEGRITY_OLLAMA_RESEARCH_MODEL", "").strip(),
        OLLAMA_RESEARCH_MODEL_PREFERENCES,
        DEFAULT_OLLAMA_RESEARCH_MODEL,
    )
    embedding_model = _select_model(
        installed_models,
        os.getenv("INTEGRITY_OLLAMA_EMBEDDING_MODEL", "").strip(),
        OLLAMA_EMBEDDING_MODEL_PREFERENCES,
        DEFAULT_OLLAMA_EMBEDDING_MODEL,
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
    engineering_model = os.getenv("INTEGRITY_AI_ENGINEERING_MODEL", "external-engineering")
    research_model = os.getenv("INTEGRITY_AI_RESEARCH_MODEL", "external-research")
    embedding_model = os.getenv("INTEGRITY_AI_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)
    return AIProviderStatus(
        provider=normalized_provider,
        endpoint="configured externally",
        available=True,
        installed_models=[engineering_model, research_model, embedding_model],
        engineering_model=engineering_model,
        research_model=research_model,
        embedding_model=embedding_model,
        deployment_status=f"{normalized_provider.title()} ready",
        rag_status="Provider-configured retrieval ready",
        next_step_hint="Verify retrieval filters and tool permissions before enabling generated actions.",
    )


def _generate_xai_completion(
    *,
    purpose: str,
    system_prompt: str,
    conversation: list[dict[str, str]],
    user_prompt: str,
) -> AICompletionResult:
    endpoint = os.getenv("INTEGRITY_AI_BASE_URL", DEFAULT_XAI_URL).strip() or DEFAULT_XAI_URL
    api_key = os.getenv("XAI_API_KEY", "").strip()
    if not api_key:
        raise AIProviderRequestError(
            "Grok is configured for this workspace, but XAI_API_KEY is missing."
        )

    model = _resolve_xai_model(purpose)
    input_messages = [{"role": "system", "content": system_prompt}]
    input_messages.extend(
        {
            "role": turn["role"],
            "content": turn["content"],
        }
        for turn in conversation
        if turn.get("role") in {"user", "assistant"} and turn.get("content", "").strip()
    )
    input_messages.append({"role": "user", "content": user_prompt})

    payload = {
        "model": model,
        "input": input_messages,
        "temperature": 0.2,
        "max_output_tokens": 900,
    }

    response = _request_json(
        f"{endpoint.rstrip('/')}/responses",
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload).encode("utf-8"),
        timeout=60.0,
    )
    text = _extract_response_text(response)
    if not text.strip():
        raise AIProviderRequestError("Grok returned an empty response.")

    return AICompletionResult(provider="xai", model=model, text=text.strip())


def _resolve_xai_model(purpose: str) -> str:
    if purpose == "engineering":
        return os.getenv(
            "INTEGRITY_XAI_ENGINEERING_MODEL",
            DEFAULT_XAI_ENGINEERING_MODEL,
        ).strip() or DEFAULT_XAI_ENGINEERING_MODEL
    return os.getenv(
        "INTEGRITY_XAI_RESEARCH_MODEL",
        DEFAULT_XAI_RESEARCH_MODEL,
    ).strip() or DEFAULT_XAI_RESEARCH_MODEL


def _extract_response_text(payload: dict) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    fragments: list[str] = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                fragments.append(text.strip())
    return "\n".join(fragments).strip()


def _fetch_ollama_models(endpoint: str) -> tuple[bool, list[str]]:
    try:
        payload = _request_json(f"{endpoint.rstrip('/')}/api/tags", timeout=0.35)
    except AIProviderRequestError:
        return False, []

    models = [
        model.get("name", "").strip()
        for model in payload.get("models", [])
        if isinstance(model, dict) and model.get("name")
    ]
    return True, models


def _request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: float = 3.0,
) -> dict:
    request = Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise AIProviderRequestError(_decode_http_error(exc)) from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise AIProviderRequestError(str(exc)) from exc


def _decode_http_error(error: HTTPError) -> str:
    try:
        payload = json.loads(error.read().decode("utf-8"))
    except Exception:  # pragma: no cover - best effort for provider errors
        payload = None

    if isinstance(payload, dict):
        error_message = payload.get("error")
        code = payload.get("code")
        if isinstance(error_message, str) and error_message.strip():
            if isinstance(code, str) and code.strip():
                return f"{error_message.strip()} ({code.strip()})"
            return error_message.strip()
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()

    return f"HTTP {error.code} returned from {error.url}"


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
