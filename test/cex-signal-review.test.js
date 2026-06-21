const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCexSignalReview } = require("../lib/cex-signal-review");

test("builds continuation bull case for high-attention controlled risk", () => {
  const review = buildCexSignalReview({
    symbol: "UPUSDT",
    attentionScore: 88,
    riskScore: 35,
    phase: "acceleration",
    tags: ["无币安现货", "合约放量", "外部锚同步", "合约量主导", "Funding正常"],
    warnings: [],
    confidence: "high",
    expectationConfidence: "high",
    shortTermBias: "bullish",
    actionBias: "watch-long",
    futuresToAnchorVolumeRatio: 9,
    anchorDispersionPct: 0.2,
    fundingRate: 0.00005,
    adlRisk: "LOW"
  });

  assert.equal(review.reviewLabel, "continuation");
  assert.equal(review.decisionConfidence, "high");
  assert.ok(review.bullCase.includes("外部锚同步"));
  assert.ok(review.bullCase.includes("合约量主导"));
  assert.ok(review.bullCase.includes("Funding正常"));
  assert.deepEqual(review.riskGate, []);
  assert.equal(review.decisionSummary, "高关注且外部锚同步，风险未失控，适合观察延续。");
});

test("builds fade-risk bear case for crowded pullback", () => {
  const review = buildCexSignalReview({
    symbol: "FADEUSDT",
    attentionScore: 84,
    riskScore: 78,
    phase: "failed-breakout-risk",
    tags: ["无币安现货", "合约放量", "冲高回落", "ADL拥挤", "Funding异常"],
    warnings: [],
    confidence: "high",
    expectationConfidence: "medium",
    shortTermBias: "bearish",
    actionBias: "watch-short",
    markIndexPremiumPct: 0.5,
    fundingRate: 0.0012,
    adlRisk: "HIGH"
  });

  assert.equal(review.reviewLabel, "fade-risk");
  assert.equal(review.decisionConfidence, "medium");
  assert.ok(review.bearCase.includes("冲高回落"));
  assert.ok(review.bearCase.includes("ADL拥挤"));
  assert.ok(review.bearCase.includes("Funding异常"));
  assert.ok(review.riskGate.includes("高关注与高风险同时出现"));
  assert.equal(review.decisionSummary, "合约拥挤后冲高回落，短线更偏风险释放，适合观察做空或等待反弹失败。");
});

test("builds avoid risk gate for same-symbol anchor risk", () => {
  const review = buildCexSignalReview({
    symbol: "RISKUSDT",
    attentionScore: 74,
    riskScore: 80,
    phase: "same-symbol-risk",
    tags: ["同名币风险", "锚价分歧"],
    warnings: ["Gateio RISK_USDT 与参考价偏离 45.0%"],
    confidence: "low",
    expectationConfidence: "low",
    shortTermBias: "volatile-unclear",
    actionBias: "avoid"
  });

  assert.equal(review.reviewLabel, "avoid");
  assert.equal(review.decisionConfidence, "low");
  assert.ok(review.riskGate.includes("同名币或锚价无法验证"));
  assert.ok(review.bearCase.includes("锚价分歧"));
  assert.equal(review.decisionSummary, "锚价无法验证，当前信号不适合交易观察。");
});

test("assembled token includes signalReview", () => {
  const { assembleCexToken } = require("../lib/cex-radar");

  const token = assembleCexToken({
    symbol: "UPUSDT",
    baseAsset: "UP",
    lastPrice: 10,
    priceChange24h: 18,
    high24h: 10.2,
    low24h: 8.2,
    quoteVolume24h: 140_000_000,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "UP_USDT", price: 10.01, weight: 0.4 },
      { exchange: "binance_future", symbol: "UPUSDT", price: 10, weight: 0.6 }
    ],
    anchorDispersionPct: 0.1,
    futuresToAnchorVolumeRatio: 9,
    markIndexPremiumPct: 0.02,
    fundingRate: 0.00005,
    adlRisk: "LOW",
    sameSymbolMismatches: []
  });

  assert.equal(token.signalReview.reviewLabel, "continuation");
  assert.ok(token.signalReview.bullCase.includes("外部锚同步"));
});
