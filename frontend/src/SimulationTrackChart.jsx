import { useEffect, useState } from "react";

const stageWeights = {
  collection: 2.2,
  preprocessing: 1.6,
  analysis: -0.8,
  validation: 2.4,
  transfer: 2.9,
};

const stageLabels = {
  collection: "Collect",
  preprocessing: "Prep",
  analysis: "Analyze",
  validation: "Validate",
  transfer: "Transfer",
};

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const shortDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatSigned(value, digits = 1) {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
}

function formatCompact(value) {
  return compactNumberFormatter.format(Math.max(0, Math.round(value)));
}

function formatDateTime(value) {
  return value ? shortDateTimeFormatter.format(new Date(value)) : "No timestamp";
}

function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) {
    return "In progress";
  }

  const durationMs = Math.max(0, new Date(completedAt) - new Date(startedAt));
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function buildFallbackEvents(dashboard) {
  return dashboard.zones.flatMap((zone) => {
    const anomalies = zone.latest_run?.anomalies_found ?? 0;
    return [
      {
        id: `${zone.id}-collection`,
        zoneCode: zone.code,
        stageKey: "collection",
        status: "completed",
        severity: "info",
        message: `${zone.label} intake sealed`,
        createdAt: zone.last_election_at,
      },
      {
        id: `${zone.id}-analysis`,
        zoneCode: zone.code,
        stageKey: "analysis",
        status: anomalies > 0 ? "warning" : "completed",
        severity: anomalies > 0 ? "warning" : "info",
        message:
          anomalies > 0
            ? `${zone.label} raised ${anomalies} anomaly signals`
            : `${zone.label} analysis lane stayed clear`,
        createdAt: zone.last_election_at,
      },
      {
        id: `${zone.id}-transfer`,
        zoneCode: zone.code,
        stageKey: "transfer",
        status: "completed",
        severity: "info",
        message: `${zone.label} transfer leader sealed outbound packets`,
        createdAt: zone.last_election_at,
      },
    ];
  });
}

function buildLiveRunRecord(simulationRun) {
  if (!simulationRun) {
    return null;
  }

  return {
    id: "live",
    status: simulationRun.status,
    started_at: simulationRun.started_at,
    completed_at: simulationRun.completed_at,
    generated_at: simulationRun.generated_at,
    total_zones: simulationRun.total_zones,
    completed_zones: simulationRun.completed_zones,
    average_integrity:
      simulationRun.zone_progress.length > 0
        ? Number(
            (
              simulationRun.zone_progress.reduce(
                (total, zone) => total + zone.integrity_score,
                0,
              ) / simulationRun.zone_progress.length
            ).toFixed(1),
          )
        : 0,
    average_transfer_rate:
      simulationRun.zone_progress.length > 0
        ? Number(
            (
              simulationRun.zone_progress.reduce(
                (total, zone) => total + zone.secure_transfer_rate,
                0,
              ) / simulationRun.zone_progress.length
            ).toFixed(1),
          )
        : 0,
    warning_zones: simulationRun.zone_progress.filter((zone) => zone.status === "warning").length,
    timeline_events: simulationRun.timeline_events.map((event) => ({
      id: event.id,
      zone_id: event.zone_id,
      zone_code: null,
      stage_key: event.stage_key || "collection",
      event_type: event.event_type,
      severity: event.severity || "info",
      message: event.message,
      created_at: event.created_at,
    })),
  };
}

function buildRunOptions(simulationRun, historyRuns) {
  const options = [];
  const liveRecord = buildLiveRunRecord(simulationRun);

  if (liveRecord && liveRecord.timeline_events.length > 0) {
    options.push({
      id: "live",
      label: liveRecord.status === "running" ? "Live Tape" : "Latest Tape",
      meta:
        liveRecord.status === "running"
          ? `${liveRecord.completed_zones}/${liveRecord.total_zones} zones done`
          : formatDateTime(liveRecord.completed_at || liveRecord.generated_at),
      run: liveRecord,
      kind: "live",
    });
  }

  historyRuns.forEach((run, index) => {
    if (options.some((option) => option.run.id === run.id)) {
      return;
    }

    options.push({
      id: run.id,
      label: `Run ${String(index + 1).padStart(2, "0")}`,
      meta: formatDateTime(run.completed_at || run.generated_at || run.started_at),
      run,
      kind: "history",
    });
  });

  return options;
}

