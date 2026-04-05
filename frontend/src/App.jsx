import { useEffect, useRef, useState } from "react";

import AIRolloutWorkbench from "./AIRolloutWorkbench";
import InteractionMarketPanel from "./InteractionMarketPanel";
import RedTeamSimulatorView from "./RedTeamSimulatorView";
import SimulationMap from "./SimulationMap";
import SimulationTrackChart from "./SimulationTrackChart";
import SolutionsView from "./SolutionsView";
import ThreatsView from "./ThreatsView";
import WorkspaceAIAssistant from "./WorkspaceAIAssistant";

const STORAGE_KEY = "integrity-mesh-token";
const SIMULATION_HISTORY_KEY = "integrity-mesh-simulation-history";
const MIN_REQUEST_JUSTIFICATION_LENGTH = 24;
const MIN_REVIEW_NOTE_LENGTH = 12;
const LIVE_SIMULATION_API_ENABLED = false;
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const summaryCards = [
  {
    key: "total_zones",
    label: "Availability Zones",
    note: "Regional command cells visible to the current user",
  },
  {
    key: "total_agents",
    label: "Active Agents",
    note: "Distributed worker mesh inside the visible scope",
  },
  {
    key: "active_leaders",
    label: "Healthy Leaders",
    note: "Coordinators currently online and sealed",
  },
  {
    key: "healthy_zones",
    label: "Healthy Zones",
    note: "Integrity and transfer within operating target",
  },
  {
    key: "redacted_records",
    label: "Records Abstracted",
    note: "Sensitive fields stripped before downstream transfer",
  },
  {
    key: "transmitted_packets",
    label: "Packets Transferred",
    note: "Sealed outputs pushed across regional leaders",
  },
  {
    key: "average_integrity",
    label: "Average Integrity",
    note: "Cross-zone validation score for the current view",
  },
  {
    key: "secure_transfer_rate",
    label: "Secure Transfer Rate",
    note: "Protected transfer completion rate",
  },
];

const demoUsers = [
  {
    username: "security",
    password: "shield123",
    label: "Security Officer",
    role: "security_officer",
    note: "Reviews access requests and has one seeded temporary grant.",
  },
  {
    username: "security.reviewer",
    password: "review123",
    label: "Security Reviewer",
    role: "security_officer",
    note: "Dedicated reviewer account for approving or rejecting unmask requests.",
  },
  {
    username: "admin",
    password: "admin123",
    label: "Platform Administrator",
    role: "admin",
    note: "User roster and audit visibility, but masked records.",
  },
  {
    username: "atlantic.operator",
    password: "zone123",
    label: "Atlantic Operator",
    role: "zone_operator",
    note: "Single-zone operations with masked subject data.",
  },
  {
    username: "policy.analyst",
    password: "analyst123",
    label: "Policy Analyst",
    role: "analyst",
    note: "Assigned-zone analysis with abstracted case views.",
  },
  {
    username: "auditor",
    password: "audit123",
    label: "Compliance Auditor",
    role: "auditor",
    note: "Audit visibility across the control plane, still masked.",
  },
];

const roleShortLabel = {
  "data-collection": "Collect",
  "data-preprocessing": "Prep",
  "data-analysis": "Analyze",
  "test-postprocess": "Validate",
  "data-transfer": "Transfer",
};

const roleLabel = {
  admin: "Administrator",
  security_officer: "Security Officer",
  zone_operator: "Zone Operator",
  analyst: "Analyst",
  auditor: "Auditor",
  system: "System",
};

const pipelineStepNote = {
  "data-collection": "source intake",
  "data-preprocessing": "normalize + mask",
  "data-analysis": "score + trace",
  "test-postprocess": "validate + seal",
  "data-transfer": "leader dispatch",
};

const clientSimulationStageBlueprints = [
  {
    key: "collection",
    label: "Collect",
    role: "data-collection",
    note: "source intake",
  },
  {
    key: "preprocessing",
    label: "Prep",
    role: "data-preprocessing",
    note: "normalize + mask",
  },
  {
    key: "analysis",
    label: "Analyze",
    role: "data-analysis",
    note: "score + trace",
  },
  {
    key: "validation",
    label: "Validate",
    role: "test-postprocess",
    note: "validate + seal",
  },
  {
    key: "transfer",
    label: "Transfer",
    role: "data-transfer",
    note: "leader dispatch",
  },
];

const loginRoleProfiles = [
  {
    role: "security_officer",
    description: "Global security role for request review, emergency investigations, and temporary raw-data decisions.",
    approvalAuthority: "Can approve, reject, and revoke unmask requests.",
    loginPurpose: "Use this role when a request needs final approval.",
  },
  {
    role: "zone_operator",
    description: "Assigned-zone operations role for regional monitoring and masked workflow triage.",
    approvalAuthority: "Can request raw access, but cannot approve it.",
    loginPurpose: "Use this role for zone operations and local exception handling.",
  },
  {
    role: "analyst",
    description: "Assigned-zone analysis role for pseudonymized case review and anomaly analysis.",
    approvalAuthority: "Can request raw access, but cannot approve it.",
    loginPurpose: "Use this role for analytic work on abstracted records.",
  },
  {
    role: "auditor",
    description: "Read-focused compliance role with audit visibility and no raw-data approval path.",
    approvalAuthority: "Cannot request or approve raw-data access.",
    loginPurpose: "Use this role for compliance review and activity tracing.",
  },
  {
    role: "admin",
    description: "Platform administration role for user governance, audit visibility, and simulation control.",
    approvalAuthority: "Cannot approve raw-data requests.",
    loginPurpose: "Use this role for platform management rather than case review.",
  },
];

const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function formatValue(key, value) {
  if (key.includes("integrity") || key.includes("rate")) {
    return `${value}%`;
  }
  return value.toLocaleString();
}

function formatDate(value) {
  return longDateFormatter.format(new Date(value));
}

function formatTime(value) {
  return timeFormatter.format(new Date(value));
}

function formatEventType(value) {
  return value.replace(/-/g, " ");
}

function formatStatusLabel(value) {
  return value
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatRoleName(value) {
  return roleLabel[value] || value.replace(/_/g, " ");
}

function formatScopeLabel(value) {
  return value === "all" ? "All zones" : "Assigned zones";
}

function formatCoordinate(value) {
  return `${value.toFixed(2)}°`;
}

function buildApiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

function loadStoredSimulationHistory() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(SIMULATION_HISTORY_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch (error) {
    return [];
  }
}

function buildSimulationHistoryEntry(simulationRun, dashboard) {
  const zoneCodeById = new Map(dashboard.zones.map((zone) => [zone.id, zone.code]));
  const averageIntegrity =
    simulationRun.zone_progress.length > 0
      ? simulationRun.zone_progress.reduce((total, zone) => total + zone.integrity_score, 0) /
        simulationRun.zone_progress.length
      : dashboard.summary.average_integrity;
  const averageTransferRate =
    simulationRun.zone_progress.length > 0
      ? simulationRun.zone_progress.reduce(
          (total, zone) => total + zone.secure_transfer_rate,
          0,
        ) / simulationRun.zone_progress.length
      : dashboard.summary.secure_transfer_rate;

  return {
    id: simulationRun.id,
    status: simulationRun.status,
    started_at: simulationRun.started_at,
    completed_at: simulationRun.completed_at,
    generated_at: simulationRun.generated_at,
    total_zones: simulationRun.total_zones,
    completed_zones: simulationRun.completed_zones,
    average_integrity: Number(averageIntegrity.toFixed(1)),
    average_transfer_rate: Number(averageTransferRate.toFixed(1)),
    warning_zones: simulationRun.zone_progress.filter((zone) => zone.status === "warning").length,
    timeline_events: simulationRun.timeline_events.map((event) => ({
      id: event.id,
      zone_id: event.zone_id,
      zone_code: zoneCodeById.get(event.zone_id) || "GLB",
      stage_key: event.stage_key || "collection",
      event_type: event.event_type,
      severity: event.severity || "info",
      message: event.message,
      created_at: event.created_at,
    })),
  };
}

function getActiveWorkspace(workspace, activeView) {
  return (
    workspace?.available_views?.find((view) => view.key === activeView) ||
    workspace?.available_views?.[0] || {
      key: "global",
      label: "Global",
      description: "Worldwide control-plane visibility.",
    }
  );
}

function getHeroContent(activeView, workspace, aiReadiness) {
  if (activeView === "security") {
    return {
      kicker: "Security review workspace",
      title: "Approve temporary access without losing the global picture.",
      copy: workspace.persona_summary,
    };
  }
  if (activeView === "analysis") {
    return {
      kicker: "Analyst workspace",
      title: "Trace masked records across systems, sites, and global regions.",
      copy: workspace.persona_summary,
    };
  }
  if (activeView === "compliance") {
    return {
      kicker: "Compliance workspace",
      title: "Audit who can see what, where, and under which approval chain.",
      copy: workspace.persona_summary,
    };
  }
  if (activeView === "engineering") {
    return {
      kicker: "Engineering rollout workspace",
      title: "Plan LLM, RAG, and agent deployment against live system topology.",
      copy: aiReadiness.recommended_scope,
    };
  }
  if (activeView === "operations") {
    return {
      kicker: "Operations workspace",
      title: "Run the mesh by system, site, and regional location instead of one flat grid.",
      copy: workspace.persona_summary,
    };
  }
  if (activeView === "monitoring") {
    return {
      kicker: "Monitoring workspace",
      title: "Global infrastructure health, Prometheus alerts, and Grafana metrics.",
      copy: workspace.persona_summary,
    };
  }
  if (activeView === "threats") {
    return {
      kicker: "Threat workspace",
      title: "See the control plane the way an attacker would map it.",
      copy: "Trace exposed approvals, weak transfer lanes, privilege-rich roles, and the fastest routes to raw-data theft or cross-zone compromise.",
    };
  }
  if (activeView === "solutions") {
    return {
      kicker: "Solutions workspace",
      title: "Design out the attacker paths before they become incidents.",
      copy: "Prioritize containment, hardening, and architecture changes that reduce blast radius across identity, approvals, transfer, runtime, and AI workflows.",
    };
  }
  if (activeView === "redteam") {
    return {
      kicker: "Red team workspace",
      title: "Rehearse exploit chains before a real attacker does.",
      copy: "Run one-click adversary drills across approvals, privileged sessions, transfer leaders, degraded zones, and AI guidance so blast radius is visible before impact lands.",
    };
  }
  return {
    kicker: "Global command workspace",
    title: "Global oversight across systems, sites, and regional integrity zones.",
    copy: workspace.persona_summary,
  };
}

function normalizeLength(value) {
  return value.trim().length;
}

function buildApiErrorMessage(payload, status) {
  if (Array.isArray(payload?.detail)) {
    const messages = payload.detail
      .map((issue) => issue?.msg)
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.join(". ");
    }
  }
  if (typeof payload?.detail === "string") {
    return payload.detail;
  }
  return `Request failed with status ${status}`;
}

function getRequestComposerError(state) {
  const justificationLength = normalizeLength(state.justification);
  if (!state.attempted && justificationLength === 0) {
    return "";
  }
  if (justificationLength === 0) {
    return "Add a justification before requesting temporary raw access.";
  }
  if (justificationLength < MIN_REQUEST_JUSTIFICATION_LENGTH) {
    return `Justification must be at least ${MIN_REQUEST_JUSTIFICATION_LENGTH} characters.`;
  }
  return "";
}

