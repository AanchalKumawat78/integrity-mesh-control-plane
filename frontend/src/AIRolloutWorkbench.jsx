import { useEffect, useState } from "react";

const AI_ROLLOUT_STATE_KEY = "integrity-mesh-ai-rollout-state";

const queryOptions = [
  {
    id: "reviewer-scope",
    label: "Reviewer Scope",
    prompt: "What should the security review copilot be allowed to do?",
  },
  {
    id: "rollout-gap",
    label: "Rollout Gap",
    prompt: "What is still missing before reviewer tooling can be enabled?",
  },
  {
    id: "retrieval-filters",
    label: "Retrieval Filters",
    prompt: "How will pgvector metadata filters scope retrieval?",
  },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value) {
  return `${Number(value).toFixed(1)}%`;
}

function formatStatusLabel(value) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function loadStoredRolloutState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(AI_ROLLOUT_STATE_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch (error) {
    return null;
  }
}

function buildSourceCatalog(dashboard, accessRequests) {
  const warningEvents = dashboard.global_events.filter((event) => event.severity !== "info").length;
  const requestDrivenRunbooks = accessRequests.requests.filter(
    (request) => request.status === "pending" || request.status === "approved",
  ).length;

  return [
    {
      id: "approval-policy",
      title: "Approval Policy Docs",
      count: 1,
      category: "policy",
      description: "Reviewer authority, self-approval blocks, temporary grant rules, and revocation policy.",
      note: "Required before reviewer tooling can explain or suggest approval actions safely.",
      autoReady: false,
      sourceLabel: "Approval policy",
    },
    {
      id: "incident-runbooks",
      title: "Incident Runbooks",
      count: Math.max(2, warningEvents + requestDrivenRunbooks),
      category: "runbooks",
      description: "Containment guides, escalation paths, and reviewer incident handling playbooks.",
      note: "Required so citations reference real response steps instead of model-only suggestions.",
      autoReady: false,
      sourceLabel: "Incident runbook set",
    },
    {
      id: "system-docs",
      title: "System Docs",
      count: dashboard.systems.length,
      category: "systems",
      description: "Service topology, deployment model, stewardship model, and integrity posture per system.",
      note: "Used to scope retrieval to the exact systems the reviewer is analyzing.",
      autoReady: true,
      sourceLabel: "System architecture inventory",
    },
    {
      id: "site-docs",
      title: "Site Docs",
      count: dashboard.global_locations.length,
      category: "sites",
      description: "Residency tier, time zone, region, site posture, and local operating context.",
      note: "Lets the copilot cite the physical and residency context behind a recommendation.",
      autoReady: true,
      sourceLabel: "Site inventory",
    },
    {
      id: "zone-docs",
      title: "Zone Docs",
      count: dashboard.zones.length,
      category: "zones",
      description: "Zone integrity, transfer posture, anomalies, leaders, and agent-role lane information.",
      note: "Feeds the reviewer with zone-level evidence instead of generic region summaries.",
      autoReady: true,
      sourceLabel: "Zone operations guide",
    },
  ];
}

function buildInitialRolloutState(sourceCatalog, storedState) {
  const stagedSources = Object.fromEntries(
    sourceCatalog.map((source) => [
      source.id,
      storedState?.stagedSources?.[source.id] ?? source.autoReady,
    ]),
  );

  const everySourceReady = sourceCatalog.every((source) => stagedSources[source.id]);

  return {
    stagedSources,
    copilotEnabled: storedState?.copilotEnabled ?? everySourceReady,
    lastAction: storedState?.lastAction || "Workspace initialized in guarded mode.",
  };
}

