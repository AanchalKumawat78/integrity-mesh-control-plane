import { useEffect, useMemo, useState } from "react";

import SimulationMap from "./SimulationMap";
import SimulationTrackChart from "./SimulationTrackChart";

const RED_TEAM_HISTORY_KEY = "integrity-mesh-red-team-history";
const STEP_DELAY_MS = 1200;
const visualizationStageBlueprints = [
  {
    key: "collection",
    label: "Collect",
    role: "data-collection",
  },
  {
    key: "preprocessing",
    label: "Prep",
    role: "data-preprocessing",
  },
  {
    key: "analysis",
    label: "Analyze",
    role: "data-analysis",
  },
  {
    key: "validation",
    label: "Validate",
    role: "test-postprocess",
  },
  {
    key: "transfer",
    label: "Transfer",
    role: "data-transfer",
  },
];

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const shortTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const shortDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
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

function formatDateTime(value) {
  return shortDateTimeFormatter.format(new Date(value));
}

function getRiskTone(score) {
  if (score >= 72) {
    return "negative";
  }
  if (score >= 46) {
    return "warning";
  }
  return "positive";
}

function countRoleLevers(role) {
  return [
    role.can_view_sensitive,
    role.can_view_audit_logs,
    role.can_manage_users,
    role.can_run_simulation,
    role.can_review_unmask,
  ].filter(Boolean).length;
}

function getLiveZone(zoneId, simulationRun) {
  return simulationRun?.zone_progress?.find((zone) => zone.zone_id === zoneId) || null;
}

function loadStoredHistory() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(RED_TEAM_HISTORY_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch (error) {
    return [];
  }
}