function getReviewComposerError(state) {
  const noteLength = normalizeLength(state.reviewNote);
  if (!state.attempted && noteLength === 0) {
    return "";
  }
  if (noteLength === 0) {
    return "Add a reviewer note before submitting the decision.";
  }
  if (noteLength < MIN_REVIEW_NOTE_LENGTH) {
    return `Reviewer note must be at least ${MIN_REVIEW_NOTE_LENGTH} characters.`;
  }
  return "";
}

function getZonePosture(zone) {
  const hasDegradedAgent = zone.agents.some((agent) => agent.status === "degraded");
  const hasAnomaly = zone.latest_run?.anomalies_found > 0;

  if (hasDegradedAgent || zone.integrity_score < 96 || hasAnomaly) {
    return { label: "watch", tone: "warning" };
  }

  return { label: "stable", tone: "healthy" };
}

function getAgentTone(agent) {
  if (agent.is_leader) {
    return "leader";
  }

  if (agent.status === "degraded") {
    return "warning";
  }

  return "default";
}

function getAgentPipelineState(agent) {
  if (agent.is_leader) {
    return agent.status === "degraded" ? "Leader degraded" : "Leader active";
  }
  return formatStatusLabel(agent.status);
}

function parseSimulationEventBlock(block) {
  const lines = block.split("\n");
  let event = "message";
  const dataParts = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trimStart());
    }
  }

  if (dataParts.length === 0) {
    return null;
  }

  return {
    event,
    data: JSON.parse(dataParts.join("\n")),
  };
}

function isFinalSimulationStage(stage) {
  return stage.status === "completed" || stage.status === "warning";
}

