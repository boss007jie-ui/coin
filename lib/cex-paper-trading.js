const DEFAULT_PAPER_ACCOUNT = {
  initialEquityUsdt: 1000,
  maxConcurrentPositions: 5,
  maxMarginUsagePct: 50,
  defaultRiskPct: 1.5,
  minRewardRisk: 1.2,
  defaultStopLossPct: 6,
  maxLeverage: 5
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
  const takeProfitPct = deriveTakeProfitPct(token?.expectedMovePctRange, side);
  if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0) return skipDecision(symbol, "invalid-take-profit");
  if ((takeProfitPct / stopLossPct) < DEFAULT_PAPER_ACCOUNT.minRewardRisk) return skipDecision(symbol, "poor-reward-risk");

  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  if (riskScore >= 80) return skipDecision(symbol, "risk-too-high");

  const leverage = selectLeverage(token, context);
  const riskPct = selectRiskPct(token, context);
  const riskBudgetUsdt = roundMoney(equityUsdt * (riskPct / 100));
  const notionalUsdt = roundMoney(riskBudgetUsdt / (stopLossPct / 100));
  const marginUsdt = roundMoney(notionalUsdt / leverage);
  const maxMarginUsdt = equityUsdt * (DEFAULT_PAPER_ACCOUNT.maxMarginUsagePct / 100);
  if (usedMarginUsdt + marginUsdt > maxMarginUsdt) return skipDecision(symbol, "margin-cap");

  const stopLossPrice = priceAtMove(entryPrice, side === "long" ? -stopLossPct : stopLossPct);
  const takeProfitPrice = priceAtMove(entryPrice, side === "long" ? takeProfitPct : -takeProfitPct);
  const openedAt = now.toISOString();

  return {
    action: "open",
    trade: {
      id: `${symbol}-${openedAt}`,
      source: "cex-radar",
      sourceObservedAt: token?.observedAt || token?.updatedAt || openedAt,
      symbol,
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
      stopLossPct,
      stopLossPrice,
      takeProfitPct,
      takeProfitPrice,
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
  const rows = (Array.isArray(candles) ? candles : [])
    .map(normalizeCandle)
    .filter(Boolean)
    .sort((a, b) => a.openTime - b.openTime);

  for (const candle of rows) {
    const tpTouched = touchesTakeProfit(trade, candle);
    const slTouched = touchesStopLoss(trade, candle);
    if (!tpTouched && !slTouched) continue;

    if (slTouched) {
      return closeTrade(trade, {
        exitReason: "stop-loss",
        exitPrice: trade.stopLossPrice,
        exitAt: new Date(candle.openTime).toISOString(),
        ambiguousExit: tpTouched && slTouched
      });
    }
    return closeTrade(trade, {
      exitReason: "take-profit",
      exitPrice: trade.takeProfitPrice,
      exitAt: new Date(candle.openTime).toISOString(),
      ambiguousExit: false
    });
  }

  const last = rows.at(-1);
  if (!last || options.markOpen === false) return { ...trade };
  return {
    ...trade,
    markPrice: last.close,
    markAt: new Date(last.openTime).toISOString(),
    unrealizedPnlUsdt: calculatePnlUsdt(trade, last.close)
  };
}

async function runPaperTradingCycle({
  ledger = [],
  tokens = [],
  fetchKlines,
  now = new Date()
} = {}) {
  const trades = (Array.isArray(ledger) ? ledger : []).map((trade) => ({ ...trade }));
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
    const evaluated = evaluatePaperTradeWithCandles(trade, candles);
    if (evaluated.status === "closed") {
      closedCount += 1;
      closedTrades.push(evaluated);
    }
    Object.assign(trade, evaluated);
  }

  for (const token of Array.isArray(tokens) ? tokens : []) {
    const openTrades = trades.filter((trade) => trade.status === "open");
    if (openTrades.length >= DEFAULT_PAPER_ACCOUNT.maxConcurrentPositions) {
      skipped.push({ symbol: normalizeSymbol(token?.symbol), reason: "max-open-positions" });
      continue;
    }
    const decision = buildPaperTradeFromToken(token, {
      equityUsdt: calculateEquity(trades),
      usedMarginUsdt: calculateUsedMargin(trades),
      openTrades,
      now
    });
    if (decision.action === "open") {
      trades.push(decision.trade);
      openedTrades.push(decision.trade);
      openedCount += 1;
    } else {
      skipped.push({ symbol: decision.symbol, reason: decision.reason });
    }
  }

  return {
    trades,
    openedCount,
    closedCount,
    openedTrades,
    closedTrades,
    skippedCount: skipped.length,
    skipped,
    account: buildAccountSnapshot(trades)
  };
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
  if (Number.isFinite(Number(context.riskPct))) return Number(context.riskPct);
  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const attentionScore = toFiniteNumber(token?.attentionScore) || 0;
  if (attentionScore >= 95 && riskScore <= 25) return 2;
  if (riskScore >= 60) return 1;
  return DEFAULT_PAPER_ACCOUNT.defaultRiskPct;
}

function deriveTakeProfitPct(range, side) {
  const lower = toFiniteNumber(range?.lower);
  const upper = toFiniteNumber(range?.upper);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  if (side === "long") return Math.min(...[lower, upper].filter((value) => value > 0));
  return Math.min(...[Math.abs(lower), Math.abs(upper)].filter((value) => value > 0));
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

function calculateEquity(trades) {
  return roundMoney(DEFAULT_PAPER_ACCOUNT.initialEquityUsdt + trades
    .filter((trade) => trade.status === "closed")
    .reduce((sum, trade) => sum + (toFiniteNumber(trade.pnlUsdt) || 0), 0));
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
    equityUsdt: calculateEquity(trades),
    usedMarginUsdt: calculateUsedMargin(trades),
    openCount: open.length,
    closedCount: closed.length,
    winRatePct: closed.length ? roundPct((wins.length / closed.length) * 100) : 0
  };
}

function actionToSide(actionBias) {
  if (actionBias === "watch-long") return "long";
  if (actionBias === "watch-short") return "short";
  return null;
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

module.exports = {
  DEFAULT_PAPER_ACCOUNT,
  buildPaperTradeFromToken,
  evaluatePaperTradeWithCandles,
  runPaperTradingCycle
};