function buildGuardrails(dashboard, allSourcesReady, copilotEnabled) {
  return [
    {
      id: "citation-mode",
      title: "Citation mode",
      status: "enforced",
      tone: "positive",
      detail: "Answers must cite attached approval, runbook, system, site, and zone sources.",
    },
    {
      id: "action-mode",
      title: "Action mode",
      status: "read-only",
      tone: "positive",
      detail: "The copilot can summarize and recommend, but it cannot approve, revoke, or mutate reviewer actions.",
    },
    {
      id: "metadata-filters",
      title: "Metadata filters",
      status: "system / site / zone",
      tone: "positive",
      detail: dashboard.ai_readiness.vector_store,
    },
    {
      id: "tooling-gate",
      title: "Reviewer tooling gate",
      status: copilotEnabled ? "pilot enabled" : allSourcesReady ? "ready to enable" : "blocked",
      tone: copilotEnabled ? "positive" : allSourcesReady ? "warning" : "negative",
      detail: allSourcesReady
        ? "Required sources are attached. Reviewer copilot can stay read-only while the pilot is enabled."
        : dashboard.ai_readiness.next_step,
    },
  ];
}

function buildCopilotResponse({
  selectedQueryId,
  allSourcesReady,
  copilotEnabled,
  sourceCatalog,
  stagedSources,
  dashboard,
  accessRequests,
}) {
  const readySources = sourceCatalog.filter((source) => stagedSources[source.id]);
  const pendingSources = sourceCatalog.filter((source) => !stagedSources[source.id]);
  const warningZones = dashboard.zones.filter(
    (zone) =>
      zone.agents.some((agent) => agent.status === "degraded") ||
      (zone.latest_run?.anomalies_found ?? 0) > 0,
  ).length;
  const pendingReviews = accessRequests.requests.filter((request) => request.status === "pending").length;

  if (!allSourcesReady || !copilotEnabled) {
    return {
      title: copilotEnabled
        ? "Reviewer copilot is waiting on grounded sources."
        : "Reviewer copilot is staged but still locked in guarded mode.",
      body: allSourcesReady
        ? "The models, embedding stack, and vector store are configured, but reviewer tooling is still locked until you enable the read-only pilot."
        : `The rollout is still missing ${pendingSources.map((source) => source.title).join(" and ")}. Until those are attached, the copilot should not advise reviewers on real approvals.`,
      tone: allSourcesReady ? "warning" : "negative",
      citations: pendingSources.length > 0
        ? pendingSources.map((source) => ({
          id: source.id,
          title: source.sourceLabel,
          detail: source.note,
        }))
        : readySources.slice(0, 3).map((source) => ({
          id: source.id,
          title: source.sourceLabel,
          detail: source.description,
        })),
    };
  }

  if (selectedQueryId === "rollout-gap") {
    return {
      title: "The rollout prerequisites are complete and the reviewer pilot can stay read-only.",
      body: `All five source groups are attached to the simulated pgvector corpus, citations are enforced, and reviewer tooling remains read-only. The remaining work is operational hardening: monitor citation quality, keep generated actions disabled, and validate retrieval relevance against the ${pendingReviews} active review items.`,
      tone: "positive",
      citations: [
        {
          id: "approval-policy",
          title: "Approval policy",
          detail: "Reviewer authority, self-approval block, and temporary grant rules are now staged.",
        },
        {
          id: "incident-runbooks",
          title: "Incident runbooks",
          detail: "Containment playbooks are available so advice stays grounded in real response steps.",
        },
      ],
    };
  }

  if (selectedQueryId === "retrieval-filters") {
    return {
      title: "Retrieval is scoped by system, site, and zone metadata before any cited answer is returned.",
      body: `The vector layer can narrow context to ${dashboard.systems.length} systems, ${dashboard.global_locations.length} sites, and ${dashboard.zones.length} zones. That means the reviewer copilot can answer with local evidence instead of a flat global summary, while still respecting masked-by-default access and keeping raw-data actions out of scope.`,
      tone: "positive",
      citations: [
        {
          id: "system-docs",
          title: "System architecture inventory",
          detail: `${dashboard.systems.length} system records are available for retrieval filtering.`,
        },
        {
          id: "site-docs",
          title: "Site inventory",
          detail: `${dashboard.global_locations.length} site records provide region, residency, and local operating context.`,
        },
        {
          id: "zone-docs",
          title: "Zone operations guide",
          detail: `${dashboard.zones.length} zone documents expose integrity, transfer, and anomaly evidence for retrieval.`,
        },
      ],
    };
  }

  return {
    title: "The security review copilot should stay strictly read-only and evidence-first.",
    body: `It can explain approval routes, summarize why a request is sensitive, surface relevant runbook steps, and cite the affected system/site/zone context. It should not approve, revoke, or mutate requests. That keeps the reviewer in control while still giving grounded help across ${warningZones} watch zones and ${pendingReviews} pending review items.`,
    tone: "positive",
    citations: [
      {
        id: "approval-policy",
        title: "Approval policy",
        detail: "Explains reviewer authority, approval model, and self-approval blocking.",
      },
      {
        id: "incident-runbooks",
        title: "Incident runbooks",
        detail: "Supplies containment guidance when a request overlaps with degraded or warning posture.",
      },
      {
        id: "zone-docs",
        title: "Zone operations guide",
        detail: "Adds integrity, transfer, and anomaly context for the exact zone under review.",
      },
    ],
  };
}

