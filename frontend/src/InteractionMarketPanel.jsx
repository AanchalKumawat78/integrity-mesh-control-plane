const stageBlueprints = [
  {
    key: "collection",
    number: "01",
    label: "Collect",
    role: "data-collection",
  },
  {
    key: "preprocessing",
    number: "02",
    label: "Prep",
    role: "data-preprocessing",
  },
  {
    key: "analysis",
    number: "03",
    label: "Analyze",
    role: "data-analysis",
  },
  {
    key: "validation",
    number: "04",
    label: "Validate",
    role: "test-postprocess",
  },
  {
    key: "transfer",
    number: "05",
    label: "Transfer",
    role: "data-transfer",
    isLeader: true,
  },
];

const stageBlueprintMap = Object.fromEntries(
  stageBlueprints.map((stage) => [stage.key, stage]),
);

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const shortTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatSignedValue(value, digits = 1) {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
}

function formatPercent(value) {
  return `${Number(value).toFixed(1)}%`;
}

function formatCompact(value) {
  return compactNumberFormatter.format(Math.max(0, Math.round(value)));
}

function getLiveZone(zoneId, simulationRun) {
  return simulationRun?.zone_progress?.find((zone) => zone.zone_id === zoneId) || null;
}

function buildFallbackRunSummary(zone, liveZone) {
  if (liveZone?.run_summary) {
    return liveZone.run_summary;
  }

  if (zone.latest_run) {
    return zone.latest_run;
  }

  const collectedRecords = 5400 + zone.id * 380;
  const redactedRecords = Math.max(0, collectedRecords - (160 + zone.id * 18));
  const transmittedPackets = Math.max(0, redactedRecords - (52 + zone.id * 8));
  const anomaliesFound = zone.agents.some((agent) => agent.status === "degraded") ? 1 : 0;

  return {
    collected_records: collectedRecords,
    redacted_records: redactedRecords,
    transmitted_packets: transmittedPackets,
    anomalies_found: anomaliesFound,
    integrity_score: zone.integrity_score,
  };
}

function buildFallbackStage(agent, blueprint) {
  return {
    key: blueprint.key,
    label: blueprint.label,
    role: blueprint.role,
    status: agent?.status === "degraded" ? "warning" : "completed",
    agent_status: agent?.status || "active",
    agent_label: agent?.label || blueprint.label,
    detail:
      agent?.status === "degraded"
        ? `${agent.label} is creating drag on the handoff.`
        : `${blueprint.label} lane sealed and ready.`,
    metric_display: null,
    is_leader: Boolean(blueprint.isLeader || agent?.is_leader),
  };
}

function getOrderedStages(zone, liveZone) {
  if (liveZone?.stages?.length) {
    return stageBlueprints.map((blueprint, index) => {
      const liveStage =
        liveZone.stages.find((stage) => stage.key === blueprint.key) ||
        liveZone.stages[index];
      return liveStage || buildFallbackStage(null, blueprint);
    });
  }

  return stageBlueprints.map((blueprint, index) => {
    const matchingAgent =
      zone.agents.find((agent) => agent.role === blueprint.role) || zone.agents[index];
    return buildFallbackStage(matchingAgent, blueprint);
  });
}

function getDegradedCount(zone, stages) {
  if (zone.agents?.length) {
    return zone.agents.filter((agent) => agent.status === "degraded").length;
  }
  return stages.filter((stage) => stage.agent_status === "degraded").length;
}

function getInteractionVolume(stageKey, zone, liveZone, runSummary) {
  const integrityScore =
    liveZone?.integrity_score ?? zone.integrity_score ?? runSummary.integrity_score ?? 95;

  switch (stageKey) {
    case "collection":
      return runSummary.collected_records || 0;
    case "preprocessing":
      return runSummary.redacted_records || 0;
    case "analysis":
      return (runSummary.anomalies_found || 0) * 360 + 640;
    case "validation":
      return Math.round(integrityScore * 84);
    default:
      return runSummary.transmitted_packets || 0;
  }
}

