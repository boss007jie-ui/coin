const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assembleCexToken,
  buildSpotSymbolSet,
  deriveCexAction,
  deriveCexExpectation,
  filterNoSpotFutures,
  normalizeFuturesTicker,
  toFiniteNumber,
  rankFastCandidates
} = require("../lib/cex-radar");

test("filters USDT futures that have no ordinary Binance Spot pair", () => {
  const futuresRows = [
    {
      symbol: "LABUSDT",
      lastPrice: "16.88",
      priceChangePercent: "21.6",
      highPrice: "18.78",
      lowPrice: "13.33",
      quoteVolume: "376176179"
    },
    {
      symbol: "BTCUSDT",
      lastPrice: "65000",
      priceChangePercent: "1.2",
      highPrice: "66000",
      lowPrice: "64000",
      quoteVolume: "2100000000"
    },
    {
      symbol: "ILLQUSDT",
      lastPrice: "0.2",
      priceChangePercent: "80",
      highPrice: "0.3",
      lowPrice: "0.1",
      quoteVolume: "999"
    },
    {
      symbol: "ETHUSDC",
      lastPrice: "3500",
      priceChangePercent: "4",
      highPrice: "3600",
      lowPrice: "3400",
      quoteVolume: "90000000"
    }
  ];
  const spotSymbols = buildSpotSymbolSet(new Map([["BTCUSDT", {}]]));

  const filtered = filterNoSpotFutures(futuresRows, spotSymbols, { minQuoteVolume: 5_000_000 });
  const ranked = rankFastCandidates(filtered, 10);

  assert.deepEqual(ranked.map((row) => row.symbol), ["LABUSDT"]);
  assert.equal(ranked[0].baseAsset, "LAB");
  assert.equal(ranked[0].hasBinanceSpot, false);
  assert.equal(ranked[0].quoteVolume24h, 376176179);
});

test("normalizes blank strings and zero-valued derived metrics", () => {
  assert.equal(toFiniteNumber(" "), null);

  const normalized = normalizeFuturesTicker({
    symbol: "ZEROUSDT",
    lastPrice: "0",
    highPrice: "0",
    lowPrice: "0",
    priceChangePercent: "0",
    quoteVolume: "0"
  });

  assert.equal(normalized.highLowRangePct, null);
  assert.equal(normalized.pullbackFromHighPct, null);
});

test("flags same-symbol anchor prices that diverge from Binance reference", () => {
  const constituents = [
    { exchange: "gateio", symbol: "RAVE_USDT", price: "0.4055", weight: "0.2" },
    { exchange: "bitget", symbol: "RAVEUSDT", price: "0.2746", weight: "0.3" },
    { exchange: "binance_future", symbol: "RAVEUSDT", price: "0.2749", weight: "0.3" },
    { exchange: "binance_alpha", symbol: "RAVEUSDT", price: "0.2737", weight: "0.2" }
  ];

  const {
    calculateAnchorDispersionPct,
    splitConstituentsBySymbolMatch
  } = require("../lib/cex-radar");

  const split = splitConstituentsBySymbolMatch(constituents, 0.2749, 8);
  const dispersion = calculateAnchorDispersionPct(constituents, 0.2749);

  assert.equal(split.matched.length, 3);
  assert.equal(split.mismatched.length, 1);
  assert.equal(split.mismatched[0].exchange, "gateio");
  assert.ok(dispersion > 40);
});

test("puts valid constituents in unvalidated when reference price is invalid", () => {
  const { splitConstituentsBySymbolMatch } = require("../lib/cex-radar");
  const split = splitConstituentsBySymbolMatch([
    { exchange: "gateio", symbol: "RAVE_USDT", price: "0.4055", weight: "0.2" },
    { exchange: "bitget", symbol: "RAVEUSDT", price: "", weight: "0.3" }
  ], null, 8);

  assert.equal(split.matched.length, 0);
  assert.equal(split.mismatched.length, 0);
  assert.equal(split.unvalidated.length, 1);
  assert.equal(split.unvalidated[0].exchange, "gateio");
});

test("keeps exact tolerance matches and flags prices beyond tolerance", () => {
  const { splitConstituentsBySymbolMatch } = require("../lib/cex-radar");
  const split = splitConstituentsBySymbolMatch([
    { exchange: "exact", symbol: "TESTUSDT", price: "108", weight: "0.5" },
    { exchange: "beyond", symbol: "TESTUSDT", price: "108.01", weight: "0.5" }
  ], 100, 8);

  assert.equal(split.matched.length, 1);
  assert.equal(split.mismatched.length, 1);
  assert.equal(split.unvalidated.length, 0);
  assert.equal(split.matched[0].exchange, "exact");
  assert.equal(split.mismatched[0].exchange, "beyond");
});

