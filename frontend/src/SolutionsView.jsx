function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value) {
  return `${Number(value).toFixed(1)}%`;
}

function buildMitigationQueue(dashboard, accessRequests, simulationRun) {
  const pendingReviews = accessRequests.requests.filter((request) => request.status === "pending").length;
  const approvedGrants = accessRequests.requests.filter((request) => request.status === "approved").length;
  const deniedEvents = dashboard.security_posture.denied_events_24h;
  const degradedTransferZones = dashboard.zones.filter((zone) =>
    zone.agents.some((agent) => agent.role === "data-transfer" && agent.status === "degraded"),
  ).length;
  const anomalousZones = dashboard.zones.filter(
    (zone) => (zone.latest_run?.anomalies_found ?? 0) > 0,
  ).length;
  const activeFlows = simulationRun?.map_flows?.filter((flow) => flow.status === "active").length || 0;

  return [
    {
      id: "dual-review",
      title: "Introduce dual approval for high-risk unmask requests",
      priority: pendingReviews > 0 ? "P1" : "P2",
      tone: pendingReviews > 0 ? "negative" : "warning",
      owner: "Security Officer",
      reduction: `${clamp(18 + pendingReviews * 6, 12, 48)}% blast-radius reduction`,
      action:
        "Require a second reviewer when requests touch secret records, repeated requesters, or review queues under load.",
    },
    {
      id: "grant-binding",
      title: "Bind temporary grants to device and session context",
      priority: approvedGrants > 0 ? "P1" : "P2",
      tone: approvedGrants > 0 ? "negative" : "warning",
      owner: "Platform Admin",
      reduction: `${clamp(16 + approvedGrants * 7, 10, 44)}% raw-data theft reduction`,
      action:
        "Step up authentication before raw reveal, watermark exports, and invalidate grants on session fan-out or IP change.",
    },
    {
      id: "transfer-isolation",
      title: "Quarantine degraded transfer leaders automatically",
      priority: degradedTransferZones > 0 || activeFlows > 0 ? "P1" : "P2",
      tone: degradedTransferZones > 0 ? "negative" : "warning",
      owner: "Monitoring Specialist",
      reduction: `${clamp(22 + degradedTransferZones * 8 + activeFlows * 3, 12, 54)}% exfiltration reduction`,
      action:
        "Force mTLS re-attestation, rotate zone credentials, and pause outbound movement when 05 leaders degrade or drift.",
    },
    {
      id: "adaptive-login",
      title: "Harden sign-in against spray, stuffing, and replay",
      priority: deniedEvents > 5 ? "P1" : "P2",
      tone: deniedEvents > 5 ? "negative" : "warning",
      owner: "Platform Admin",
      reduction: `${clamp(14 + deniedEvents * 2, 10, 38)}% credential-abuse reduction`,
      action:
        "Add passkeys for privileged roles, adaptive rate limits, token binding, and impossible-travel session revocation.",
    },
    {
      id: "anomaly-segmentation",
      title: "Isolate analyst and validation lanes after anomaly spikes",
      priority: anomalousZones > 0 ? "P1" : "P3",
      tone: anomalousZones > 0 ? "warning" : "positive",
      owner: "Zone Operator",
      reduction: `${clamp(12 + anomalousZones * 5, 8, 34)}% lateral-movement reduction`,
      action:
        "Place anomalous batches in a sealed review subnet and require approval before they can re-enter transfer or retrieval workflows.",
    },
  ];
}