function getVolumeLabel(stageKey, volume, zone, liveZone, runSummary) {
  if (stageKey === "analysis") {
    const anomalies = liveZone?.anomalies_found ?? runSummary.anomalies_found ?? 0;
    return anomalies > 0 ? `${anomalies} anomaly flags` : "No anomaly drag";
  }

  if (stageKey === "validation") {
    const integrity =
      liveZone?.integrity_score ?? zone.integrity_score ?? runSummary.integrity_score ?? 95;
    return `${Math.round(integrity)}% seal confidence`;
  }

  if (stageKey === "collection") {
    return `${formatCompact(volume)} records`;
  }

  if (stageKey === "preprocessing") {
    return `${formatCompact(volume)} abstracted`;
  }

  return `${formatCompact(volume)} packets`;
}

function computeInteractionDelta({
  blueprint,
  stage,
  zone,
  liveZone,
  runSummary,
  degradedCount,
}) {
  const integrity =
    liveZone?.integrity_score ?? zone.integrity_score ?? runSummary.integrity_score ?? 95;
  const transferRate =
    liveZone?.secure_transfer_rate ?? zone.secure_transfer_rate ?? 95;
  const anomalies = liveZone?.anomalies_found ?? runSummary.anomalies_found ?? 0;

  const baseWeight = {
    collection: 1.3,
    preprocessing: 0.9,
    analysis: -0.7,
    validation: 1.25,
    transfer: 1.6,
  }[blueprint.key] || 0.6;

  const integrityLift = (integrity - 95) * 0.24;
  const transferLift = (transferRate - 94) * 0.16;
  const liveMomentum =
    stage.status === "active" ? 1.1 : stage.status === "completed" ? 0.55 : 0.18;
  const warningPenalty =
    stage.status === "warning" || stage.agent_status === "degraded" ? 2.2 : 0;
  const anomalyPenalty = anomalies * (blueprint.key === "analysis" ? 1.5 : 0.46);
  const degradedPenalty = degradedCount * 0.7;

  return clamp(
    Number(
      (
        baseWeight +
        integrityLift +
        transferLift +
        liveMomentum -
        warningPenalty -
        anomalyPenalty -
        degradedPenalty
      ).toFixed(1),
    ),
    -5.4,
    5.4,
  );
}

function getToneFromDelta(delta, status) {
  if (status === "active") {
    return "live";
  }
  if (delta <= -1.2 || status === "warning") {
    return "negative";
  }
  if (delta >= 1.2) {
    return "positive";
  }
  return "neutral";
}

function getInteractionNote(stage, blueprint, delta) {
  if (stage.status === "active") {
    return stage.detail || `05 is actively leaning into ${blueprint.label}.`;
  }
  if (stage.status === "warning") {
    return stage.detail || `${blueprint.label} is dragging the curve.`;
  }
  if (delta < 0) {
    return `Stable handoff, but ${blueprint.label.toLowerCase()} is trimming momentum.`;
  }
  return stage.detail || `${blueprint.label} is reinforcing the sealed flow.`;
}