test("returns zero anchor dispersion when constituent prices are blank or zero", () => {
  const { calculateAnchorDispersionPct } = require("../lib/cex-radar");

  assert.equal(calculateAnchorDispersionPct([{ price: "" }, { price: "0" }], 100), 0);
});

test("scores LAB-like pullback structure as high attention and high risk", () => {
  const {
    classifyCexPhase,
    scoreCexCandidate
  } = require("../lib/cex-radar");

  const candidate = {
    symbol: "LABUSDT",
    baseAsset: "LAB",
    lastPrice: 16.884,
    priceChange24h: 21.67,
    high24h: 18.787,
    low24h: 13.331,
    quoteVolume24h: 376_176_179,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "LAB_USDT", price: 16.851, weight: 0.3333 },
      { exchange: "binance_future", symbol: "LABUSDT", price: 16.854, weight: 0.2222 },
      { exchange: "binance_alpha", symbol: "LABUSDT", price: 16.8624, weight: 0.3333 }
    ],
    anchorDispersionPct: 0.07,
    futuresToAnchorVolumeRatio: 15.6,
    markIndexPremiumPct: 0.01,
    fundingRate: 0.00005,
    openInterest: 12_000_000,
    adlRisk: "HIGH",
    sameSymbolMismatches: []
  };

  const scores = scoreCexCandidate(candidate);
  const phase = classifyCexPhase(candidate, scores);

  assert.equal(scores.attentionScore, 100);
  assert.ok(scores.riskScore >= 60);
  assert.equal(phase, "pullback-watch");
  assert.ok(scores.tags.includes("无币安现货"));
  assert.ok(scores.tags.includes("合约放量"));
  assert.ok(scores.tags.includes("合约量主导"));
  assert.ok(scores.tags.includes("外部锚同步"));
  assert.ok(scores.tags.includes("冲高回落"));
  assert.ok(scores.tags.includes("ADL拥挤"));
  assert.ok(scores.tags.includes("Funding正常"));
});

test("same-symbol mismatch dominates phase and warning output", () => {
  const {
    classifyCexPhase,
    scoreCexCandidate
  } = require("../lib/cex-radar");

  const candidate = {
    symbol: "RAVEUSDT",
    baseAsset: "RAVE",
    lastPrice: 0.2749,
    priceChange24h: -5.5,
    high24h: 0.31,
    low24h: 0.25,
    quoteVolume24h: 10_037_086,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "RAVE_USDT", price: 0.4055, weight: 0.2 },
      { exchange: "bitget", symbol: "RAVEUSDT", price: 0.2746, weight: 0.3 },
      { exchange: "binance_future", symbol: "RAVEUSDT", price: 0.2749, weight: 0.3 }
    ],
    anchorDispersionPct: 47.6,
    futuresToAnchorVolumeRatio: null,
    markIndexPremiumPct: 0.15,
    fundingRate: 0.000062,
    openInterest: null,
    adlRisk: "MIDDLE",
    sameSymbolMismatches: [{ exchange: "gateio", symbol: "RAVE_USDT", priceDiffPct: 47.5 }]
  };

  const scores = scoreCexCandidate(candidate);
  const phase = classifyCexPhase(candidate, scores);

  assert.equal(phase, "same-symbol-risk");
  assert.ok(scores.tags.includes("同名币风险"));
  assert.ok(scores.tags.includes("锚价分歧"));
  assert.ok(scores.warnings.some((warning) => warning.includes("Gateio")));
});

test("omits sync and funding tags without valid external anchor or finite funding", () => {
  const { scoreCexCandidate } = require("../lib/cex-radar");

  const scores = scoreCexCandidate({
    symbol: "NOANCHORUSDT",
    baseAsset: "NOANCHOR",
    lastPrice: 1,
    priceChange24h: 2,
    high24h: 1.1,
    low24h: 0.9,
    quoteVolume24h: 6_000_000,
    hasBinanceSpot: false,
    indexConstituents: [{ exchange: "binance_future", symbol: "NOANCHORUSDT", price: 1, weight: 1 }],
    anchorDispersionPct: 0,
    futuresToAnchorVolumeRatio: null,
    markIndexPremiumPct: 0,
    fundingRate: null,
    sameSymbolMismatches: []
  });

  assert.equal(scores.confidence, "low");
  assert.ok(!scores.tags.includes("外部锚同步"));
  assert.ok(!scores.tags.includes("Funding正常"));
  assert.ok(!scores.tags.includes("Funding异常"));
});

