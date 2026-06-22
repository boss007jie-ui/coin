const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCexFeedbackDigest,
  buildCexAlertMessages,
  createCexBackgroundMonitor
} = require("../lib/cex-background-monitor");

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
    expectationReasons: ["高关注且风险未失控", "外部锚同步"],
    actionBias: "watch-long",
    actionReasons: ["高关注且风险未失控"],
    signalReview: {
      reviewLabel: "continuation",
      decisionSummary: "高关注且外部锚同步，风险未失控，适合观察延续。",
      decisionConfidence: "high",
      bullCase: ["外部锚同步"],
      bearCase: [],
      riskGate: []
    },
    ...overrides
  };
}

test("buildCexAlertMessages alerts directional and high-risk tokens with cooldown", () => {
  const cooldowns = new Map();
  const nowMs = Date.parse("2026-06-21T08:00:00.000Z");
  const first = buildCexAlertMessages([
    token(),
    token({ symbol: "LOWUSDT", attentionScore: 20, riskScore: 10, actionBias: "watch-only", shortTermBias: "volatile-unclear" }),
    token({ symbol: "RISKUSDT", attentionScore: 60, riskScore: 75, actionBias: "avoid", shortTermBias: "volatile-unclear" })
  ], {
    cooldowns,
    nowMs,
    cooldownMs: 60 * 60 * 1000
  });

  assert.equal(first.length, 2);
  assert.ok(first[0].text.includes("LABUSDT"));
  assert.ok(first[0].text.includes("观察做多"));
  assert.ok(first[1].text.includes("RISKUSDT"));
  assert.ok(first[1].text.includes("风险"));

  const second = buildCexAlertMessages([token()], {
    cooldowns,
    nowMs: nowMs + 30 * 60 * 1000,
    cooldownMs: 60 * 60 * 1000
  });
  assert.equal(second.length, 0);

  const third = buildCexAlertMessages([token()], {
    cooldowns,
    nowMs: nowMs + 61 * 60 * 1000,
    cooldownMs: 60 * 60 * 1000
  });
  assert.equal(third.length, 1);
});

test("background monitor scan saves journal and sends Telegram alerts", async () => {
  const sent = [];
  const saved = [];
  const monitor = createCexBackgroundMonitor({
    scanCexRadar: async () => ({
      updatedAt: "2026-06-21T08:00:00.000Z",
      summary: { scannedFutures: 10, withoutBinanceSpot: 2, deepInspected: 1, attentionCount: 1, riskCount: 0 },
      tokens: [token()],
      errors: []
    }),
    loadJournal: async () => [],
    saveJournal: async (entries) => saved.push(entries),
    notifier: {
      enabled: true,
      sendMessage: async (message) => {
        sent.push(message);
        return { ok: true };
      }
    },
    now: () => new Date("2026-06-21T08:00:00.000Z"),
    setTimer: () => null,
    clearTimer: () => {},
    intervalMinutes: 5,
    deepInspectLimit: 20
  });

  const result = await monitor.runOnce();

  assert.equal(result.ok, true);
  assert.equal(result.alertCount, 1);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("LABUSDT"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0].symbol, "LABUSDT");
  assert.equal(monitor.getStatus().lastSummary.scannedFutures, 10);
});

test("background monitor runs paper trading cycle when dependencies are configured", async () => {
  let paperTrades = [];
  const sent = [];
  const monitor = createCexBackgroundMonitor({
    scanCexRadar: async () => ({
      updatedAt: "2026-06-21T08:00:00.000Z",
      summary: { scannedFutures: 10, withoutBinanceSpot: 2, deepInspected: 1, attentionCount: 1, riskCount: 0 },
      tokens: [token()],
      errors: []
    }),
    loadJournal: async () => [],
    saveJournal: async () => {},
    loadPaperTrades: async () => paperTrades,
    savePaperTrades: async (trades) => {
      paperTrades = trades;
    },
    fetchKlines: async () => [],
    notifier: {
      enabled: true,
      sendMessage: async (message) => {
        sent.push(message);
        return { ok: true };
      }
    },
    now: () => new Date("2026-06-21T08:00:00.000Z"),
    setTimer: () => null,
    clearTimer: () => {}
  });

  const result = await monitor.runOnce();

  assert.equal(result.ok, true);
  assert.equal(result.paperTrading.openedCount, 1);
  assert.equal(result.paperTrading.closedCount, 0);
  assert.equal(paperTrades.length, 1);
  assert.equal(paperTrades[0].symbol, "LABUSDT");
  assert.equal(paperTrades[0].status, "open");
  assert.equal(monitor.getStatus().lastPaperTrading.openedCount, 1);
  assert.ok(sent.some((message) => message.includes("[CEX 模拟交易]")));
});

