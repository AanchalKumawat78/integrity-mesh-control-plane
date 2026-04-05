import { useEffect, useState } from "react";

const AI_HISTORY_KEY = "integrity-mesh-ai-assistant-history";

const suggestionsByView = {
  security: [
    "Summarize the approval and raw-access risks in my current queue.",
    "What should a reviewer investigate first right now?",
    "Which live security signals need containment before the next drill?",
  ],
  threats: [
    "Map the most likely attacker path across the visible zones.",
    "Which compromised role would create the largest blast radius?",
    "What is the weakest transfer or session control right now?",
  ],
  redteam: [
    "Design the next exploit chain for the live posture on the map.",
    "How would an attacker pivot from a degraded zone to global impact?",
    "Explain the current drill in leadership-friendly language.",
  ],
  solutions: [
    "What are the top three fixes with the biggest risk reduction?",
    "Which control should ship before the next simulation?",
    "How should we phase mitigations by owner and urgency?",
  ],
  engineering: [
    "What should be indexed into pgvector first for Grok grounding?",
    "What deployment guardrails should block generated actions?",
    "How should Render and Netlify env vars be configured?",
  ],
};

function loadStoredHistory() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(AI_HISTORY_KEY);
    const parsedValue = rawValue ? JSON.parse(rawValue) : {};
    return parsedValue && typeof parsedValue === "object" ? parsedValue : {};
  } catch (error) {
    return {};
  }
}

export default function WorkspaceAIAssistant({
  activeView,
  dashboard,
  requestAdvice,
}) {
  const [historyByView, setHistoryByView] = useState(() => loadStoredHistory());
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const history = historyByView[activeView] || [];
  const latestResponse = history.find((item) => item.role === "assistant") || null;
  const viewSuggestions = suggestionsByView[activeView] || [
    "What changed most in this workspace?",
    "Which zone needs attention first?",
    "What should I investigate next?",
  ];

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(historyByView));
  }, [historyByView]);

  async function submitPrompt(nextPrompt) {
    const trimmedPrompt = nextPrompt.trim();
    if (!trimmedPrompt || pending) {
      return;
    }

    const conversation = history
      .filter((item) => item.role === "user" || item.role === "assistant")
      .slice(0, 6)
      .map((item) => ({
        role: item.role,
        content: item.content,
      }));

    setPending(true);
    setError("");
    setPrompt("");
    setHistoryByView((current) => ({
      ...current,
      [activeView]: [
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: trimmedPrompt,
        },
        ...(current[activeView] || []),
      ].slice(0, 12),
    }));

    try {
      const response = await requestAdvice({
        activeView,
        prompt: trimmedPrompt,
        conversation,
      });

      setHistoryByView((current) => ({
        ...current,
        [activeView]: [
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            title: response.title,
            content: response.answer,
            citations: response.citations,
            suggestedPrompts: response.suggested_prompts,
            status: response.status,
            warning: response.warning,
            provider: response.provider,
            model: response.model,
          },
          ...(current[activeView] || []),
        ].slice(0, 12),
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    void submitPrompt(prompt);
  }

  return (
    <section className="workspace-ai-panel">
      <div className="workspace-ai-header">
        <div>
          <span className="eyebrow">Grok Copilot</span>
          <h3>Read-only AI guidance across the live control plane</h3>
        </div>
        <div className="workspace-ai-provider">
          <strong>{dashboard.ai_readiness.research_assistant_model}</strong>
          <small>{dashboard.ai_readiness.deployment_status}</small>
        </div>
      </div>

      <div className="workspace-ai-grid">
        <article className="policy-card workspace-ai-console">
          <div className="workspace-ai-suggestion-row">
            {viewSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="workspace-ai-chip"
                onClick={() => void submitPrompt(suggestion)}
                disabled={pending}
              >
                {suggestion}
              </button>
            ))}
          </div>

          <form className="workspace-ai-form" onSubmit={handleSubmit}>
            <textarea
              className="workspace-ai-input"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={`Ask Grok about the ${activeView} workspace...`}
              rows={4}
            />
            <div className="workspace-ai-actions">
              <button type="submit" className="primary-button small-button" disabled={pending}>
                {pending ? "Thinking..." : "Ask Grok"}
              </button>
              <small>Advisory only. No approvals, revocations, or data mutations.</small>
            </div>
          </form>

          {error ? (
            <div className="workspace-ai-inline-error">
              <strong>AI request blocked</strong>
              <span>{error}</span>
            </div>
          ) : null}

          <div className="workspace-ai-history">
            {history.length === 0 ? (
              <div className="empty-state">
                <strong>No Grok prompts yet.</strong>
                <p>Use a quick prompt above or ask a custom question about the live workspace.</p>
              </div>
            ) : (
              history.map((item) => (
                <div key={item.id} className={`workspace-ai-history-item role-${item.role}`}>
                  <strong>{item.role === "assistant" ? item.title || "Grok response" : "You"}</strong>
                  <p>{item.content}</p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="policy-card workspace-ai-analysis">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Latest Analysis</span>
              <h3>{latestResponse?.title || "Waiting for Grok analysis"}</h3>
            </div>
            <span className={`activity-count status-${latestResponse?.status || "standby"}`}>
              {latestResponse?.status || "standby"}
            </span>
          </div>

          <p className="workspace-ai-answer">
            {latestResponse?.content ||
              "The AI panel can summarize risks, recommend mitigations, explain simulations, and translate the current workspace state into a concise operator brief."}
          </p>

          {latestResponse?.warning ? (
            <div className="workspace-ai-warning">
              <strong>Provider notice</strong>
              <span>{latestResponse.warning}</span>
            </div>
          ) : null}

          <div className="workspace-ai-meta-grid">
            <div className="workspace-ai-meta-card">
              <span>Provider</span>
              <strong>{latestResponse?.provider || "xAI"}</strong>
            </div>
            <div className="workspace-ai-meta-card">
              <span>Model</span>
              <strong>{latestResponse?.model || dashboard.ai_readiness.research_assistant_model}</strong>
            </div>
            <div className="workspace-ai-meta-card">
              <span>Workspace</span>
              <strong>{activeView}</strong>
            </div>
            <div className="workspace-ai-meta-card">
              <span>Guardrail</span>
              <strong>Read-only</strong>
            </div>
          </div>

          <div className="workspace-ai-citations">
            {(latestResponse?.citations || []).map((citation) => (
              <div key={citation.id} className="workspace-ai-citation">
                <strong>{citation.title}</strong>
                <small>{citation.detail}</small>
              </div>
            ))}
          </div>

          <div className="workspace-ai-followups">
            {(latestResponse?.suggestedPrompts || viewSuggestions).map((followUp) => (
              <button
                key={followUp}
                type="button"
                className="secondary-button small-button"
                onClick={() => void submitPrompt(followUp)}
                disabled={pending}
              >
                {followUp}
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
