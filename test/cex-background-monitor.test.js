const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