function buildEventFeed(dashboard, selectedOption) {
  if (selectedOption?.run?.timeline_events?.length > 0) {
    return selectedOption.run.timeline_events.map((event) => ({
      id: event.id,
      zoneCode:
        event.zone_code ||
        dashboard.zones.find((zone) => zone.id === event.zone_id)?.code ||
        "GLB",
      stageKey: event.stage_key || "collection",
      status: event.event_type?.includes("started") ? "active" : "completed",
      severity: event.severity || "info",
      message: event.message,
      createdAt: event.created_at,
    }));
  }

  return buildFallbackEvents(dashboard);
}

function buildTrackPoints(eventFeed) {
  const source = eventFeed.slice(-24);
  let cursor = 98.2;

  return source.map((event, index) => {
    const stageWeight = stageWeights[event.stageKey] ?? 1.1;
    const statusLift = event.status === "active" ? 1.2 : 0.48;
    const severityPenalty =
      event.severity === "warning" ? 2.4 : event.severity === "critical" ? 3.4 : 0;
    const delta = clamp(stageWeight + statusLift - severityPenalty, -4.6, 5.4);
    const open = cursor;
    const close = clamp(Number((open + delta).toFixed(1)), 84, 132);
    const high = clamp(
      Number((Math.max(open, close) + 1.2 + Math.abs(delta) * 0.42).toFixed(1)),
      85,
      138,
    );
    const low = clamp(
      Number((Math.min(open, close) - 1.1 - Math.abs(delta) * 0.3).toFixed(1)),
      78,
      132,
    );
    const volume = clamp(
      Math.round(680 + Math.abs(delta) * 220 + (event.status === "active" ? 180 : 0)),
      320,
      2100,
    );

    cursor = close;

    return {
      id: `${event.id}-${index}`,
      zoneCode: event.zoneCode,
      stageKey: event.stageKey,
      stageLabel: stageLabels[event.stageKey] || "Track",
      tone: close >= open ? "up" : "down",
      open,
      close,
      high,
      low,
      volume,
      delta,
      deltaLabel: formatSigned(delta),
      message: event.message,
      status: event.status,
      createdAt: event.createdAt,
      severity: event.severity,
      index,
    };
  });
}