function buildControlCoverage(dashboard, accessRequests) {
  const pendingReviews = accessRequests.requests.filter((request) => request.status === "pending").length;
  const activeGrants = dashboard.security_posture.active_unmask_grants;
  const deniedEvents = dashboard.security_posture.denied_events_24h;

  return [
    {
      id: "identity",
      title: "Identity + Session",
      tone: deniedEvents > 5 ? "warning" : "positive",
      status: deniedEvents > 5 ? "Watch" : "Strong",
      note: "Rate limiting exists, but privileged accounts still need phishing-resistant authentication and token binding.",
    },
    {
      id: "approval",
      title: "Approval Workflow",
      tone: pendingReviews > 0 || activeGrants > 0 ? "warning" : "positive",
      status: pendingReviews > 0 ? "Upgrade" : "Watch",
      note: "Single-stage review blocks self-approval, but dual-control and risk-based escalation would narrow reviewer abuse.",
    },
    {
      id: "data-plane",
      title: "Transfer Plane",
      tone: dashboard.summary.secure_transfer_rate < 98 ? "warning" : "positive",
      status: dashboard.summary.secure_transfer_rate < 98 ? "Watch" : "Strong",
      note: "mTLS and sealing are good foundations; automatic quarantine on transfer drift would close the highest-value exfil path.",
    },
    {
      id: "audit",
      title: "Audit + Detection",
      tone: deniedEvents > 0 ? "warning" : "positive",
      status: deniedEvents > 0 ? "Watch" : "Strong",
      note: "Audit logging is broad, but correlation across sessions, approvals, and simulation controls should be elevated into active detections.",
    },
    {
      id: "ai",
      title: "AI / RAG",
      tone: "warning",
      status: "Upgrade",
      note: "Future engineering and analyst copilots need retrieval provenance, signed runbooks, and prompt-injection isolation before activation.",
    },
  ];
}

function buildPlaybooks(dashboard, simulationRun) {
  const highRiskZone =
    dashboard.zones.find((zone) =>
      zone.agents.some((agent) => agent.role === "data-transfer" && agent.status === "degraded"),
    ) || dashboard.zones[0];
  const activeFlow =
    simulationRun?.map_flows?.find((flow) => flow.status === "active") || simulationRun?.map_flows?.[0];

  return [
    {
      id: "reviewer-compromise",
      title: "Reviewer compromise containment",
      trigger: "Unexpected approval surge, reviewer phishing, or impossible-travel login.",
      response:
        "Freeze pending approvals, revoke active grants, rotate reviewer sessions, and require fresh approval notes for every still-open request.",
      verification: "No active grant remains tied to the compromised reviewer session or device.",
    },
    {
      id: "transfer-quarantine",
      title: "Transfer lane quarantine",
      trigger: highRiskZone
        ? `${highRiskZone.label} transfer leader degrades or integrity drops during dispatch.`
        : "Any 05 leader drifts during a cross-zone dispatch.",
      response:
        "Pause outbound packets, rotate inter-zone credentials, fail over to a healthy leader, and snapshot packet metadata for forensic replay.",
      verification: activeFlow
        ? `Flow ${activeFlow.source_zone_label} -> ${activeFlow.target_zone_label} returns to a sealed state before reopening movement.`
        : "All transfer lanes are sealed before dispatch resumes.",
    },
    {
      id: "session-abuse",
      title: "Credential spray and replay response",
      trigger: "Denied logins cluster around privileged roles or sessions fan out across zones.",
      response:
        "Raise step-up auth, expire suspicious sessions, lock impossible-travel accounts, and route affected users into passwordless recovery.",
      verification: "Denied-event rate drops while privileged sessions collapse back to expected user-device pairs.",
    },
    {
      id: "rag-poisoning",
      title: "Runbook poisoning response",
      trigger: "Unexpected guidance from retrieval-backed assistants or mismatched operational instructions.",
      response:
        "Pin signed runbooks, quarantine newly ingested docs, review retrieval provenance, and require human confirmation on high-impact AI suggestions.",
      verification: "Only signed, versioned sources remain in the retrieval index for operator-visible playbooks.",
    },
  ];
}