function getSimulationProgressPercent(simulationRun) {
  if (!simulationRun) {
    return 0;
  }

  const allStages = simulationRun.zone_progress.flatMap((zone) => zone.stages);
  if (allStages.length === 0) {
    return simulationRun.status === "completed" ? 100 : 0;
  }

  const completedStages = allStages.filter(isFinalSimulationStage).length;
  const activeStages = allStages.filter((stage) => stage.status === "active").length;
  const percent = ((completedStages + activeStages * 0.48) / allStages.length) * 100;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function getSimulationActiveLabel(simulationRun) {
  if (!simulationRun) {
    return "No live run";
  }
  if (simulationRun.status === "completed") {
    return "Run completed";
  }
  if (simulationRun.status === "failed") {
    return "Run failed";
  }

  const activeStages = simulationRun.zone_progress
    .map((zone) => zone.stages.find((stage) => stage.status === "active"))
    .filter(Boolean);

  if (activeStages.length === 0) {
    return simulationRun.status === "pending" ? "Preparing live run" : "Awaiting next stage";
  }

  const firstStage = activeStages[0];
  if (activeStages.every((stage) => stage.key === firstStage.key)) {
    return `${firstStage.label} across ${activeStages.length} zones`;
  }
  return `${activeStages.length} stages active`;
}

function getLiveZoneProgress(simulationRun, zoneId) {
  return simulationRun?.zone_progress?.find((zone) => zone.zone_id === zoneId) || null;
}

function buildStaticZoneStages(zone) {
  return zone.agents.map((agent) => ({
    key: agent.role,
    label: roleShortLabel[agent.role] || formatStatusLabel(agent.role),
    role: agent.role,
    note: pipelineStepNote[agent.role] || agent.label,
    detail: getAgentPipelineState(agent),
    metric_display: null,
    status: agent.status === "degraded" ? "warning" : "completed",
    agent_id: agent.id,
    agent_label: agent.label,
    agent_status: agent.status,
    security_clearance: agent.security_clearance,
    encryption_state: agent.encryption_state,
    checksum_state: agent.checksum_state,
    abstraction_level: agent.abstraction_level,
    is_leader: agent.is_leader,
  }));
}

function getDisplayStages(zone, liveZone) {
  return liveZone?.stages || buildStaticZoneStages(zone);
}

function getLiveBatchSteps(zone, liveZone) {
  if (!liveZone) {
    return zone.latest_run
      ? [
        {
          key: "collection",
          label: "Collected",
          value: zone.latest_run.collected_records.toLocaleString(),
          note: "source intake",
          status: "completed",
        },
        {
          key: "preprocessing",
          label: "Abstracted",
          value: zone.latest_run.redacted_records.toLocaleString(),
          note: "privacy sealed",
          status: "completed",
        },
        {
          key: "transfer",
          label: "Transferred",
          value: zone.latest_run.transmitted_packets.toLocaleString(),
          note: "leader dispatch",
          status: "completed",
        },
        {
          key: "analysis",
          label: "Anomalies",
          value: String(zone.latest_run.anomalies_found),
          note: zone.latest_run.anomalies_found > 0 ? "watch required" : "clear run",
          status: zone.latest_run.anomalies_found > 0 ? "warning" : "completed",
        },
      ]
      : [];
  }

  const stageMap = Object.fromEntries(liveZone.stages.map((stage) => [stage.key, stage]));
  const collectedStage = stageMap.collection;
  const abstractedStage = stageMap.preprocessing;
  const transferredStage = stageMap.transfer;
  const anomaliesStage = stageMap.analysis;

  return [
    {
      key: "collection",
      label: "Collected",
      value:
        collectedStage?.status === "pending"
          ? "Pending"
          : collectedStage.metric_display || "Live",
      note: collectedStage?.detail || "source intake",
      status: collectedStage?.status || "pending",
    },
    {
      key: "preprocessing",
      label: "Abstracted",
      value:
        abstractedStage?.status === "pending"
          ? "Pending"
          : abstractedStage.metric_display || "Live",
      note: abstractedStage?.detail || "privacy sealed",
      status: abstractedStage?.status || "pending",
    },
    {
      key: "transfer",
      label: "Transferred",
      value:
        transferredStage?.status === "pending"
          ? "Pending"
          : transferredStage.metric_display || "Live",
      note: transferredStage?.detail || "leader dispatch",
      status: transferredStage?.status || "pending",
    },
    {
      key: "analysis",
      label: "Anomalies",
      value:
        anomaliesStage?.status === "pending"
          ? "Pending"
          : anomaliesStage.metric_display || String(liveZone.anomalies_found),
      note: anomaliesStage?.detail || "policy scoring",
      status: anomaliesStage?.status || "pending",
    },
  ];
}

function getPreferredSimulationView(workspace) {
  if (!workspace?.available_views) {
    return "global";
  }
  const preferredKeys = ["operations", "global", "analysis", workspace.home_view];
  return (
    preferredKeys.find((key) =>
      workspace.available_views.some((view) => view.key === key),
    ) || workspace.available_views[0]?.key || "global"
  );
}

function getSimulationAggregatorZone(zones) {
  return zones.find((zone) => zone.region === "Europe") || zones[zones.length - 1] || null;
}

function getFallbackSimulationRunSummary(zone) {
  if (zone.latest_run) {
    return {
      batch_label: zone.latest_run.batch_label,
      collected_records: zone.latest_run.collected_records,
      redacted_records: zone.latest_run.redacted_records,
      transmitted_packets: zone.latest_run.transmitted_packets,
      anomalies_found: zone.latest_run.anomalies_found,
      integrity_score: zone.latest_run.integrity_score,
    };
  }

  const collectedRecords = 5600 + zone.id * 340;
  const redactedRecords = Math.max(0, collectedRecords - (180 + zone.id * 14));
  const transmittedPackets = Math.max(0, redactedRecords - (28 + zone.id * 5));
  const anomaliesFound = zone.agents.some((agent) => agent.status === "degraded")
    ? 1
    : zone.id % 3 === 0
      ? 1
      : 0;

  return {
    batch_label: `live-${zone.code}-${String(zone.id).padStart(2, "0")}`,
    collected_records: collectedRecords,
    redacted_records: redactedRecords,
    transmitted_packets: transmittedPackets,
    anomalies_found: anomaliesFound,
    integrity_score: zone.integrity_score,
  };
}

function getClientStageRuntimeCopy(stageKey, zone, runSummary, transferTarget) {
  if (stageKey === "collection") {
    return {
      detail: `Ingesting ${runSummary.collected_records.toLocaleString()} protected records from ${zone.label}.`,
      metricDisplay: `${runSummary.collected_records.toLocaleString()} records`,
      finalStatus: "completed",
    };
  }

  if (stageKey === "preprocessing") {
    return {
      detail: `Abstracting ${runSummary.redacted_records.toLocaleString()} sensitive fields before downstream scoring.`,
      metricDisplay: `${runSummary.redacted_records.toLocaleString()} sealed`,
      finalStatus: "completed",
    };
  }

  if (stageKey === "analysis") {
    return {
      detail:
        runSummary.anomalies_found > 0
          ? `Flagging ${runSummary.anomalies_found} anomaly candidates for policy review.`
          : "Policy scoring complete with no anomaly escalation.",
      metricDisplay: `${runSummary.anomalies_found} anomalies`,
      finalStatus: runSummary.anomalies_found > 0 ? "warning" : "completed",
    };
  }

  if (stageKey === "validation") {
    return {
      detail: `Checksum validation sealed the batch at ${runSummary.integrity_score}% integrity.`,
      metricDisplay: `${runSummary.integrity_score}% integrity`,
      finalStatus: runSummary.anomalies_found > 0 ? "warning" : "completed",
    };
  }

  if (transferTarget) {
    return {
      detail: `Dispatching ${runSummary.transmitted_packets.toLocaleString()} sealed packets to ${transferTarget.label}.`,
      metricDisplay: `${runSummary.transmitted_packets.toLocaleString()} packets`,
      finalStatus: "completed",
    };
  }

  return {
    detail: `Aggregating inbound sealed packets at ${zone.label} and confirming residency controls.`,
    metricDisplay: `${runSummary.transmitted_packets.toLocaleString()} packets`,
    finalStatus: "completed",
  };
}

function buildClientSimulationRun(dashboard) {
  const startedAt = new Date().toISOString();
  const runId = `local-${Date.now().toString(36)}`;
  const zones = dashboard.zones || [];
  const aggregatorZone = getSimulationAggregatorZone(zones);
  const mapFlows = [];

  const zoneProgress = zones.map((zone) => {
    const runSummary = getFallbackSimulationRunSummary(zone);
    const transferTarget =
      aggregatorZone && aggregatorZone.id !== zone.id ? aggregatorZone : null;
    const currentLeader =
      zone.agents.find((agent) => agent.is_leader) ||
      zone.agents.find((agent) => agent.role === "data-transfer") ||
      zone.agents[zone.agents.length - 1] ||
      zone.agents[0];
    const targetLeader =
      zone.agents.find((agent) => agent.role === "data-transfer") || currentLeader;
    const leaderChanged = Boolean(currentLeader && targetLeader && currentLeader.id !== targetLeader.id);

    const stages = clientSimulationStageBlueprints.map((blueprint, index) => {
      const agent =
        zone.agents.find((candidate) => candidate.role === blueprint.role) ||
        zone.agents[index] ||
        targetLeader ||
        currentLeader;
      const runtimeCopy = getClientStageRuntimeCopy(
        blueprint.key,
        zone,
        runSummary,
        transferTarget,
      );

      return {
        key: blueprint.key,
        label: blueprint.label,
        role: blueprint.role,
        note: blueprint.note,
        detail: runtimeCopy.detail,
        metric_display: runtimeCopy.metricDisplay,
        final_status: runtimeCopy.finalStatus,
        status: "pending",
        agent_id: agent.id,
        agent_label: agent.label,
        agent_status: agent.status,
        security_clearance: agent.security_clearance,
        encryption_state: agent.encryption_state,
        checksum_state: agent.checksum_state,
        abstraction_level: agent.abstraction_level,
        is_leader: Boolean(targetLeader && agent.id === targetLeader.id),
        started_at: null,
        completed_at: null,
      };
    });

    if (
      transferTarget &&
      zone.latitude != null &&
      zone.longitude != null &&
      transferTarget.latitude != null &&
      transferTarget.longitude != null
    ) {
      mapFlows.push({
        id: `${zone.code}->${transferTarget.code}`,
        kind: "sealed-transfer",
        status: "pending",
        source_zone_id: zone.id,
        source_zone_label: zone.label,
        source_site_code: zone.site_code || zone.code,
        source_site_label: zone.site_label || zone.label,
        source_latitude: zone.latitude,
        source_longitude: zone.longitude,
        target_zone_id: transferTarget.id,
        target_zone_label: transferTarget.label,
        target_site_code: transferTarget.site_code || transferTarget.code,
        target_site_label: transferTarget.site_label || transferTarget.label,
        target_latitude: transferTarget.latitude,
        target_longitude: transferTarget.longitude,
        packet_count: runSummary.transmitted_packets,
        started_at: null,
        completed_at: null,
      });
    }

    return {
      zone_id: zone.id,
      zone_code: zone.code,
      zone_label: zone.label,
      city: zone.city,
      country: zone.country,
      site_label: zone.site_label,
      region: zone.region,
      latitude: zone.latitude,
      longitude: zone.longitude,
      status: "pending",
      active_stage_key: null,
      latest_message: "Awaiting live simulation dispatch.",
      leader_label: currentLeader?.label || zone.leader_label || zone.label,
      batch_label: runSummary.batch_label,
      integrity_score: zone.integrity_score,
      secure_transfer_rate: zone.secure_transfer_rate,
      anomalies_found: 0,
      transmitted_packets: 0,
      leader_changed: leaderChanged,
      target_leader_label: targetLeader?.label || zone.leader_label || zone.label,
      target_integrity_score: runSummary.integrity_score,
      target_secure_transfer_rate: zone.secure_transfer_rate,
      run_summary: runSummary,
      stages,
    };
  });

  return {
    id: runId,
    status: "pending",
    started_at: startedAt,
    completed_at: null,
    total_zones: zoneProgress.length,
    completed_zones: 0,
    generated_at: startedAt,
    error_message: null,
    timeline_events: [],
    map_flows: mapFlows,
    zone_progress: zoneProgress,
    event_counter: 0,
  };
}

function cloneClientSimulationRun(simulationRun) {
  return {
    ...simulationRun,
    timeline_events: simulationRun.timeline_events.map((event) => ({ ...event })),
    map_flows: simulationRun.map_flows.map((flow) => ({ ...flow })),
    zone_progress: simulationRun.zone_progress.map((zone) => ({
      ...zone,
      stages: zone.stages.map((stage) => ({ ...stage })),
    })),
  };
}

function findSimulationStage(zone, stageKey) {
  return zone.stages.find((stage) => stage.key === stageKey);
}

function appendClientSimulationEvent(run, zone, stage, stageKey, phase, createdAt) {
  const nextCounter = run.event_counter + 1;
  run.event_counter = nextCounter;
  run.timeline_events.unshift({
    id: `${run.id}-${String(nextCounter).padStart(3, "0")}`,
    zone_id: zone.zone_id,
    zone_label: zone.zone_label,
    stage_key: stageKey,
    event_type: `stage-${phase}`,
    severity:
      phase === "completed" && stage.final_status === "warning" ? "warning" : "info",
    message:
      phase === "started"
        ? `${zone.zone_label} engaged ${stage.label}.`
        : stage.detail,
    created_at: createdAt,
  });
  run.timeline_events = run.timeline_events.slice(0, 40);
}

function startClientSimulationStage(simulationRun, zoneId, stageKey, createdAt) {
  const nextRun = cloneClientSimulationRun(simulationRun);
  nextRun.status = "running";
  nextRun.generated_at = createdAt;

  const zone = nextRun.zone_progress.find((entry) => entry.zone_id === zoneId);
  if (!zone) {
    return nextRun;
  }

  const stage = findSimulationStage(zone, stageKey);
  if (!stage) {
    return nextRun;
  }

  stage.status = "active";
  stage.started_at = createdAt;
  zone.status = "active";
  zone.active_stage_key = stageKey;
  zone.latest_message = stage.detail;

  if (stage.is_leader) {
    zone.leader_label = zone.target_leader_label;
  }

  if (stageKey === "transfer") {
    const flow = nextRun.map_flows.find((entry) => entry.source_zone_id === zoneId);
    if (flow) {
      flow.status = "active";
      flow.started_at = createdAt;
    }
  }

  appendClientSimulationEvent(nextRun, zone, stage, stageKey, "started", createdAt);
  return nextRun;
}

function completeClientSimulationStage(simulationRun, zoneId, stageKey, createdAt) {
  const nextRun = cloneClientSimulationRun(simulationRun);
  nextRun.generated_at = createdAt;

  const zone = nextRun.zone_progress.find((entry) => entry.zone_id === zoneId);
  if (!zone) {
    return nextRun;
  }

  const stage = findSimulationStage(zone, stageKey);
  if (!stage) {
    return nextRun;
  }

  stage.status = stage.final_status;
  stage.completed_at = createdAt;
  zone.latest_message = stage.detail;

  if (stageKey === "analysis") {
    zone.anomalies_found = zone.run_summary.anomalies_found;
  }

  if (stageKey === "validation") {
    zone.integrity_score = zone.target_integrity_score;
  }

  if (stageKey === "transfer") {
    zone.transmitted_packets = zone.run_summary.transmitted_packets;
    zone.secure_transfer_rate = zone.target_secure_transfer_rate;
    nextRun.completed_zones += 1;

    const flow = nextRun.map_flows.find((entry) => entry.source_zone_id === zoneId);
    if (flow) {
      flow.status = "completed";
      flow.completed_at = createdAt;
    }
  }

  appendClientSimulationEvent(nextRun, zone, stage, stageKey, "completed", createdAt);
  return nextRun;
}

function finalizeClientSimulationRun(simulationRun, completedAt) {
  const nextRun = cloneClientSimulationRun(simulationRun);
  nextRun.status = "completed";
  nextRun.completed_at = completedAt;
  nextRun.completed_zones = nextRun.total_zones;
  nextRun.generated_at = completedAt;

  nextRun.zone_progress.forEach((zone) => {
    zone.active_stage_key = null;
    zone.leader_label = zone.target_leader_label;
    zone.status =
      zone.leader_changed || zone.stages.some((stage) => stage.final_status === "warning")
        ? "warning"
        : "completed";
  });

  return nextRun;
}

function LoginView({
  authForm,
  setAuthForm,
  authPending,
  error,
  onSubmit,
  onPreset,
}) {
  const groupedAccounts = loginRoleProfiles.map((profile) => ({
    ...profile,
    accounts: demoUsers.filter((user) => user.role === profile.role),
  }));

  return (
    <main className="app-shell login-shell">
      <section className="login-layout">
        <div className="login-copy-card">
          <span className="eyebrow">Integrity Mesh Control Plane</span>
          <h1>Secure visibility for multi-zone government workflows.</h1>
          <p>
            This prototype now runs with role-based login, role-scoped zone visibility,
            masked sensitive-record views, and reviewer-gated approval for temporary raw access.
          </p>

          <div className="login-feature-list">
            <div className="login-feature">
              <strong>Masked by default</strong>
              <p>Most roles see abstracted identities instead of raw subject details.</p>
            </div>
            <div className="login-feature">
              <strong>Role-scoped access</strong>
              <p>Operators and analysts only see the zones assigned to them.</p>
            </div>
            <div className="login-feature">
              <strong>Audited actions</strong>
              <p>Login, dashboard reads, record views, and simulation control are logged.</p>
            </div>
            <div className="login-feature">
              <strong>Role-gated approval</strong>
              <p>Only the security role can approve, reject, or revoke temporary unmask requests.</p>
            </div>
          </div>

          <div className="login-role-grid">
            {loginRoleProfiles.map((profile) => (
              <div key={profile.role} className="login-role-card">
                <div className="login-role-head">
                  <strong>{formatRoleName(profile.role)}</strong>
                  <span className="mini-badge">
                    {profile.role === "security_officer"
                      ? "Approver"
                      : profile.role === "zone_operator" || profile.role === "analyst"
                        ? "Requester"
                        : "Observer"}
                  </span>
                </div>
                <p>{profile.description}</p>
                <small>{profile.approvalAuthority}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="login-panel">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Sign In</span>
              <h3>Choose a seeded account by role</h3>
            </div>
          </div>

          <form className="login-form" onSubmit={onSubmit}>
            <label className="form-field">
              <span>Username</span>
              <input
                className="form-input"
                value={authForm.username}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, username: event.target.value }))
                }
                placeholder="security"
                autoComplete="username"
              />
            </label>

            <label className="form-field">
              <span>Password</span>
              <input
                className="form-input"
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="shield123"
                autoComplete="current-password"
              />
            </label>

            {error ? <div className="login-error">{error}</div> : null}

            <button className="primary-button login-button" disabled={authPending}>
              {authPending ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div className="credential-groups">
            {groupedAccounts.map((group) => (
              <div key={group.role} className="credential-group">
                <div className="credential-group-head">
                  <div>
                    <span className="credential-role">{formatRoleName(group.role)}</span>
                    <strong>{group.loginPurpose}</strong>
                  </div>
                  <span className="mini-badge accent">
                    {group.role === "security_officer"
                      ? "Approval role"
                      : group.role === "zone_operator" || group.role === "analyst"
                        ? "Request role"
                        : "View role"}
                  </span>
                </div>
                <p className="credential-group-copy">{group.approvalAuthority}</p>
                <div className="credential-grid">
                  {group.accounts.map((user) => (
                    <button
                      key={user.username}
                      type="button"
                      className="credential-card"
                      onClick={() => onPreset(user)}
                    >
                      <div>
                        <span className="credential-role">{formatRoleName(user.role)}</span>
                        <strong>{user.label}</strong>
                      </div>
                      <p>{user.note}</p>
                      <small>
                        {user.username} / {user.password}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [token, setToken] = useState(() => window.localStorage.getItem(STORAGE_KEY) || "");
  const [simulationHistory, setSimulationHistory] = useState(() => loadStoredSimulationHistory());
  const [dashboard, setDashboard] = useState(null);
  const [simulationRun, setSimulationRun] = useState(null);
  const [simulationPending, setSimulationPending] = useState(false);
  const [simulationMapOpen, setSimulationMapOpen] = useState(false);
  const [records, setRecords] = useState({ masked_view: true, visible_count: 0, records: [] });
  const [accessRequests, setAccessRequests] = useState({ requests: [] });
  const [auditLogs, setAuditLogs] = useState({ logs: [] });
  const [userRoster, setUserRoster] = useState({ users: [] });
  const [loading, setLoading] = useState(Boolean(token));
  const [updating, setUpdating] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("global");
  const [selectedZoneId, setSelectedZoneId] = useState("all");
  const [requestComposer, setRequestComposer] = useState({
    recordId: null,
    justification: "",
    attempted: false,
  });
  const [reviewComposer, setReviewComposer] = useState({
    requestId: null,
    action: "approve",
    reviewNote: "",
    durationHours: 4,
    attempted: false,
  });
  const [authForm, setAuthForm] = useState({
    username: "security",
    password: "shield123",
  });
  const simulationStreamControllerRef = useRef(null);
  const simulationStreamRunIdRef = useRef("");
  const localSimulationGenerationRef = useRef(0);

  async function apiFetch(url, options = {}, authToken = token) {
    const headers = new Headers(options.headers || {});
    if (!headers.has("Content-Type") && options.body) {
      headers.set("Content-Type", "application/json");
    }
    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }

    const response = await fetch(buildApiUrl(url), { ...options, headers });
    if (response.status === 401 && authToken) {
      const authError = new Error("Session expired. Please sign in again.");
      authError.code = 401;
      throw authError;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const requestError = new Error(buildApiErrorMessage(payload, response.status));
      requestError.code = response.status;
      throw requestError;
    }
    return response.json();
  }

  function disconnectSimulationStream() {
    if (simulationStreamControllerRef.current) {
      simulationStreamControllerRef.current.abort();
      simulationStreamControllerRef.current = null;
    }
    simulationStreamRunIdRef.current = "";
  }

  function cancelLocalSimulation() {
    localSimulationGenerationRef.current += 1;
  }

  function getLocalSimulationTimings() {
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return {
        preflightMs: 120,
        zoneStartStaggerMs: 90,
        stageHoldMs: 180,
        zoneCompleteStaggerMs: 80,
        stageGapMs: 120,
      };
    }

    return {
      preflightMs: 420,
      zoneStartStaggerMs: 260,
      stageHoldMs: 920,
      zoneCompleteStaggerMs: 240,
      stageGapMs: 420,
    };
  }

  function waitForLocalSimulationStep(durationMs, generation) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        resolve(localSimulationGenerationRef.current === generation);
      }, durationMs);
    });
  }

  async function runClientSimulationPreview(sourceDashboard) {
    const generation = localSimulationGenerationRef.current + 1;
    localSimulationGenerationRef.current = generation;

    let nextRun = buildClientSimulationRun(sourceDashboard);
    setSimulationRun(nextRun);

    const timings = getLocalSimulationTimings();
    const zoneIds = nextRun.zone_progress.map((zone) => zone.zone_id);

    if (!(await waitForLocalSimulationStep(timings.preflightMs, generation))) {
      return null;
    }

    for (const stageBlueprint of clientSimulationStageBlueprints) {
      for (const zoneId of zoneIds) {
        nextRun = startClientSimulationStage(
          nextRun,
          zoneId,
          stageBlueprint.key,
          new Date().toISOString(),
        );
        setSimulationRun(nextRun);

        if (!(await waitForLocalSimulationStep(timings.zoneStartStaggerMs, generation))) {
          return null;
        }
      }

      if (!(await waitForLocalSimulationStep(timings.stageHoldMs, generation))) {
        return null;
      }

      for (const zoneId of zoneIds) {
        nextRun = completeClientSimulationStage(
          nextRun,
          zoneId,
          stageBlueprint.key,
          new Date().toISOString(),
        );
        setSimulationRun(nextRun);

        if (!(await waitForLocalSimulationStep(timings.zoneCompleteStaggerMs, generation))) {
          return null;
        }
      }

      if (!(await waitForLocalSimulationStep(timings.stageGapMs, generation))) {
        return null;
      }
    }

    nextRun = finalizeClientSimulationRun(nextRun, new Date().toISOString());
    setSimulationRun(nextRun);
    return localSimulationGenerationRef.current === generation ? nextRun : null;
  }

  function applySimulationStreamPayload(nextRun, eventName) {
    setSimulationRun(nextRun);

    if (eventName === "failed") {
      setError(nextRun.error_message || "Live simulation run failed.");
    }
  }

  async function connectSimulationStream(runId, authToken = token) {
    if (!runId) {
      return;
    }
    if (
      simulationStreamRunIdRef.current === runId &&
      simulationStreamControllerRef.current
    ) {
      return;
    }

    disconnectSimulationStream();
    const controller = new AbortController();
    simulationStreamControllerRef.current = controller;
    simulationStreamRunIdRef.current = runId;

    try {
      const response = await fetch(buildApiUrl(`/api/simulation/runs/${runId}/stream`), {
        headers: authToken
          ? {
            Authorization: `Bearer ${authToken}`,
          }
          : undefined,
        signal: controller.signal,
      });

      if (response.status === 401 && authToken) {
        const authError = new Error("Session expired. Please sign in again.");
        authError.code = 401;
        throw authError;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(buildApiErrorMessage(payload, response.status));
      }
      if (!response.body) {
        throw new Error("Simulation stream unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          if (!block.trim() || block.startsWith(":")) {
            continue;
          }
          const parsed = parseSimulationEventBlock(block);
          if (!parsed) {
            continue;
          }

          applySimulationStreamPayload(parsed.data, parsed.event);

          if (parsed.event === "completed") {
            await loadWorkspace(authToken, { showLoader: false });
            setSimulationPending(false);
          }
          if (parsed.event === "failed") {
            setSimulationPending(false);
          }
        }
      }
    } catch (requestError) {
      if (requestError.name === "AbortError") {
        return;
      }
      if (requestError.code === 401) {
        clearSession(requestError.message);
        return;
      }
      setError(requestError.message);
    } finally {
      if (simulationStreamControllerRef.current === controller) {
        simulationStreamControllerRef.current = null;
        simulationStreamRunIdRef.current = "";
      }
      setSimulationPending(false);
    }
  }

  function clearSession(nextError = "") {
    cancelLocalSimulation();
    disconnectSimulationStream();
    window.localStorage.removeItem(STORAGE_KEY);
    setToken("");
    setDashboard(null);
    setSimulationRun(null);
    setSimulationPending(false);
    setSimulationMapOpen(false);
    setRecords({ masked_view: true, visible_count: 0, records: [] });
    setAccessRequests({ requests: [] });
    setAuditLogs({ logs: [] });
    setUserRoster({ users: [] });
    setActiveView("global");
    setSelectedZoneId("all");
    setRequestComposer({ recordId: null, justification: "", attempted: false });
    setReviewComposer({
      requestId: null,
      action: "approve",
      reviewNote: "",
      durationHours: 4,
      attempted: false,
    });
    setLoading(false);
    setError(nextError);
  }

  async function loadWorkspace(activeToken, { showLoader = true, zoneFilter = selectedZoneId } = {}) {
    if (showLoader) {
      setLoading(true);
    }

    try {
      const recordsQuery = zoneFilter !== "all" ? `?zone_id=${zoneFilter}` : "";
      const [dashboardData, recordsData, requestsData] = await Promise.all([
        apiFetch("/api/dashboard", {}, activeToken),
        apiFetch(`/api/sensitive-records${recordsQuery}`, {}, activeToken),
        apiFetch("/api/access-requests", {}, activeToken),
      ]);

      const [auditData, rosterData] = await Promise.all([
        dashboardData.security_context.can_view_audit_logs
          ? apiFetch("/api/audit-logs", {}, activeToken)
          : Promise.resolve({ logs: [] }),
        dashboardData.security_context.can_manage_users
          ? apiFetch("/api/users", {}, activeToken)
          : Promise.resolve({ users: [] }),
      ]);
      let activeRun = null;
      if (LIVE_SIMULATION_API_ENABLED && dashboardData.security_context.can_run_simulation) {
        try {
          activeRun = await apiFetch("/api/simulation/runs/active", {}, activeToken);
        } catch (requestError) {
          if (requestError.code !== 404) {
            throw requestError;
          }
        }
      }

      setDashboard(dashboardData);
      setRecords(recordsData);
      setAccessRequests(requestsData);
      setAuditLogs(auditData);
      setUserRoster(rosterData);
      setSimulationRun((current) => {
        if (activeRun) {
          return activeRun;
        }
        if (current?.status === "completed" || current?.status === "failed") {
          return current;
        }
        return null;
      });

      if (
        activeRun &&
        activeRun.status !== "completed" &&
        activeRun.status !== "failed"
      ) {
        void connectSimulationStream(activeRun.id, activeToken);
      }
      setError("");
    } catch (requestError) {
      if (requestError.code === 401) {
        clearSession(requestError.message);
        return;
      }
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    async function hydrate() {
      if (!cancelled) {
        await loadWorkspace(token);
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [token, selectedZoneId]);

  useEffect(() => {
    return () => {
      cancelLocalSimulation();
      disconnectSimulationStream();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      SIMULATION_HISTORY_KEY,
      JSON.stringify(simulationHistory.slice(0, 12)),
    );
  }, [simulationHistory]);

  useEffect(() => {
    if (!simulationMapOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setSimulationMapOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [simulationMapOpen]);

  useEffect(() => {
    if (!dashboard?.workspace) {
      return;
    }
    const availableKeys = dashboard.workspace.available_views.map((view) => view.key);
    setActiveView((current) =>
      availableKeys.includes(current) ? current : dashboard.workspace.home_view,
    );
  }, [dashboard]);

  useEffect(() => {
    if (!dashboard || !simulationRun) {
      return;
    }

    if (simulationRun.status !== "completed" && simulationRun.status !== "failed") {
      return;
    }

    const historyEntry = buildSimulationHistoryEntry(simulationRun, dashboard);
    setSimulationHistory((current) => {
      if (current.some((entry) => entry.id === historyEntry.id)) {
        return current;
      }

      return [historyEntry, ...current].slice(0, 12);
    });
  }, [dashboard, simulationRun]);

  async function handleLogin(event) {
    event.preventDefault();
    setAuthPending(true);

    try {
      const data = await apiFetch(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify(authForm),
        },
        "",
      );

      window.localStorage.setItem(STORAGE_KEY, data.access_token);
      setToken(data.access_token);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setAuthPending(false);
    }
  }

  async function handleLogout() {
    try {
      if (token) {
        await apiFetch("/api/auth/logout", { method: "POST" });
      }
    } catch (requestError) {
      // Ignore logout errors and still clear local session.
    } finally {
      clearSession("");
    }
  }

  async function handleSimulationTick() {
    try {
      setSimulationPending(true);
      setError("");
      if (LIVE_SIMULATION_API_ENABLED) {
        const run = await apiFetch("/api/simulation/runs", { method: "POST" });
        setSimulationRun(run);
        void connectSimulationStream(run.id, token);
      } else {
        setActiveView(getPreferredSimulationView(dashboard.workspace));
        const previewRun = await runClientSimulationPreview(dashboard);
        if (!previewRun) {
          return;
        }
        await apiFetch("/api/simulation/tick", { method: "POST" });
        await loadWorkspace(token, { showLoader: false });
      }
    } catch (requestError) {
      if (requestError.code === 401) {
        clearSession(requestError.message);
        return;
      }
      setSimulationRun((current) =>
        current && !LIVE_SIMULATION_API_ENABLED
          ? {
            ...current,
            status: "failed",
            error_message: requestError.message,
            completed_at: new Date().toISOString(),
          }
          : current,
      );
      setError(requestError.message);
    } finally {
      setSimulationPending(false);
    }
  }

  async function requestAIAdvice({ activeView: viewKey, prompt: nextPrompt, conversation = [] }) {
    try {
      return await apiFetch("/api/ai/advisory", {
        method: "POST",
        body: JSON.stringify({
          active_view: viewKey,
          prompt: nextPrompt,
          conversation,
        }),
      });
    } catch (requestError) {
      if (requestError.code === 401) {
        clearSession(requestError.message);
      }
      throw requestError;
    }
  }

  async function handleRequestAccess(recordId) {
    setRequestComposer((current) => ({ ...current, attempted: true }));
    const justification = requestComposer.justification.trim();
    if (!justification) {
      setError("Add a justification before requesting temporary raw access.");
      return;
    }
    if (justification.length < MIN_REQUEST_JUSTIFICATION_LENGTH) {
      setError(
        `Justification must be at least ${MIN_REQUEST_JUSTIFICATION_LENGTH} characters.`,
      );
      return;
    }

    try {
      setUpdating(true);
      await apiFetch("/api/access-requests", {
        method: "POST",
        body: JSON.stringify({
          record_id: recordId,
          justification,
        }),
      });
      setRequestComposer({ recordId: null, justification: "", attempted: false });
      await loadWorkspace(token, { showLoader: false });
    } catch (requestError) {
      if (requestError.code === 401) {
        clearSession(requestError.message);
        return;
      }
      setError(requestError.message);
    } finally {
      setUpdating(false);
    }
  }

  async function handleReviewRequest(requestId, action) {
    setReviewComposer((current) => ({ ...current, attempted: true }));
    const reviewNote = reviewComposer.reviewNote.trim();
    if (!reviewNote) {
      setError("Add a reviewer note before submitting the decision.");
      return;
    }
    if (reviewNote.length < MIN_REVIEW_NOTE_LENGTH) {
      setError(`Reviewer note must be at least ${MIN_REVIEW_NOTE_LENGTH} characters.`);
      return;
    }

    try {
      setUpdating(true);
      const body =
        action === "approve"
          ? {
            review_note: reviewNote,
            duration_hours: Number(reviewComposer.durationHours) || 4,
          }
          : { review_note: reviewNote };

      await apiFetch(`/api/access-requests/${requestId}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setReviewComposer({
        requestId: null,
        action: "approve",
        reviewNote: "",
        durationHours: 4,
        attempted: false,
      });
      await loadWorkspace(token, { showLoader: false });
    } catch (requestError) {
      if (requestError.code === 401) {
        clearSession(requestError.message);
        return;
      }
      setError(requestError.message);
    } finally {
      setUpdating(false);
    }
  }

  if (!token) {
    return (
      <LoginView
        authForm={authForm}
        setAuthForm={setAuthForm}
        authPending={authPending}
        error={error}
        onSubmit={handleLogin}
        onPreset={(user) =>
          setAuthForm({
            username: user.username,
            password: user.password,
          })
        }
      />
    );
  }

  if (loading && !dashboard) {
    return (
      <main className="app-shell loading-shell">
        <div className="loading-panel">
          <span className="eyebrow">Integrity Mesh</span>
          <h1>Rebuilding your secured workspace...</h1>
          <p>Loading role policy, visible zones, masked records, and audit trails.</p>
        </div>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="app-shell loading-shell">
        <div className="loading-panel error-panel">
          <span className="eyebrow">Control Plane Error</span>
          <h1>Workspace unavailable</h1>
          <p>{error || "Unable to load the secured workspace."}</p>
          <button className="primary-button" onClick={() => loadWorkspace(token)}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const processedRecords =
    dashboard.summary.redacted_records + dashboard.summary.transmitted_packets;
  const protectedRatio =
    processedRecords === 0
      ? 0
      : Math.round((dashboard.summary.redacted_records / processedRecords) * 100);
  const watchZones = dashboard.zones.filter(
    (zone) =>
      zone.agents.some((agent) => agent.status === "degraded") ||
      (zone.latest_run?.anomalies_found ?? 0) > 0,
  ).length;
  const warningEvents = dashboard.global_events.filter(
    (event) => event.severity !== "info",
  ).length;
  const currentUser = dashboard.viewer;
  const activeWorkspace = getActiveWorkspace(dashboard.workspace, activeView);
  const heroContent = getHeroContent(activeView, dashboard.workspace, dashboard.ai_readiness);
  const locationWarnings = dashboard.global_locations.reduce(
    (total, location) => total + location.warning_events,
    0,
  );
  const showLandscape =
    activeView === "global" ||
    activeView === "operations" ||
    activeView === "analysis" ||
    activeView === "engineering";
  const showSecurityPanels = activeView === "security" || activeView === "analysis";
  const showPosture = showSecurityPanels || activeView === "compliance";
  const showOversight =
    activeView === "security" || activeView === "compliance" || activeView === "engineering";
  const showCommand =
    activeView === "global" || activeView === "operations" || activeView === "engineering";
  const showZones = activeView === "global" || activeView === "operations";
  const showThreatsPage = activeView === "threats";
  const showRedTeamPage = activeView === "redteam";
  const showSolutionsPage = activeView === "solutions";
  const showAIBriefing =
    activeView === "engineering" || activeView === "analysis" || activeView === "security";
  const simulationActive =
    simulationPending ||
    (simulationRun &&
      simulationRun.status !== "completed" &&
      simulationRun.status !== "failed");
  const simulationProgress = getSimulationProgressPercent(simulationRun);
  const activeSimulationZones =
    simulationRun?.zone_progress.filter((zone) => zone.status === "active").length || 0;
  const monitoringHealthZones = dashboard.zones.map((zone) => {
    const liveZone = getLiveZoneProgress(simulationRun, zone.id);
    const integrityScore = liveZone ? liveZone.integrity_score : zone.integrity_score;
    const transferRate = liveZone ? liveZone.secure_transfer_rate : zone.secure_transfer_rate;
    const anomalyCount = liveZone
      ? liveZone.anomalies_found
      : zone.latest_run?.anomalies_found ?? 0;
    const degradedCount = zone.agents.filter((agent) => agent.status === "degraded").length;
    const anomalyShield = Math.max(18, 100 - anomalyCount * 28 - degradedCount * 14);
    const tone =
      liveZone?.status === "active"
        ? "live"
        : liveZone?.status === "warning" || degradedCount > 0 || anomalyCount > 0
          ? "warning"
          : "online";

    return {
      id: zone.id,
      code: zone.code,
      tone,
      leaderLabel: liveZone ? liveZone.leader_label : zone.leader_label,
      integrityScore,
      transferRate,
      anomalyShield,
      anomalyCount,
    };
  });
  const monitoringAlerts = [
    ...(simulationRun?.timeline_events || []),
    ...dashboard.global_events,
    ...dashboard.zones.flatMap((zone) =>
      zone.recent_events.map((event) => ({
        ...event,
        zone_label: zone.label,
      })),
    ),
  ]
    .filter(
      (event, index, allEvents) =>
        allEvents.findIndex(
          (candidate) =>
            candidate.id === event.id &&
            candidate.message === event.message &&
            candidate.event_type === event.event_type,
        ) === index,
    )
    .filter((event) => event.severity !== "info")
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, 5);
  const renderLocationCard = (location) => (
    <div key={location.id} className="location-card">
      <div className="location-card-head">
        <div className="summary-label-stack">
          <strong>{location.label}</strong>
          <span>
            {location.city}, {location.country}
          </span>
        </div>
        <span className="mini-badge">{location.region}</span>
      </div>
      <div className="location-meta">
        <small>
          {formatCoordinate(location.latitude)} / {formatCoordinate(location.longitude)}
        </small>
        <small>{location.timezone}</small>
      </div>
      <div className="location-stat-row">
        <span>{location.visible_zones} zones</span>
        <span>{location.active_systems} systems</span>
        <span>{location.warning_events} warnings</span>
      </div>
    </div>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">IM</div>
          <div>
            <span className="eyebrow">Integrity Mesh Control Plane</span>
            <h1 className="page-title">Global oversight without raw-data exposure.</h1>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="meta-pill">
            <span className="pill-label">Signed in as</span>
            <strong>{currentUser.full_name}</strong>
            <small>{roleLabel[currentUser.role] || currentUser.role}</small>
          </div>
          <div className="meta-pill">
            <span className="pill-label">Access Mode</span>
            <strong>
              {dashboard.security_context.active_unmask_grants > 0
                ? "Temporary raw access active"
                : "Masked by default"}
            </strong>
            <small>{currentUser.assigned_zones.join(" · ")}</small>
          </div>
          <div className="meta-pill">
            <span className="pill-label">Workspace</span>
            <strong>{activeWorkspace.label}</strong>
            <small>{dashboard.workspace.persona_label}</small>
          </div>
          <div className="action-cluster">
            {dashboard.security_context.can_run_simulation ? (
              <button
                className="primary-button"
                onClick={handleSimulationTick}
                disabled={simulationActive}
              >
                {simulationActive ? "Simulation Live" : "Start Live Simulation"}
              </button>
            ) : null}
            <button className="secondary-button" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      {dashboard.global_control_plane ? (
        <section className="global-control-bar">
          <div className="gcp-status">
            <span className="pill-label">Global Control Plane</span>
            <strong>{dashboard.global_control_plane.leader}</strong>
          </div>
          <div className="gcp-status">
            <span className="pill-label">Policy Engine</span>
            <strong>{dashboard.global_control_plane.policy_engine}</strong>
          </div>
          <div className="gcp-status">
            <span className="pill-label">Status</span>
            <strong className="status-active">{dashboard.global_control_plane.status}</strong>
          </div>
          <div className="gcp-status">
            <span className="pill-label">Last Sync</span>
            <strong>{formatTime(dashboard.global_control_plane.last_heartbeat)}</strong>
          </div>
        </section>
      ) : null}

      {dashboard.security_context.can_run_simulation ? (
        <section className={`simulation-runway ${simulationActive ? "is-live" : ""}`}>
          <div className="simulation-runway-copy">
            <span className="eyebrow">Live Simulation</span>
            <h3>
              {simulationRun
                ? getSimulationActiveLabel(simulationRun)
                : "Ready to animate the five-stage control track"}
            </h3>
            <p>
              {simulationRun
                ? `${simulationProgress}% complete · ${activeSimulationZones} zones active · ${simulationRun.completed_zones}/${simulationRun.total_zones} zones finished`
                : "Start a run to animate collection, abstraction, validation, transfer, and global aggregation in real time."}
            </p>
          </div>
          <div className="simulation-progress-shell" aria-hidden="true">
            <div
              className="simulation-progress-bar"
              style={{ width: `${simulationRun ? simulationProgress : 0}%` }}
            />
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="workspace-alert">
          <strong>Action blocked</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section className="workspace-switcher">
        <div className="workspace-switcher-copy">
          <span className="eyebrow">Role Workspace</span>
          <h2>{dashboard.workspace.persona_label}</h2>
          <p>{dashboard.workspace.persona_summary}</p>
        </div>
        <div className="workspace-tab-row">
          {dashboard.workspace.available_views.map((view) => (
            <button
              key={view.key}
              type="button"
              className={`workspace-tab ${activeView === view.key ? "is-active" : ""}`}
              onClick={() => setActiveView(view.key)}
            >
              <strong>{view.label}</strong>
              <span>{view.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="hero-panel">
        <div className="hero-copy-panel">
          <span className="hero-kicker">{heroContent.kicker}</span>
          <h2>{heroContent.title}</h2>
          <p className="hero-copy">{heroContent.copy}</p>

          <div className="hero-stat-grid">
            <div className="hero-stat-card">
              <span>{showAIBriefing ? "AI rollout stage" : "Protected before transfer"}</span>
              <strong>
                {showAIBriefing ? dashboard.ai_readiness.deployment_status : `${protectedRatio}%`}
              </strong>
              <small>
                {showAIBriefing
                  ? dashboard.ai_readiness.rag_status
                  : "of processed records were abstracted upstream"}
              </small>
            </div>
            <div className="hero-stat-card">
              <span>{showLandscape ? "Systems in scope" : "Zones on watch"}</span>
              <strong>{showLandscape ? dashboard.systems.length : watchZones}</strong>
              <small>
                {showLandscape
                  ? "multi-system visibility available in this workspace"
                  : "regions with degraded agents or recent anomalies"}
              </small>
            </div>
            <div className="hero-stat-card">
              <span>{showLandscape ? "Location alerts" : "Alerted events"}</span>
              <strong>{showLandscape ? locationWarnings : warningEvents}</strong>
              <small>
                {showLandscape
                  ? "warning signals across the visible global site map"
                  : "warning-level coordination events in the current feed"}
              </small>
            </div>
          </div>
        </div>

        <aside className="mesh-panel">
          <div className="panel-title-row">
            <div>
              <span className="eyebrow">Current Security Context</span>
              <h3>{roleLabel[currentUser.role] || currentUser.role}</h3>
            </div>
            <span className="mesh-status">
              {dashboard.security_context.active_unmask_grants > 0
                ? `${dashboard.security_context.active_unmask_grants} active grants`
                : "Masked by policy"}
            </span>
          </div>

          <div className="mesh-list">
            <div className="mesh-row">
              <div>
                <strong>Visible zones</strong>
                <span>Role and assignment scoped view</span>
              </div>
              <div className="mesh-row-meta">
                <strong>{dashboard.security_context.visible_zones}</strong>
              </div>
            </div>
            <div className="mesh-row">
              <div>
                <strong>Pending requests</strong>
                <span>Awaiting reviewer action for this user</span>
              </div>
              <div className="mesh-row-meta">
                <strong>
                  {dashboard.security_context.pending_unmask_requests}
                </strong>
              </div>
            </div>
            <div className="mesh-row">
              <div>
                <strong>Review queue</strong>
                <span>Requests waiting for approver action</span>
              </div>
              <div className="mesh-row-meta">
                <strong>
                  {dashboard.security_context.pending_unmask_reviews}
                </strong>
              </div>
            </div>
          </div>
        </aside>
      </section>

      <section className="summary-grid">
        {summaryCards.map((card) => (
          <article key={card.key} className="summary-card">
            <span className="summary-label">{card.label}</span>
            <strong className="summary-value">
              {formatValue(card.key, dashboard.summary[card.key])}
            </strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <WorkspaceAIAssistant
        activeView={activeView}
        dashboard={dashboard}
        requestAdvice={requestAIAdvice}
      />

      {showLandscape ? (
        <section className="landscape-grid">
          <article className="policy-card landscape-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">Systems In Scope</span>
                <h3>Multi-system visibility</h3>
              </div>
              <span className="activity-count">{dashboard.systems.length} systems</span>
            </div>

            <div className="landscape-list">
              {dashboard.systems.map((system) => (
                <div key={system.id} className="landscape-row">
                  <div className="summary-label-stack">
                    <strong>{system.label}</strong>
                    <span>
                      {system.category} · {system.deployment_model}
                    </span>
                  </div>
                  <div className="record-badges">
                    <span className="mini-badge">{system.visible_zones} zones</span>
                    <span className="mini-badge accent">{system.visible_sites} sites</span>
                    <span className="mini-badge access-approved">
                      {system.average_integrity}% integrity
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="policy-card landscape-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">Global Locations</span>
                <h3>Live regional simulation map</h3>
              </div>
              <span className="activity-count">
                {dashboard.global_locations.length} locations
              </span>
            </div>

            <SimulationMap
              locations={dashboard.global_locations}
              zones={dashboard.zones}
              simulationRun={simulationRun}
              onOpen={() => setSimulationMapOpen(true)}
            />

            <div className="location-grid">
              {dashboard.global_locations.map(renderLocationCard)}
            </div>
          </article>
        </section>
      ) : null}

      {activeView === "monitoring" ? (
        <section className="monitoring-grid">
          <InteractionMarketPanel dashboard={dashboard} simulationRun={simulationRun} />

          <div className="monitoring-middle-row">
            <div className="monitoring-visual-stack">
              <article className="policy-card monitoring-map-card">
                <div className="panel-title-row">
                  <div>
                    <span className="eyebrow">Global Agent Map</span>
                    <h3>Live regional agent clusters</h3>
                  </div>
                  <span className="activity-count">
                    {dashboard.summary.total_agents} plotted agents
                  </span>
                </div>
                <p className="panel-subcopy">
                  Every region shows its five-agent cluster live on the world map, with the active
                  handoff glowing from the 05 transfer leader out to the currently engaged stage.
                </p>

                <SimulationMap
                  locations={dashboard.global_locations}
                  zones={dashboard.zones}
                  simulationRun={simulationRun}
                  onOpen={() => setSimulationMapOpen(true)}
                />
              </article>

              <SimulationTrackChart
                dashboard={dashboard}
                simulationRun={simulationRun}
                historyRuns={simulationHistory}
              />
            </div>

            <article className="policy-card alert-manager-card">
              <div className="panel-title-row">
                <div>
                  <span className="eyebrow">Alert Pressure</span>
                  <h3>Interaction and integrity alerts</h3>
                </div>
                <span className="activity-count">
                  {monitoringAlerts.length} active
                </span>
              </div>
              <div className="alert-list">
                {monitoringAlerts.length > 0 ? (
                  monitoringAlerts.map((event) => (
                    <div
                      key={`${event.id}-${event.event_type}`}
                      className={`alert-item ${event.severity === "critical" ? "critical" : event.severity === "warning" ? "warning" : "info"}`}
                    >
                      <div className="alert-icon">
                        {event.severity === "critical" ? "!" : event.severity === "warning" ? "!" : "i"}
                      </div>
                      <div className="alert-body">
                        <strong>{event.agent_label || event.zone_label || "Mesh alert"}</strong>
                        <span>{event.message}</span>
                      </div>
                      <small>{formatTime(event.created_at)}</small>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <strong>No live alerts right now.</strong>
                    <p>The interaction tape is stable across the visible mesh.</p>
                  </div>
                )}
              </div>
            </article>
          </div>

          <div className="monitoring-bottom-row">
            <article className="policy-card infrastructure-health-card">
              <div className="panel-title-row">
                <div>
                  <span className="eyebrow">Cluster Status</span>
                  <h3>Regional interaction health</h3>
                </div>
              </div>
              <div className="health-grid">
                {monitoringHealthZones.map((zone) => (
                  <div key={zone.id} className={`health-node tone-${zone.tone}`}>
                    <div className="node-info">
                      <div>
                        <strong>{zone.code}</strong>
                        <small>{zone.leaderLabel}</small>
                      </div>
                      <span className={`status-indicator ${zone.tone}`}></span>
                    </div>
                    <div className="node-stacks">
                      <div className="stack-status">
                        <span>Integrity</span>
                        <div className="status-bar">
                          <div
                            className={`fill ${zone.integrityScore >= 96 ? "green" : "amber"}`}
                            style={{ width: `${zone.integrityScore}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="stack-status">
                        <span>Transfer</span>
                        <div className="status-bar">
                          <div
                            className={`fill ${zone.transferRate >= 95 ? "green" : "amber"}`}
                            style={{ width: `${zone.transferRate}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="stack-status">
                        <span>Anomaly Shield</span>
                        <div className="status-bar">
                          <div
                            className={`fill ${zone.anomalyCount > 0 ? "coral" : "green"}`}
                            style={{ width: `${zone.anomalyShield}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {showThreatsPage ? (
        <ThreatsView
          dashboard={dashboard}
          accessRequests={accessRequests}
          auditLogs={auditLogs}
          simulationRun={simulationRun}
        />
      ) : null}

      {showRedTeamPage ? (
        <RedTeamSimulatorView
          dashboard={dashboard}
          accessRequests={accessRequests}
          auditLogs={auditLogs}
          simulationRun={simulationRun}
        />
      ) : null}

      {showSolutionsPage ? (
        <SolutionsView
          dashboard={dashboard}
          accessRequests={accessRequests}
          simulationRun={simulationRun}
        />
      ) : null}

      {showAIBriefing ? (
        <AIRolloutWorkbench
          dashboard={dashboard}
          accessRequests={accessRequests}
          requestAdvice={requestAIAdvice}
        />
      ) : null}

      {showPosture ? (
        <section className="posture-grid">
          <article className="posture-card">
            <span className="summary-label">Sensitive Records</span>
            <strong className="summary-value">
              {dashboard.security_posture.total_sensitive_records}
            </strong>
            <small>records inside your visible operating scope</small>
          </article>
          <article className="posture-card">
            <span className="summary-label">Active Unmask Grants</span>
            <strong className="summary-value">
              {dashboard.security_posture.active_unmask_grants}
            </strong>
            <small>temporary raw-data windows currently active</small>
          </article>
          <article className="posture-card">
            <span className="summary-label">Pending Reviews</span>
            <strong className="summary-value">
              {dashboard.security_posture.pending_unmask_reviews}
            </strong>
            <small>requests waiting for a reviewer decision</small>
          </article>
          <article className="posture-card">
            <span className="summary-label">Denied Events 24h</span>
            <strong className="summary-value">
              {dashboard.security_posture.denied_events_24h}
            </strong>
            <small>blocked access attempts and denied actions today</small>
          </article>
          <article className="posture-card">
            <span className="summary-label">Expiring Soon</span>
            <strong className="summary-value">
              {dashboard.security_posture.expiring_soon_grants}
            </strong>
            <small>active grants nearing expiry and likely needing follow-up</small>
          </article>
          <article className="posture-card">
            <span className="summary-label">Active Sessions</span>
            <strong className="summary-value">
              {dashboard.security_posture.active_sessions}
            </strong>
            <small>concurrent signed-in sessions across the secured workspace</small>
          </article>
        </section>
      ) : null}

      {showSecurityPanels ? (
        <section className="security-grid">
          <article className="records-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">Sensitive Record View</span>
                <h3>
                  {records.masked_view
                    ? "Abstracted subject records"
                    : "Clearance-level subject records"}
                </h3>
              </div>
              <div className="panel-actions">
                <label className="select-field">
                  <span>Zone</span>
                  <select
                    className="filter-select"
                    value={selectedZoneId}
                    onChange={(event) => setSelectedZoneId(event.target.value)}
                  >
                    <option value="all">All visible zones</option>
                    {dashboard.zones.map((zone) => (
                      <option key={zone.id} value={String(zone.id)}>
                        {zone.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="activity-count">{records.visible_count} records</span>
              </div>
            </div>

            <div className="record-feed">
              {records.records.map((record) => (
                <div key={record.id} className="record-card">
                  <div className="record-card-head">
                    <div>
                      <span className="event-type">{record.pseudonym_id}</span>
                      <strong>{record.subject_name}</strong>
                      <small>
                        {record.zone_label} · {record.source_agency}
                      </small>
                    </div>
                    <div className="record-badges">
                      <span className="mini-badge">{record.classification}</span>
                      <span className="mini-badge accent">{record.redaction_state}</span>
                      <span className={`mini-badge access-${record.access_status}`}>
                        {record.access_status}
                      </span>
                    </div>
                  </div>

                  <p className="record-summary">{record.abstracted_summary}</p>

                  <div className="record-toolbar">
                    <div className="record-access-stack">
                      <span className="record-meta-label">
                        {record.is_masked ? "Masked by policy" : "Temporary raw grant active"}
                      </span>
                      <small>
                        {record.approved_until
                          ? `Approved until ${formatDate(record.approved_until)}`
                          : record.latest_request_status
                            ? `Latest request: ${record.latest_request_status}`
                            : "No temporary access request on file"}
                      </small>
                    </div>
                    {record.can_request_access && record.is_masked ? (
                      <button
                        className="secondary-button small-button"
                        onClick={() =>
                          setRequestComposer({
                            recordId: record.id,
                            justification: "",
                            attempted: false,
                          })
                        }
                      >
                        Request Unmask
                      </button>
                    ) : null}
                  </div>

                  {requestComposer.recordId === record.id ? (
                    <div className="request-composer">
                      <textarea
                        className="composer-textarea"
                        rows={3}
                        value={requestComposer.justification}
                        onChange={(event) =>
                          setRequestComposer((current) => ({
                            ...current,
                            justification: event.target.value,
                          }))
                        }
                        placeholder="Explain why raw access is needed and why the abstracted summary is insufficient."
                      />
                      <div className="composer-meta">
                        <small
                          className={
                            normalizeLength(requestComposer.justification) >=
                              MIN_REQUEST_JUSTIFICATION_LENGTH
                              ? "composer-hint is-valid"
                              : "composer-hint"
                          }
                        >
                          Minimum {MIN_REQUEST_JUSTIFICATION_LENGTH} characters for audit-ready
                          justification.
                        </small>
                        <small className="composer-count">
                          {normalizeLength(requestComposer.justification)}/
                          {MIN_REQUEST_JUSTIFICATION_LENGTH}
                        </small>
                      </div>
                      {getRequestComposerError(requestComposer) ? (
                        <small className="composer-error">
                          {getRequestComposerError(requestComposer)}
                        </small>
                      ) : null}
                      <div className="composer-actions">
                        <button
                          className="primary-button small-button"
                          onClick={() => handleRequestAccess(record.id)}
                          disabled={updating}
                        >
                          Submit Request
                        </button>
                        <button
                          className="secondary-button small-button"
                          onClick={() =>
                            setRequestComposer({
                              recordId: null,
                              justification: "",
                              attempted: false,
                            })
                          }
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="record-detail-grid">
                    <div className="record-detail">
                      <span>Gov ID</span>
                      <strong>{record.government_identifier}</strong>
                    </div>
                    <div className="record-detail">
                      <span>Phone</span>
                      <strong>{record.phone_number}</strong>
                    </div>
                    <div className="record-detail">
                      <span>Case Ref</span>
                      <strong>{record.case_reference}</strong>
                    </div>
                    <div className="record-detail">
                      <span>State</span>
                      <strong>{record.handling_status}</strong>
                    </div>
                  </div>

                  <div className="record-address">
                    <span>Address</span>
                    <strong>{record.address}</strong>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="policy-card request-queue-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">
                  {currentUser.can_review_unmask ? "Review Queue" : "Access Requests"}
                </span>
                <h3>
                  {currentUser.can_review_unmask
                    ? "Temporary unmask review workflow"
                    : "Your temporary access requests"}
                </h3>
              </div>
              <span className="activity-count">{accessRequests.requests.length} items</span>
            </div>
            <p className="panel-subcopy">
              Requesters can submit temporary unmask requests, but only{" "}
              {formatRoleName(dashboard.approval_policy.required_reviewer_role)} accounts can
              approve or revoke them.
            </p>

            <div className="request-queue">
              {accessRequests.requests.slice(0, 10).map((request) => (
                <div key={request.id} className={`request-row status-${request.status}`}>
                  <div className="request-row-head">
                    <div>
                      <strong>{request.record_pseudonym}</strong>
                      <span>
                        {request.zone_label} · {formatRoleName(request.requester_role)} ·{" "}
                        {request.requester_username}
                      </span>
                    </div>
                    <div className="record-badges">
                      <span className="mini-badge">{request.status}</span>
                      {request.expires_at ? (
                        <span className="mini-badge accent">
                          until {formatTime(request.expires_at)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="request-copy">{request.justification}</p>
                  <small className="request-meta">
                    Approval route: {formatRoleName(request.requester_role)} to{" "}
                    {formatRoleName(request.required_reviewer_role)}
                  </small>
                  {request.reviewer_username ? (
                    <small className="request-meta">
                      Reviewed by {request.reviewer_username} ({formatRoleName(request.reviewer_role)})
                    </small>
                  ) : null}
                  {request.review_note ? (
                    <small className="request-note">Reviewer note: {request.review_note}</small>
                  ) : null}
                  {request.review_block_reason ? (
                    <small className="request-warning">{request.review_block_reason}</small>
                  ) : null}

                  {request.is_actionable || request.is_revokable ? (
                    <div className="request-actions">
                      <button
                        className="secondary-button small-button"
                        onClick={() =>
                          setReviewComposer({
                            requestId: request.id,
                            action: request.is_revokable ? "revoke" : "approve",
                            reviewNote: "",
                            durationHours: 4,
                            attempted: false,
                          })
                        }
                      >
                        {request.is_revokable ? "Revoke Grant" : "Review"}
                      </button>
                    </div>
                  ) : null}

                  {reviewComposer.requestId === request.id ? (
                    <div className="review-composer">
                      {request.is_actionable ? (
                        <div className="review-toggle">
                          <button
                            className={`toggle-button ${reviewComposer.action === "approve" ? "is-active" : ""
                              }`}
                            onClick={() =>
                              setReviewComposer((current) => ({
                                ...current,
                                action: "approve",
                              }))
                            }
                          >
                            Approve
                          </button>
                          <button
                            className={`toggle-button ${reviewComposer.action === "reject" ? "is-active" : ""
                              }`}
                            onClick={() =>
                              setReviewComposer((current) => ({
                                ...current,
                                action: "reject",
                              }))
                            }
                          >
                            Reject
                          </button>
                        </div>
                      ) : request.is_revokable ? (
                        <div className="review-toggle">
                          <button className="toggle-button is-active">Revoke</button>
                        </div>
                      ) : null}

                      <textarea
                        className="composer-textarea"
                        rows={3}
                        value={reviewComposer.reviewNote}
                        onChange={(event) =>
                          setReviewComposer((current) => ({
                            ...current,
                            reviewNote: event.target.value,
                          }))
                        }
                        placeholder="Leave a reviewer note that explains the decision."
                      />
                      <div className="composer-meta">
                        <small
                          className={
                            normalizeLength(reviewComposer.reviewNote) >=
                              MIN_REVIEW_NOTE_LENGTH
                              ? "composer-hint is-valid"
                              : "composer-hint"
                          }
                        >
                          Minimum {MIN_REVIEW_NOTE_LENGTH} characters for reviewer justification.
                        </small>
                        <small className="composer-count">
                          {normalizeLength(reviewComposer.reviewNote)}/
                          {MIN_REVIEW_NOTE_LENGTH}
                        </small>
                      </div>
                      {getReviewComposerError(reviewComposer) ? (
                        <small className="composer-error">
                          {getReviewComposerError(reviewComposer)}
                        </small>
                      ) : null}

                      {reviewComposer.action === "approve" ? (
                        <label className="form-field inline-field">
                          <span>Hours of access</span>
                          <input
                            className="form-input"
                            type="number"
                            min="1"
                            max="24"
                            value={reviewComposer.durationHours}
                            onChange={(event) =>
                              setReviewComposer((current) => ({
                                ...current,
                                durationHours: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ) : null}

                      <div className="composer-actions">
                        <button
                          className="primary-button small-button"
                          onClick={() =>
                            handleReviewRequest(request.id, reviewComposer.action)
                          }
                          disabled={updating}
                        >
                          {reviewComposer.action === "approve"
                            ? "Confirm Approval"
                            : reviewComposer.action === "reject"
                              ? "Confirm Rejection"
                              : "Confirm Revocation"}
                        </button>
                        <button
                          className="secondary-button small-button"
                          onClick={() =>
                            setReviewComposer({
                              requestId: null,
                              action: "approve",
                              reviewNote: "",
                              durationHours: 4,
                              attempted: false,
                            })
                          }
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}

              {accessRequests.requests.length === 0 ? (
                <div className="empty-state">
                  <strong>No access requests yet.</strong>
                  <p>Temporary unmask requests will appear here once submitted.</p>
                </div>
              ) : null}
            </div>
          </article>
        </section>
      ) : null}

      {showOversight ? (
        <section className="oversight-grid">
          <article className="policy-card overview-card overview-card-compact">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">User Policy</span>
                <h3>Current access contract</h3>
              </div>
            </div>

            <div className="access-list">
              <div className="access-row">
                <span>Username</span>
                <strong>{currentUser.username}</strong>
              </div>
              <div className="access-row">
                <span>Role</span>
                <strong>{roleLabel[currentUser.role] || currentUser.role}</strong>
              </div>
              <div className="access-row">
                <span>Clearance</span>
                <strong>{currentUser.clearance_level}</strong>
              </div>
              <div className="access-row">
                <span>Sensitive visibility</span>
                <strong>
                  {dashboard.security_context.active_unmask_grants > 0
                    ? `${dashboard.security_context.active_unmask_grants} temporary grant(s)`
                    : "Masked records only"}
                </strong>
              </div>
              <div className="access-row">
                <span>Audit visibility</span>
                <strong>
                  {dashboard.security_context.can_view_audit_logs ? "Granted" : "Restricted"}
                </strong>
              </div>
              <div className="access-row access-row-wide">
                <span>Zone scope</span>
                <strong>{currentUser.assigned_zones.join(" · ")}</strong>
              </div>
              <div className="access-row access-row-wide">
                <span>System scope</span>
                <strong>{currentUser.assigned_systems.join(" · ")}</strong>
              </div>
              <div className="access-row access-row-wide">
                <span>Site scope</span>
                <strong>{currentUser.assigned_sites.join(" · ")}</strong>
              </div>
              <div className="access-row">
                <span>Request raw access</span>
                <strong>
                  {currentUser.can_request_unmask ? "Allowed with approval" : "Not available"}
                </strong>
              </div>
              <div className="access-row">
                <span>Review queue</span>
                <strong>
                  {currentUser.can_review_unmask ? "Reviewer enabled" : "No review permission"}
                </strong>
              </div>
              <div className="access-row access-row-wide">
                <span>Approval authority</span>
                <strong>{currentUser.approval_authority}</strong>
              </div>
              <div className="access-row access-row-wide">
                <span>Approval path</span>
                <strong>
                  Requests require {formatRoleName(dashboard.approval_policy.required_reviewer_role)}
                </strong>
              </div>
            </div>
          </article>

          {dashboard.role_directory?.length ? (
            <article className="policy-card overview-card overview-card-role">
              <div className="panel-title-row">
                <div>
                  <span className="eyebrow">Role Directory</span>
                  <h3>Login and approval boundaries</h3>
                </div>
              </div>

              <div className="role-directory-list">
                {dashboard.role_directory
                  .filter((roleItem) => roleItem.role !== "system")
                  .map((roleItem) => (
                    <div key={roleItem.role} className="role-directory-row">
                      <div className="role-directory-head">
                        <div>
                          <strong>{roleItem.label}</strong>
                          <span>{roleItem.description}</span>
                        </div>
                        <div className="record-badges">
                          <span className="mini-badge">{formatScopeLabel(roleItem.scope)}</span>
                          {roleItem.can_request_unmask ? (
                            <span className="mini-badge accent">can request</span>
                          ) : null}
                          {roleItem.can_review_unmask ? (
                            <span className="mini-badge access-approved">can approve</span>
                          ) : null}
                        </div>
                      </div>
                      <small className="role-directory-copy">{roleItem.approval_authority}</small>
                    </div>
                  ))}
              </div>
            </article>
          ) : null}

          {auditLogs.logs.length > 0 ? (
            <article className="policy-card oversight-span-two overview-card">
              <div className="panel-title-row">
                <div>
                  <span className="eyebrow">Audit Trail</span>
                  <h3>Recent access activity</h3>
                </div>
              </div>

              <div className="audit-feed">
                {auditLogs.logs.slice(0, 8).map((log) => (
                  <div key={log.id} className="audit-row">
                    <div>
                      <strong>{log.action}</strong>
                      <span>
                        {log.username || "system"} · {formatTime(log.created_at)}
                      </span>
                    </div>
                    <small>{log.detail || log.resource_type}</small>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {userRoster.users.length > 0 ? (
            <article className="policy-card oversight-span-two overview-card">
              <div className="panel-title-row">
                <div>
                  <span className="eyebrow">User Roster</span>
                  <h3>Provisioned accounts</h3>
                </div>
              </div>

              <div className="user-roster">
                {userRoster.users.map((user) => (
                  <div key={user.id} className="roster-row">
                    <div>
                      <strong>{user.full_name}</strong>
                      <span>
                        {roleLabel[user.role] || user.role} · {user.username}
                      </span>
                    </div>
                    <small>
                      {user.assigned_zones.join(" · ")} · {user.assigned_systems.join(" · ")}
                    </small>
                  </div>
                ))}
              </div>
            </article>
          ) : null}
        </section>
      ) : null}

      {showCommand ? (
        <section className="command-grid">
          <article className="briefing-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">Protection Model</span>
                <h3>Security shape of the platform</h3>
              </div>
            </div>

            <div className="briefing-grid">
              <div className="briefing-metric">
                <span>Zones</span>
                <strong>{dashboard.topology.zones}</strong>
              </div>
              <div className="briefing-metric">
                <span>Agents per zone</span>
                <strong>{dashboard.topology.agents_per_zone}</strong>
              </div>
              <div className="briefing-metric">
                <span>Leader role</span>
                <strong>{dashboard.topology.leader_role}</strong>
              </div>
              <div className="briefing-metric">
                <span>Protection path</span>
                <strong>{dashboard.topology.protection_model}</strong>
              </div>
            </div>

            <div className="signal-strip">
              <div className="signal-card">
                <span>Integrity Average</span>
                <strong>{dashboard.summary.average_integrity}%</strong>
              </div>
              <div className="signal-card">
                <span>Secure Transfer</span>
                <strong>{dashboard.summary.secure_transfer_rate}%</strong>
              </div>
              <div className="signal-card">
                <span>Generated</span>
                <strong>{formatDate(dashboard.generated_at)}</strong>
              </div>
            </div>

            <div className="principle-list">
              <div className="principle-item">
                <strong>Segmentation by role</strong>
                <p>Collectors, analysts, validators, and transfer leaders operate with distinct clearance boundaries.</p>
              </div>
              <div className="principle-item">
                <strong>Abstraction before movement</strong>
                <p>Sensitive fields are redacted or transformed before downstream agents or leaders receive the dataset.</p>
              </div>
              <div className="principle-item">
                <strong>Audited access by user</strong>
                <p>Sessions, dashboard reads, sensitive-record access, and simulation controls are written to immutable audit rows.</p>
              </div>
              <div className="principle-item">
                <strong>Temporary unmask approvals</strong>
                <p>Raw subject data is exposed only through reviewer-approved requests with a reviewer note and expiry window.</p>
              </div>
              <div className="principle-item">
                <strong>Session and login abuse controls</strong>
                <p>Login attempts are throttled, sessions are capped per user, and active grants can be revoked before natural expiry.</p>
              </div>
            </div>
          </article>

          <article className="activity-card">
            <div className="panel-title-row">
              <div>
                <span className="eyebrow">Global Event Stream</span>
                <h3>Recent coordination activity</h3>
              </div>
              <span className="activity-count">{dashboard.global_events.length} events</span>
            </div>

            <div className="event-feed">
              {dashboard.global_events.map((event) => (
                <div key={event.id} className={`event-card severity-${event.severity}`}>
                  <div className="event-card-head">
                    <div>
                      <span className="event-type">{formatEventType(event.event_type)}</span>
                      <strong>{event.agent_label || "Zone event"}</strong>
                    </div>
                    <span className="event-time">{formatTime(event.created_at)}</span>
                  </div>
                  <p>{event.message}</p>
                  <div className="event-card-meta">
                    <span>Integrity {event.integrity_score}%</span>
                    <span>{event.abstraction_applied ? "abstraction applied" : "raw flow"}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {showZones ? (
        <section className="zone-section">
          <div className="section-heading">
            <span className="eyebrow">Regional Operations</span>
            <h2>Availability zone watch</h2>
            <p>
              Every card represents the five-stage agent chain for one region, including
              leader status, latest batch output, and recent events.
            </p>
          </div>

          <div className="zone-grid">
            {dashboard.zones.map((zone) => {
              const liveZone = getLiveZoneProgress(simulationRun, zone.id);
              const basePosture = getZonePosture(zone);
              const posture = liveZone
                ? liveZone.status === "warning"
                  ? { label: "live watch", tone: "warning" }
                  : liveZone.status === "active"
                    ? { label: "live", tone: "leader" }
                    : basePosture
                : basePosture;
              const displayStages = getDisplayStages(zone, liveZone);
              const latestBatchSteps = getLiveBatchSteps(zone, liveZone);
              const zoneEvents = liveZone
                ? [
                  {
                    id: `live-${zone.id}`,
                    agent_label: liveZone.leader_label,
                    event_type: liveZone.active_stage_key || "simulation",
                    message: liveZone.latest_message,
                    severity: liveZone.status === "warning" ? "warning" : "info",
                  },
                  ...zone.recent_events,
                ].slice(0, 2)
                : zone.recent_events.slice(0, 2);

              return (
                <article
                  key={zone.id}
                  className={`zone-card ${liveZone ? `zone-card-live status-${liveZone.status}` : ""}`}
                >
                  <div className="zone-card-header">
                    <div>
                      <span className="zone-code">{zone.code}</span>
                      <h3>{zone.label}</h3>
                      <p>
                        {zone.city}, {zone.country}
                      </p>
                      <small className="zone-context-copy">
                        {zone.system_label} · {zone.site_label} · {zone.region}
                      </small>
                    </div>

                    <div className="zone-badges">
                      <span className="badge">{zone.sensitivity_tier}</span>
                      <span className="badge accent">{zone.abstraction_mode}</span>
                      {zone.region === "Europe" ? (
                        <span className="badge aggregator-badge">Secure Aggregator</span>
                      ) : null}
                      <span className={`badge tone-${posture.tone}`}>{posture.label}</span>
                    </div>
                  </div>

                  <div className="zone-control-strip">
                    <div className="zone-control-chip">
                      <span>Leader lane</span>
                      <strong>{liveZone ? liveZone.leader_label : zone.leader_label}</strong>
                    </div>
                    <div className="zone-control-chip">
                      <span>Integrity</span>
                      <strong>{liveZone ? liveZone.integrity_score : zone.integrity_score}%</strong>
                    </div>
                    <div className="zone-control-chip">
                      <span>Secure transfer</span>
                      <strong>
                        {liveZone ? liveZone.secure_transfer_rate : zone.secure_transfer_rate}%
                      </strong>
                    </div>
                    <div className="zone-control-chip">
                      <span>Network</span>
                      <strong>{zone.network_posture}</strong>
                    </div>
                    <div className="zone-control-chip">
                      <span>Last election</span>
                      <strong>{formatDate(zone.last_election_at)}</strong>
                    </div>
                  </div>

                  <div className="infrastructure-stack">
                    <div className="stack-item">
                      <span>Messaging</span>
                      <strong>{zone.messaging_stack}</strong>
                    </div>
                    <div className="stack-item">
                      <span>Leader Election</span>
                      <strong>{zone.leader_election_stack}</strong>
                    </div>
                    <div className="stack-item">
                      <span>Compute</span>
                      <strong className="compute-highlight">{zone.compute_stack}</strong>
                    </div>
                    <div className="stack-item">
                      <span>Security</span>
                      <strong>{zone.security_stack}</strong>
                    </div>
                    <div className="stack-item">
                      <span>Storage</span>
                      <strong>{zone.storage_stack}</strong>
                    </div>
                    <div className="stack-item">
                      <span>Monitoring</span>
                      <strong>{zone.monitoring_stack}</strong>
                    </div>
                  </div>

                  <div className="pipeline-shell">
                    <div className="pipeline-shell-head">
                      <span>Five-stage pipeline</span>
                      <small>
                        {liveZone
                          ? `${liveZone.batch_label} · ${formatStatusLabel(liveZone.status)}`
                          : zone.latest_run
                            ? `${zone.latest_run.batch_label} · ${formatStatusLabel(zone.latest_run.status)}`
                          : "heartbeat-sealed workflow"}
                      </small>
                    </div>

                    <div className="pipeline-flow">
                      {displayStages.map((stage, index) => (
                        <div
                          key={`${zone.id}-${stage.key}`}
                          className={`pipeline-stage status-${stage.status}`}
                        >
                          <div
                            className={`pipeline-node ${stage.is_leader ? "tone-leader" : "tone-default"} status-${stage.agent_status} is-live-${stage.status}`}
                          >
                            <div className="pipeline-node-head">
                              <span className="pipeline-index">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              {stage.is_leader ? (
                                <span className="pipeline-state-pill">Leader</span>
                              ) : null}
                            </div>
                            <span className="node-role">
                              {stage.label}
                            </span>
                            <strong>{formatStatusLabel(stage.status)}</strong>
                            <small className="pipeline-node-note">
                              {stage.detail || stage.note}
                            </small>
                            <small>
                              {stage.security_clearance} · {stage.encryption_state}
                            </small>
                            {stage.metric_display ? (
                              <small className="pipeline-node-metric">{stage.metric_display}</small>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {latestBatchSteps.length > 0 ? (
                    <div className="batch-pipeline">
                      <div className="pipeline-shell-head">
                        <span>Batch movement</span>
                        <small>
                          {liveZone
                            ? `${liveZone.batch_label} · integrity ${liveZone.integrity_score}%`
                            : `${zone.latest_run.batch_label} · integrity ${zone.latest_run.integrity_score}%`}
                        </small>
                      </div>

                      <div className="batch-flow">
                        {latestBatchSteps.map((step) => (
                          <div
                            key={`${zone.id}-${step.key}`}
                            className={`batch-step status-${step.status} ${step.status === "warning" ? "is-watch" : ""} ${step.status === "active" ? "is-live" : ""} ${step.status === "pending" ? "is-pending" : ""}`}
                          >
                            <span>{step.label}</span>
                            <strong>{step.value}</strong>
                            <small>{step.note}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="zone-events">
                    {zoneEvents.map((event) => (
                      <div key={event.id} className={`zone-event severity-${event.severity}`}>
                        <div className="zone-event-head">
                          <strong>{event.agent_label || "Zone event"}</strong>
                          <span>{formatEventType(event.event_type)}</span>
                        </div>
                        <p>{event.message}</p>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {simulationMapOpen ? (
        <div
          className="fullscreen-dialog-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSimulationMapOpen(false);
            }
          }}
        >
          <section
            className="fullscreen-dialog simulation-map-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="simulation-map-dialog-title"
          >
            <div className="fullscreen-dialog-head">
              <div className="fullscreen-dialog-copy">
                <span className="eyebrow">Global Locations</span>
                <h2 id="simulation-map-dialog-title">Live regional simulation map</h2>
                <p>
                  {simulationRun
                    ? `${simulationRun.completed_zones}/${simulationRun.total_zones} zones finished · ${activeSimulationZones} zones active · ${simulationProgress}% complete`
                    : `${dashboard.global_locations.length} locations ready for full-screen monitoring`}
                </p>
              </div>
              <div className="fullscreen-dialog-actions">
                <span className="mini-badge accent">
                  {dashboard.global_locations.length} locations
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSimulationMapOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>

            <SimulationMap
              locations={dashboard.global_locations}
              zones={dashboard.zones}
              simulationRun={simulationRun}
              isExpanded
            />

            <SimulationTrackChart
              dashboard={dashboard}
              simulationRun={simulationRun}
              historyRuns={simulationHistory}
            />

            <div className="location-grid fullscreen-location-grid">
              {dashboard.global_locations.map(renderLocationCard)}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