test("background monitor keeps scan successful when Telegram alert fails", async () => {
  const saved = [];
  const monitor = createCexBackgroundMonitor({
    scanCexRadar: async () => ({
      updatedAt: "2026-06-21T08:00:00.000Z",
      summary: { scannedFutures: 10, withoutBinanceSpot: 2, deepInspected: 1, attentionCount: 1, riskCount: 0 },
      tokens: [token()],
      errors: []
    }),
    loadJournal: async () => [],
    saveJournal: async (entries) => saved.push(entries),
    notifier: {
      enabled: true,
      sendMessage: async () => {
        throw new Error("Telegram send failed");
      }
    },
    now: () => new Date("2026-06-21T08:00:00.000Z"),
    setTimer: () => null,
    clearTimer: () => {},
    logger: { warn: () => {} }
  });

  const result = await monitor.runOnce();

  assert.equal(result.ok, true);
  assert.equal(result.alertCount, 0);
  assert.equal(saved.length, 1);
  assert.equal(monitor.getStatus().lastError, null);
});

test("buildCexFeedbackDigest summarizes unnotified prediction reviews once per local day", () => {
  const digest = buildCexFeedbackDigest([
    {
      id: "LABUSDT-2026-06-21T08:00:00.000Z",
      symbol: "LABUSDT",
      actionBias: "watch-long",
      shortTermBias: "bullish",
      expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" },
      review1d: {
        reviewedAt: "2026-06-22T08:00:00.000Z",
        movePct: 12,
        outcomeLabel: "hit"
      }
    },
    {
      id: "RISKUSDT-2026-06-19T08:00:00.000Z",
      symbol: "RISKUSDT",
      actionBias: "watch-short",
      shortTermBias: "bearish",
      expectedMovePctRange: { lower: -18, upper: -8, label: "-18% ~ -8%" },
      review3d: {
        reviewedAt: "2026-06-22T08:00:00.000Z",
        movePct: 7,
        outcomeLabel: "miss"
      }
    }
  ], {
    now: new Date("2026-06-22T10:00:00.000Z")
  });

  assert.equal(digest.items.length, 2);
  assert.ok(digest.text.includes("[CEX 雷达] 预测反馈日报"));
  assert.ok(digest.text.includes("1天: 1 条"));
  assert.ok(digest.text.includes("3天: 1 条"));
  assert.ok(digest.text.includes("LABUSDT"));
  assert.ok(digest.text.includes("RISKUSDT"));

  const duplicate = buildCexFeedbackDigest([
    {
      id: "LABUSDT-2026-06-21T08:00:00.000Z",
      symbol: "LABUSDT",
      review1d: {
        reviewedAt: "2026-06-22T08:00:00.000Z",
        movePct: 12,
        outcomeLabel: "hit",
        feedbackDigestSentAt: "2026-06-22T09:00:00.000Z"
      }
    }
  ], {
    now: new Date("2026-06-22T10:00:00.000Z")
  });
  assert.equal(duplicate, null);
});

test("background monitor sends prediction feedback digest and marks reviews as notified", async () => {
  const sent = [];
  let journal = [{
    id: "LABUSDT-2026-06-21T08:00:00.000Z",
    symbol: "LABUSDT",
    observedAt: "2026-06-21T08:00:00.000Z",
    lastSeenAt: "2026-06-21T08:00:00.000Z",
    entryPrice: 10,
    latestPrice: 10,
    actionBias: "watch-long",
    shortTermBias: "bullish",
    expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" },
    review1d: null,
    review3d: null
  }];
  const monitor = createCexBackgroundMonitor({
    scanCexRadar: async () => ({
      updatedAt: "2026-06-22T10:00:00.000Z",
      summary: { scannedFutures: 10, withoutBinanceSpot: 1, deepInspected: 1, attentionCount: 0, riskCount: 0 },
      tokens: [token({ lastPrice: 11.2, attentionScore: 10, riskScore: 10, actionBias: "watch-only", shortTermBias: "volatile-unclear" })],
      errors: []
    }),
    loadJournal: async () => journal,
    saveJournal: async (entries) => {
      journal = entries;
    },
    notifier: {
      enabled: true,
      sendMessage: async (message) => {
        sent.push(message);
        return { ok: true };
      }
    },
    now: () => new Date("2026-06-22T10:00:00.000Z"),
    setTimer: () => null,
    clearTimer: () => {}
  });

  const first = await monitor.runOnce();
  const second = await monitor.runOnce();

  assert.equal(first.ok, true);
  assert.equal(first.feedbackDigestCount, 1);
  assert.equal(second.feedbackDigestCount, 0);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("预测反馈日报"));
  assert.equal(journal[0].review1d.outcomeLabel, "hit");
  assert.ok(journal[0].review1d.feedbackDigestSentAt);
  assert.equal(monitor.getStatus().lastFeedbackDigestCount, 0);
});

test("background monitor records scan errors and sends one error alert", async () => {
  const sent = [];
  const monitor = createCexBackgroundMonitor({
    scanCexRadar: async () => {
      const error = new Error("Binance futures ticker scan failed");
      error.details = { source: "binance-futures", cause: "restricted location" };
      throw error;
    },
    loadJournal: async () => [],
    saveJournal: async () => {},
    notifier: {
      enabled: true,
      sendMessage: async (message) => {
        sent.push(message);
        return { ok: true };
      }
    },
    now: () => new Date("2026-06-21T08:00:00.000Z"),
    setTimer: () => null,
    clearTimer: () => {},
    logger: { error: () => {} }
  });

  const result = await monitor.runOnce();

  assert.equal(result.ok, false);
  assert.equal(result.error, "Binance futures ticker scan failed");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("数据源异常"));
  assert.ok(sent[0].includes("restricted location"));
});
