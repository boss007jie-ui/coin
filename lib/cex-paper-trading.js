const DEFAULT_PAPER_ACCOUNT = {
  initialEquityUsdt: 1000,
  maxConcurrentPositions: 5,
  maxMarginUsagePct: 50,
  defaultRiskPct: 1.5,
  minRewardRisk: 1.2,
  defaultStopLossPct: 6,
  maxLeverage: 5,
  minEquityUsdt: 500,
  marginMode: "isolated"
};

const PAPER_STRATEGY_PROFILES = {
  standard: {
    id: "standard",
    maxConcurrentPositions: 5,
    maxMarginUsagePct: 50,
    riskPct: null,
    minRewardRisk: 1.2,
    maxEntryRiskScore: 80,
    maxLeverage: 5
  },
  "defensive-v1": {
    id: "defensive-v1",
    maxConcurrentPositions: 3,
    maxMarginUsagePct: 25,
    riskPct: 0.5,
    minRewardRisk: 1.5,
    maxEntryRiskScore: 55,
    maxLeverage: 2
  }
};

const PAPER_EXPERIMENT_GROUPS = {
  baseline: {
    id: "baseline",
    label: "保守止盈",
    takeProfitMode: "conservative"
  },
  optimistic: {
    id: "optimistic",
    label: "乐观止盈",
    takeProfitMode: "optimistic"
  }
};

function buildPaperTradeFromToken(token, context = {}) {
  const now = context.now || new Date();
  const symbol = normalizeSymbol(token?.symbol);
  const side = actionToSide(token?.actionBias);
  if (!symbol || !side) return skipDecision(symbol, "not-directional");

  const openTrades = Array.isArray(context.openTrades) ? context.openTrades : [];
  if (openTrades.some((trade) => trade.status === "open" && normalizeSymbol(trade.symbol) === symbol)) {
    return skipDecision(symbol, "duplicate-open-symbol");
  }

  const equityUsdt = positiveNumber(context.equityUsdt, DEFAULT_PAPER_ACCOUNT.initialEquityUsdt);
  const usedMarginUsdt = Math.max(0, toFiniteNumber(context.usedMarginUsdt) || 0);
  const entryPrice = toFiniteNumber(token?.lastPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return skipDecision(symbol, "invalid-entry-price");

  const stopLossPct = positiveNumber(context.stopLossPct, DEFAULT_PAPER_ACCOUNT.defaultStopLossPct);
  const experimentGroup = resolveExperimentGroup(context.experimentGroup || "baseline");
  const takeProfitMode = context.takeProfitMode || experimentGroup.takeProfitMode;
  const takeProfitPct = deriveTakeProfitPct(token?.expectedMovePctRange, side, takeProfitMode);
  if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0) return skipDecision(symbol, "invalid-take-profit");
  const minRewardRisk = positiveNumber(context.minRewardRisk, DEFAULT_PAPER_ACCOUNT.minRewardRisk);
  if ((takeProfitPct / stopLossPct) < minRewardRisk) return skipDecision(symbol, "poor-reward-risk");

  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const maxEntryRiskScore = positiveNumber(context.maxEntryRiskScore, 80);
  if (riskScore >= maxEntryRiskScore) return skipDecision(symbol, "risk-too-high");

  const leverage = selectLeverage(token, context);
  const riskPct = selectRiskPct(token, context);
  const riskBudgetUsdt = roundMoney(equityUsdt * (riskPct / 100));
  const notionalUsdt = roundMoney(riskBudgetUsdt / (stopLossPct / 100));
  const marginUsdt = roundMoney(notionalUsdt / leverage);
  const maxMarginUsagePct = positiveNumber(context.maxMarginUsagePct, DEFAULT_PAPER_ACCOUNT.maxMarginUsagePct);
  const maxMarginUsdt = equityUsdt * (maxMarginUsagePct / 100);
  if (usedMarginUsdt + marginUsdt > maxMarginUsdt) return skipDecision(symbol, "margin-cap");

  const stopLossPrice = priceAtMove(entryPrice, side === "long" ? -stopLossPct : stopLossPct);
  const takeProfitPrice = priceAtMove(entryPrice, side === "long" ? takeProfitPct : -takeProfitPct);
  const bestPrice = entryPrice;
  const openedAt = now.toISOString();

  return {
    action: "open",
    trade: {
      id: `${symbol}-${openedAt}`,
      source: "cex-radar",
      sourceObservedAt: token?.observedAt || token?.updatedAt || openedAt,
      symbol,
      experimentGroup: experimentGroup.id,
      experimentGroupLabel: experimentGroup.label,
      marginMode: DEFAULT_PAPER_ACCOUNT.marginMode,
      actionBias: token?.actionBias || null,
      shortTermBias: token?.shortTermBias || null,
      reviewLabel: token?.signalReview?.reviewLabel || token?.phase || null,
      side,
      status: "open",
      openedAt,
      updatedAt: openedAt,
      entryPrice,
      leverage,
      marginUsdt,
      notionalUsdt,
      riskBudgetUsdt,
      riskPct,
      stopLossMode: "trailing",
      stopLossPct,
      stopLossPrice,
      bestPrice,
      takeProfitPct,
      takeProfitPrice,
      takeProfitMode,
      expectedMovePctRange: token?.expectedMovePctRange || null,
      attentionScore: toFiniteNumber(token?.attentionScore),
      riskScore: toFiniteNumber(token?.riskScore),
      phase: token?.phase || null,
      decisionConfidence: token?.signalReview?.decisionConfidence || token?.expectationConfidence || token?.confidence || null
    }
  };
}

