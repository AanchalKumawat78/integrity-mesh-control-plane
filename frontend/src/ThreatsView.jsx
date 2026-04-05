const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatCompact(value) {
  return compactNumberFormatter.format(Math.max(0, Math.round(value)));
}

function formatPercent(value) {
  return `${Number(value).toFixed(1)}%`;
}

function formatRoleLabel(role) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function getLiveZone(zoneId, simulationRun) {
  return simulationRun?.zone_progress?.find((zone) => zone.zone_id === zoneId) || null;
}

function getZoneThreatScore(zone, simulationRun) {
  const liveZone = getLiveZone(zone.id, simulationRun);
  const integrity = liveZone?.integrity_score ?? zone.integrity_score;
  const transferRate = liveZone?.secure_transfer_rate ?? zone.secure_transfer_rate;
  const anomalies = liveZone?.anomalies_found ?? zone.latest_run?.anomalies_found ?? 0;
  const degradedAgents = zone.agents.filter((agent) => agent.status === "degraded").length;
  const activeStagePressure = liveZone?.status === "active" ? 8 : 0;
  const score = clamp(
    Math.round(
      degradedAgents * 18 +
        anomalies * 15 +
        (100 - integrity) * 2.2 +
        (100 - transferRate) * 1.7 +
        activeStagePressure,
    ),
    6,
    96,
  );

  const vector =
    degradedAgents > 0
      ? "Degraded lane increases control-plane foothold."
      : anomalies > 0
        ? "Anomaly backlog creates analyst and reviewer pressure."
        : "Healthy lane but still attractive for low-noise reconnaissance.";

  return {
    id: zone.id,
    code: zone.code,
    label: zone.label,
    score,
    anomalies,
    degradedAgents,
    integrity,
    transferRate,
    vector,
    tone: score >= 70 ? "negative" : score >= 42 ? "warning" : "positive",
  };
}

function buildAttackPaths(dashboard, accessRequests, simulationRun) {
  const pendingReviews = accessRequests.requests.filter((request) => request.status === "pending").length;
  const approvedGrants = accessRequests.requests.filter((request) => request.status === "approved").length;
  const deniedEvents = dashboard.security_posture.denied_events_24h;
  const activeSessions = dashboard.security_posture.active_sessions;
  const degradedTransferZones = dashboard.zones.filter((zone) =>
    zone.agents.some((agent) => agent.role === "data-transfer" && agent.status === "degraded"),
  ).length;
  const activeFlows = simulationRun?.map_flows?.filter((flow) => flow.status === "active").length || 0;
  const aiRisk = dashboard.ai_readiness.rag_status.toLowerCase().includes("ready") ? 32 : 18;

  return [
    {
      id: "reviewer-takeover",
      title: "Reviewer Token Takeover",
      tone: pendingReviews > 0 || approvedGrants > 0 ? "negative" : "warning",
      score: clamp(48 + pendingReviews * 8 + approvedGrants * 6, 18, 96),
      tactic: "Steal a reviewer session, approve a temporary unmask, then pivot into raw subject access.",
      evidence: `${pendingReviews} pending approvals and ${approvedGrants} active grant windows create approval pressure.`,
      impact: "Bypasses masking policy and exposes raw identity records without changing role assignments.",
    },
    {
      id: "session-spray",
      title: "Credential Spray + Session Replay",
      tone: deniedEvents > 4 || activeSessions > 4 ? "negative" : "warning",
      score: clamp(36 + deniedEvents * 3 + activeSessions * 4, 14, 90),
      tactic: "Use repeated sign-in probes to discover weak accounts, then replay valid sessions inside the mesh.",
      evidence: `${deniedEvents} denied actions in 24h and ${activeSessions} active sessions expand the replay surface.`,
      impact: "Provides footholds into monitoring, audit, or simulation controls with minimal network noise.",
    },
    {
      id: "transfer-exfiltration",
      title: "Transfer Leader Exfiltration",
      tone: degradedTransferZones > 0 || activeFlows > 0 ? "negative" : "warning",
      score: clamp(42 + degradedTransferZones * 14 + activeFlows * 6, 18, 94),
      tactic: "Target the 05 transfer leader to exfiltrate sealed packets or poison downstream region trust.",
      evidence: `${degradedTransferZones} degraded transfer lanes and ${activeFlows} active flow lanes are exploitable choke points.`,
      impact: "Turns cross-zone movement into data theft or integrity degradation at global scale.",
    },
    {
      id: "rag-poisoning",
      title: "Runbook and RAG Poisoning",
      tone: aiRisk >= 28 ? "warning" : "positive",
      score: aiRisk,
      tactic: "Inject malicious docs, incident notes, or playbooks so operators act on poisoned retrieval context.",
      evidence: dashboard.ai_readiness.next_step,
      impact: "Converts trusted support tooling into a low-friction social engineering channel inside operations.",
    },
  ];
}