function buildBranch(zone, simulationRun) {
  const liveZone = getLiveZone(zone.id, simulationRun);
  const stages = getOrderedStages(zone, liveZone);
  const runSummary = buildFallbackRunSummary(zone, liveZone);
  const degradedCount = getDegradedCount(zone, stages);
  const leaderStage =
    stages.find((stage) => stage.key === "transfer") || stages[stages.length - 1];

  const interactions = stageBlueprints
    .filter((blueprint) => blueprint.key !== "transfer")
    .map((blueprint) => {
      const stage = stages.find((entry) => entry.key === blueprint.key) || stages[0];
      const delta = computeInteractionDelta({
        blueprint,
        stage,
        zone,
        liveZone,
        runSummary,
        degradedCount,
      });
      const volume = getInteractionVolume(blueprint.key, zone, liveZone, runSummary);

      return {
        id: `${zone.code}-${blueprint.key}`,
        stageKey: blueprint.key,
        targetNumber: blueprint.number,
        targetLabel: blueprint.label,
        status: stage.status,
        tone: getToneFromDelta(delta, stage.status),
        delta,
        deltaLabel: formatSignedValue(delta),
        volume,
        volumeLabel: getVolumeLabel(blueprint.key, volume, zone, liveZone, runSummary),
        note: getInteractionNote(stage, blueprint, delta),
      };
    });

  const branchScore = interactions.reduce((total, interaction) => total + interaction.delta, 0);
  const tone = getToneFromDelta(branchScore, liveZone?.status);
  const anomalies = liveZone?.anomalies_found ?? runSummary.anomalies_found ?? 0;
  const integrity = liveZone?.integrity_score ?? zone.integrity_score ?? runSummary.integrity_score;
  const transferRate = liveZone?.secure_transfer_rate ?? zone.secure_transfer_rate ?? 95;

  return {
    id: zone.id,
    zoneCode: zone.code,
    zoneLabel: zone.label,
    region: zone.region,
    leaderLabel: leaderStage?.agent_label || zone.leader_label || "Transfer leader",
    tone,
    score: branchScore,
    summaryLabel: `${branchScore >= 0 ? "+" : ""}${branchScore.toFixed(1)} pressure`,
    anomalies,
    integrity,
    transferRate,
    interactions,
  };
}

function buildCandles(branches) {
  const interactions = branches.flatMap((branch) =>
    branch.interactions.map((interaction) => ({
      ...interaction,
      zoneCode: branch.zoneCode,
      zoneLabel: branch.zoneLabel,
      branchTone: branch.tone,
    })),
  );

  if (interactions.length === 0) {
    return [];
  }

  let cursor = 100.4;
  const now = Date.now();

  return interactions.slice(0, 20).map((interaction, index) => {
    const open = cursor;
    const drift =
      interaction.delta +
      (interaction.status === "active" ? 0.8 : 0.24) +
      (interaction.tone === "negative" ? -0.42 : 0.18);
    const close = clamp(Number((open + drift).toFixed(1)), 84, 132);
    const high = clamp(
      Number((Math.max(open, close) + 1.1 + Math.abs(drift) * 0.55).toFixed(1)),
      86,
      138,
    );
    const low = clamp(
      Number((Math.min(open, close) - 1.05 - Math.abs(drift) * 0.4).toFixed(1)),
      78,
      132,
    );

    cursor = close;

    return {
      id: `${interaction.id}-candle`,
      zoneCode: interaction.zoneCode,
      zoneLabel: interaction.zoneLabel,
      stageLabel: interaction.targetLabel,
      targetNumber: interaction.targetNumber,
      status: interaction.status,
      tone: close >= open ? "up" : "down",
      open,
      close,
      high,
      low,
      volume: interaction.volume,
      deltaLabel: interaction.deltaLabel,
      timeLabel: shortTimeFormatter.format(
        new Date(now - (interactions.length - index) * 6 * 60 * 1000),
      ),
    };
  });
}

function buildNarrative(branches, candles, simulationRun) {
  const activeLinks = branches.flatMap((branch) =>
    branch.interactions
      .filter((interaction) => interaction.status === "active")
      .map((interaction) => ({
        zoneCode: branch.zoneCode,
        targetLabel: interaction.targetLabel,
      })),
  );
  const negativeLinks = branches.flatMap((branch) =>
    branch.interactions
      .filter((interaction) => interaction.tone === "negative")
      .map((interaction) => ({
        zoneCode: branch.zoneCode,
        targetLabel: interaction.targetLabel,
      })),
  );

  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const slope = lastCandle && firstCandle ? lastCandle.close - firstCandle.open : 0;

  if (simulationRun?.status === "running" && activeLinks.length > 0) {
    const activeLabel = activeLinks
      .slice(0, 2)
      .map((item) => `${item.zoneCode} 05→${item.targetLabel}`)
      .join(" and ");
    return `05 transfer leaders are actively pushing ${activeLabel}, while the graph tracks how those handoffs lift or drag the global confidence curve in real time.`;
  }

  if (negativeLinks.length > 0) {
    const negativeLabel = negativeLinks
      .slice(0, 2)
      .map((item) => `${item.zoneCode} ${item.targetLabel}`)
      .join(" and ");
    return `Nested 05→01/02/03/04 interactions are mapped directly into the market curve, with the sharpest drag currently coming from ${negativeLabel}.`;
  }

  return slope >= 0
    ? "Nested 05→01/02/03/04 handoffs are lifting the global curve as collection, validation, and transfer stay sealed."
    : "Nested 05→01/02/03/04 handoffs remain visible even when the curve softens, making it easier to see where global pressure starts.";
}