function evaluatePaperTradeWithCandles(trade, candles, options = {}) {
  if (!trade || trade.status !== "open") return trade;
  let current = normalizeTradeForTrailingStop(trade);
  const rows = (Array.isArray(candles) ? candles : [])
    .map(normalizeCandle)
    .filter(Boolean)
    .sort((a, b) => a.openTime - b.openTime);

  for (const candle of rows) {
    current = updateTrailingStop(current, candle);
    const tpTouched = touchesTakeProfit(current, candle);
    const slTouched = touchesStopLoss(current, candle);
    if (!tpTouched && !slTouched) continue;

    if (slTouched) {
      return closeTrade(current, {
        exitReason: current.stopLossMode === "trailing" ? "trailing-stop" : "stop-loss",
        exitPrice: resolveStopExitPrice(current, tpTouched),
        exitAt: new Date(candle.openTime).toISOString(),
        ambiguousExit: tpTouched && slTouched
      });
    }
    return closeTrade(current, {
      exitReason: "take-profit",
      exitPrice: current.takeProfitPrice,
      exitAt: new Date(candle.openTime).toISOString(),
      ambiguousExit: false
    });
  }

  const last = rows.at(-1);
  if (!last || options.markOpen === false) return { ...current };
  return {
    ...current,
    markPrice: last.close,
    markAt: new Date(last.openTime).toISOString(),
    unrealizedPnlUsdt: calculatePnlUsdt(current, last.close)
  };
}