function buildRoleSurface(roleDirectory) {
  return roleDirectory
    .filter((role) => role.role !== "system")
    .map((role) => {
      const privilegeCount = [
        role.can_view_sensitive,
        role.can_view_audit_logs,
        role.can_manage_users,
        role.can_run_simulation,
        role.can_review_unmask,
      ].filter(Boolean).length;

      const exploit =
        role.can_review_unmask
          ? "Take over review workflow and mint temporary raw-data visibility."
          : role.can_manage_users
            ? "Abuse account governance to create durable admin footholds."
            : role.can_run_simulation
              ? "Trigger simulation noise to hide transfer-lane abuse."
              : role.can_view_audit_logs
                ? "Use evidence visibility to study detections and evade response."
                : "Leverage assigned-zone scope for targeted phishing and local reconnaissance.";

      return {
        id: role.role,
        label: role.label,
        role: formatRoleLabel(role.role),
        privilegeCount,
        exploit,
        tone: privilegeCount >= 3 ? "negative" : privilegeCount === 2 ? "warning" : "positive",
      };
    })
    .sort((left, right) => right.privilegeCount - left.privilegeCount);
}

function buildThreatFeed(dashboard, accessRequests, auditLogs, simulationRun) {
  const requestSignals = accessRequests.requests.slice(0, 4).map((request) => ({
    id: `request-${request.id}`,
    title: `${request.zone_label} approval path`,
    tone: request.status === "approved" ? "warning" : request.status === "pending" ? "negative" : "positive",
    detail:
      request.status === "pending"
        ? `Pending reviewer decision could be targeted for queue stuffing or reviewer phishing.`
        : request.status === "approved"
          ? `Approved access window for ${request.record_pseudonym} is a temporary exfiltration opportunity.`
          : `Rejected access request still reveals attacker curiosity around ${request.zone_label}.`,
    timestamp: request.reviewed_at || request.requested_at,
  }));

  const auditSignals = (auditLogs.logs || []).slice(0, 4).map((log) => ({
    id: `audit-${log.id}`,
    title: `${log.action} on ${log.resource_type}`,
    tone: log.outcome === "denied" ? "negative" : "warning",
    detail: log.detail || `${log.action} generated an auditable signal.`,
    timestamp: log.created_at,
  }));

  const simulationSignals = (simulationRun?.timeline_events || []).slice(0, 4).map((event) => ({
    id: `sim-${event.id}`,
    title: `${event.zone_label} ${event.stage_key || "activity"}`,
    tone: event.severity === "warning" ? "negative" : "warning",
    detail: event.message,
    timestamp: event.created_at,
  }));

  const globalSignals = dashboard.global_events.slice(0, 4).map((event) => ({
    id: `event-${event.id}`,
    title: `${event.agent_label || "Zone event"} ${event.event_type}`,
    tone: event.severity === "warning" ? "negative" : "warning",
    detail: event.message,
    timestamp: event.created_at,
  }));

  return [...simulationSignals, ...requestSignals, ...auditSignals, ...globalSignals]
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    .slice(0, 10);
}