function buildArchitectureMoves(dashboard) {
  return [
    {
      id: "passkeys",
      title: "Passkeys for privileged roles",
      copy:
        "Move administrators, reviewers, and monitoring specialists off password-only auth so the highest-value roles cannot be phished or replayed as easily.",
    },
    {
      id: "grant-watermarking",
      title: "Watermarked raw-record access",
      copy:
        "Bind every raw reveal to a reviewer, session, and device; watermark every export so temporary grants stop being a silent data-theft path.",
    },
    {
      id: "sealed-rag",
      title: "Signed retrieval and incident content",
      copy:
        "Protect the future AI features by signing runbooks, scoring document trust, and denying high-impact answers that cite unsanctioned content.",
    },
    {
      id: "cross-zone-correlation",
      title: "Cross-zone threat correlation",
      copy:
        "Correlate approvals, transfer drifts, session anomalies, and audit denials into one detection graph so lateral movement is visible before exfiltration succeeds.",
    },
  ];
}

export default function SolutionsView({
  dashboard,
  accessRequests,
  simulationRun,
}) {
  const mitigationQueue = buildMitigationQueue(dashboard, accessRequests, simulationRun);
  const controlCoverage = buildControlCoverage(dashboard, accessRequests);
  const playbooks = buildPlaybooks(dashboard, simulationRun);
  const architectureMoves = buildArchitectureMoves(dashboard);
  const strongestControl = controlCoverage.filter((item) => item.tone === "positive").length;

  return (
    <section className="solutions-page">
      <div className="solutions-summary-grid">
        <article className="solution-summary-card tone-positive">
          <span>Controls Holding</span>
          <strong>{strongestControl}</strong>
          <small>security domains that are already providing useful resistance</small>
        </article>
        <article className="solution-summary-card tone-warning">
          <span>Priority Fixes</span>
          <strong>{mitigationQueue.filter((item) => item.priority === "P1").length}</strong>
          <small>high-value improvements that close the most attacker leverage fastest</small>
        </article>
        <article className="solution-summary-card tone-warning">
          <span>Active Grants</span>
          <strong>{dashboard.security_posture.active_unmask_grants}</strong>
          <small>temporary raw-data windows that should be tightly bound and monitored</small>
        </article>
        <article className="solution-summary-card tone-negative">
          <span>Watch Zones</span>
          <strong>{dashboard.zones.filter((zone) => (zone.latest_run?.anomalies_found ?? 0) > 0).length}</strong>
          <small>regions that need extra containment before an attacker can pivot through them</small>
        </article>
      </div>

      <div className="solutions-main-grid">
        <article className="policy-card solution-card solution-card-span-two">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Mitigation Queue</span>
              <h3>What to fix first to reduce attacker leverage</h3>
            </div>
            <span className="activity-count">{mitigationQueue.length} queued</span>
          </div>

          <div className="mitigation-queue">
            {mitigationQueue.map((item) => (
              <div key={item.id} className={`mitigation-row tone-${item.tone}`}>
                <div className="mitigation-priority">{item.priority}</div>
                <div className="mitigation-copy">
                  <strong>{item.title}</strong>
                  <p>{item.action}</p>
                </div>
                <div className="mitigation-meta">
                  <span>{item.owner}</span>
                  <strong>{item.reduction}</strong>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="policy-card solution-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Control Coverage</span>
              <h3>Where defenses need reinforcement</h3>
            </div>
          </div>

          <div className="control-coverage-list">
            {controlCoverage.map((item) => (
              <div key={item.id} className={`control-coverage-row tone-${item.tone}`}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.status}</span>
                </div>
                <small>{item.note}</small>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="solutions-secondary-grid">
        <article className="policy-card solution-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Incident Playbooks</span>
              <h3>Operator-ready containment moves</h3>
            </div>
          </div>

          <div className="playbook-list">
            {playbooks.map((playbook) => (
              <div key={playbook.id} className="playbook-card">
                <strong>{playbook.title}</strong>
                <p>{playbook.response}</p>
                <small>
                  Trigger: {playbook.trigger}
                </small>
                <small>
                  Verify: {playbook.verification}
                </small>
              </div>
            ))}
          </div>
        </article>

        <article className="policy-card solution-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Architecture Moves</span>
              <h3>Design changes that remove whole classes of attack</h3>
            </div>
          </div>

          <div className="architecture-move-list">
            {architectureMoves.map((move) => (
              <div key={move.id} className="architecture-move-card">
                <strong>{move.title}</strong>
                <p>{move.copy}</p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