function buildModel(dashboard, simulationRun) {
  const branches = dashboard.zones
    .map((zone) => buildBranch(zone, simulationRun))
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score));
  const candles = buildCandles(branches);
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];
  const netMove = firstCandle && lastCandle ? lastCandle.close - firstCandle.open : 0;
  const netMovePercent = firstCandle ? (netMove / firstCandle.open) * 100 : 0;
  const maxVolume = Math.max(...candles.map((candle) => candle.volume), 1);
  const maxHigh = Math.max(...candles.map((candle) => candle.high), 110);
  const minLow = Math.min(...candles.map((candle) => candle.low), 90);
  const volatility =
    candles.length > 0
      ? candles.reduce((total, candle) => total + (candle.high - candle.low), 0) /
        candles.length
      : 0;
  const totalPackets = dashboard.summary.transmitted_packets;
  const activeLinks = branches.reduce(
    (total, branch) =>
      total + branch.interactions.filter((interaction) => interaction.status === "active").length,
    0,
  );
  const riskLinks = branches.reduce(
    (total, branch) =>
      total +
      branch.interactions.filter((interaction) => interaction.tone === "negative").length,
    0,
  );

  return {
    branches,
    candles,
    maxVolume,
    maxHigh,
    minLow,
    headline: buildNarrative(branches, candles, simulationRun),
    sentimentValue: lastCandle ? lastCandle.close.toFixed(1) : "100.0",
    netMoveLabel: formatSignedValue(netMovePercent),
    direction: netMovePercent >= 0 ? "positive" : "negative",
    tape: branches
      .flatMap((branch) =>
        branch.interactions.map((interaction) => ({
          id: `${branch.id}-${interaction.id}`,
          label: `${branch.zoneCode} 05→${interaction.targetNumber}`,
          deltaLabel: interaction.deltaLabel,
          tone: interaction.tone,
        })),
      )
      .sort(
        (left, right) =>
          Math.abs(Number.parseFloat(right.deltaLabel)) -
          Math.abs(Number.parseFloat(left.deltaLabel)),
      )
      .slice(0, 6),
    metrics: [
      {
        label: "Live interactions",
        value: String(activeLinks),
        note: simulationRun?.status === "running" ? "currently moving the curve" : "ready to animate",
        tone: activeLinks > 0 ? "positive" : "neutral",
      },
      {
        label: "Watch drag",
        value: String(riskLinks),
        note: riskLinks > 0 ? "links applying downward pressure" : "no immediate drag",
        tone: riskLinks > 0 ? "negative" : "positive",
      },
      {
        label: "Sealed volume",
        value: formatCompact(totalPackets),
        note: "packets represented in the market tape",
        tone: "neutral",
      },
      {
        label: "Volatility",
        value: formatPercent(volatility),
        note: `${formatPercent(dashboard.summary.average_integrity)} average integrity backdrop`,
        tone: volatility > 7 ? "negative" : "positive",
      },
    ],
  };
}

function buildLinePath(candles, yScale, xScale) {
  return candles
    .map((candle, index) => `${index === 0 ? "M" : "L"} ${xScale(index)} ${yScale(candle.close)}`)
    .join(" ");
}

function buildAreaPath(candles, yScale, xScale, baselineY) {
  if (candles.length === 0) {
    return "";
  }

  return `${buildLinePath(candles, yScale, xScale)} L ${xScale(candles.length - 1)} ${baselineY} L ${xScale(0)} ${baselineY} Z`;
}