export default function ThreatsView({
  dashboard,
  accessRequests,
  auditLogs,
  simulationRun,
}) {
  const zoneThreats = dashboard.zones
    .map((zone) => getZoneThreatScore(zone, simulationRun))
    .sort((left, right) => right.score - left.score);
  const attackPaths = buildAttackPaths(dashboard, accessRequests, simulationRun);
  const roleSurface = buildRoleSurface(dashboard.role_directory);
  const threatFeed = buildThreatFeed(dashboard, accessRequests, auditLogs, simulationRun);
  const privilegedTargets = roleSurface.filter((role) => role.privilegeCount >= 2).length;
  const threatPressure = clamp(
    Math.round(
      zoneThreats.reduce((total, zone) => total + zone.score, 0) / Math.max(zoneThreats.length, 1) +
        attackPaths.reduce((total, path) => total + path.score, 0) / Math.max(attackPaths.length, 1) * 0.35,
    ),
    8,
    99,
  );
  const activeAttackLanes =
    (simulationRun?.map_flows?.filter((flow) => flow.status === "active").length || 0) +
    zoneThreats.filter((zone) => zone.degradedAgents > 0).length;
  const reviewPressure = accessRequests.requests.filter((request) => request.status === "pending").length;

  return (
    <section className="threats-page">
      <div className="threats-summary-grid">
        <article className="threat-summary-card tone-negative">
          <span>Threat Pressure</span>
          <strong>{threatPressure}</strong>
          <small>weighted from approval abuse, session pressure, and transfer-lane risk</small>
        </article>
        <article className="threat-summary-card tone-warning">
          <span>Active Attack Lanes</span>
          <strong>{activeAttackLanes}</strong>
          <small>transfer and degraded lanes that an attacker would prioritize first</small>
        </article>
        <article className="threat-summary-card tone-warning">
          <span>Privileged Targets</span>
          <strong>{privilegedTargets}</strong>
          <small>roles with enough authority to widen blast radius after compromise</small>
        </article>
        <article className="threat-summary-card tone-negative">
          <span>Queue Pressure</span>
          <strong>{reviewPressure}</strong>
          <small>pending review items that create urgency and reviewer-phishing opportunity</small>
        </article>
      </div>

      <div className="threats-main-grid">
        <article className="policy-card threat-card threat-card-span-two">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Attacker Playbook</span>
              <h3>How a hacker would pressure this control plane</h3>
            </div>
            <span className="activity-count">{attackPaths.length} likely paths</span>
          </div>

          <div className="attack-path-grid">
            {attackPaths.map((path) => (
              <div key={path.id} className={`attack-path-card tone-${path.tone}`}>
                <div className="attack-path-head">
                  <div>
                    <strong>{path.title}</strong>
                    <span>{path.score}/100 attacker confidence</span>
                  </div>
                  <span className="mini-badge">{path.tone}</span>
                </div>
                <p>{path.tactic}</p>
                <small>{path.evidence}</small>
                <div className="attack-path-impact">
                  <span>Impact</span>
                  <strong>{path.impact}</strong>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="policy-card threat-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Zone Heatboard</span>
              <h3>Where adversaries would enter first</h3>
            </div>
          </div>

          <div className="threat-zone-list">
            {zoneThreats.map((zone) => (
              <div key={zone.id} className={`threat-zone-row tone-${zone.tone}`}>
                <div>
                  <strong>{zone.code}</strong>
                  <span>{zone.label}</span>
                </div>
                <div className="threat-zone-meta">
                  <strong>{zone.score}</strong>
                  <small>{zone.vector}</small>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="threats-secondary-grid">
        <article className="policy-card threat-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Role Attack Surface</span>
              <h3>Which roles are most attractive to compromise</h3>
            </div>
          </div>

          <div className="role-surface-list">
            {roleSurface.map((role) => (
              <div key={role.id} className={`role-surface-row tone-${role.tone}`}>
                <div>
                  <strong>{role.label}</strong>
                  <span>{role.role}</span>
                </div>
                <div className="role-surface-copy">
                  <strong>{role.privilegeCount} exploit levers</strong>
                  <small>{role.exploit}</small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="policy-card threat-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Threat Feed</span>
              <h3>Signals that matter to an adversary</h3>
            </div>
            <span className="activity-count">{threatFeed.length} signals</span>
          </div>

          <div className="threat-feed">
            {threatFeed.map((signal) => (
              <div key={signal.id} className={`threat-feed-item tone-${signal.tone}`}>
                <div className="threat-feed-head">
                  <strong>{signal.title}</strong>
                  <span>{new Date(signal.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                </div>
                <p>{signal.detail}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="policy-card threat-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Data Theft Potential</span>
              <h3>What the attacker would value most</h3>
            </div>
          </div>

          <div className="threat-value-grid">
            <div className="threat-value-card">
              <span>Raw Records</span>
              <strong>{formatCompact(dashboard.security_posture.total_sensitive_records)}</strong>
              <small>masked datasets that become valuable if grant workflow is abused</small>
            </div>
            <div className="threat-value-card">
              <span>Transfer Volume</span>
              <strong>{formatCompact(dashboard.summary.transmitted_packets)}</strong>
              <small>sealed packets moving across the global control plane</small>
            </div>
            <div className="threat-value-card">
              <span>Audit Recon</span>
              <strong>{dashboard.security_posture.denied_events_24h}</strong>
              <small>recent probes already probing access boundaries and detections</small>
            </div>
            <div className="threat-value-card">
              <span>AI Guidance</span>
              <strong>{formatPercent(dashboard.summary.average_integrity)}</strong>
              <small>high-trust operational context that could be poisoned through runbooks</small>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