function uniqueZones(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function getZoneAttackPressure(zone, liveSimulationRun) {
  const liveZone = getLiveZone(zone.id, liveSimulationRun);
  const anomalies = liveZone?.anomalies_found ?? zone.latest_run?.anomalies_found ?? 0;
  const degradedCount = zone.agents.filter((agent) => agent.status === "degraded").length;
  const integrity = liveZone?.integrity_score ?? zone.integrity_score;
  const transferRate = liveZone?.secure_transfer_rate ?? zone.secure_transfer_rate;

  return Number(
    (
      anomalies * 18 +
      degradedCount * 15 +
      (100 - integrity) * 1.5 +
      (100 - transferRate) * 1.2
    ).toFixed(1),
  );
}

function getScenarioZones(scenario, dashboard, accessRequests, liveSimulationRun) {
  const zones = dashboard.zones || [];
  if (!scenario || zones.length === 0) {
    return [];
  }

  const requests = accessRequests?.requests || [];
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const riskyZones = [...zones].sort(
    (left, right) =>
      getZoneAttackPressure(right, liveSimulationRun) -
      getZoneAttackPressure(left, liveSimulationRun),
  );
  const requestZones = requests
    .map((request) => zoneById.get(request.zone_id))
    .filter(Boolean);
  const liveFlowZones = (liveSimulationRun?.map_flows || [])
    .flatMap((flow) => [zoneById.get(flow.source_zone_id), zoneById.get(flow.target_zone_id)])
    .filter(Boolean);
  const degradedTransferZones = zones.filter((zone) =>
    zone.agents.some((agent) => agent.role === "data-transfer" && agent.status === "degraded"),
  );
  const degradedOrAnomalousZones = riskyZones.filter((zone) => {
    const liveZone = getLiveZone(zone.id, liveSimulationRun);
    const anomalies = liveZone?.anomalies_found ?? zone.latest_run?.anomalies_found ?? 0;
    return anomalies > 0 || zone.agents.some((agent) => agent.status === "degraded");
  });
  const onePerSystem = [];
  const seenSystems = new Set();

  riskyZones.forEach((zone) => {
    if (seenSystems.has(zone.system_code)) {
      return;
    }
    seenSystems.add(zone.system_code);
    onePerSystem.push(zone);
  });

  const limit = Math.max(1, Math.min(scenario.zonesAtRisk, zones.length));

  switch (scenario.id) {
    case "reviewer-hijack":
      return uniqueZones([...requestZones, ...riskyZones]).slice(0, limit);
    case "transfer-leader-exfil":
      return uniqueZones([...degradedTransferZones, ...liveFlowZones, ...riskyZones]).slice(0, limit);
    case "rag-poisoning":
      return uniqueZones([...onePerSystem, ...riskyZones]).slice(0, limit);
    case "zone-lateral-move":
      return uniqueZones([...degradedOrAnomalousZones, ...riskyZones]).slice(0, limit);
    default:
      return uniqueZones([...requestZones, ...degradedOrAnomalousZones, ...riskyZones]).slice(0, limit);
  }
}

function buildRedTeamVisualizationRun({
  dashboard,
  accessRequests,
  liveSimulationRun,
  scenario,
  simulationState,
}) {
  if (!scenario) {
    return null;
  }

  const targetedZones = getScenarioZones(scenario, dashboard, accessRequests, liveSimulationRun);
  if (targetedZones.length === 0) {
    return null;
  }

  const previewMode = !simulationState;
  const currentStatus = simulationState?.status || "preview";
  const activeStepIndex = simulationState?.status === "running" ? simulationState.stepIndex : -1;
  const visibleStepCount =
    simulationState?.status === "running"
      ? simulationState.stepIndex + 1
      : scenario.chain.length;
  const startedAt = simulationState?.startedAt || new Date().toISOString();
  const completedAt =
    currentStatus === "completed"
      ? simulationState?.completedAt || new Date().toISOString()
      : null;
  const logEntriesChronological = simulationState?.log ? [...simulationState.log].reverse() : [];
  const baseTime = new Date(startedAt).getTime();
  const assignments = scenario.chain.map((step, index) => ({
    index,
    step,
    zone: targetedZones[index % targetedZones.length],
    stage: visualizationStageBlueprints[index % visualizationStageBlueprints.length],
    createdAt:
      logEntriesChronological[index]?.timestamp ||
      new Date(baseTime + index * 90000).toISOString(),
  }));
  const highlightedAssignment =
    currentStatus === "running"
      ? assignments[activeStepIndex] || assignments[0]
      : assignments[0];
  const activeFlowIndex =
    targetedZones.length > 1
      ? currentStatus === "running"
        ? Math.min(targetedZones.length - 2, activeStepIndex % (targetedZones.length - 1))
        : 0
      : -1;

  const timelineEvents = assignments
    .filter((assignment) => previewMode || assignment.index < visibleStepCount)
    .map((assignment) => ({
      id: `${scenario.id}-${String(assignment.index + 1).padStart(2, "0")}`,
      zone_id: assignment.zone.id,
      zone_code: assignment.zone.code,
      stage_key: assignment.stage.key,
      event_type:
        currentStatus === "running" && assignment.index === activeStepIndex
          ? "stage-started"
          : "stage-completed",
      severity:
        scenario.tone === "negative" &&
        (assignment.index === scenario.chain.length - 1 || assignment.index === activeStepIndex)
          ? "warning"
          : "info",
      message: `${assignment.zone.label} · ${assignment.step.label}: ${assignment.step.detail}`,
      created_at: assignment.createdAt,
    }));

  const zoneProgress = targetedZones.map((zone) => {
    const liveZone = getLiveZone(zone.id, liveSimulationRun);
    const zoneAssignments = assignments.filter((assignment) => assignment.zone.id === zone.id);
    const activeAssignment = zoneAssignments.find(
      (assignment) => assignment.index === activeStepIndex,
    );
    const previewAssignment = previewMode && highlightedAssignment?.zone.id === zone.id
      ? highlightedAssignment
      : null;

    const stages = visualizationStageBlueprints.map((stage) => {
      const matchingAssignments = zoneAssignments.filter(
        (assignment) => assignment.stage.key === stage.key,
      );
      const hasCompletedAssignment = matchingAssignments.some(
        (assignment) =>
          currentStatus === "completed" ||
          previewMode ||
          assignment.index < activeStepIndex,
      );
      const isActive =
        activeAssignment?.stage.key === stage.key || previewAssignment?.stage.key === stage.key;
      const zoneAgent =
        zone.agents.find((agent) => agent.role === stage.role) || zone.agents[0];

      return {
        key: stage.key,
        label: stage.label,
        role: stage.role,
        status: isActive ? "active" : hasCompletedAssignment ? "completed" : "pending",
        agent_label: zoneAgent?.label || stage.label,
        agent_status: zoneAgent?.status || "active",
        detail:
          matchingAssignments[0]?.step.detail ||
          `${scenario.title} pressure projected through ${stage.label}.`,
        is_leader: stage.key === "transfer",
      };
    });

    return {
      zone_id: zone.id,
      zone_code: zone.code,
      zone_label: zone.label,
      site_label: zone.site_label,
      region: zone.region,
      latitude: zone.latitude,
      longitude: zone.longitude,
      status:
        activeAssignment || previewAssignment
          ? "active"
          : currentStatus === "completed" || zoneAssignments.length > 0
            ? "warning"
            : "pending",
      active_stage_key: activeAssignment?.stage.key || previewAssignment?.stage.key || null,
      latest_message:
        activeAssignment?.step.detail ||
        previewAssignment?.step.detail ||
        zoneAssignments[zoneAssignments.length - 1]?.step.detail ||
        scenario.summary,
      leader_label: zone.leader_label,
      integrity_score: liveZone?.integrity_score ?? zone.integrity_score,
      secure_transfer_rate: liveZone?.secure_transfer_rate ?? zone.secure_transfer_rate,
      anomalies_found: liveZone?.anomalies_found ?? zone.latest_run?.anomalies_found ?? 0,
      transmitted_packets: liveZone?.transmitted_packets ?? zone.latest_run?.transmitted_packets ?? 0,
      stages,
    };
  });

  const mapFlows = targetedZones.slice(0, -1).map((zone, index) => {
    const target = targetedZones[index + 1];
    const flowStatus =
      currentStatus === "completed"
        ? "completed"
        : currentStatus === "running"
          ? index < activeFlowIndex
            ? "completed"
            : index === activeFlowIndex
              ? "active"
              : "pending"
          : index === 0
            ? "active"
            : "pending";

    return {
      id: `${scenario.id}-flow-${zone.id}-${target.id}`,
      kind: "redteam-path",
      status: flowStatus,
      source_zone_id: zone.id,
      source_zone_label: zone.label,
      source_site_code: zone.site_code || zone.code,
      source_site_label: zone.site_label || zone.label,
      source_latitude: zone.latitude,
      source_longitude: zone.longitude,
      target_zone_id: target.id,
      target_zone_label: target.label,
      target_site_code: target.site_code || target.code,
      target_site_label: target.site_label || target.label,
      target_latitude: target.latitude,
      target_longitude: target.longitude,
      packet_count: Math.round(scenario.exposedRecords / Math.max(targetedZones.length, 1)),
      started_at: startedAt,
      completed_at: currentStatus === "completed" ? completedAt : null,
    };
  });

  return {
    id: simulationState?.scenarioId
      ? `redteam-live-${simulationState.scenarioId}`
      : `redteam-preview-${scenario.id}`,
    status: currentStatus,
    started_at: startedAt,
    completed_at: completedAt,
    total_zones: targetedZones.length,
    completed_zones:
      currentStatus === "running"
        ? Math.min(targetedZones.length, activeStepIndex + 1)
        : targetedZones.length,
    generated_at: completedAt || startedAt,
    warning_zones: zoneProgress.filter((zone) => zone.status === "warning").length,
    timeline_events: timelineEvents,
    map_flows: mapFlows,
    zone_progress: zoneProgress,
  };
}

function buildScenarioCatalog(dashboard, accessRequests, auditLogs, simulationRun) {
  const zones = dashboard.zones || [];
  const roleDirectory = dashboard.role_directory || [];
  const requests = accessRequests?.requests || [];
  const pendingReviews = requests.filter((request) => request.status === "pending").length;
  const approvedRequests = requests.filter((request) => request.status === "approved").length;
  const activeGrants = dashboard.security_posture.active_unmask_grants;
  const deniedEvents = dashboard.security_posture.denied_events_24h;
  const activeSessions = dashboard.security_posture.active_sessions;
  const totalSensitiveRecords = dashboard.security_posture.total_sensitive_records;
  const transmittedPackets = dashboard.summary.transmitted_packets;
  const averageIntegrity = dashboard.summary.average_integrity;
  const secureTransferRate = dashboard.summary.secure_transfer_rate;
  const auditDenials = (auditLogs?.logs || []).filter((log) => log.outcome === "denied").length;
  const activeFlows = simulationRun?.map_flows?.filter((flow) => flow.status === "active").length || 0;
  const liveWarnings =
    simulationRun?.timeline_events?.filter((event) => event.severity === "warning").length || 0;
  const degradedZones = zones.filter((zone) =>
    zone.agents.some((agent) => agent.status === "degraded"),
  ).length;
  const anomalousZones = zones.filter((zone) => {
    const liveZone = getLiveZone(zone.id, simulationRun);
    return (liveZone?.anomalies_found ?? zone.latest_run?.anomalies_found ?? 0) > 0;
  }).length;
  const degradedTransferZones = zones.filter((zone) =>
    zone.agents.some((agent) => agent.role === "data-transfer" && agent.status === "degraded"),
  ).length;
  const privilegedRoles = roleDirectory.filter((role) => countRoleLevers(role) >= 3).length;
  const reviewerRoles = Math.max(
    1,
    roleDirectory.filter((role) => role.can_review_unmask).length,
  );
  const globalWarnings = dashboard.global_events.filter((event) => event.severity !== "info").length;
  const aiReady = dashboard.ai_readiness.rag_status.toLowerCase().includes("ready");
  const totalZones = Math.max(zones.length, 1);
  const totalSystems = Math.max(dashboard.systems.length, 1);
  const suspiciousSignals = deniedEvents + auditDenials + liveWarnings + globalWarnings;

  const reviewerScore = clamp(
    Math.round(46 + pendingReviews * 8 + approvedRequests * 6 + activeGrants * 7 + reviewerRoles * 4),
    18,
    98,
  );
  const reviewerBlast = clamp(
    Math.round(38 + activeGrants * 11 + approvedRequests * 8 + (totalSensitiveRecords / 5000) * 7),
    16,
    99,
  );
  const reviewerRecords = clamp(
    Math.round(totalSensitiveRecords * (0.06 + activeGrants * 0.04 + approvedRequests * 0.02)),
    1,
    Math.max(totalSensitiveRecords, 1),
  );

  const transferScore = clamp(
    Math.round(
      40 +
        degradedTransferZones * 15 +
        activeFlows * 8 +
        (100 - secureTransferRate) * 1.6 +
        degradedZones * 2,
    ),
    16,
    99,
  );
  const transferBlast = clamp(
    Math.round(
      42 +
        degradedTransferZones * 12 +
        activeFlows * 9 +
        (transmittedPackets / 100000) * 22,
    ),
    18,
    99,
  );
  const transferRecords = clamp(
    Math.round(transmittedPackets * 0.34 + degradedTransferZones * 3400 + activeFlows * 2200),
    2400,
    Math.max(totalSensitiveRecords, transmittedPackets),
  );

  const sprayScore = clamp(
    Math.round(28 + deniedEvents * 4 + activeSessions * 5 + privilegedRoles * 9 + auditDenials * 2),
    14,
    94,
  );
  const sprayBlast = clamp(
    Math.round(26 + activeSessions * 7 + privilegedRoles * 10 + suspiciousSignals * 1.3),
    14,
    92,
  );
  const sprayRecords = clamp(
    Math.round(totalSensitiveRecords * 0.03 + privilegedRoles * 1800 + activeSessions * 520),
    1,
    Math.max(totalSensitiveRecords, 1),
  );

  const ragRecords = clamp(
    Math.round(totalSensitiveRecords * 0.28 + totalSystems * 2 + globalWarnings),
    1,
    Math.max(totalSensitiveRecords, totalSystems * 4, 1),
  );

  const ragScore = clamp(
    Math.round(
      22 + (aiReady ? 18 : 8) + globalWarnings * 4 + liveWarnings * 5 + totalSystems * 2,
    ),
    10,
    88,
  );
  const ragBlast = clamp(
    Math.round(24 + totalSystems * 7 + (aiReady ? 16 : 5) + globalWarnings * 3),
    12,
    90,
  );

  const lateralScore = clamp(
    Math.round(
      32 + anomalousZones * 11 + degradedZones * 8 + (100 - averageIntegrity) * 1.3 + activeFlows * 4,
    ),
    18,
    96,
  );
  const lateralBlast = clamp(
    Math.round(30 + anomalousZones * 10 + degradedZones * 9 + totalZones * 3),
    18,
    94,
  );
  const lateralRecords = clamp(
    Math.round(
      totalSensitiveRecords * 0.4 +
        transmittedPackets * 0.18 +
        anomalousZones * 120 +
        degradedZones * 90,
    ),
    1,
    Math.max(totalSensitiveRecords, transmittedPackets, 1),
  );

  return [
    {
      id: "reviewer-hijack",
      title: "Reviewer Session Hijack",
      vector: "Token theft against the approval chain",
      target: "Temporary raw-record reveal workflow",
      summary:
        "A phished or replayed reviewer session can turn queue pressure into immediate raw-data access without changing any role assignments.",
      score: reviewerScore,
      blastRadius: reviewerBlast,
      zonesAtRisk: clamp(1 + pendingReviews + approvedRequests + activeGrants, 1, totalZones),
      exposedRecords: reviewerRecords,
      domainsImpacted: 3,
      countermeasure:
        "Bind grants to device and session context, require dual approval on high-risk reveals, and revoke active windows on reviewer drift.",
      impactBreakdown: [
        {
          label: "Zones exposed",
          value: `${clamp(1 + approvedRequests + activeGrants, 1, totalZones)}/${totalZones}`,
          note: "Regions that can be touched once a reviewer approves a reveal under attacker control.",
        },
        {
          label: "Records reachable",
          value: formatCompact(reviewerRecords),
          note: "Projected raw records exposed before containment or grant expiry.",
        },
        {
          label: "Approval load",
          value: `${pendingReviews + approvedRequests}`,
          note: "Queued or recently-approved requests that make reviewer phishing more believable.",
        },
        {
          label: "Control domains",
          value: "Identity + Approval + Data",
          note: "This path links session theft directly to sensitive-record exposure.",
        },
      ],
      chain: [
        {
          id: "foothold",
          label: "Initial foothold",
          detail: "A targeted phish or SSO replay lands inside a reviewer browser session.",
          metricLabel: "Reviewer pressure",
          metricValue: `${pendingReviews} pending`,
        },
        {
          id: "session-replay",
          label: "Session replay",
          detail: "The attacker reuses a still-valid reviewer session before the operator notices any drift.",
          metricLabel: "Live sessions",
          metricValue: `${activeSessions} active`,
        },
        {
          id: "approval-abuse",
          label: "Approval abuse",
          detail: "A temporary unmask request is approved or extended for a high-value record window.",
          metricLabel: "Grant windows",
          metricValue: `${activeGrants} live`,
        },
        {
          id: "recon-pivot",
          label: "Recon pivot",
          detail: "Audit and security context are harvested to map which zones and records are most valuable next.",
          metricLabel: "Privileged roles",
          metricValue: `${privilegedRoles} high-value`,
        },
        {
          id: "impact",
          label: "Raw-data exposure",
          detail: "Sensitive records become directly reachable across multiple zones until the grant is revoked.",
          metricLabel: "Projected exposure",
          metricValue: formatCompact(reviewerRecords),
        },
      ],
    },
    {
      id: "transfer-leader-exfil",
      title: "Transfer Leader Exfiltration",
      vector: "Compromise the 05 leader and its cross-zone handoffs",
      target: "Global dispatch lanes and sealed packet movement",
      summary:
        "The attacker pressures degraded 05 transfer leaders, rides active flows, and turns the busiest inter-zone path into a quiet exfiltration channel.",
      score: transferScore,
      blastRadius: transferBlast,
      zonesAtRisk: clamp(degradedTransferZones + activeFlows + 1, 1, totalZones),
      exposedRecords: transferRecords,
      domainsImpacted: 4,
      countermeasure:
        "Auto-quarantine degraded leaders, rotate inter-zone credentials, and require re-attestation before any outbound dispatch resumes.",
      impactBreakdown: [
        {
          label: "Transfer lanes",
          value: `${degradedTransferZones + activeFlows}`,
          note: "Degraded or currently active lanes that an attacker can weaponize first.",
        },
        {
          label: "Packets at risk",
          value: formatCompact(transmittedPackets),
          note: "Sealed packet volume crossing the control plane during the current operating window.",
        },
        {
          label: "Projected spill",
          value: formatCompact(transferRecords),
          note: "Estimated records exposed if one leader is captured and lateral flow continues.",
        },
        {
          label: "Control domains",
          value: "Runtime + Transfer + Identity + Detection",
          note: "This path combines zone credentials, lane trust, and packet movement.",
        },
      ],
      chain: [
        {
          id: "lane-foothold",
          label: "Compromise a weak lane",
          detail: "A degraded transfer zone is targeted because the 05 leader already shows operational drag.",
          metricLabel: "Weak leaders",
          metricValue: `${degradedTransferZones} degraded`,
        },
        {
          id: "credential-reuse",
          label: "Reuse leader trust",
          detail: "Inter-zone credentials or mTLS context are replayed to look like normal dispatch traffic.",
          metricLabel: "Secure transfer",
          metricValue: formatPercent(secureTransferRate),
        },
        {
          id: "flow-pivot",
          label: "Hijack active flow",
          detail: "The attacker rides a live handoff path so the exfil blends into the busiest operational movement.",
          metricLabel: "Active flows",
          metricValue: `${activeFlows} live`,
        },
        {
          id: "packet-drain",
          label: "Drain packet stream",
          detail: "Sealed packets are siphoned or replayed while downstream regions still trust the sending leader.",
          metricLabel: "Packet volume",
          metricValue: formatCompact(transmittedPackets),
        },
        {
          id: "global-impact",
          label: "Global impact",
          detail: "Multiple regions inherit bad trust decisions before a quarantine or credential rotation lands.",
          metricLabel: "Projected exposure",
          metricValue: formatCompact(transferRecords),
        },
      ],
    },
    {
      id: "credential-spray",
      title: "Credential Spray and Session Replay",
      vector: "Probe privileged accounts until one foothold survives",
      target: "Admin, reviewer, and monitoring sessions",
      summary:
        "Repeated denied logins and a wide session footprint give attackers room to discover weak accounts and replay still-valid sessions across the mesh.",
      score: sprayScore,
      blastRadius: sprayBlast,
      zonesAtRisk: clamp(Math.round(totalZones * 0.5) + privilegedRoles, 1, totalZones),
      exposedRecords: sprayRecords,
      domainsImpacted: 3,
      countermeasure:
        "Use passkeys for privileged roles, bind tokens to device posture, and expire impossible-travel sessions automatically.",
      impactBreakdown: [
        {
          label: "Suspicious signals",
          value: `${suspiciousSignals}`,
          note: "Denied actions, warning events, and live alerts already stressing the detection surface.",
        },
        {
          label: "Session footprint",
          value: `${activeSessions}`,
          note: "Concurrent authenticated sessions that expand replay opportunities.",
        },
        {
          label: "Privilege density",
          value: `${privilegedRoles}`,
          note: "Roles with enough authority to convert a single stolen session into a platform foothold.",
        },
        {
          label: "Projected exposure",
          value: formatCompact(sprayRecords),
          note: "Records and controls reachable if one high-authority session survives replay.",
        },
      ],
      chain: [
        {
          id: "enumeration",
          label: "Enumerate privileged users",
          detail: "The attacker maps reviewers, admins, and monitoring specialists from exposed login patterns and workflows.",
          metricLabel: "High-value roles",
          metricValue: `${privilegedRoles}`,
        },
        {
          id: "spray",
          label: "Credential spray",
          detail: "Repeated low-and-slow attempts search for weak credentials or recovery flows that can be coerced.",
          metricLabel: "Denied logins",
          metricValue: `${deniedEvents}/24h`,
        },
        {
          id: "session-capture",
          label: "Capture a live session",
          detail: "A surviving browser token or unattended session is replayed across the control plane.",
          metricLabel: "Active sessions",
          metricValue: `${activeSessions}`,
        },
        {
          id: "role-pivot",
          label: "Pivot into privileged tooling",
          detail: "The foothold is upgraded into monitoring, engineering, or audit visibility to suppress response and study detection logic.",
          metricLabel: "Audit denials",
          metricValue: `${auditDenials}`,
        },
        {
          id: "impact",
          label: "Operational blind spot",
          detail: "The attacker hides inside normal operator actions while high-authority controls are quietly abused.",
          metricLabel: "Projected exposure",
          metricValue: formatCompact(sprayRecords),
        },
      ],
    },
    {
      id: "rag-poisoning",
      title: "Runbook and RAG Poisoning",
      vector: "Poison trusted guidance before operators act",
      target: "Future engineering copilots and operator retrieval flows",
      summary:
        "Attackers seed malicious runbooks or guidance so the future AI layer carries the wrong response into real operator decisions.",
      score: ragScore,
      blastRadius: ragBlast,
      zonesAtRisk: clamp(Math.round(totalZones * 0.6), 1, totalZones),
      exposedRecords: ragRecords,
      domainsImpacted: 2,
      countermeasure:
        "Require signed runbooks, retrieval provenance, and human confirmation before AI-suggested changes can touch high-impact operations.",
      impactBreakdown: [
        {
          label: "Systems touched",
          value: `${totalSystems}`,
          note: "The number of deployments and documents whose guidance can be influenced by poisoned retrieval.",
        },
        {
          label: "Warning drag",
          value: `${globalWarnings + liveWarnings}`,
          note: "Current warning volume that makes bad guidance easier to blend into urgent operator work.",
        },
        {
          label: "AI readiness",
          value: aiReady ? "Retrieval-ready" : "Preparation phase",
          note: "Even pre-launch content pipelines should be treated as a threat surface.",
        },
        {
          label: "Control domains",
          value: "Knowledge + Response",
          note: "This path corrupts decisions more than it corrupts credentials.",
        },
      ],
      chain: [
        {
          id: "plant-doc",
          label: "Plant malicious content",
          detail: "A poisoned incident note, runbook, or support document is introduced into the retrieval path.",
          metricLabel: "Systems in scope",
          metricValue: `${totalSystems}`,
        },
        {
          id: "citation-abuse",
          label: "Exploit trusted citations",
          detail: "Operators receive bad advice with seemingly-valid operational context and supporting references.",
          metricLabel: "AI posture",
          metricValue: aiReady ? "ready" : "warming",
        },
        {
          id: "operator-drift",
          label: "Induce operator drift",
          detail: "Containment, approval, or transfer decisions move in the wrong direction because the source looked legitimate.",
          metricLabel: "Warnings live",
          metricValue: `${globalWarnings + liveWarnings}`,
        },
        {
          id: "unsafe-change",
          label: "Trigger unsafe change",
          detail: "A lane is reopened, a control is weakened, or an analyst follows malicious guidance under time pressure.",
          metricLabel: "Affected zones",
          metricValue: `${clamp(Math.round(totalZones * 0.6), 1, totalZones)}`,
        },
        {
          id: "impact",
          label: "Guidance corruption",
          detail: "Bad knowledge propagates across operators and regions until the poisoned source is quarantined.",
          metricLabel: "Blast radius",
          metricValue: `${ragBlast}/100`,
        },
      ],
    },
    {
      id: "zone-lateral-move",
      title: "Degraded Zone Lateral Move",
      vector: "Enter through weak regional agents and walk the chain",
      target: "01 -> 03 -> 05 stage progression inside busy zones",
      summary:
        "A degraded or anomalous zone gives the attacker a practical foothold to pivot from local collection or analysis into global transfer trust.",
      score: lateralScore,
      blastRadius: lateralBlast,
      zonesAtRisk: clamp(anomalousZones + degradedZones + 1, 1, totalZones),
      exposedRecords: lateralRecords,
      domainsImpacted: 4,
      countermeasure:
        "Seal anomalous batches, isolate degraded zones, and require fresh validation before transfer leaders can relay cross-zone traffic.",
      impactBreakdown: [
        {
          label: "Watch zones",
          value: `${anomalousZones + degradedZones}`,
          note: "Zones already showing degradation or anomaly pressure and therefore easiest to pivot through.",
        },
        {
          label: "Integrity drag",
          value: formatPercent(averageIntegrity),
          note: "Average integrity still looks healthy, but degraded regions create attacker-sized cracks.",
        },
        {
          label: "Live handoffs",
          value: `${activeFlows}`,
          note: "Active map flows that can carry a local foothold into a larger cross-zone breach.",
        },
        {
          label: "Projected exposure",
          value: formatCompact(lateralRecords),
          note: "Estimated sensitive reach if the attacker walks the full five-stage chain.",
        },
      ],
      chain: [
        {
          id: "local-entry",
          label: "Enter a weak region",
          detail: "The attacker lands in a zone already showing degraded agents or anomaly backlog.",
          metricLabel: "Weak zones",
          metricValue: `${anomalousZones + degradedZones}`,
        },
        {
          id: "stage-walk",
          label: "Walk 01 -> 03",
          detail: "Collection, preprocessing, and analysis stages are abused to harvest context and local secrets with minimal noise.",
          metricLabel: "Integrity",
          metricValue: formatPercent(averageIntegrity),
        },
        {
          id: "leader-approach",
          label: "Approach the 05 leader",
          detail: "The foothold is pushed toward validation and transfer so the attacker can turn regional access into movement.",
          metricLabel: "Active flows",
          metricValue: `${activeFlows}`,
        },
        {
          id: "cross-zone-hop",
          label: "Cross-zone hop",
          detail: "A local compromise becomes lateral movement when the transfer leader trusts the weakened lane.",
          metricLabel: "Zones at risk",
          metricValue: `${clamp(anomalousZones + degradedZones + 1, 1, totalZones)}`,
        },
        {
          id: "impact",
          label: "Mesh-wide spread",
          detail: "A small regional issue becomes a global incident because the attacker rode the exact chain the system uses to scale safely.",
          metricLabel: "Projected exposure",
          metricValue: formatCompact(lateralRecords),
        },
      ],
    },
  ].map((scenario) => ({
    ...scenario,
    tone: getRiskTone(scenario.score),
  }));
}

function buildHistoryEntry(scenario, startedAt, completedAt, visualizationRun = null) {
  const averageIntegrity =
    visualizationRun?.zone_progress?.length > 0
      ? Number(
          (
            visualizationRun.zone_progress.reduce(
              (total, zone) => total + zone.integrity_score,
              0,
            ) / visualizationRun.zone_progress.length
          ).toFixed(1),
        )
      : 0;
  const averageTransferRate =
    visualizationRun?.zone_progress?.length > 0
      ? Number(
          (
            visualizationRun.zone_progress.reduce(
              (total, zone) => total + zone.secure_transfer_rate,
              0,
            ) / visualizationRun.zone_progress.length
          ).toFixed(1),
        )
      : 0;

  return {
    id: `${scenario.id}-${completedAt}`,
    scenario_id: scenario.id,
    title: scenario.title,
    tone: scenario.tone,
    score: scenario.score,
    blast_radius: scenario.blastRadius,
    zones_at_risk: scenario.zonesAtRisk,
    exposed_records: scenario.exposedRecords,
    started_at: startedAt,
    completed_at: completedAt,
    status: "completed",
    generated_at: completedAt,
    total_zones: visualizationRun?.total_zones ?? scenario.zonesAtRisk,
    completed_zones: visualizationRun?.completed_zones ?? scenario.zonesAtRisk,
    average_integrity: averageIntegrity,
    average_transfer_rate: averageTransferRate,
    warning_zones: visualizationRun?.warning_zones ?? 0,
    timeline_events: visualizationRun?.timeline_events?.map((event) => ({ ...event })) || [],
  };
}

export default function RedTeamSimulatorView({
  dashboard,
  accessRequests,
  auditLogs,
  simulationRun,
}) {
  const scenarios = useMemo(
    () => buildScenarioCatalog(dashboard, accessRequests, auditLogs, simulationRun),
    [dashboard, accessRequests, auditLogs, simulationRun],
  );
  const scenarioMap = useMemo(
    () => Object.fromEntries(scenarios.map((scenario) => [scenario.id, scenario])),
    [scenarios],
  );
  const [selectedScenarioId, setSelectedScenarioId] = useState(scenarios[0]?.id || null);
  const [simulationState, setSimulationState] = useState(null);
  const [history, setHistory] = useState(loadStoredHistory);

  useEffect(() => {
    if (!scenarios.length) {
      setSelectedScenarioId(null);
      return;
    }

    setSelectedScenarioId((current) =>
      current && scenarioMap[current] ? current : scenarios[0].id,
    );
  }, [scenarioMap, scenarios]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(RED_TEAM_HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (!simulationState || simulationState.status !== "running") {
      return undefined;
    }

    const scenario = scenarioMap[simulationState.scenarioId];
    if (!scenario) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      if (simulationState.stepIndex >= scenario.chain.length - 1) {
        const completedAt = new Date().toISOString();
        const completedState = {
          ...simulationState,
          status: "completed",
          completedAt,
        };
        const visualizationRun = buildRedTeamVisualizationRun({
          dashboard,
          accessRequests,
          liveSimulationRun: simulationRun,
          scenario,
          simulationState: completedState,
        });

        setSimulationState((current) =>
          current
            ? {
              ...current,
              status: "completed",
              completedAt,
              log: [
                {
                  id: `${current.scenarioId}-completed-${completedAt}`,
                  timestamp: completedAt,
                  tone: "positive",
                  message: `${scenario.title} reached projected impact. Use the countermeasure panel to rehearse containment.`,
                },
                ...current.log,
              ],
            }
            : current,
        );
        setHistory((current) => [
          buildHistoryEntry(
            scenario,
            simulationState.startedAt,
            completedAt,
            visualizationRun,
          ),
          ...current,
        ].slice(0, 8));
        return;
      }

      const nextStep = scenario.chain[simulationState.stepIndex + 1];
      const createdAt = new Date().toISOString();
      setSimulationState((current) =>
        current
          ? {
            ...current,
            stepIndex: current.stepIndex + 1,
            log: [
              {
                id: `${scenario.id}-${nextStep.id}-${createdAt}`,
                timestamp: createdAt,
                tone: current.stepIndex + 1 === scenario.chain.length - 1 ? "negative" : "live",
                message: `${nextStep.label} engaged. ${nextStep.detail}`,
              },
              ...current.log,
            ],
          }
          : current,
      );
    }, STEP_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [accessRequests, dashboard, scenarioMap, simulationRun, simulationState]);

  const selectedScenario = selectedScenarioId ? scenarioMap[selectedScenarioId] : null;
  const runningScenario =
    simulationState?.scenarioId ? scenarioMap[simulationState.scenarioId] || selectedScenario : null;
  const displayedScenario = runningScenario || selectedScenario;
  const currentStep =
    displayedScenario && simulationState
      ? displayedScenario.chain[Math.min(simulationState.stepIndex, displayedScenario.chain.length - 1)]
      : displayedScenario?.chain[0];
  const redTeamVisualizationRun = useMemo(
    () =>
      displayedScenario
        ? buildRedTeamVisualizationRun({
            dashboard,
            accessRequests,
            liveSimulationRun: simulationRun,
            scenario: displayedScenario,
            simulationState:
              simulationState?.scenarioId === displayedScenario.id ? simulationState : null,
          })
        : null,
    [accessRequests, dashboard, displayedScenario, simulationRun, simulationState],
  );
  const redTeamHistoryRuns = useMemo(
    () =>
      history.filter(
        (entry) => Array.isArray(entry.timeline_events) && entry.timeline_events.length > 0,
      ),
    [history],
  );
  const progressPercent = displayedScenario
    ? !simulationState
      ? 0
      : simulationState.status === "completed"
        ? 100
        : Math.round(((simulationState.stepIndex ?? 0) + 1) / displayedScenario.chain.length * 100)
    : 0;
  const topScenario = scenarios[0]
    ? [...scenarios].sort((left, right) => right.score - left.score)[0]
    : null;
  const simulatedRuns = history.length;
  const impactedLaneCount = redTeamVisualizationRun?.map_flows?.length || 0;
  const activeVisualZones =
    redTeamVisualizationRun?.zone_progress?.filter((zone) => zone.status === "active").length || 0;
  const globalThreatLoad = clamp(
    Math.round(
      scenarios.reduce((total, scenario) => total + scenario.score, 0) /
        Math.max(scenarios.length, 1),
    ),
    0,
    100,
  );

  function startScenario(scenario) {
    const createdAt = new Date().toISOString();
    setSelectedScenarioId(scenario.id);
    setSimulationState({
      scenarioId: scenario.id,
      status: "running",
      startedAt: createdAt,
      completedAt: null,
      stepIndex: 0,
      log: [
        {
          id: `${scenario.id}-start-${createdAt}`,
          timestamp: createdAt,
          tone: "live",
          message: `${scenario.chain[0].label} engaged. ${scenario.chain[0].detail}`,
        },
      ],
    });
  }

  function resetDrill() {
    setSimulationState(null);
  }

  return (
    <section className="redteam-page">
      <div className="redteam-summary-grid">
        <article className="redteam-summary-card tone-negative">
          <span>Adversary Load</span>
          <strong>{globalThreatLoad}</strong>
          <small>weighted from every red-team chain against the current live posture</small>
        </article>
        <article className="redteam-summary-card tone-warning">
          <span>Top Blast Radius</span>
          <strong>{topScenario ? `${topScenario.blastRadius}/100` : "0/100"}</strong>
          <small>{topScenario ? topScenario.title : "No exploit path selected yet"}</small>
        </article>
        <article className="redteam-summary-card tone-warning">
          <span>Live Attack Chains</span>
          <strong>{scenarios.length}</strong>
          <small>one-click exploit drills tuned to approvals, transfer, identity, AI, and regional drift</small>
        </article>
        <article className="redteam-summary-card tone-positive">
          <span>Simulated Runs</span>
          <strong>{simulatedRuns}</strong>
          <small>recent exploit rehearsals preserved locally for quick follow-up analysis</small>
        </article>
      </div>

      <div className="redteam-main-grid">
        <article className="policy-card redteam-card redteam-card-span-two">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Red Team Simulator</span>
              <h3>One-click adversary drills against the live control plane</h3>
            </div>
            <span className="activity-count">{scenarios.length} scenarios armed</span>
          </div>
          <p className="panel-subcopy">
            These drills translate the current dashboard posture into attacker playbooks so you can
            pressure-test approvals, transfer leaders, privileged sessions, regional drift, and
            future AI guidance before an incident does it for you.
          </p>

          <div className="redteam-scenario-grid">
            {scenarios.map((scenario) => {
              const isSelected = scenario.id === selectedScenarioId;
              const isRunning =
                simulationState?.status === "running" && simulationState.scenarioId === scenario.id;

              return (
                <div
                  key={scenario.id}
                  className={`redteam-scenario-card tone-${scenario.tone} ${isSelected ? "is-selected" : ""}`}
                >
                  <div className="redteam-scenario-head">
                    <div>
                      <strong>{scenario.title}</strong>
                      <span>{scenario.vector}</span>
                    </div>
                    <span className="mini-badge">{scenario.score}/100</span>
                  </div>

                  <p>{scenario.summary}</p>

                  <div className="redteam-scenario-metrics">
                    <div>
                      <span>Blast Radius</span>
                      <strong>{scenario.blastRadius}/100</strong>
                    </div>
                    <div>
                      <span>Zones at Risk</span>
                      <strong>{scenario.zonesAtRisk}</strong>
                    </div>
                    <div>
                      <span>Records Reachable</span>
                      <strong>{formatCompact(scenario.exposedRecords)}</strong>
                    </div>
                  </div>

                  <div className="redteam-scenario-actions">
                    <button
                      type="button"
                      className="secondary-button small-button"
                      onClick={() => setSelectedScenarioId(scenario.id)}
                    >
                      Inspect Chain
                    </button>
                    <button
                      type="button"
                      className="primary-button small-button"
                      onClick={() => startScenario(scenario)}
                    >
                      {isRunning ? "Simulating..." : "Simulate Exploit"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="policy-card redteam-card">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Drill Command</span>
              <h3>{displayedScenario ? displayedScenario.title : "Select a drill"}</h3>
            </div>
            <span className={`activity-count ${simulationState?.status === "running" ? "is-live" : ""}`}>
              {simulationState?.status === "running"
                ? "live"
                : simulationState?.status === "completed"
                  ? "complete"
                  : "armed"}
            </span>
          </div>

          {displayedScenario ? (
            <div className="redteam-command-shell">
              <div className="redteam-command-summary">
                <strong>{displayedScenario.target}</strong>
                <p>{displayedScenario.countermeasure}</p>
              </div>

              <div className="redteam-command-metrics">
                <div className="redteam-command-stat">
                  <span>Status</span>
                  <strong>
                    {simulationState?.status === "running"
                      ? "Exploit in motion"
                      : simulationState?.status === "completed"
                        ? "Impact projected"
                        : "Ready to run"}
                  </strong>
                </div>
                <div className="redteam-command-stat">
                  <span>Progress</span>
                  <strong>{progressPercent}%</strong>
                </div>
                <div className="redteam-command-stat">
                  <span>Current Step</span>
                  <strong>{currentStep?.label || "Awaiting start"}</strong>
                </div>
              </div>

              <div className="simulation-progress-shell">
                <div className="simulation-progress-bar" style={{ width: `${progressPercent}%` }}></div>
              </div>

              <div className="action-cluster">
                <button
                  type="button"
                  className="primary-button small-button"
                  onClick={() => startScenario(displayedScenario)}
                >
                  {simulationState?.status === "running" && simulationState.scenarioId === displayedScenario.id
                    ? "Restart Drill"
                    : "Launch Drill"}
                </button>
                <button
                  type="button"
                  className="secondary-button small-button"
                  onClick={resetDrill}
                  disabled={!simulationState}
                >
                  Clear Drill
                </button>
              </div>

              <div className="redteam-command-log">
                {(simulationState?.log || []).slice(0, 5).map((entry) => (
                  <div key={entry.id} className={`redteam-command-entry tone-${entry.tone}`}>
                    <span>{shortTimeFormatter.format(new Date(entry.timestamp))}</span>
                    <strong>{entry.message}</strong>
                  </div>
                ))}
                {!simulationState ? (
                  <div className="redteam-command-empty">
                    <strong>No active drill yet.</strong>
                    <span>Run any scenario to watch the attack chain progress step by step.</span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </article>
      </div>

      {displayedScenario && redTeamVisualizationRun ? (
        <div className="redteam-visual-grid">
          <article className="policy-card monitoring-map-card redteam-card redteam-map-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">Exploit Surface Map</span>
                <h3>Live geographic spread of the selected attack chain</h3>
              </div>
              <span className="activity-count">
                {redTeamVisualizationRun.total_zones} zones · {impactedLaneCount} lanes
              </span>
            </div>
            <p className="panel-subcopy">
              Every drill now projects onto the global map so you can watch which regions are
              active, where the attacker is moving next, and how the pressure spreads when the
              exploit reaches new transfer lanes.
            </p>

            <SimulationMap
              locations={dashboard.global_locations}
              zones={dashboard.zones}
              simulationRun={redTeamVisualizationRun}
            />

            <div className="redteam-map-readout">
              <div className="redteam-map-chip">
                <span>Active zones</span>
                <strong>{activeVisualZones}</strong>
              </div>
              <div className="redteam-map-chip">
                <span>Scenario target</span>
                <strong>{displayedScenario.target}</strong>
              </div>
              <div className="redteam-map-chip">
                <span>AI / RAG posture</span>
                <strong>{dashboard.ai_readiness.rag_status}</strong>
              </div>
            </div>
          </article>

          <SimulationTrackChart
            dashboard={dashboard}
            simulationRun={redTeamVisualizationRun}
            historyRuns={redTeamHistoryRuns}
          />
        </div>
      ) : null}

      {displayedScenario ? (
        <div className="redteam-secondary-grid">
          <article className="policy-card redteam-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">Attack Chain</span>
                <h3>Projected steps from foothold to impact</h3>
              </div>
              <span className="activity-count">{displayedScenario.chain.length} stages</span>
            </div>

            <div className="redteam-chain-list">
              {displayedScenario.chain.map((step, index) => {
                const stepStatus =
                  simulationState?.scenarioId === displayedScenario.id
                    ? simulationState.status === "completed" || index < simulationState.stepIndex
                      ? "completed"
                      : index === simulationState.stepIndex
                        ? "active"
                        : "pending"
                    : index === 0
                      ? "armed"
                      : "pending";

                return (
                  <div key={step.id} className={`redteam-chain-step status-${stepStatus}`}>
                    <div className="redteam-chain-index">{String(index + 1).padStart(2, "0")}</div>
                    <div className="redteam-chain-copy">
                      <strong>{step.label}</strong>
                      <p>{step.detail}</p>
                    </div>
                    <div className="redteam-chain-meta">
                      <span>{step.metricLabel}</span>
                      <strong>{step.metricValue}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="policy-card redteam-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">Blast Radius</span>
                <h3>What the exploit would touch if it lands</h3>
              </div>
              <span className="activity-count">{displayedScenario.blastRadius}/100</span>
            </div>

            <div className="redteam-impact-grid">
              {displayedScenario.impactBreakdown.map((item) => (
                <div key={item.label} className="redteam-impact-card">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.note}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="policy-card redteam-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">Recent Drills</span>
                <h3>Historical exploit rehearsals</h3>
              </div>
              <span className="activity-count">{history.length} saved</span>
            </div>

            <div className="redteam-history-list">
              {history.map((item) => (
                <div key={item.id} className={`redteam-history-item tone-${item.tone}`}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{formatDateTime(item.completed_at)}</span>
                  </div>
                  <div className="redteam-history-metrics">
                    <small>{item.blast_radius}/100 blast radius</small>
                    <small>{formatCompact(item.exposed_records)} records</small>
                  </div>
                </div>
              ))}
              {history.length === 0 ? (
                <div className="redteam-history-empty">
                  <strong>No saved drills yet.</strong>
                  <span>Your one-click exploit runs will show up here for quick comparison.</span>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
