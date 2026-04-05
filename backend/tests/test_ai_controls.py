import json
from urllib.error import URLError
from unittest.mock import patch

from app.ai_controls import load_ai_provider_status


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_ollama_status_reports_offline_endpoint(monkeypatch):
    monkeypatch.setenv("INTEGRITY_AI_PROVIDER", "ollama")
    monkeypatch.delenv("INTEGRITY_OLLAMA_ENGINEERING_MODEL", raising=False)
    monkeypatch.delenv("INTEGRITY_OLLAMA_RESEARCH_MODEL", raising=False)
    monkeypatch.delenv("INTEGRITY_OLLAMA_EMBEDDING_MODEL", raising=False)

    with patch("app.ai_controls.urlopen", side_effect=URLError("offline")):
        status = load_ai_provider_status()

    assert status.provider == "ollama"
    assert status.available is False
    assert status.deployment_status == "Ollama endpoint offline"
    assert status.engineering_model == "qwen2.5-coder:7b"
    assert "Start Ollama" in status.next_step_hint


def test_ollama_status_uses_installed_models(monkeypatch):
    monkeypatch.setenv("INTEGRITY_AI_PROVIDER", "ollama")
    payload = {
        "models": [
            {"name": "llama3.1:8b"},
            {"name": "qwen2.5-coder:7b"},
            {"name": "nomic-embed-text:latest"},
        ]
    }

    with patch("app.ai_controls.urlopen", return_value=FakeResponse(payload)):
        status = load_ai_provider_status()

    assert status.available is True
    assert status.deployment_status == "Local Ollama ready"
    assert status.engineering_model == "qwen2.5-coder:7b"
    assert status.research_model == "llama3.1:8b"
    assert status.embedding_model == "nomic-embed-text:latest"
    assert status.rag_status == "Local embeddings ready"