export default function InteractionMarketPanel({ dashboard, simulationRun }) {
  const model = buildModel(dashboard, simulationRun);

  if (model.candles.length === 0) {
    return null;
  }

  const chartWidth = 920;
  const chartHeight = 360;
  const chartPadding = { top: 28, right: 16, bottom: 56, left: 22 };
  const volumeBandTop = 262;
  const volumeBandBottom = 326;
  const priceRange = Math.max(8, model.maxHigh - model.minLow);
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const step = plotWidth / model.candles.length;
  const candleWidth = Math.min(16, step * 0.5);
  const lastCandle = model.candles[model.candles.length - 1];

  function xScale(index) {
    return chartPadding.left + step * index + step / 2;
  }

  function yScale(value) {
    return (
      chartPadding.top +
      ((model.maxHigh - value) / priceRange) * (volumeBandTop - chartPadding.top - 18)
    );
  }

  function volumeScale(value) {
    const normalized = value / model.maxVolume;
    return clamp(normalized * (volumeBandBottom - volumeBandTop), 10, 64);
  }

  const linePath = buildLinePath(model.candles, yScale, xScale);
  const areaPath = buildAreaPath(model.candles, yScale, xScale, volumeBandTop);

  return (
    <article className="policy-card interaction-market-card">
      <div className="interaction-market-head">
        <div className="interaction-market-copy">
          <span className="eyebrow">Interaction Market</span>
          <h3>Global agent reaction board</h3>
          <p>{model.headline}</p>
        </div>

        <div className={`interaction-market-score tone-${model.direction}`}>
          <span>Mesh sentiment</span>
          <strong>{model.sentimentValue}</strong>
          <small>{model.netMoveLabel}</small>
        </div>
      </div>

      <div className="interaction-market-tape" aria-label="Largest interaction moves">
        {model.tape.map((item) => (
          <div key={item.id} className={`interaction-tape-chip tone-${item.tone}`}>
            <span>{item.label}</span>
            <strong>{item.deltaLabel}</strong>
          </div>
        ))}
      </div>

      <div className="interaction-market-grid">
        <div className="interaction-chart-shell">
          <svg
            className="interaction-chart"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label="Market-style chart showing how nested agent interactions impact global confidence"
          >
            <defs>
              <linearGradient id="interaction-area-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(91, 212, 177, 0.34)" />
                <stop offset="100%" stopColor="rgba(91, 212, 177, 0.02)" />
              </linearGradient>
              <linearGradient id="interaction-volume-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(46, 142, 255, 0.9)" />
                <stop offset="100%" stopColor="rgba(46, 142, 255, 0.18)" />
              </linearGradient>
              <linearGradient id="interaction-line-fill" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#9ef5de" />
                <stop offset="100%" stopColor="#4ac4ff" />
              </linearGradient>
            </defs>

            <rect
              x="0"
              y="0"
              width={chartWidth}
              height={chartHeight}
              rx="28"
              className="interaction-chart-surface"
            />

            {[0, 1, 2, 3].map((index) => {
              const y =
                chartPadding.top + index * ((volumeBandTop - chartPadding.top - 18) / 3);
              return (
                <line
                  key={`grid-${index}`}
                  x1={chartPadding.left}
                  x2={chartWidth - chartPadding.right}
                  y1={y}
                  y2={y}
                  className="interaction-chart-grid"
                />
              );
            })}

            <path d={areaPath} className="interaction-chart-area" />
            <path d={linePath} className="interaction-chart-line" />

            {model.candles.map((candle, index) => {
              const centerX = xScale(index);
              const bodyTop = yScale(Math.max(candle.open, candle.close));
              const bodyBottom = yScale(Math.min(candle.open, candle.close));
              const bodyHeight = Math.max(5, bodyBottom - bodyTop);
              const wickTop = yScale(candle.high);
              const wickBottom = yScale(candle.low);
              const volumeHeight = volumeScale(candle.volume);
              const volumeY = volumeBandBottom - volumeHeight;

              return (
                <g key={candle.id}>
                  <rect
                    x={centerX - candleWidth / 2}
                    y={volumeY}
                    width={candleWidth}
                    height={volumeHeight}
                    rx="4"
                    className={`interaction-volume-bar tone-${candle.tone}`}
                  />
                  <line
                    x1={centerX}
                    x2={centerX}
                    y1={wickTop}
                    y2={wickBottom}
                    className={`interaction-candle-wick tone-${candle.tone}`}
                  />
                  <rect
                    x={centerX - candleWidth / 2}
                    y={bodyTop}
                    width={candleWidth}
                    height={bodyHeight}
                    rx="5"
                    className={`interaction-candle-body tone-${candle.tone}`}
                  />
                  {index % 4 === 0 || index === model.candles.length - 1 ? (
                    <text
                      x={centerX}
                      y={chartHeight - 18}
                      textAnchor="middle"
                      className="interaction-chart-label"
                    >
                      {candle.zoneCode} {candle.targetNumber}
                    </text>
                  ) : null}
                </g>
              );
            })}

            <circle
              cx={xScale(model.candles.length - 1)}
              cy={yScale(lastCandle.close)}
              r="7"
              className="interaction-chart-pulse"
            />
            <circle
              cx={xScale(model.candles.length - 1)}
              cy={yScale(lastCandle.close)}
              r="4.5"
              className="interaction-chart-focus"
            />
          </svg>

          <div className="interaction-chart-footer">
            <div>
              <span className="interaction-footer-label">Latest move</span>
              <strong>
                {lastCandle.zoneCode} 05→{lastCandle.targetNumber} {lastCandle.stageLabel}
              </strong>
            </div>
            <div>
              <span className="interaction-footer-label">Market time</span>
              <strong>{lastCandle.timeLabel}</strong>
            </div>
            <div>
              <span className="interaction-footer-label">Delta</span>
              <strong>{lastCandle.deltaLabel}</strong>
            </div>
          </div>
        </div>

        <div className="interaction-market-rail">
          {model.metrics.map((metric) => (
            <div key={metric.label} className={`interaction-rail-card tone-${metric.tone}`}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.note}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="nested-agent-shell">
        <div className="nested-agent-head">
          <div>
            <span className="eyebrow">Nested Agents</span>
            <h4>05 transfer leader interacting with 01, 02, 03, and 04</h4>
          </div>
          <span className="activity-count">
            {model.branches.length} regional ladders
          </span>
        </div>

        <div className="nested-agent-grid">
          {model.branches.map((branch) => (
            <article key={branch.id} className={`nested-agent-card tone-${branch.tone}`}>
              <div className="nested-agent-root">
                <div className="nested-agent-root-badge">05</div>
                <div className="nested-agent-root-copy">
                  <strong>{branch.leaderLabel}</strong>
                  <span>
                    {branch.zoneCode} · {branch.zoneLabel} · {branch.region}
                  </span>
                </div>
                <div className="nested-agent-summary">
                  <strong>{branch.summaryLabel}</strong>
                  <small>
                    {formatPercent(branch.integrity)} integrity · {Math.round(branch.transferRate)}% transfer
                  </small>
                </div>
              </div>

              <div className="nested-agent-links">
                {branch.interactions.map((interaction) => (
                  <div
                    key={interaction.id}
                    className={`nested-agent-link tone-${interaction.tone}`}
                  >
                    <div className="nested-agent-connector" aria-hidden="true" />
                    <div className="nested-agent-link-badge">{interaction.targetNumber}</div>
                    <div className="nested-agent-link-copy">
                      <div className="nested-agent-link-head">
                        <strong>
                          05 → {interaction.targetNumber} {interaction.targetLabel}
                        </strong>
                        <span>{interaction.deltaLabel}</span>
                      </div>
                      <small>{interaction.note}</small>
                    </div>
                    <div className="nested-agent-link-meta">
                      <strong>{interaction.volumeLabel}</strong>
                      <span>{interaction.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </article>
  );
}