function buildPath(points, xScale, yScale) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xScale(index)} ${yScale(point.close)}`)
    .join(" ");
}

function buildArea(points, xScale, yScale, baseline) {
  if (points.length === 0) {
    return "";
  }

  return `${buildPath(points, xScale, yScale)} L ${xScale(points.length - 1)} ${baseline} L ${xScale(0)} ${baseline} Z`;
}

export default function SimulationTrackChart({
  dashboard,
  simulationRun,
  historyRuns = [],
}) {
  const runOptions = buildRunOptions(simulationRun, historyRuns);
  const [selectedRunId, setSelectedRunId] = useState(() => runOptions[0]?.id || "");

  useEffect(() => {
    if (runOptions.length === 0) {
      if (selectedRunId) {
        setSelectedRunId("");
      }
      return;
    }

    if (!runOptions.some((option) => option.id === selectedRunId)) {
      setSelectedRunId(runOptions[0].id);
    }
  }, [runOptions, selectedRunId]);

  const selectedOption =
    runOptions.find((option) => option.id === selectedRunId) || runOptions[0] || null;
  const points = buildTrackPoints(buildEventFeed(dashboard, selectedOption));
  const [activePointId, setActivePointId] = useState(() => points[points.length - 1]?.id || "");

  useEffect(() => {
    if (points.length === 0) {
      if (activePointId) {
        setActivePointId("");
      }
      return;
    }

    if (!points.some((point) => point.id === activePointId)) {
      setActivePointId(points[points.length - 1].id);
    }
  }, [points, activePointId]);

  if (points.length === 0 || !selectedOption) {
    return null;
  }

  const activePoint =
    points.find((point) => point.id === activePointId) || points[points.length - 1];
  const width = 920;
  const height = 336;
  const padding = { top: 22, right: 16, bottom: 60, left: 18 };
  const volumeTop = 228;
  const volumeBottom = 292;
  const maxHigh = Math.max(...points.map((point) => point.high), 108);
  const minLow = Math.min(...points.map((point) => point.low), 90);
  const priceRange = Math.max(8, maxHigh - minLow);
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  const step = (width - padding.left - padding.right) / points.length;
  const candleWidth = Math.min(16, step * 0.46);
  const move = activePoint.close - points[0].open;
  const runDuration = formatDuration(
    selectedOption.run.started_at,
    selectedOption.run.completed_at,
  );
  const inspectedIndex = points.findIndex((point) => point.id === activePoint.id) + 1;

  function xScale(index) {
    return padding.left + index * step + step / 2;
  }

  function yScale(value) {
    return padding.top + ((maxHigh - value) / priceRange) * (volumeTop - padding.top - 14);
  }

  function volumeScale(value) {
    return clamp((value / maxVolume) * (volumeBottom - volumeTop), 8, 62);
  }

  const path = buildPath(points, xScale, yScale);
  const area = buildArea(points, xScale, yScale, volumeTop);
  const highlightX = xScale(activePoint.index);
  const highlightY = yScale(activePoint.close);
  const activeStage =
    selectedOption.kind === "live" && simulationRun?.status === "running"
      ? simulationRun.zone_progress
          .map((zone) => zone.active_stage_key)
          .find(Boolean)
      : null;

  return (
    <article className="policy-card simulation-track-card">
      <div className="panel-title-row">
        <div>
          <span className="eyebrow">Simulation Track</span>
          <h3>Interactive run analysis</h3>
        </div>
        <div className={`simulation-track-score tone-${move >= 0 ? "positive" : "negative"}`}>
          <strong>{formatSigned(move)}</strong>
          <small>{activeStage ? `${stageLabels[activeStage]} live` : selectedOption.label}</small>
        </div>
      </div>

      <p className="panel-subcopy simulation-track-copy">
        Switch between live and historical runs, then hover or click any candle to inspect
        the exact stage, zone, movement, and throughput behind that point on the tape.
      </p>

      <div className="simulation-track-toolbar">
        <div className="simulation-track-run-switcher">
          {runOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`simulation-track-run-chip ${selectedOption.id === option.id ? "is-active" : ""}`}
              onClick={() => setSelectedRunId(option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.meta}</span>
            </button>
          ))}
        </div>

        <div className="simulation-track-run-summary">
          <span>Selected run</span>
          <strong>{formatDateTime(selectedOption.run.completed_at || selectedOption.run.generated_at || selectedOption.run.started_at)}</strong>
          <small>
            {selectedOption.run.completed_zones}/{selectedOption.run.total_zones} zones finished
          </small>
        </div>
      </div>

      <div className="simulation-track-shell">
        <svg
          className="simulation-track-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Interactive market-like visualization of the selected simulation run"
        >
          <defs>
            <linearGradient id="simulation-track-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(91, 212, 177, 0.22)" />
              <stop offset="100%" stopColor="rgba(91, 212, 177, 0.02)" />
            </linearGradient>
            <linearGradient id="simulation-track-line" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#eefcff" />
              <stop offset="100%" stopColor="#58d9ff" />
            </linearGradient>
          </defs>

          <rect
            x="0"
            y="0"
            width={width}
            height={height}
            rx="26"
            className="simulation-track-surface"
          />

          {[0, 1, 2].map((index) => {
            const y = padding.top + index * ((volumeTop - padding.top - 14) / 2);
            return (
              <line
                key={`track-grid-${index}`}
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                className="simulation-track-grid"
              />
            );
          })}

          <path d={area} className="simulation-track-area" />
          <path d={path} className="simulation-track-line" />

          <line
            x1={highlightX}
            x2={highlightX}
            y1={padding.top}
            y2={volumeBottom}
            className="simulation-track-highlight-line"
          />

          {points.map((point, index) => {
            const centerX = xScale(index);
            const bodyTop = yScale(Math.max(point.open, point.close));
            const bodyBottom = yScale(Math.min(point.open, point.close));
            const bodyHeight = Math.max(4, bodyBottom - bodyTop);
            const wickTop = yScale(point.high);
            const wickBottom = yScale(point.low);
            const volumeHeight = volumeScale(point.volume);
            const isActivePoint = point.id === activePoint.id;

            return (
              <g
                key={point.id}
                className={`simulation-track-candle-group ${isActivePoint ? "is-selected" : ""}`}
                onMouseEnter={() => setActivePointId(point.id)}
                onFocus={() => setActivePointId(point.id)}
                onClick={() => setActivePointId(point.id)}
              >
                <rect
                  x={centerX - candleWidth / 2}
                  y={volumeBottom - volumeHeight}
                  width={candleWidth}
                  height={volumeHeight}
                  rx="3"
                  className={`simulation-track-volume tone-${point.tone} ${isActivePoint ? "is-selected" : ""}`}
                />
                <line
                  x1={centerX}
                  x2={centerX}
                  y1={wickTop}
                  y2={wickBottom}
                  className={`simulation-track-wick tone-${point.tone}`}
                />
                <rect
                  x={centerX - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  rx="4"
                  className={`simulation-track-body tone-${point.tone}`}
                />
                <circle
                  cx={centerX}
                  cy={yScale(point.close)}
                  r={isActivePoint ? 5 : point.status === "active" ? 4.5 : 3.25}
                  className={`simulation-track-node tone-${point.tone} ${point.status === "active" ? "is-live" : ""}`}
                />
                <rect
                  x={centerX - step / 2 + 4}
                  y={padding.top}
                  width={step - 8}
                  height={volumeBottom - padding.top}
                  rx="10"
                  className="simulation-track-hitbox"
                  tabIndex={0}
                  role="button"
                  aria-label={`${point.zoneCode} ${point.stageLabel} ${point.deltaLabel}`}
                  onMouseEnter={() => setActivePointId(point.id)}
                  onFocus={() => setActivePointId(point.id)}
                  onClick={() => setActivePointId(point.id)}
                />
                {index % 3 === 0 || index === points.length - 1 ? (
                  <text
                    x={centerX}
                    y={height - 18}
                    textAnchor="middle"
                    className="simulation-track-label"
                  >
                    {point.zoneCode} {point.stageLabel}
                  </text>
                ) : null}
              </g>
            );
          })}

          <circle
            cx={highlightX}
            cy={highlightY}
            r="8"
            className="simulation-track-focus-ring"
          />
          <circle
            cx={highlightX}
            cy={highlightY}
            r="4.5"
            className={`simulation-track-node tone-${activePoint.tone}`}
          />
        </svg>
      </div>

      <div className="simulation-track-analysis-grid">
        <div className="simulation-track-meta-card is-primary">
          <span>Inspected candle</span>
          <strong>
            {activePoint.zoneCode} · {activePoint.stageLabel}
          </strong>
          <small>{activePoint.message}</small>
        </div>
        <div className="simulation-track-meta-card">
          <span>Move</span>
          <strong>{activePoint.deltaLabel}</strong>
          <small>
            Open {activePoint.open.toFixed(1)} · Close {activePoint.close.toFixed(1)}
          </small>
        </div>
        <div className="simulation-track-meta-card">
          <span>Range</span>
          <strong>
            {activePoint.low.toFixed(1)} to {activePoint.high.toFixed(1)}
          </strong>
          <small>{activePoint.severity === "warning" ? "warning pressure" : "sealed range"}</small>
        </div>
        <div className="simulation-track-meta-card">
          <span>Volume</span>
          <strong>{formatCompact(activePoint.volume)}</strong>
          <small>inspection point {inspectedIndex} of {points.length}</small>
        </div>
      </div>

      <div className="simulation-track-history-grid">
        <div className="simulation-track-history-card">
          <span>Run duration</span>
          <strong>{runDuration}</strong>
          <small>{formatDateTime(selectedOption.run.started_at)}</small>
        </div>
        <div className="simulation-track-history-card">
          <span>Average integrity</span>
          <strong>{selectedOption.run.average_integrity?.toFixed?.(1) ?? selectedOption.run.average_integrity}%</strong>
          <small>across the analyzed run</small>
        </div>
        <div className="simulation-track-history-card">
          <span>Transfer rate</span>
          <strong>{selectedOption.run.average_transfer_rate?.toFixed?.(1) ?? selectedOption.run.average_transfer_rate}%</strong>
          <small>sealed throughput baseline</small>
        </div>
        <div className="simulation-track-history-card">
          <span>Warning zones</span>
          <strong>{selectedOption.run.warning_zones}</strong>
          <small>regions that ended under watch</small>
        </div>
      </div>
    </article>
  );
}
