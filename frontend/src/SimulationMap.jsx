const MAP_WIDTH = 840;
const MAP_HEIGHT = 360;
const agentBlueprints = [
  {
    key: "collection",
    role: "data-collection",
    number: "01",
  },
  {
    key: "preprocessing",
    role: "data-preprocessing",
    number: "02",
  },
  {
    key: "analysis",
    role: "data-analysis",
    number: "03",
  },
  {
    key: "validation",
    role: "test-postprocess",
    number: "04",
  },
  {
    key: "transfer",
    role: "data-transfer",
    number: "05",
    isLeader: true,
  },
];

function projectPoint(latitude, longitude) {
  const x = ((longitude + 180) / 360) * MAP_WIDTH;
  const y = ((90 - latitude) / 180) * MAP_HEIGHT;
  return { x, y };
}

function buildArcPath(source, target) {
  const midX = (source.x + target.x) / 2;
  const lift = Math.max(28, Math.abs(target.x - source.x) * 0.14);
  const controlY = Math.min(source.y, target.y) - lift;
  return `M ${source.x} ${source.y} Q ${midX} ${controlY} ${target.x} ${target.y}`;
}

function getLocationSimulationState(location, simulationRun) {
  const liveZone = simulationRun?.zone_progress?.find(
    (zone) => zone.site_label === location.label,
  );

  if (!liveZone) {
    return {
      status: location.warning_events > 0 ? "warning" : "idle",
      label: "Standby",
      liveZone: null,
    };
  }

  return {
    status: liveZone.status,
    label:
      liveZone.status === "active"
        ? liveZone.active_stage_key || "active"
        : liveZone.status,
    liveZone,
  };
}

function getZoneForLocation(location, zones) {
  return (
    zones.find((zone) => zone.site_label === location.label) ||
    zones.find((zone) => zone.label === location.label) ||
    zones.find(
      (zone) =>
        zone.latitude === location.latitude && zone.longitude === location.longitude,
    ) ||
    null
  );
}

function getZoneLiveState(zone, simulationRun) {
  if (!zone) {
    return null;
  }
  return simulationRun?.zone_progress?.find((entry) => entry.zone_id === zone.id) || null;
}

function getAgentOrbitPoint(point, index, total, radius) {
  const angle = (-Math.PI / 2) + (index / total) * Math.PI * 2;
  return {
    x: point.x + Math.cos(angle) * radius,
    y: point.y + Math.sin(angle) * radius,
  };
}

function getZoneAgentSignals(zone, simulationRun) {
  const liveZone = getZoneLiveState(zone, simulationRun);
  const liveStages = liveZone?.stages || [];

  return agentBlueprints.map((blueprint, index) => {
    const agent =
      zone.agents.find((candidate) => candidate.role === blueprint.role) || zone.agents[index];
    const liveStage =
      liveStages.find((stage) => stage.key === blueprint.key) || liveStages[index];
    const status =
      liveStage?.status === "completed"
        ? "idle"
        : liveStage?.status || (agent?.status === "degraded" ? "warning" : "idle");

    return {
      id: `${zone.id}-${blueprint.key}`,
      number: blueprint.number,
      label: agent?.label || blueprint.number,
      status,
      isLeader: Boolean(blueprint.isLeader || liveStage?.is_leader || agent?.is_leader),
      isActive: status === "active",
      isWarning: status === "warning" || agent?.status === "degraded",
      stageKey: blueprint.key,
    };
  });
}

