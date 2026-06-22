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
    openTrades: [],
    experimentGroup: "baseline"
  });

  assert.equal(decision.action, "open");
  assert.equal(decision.trade.side, "long");
  assert.equal(decision.trade.leverage, 3);
  assert.equal(decision.trade.riskBudgetUsdt, 15);
  assert.equal(decision.trade.notionalUsdt, 250);
  assert.equal(decision.trade.marginUsdt, 83.33);
  assert.equal(decision.trade.stopLossPrice, 9.4);
  assert.equal(decision.trade.takeProfitPrice, 10.8);
  assert.equal(decision.trade.stopLossMode, "trailing");
  assert.equal(decision.trade.experimentGroup, "baseline");
});

test("buildPaperTradeFromToken can use optimistic take profit for comparison group", () => {
  const decision = buildPaperTradeFromToken(token(), {
    equityUsdt: 1000,
    usedMarginUsdt: 0,
    openTrades: [],
    experimentGroup: "optimistic",
    takeProfitMode: "optimistic"
  });

  assert.equal(decision.action, "open");
  assert.equal(decision.trade.takeProfitPct, 18);
  assert.equal(decision.trade.takeProfitPrice, 11.8);
  assert.equal(decision.trade.stopLossPct, 6);
  assert.equal(decision.trade.stopLossMode, "trailing");
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
  assert.equal(result.exitReason, "trailing-stop");
  assert.equal(result.exitPrice, 10.34);
  assert.equal(result.ambiguousExit, true);
  assert.equal(result.pnlUsdt, 8.5);
});

test("evaluatePaperTradeWithCandles trails stop after favorable movement", () => {
  const trade = buildPaperTradeFromToken(token(), {
    equityUsdt: 1000,
    usedMarginUsdt: 0,
    openTrades: [],
    now: new Date("2026-06-22T00:00:00.000Z")
  }).trade;

  const result = evaluatePaperTradeWithCandles(trade, [
    candle({
      openTime: Date.parse("2026-06-22T00:05:00.000Z"),
      high: 10.7,
      low: 10.1,
      close: 10.5
    }),
    candle({
      openTime: Date.parse("2026-06-22T00:10:00.000Z"),
      high: 10.55,
      low: 10.0,
      close: 10.2
    })
  ]);

  assert.equal(result.status, "closed");
  assert.equal(result.exitReason, "trailing-stop");
  assert.equal(result.exitPrice, 10.058);
  assert.equal(result.pnlUsdt, 1.45);
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
  assert.equal(result.exitReason, "trailing-stop");
  assert.equal(result.exitPrice, 18.868);
  assert.equal(result.pnlUsdt, 14.15);
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
    now: new Date("2026-06-22T01:00:00.000Z"),
    experimentGroups: ["baseline"]
  });

  assert.equal(result.openedCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.openedTrades.length, 1);
  assert.equal(result.closedTrades.length, 0);
  assert.equal(result.trades.filter((trade) => trade.status === "open").length, 2);
  assert.ok(result.trades.some((trade) => trade.symbol === "NEWUSDT"));
  assert.ok(result.skipped.some((item) => item.symbol === "LABUSDT" && item.reason === "duplicate-open-symbol"));
});

test("runPaperTradingCycle opens baseline and optimistic comparison trades independently", async () => {
  const result = await runPaperTradingCycle({
    ledger: [],
    tokens: [token()],
    fetchKlines: async () => [],
    now: new Date("2026-06-22T01:00:00.000Z")
  });

  assert.equal(result.openedCount, 2);
  assert.equal(result.openedTrades.find((trade) => trade.experimentGroup === "baseline").takeProfitPct, 8);
  assert.equal(result.openedTrades.find((trade) => trade.experimentGroup === "optimistic").takeProfitPct, 18);
  assert.equal(result.accountsByGroup.baseline.openCount, 1);
  assert.equal(result.accountsByGroup.optimistic.openCount, 1);
});

test("runPaperTradingCycle closes and reverses when the signal flips direction", async () => {
  const result = await runPaperTradingCycle({
    ledger: [{
      id: "LABUSDT-existing",
      symbol: "LABUSDT",
      status: "open",
      side: "long",
      entryPrice: 10,
      marginUsdt: 83.33,
      notionalUsdt: 250,
      stopLossPrice: 9.4,
      takeProfitPrice: 10.8,
      openedAt: "2026-06-22T00:00:00.000Z"
    }],
    tokens: [
      token({
        actionBias: "watch-short",
        shortTermBias: "bearish",
        lastPrice: 9,
        expectedMovePctRange: { lower: -25, upper: -10, label: "-25% ~ -10%" }
      })
    ],
    fetchKlines: async () => [
      candle({
        openTime: Date.parse("2026-06-22T00:05:00.000Z"),
        high: 10.1,
        low: 9.7,
        close: 9.9
      })
    ],
    now: new Date("2026-06-22T01:00:00.000Z"),
    experimentGroups: ["baseline"]
  });

  assert.equal(result.closedCount, 1);
  assert.equal(result.closedTrades[0].exitReason, "signal-reversal");
  assert.equal(result.closedTrades[0].exitPrice, 9);
  assert.equal(result.closedTrades[0].pnlUsdt, -25);
  assert.equal(result.openedCount, 1);
  assert.equal(result.openedTrades[0].side, "short");
});

test("runPaperTradingCycle closes risk-off signals without opening a replacement", async () => {
  const result = await runPaperTradingCycle({
    ledger: [{
      id: "RISKUSDT-existing",
      symbol: "RISKUSDT",
      status: "open",
      side: "short",
      entryPrice: 20,
      marginUsdt: 80,
      notionalUsdt: 240,
      stopLossPrice: 21.2,
      takeProfitPrice: 18,
      openedAt: "2026-06-22T00:00:00.000Z"
    }],
    tokens: [
      token({
        symbol: "RISKUSDT",
        actionBias: "avoid",
        shortTermBias: "volatile-unclear",
        lastPrice: 19.5,
        riskScore: 85
      })
    ],
    fetchKlines: async () => [],
    now: new Date("2026-06-22T01:00:00.000Z"),
    experimentGroups: ["baseline"]
  });

  assert.equal(result.closedCount, 1);
  assert.equal(result.closedTrades[0].exitReason, "signal-risk-off");
  assert.equal(result.openedCount, 0);
  assert.equal(result.trades.filter((trade) => trade.status === "open").length, 0);
});