async function runPaperTradingCycle({
  ledger = [],
  tokens = [],
  fetchKlines,
  now = new Date(),
  strategyProfile = "standard",
  experimentGroups
} = {}) {
  const trades = (Array.isArray(ledger) ? ledger : []).map((trade) => ({ ...trade }));
  const strategy = resolveStrategyProfile(strategyProfile);
  const groups = resolveExperimentGroups(experimentGroups);
  const normalizedTokens = Array.isArray(tokens) ? tokens : [];
  const tokensBySymbol = buildTokenMap(normalizedTokens);
  const skipped = [];
  const openedTrades = [];
  const closedTrades = [];
  let openedCount = 0;
  let closedCount = 0;

  for (const trade of trades.filter((item) => item.status === "open")) {
    if (typeof fetchKlines !== "function") continue;
    const candles = await fetchKlines(trade.symbol, {
      startTime: Date.parse(trade.openedAt),
      endTime: now.getTime(),
      interval: "5m"
    });
    const evaluated = evaluateSignalExit(
      evaluatePaperTradeWithCandles(trade, candles),
      tokensBySymbol.get(normalizeSymbol(trade.symbol)),
      now
    );
    if (evaluated.status === "closed") {
      closedCount += 1;
      closedTrades.push(evaluated);
    }
    Object.assign(trade, evaluated);
  }

  for (const token of normalizedTokens) {
    for (const group of groups) {
      const groupTrades = filterTradesByExperimentGroup(trades, group.id);
      const openTrades = groupTrades.filter((trade) => trade.status === "open");
      if (openTrades.length >= strategy.maxConcurrentPositions) {
        skipped.push({ symbol: normalizeSymbol(token?.symbol), experimentGroup: group.id, reason: "max-open-positions" });
        continue;
      }
      const decision = buildPaperTradeFromToken(token, {
        equityUsdt: calculateEquity(groupTrades),
        usedMarginUsdt: calculateUsedMargin(groupTrades),
        openTrades,
        now,
        riskPct: strategy.riskPct,
        maxLeverage: strategy.maxLeverage,
        maxMarginUsagePct: strategy.maxMarginUsagePct,
        minRewardRisk: strategy.minRewardRisk,
        maxEntryRiskScore: strategy.maxEntryRiskScore,
        experimentGroup: group.id,
        takeProfitMode: group.takeProfitMode
      });
      if (decision.action === "open") {
        trades.push(decision.trade);
        openedTrades.push(decision.trade);
        openedCount += 1;
      } else {
        skipped.push({ symbol: decision.symbol, experimentGroup: group.id, reason: decision.reason });
      }
    }
  }

  const accountsByGroup = buildAccountsByExperimentGroup(trades, groups);

  return {
    trades,
    openedCount,
    closedCount,
    openedTrades,
    closedTrades,
    skippedCount: skipped.length,
    skipped,
    account: accountsByGroup.baseline || buildAccountSnapshot(trades),
    accountsByGroup,
    strategyProfile: strategy.id
  };
}

function evaluateSignalExit(trade, token, now = new Date()) {
  if (!trade || trade.status !== "open" || !token) return trade;

  const exitPrice = toFiniteNumber(token?.lastPrice);
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return trade;

  const actionBias = token?.actionBias || "";
  const desiredSide = actionToSide(actionBias);
  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const shortTermBias = token?.shortTermBias || "";
  let exitReason = null;

  if (actionBias === "avoid" || riskScore >= 80) {
    exitReason = "signal-risk-off";
  } else if (desiredSide && desiredSide !== trade.side) {
    exitReason = "signal-reversal";
  } else if (
    (trade.side === "long" && shortTermBias === "bearish") ||
    (trade.side === "short" && shortTermBias === "bullish")
  ) {
    exitReason = "signal-bias-flip";
  }

  if (!exitReason) return trade;
  return closeTrade(trade, {
    exitReason,
    exitPrice,
    exitAt: now.toISOString(),
    ambiguousExit: false
  });
}

function selectLeverage(token, context = {}) {
  const maxLeverage = Math.min(DEFAULT_PAPER_ACCOUNT.maxLeverage, Math.max(1, Math.floor(positiveNumber(context.maxLeverage, DEFAULT_PAPER_ACCOUNT.maxLeverage))));
  const attentionScore = toFiniteNumber(token?.attentionScore) || 0;
  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const confidence = token?.signalReview?.decisionConfidence || token?.expectationConfidence || token?.confidence || "";
  if (confidence === "high" && attentionScore >= 95 && riskScore <= 25) return Math.min(5, maxLeverage);
  if (riskScore >= 60) return Math.min(2, maxLeverage);
  return Math.min(3, maxLeverage);
}

function selectRiskPct(token, context = {}) {
  const configuredRiskPct = Number(context.riskPct);
  if (context.riskPct !== null && context.riskPct !== undefined && Number.isFinite(configuredRiskPct) && configuredRiskPct > 0) {
    return configuredRiskPct;
  }
  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const attentionScore = toFiniteNumber(token?.attentionScore) || 0;
  if (attentionScore >= 95 && riskScore <= 25) return 2;
  if (riskScore >= 60) return 1;
  return DEFAULT_PAPER_ACCOUNT.defaultRiskPct;
}

function deriveTakeProfitPct(range, side, mode = "conservative") {
  const lower = toFiniteNumber(range?.lower);
  const upper = toFiniteNumber(range?.upper);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  const favorable = side === "long"
    ? [lower, upper].filter((value) => value > 0)
    : [Math.abs(lower), Math.abs(upper)].filter((value) => value > 0);
  if (!favorable.length) return null;
  if (mode === "optimistic") return Math.max(...favorable);
  return Math.min(...favorable);
}

