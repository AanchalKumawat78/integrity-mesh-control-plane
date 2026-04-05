from unittest.mock import patch

from app.ai_controls import (
    AIProviderRequestError,
    generate_ai_completion,
    load_ai_provider_status,
)


def test_xai_status_requires_api_key(monkeypatch):
    monkeypatch.setenv("INTEGRITY_AI_PROVIDER", "xai")
    monkeypatch.delenv("XAI_API_KEY", raising=False)

    status = load_ai_provider_status()

    assert status.provider == "xai"
    assert status.available is False
    assert status.deployment_status == "xAI key missing"
    assert "XAI_API_KEY" in status.next_step_hint


def test_xai_status_reports_provider_error(monkeypatch):
    monkeypatch.setenv("INTEGRITY_AI_PROVIDER", "xai")
    monkeypatch.setenv("XAI_API_KEY", "secret")

    with patch(
        "app.ai_controls._request_json",
        side_effect=AIProviderRequestError("Your xAI team has no credits"),
    ):
        status = load_ai_provider_status()

    assert status.provider == "xai"
    assert status.available is False
    assert status.deployment_status == "xAI unavailable"
    assert "no credits" in status.next_step_hint


def test_xai_status_uses_available_models(monkeypatch):
    monkeypatch.setenv("INTEGRITY_AI_PROVIDER", "xai")
    monkeypatch.setenv("XAI_API_KEY", "secret")

    payload = {
        "data": [
            {"id": "grok-4-1-fast-reasoning"},
            {"id": "grok-code-fast-1"},
        ]
    }

    with patch("app.ai_controls._request_json", return_value=payload):
        status = load_ai_provider_status()

    assert status.available is True
    assert status.deployment_status == "Grok API ready"
    assert status.engineering_model == "grok-code-fast-1"
    assert status.research_model == "grok-4-1-fast-reasoning"
    assert status.rag_status == "Grok live, pgvector grounding still required"


def test_ollama_status_reports_offline_endpoint(monkeypatch):
    monkeypatch.setenv("INTEGRITY_AI_PROVIDER", "ollama")
    monkeypatch.delenv("INTEGRITY_OLLAMA_ENGINEERING_MODEL", raising=False)
    monkeypatch.delenv("INTEGRITY_OLLAMA_RESEARCH_MODEL", raising=False)
    monkeypatch.delenv("INTEGRITY_OLLAMA_EMBEDDING_MODEL", raising=False)

    with patch("app.ai_controls._request_json", side_effect=AIProviderRequestError("offline")):
        status = load_ai_provider_status()

    assert status.provider == "ollama"
    assert status.available is False
    assert status.deployment_status == "Ollama endpoint offline"
    assert status.engineering_model == "qwen2.5-coder:7b"
    assert "Start Ollama" in status.next_step_hint


def test_live_completion_uses_xai_responses(monkeypatch):
    monkeypatch.setenv("INTEGRITY_AI_PROVIDER", "xai")
    monkeypatch.setenv("XAI_API_KEY", "secret")
    monkeypatch.setenv("INTEGRITY_XAI_RESEARCH_MODEL", "grok-4-1-fast-reasoning")

    payload = {"output_text": "TITLE: Ready\nANSWER:\nLive\nFOLLOW_UP:\n- Next"}

    with patch("app.ai_controls._request_json", return_value=payload) as request_mock:
        completion = generate_ai_completion(
            purpose="research",
            system_prompt="System",
            conversation=[{"role": "user", "content": "Earlier"}],
            user_prompt="Now",
        )

    assert completion.provider == "xai"
    assert completion.model == "grok-4-1-fast-reasoning"
    assert "TITLE: Ready" in completion.text
    request_mock.assert_called_once()