test("invalid external anchor price does not count as sync evidence", () => {
  const { scoreCexCandidate } = require("../lib/cex-radar");

  const scores = scoreCexCandidate({
    symbol: "BLANKANCHORUSDT",
    baseAsset: "BLANKANCHOR",
    lastPrice: 1,
    priceChange24h: 2,
    high24h: 1.1,
    low24h: 0.9,
    quoteVolume24h: 6_000_000,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "BLANKANCHOR_USDT", price: "", weight: 0.5 },
      { exchange: "binance_future", symbol: "BLANKANCHORUSDT", price: 1, weight: 0.5 }
    ],
    anchorDispersionPct: 0,
    futuresToAnchorVolumeRatio: 9,
    markIndexPremiumPct: 0,
    fundingRate: 0.00001,
    sameSymbolMismatches: []
  });

  assert.equal(scores.confidence, "low");
  assert.ok(!scores.tags.includes("外部锚同步"));
});

test("anchor dispersion of three is divergence not external sync", () => {
  const { scoreCexCandidate } = require("../lib/cex-radar");

  const scores = scoreCexCandidate({
    symbol: "BOUNDARYUSDT",
    baseAsset: "BOUNDARY",
    lastPrice: 1,
    priceChange24h: 2,
    high24h: 1.1,
    low24h: 0.9,
    quoteVolume24h: 6_000_000,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "BOUNDARY_USDT", price: 1.03, weight: 0.5 },
      { exchange: "binance_future", symbol: "BOUNDARYUSDT", price: 1, weight: 0.5 }
    ],
    anchorDispersionPct: 3,
    futuresToAnchorVolumeRatio: null,
    markIndexPremiumPct: 0,
    fundingRate: 0.00001,
    sameSymbolMismatches: []
  });

  assert.ok(scores.tags.includes("锚价分歧"));
  assert.ok(!scores.tags.includes("外部锚同步"));
});

test("assembles a UI-ready token with capped 0-100 scores", () => {
  const { assembleCexToken } = require("../lib/cex-radar");

  const token = assembleCexToken({
    symbol: "BEATUSDT",
    baseAsset: "BEAT",
    lastPrice: 1.882,
    priceChange24h: 2.17,
    high24h: 1.98,
    low24h: 1.459,
    quoteVolume24h: 157_911_622,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "BEAT_USDT", price: 1.8851, weight: 0.2 },
      { exchange: "mxc", symbol: "BEATUSDT", price: 1.882, weight: 0.25 },
      { exchange: "binance_alpha", symbol: "BEATUSDT", price: 1.8678, weight: 0.35 }
    ],
    anchorDispersionPct: 0.92,
    futuresToAnchorVolumeRatio: 15.4,
    markIndexPremiumPct: 0.0,
    fundingRate: 0.00005,
    openInterest: 3_000_000,
    adlRisk: "HIGH",
    sameSymbolMismatches: []
  });

  assert.equal(token.symbol, "BEATUSDT");
  assert.equal(token.baseAsset, "BEAT");
  assert.equal(token.hasBinanceSpot, false);
  assert.equal(token.openInterest, 3_000_000);
  assert.ok(token.attentionScore >= 70);
  assert.ok(token.riskScore >= 50);
  assert.ok(["high-risk-extension", "pullback-watch", "acceleration"].includes(token.phase));
  assert.equal(token.confidence, "high");
});

test("does not tag external sync from one anchor without finite dispersion", () => {
  const { assembleCexToken } = require("../lib/cex-radar");

  const token = assembleCexToken({
    symbol: "SOLOUSDT",
    baseAsset: "SOLO",
    lastPrice: 1,
    priceChange24h: 4,
    high24h: 1.1,
    low24h: 0.95,
    quoteVolume24h: 8_000_000,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "SOLO_USDT", price: 1.01, weight: 1 }
    ],
    anchorDispersionPct: null,
    futuresToAnchorVolumeRatio: null,
    markIndexPremiumPct: 0,
    fundingRate: null,
    openInterest: null,
    adlRisk: null,
    sameSymbolMismatches: []
  });

  assert.ok(!token.tags.includes("外部锚同步"));
  assert.equal(token.confidence, "medium");
});