function touchesTakeProfit(trade, candle) {
  if (trade.side === "long") return candle.high >= trade.takeProfitPrice;
  if (trade.side === "short") return candle.low <= trade.takeProfitPrice;
  return false;
}

function touchesStopLoss(trade, candle) {
  if (trade.side === "long") return candle.low <= trade.stopLossPrice;
  if (trade.side === "short") return candle.high >= trade.stopLossPrice;
  return false;
}

function resolveStopExitPrice(trade, tpTouched) {
  if (!tpTouched) return trade.stopLossPrice;
  if (trade.side === "long") return Math.min(trade.stopLossPrice, trade.takeProfitPrice);
  if (trade.side === "short") return Math.max(trade.stopLossPrice, trade.takeProfitPrice);
  return trade.stopLossPrice;
}

function normalizeTradeForTrailingStop(trade) {
  const entryPrice = toFiniteNumber(trade.entryPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return { ...trade };
  const stopLossPct = positiveNumber(trade.stopLossPct, DEFAULT_PAPER_ACCOUNT.defaultStopLossPct);
  const stopLossMode = trade.stopLossMode || "trailing";
  const initialStop = toFiniteNumber(trade.stopLossPrice) || priceAtMove(entryPrice, trade.side === "short" ? stopLossPct : -stopLossPct);
  const bestPrice = toFiniteNumber(trade.bestPrice) || entryPrice;
  return {
    ...trade,
    stopLossMode,
    stopLossPct,
    stopLossPrice: initialStop,
    bestPrice
  };
}

function updateTrailingStop(trade, candle) {
  if (trade.stopLossMode !== "trailing") return trade;
  const stopLossPct = positiveNumber(trade.stopLossPct, DEFAULT_PAPER_ACCOUNT.defaultStopLossPct);

  if (trade.side === "long") {
    const bestPrice = Math.max(toFiniteNumber(trade.bestPrice) || trade.entryPrice, candle.high);
    const stopLossPrice = Math.max(toFiniteNumber(trade.stopLossPrice) || 0, priceAtMove(bestPrice, -stopLossPct));
    return { ...trade, bestPrice: roundPrice(bestPrice), stopLossPrice };
  }

  if (trade.side === "short") {
    const currentBest = toFiniteNumber(trade.bestPrice) || trade.entryPrice;
    const bestPrice = Math.min(currentBest, candle.low);
    const previousStop = toFiniteNumber(trade.stopLossPrice);
    const trailingStop = priceAtMove(bestPrice, stopLossPct);
    const stopLossPrice = Number.isFinite(previousStop) ? Math.min(previousStop, trailingStop) : trailingStop;
    return { ...trade, bestPrice: roundPrice(bestPrice), stopLossPrice };
  }

  return trade;
}

function closeTrade(trade, { exitReason, exitPrice, exitAt, ambiguousExit }) {
  const pnlUsdt = calculatePnlUsdt(trade, exitPrice);
  return {
    ...trade,
    status: "closed",
    exitReason,
    exitPrice: roundPrice(exitPrice),
    exitAt,
    updatedAt: exitAt,
    ambiguousExit: Boolean(ambiguousExit),
    pnlUsdt,
    pnlPct: roundPct((pnlUsdt / trade.marginUsdt) * 100)
  };
}

function calculatePnlUsdt(trade, exitPrice) {
  const entry = toFiniteNumber(trade.entryPrice);
  const exit = toFiniteNumber(exitPrice);
  const notional = toFiniteNumber(trade.notionalUsdt);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit) || !Number.isFinite(notional)) return null;
  const move = trade.side === "short" ? (entry - exit) / entry : (exit - entry) / entry;
  return roundMoney(notional * move);
}

function calculateRealizedEquity(trades) {
  return roundMoney(DEFAULT_PAPER_ACCOUNT.initialEquityUsdt + trades
    .filter((trade) => trade.status === "closed")
    .reduce((sum, trade) => sum + (toFiniteNumber(trade.pnlUsdt) || 0), 0));
}

function calculateUnrealizedPnl(trades) {
  return roundMoney(trades
    .filter((trade) => trade.status === "open")
    .reduce((sum, trade) => sum + (toFiniteNumber(trade.unrealizedPnlUsdt) || 0), 0));
}

