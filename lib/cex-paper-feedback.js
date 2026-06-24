const DEFAULT_MIN_SAMPLE_SIZE = 3;
const REVIEW_MIN_WIN_RATE_PCT = 35;
const REVIEW_MAX_LOSS_STREAK = 2;

function buildPaperFeedbackSummary(trades = [], options = {}) {
  const minSampleSize = positiveNumber(options.minSampleSize, DEFAULT_MIN_SAMPLE_SIZE);
  const closedTrades = (Array.isArray(trades) ? trades : [])
    .filter((trade) => trade?.status === "closed")
    .filter((trade) => Number.isFinite(toFiniteNumber(trade.pnlUsdt)));
  const groups = new Map();

  for (const trade of closedTrades) {
    const identity = buildSetupIdentity(trade);
    const key = buildSetupKey(identity);
    if (!groups.has(key)) {
      groups.set(key, {
        ...identity,
        key,
        trades: [],
        exitReasons: new Map(),
        symbols: new Set()
      });
    }
    const group = groups.get(key);
    group.trades.push(trade);
    group.symbols.add(normalizeSymbol(trade.symbol));
    const reason = trade.exitReason || "unknown";
    group.exitReasons.set(reason, (group.exitReasons.get(reason) || 0) + 1);
  }

  const setups = Array.from(groups.values())
    .map((group) => finalizeSetupFeedback(group, { minSampleSize }))
    .sort((a, b) => {
      if (a.needsReview !== b.needsReview) return a.needsReview ? -1 : 1;
      if (a.totalPnlUsdt !== b.totalPnlUsdt) return a.totalPnlUsdt - b.totalPnlUsdt;
      return b.sampleSize - a.sampleSize;
    });

  const worstSetups = setups
    .filter((setup) => setup.sampleSize >= minSampleSize)
    .sort((a, b) => a.totalPnlUsdt - b.totalPnlUsdt)
    .slice(0, 5);
  const needsReview = setups.filter((setup) => setup.needsReview);

  return {
    generatedAt: (options.now || new Date()).toISOString(),
    closedCount: closedTrades.length,
    setupCount: setups.length,
    needsReviewCount: needsReview.length,
    minSampleSize,
    setups,
    needsReview,
    worstSetups
  };
}

function buildSetupIdentity(trade = {}) {
  const side = normalizeSide(trade.side);
  const actionSetup = normalizeActionSetup(trade.actionSetup || trade.actionBias, side);
  const reviewLabel = String(
    trade.reviewLabel ||
    trade.signalReviewLabel ||
    trade.signalReview?.reviewLabel ||
    trade.phase ||
    "unknown-signal"
  ).trim() || "unknown-signal";
  const phase = String(trade.phase || "unknown-phase").trim() || "unknown-phase";
  const experimentGroup = normalizeExperimentGroup(trade.experimentGroup);

  return {
    experimentGroup,
    experimentGroupLabel: trade.experimentGroupLabel || experimentGroupLabel(experimentGroup),
    side,
    actionSetup,
    reviewLabel,
    phase
  };
}

function buildSetupKey(identity) {
  return [
    identity.experimentGroup,
    identity.side,
    identity.actionSetup,
    identity.reviewLabel,
    identity.phase
  ].join("|");
}

function finalizeSetupFeedback(group, { minSampleSize }) {
  const sortedTrades = [...group.trades].sort((a, b) => (
    (Date.parse(a.exitAt || a.updatedAt || a.openedAt || "") || 0) -
    (Date.parse(b.exitAt || b.updatedAt || b.openedAt || "") || 0)
  ));
  const pnls = sortedTrades.map((trade) => toFiniteNumber(trade.pnlUsdt) || 0);
  const wins = pnls.filter((pnl) => pnl > 0).length;
  const losses = pnls.filter((pnl) => pnl < 0).length;
  const totalPnlUsdt = roundMoney(pnls.reduce((sum, pnl) => sum + pnl, 0));
  const sampleSize = sortedTrades.length;
  const maxLossStreak = calculateMaxLossStreak(pnls);
  const riskBudgets = sortedTrades
    .map((trade) => toFiniteNumber(trade.riskBudgetUsdt))
    .filter((value) => Number.isFinite(value) && value > 0);
  const totalRiskBudget = riskBudgets.reduce((sum, value) => sum + value, 0);
  const averageRMultiple = totalRiskBudget > 0 ? roundPct(totalPnlUsdt / totalRiskBudget) : null;
  const reviewReasons = buildReviewReasons({
    sampleSize,
    totalPnlUsdt,
    winRatePct: sampleSize ? roundPct((wins / sampleSize) * 100) : 0,
    maxLossStreak,
    averageRMultiple,
    minSampleSize
  });

  return {
    key: group.key,
    experimentGroup: group.experimentGroup,
    experimentGroupLabel: group.experimentGroupLabel,
    side: group.side,
    actionSetup: group.actionSetup,
    reviewLabel: group.reviewLabel,
    phase: group.phase,
    sampleSize,
    wins,
    losses,
    winRatePct: sampleSize ? roundPct((wins / sampleSize) * 100) : 0,
    totalPnlUsdt,
    averagePnlUsdt: sampleSize ? roundMoney(totalPnlUsdt / sampleSize) : 0,
    bestPnlUsdt: pnls.length ? roundMoney(Math.max(...pnls)) : 0,
    worstPnlUsdt: pnls.length ? roundMoney(Math.min(...pnls)) : 0,
    maxLossStreak,
    averageRMultiple,
    exitReasons: Object.fromEntries(group.exitReasons.entries()),
    symbols: Array.from(group.symbols).filter(Boolean).sort().slice(0, 12),
    needsReview: reviewReasons.length > 0,
    reviewReasons
  };
}

function buildReviewReasons({ sampleSize, totalPnlUsdt, winRatePct, maxLossStreak, averageRMultiple, minSampleSize }) {
  if (sampleSize < minSampleSize) return [];
  const reasons = [];
  if (totalPnlUsdt < 0) reasons.push("negative-total-pnl");
  if (winRatePct < REVIEW_MIN_WIN_RATE_PCT) reasons.push("low-win-rate");
  if (maxLossStreak >= REVIEW_MAX_LOSS_STREAK) reasons.push("loss-streak");
  if (averageRMultiple !== null && averageRMultiple < -0.5) reasons.push("poor-risk-realization");
  return reasons;
}

function calculateMaxLossStreak(pnls) {
  let current = 0;
  let max = 0;
  for (const pnl of pnls) {
    if (pnl < 0) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

function normalizeActionSetup(value, side) {
  const normalized = String(value || "").trim();
  if (normalized) return normalized;
  if (side === "long") return "watch-long";
  if (side === "short") return "watch-short";
  return "unknown-action";
}

function normalizeSide(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "long" || normalized === "short") return normalized;
  return "unknown-side";
}

function normalizeExperimentGroup(value) {
  return String(value || "baseline").trim().toLowerCase() || "baseline";
}

function experimentGroupLabel(groupId) {
  if (groupId === "optimistic") return "乐观止盈";
  return "保守止盈";
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function roundPct(value) {
  return Number(Number(value || 0).toFixed(2));
}

module.exports = {
  buildPaperFeedbackSummary
};