test("does not reward anchor dispersion when no valid external anchor exists", () => {
  const { scoreCexCandidate } = require("../lib/cex-radar");

  const withoutAnchor = scoreCexCandidate({
    symbol: "NOANCHORUSDT",
    baseAsset: "NOANCHOR",
    lastPrice: 1,
    priceChange24h: 0,
    high24h: null,
    low24h: null,
    quoteVolume24h: 1_000,
    hasBinanceSpot: true,
    indexConstituents: [{ exchange: "binance_future", symbol: "NOANCHORUSDT", price: 1, weight: 1 }],
    anchorDispersionPct: 0,
    futuresToAnchorVolumeRatio: null,
    markIndexPremiumPct: 0,
    fundingRate: null,
    sameSymbolMismatches: []
  });

  const withAnchor = scoreCexCandidate({
    symbol: "ANCHORUSDT",
    baseAsset: "ANCHOR",
    lastPrice: 1,
    priceChange24h: 0,
    high24h: null,
    low24h: null,
    quoteVolume24h: 1_000,
    hasBinanceSpot: true,
    indexConstituents: [
      { exchange: "gateio", symbol: "ANCHOR_USDT", price: 1, weight: 0.5 },
      { exchange: "binance_future", symbol: "ANCHORUSDT", price: 1, weight: 0.5 }
    ],
    anchorDispersionPct: 0,
    futuresToAnchorVolumeRatio: null,
    markIndexPremiumPct: 0,
    fundingRate: null,
    sameSymbolMismatches: []
  });

  assert.equal(withoutAnchor.attentionScore, 0);
  assert.equal(withAnchor.attentionScore, 25);
  assert.ok(!withoutAnchor.tags.includes("外部锚同步"));
  assert.ok(withAnchor.tags.includes("外部锚同步"));
});

test("builds scan summary counts from tokens", () => {
  const { buildCexScanSummary } = require("../lib/cex-radar");

  const summary = buildCexScanSummary({
    scannedFutures: 420,
    withoutBinanceSpot: 37,
    deepInspected: 2,
    tokens: [
      { attentionScore: 100, riskScore: 62 },
      { attentionScore: 45, riskScore: 72 }
    ]
  });

  assert.deepEqual(summary, {
    scannedFutures: 420,
    withoutBinanceSpot: 37,
    deepInspected: 2,
    attentionCount: 1,
    riskCount: 2
  });
});

test("assembles unknown Binance Spot state as null without no-spot tag", () => {
  const { assembleCexToken } = require("../lib/cex-radar");

  const token = assembleCexToken({
    symbol: "UNKNOWNUSDT",
    baseAsset: "UNKNOWN",
    lastPrice: 1,
    priceChange24h: 1,
    high24h: 1.02,
    low24h: 0.98,
    quoteVolume24h: 6_000_000,
    indexConstituents: [],
    anchorDispersionPct: null,
    futuresToAnchorVolumeRatio: null,
    markIndexPremiumPct: null,
    fundingRate: null,
    openInterest: null,
    adlRisk: null,
    sameSymbolMismatches: []
  });

  assert.equal(token.hasBinanceSpot, null);
  assert.ok(!token.tags.includes("无币安现货"));
});

test("normalizes scan summary counters and ignores non-finite token scores", () => {
  const { buildCexScanSummary } = require("../lib/cex-radar");

  const invalidSummary = buildCexScanSummary({
    scannedFutures: "abc",
    withoutBinanceSpot: -3,
    deepInspected: Infinity,
    tokens: [
      { attentionScore: Infinity, riskScore: NaN },
      { attentionScore: "100", riskScore: "60" },
      { attentionScore: 70, riskScore: 50 }
    ]
  });

  assert.deepEqual(invalidSummary, {
    scannedFutures: 0,
    withoutBinanceSpot: 0,
    deepInspected: 0,
    attentionCount: 1,
    riskCount: 1
  });

  const numericStringSummary = buildCexScanSummary({
    scannedFutures: "4",
    withoutBinanceSpot: "2",
    deepInspected: "1",
    tokens: []
  });

  assert.deepEqual(numericStringSummary, {
    scannedFutures: 4,
    withoutBinanceSpot: 2,
    deepInspected: 1,
    attentionCount: 0,
    riskCount: 0
  });
});