function calculateEquity(trades) {
  return roundMoney(calculateRealizedEquity(trades) + calculateUnrealizedPnl(trades));
}

function calculateUsedMargin(trades) {
  return roundMoney(trades
    .filter((trade) => trade.status === "open")
    .reduce((sum, trade) => sum + (toFiniteNumber(trade.marginUsdt) || 0), 0));
}

function buildAccountSnapshot(trades) {
  const closed = trades.filter((trade) => trade.status === "closed");
  const open = trades.filter((trade) => trade.status === "open");
  const wins = closed.filter((trade) => (toFiniteNumber(trade.pnlUsdt) || 0) > 0);
  return {
    initialEquityUsdt: DEFAULT_PAPER_ACCOUNT.initialEquityUsdt,
    realizedEquityUsdt: calculateRealizedEquity(trades),
    unrealizedPnlUsdt: calculateUnrealizedPnl(trades),
    equityUsdt: calculateEquity(trades),
    usedMarginUsdt: calculateUsedMargin(trades),
    openCount: open.length,
    closedCount: closed.length,
    winRatePct: closed.length ? roundPct((wins.length / closed.length) * 100) : 0
  };
}

function buildAccountsByExperimentGroup(trades, groups = resolveExperimentGroups()) {
  const accounts = {};
  for (const group of groups) {
    accounts[group.id] = {
      ...buildAccountSnapshot(filterTradesByExperimentGroup(trades, group.id)),
      experimentGroup: group.id,
      experimentGroupLabel: group.label,
      takeProfitMode: group.takeProfitMode
    };
  }
  return accounts;
}

function filterTradesByExperimentGroup(trades, groupId) {
  return (Array.isArray(trades) ? trades : []).filter((trade) => normalizeExperimentGroupId(trade.experimentGroup) === groupId);
}

function normalizeExperimentGroupId(value) {
  const id = String(value || "").trim().toLowerCase();
  return id || "baseline";
}

function actionToSide(actionBias) {
  if (actionBias === "watch-long") return "long";
  if (actionBias === "watch-short") return "short";
  return null;
}

function buildTokenMap(tokens) {
  const map = new Map();
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const symbol = normalizeSymbol(token?.symbol);
    if (symbol) map.set(symbol, token);
  }
  return map;
}

function priceAtMove(entryPrice, movePct) {
  return roundPrice(entryPrice * (1 + movePct / 100));
}

function normalizeCandle(row) {
  const openTime = Number(row?.openTime ?? row?.[0]);
  const high = toFiniteNumber(row?.high ?? row?.[2]);
  const low = toFiniteNumber(row?.low ?? row?.[3]);
  const close = toFiniteNumber(row?.close ?? row?.[4]);
  if (!Number.isFinite(openTime) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return null;
  return { openTime, high, low, close };
}

function skipDecision(symbol, reason) {
  return { action: "skip", symbol: normalizeSymbol(symbol), reason };
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

function roundPrice(value) {
  return Number(Number(value || 0).toPrecision(12));
}

function roundPct(value) {
  return Number(Number(value || 0).toFixed(2));
}

function resolveStrategyProfile(profileId) {
  const profile = PAPER_STRATEGY_PROFILES[String(profileId || "standard").trim().toLowerCase()] || PAPER_STRATEGY_PROFILES.standard;
  return { ...profile };
}

function resolveExperimentGroup(groupId) {
  const id = normalizeExperimentGroupId(groupId);
  const group = PAPER_EXPERIMENT_GROUPS[id] || PAPER_EXPERIMENT_GROUPS.baseline;
  return { ...group };
}

function resolveExperimentGroups(groupIds) {
  const ids = Array.isArray(groupIds) && groupIds.length ? groupIds : ["baseline", "optimistic"];
  const groups = ids.map(resolveExperimentGroup);
  const unique = new Map(groups.map((group) => [group.id, group]));
  return Array.from(unique.values());
}

module.exports = {
  DEFAULT_PAPER_ACCOUNT,
  PAPER_STRATEGY_PROFILES,
  PAPER_EXPERIMENT_GROUPS,
  buildPaperTradeFromToken,
  evaluatePaperTradeWithCandles,
  runPaperTradingCycle
};