export default function AIRolloutWorkbench({
  dashboard,
  accessRequests,
  requestAdvice,
}) {
  const sourceCatalog = buildSourceCatalog(dashboard, accessRequests);
  const [selectedQueryId, setSelectedQueryId] = useState(queryOptions[0].id);
  const [rolloutState, setRolloutState] = useState(() =>
    buildInitialRolloutState(sourceCatalog, loadStoredRolloutState()),
  );
  const [livePreview, setLivePreview] = useState(null);
  const [livePreviewPending, setLivePreviewPending] = useState(false);
  const [livePreviewError, setLivePreviewError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(AI_ROLLOUT_STATE_KEY, JSON.stringify(rolloutState));
  }, [rolloutState]);

  const readySourceCount = sourceCatalog.filter(
    (source) => rolloutState.stagedSources[source.id],
  ).length;
  const totalSourceCount = sourceCatalog.length;
  const rolloutReadiness = clamp((readySourceCount / totalSourceCount) * 100, 0, 100);
  const allSourcesReady = readySourceCount === totalSourceCount;
  const readyDocumentUnits = sourceCatalog.reduce(
    (total, source) => total + (rolloutState.stagedSources[source.id] ? source.count : 0),
    0,
  );
  const totalDocumentUnits = sourceCatalog.reduce((total, source) => total + source.count, 0);
  const guardrails = buildGuardrails(
    dashboard,
    allSourcesReady,
    rolloutState.copilotEnabled,
  );
  const fallbackCopilotResponse = buildCopilotResponse({
    selectedQueryId,
    allSourcesReady,
    copilotEnabled: rolloutState.copilotEnabled,
    sourceCatalog,
    stagedSources: rolloutState.stagedSources,
    dashboard,
    accessRequests,
  });
  const copilotResponse = livePreview
    ? {
      ...fallbackCopilotResponse,
      title: livePreview.title,
      body: livePreview.answer,
      citations: livePreview.citations,
      tone: livePreview.status === "live" ? "positive" : livePreview.warning ? "warning" : fallbackCopilotResponse.tone,
      provider: livePreview.provider,
      model: livePreview.model,
      status: livePreview.status,
      warning: livePreview.warning,
    }
    : fallbackCopilotResponse;

  useEffect(() => {
    let cancelled = false;

    async function hydratePreview() {
      if (!requestAdvice) {
        return;
      }

      setLivePreviewPending(true);
      setLivePreviewError("");
      try {
        const currentPrompt = queryOptions.find((query) => query.id === selectedQueryId)?.prompt;
        const response = await requestAdvice({
          activeView: "engineering",
          prompt: `${currentPrompt} Current rollout readiness is ${Math.round(rolloutReadiness)}%, indexed source groups are ${readySourceCount}/${totalSourceCount}, and reviewer pilot is ${rolloutState.copilotEnabled ? "enabled" : "held"} in read-only mode.`,
          conversation: [],
        });
        if (!cancelled) {
          setLivePreview(response);
        }
      } catch (requestError) {
        if (!cancelled) {
          setLivePreview(null);
          setLivePreviewError(requestError.message);
        }
      } finally {
        if (!cancelled) {
          setLivePreviewPending(false);
        }
      }
    }

    void hydratePreview();
    return () => {
      cancelled = true;
    };
  }, [
    requestAdvice,
    readySourceCount,
    rolloutReadiness,
    rolloutState.copilotEnabled,
    selectedQueryId,
    totalSourceCount,
  ]);

  function stageSource(sourceId) {
    setRolloutState((current) => ({
      ...current,
      stagedSources: {
        ...current.stagedSources,
        [sourceId]: true,
      },
      lastAction: `${formatStatusLabel(sourceId)} staged into pgvector with role metadata filters.`,
    }));
  }

  function completeRollout() {
    setRolloutState((current) => ({
      stagedSources: Object.fromEntries(sourceCatalog.map((source) => [source.id, true])),
      copilotEnabled: true,
      lastAction: "Approval policy docs, incident runbooks, and local inventories attached. Reviewer copilot pilot enabled in read-only mode.",
    }));
  }

  function enablePilot() {
    setRolloutState((current) => ({
      ...current,
      copilotEnabled: true,
      lastAction: "Reviewer copilot enabled with citations required and generated actions held in read-only mode.",
    }));
  }

  function resetRollout() {
    setRolloutState(buildInitialRolloutState(sourceCatalog, null));
  }

  return (
    <section className="ai-rollout-workbench">
      <div className="ai-rollout-summary-grid">
        <article className="ai-rollout-summary-card tone-positive">
          <span>Rollout Readiness</span>
          <strong>{Math.round(rolloutReadiness)}%</strong>
          <small>source attachment, vector coverage, and reviewer-copilot gating</small>
        </article>
        <article className="ai-rollout-summary-card tone-warning">
          <span>Indexed Sources</span>
          <strong>{readySourceCount}/{totalSourceCount}</strong>
          <small>corpus groups staged into the simulated pgvector layer</small>
        </article>
        <article className="ai-rollout-summary-card tone-positive">
          <span>Read-Only Guardrails</span>
          <strong>{guardrails.filter((item) => item.tone === "positive").length}</strong>
          <small>controls holding around citations, filters, and action boundaries</small>
        </article>
        <article className={`ai-rollout-summary-card tone-${rolloutState.copilotEnabled ? "positive" : "warning"}`}>
          <span>Reviewer Pilot</span>
          <strong>{rolloutState.copilotEnabled ? "Enabled" : "Held"}</strong>
          <small>{dashboard.ai_readiness.recommended_scope}</small>
        </article>
      </div>

      <div className="ai-rollout-main-grid">
        <article className="policy-card ai-rollout-card ai-rollout-card-span-two">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">AI Rollout</span>
              <h3>LLM and RAG deployment workbench</h3>
            </div>
            <span className="activity-count">
              {readyDocumentUnits}/{totalDocumentUnits} docs staged
            </span>
          </div>

          <div className="ai-rollout-stack-grid">
            <div className="ai-rollout-stack-card">
              <span>Engineering model</span>
              <strong>{dashboard.ai_readiness.engineering_assistant_model}</strong>
            </div>
            <div className="ai-rollout-stack-card">
              <span>Research model</span>
              <strong>{dashboard.ai_readiness.research_assistant_model}</strong>
            </div>
            <div className="ai-rollout-stack-card">
              <span>Embedding model</span>
              <strong>{dashboard.ai_readiness.embedding_model}</strong>
            </div>
            <div className="ai-rollout-stack-card ai-rollout-stack-card-wide">
              <span>Vector store</span>
              <strong>{dashboard.ai_readiness.vector_store}</strong>
            </div>
          </div>

          <div className="ai-rollout-progress-shell">
            <div className="ai-rollout-progress-fill" style={{ width: `${rolloutReadiness}%` }}></div>
          </div>

          <div className="ai-rollout-actions">
            {!allSourcesReady ? (
              <button type="button" className="primary-button small-button" onClick={completeRollout}>
                Complete Rollout Prerequisites
              </button>
            ) : !rolloutState.copilotEnabled ? (
              <button type="button" className="primary-button small-button" onClick={enablePilot}>
                Enable Reviewer Copilot
              </button>
            ) : (
              <button type="button" className="primary-button small-button" disabled>
                Reviewer Copilot Live
              </button>
            )}
            <button type="button" className="secondary-button small-button" onClick={resetRollout}>
              Reset Lab
            </button>
          </div>

          <div className="ai-rollout-source-list">
            {sourceCatalog.map((source) => {
              const isReady = rolloutState.stagedSources[source.id];
              return (
                <div key={source.id} className={`ai-rollout-source-row status-${isReady ? "ready" : "pending"}`}>
                  <div className="ai-rollout-source-copy">
                    <strong>{source.title}</strong>
                    <p>{source.description}</p>
                    <small>{source.note}</small>
                  </div>
                  <div className="ai-rollout-source-meta">
                    <span>{source.count} docs</span>
                    <strong>{isReady ? "Indexed" : "Pending"}</strong>
                    {!isReady ? (
                      <button
                        type="button"
                        className="secondary-button small-button"
                        onClick={() => stageSource(source.id)}
                      >
                        Stage Docs
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="policy-card ai-rollout-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Guardrails</span>
              <h3>Reviewer tooling safety envelope</h3>
            </div>
          </div>

          <div className="ai-rollout-guardrail-list">
            {guardrails.map((guardrail) => (
              <div key={guardrail.id} className={`ai-rollout-guardrail tone-${guardrail.tone}`}>
                <div>
                  <strong>{guardrail.title}</strong>
                  <span>{guardrail.status}</span>
                </div>
                <small>{guardrail.detail}</small>
              </div>
            ))}
          </div>

          <div className="ai-rollout-console">
            <span>Rollout console</span>
            <strong>{rolloutState.lastAction}</strong>
            <small>{dashboard.ai_readiness.next_step}</small>
          </div>
        </article>
      </div>

      <div className="ai-rollout-secondary-grid">
        <article className="policy-card ai-rollout-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Knowledge Coverage</span>
              <h3>What the vector layer can retrieve</h3>
            </div>
          </div>

          <div className="ai-rollout-coverage-list">
            {sourceCatalog.map((source) => {
              const isReady = rolloutState.stagedSources[source.id];
              return (
                <div key={source.id} className="ai-rollout-coverage-row">
                  <div className="ai-rollout-coverage-head">
                    <strong>{source.title}</strong>
                    <span>{isReady ? "100%" : source.autoReady ? "100%" : "0%"}</span>
                  </div>
                  <div className="ai-rollout-coverage-bar">
                    <div
                      className={`ai-rollout-coverage-fill ${isReady ? "is-ready" : ""}`}
                      style={{ width: `${isReady ? 100 : 0}%` }}
                    ></div>
                  </div>
                  <small>{source.sourceLabel}</small>
                </div>
              );
            })}
          </div>
        </article>

        <article className="policy-card ai-rollout-card ai-rollout-preview-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Copilot Preview</span>
              <h3>Security review copilot with cited RAG</h3>
            </div>
          </div>

          <div className="ai-rollout-query-row">
            {queryOptions.map((query) => (
              <button
                key={query.id}
                type="button"
                className={`ai-rollout-query-chip ${selectedQueryId === query.id ? "is-active" : ""}`}
                onClick={() => setSelectedQueryId(query.id)}
              >
                <strong>{query.label}</strong>
                <span>{query.prompt}</span>
              </button>
            ))}
          </div>

          <div className={`ai-rollout-preview-console tone-${copilotResponse.tone}`}>
            <span className="ai-rollout-console-label">Prompt</span>
            <strong>{queryOptions.find((query) => query.id === selectedQueryId)?.prompt}</strong>
            <span className="ai-rollout-console-label">
              {livePreviewPending ? "Grok" : "Provider"}
            </span>
            {copilotResponse.provider || copilotResponse.model ? (
              <small>
                {(copilotResponse.provider || "xAI").toUpperCase()} · {copilotResponse.model || dashboard.ai_readiness.research_assistant_model}
              </small>
            ) : null}
            <span className="ai-rollout-console-label">Answer</span>
            <p>{copilotResponse.body}</p>
            {copilotResponse.warning ? <small>{copilotResponse.warning}</small> : null}
            {livePreviewError ? <small>{livePreviewError}</small> : null}
          </div>

          <div className="ai-rollout-citation-list">
            {copilotResponse.citations.map((citation) => (
              <div key={citation.id} className="ai-rollout-citation-card">
                <strong>{citation.title}</strong>
                <small>{citation.detail}</small>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