test("assembled score and phase mirror direct scoring and classification", () => {
  const {
    assembleCexToken,
    classifyCexPhase,
    scoreCexCandidate
  } = require("../lib/cex-radar");

  const candidate = {
    symbol: "MIRRORUSDT",
    baseAsset: "MIRROR",
    lastPrice: 4.2,
    priceChange24h: 11,
    high24h: 4.8,
    low24h: 3.7,
    quoteVolume24h: 45_000_000,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "MIRROR_USDT", price: 4.19, weight: 0.4 },
      { exchange: "binance_alpha", symbol: "MIRRORUSDT", price: 4.2, weight: 0.6 }
    ],
    anchorDispersionPct: 0.25,
    futuresToAnchorVolumeRatio: 8.5,
    markIndexPremiumPct: 0.02,
    fundingRate: 0.00004,
    openInterest: 900_000,
    adlRisk: "MIDDLE",
    sameSymbolMismatches: []
  };

  const token = assembleCexToken(candidate);
  const scores = scoreCexCandidate(candidate);
  const phase = classifyCexPhase(candidate, scores);

  assert.equal(token.attentionScore, scores.attentionScore);
  assert.equal(token.riskScore, scores.riskScore);
  assert.equal(token.phase, phase);
});

test("derives bullish short-term expectation and watch-long action for controlled acceleration", () => {
  const candidate = {
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
  };

  const token = assembleCexToken(candidate);

  assert.equal(token.shortTermBias, "bullish");
  assert.deepEqual(token.expectedMovePctRange, {
    lower: 8,
    upper: 18,
    label: "+8% ~ +18%"
  });
  assert.equal(token.expectationConfidence, "high");
  assert.ok(token.expectationReasons.includes("高关注且风险未失控"));
  assert.equal(token.actionBias, "watch-long");
  assert.equal(token.actionSetup, "breakout-continuation");
  assert.ok(token.actionReasons.includes("外部锚同步"));
});

test("derives bearish expectation and watch-short action for crowded pullback", () => {
  const candidate = {
    symbol: "FADEUSDT",
    baseAsset: "FADE",
    lastPrice: 7.4,
    priceChange24h: 4,
    high24h: 10,
    low24h: 6.9,
    quoteVolume24h: 180_000_000,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "FADE_USDT", price: 7.35, weight: 0.5 },
      { exchange: "binance_future", symbol: "FADEUSDT", price: 7.4, weight: 0.5 }
    ],
    anchorDispersionPct: 0.7,
    futuresToAnchorVolumeRatio: 18,
    markIndexPremiumPct: 0.5,
    fundingRate: 0.0012,
    adlRisk: "HIGH",
    sameSymbolMismatches: []
  };

  const token = assembleCexToken(candidate);

  assert.equal(token.shortTermBias, "bearish");
  assert.deepEqual(token.expectedMovePctRange, {
    lower: -25,
    upper: -10,
    label: "-25% ~ -10%"
  });
  assert.equal(token.actionBias, "watch-short");
  assert.equal(token.actionSetup, "blowoff-fade");
  assert.ok(token.expectationReasons.includes("冲高回落风险"));
  assert.ok(token.actionReasons.includes("ADL拥挤"));
});

test("downgrades same-symbol risk to avoid with low confidence", () => {
  const candidate = {
    symbol: "RISKUSDT",
    baseAsset: "RISK",
    lastPrice: 1,
    priceChange24h: 12,
    high24h: 1.2,
    low24h: 0.8,
    quoteVolume24h: 80_000_000,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "RISK_USDT", price: 1.45, weight: 0.4 },
      { exchange: "binance_future", symbol: "RISKUSDT", price: 1, weight: 0.6 }
    ],
    anchorDispersionPct: 45,
    futuresToAnchorVolumeRatio: null,
    markIndexPremiumPct: 0.1,
    fundingRate: 0.00002,
    adlRisk: "MIDDLE",
    sameSymbolMismatches: [
      { exchange: "gateio", symbol: "RISK_USDT", priceDiffPct: 45 }
    ]
  };

  const token = assembleCexToken(candidate);

  assert.equal(token.shortTermBias, "volatile-unclear");
  assert.deepEqual(token.expectedMovePctRange, {
    lower: -20,
    upper: 20,
    label: "-20% ~ +20%"
  });
  assert.equal(token.expectationConfidence, "low");
  assert.ok(token.expectationReasons.includes("同名币或锚价风险"));
  assert.equal(token.actionBias, "avoid");
  assert.equal(token.actionSetup, "same-symbol-avoid");
  assert.equal(token.invalidLevel, "锚价无法验证，暂不设失效位");
});