export default function SimulationMap({
  locations,
  zones = [],
  simulationRun,
  onOpen,
  isExpanded = false,
}) {
  const flows = simulationRun?.map_flows || [];
  const isInteractive = Boolean(onOpen) && !isExpanded;
  const zoneSignals = locations
    .map((location) => {
      const zone = getZoneForLocation(location, zones);
      if (!zone || zone.latitude == null || zone.longitude == null) {
        return null;
      }

      return {
        location,
        zone,
        point: projectPoint(zone.latitude, zone.longitude),
        agents: getZoneAgentSignals(zone, simulationRun),
      };
    })
    .filter(Boolean);
  const activeAgents = zoneSignals.reduce(
    (total, zoneSignal) =>
      total + zoneSignal.agents.filter((agent) => agent.isActive).length,
    0,
  );

  function handleKeyDown(event) {
    if (!isInteractive) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <div
      className={`simulation-map-card ${isInteractive ? "is-interactive" : ""} ${isExpanded ? "is-expanded" : ""}`}
      onClick={isInteractive ? onOpen : undefined}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? "Open live regional simulation map in full screen" : undefined}
    >
      <div className="simulation-map-head">
        <div>
          <strong>Global flow</strong>
          <span>
            {simulationRun
              ? `${flows.filter((flow) => flow.status === "active").length} live transfer lanes · ${activeAgents} active agents`
              : `${zoneSignals.length * agentBlueprints.length} plotted agents across regional sites`}
          </span>
        </div>
        <div className="simulation-map-head-right">
          {isInteractive ? (
            <span className="simulation-map-expand-hint">Click to open full screen</span>
          ) : null}
          <div className="simulation-map-legend">
            <span className="legend-chip status-idle">Idle</span>
            <span className="legend-chip status-active">Active</span>
            <span className="legend-chip status-warning">Watch</span>
            <span className="legend-chip status-leader">Leader</span>
          </div>
        </div>
      </div>

      <svg
        className="simulation-map"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="img"
        aria-label="Global simulation activity map"
      >
        <defs>
          <linearGradient id="map-grid-glow" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(91, 212, 177, 0.28)" />
            <stop offset="100%" stopColor="rgba(255, 190, 108, 0.22)" />
          </linearGradient>
        </defs>

        <rect
          x="0"
          y="0"
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          rx="28"
          className="simulation-map-surface"
        />

        {[60, 120, 180, 240, 300].map((y) => (
          <line
            key={`lat-${y}`}
            x1="28"
            x2={MAP_WIDTH - 28}
            y1={y}
            y2={y}
            className="simulation-map-grid-line"
          />
        ))}
        {[140, 280, 420, 560, 700].map((x) => (
          <line
            key={`lng-${x}`}
            x1={x}
            x2={x}
            y1="28"
            y2={MAP_HEIGHT - 28}
            className="simulation-map-grid-line"
          />
        ))}

        {flows.map((flow) => {
          const source = projectPoint(flow.source_latitude, flow.source_longitude);
          const target = projectPoint(flow.target_latitude, flow.target_longitude);
          return (
            <g key={flow.id}>
              <path
                d={buildArcPath(source, target)}
                className={`simulation-map-arc status-${flow.status}`}
              />
              <path
                d={buildArcPath(source, target)}
                className={`simulation-map-arc trail status-${flow.status}`}
              />
            </g>
          );
        })}

        {zoneSignals.map((zoneSignal) => {
          const leader = zoneSignal.agents.find((agent) => agent.isLeader);
          const leaderIndex = zoneSignal.agents.findIndex((agent) => agent.isLeader);
          const leaderPoint =
            leaderIndex >= 0
              ? getAgentOrbitPoint(
                  zoneSignal.point,
                  leaderIndex,
                  zoneSignal.agents.length,
                  isExpanded ? 40 : 32,
                )
              : zoneSignal.point;

          return (
            <g key={`agent-cluster-${zoneSignal.zone.id}`}>
              {zoneSignal.agents.map((agent, index) => {
                const orbitPoint = getAgentOrbitPoint(
                  zoneSignal.point,
                  index,
                  zoneSignal.agents.length,
                  isExpanded ? 40 : 32,
                );

                return (
                  <g key={agent.id}>
                    <line
                      x1={zoneSignal.point.x}
                      x2={orbitPoint.x}
                      y1={zoneSignal.point.y}
                      y2={orbitPoint.y}
                      className={`simulation-agent-link status-${agent.status} ${agent.isLeader ? "is-leader" : ""}`}
                    />
                    {leader && agent.isActive && !agent.isLeader ? (
                      <line
                        x1={leaderPoint.x}
                        x2={orbitPoint.x}
                        y1={leaderPoint.y}
                        y2={orbitPoint.y}
                        className="simulation-agent-activity-link"
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        })}

        {locations.map((location) => {
          const point = projectPoint(location.latitude, location.longitude);
          const liveState = getLocationSimulationState(location, simulationRun);
          return (
            <g
              key={location.id}
              className={`simulation-map-node status-${liveState.status}`}
              transform={`translate(${point.x}, ${point.y})`}
            >
              <circle className="simulation-map-node-pulse" r="18" />
              <circle className="simulation-map-node-core" r="7" />
              <text className="simulation-map-node-label" x="12" y="-10">
                {location.city}
              </text>
              <text className="simulation-map-node-meta" x="12" y="8">
                {liveState.liveZone ? liveState.liveZone.leader_label : location.region}
              </text>
            </g>
          );
        })}

        {zoneSignals.map((zoneSignal) =>
          zoneSignal.agents.map((agent, index) => {
            const orbitPoint = getAgentOrbitPoint(
              zoneSignal.point,
              index,
              zoneSignal.agents.length,
              isExpanded ? 40 : 32,
            );

            return (
              <g
                key={`agent-node-${agent.id}`}
                className={`simulation-agent-node status-${agent.status} ${agent.isLeader ? "is-leader" : ""}`}
                transform={`translate(${orbitPoint.x}, ${orbitPoint.y})`}
              >
                {agent.isActive ? <circle className="simulation-agent-pulse" r="10" /> : null}
                <circle className="simulation-agent-core" r={agent.isLeader ? 7 : 5.5} />
                <text className="simulation-agent-label" y="3">
                  {agent.number}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}
