const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPaperTradeFromToken,
  evaluatePaperTradeWithCandles,
  runPaperTradingCycle
} = require("../lib/cex-paper-trading");

function token(overrides = {}) {
  return {
    symbol: "LABUSDT",
    lastPrice: 10,
    attentionScore: 88,
    riskScore: 35,
    phase: "acceleration",
    shortTermBias: "bullish",
    expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" },
    expectationConfidence: "high",
    actionBias: "watch-long",
    signalReview: {
      decisionConfidence: "high",
      reviewLabel: "continuation"
    },
    ...overrides
  };
}

function candle(overrides = {}) {
  return {
    openTime: Date.parse("2026-06-22T00:00:00.000Z"),
    high: 10.2,
    low: 9.8,
    close: 10,
    ...overrides
  };
}

test("buildPaperTradeFromToken sizes a trade from total account risk, not fixed 1000 USDT per trade", () => {
  const decision = buildPaperTradeFromToken(token(), {
    equityUsdt: 1000,
    usedMarginUsdt: 0,
    openTrades: []
  });

  assert.equal(decision.action, "open");
  assert.equal(decision.trade.side, "long");
  assert.equal(decision.trade.leverage, 3);
  assert.equal(decision.trade.riskBudgetUsdt, 15);
  assert.equal(decision.trade.notionalUsdt, 250);
  assert.equal(decision.trade.marginUsdt, 83.33);
  assert.equal(decision.trade.stopLossPrice, 9.4);
  assert.equal(decision.trade.takeProfitPrice, 10.8);
});

test("buildPaperTradeFromToken caps leverage at 5 and skips non-trade actions", () => {
  const strong = buildPaperTradeFromToken(token({
    riskScore: 20,
    attentionScore: 96,
    markIndexPremiumPct: 0.2,
    fundingRate: 0.0001
  }), {
    equityUsdt: 1000,
    usedMarginUsdt: 0,
    openTrades: []
  });
  assert.equal(strong.trade.leverage, 5);

  const skipped = buildPaperTradeFromToken(token({ actionBias: "watch-only" }), {
    equityUsdt: 1000,
    usedMarginUsdt: 0,
    openTrades: []
  });
  assert.equal(skipped.action, "skip");
  assert.equal(skipped.reason, "not-directional");
});

test("evaluatePaperTradeWithCandles uses conservative stop loss when TP and SL touch in the same candle", () => {
  const trade = buildPaperTradeFromToken(token(), {
    equityUsdt: 1000,
    usedMarginUsdt: 0,
    openTrades: [],
    now: new Date("2026-06-22T00:00:00.000Z")
  }).trade;

  const result = evaluatePaperTradeWithCandles(trade, [
    candle({
      openTime: Date.parse("2026-06-22T00:05:00.000Z"),
      high: 11,
      low: 9.3,
      close: 10.4
    })
  ]);

  assert.equal(result.status, "closed");
  assert.equal(result.exitReason, "stop-loss");
  assert.equal(result.exitPrice, 9.4);
  assert.equal(result.ambiguousExit, true);
  assert.equal(result.pnlUsdt, -15);
});

test("evaluatePaperTradeWithCandles supports short take profit from candle lows", () => {
  const trade = buildPaperTradeFromToken(token({
    symbol: "RISKUSDT",
    actionBias: "watch-short",
    shortTermBias: "bearish",
    expectedMovePctRange: { lower: -25, upper: -10, label: "-25% ~ -10%" },
    lastPrice: 20,
    riskScore: 55,
    attentionScore: 84
  }), {
    equityUsdt: 1000,
    usedMarginUsdt: 0,
    openTrades: [],
    now: new Date("2026-06-22T00:00:00.000Z")
  }).trade;

  const result = evaluatePaperTradeWithCandles(trade, [
    candle({
      openTime: Date.parse("2026-06-22T00:10:00.000Z"),
      high: 20.4,
      low: 17.8,
      close: 18.2
    })
  ]);

  assert.equal(result.status, "closed");
  assert.equal(result.exitReason, "take-profit");
  assert.equal(result.exitPrice, 18);
  assert.equal(result.pnlUsdt, 25);
});

test("runPaperTradingCycle opens eligible trades and refuses duplicate open symbols", async () => {
  const result = await runPaperTradingCycle({
    ledger: [{
      id: "LABUSDT-existing",
      symbol: "LABUSDT",
      status: "open",
      side: "long",
      marginUsdt: 80,
      openedAt: "2026-06-22T00:00:00.000Z"
    }],
    tokens: [
      token(),
      token({ symbol: "NEWUSDT", lastPrice: 2, expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" } })
    ],
    fetchKlines: async () => [],
    now: new Date("2026-06-22T01:00:00.000Z")
  });

  assert.equal(result.openedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.trades.filter((trade) => trade.status === "open").length, 2);
  assert.ok(result.trades.some((trade) => trade.symbol === "NEWUSDT"));
  assert.ok(result.skipped.some((item) => item.symbol === "LABUSDT" && item.reason === "duplicate-open-symbol"));
});
