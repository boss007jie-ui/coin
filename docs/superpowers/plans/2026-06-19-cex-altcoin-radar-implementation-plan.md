# CEX Altcoin Radar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend-only CEX altcoin radar endpoint that scans Binance USDT perpetuals, filters coins without ordinary Binance Spot pairs, deep-inspects LAB/RAVE/BEAT-like structures, and returns explainable monitoring scores.

**Architecture:** Keep the existing `/api/radar/scan` untouched and add a separate `/api/radar/cex-scan` route. Put deterministic filtering, scoring, same-symbol validation, and token assembly in `lib/cex-radar.js`; put network orchestration and short-lived scan caching in `lib/cex-radar-service.js`; keep `server.js` as the HTTP wiring layer. Use dependency injection in the service so tests can run without live network calls.

**Tech Stack:** Node.js 20+, CommonJS, native `node:test`, native `assert`, existing `fetchJsonWithFallback`, Binance USDⓈ-M public endpoints, Gate.io public spot ticker for Gate anchor volume.

---

## Source Notes

Use these public endpoints in the service:

- Binance USDⓈ-M 24h ticker: `https://fapi.binance.com/fapi/v1/ticker/24hr`
- Binance USDⓈ-M index constituents: `https://fapi.binance.com/fapi/v1/constituents?symbol=LABUSDT`
- Binance USDⓈ-M mark/index/funding: `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=LABUSDT`
- Binance USDⓈ-M open interest: `https://fapi.binance.com/fapi/v1/openInterest?symbol=LABUSDT`
- Binance USDⓈ-M symbol ADL risk: `https://fapi.binance.com/fapi/v1/symbolAdlRisk?symbol=LABUSDT`
- Gate.io spot ticker: `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=LAB_USDT`

Official docs checked:

- Binance index constituents: `https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Index-Constituents`
- Binance ADL risk: `https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/ADL-Risk`

## File Structure

- Create: `lib/cex-radar.js`
  - Pure helper module.
  - Responsible for number parsing, futures candidate filtering, same-symbol validation, scoring, phase classification, response summary assembly.
- Create: `lib/cex-radar-service.js`
  - Network scanner factory with injected dependencies.
  - Responsible for Binance/Gate requests, per-scan cache, deep inspection cap, partial error collection.
- Create: `test/cex-radar.test.js`
  - Tests pure helper behavior with LAB/RAVE/BEAT-like fixtures.
- Create: `test/cex-radar-service.test.js`
  - Tests scan orchestration with fake fetchers and no network.
- Modify: `package.json`
  - Add `"test": "node --test"`.
- Modify: `server.js`
  - Require `createCexRadarScanner`.
  - Add `GET /api/radar/cex-scan`.
  - Add a small `getCexRadarScanner()` wrapper that injects existing network helpers.

## Task 1: Add Test Harness And First Failing Helper Test

**Files:**
- Modify: `package.json`
- Create: `test/cex-radar.test.js`

- [ ] **Step 1: Add the test command**

Change the `scripts` block in `package.json` to:

```json
"scripts": {
  "start": "node server.js",
  "test": "node --test"
}
```

- [ ] **Step 2: Write the first failing test**

Create `test/cex-radar.test.js` with this content:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSpotSymbolSet,
  filterNoSpotFutures,
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
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
npm test -- test/cex-radar.test.js
```

Expected output:

```text
not ok 1 - test/cex-radar.test.js
Error: Cannot find module '../lib/cex-radar'
```

## Task 2: Implement Candidate Filtering Helpers

**Files:**
- Create: `lib/cex-radar.js`
- Test: `test/cex-radar.test.js`

- [ ] **Step 1: Write minimal implementation for the first test**

Create `lib/cex-radar.js` with this content:

```js
const DEFAULT_MIN_QUOTE_VOLUME = 5_000_000;

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function baseAssetFromUsdtSymbol(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  return normalized.endsWith("USDT") ? normalized.slice(0, -4) : "";
}

function buildSpotSymbolSet(input) {
  if (input instanceof Map) {
    return new Set([...input.keys()].map((symbol) => String(symbol).toUpperCase()));
  }
  if (input instanceof Set) {
    return new Set([...input].map((symbol) => String(symbol).toUpperCase()));
  }
  if (Array.isArray(input)) {
    return new Set(input.map((row) => String(row.symbol || row).toUpperCase()).filter(Boolean));
  }
  return new Set();
}

function normalizeFuturesTicker(row) {
  const symbol = String(row?.symbol || "").toUpperCase();
  const baseAsset = baseAssetFromUsdtSymbol(symbol);
  const lastPrice = toFiniteNumber(row?.lastPrice);
  const priceChange24h = toFiniteNumber(row?.priceChangePercent);
  const high24h = toFiniteNumber(row?.highPrice);
  const low24h = toFiniteNumber(row?.lowPrice);
  const quoteVolume24h = toFiniteNumber(row?.quoteVolume);
  const highLowRangePct = high24h && low24h && low24h > 0 ? ((high24h - low24h) / low24h) * 100 : null;
  const pullbackFromHighPct = high24h && lastPrice && high24h > 0 ? ((high24h - lastPrice) / high24h) * 100 : null;

  return {
    symbol,
    baseAsset,
    lastPrice,
    priceChange24h,
    high24h,
    low24h,
    quoteVolume24h,
    highLowRangePct,
    pullbackFromHighPct
  };
}

function filterNoSpotFutures(futuresRows, spotSymbols, options = {}) {
  const minQuoteVolume = toFiniteNumber(options.minQuoteVolume) ?? DEFAULT_MIN_QUOTE_VOLUME;
  const spotSet = buildSpotSymbolSet(spotSymbols);

  return (Array.isArray(futuresRows) ? futuresRows : [])
    .map(normalizeFuturesTicker)
    .filter((row) => row.symbol.endsWith("USDT"))
    .filter((row) => row.baseAsset && !row.symbol.includes("_"))
    .filter((row) => !spotSet.has(row.symbol))
    .filter((row) => (row.quoteVolume24h || 0) >= minQuoteVolume)
    .map((row) => ({ ...row, hasBinanceSpot: false }));
}

function fastRankScore(row) {
  const volumeScore = Math.log10(Math.max(row.quoteVolume24h || 1, 1));
  const moveScore = Math.abs(row.priceChange24h || 0) / 5;
  const rangeScore = (row.highLowRangePct || 0) / 8;
  return volumeScore + moveScore + rangeScore;
}

function rankFastCandidates(candidates, limit = 50) {
  return [...(Array.isArray(candidates) ? candidates : [])]
    .sort((a, b) => fastRankScore(b) - fastRankScore(a))
    .slice(0, limit);
}

module.exports = {
  buildSpotSymbolSet,
  filterNoSpotFutures,
  normalizeFuturesTicker,
  rankFastCandidates,
  toFiniteNumber
};
```

- [ ] **Step 2: Run the test and verify GREEN**

Run:

```bash
npm test -- test/cex-radar.test.js
```

Expected output:

```text
# pass 1
# fail 0
```

## Task 3: Add Same-Symbol Validation Tests And Helpers

**Files:**
- Modify: `test/cex-radar.test.js`
- Modify: `lib/cex-radar.js`

- [ ] **Step 1: Append the failing same-symbol test**

Append this test to `test/cex-radar.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- test/cex-radar.test.js
```

Expected output:

```text
TypeError: splitConstituentsBySymbolMatch is not a function
```

- [ ] **Step 3: Add validation helpers**

Add these functions above `module.exports` in `lib/cex-radar.js`:

```js
function normalizeConstituent(row) {
  return {
    exchange: String(row?.exchange || "").toLowerCase(),
    symbol: String(row?.symbol || "").toUpperCase(),
    price: toFiniteNumber(row?.price),
    weight: toFiniteNumber(row?.weight)
  };
}

function calculatePriceDiffPct(price, referencePrice) {
  if (!Number.isFinite(price) || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return null;
  }
  return Math.abs((price - referencePrice) / referencePrice) * 100;
}

function splitConstituentsBySymbolMatch(constituents, referencePrice, tolerancePct = 8) {
  const matched = [];
  const mismatched = [];
  const normalized = (Array.isArray(constituents) ? constituents : [])
    .map(normalizeConstituent)
    .filter((row) => Number.isFinite(row.price) && row.price > 0);

  for (const row of normalized) {
    const priceDiffPct = calculatePriceDiffPct(row.price, referencePrice);
    const enriched = { ...row, priceDiffPct };
    if (Number.isFinite(priceDiffPct) && priceDiffPct > tolerancePct) {
      mismatched.push(enriched);
    } else {
      matched.push(enriched);
    }
  }

  return { matched, mismatched };
}

function calculateAnchorDispersionPct(constituents, referencePrice = null) {
  const prices = (Array.isArray(constituents) ? constituents : [])
    .map((row) => toFiniteNumber(row?.price))
    .filter((price) => Number.isFinite(price) && price > 0);

  if (prices.length < 2) {
    return 0;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const denominator = Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : min;
  return ((max - min) / denominator) * 100;
}
```

Update the `module.exports` block to:

```js
module.exports = {
  buildSpotSymbolSet,
  calculateAnchorDispersionPct,
  filterNoSpotFutures,
  normalizeConstituent,
  normalizeFuturesTicker,
  rankFastCandidates,
  splitConstituentsBySymbolMatch,
  toFiniteNumber
};
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
npm test -- test/cex-radar.test.js
```

Expected output:

```text
# pass 2
# fail 0
```

## Task 4: Add Scoring And Phase Tests

**Files:**
- Modify: `test/cex-radar.test.js`
- Modify: `lib/cex-radar.js`

- [ ] **Step 1: Append the failing scoring tests**

Append these tests to `test/cex-radar.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- test/cex-radar.test.js
```

Expected output:

```text
TypeError: scoreCexCandidate is not a function
```

- [ ] **Step 3: Add scoring helpers**

Add these functions above `module.exports` in `lib/cex-radar.js`:

```js
function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function addUnique(list, item) {
  if (item && !list.includes(item)) {
    list.push(item);
  }
}

function getPullbackFromHighPct(candidate) {
  if (Number.isFinite(candidate?.pullbackFromHighPct)) {
    return candidate.pullbackFromHighPct;
  }
  const high = toFiniteNumber(candidate?.high24h);
  const last = toFiniteNumber(candidate?.lastPrice);
  if (!Number.isFinite(high) || !Number.isFinite(last) || high <= 0) {
    return null;
  }
  return ((high - last) / high) * 100;
}

function getHighLowRangePct(candidate) {
  if (Number.isFinite(candidate?.highLowRangePct)) {
    return candidate.highLowRangePct;
  }
  const high = toFiniteNumber(candidate?.high24h);
  const low = toFiniteNumber(candidate?.low24h);
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) {
    return null;
  }
  return ((high - low) / low) * 100;
}

function hasExternalAnchor(candidate) {
  return (candidate.indexConstituents || []).some((row) => {
    const exchange = String(row.exchange || "").toLowerCase();
    return exchange && exchange !== "binance_future";
  });
}

function scoreCexCandidate(candidate) {
  const tags = [];
  const warnings = [];
  const quoteVolume = toFiniteNumber(candidate?.quoteVolume24h) || 0;
  const priceChange = Math.abs(toFiniteNumber(candidate?.priceChange24h) || 0);
  const rangePct = getHighLowRangePct(candidate);
  const pullbackPct = getPullbackFromHighPct(candidate);
  const anchorDispersionPct = toFiniteNumber(candidate?.anchorDispersionPct);
  const futuresToAnchorVolumeRatio = toFiniteNumber(candidate?.futuresToAnchorVolumeRatio);
  const markIndexPremiumPct = Math.abs(toFiniteNumber(candidate?.markIndexPremiumPct) || 0);
  const fundingAbs = Math.abs(toFiniteNumber(candidate?.fundingRate) || 0);
  const adlRisk = String(candidate?.adlRisk || "").toUpperCase();
  const mismatches = Array.isArray(candidate?.sameSymbolMismatches) ? candidate.sameSymbolMismatches : [];

  let attentionScore = 0;
  let riskScore = 0;

  if (candidate?.hasBinanceSpot === false) {
    attentionScore += 20;
    addUnique(tags, "无币安现货");
  }

  if (quoteVolume >= 100_000_000) {
    attentionScore += 20;
    addUnique(tags, "合约放量");
  } else if (quoteVolume >= 20_000_000) {
    attentionScore += 14;
    addUnique(tags, "合约放量");
  } else if (quoteVolume >= 5_000_000) {
    attentionScore += 8;
  }

  if (priceChange >= 20) attentionScore += 15;
  else if (priceChange >= 10) attentionScore += 10;
  else if (priceChange >= 5) attentionScore += 5;

  if (Number.isFinite(rangePct) && rangePct >= 30) riskScore += 15;
  if (Number.isFinite(rangePct) && rangePct >= 30) attentionScore += 15;
  else if (Number.isFinite(rangePct) && rangePct >= 15) {
    attentionScore += 10;
    riskScore += 8;
  }

  if (hasExternalAnchor(candidate)) {
    attentionScore += 15;
  }

  if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct <= 1) {
    attentionScore += 10;
    addUnique(tags, "外部锚同步");
  } else if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct <= 3) {
    attentionScore += 5;
    addUnique(tags, "外部锚同步");
  } else if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) {
    riskScore += 15;
    addUnique(tags, "锚价分歧");
  } else if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 1) {
    riskScore += 8;
  }

  if (Number.isFinite(futuresToAnchorVolumeRatio) && futuresToAnchorVolumeRatio >= 15) {
    attentionScore += 15;
    riskScore += 15;
    addUnique(tags, "合约量主导");
  } else if (Number.isFinite(futuresToAnchorVolumeRatio) && futuresToAnchorVolumeRatio >= 8) {
    attentionScore += 10;
    riskScore += 10;
    addUnique(tags, "合约量主导");
  } else if (Number.isFinite(futuresToAnchorVolumeRatio) && futuresToAnchorVolumeRatio >= 3) {
    attentionScore += 5;
  }

  if (Number.isFinite(pullbackPct) && pullbackPct <= 5) {
    attentionScore += 10;
    addUnique(tags, "接近新高");
  } else if (Number.isFinite(pullbackPct) && pullbackPct <= 12) {
    attentionScore += 5;
  }

  if (Number.isFinite(pullbackPct) && pullbackPct >= 15) {
    riskScore += 20;
    addUnique(tags, "冲高回落");
  } else if (Number.isFinite(pullbackPct) && pullbackPct >= 8) {
    riskScore += 12;
    addUnique(tags, "冲高回落");
  }

  if (adlRisk === "HIGH") {
    riskScore += 20;
    addUnique(tags, "ADL拥挤");
  } else if (adlRisk === "MIDDLE" || adlRisk === "MEDIUM") {
    riskScore += 10;
  }

  if (markIndexPremiumPct >= 1) riskScore += 12;
  else if (markIndexPremiumPct >= 0.3) riskScore += 6;

  if (fundingAbs >= 0.001) {
    riskScore += 12;
    addUnique(tags, "Funding异常");
  } else if (fundingAbs >= 0.0003) {
    riskScore += 6;
    addUnique(tags, "Funding异常");
  } else {
    addUnique(tags, "Funding正常");
  }

  if (mismatches.length > 0) {
    riskScore += 25;
    addUnique(tags, "同名币风险");
    addUnique(tags, "锚价分歧");
    for (const mismatch of mismatches) {
      const exchange = String(mismatch.exchange || "unknown");
      const displayExchange = exchange.charAt(0).toUpperCase() + exchange.slice(1);
      const diff = Number.isFinite(mismatch.priceDiffPct) ? mismatch.priceDiffPct.toFixed(1) : "unknown";
      warnings.push(`${displayExchange} ${mismatch.symbol || ""} 与参考价偏离 ${diff}%`);
    }
  }

  const confidence = hasExternalAnchor(candidate)
    ? (Number.isFinite(futuresToAnchorVolumeRatio) ? "high" : "medium")
    : "low";

  return {
    attentionScore: clampScore(attentionScore),
    riskScore: clampScore(riskScore),
    tags,
    warnings,
    confidence
  };
}

function classifyCexPhase(candidate, scores) {
  const pullbackPct = getPullbackFromHighPct(candidate);
  const anchorDispersionPct = toFiniteNumber(candidate?.anchorDispersionPct);
  const markIndexPremiumPct = Math.abs(toFiniteNumber(candidate?.markIndexPremiumPct) || 0);
  const hasMismatch = Array.isArray(candidate?.sameSymbolMismatches) && candidate.sameSymbolMismatches.length > 0;

  if (hasMismatch) {
    return "same-symbol-risk";
  }

  if (
    scores.riskScore >= 70 &&
    Number.isFinite(pullbackPct) &&
    pullbackPct >= 8 &&
    ((Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) || markIndexPremiumPct >= 0.3)
  ) {
    return "failed-breakout-risk";
  }

  if (Number.isFinite(pullbackPct) && pullbackPct >= 8) {
    return "pullback-watch";
  }

  if (scores.attentionScore >= 70 && scores.riskScore >= 60) {
    return "high-risk-extension";
  }

  if (scores.attentionScore >= 70 && (!Number.isFinite(pullbackPct) || pullbackPct <= 5)) {
    return "acceleration";
  }

  return "candidate";
}
```

Update the `module.exports` block to include the new functions:

```js
module.exports = {
  buildSpotSymbolSet,
  calculateAnchorDispersionPct,
  classifyCexPhase,
  filterNoSpotFutures,
  normalizeConstituent,
  normalizeFuturesTicker,
  rankFastCandidates,
  scoreCexCandidate,
  splitConstituentsBySymbolMatch,
  toFiniteNumber
};
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
npm test -- test/cex-radar.test.js
```

Expected output:

```text
# pass 4
# fail 0
```

## Task 5: Add Token Assembly And Summary Tests

**Files:**
- Modify: `test/cex-radar.test.js`
- Modify: `lib/cex-radar.js`

- [ ] **Step 1: Append failing assembly tests**

Append these tests to `test/cex-radar.test.js`:

```js
test("assembles a UI-ready token with capped 0-100 scores", () => {
  const { assembleCexToken } = require("../lib/cex-radar");

  const token = assembleCexToken({
    symbol: "BEATUSDT",
    baseAsset: "BEAT",
    lastPrice: 1.882,
    priceChange24h: 2.17,
    high24h: 2.032,
    low24h: 1.459,
    quoteVolume24h: 157_911_622,
    hasBinanceSpot: false,
    indexConstituents: [
      { exchange: "gateio", symbol: "BEAT_USDT", price: 1.8851, weight: 0.2 },
      { exchange: "mxc", symbol: "BEATUSDT", price: 1.882, weight: 0.25 },
      { exchange: "binance_alpha", symbol: "BEATUSDT", price: 1.8678, weight: 0.35 }
    ],
    anchorDispersionPct: 0.92,
    futuresToAnchorVolumeRatio: 11.4,
    markIndexPremiumPct: 0.0,
    fundingRate: 0.00005,
    openInterest: 3_000_000,
    adlRisk: "HIGH",
    sameSymbolMismatches: []
  });

  assert.equal(token.symbol, "BEATUSDT");
  assert.equal(token.baseAsset, "BEAT");
  assert.equal(token.hasBinanceSpot, false);
  assert.ok(token.attentionScore >= 70);
  assert.ok(token.riskScore >= 50);
  assert.ok(["high-risk-extension", "pullback-watch", "acceleration"].includes(token.phase));
  assert.equal(token.confidence, "high");
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
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- test/cex-radar.test.js
```

Expected output:

```text
TypeError: assembleCexToken is not a function
```

- [ ] **Step 3: Add assembly helpers**

Add these functions above `module.exports` in `lib/cex-radar.js`:

```js
function assembleCexToken(candidate) {
  const scores = scoreCexCandidate(candidate);
  const phase = classifyCexPhase(candidate, scores);

  return {
    symbol: candidate.symbol,
    baseAsset: candidate.baseAsset,
    lastPrice: toFiniteNumber(candidate.lastPrice),
    priceChange24h: toFiniteNumber(candidate.priceChange24h),
    high24h: toFiniteNumber(candidate.high24h),
    low24h: toFiniteNumber(candidate.low24h),
    quoteVolume24h: toFiniteNumber(candidate.quoteVolume24h),
    hasBinanceSpot: candidate.hasBinanceSpot === true,
    indexConstituents: Array.isArray(candidate.indexConstituents) ? candidate.indexConstituents : [],
    anchorDispersionPct: toFiniteNumber(candidate.anchorDispersionPct),
    futuresToAnchorVolumeRatio: toFiniteNumber(candidate.futuresToAnchorVolumeRatio),
    markIndexPremiumPct: toFiniteNumber(candidate.markIndexPremiumPct),
    fundingRate: toFiniteNumber(candidate.fundingRate),
    openInterest: toFiniteNumber(candidate.openInterest),
    adlRisk: candidate.adlRisk || null,
    attentionScore: scores.attentionScore,
    riskScore: scores.riskScore,
    phase,
    tags: scores.tags,
    warnings: scores.warnings,
    confidence: scores.confidence
  };
}

function buildCexScanSummary({ scannedFutures, withoutBinanceSpot, deepInspected, tokens }) {
  const safeTokens = Array.isArray(tokens) ? tokens : [];
  return {
    scannedFutures: scannedFutures || 0,
    withoutBinanceSpot: withoutBinanceSpot || 0,
    deepInspected: deepInspected || 0,
    attentionCount: safeTokens.filter((token) => (token.attentionScore || 0) >= 70).length,
    riskCount: safeTokens.filter((token) => (token.riskScore || 0) >= 50).length
  };
}
```

Update the `module.exports` block to:

```js
module.exports = {
  assembleCexToken,
  buildCexScanSummary,
  buildSpotSymbolSet,
  calculateAnchorDispersionPct,
  classifyCexPhase,
  filterNoSpotFutures,
  normalizeConstituent,
  normalizeFuturesTicker,
  rankFastCandidates,
  scoreCexCandidate,
  splitConstituentsBySymbolMatch,
  toFiniteNumber
};
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
npm test -- test/cex-radar.test.js
```

Expected output:

```text
# pass 6
# fail 0
```

## Task 6: Add Service-Level Scanner Tests

**Files:**
- Create: `test/cex-radar-service.test.js`
- Create: `lib/cex-radar-service.js`

- [ ] **Step 1: Write the failing service test**

Create `test/cex-radar-service.test.js` with this content:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createCexRadarScanner } = require("../lib/cex-radar-service");

test("scanner filters no-spot futures and deep-inspects top candidates", async () => {
  const calls = [];
  const spotMap = new Map([["BTCUSDT", {}]]);
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("/fapi/v1/ticker/24hr")) {
      return [
        {
          symbol: "LABUSDT",
          lastPrice: "16.884",
          priceChangePercent: "21.67",
          highPrice: "18.787",
          lowPrice: "13.331",
          quoteVolume: "376176179"
        },
        {
          symbol: "BTCUSDT",
          lastPrice: "65000",
          priceChangePercent: "1",
          highPrice: "66000",
          lowPrice: "64000",
          quoteVolume: "2200000000"
        }
      ];
    }
    if (url.includes("/fapi/v1/constituents")) {
      return {
        symbol: "LABUSDT",
        constituents: [
          { exchange: "gateio", symbol: "LAB_USDT", price: "16.851", weight: "0.3333" },
          { exchange: "binance_future", symbol: "LABUSDT", price: "16.854", weight: "0.2222" },
          { exchange: "binance_alpha", symbol: "LABUSDT", price: "16.8624", weight: "0.3333" }
        ]
      };
    }
    if (url.includes("/fapi/v1/premiumIndex")) {
      return {
        symbol: "LABUSDT",
        markPrice: "16.79100386",
        indexPrice: "16.79021659",
        lastFundingRate: "0.00005000"
      };
    }
    if (url.includes("/fapi/v1/openInterest")) {
      return { symbol: "LABUSDT", openInterest: "987654" };
    }
    if (url.includes("/fapi/v1/symbolAdlRisk")) {
      return { symbol: "LABUSDT", adlRisk: "high", updateTime: 1597370495002 };
    }
    if (url.includes("api.gateio.ws")) {
      return [{ currency_pair: "LAB_USDT", last: "16.623", quote_volume: "24135033.78" }];
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const scanner = createCexRadarScanner({
    fetchJson,
    getSpotTickerMap: async () => spotMap,
    now: () => new Date("2026-06-19T04:00:00.000Z")
  });

  const first = await scanner.scan({ force: true, deepInspectLimit: 10 });
  const second = await scanner.scan({ deepInspectLimit: 10 });

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(first.summary.scannedFutures, 2);
  assert.equal(first.summary.withoutBinanceSpot, 1);
  assert.equal(first.summary.deepInspected, 1);
  assert.equal(first.tokens.length, 1);
  assert.equal(first.tokens[0].symbol, "LABUSDT");
  assert.equal(first.tokens[0].adlRisk, "HIGH");
  assert.ok(first.tokens[0].futuresToAnchorVolumeRatio > 15);
  assert.ok(first.tokens[0].attentionScore >= 70);
  assert.deepEqual(first.errors, []);
  assert.ok(calls.some((url) => url.includes("/fapi/v1/constituents?symbol=LABUSDT")));
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- test/cex-radar-service.test.js
```

Expected output:

```text
Error: Cannot find module '../lib/cex-radar-service'
```

## Task 7: Implement Network Scanner Service

**Files:**
- Create: `lib/cex-radar-service.js`
- Test: `test/cex-radar-service.test.js`

- [ ] **Step 1: Create the service module**

Create `lib/cex-radar-service.js` with this content:

```js
const {
  assembleCexToken,
  buildCexScanSummary,
  buildSpotSymbolSet,
  calculateAnchorDispersionPct,
  filterNoSpotFutures,
  normalizeConstituent,
  rankFastCandidates,
  splitConstituentsBySymbolMatch,
  toFiniteNumber
} = require("./cex-radar");

const BINANCE_FAPI_BASE = "https://fapi.binance.com";
const GATE_API_BASE = "https://api.gateio.ws";
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_DEEP_INSPECT_LIMIT = 50;

function createCexRadarScanner({ fetchJson, getSpotTickerMap, now = () => new Date(), cacheTtlMs = DEFAULT_CACHE_TTL_MS }) {
  if (typeof fetchJson !== "function") {
    throw new TypeError("fetchJson dependency is required");
  }
  if (typeof getSpotTickerMap !== "function") {
    throw new TypeError("getSpotTickerMap dependency is required");
  }

  let cache = null;

  async function scan(options = {}) {
    const force = options.force === true;
    const deepInspectLimit = Number.isFinite(options.deepInspectLimit)
      ? options.deepInspectLimit
      : DEFAULT_DEEP_INSPECT_LIMIT;
    const currentTime = now();
    const currentMs = currentTime.getTime();

    if (!force && cache && currentMs - cache.at < cacheTtlMs) {
      return { ...cache.value, cached: true };
    }

    const errors = [];
    const futuresRows = await fetchJson(`${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`, 20_000, {
      headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
    });
    const spotTickerMap = await getSpotTickerMap();
    const spotSymbols = buildSpotSymbolSet(spotTickerMap);
    const fastCandidates = filterNoSpotFutures(futuresRows, spotSymbols, { minQuoteVolume: 5_000_000 });
    const rankedCandidates = rankFastCandidates(fastCandidates, deepInspectLimit);

    const tokens = [];
    for (const candidate of rankedCandidates) {
      const inspected = await inspectCandidate(candidate, errors);
      tokens.push(inspected);
    }

    tokens.sort((a, b) => {
      return (b.attentionScore - a.attentionScore) || (b.riskScore - a.riskScore) || ((b.quoteVolume24h || 0) - (a.quoteVolume24h || 0));
    });

    const value = {
      updatedAt: currentTime.toISOString(),
      cached: false,
      summary: buildCexScanSummary({
        scannedFutures: Array.isArray(futuresRows) ? futuresRows.length : 0,
        withoutBinanceSpot: fastCandidates.length,
        deepInspected: rankedCandidates.length,
        tokens
      }),
      tokens,
      errors
    };

    cache = { at: currentMs, value };
    return value;
  }

  async function inspectCandidate(candidate, errors) {
    const [constituentResult, premiumResult, openInterestResult, adlRiskResult] = await Promise.all([
      fetchIndexConstituents(candidate.symbol, errors),
      fetchPremiumIndex(candidate.symbol, errors),
      fetchOpenInterest(candidate.symbol, errors),
      fetchAdlRisk(candidate.symbol, errors)
    ]);

    const referencePrice = premiumResult.indexPrice || candidate.lastPrice;
    const split = splitConstituentsBySymbolMatch(constituentResult.constituents, referencePrice, 8);
    const anchorDispersionPct = calculateAnchorDispersionPct(constituentResult.constituents, referencePrice);
    const gateVolume = await fetchGateAnchorVolume(split.matched, errors);
    const futuresToAnchorVolumeRatio = gateVolume > 0 && candidate.quoteVolume24h
      ? candidate.quoteVolume24h / gateVolume
      : null;

    return assembleCexToken({
      ...candidate,
      indexConstituents: constituentResult.constituents,
      anchorDispersionPct,
      futuresToAnchorVolumeRatio,
      markIndexPremiumPct: premiumResult.markIndexPremiumPct,
      fundingRate: premiumResult.fundingRate,
      openInterest: openInterestResult.openInterest,
      adlRisk: adlRiskResult.adlRisk,
      sameSymbolMismatches: split.mismatched
    });
  }

  async function fetchIndexConstituents(symbol, errors) {
    try {
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/constituents?symbol=${encodeURIComponent(symbol)}`;
      const json = await fetchJson(url, 12_000, {
        headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
      });
      const rows = Array.isArray(json?.constituents) ? json.constituents : [];
      return { constituents: rows.map(normalizeConstituent) };
    } catch (error) {
      errors.push(`Index constituents ${symbol}: ${error.message}`);
      return { constituents: [] };
    }
  }

  async function fetchPremiumIndex(symbol, errors) {
    try {
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
      const json = await fetchJson(url, 10_000, {
        headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
      });
      const markPrice = toFiniteNumber(json?.markPrice);
      const indexPrice = toFiniteNumber(json?.indexPrice);
      const markIndexPremiumPct = Number.isFinite(markPrice) && Number.isFinite(indexPrice) && indexPrice > 0
        ? ((markPrice - indexPrice) / indexPrice) * 100
        : null;
      return {
        markPrice,
        indexPrice,
        markIndexPremiumPct,
        fundingRate: toFiniteNumber(json?.lastFundingRate)
      };
    } catch (error) {
      errors.push(`Premium index ${symbol}: ${error.message}`);
      return { markPrice: null, indexPrice: null, markIndexPremiumPct: null, fundingRate: null };
    }
  }

  async function fetchOpenInterest(symbol, errors) {
    try {
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`;
      const json = await fetchJson(url, 10_000, {
        headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
      });
      return { openInterest: toFiniteNumber(json?.openInterest) };
    } catch (error) {
      errors.push(`Open interest ${symbol}: ${error.message}`);
      return { openInterest: null };
    }
  }

  async function fetchAdlRisk(symbol, errors) {
    try {
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/symbolAdlRisk?symbol=${encodeURIComponent(symbol)}`;
      const json = await fetchJson(url, 10_000, {
        headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
      });
      const row = Array.isArray(json) ? json.find((item) => String(item.symbol || "").toUpperCase() === symbol) : json;
      const adlRisk = String(row?.adlRisk || "").toUpperCase();
      return { adlRisk: adlRisk || null };
    } catch (error) {
      errors.push(`ADL risk ${symbol}: ${error.message}`);
      return { adlRisk: null };
    }
  }

  async function fetchGateAnchorVolume(constituents, errors) {
    const gateRows = (Array.isArray(constituents) ? constituents : [])
      .filter((row) => String(row.exchange || "").toLowerCase() === "gateio");
    let quoteVolume = 0;

    for (const row of gateRows) {
      try {
        const pair = String(row.symbol || "").replace("-", "_").toUpperCase();
        const url = `${GATE_API_BASE}/api/v4/spot/tickers?currency_pair=${encodeURIComponent(pair)}`;
        const json = await fetchJson(url, 10_000, {
          headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
        });
        const ticker = Array.isArray(json) ? json[0] : json;
        const rowVolume = toFiniteNumber(ticker?.quote_volume);
        if (Number.isFinite(rowVolume) && rowVolume > 0) {
          quoteVolume += rowVolume;
        }
      } catch (error) {
        errors.push(`Gate ticker ${row.symbol}: ${error.message}`);
      }
    }

    return quoteVolume;
  }

  return { scan };
}

module.exports = {
  createCexRadarScanner
};
```

- [ ] **Step 2: Run service tests and verify GREEN**

Run:

```bash
npm test -- test/cex-radar-service.test.js
```

Expected output:

```text
# pass 1
# fail 0
```

- [ ] **Step 3: Run all tests and verify GREEN**

Run:

```bash
npm test
```

Expected output:

```text
# pass 7
# fail 0
```

## Task 8: Wire `/api/radar/cex-scan` Into The Server

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add the service require**

At the top of `server.js`, after the existing `execFile` require, add:

```js
const { createCexRadarScanner } = require("./lib/cex-radar-service");
```

- [ ] **Step 2: Add the route**

In the request handler, immediately after the existing `/api/radar/scan` route block, add:

```js
    if (req.method === "GET" && requestUrl.pathname === "/api/radar/cex-scan") {
      const force = requestUrl.searchParams.get("force") === "true";
      const results = await fetchCexRadarScan(force);
      return sendJson(res, results);
    }
```

- [ ] **Step 3: Add the scanner singleton wrapper**

Near the existing radar cache declarations around `let radarScanCache = null;`, add:

```js
let cexRadarScanner = null;
```

Near `fetchRadarScan`, before or after that function, add:

```js
function getCexRadarScanner() {
  if (!cexRadarScanner) {
    cexRadarScanner = createCexRadarScanner({
      fetchJson: (url, timeoutMs, options) => fetchJsonWithFallback(url, timeoutMs, options),
      getSpotTickerMap: getBinanceTickerMap,
      now: () => new Date()
    });
  }
  return cexRadarScanner;
}

async function fetchCexRadarScan(force = false) {
  return getCexRadarScanner().scan({ force });
}
```

- [ ] **Step 4: Run all tests and verify server wiring did not break imports**

Run:

```bash
npm test
```

Expected output:

```text
# pass 7
# fail 0
```

## Task 9: Manual Endpoint Verification

**Files:**
- No file edits.

- [ ] **Step 1: Start the local server**

Run:

```bash
npm start
```

Expected output:

```text
Asset Portfolio Hub is running at http://localhost:5173
```

- [ ] **Step 2: Request the CEX scan endpoint**

In another terminal, run:

```bash
curl -sS "http://localhost:5173/api/radar/cex-scan?force=true" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(JSON.stringify({updatedAt:j.updatedAt,cached:j.cached,summary:j.summary,first:j.tokens[0]}, null, 2));})"
```

Expected output shape:

```json
{
  "updatedAt": "2026-06-19T04:00:00.000Z",
  "cached": false,
  "summary": {
    "scannedFutures": 0,
    "withoutBinanceSpot": 0,
    "deepInspected": 0,
    "attentionCount": 0,
    "riskCount": 0
  },
  "first": {
    "symbol": "LABUSDT",
    "baseAsset": "LAB",
    "attentionScore": 100,
    "riskScore": 62,
    "phase": "pullback-watch"
  }
}
```

The exact counts and first token depend on live Binance market state. Verification passes when:

- HTTP status is 200.
- JSON includes `updatedAt`, `cached`, `summary`, `tokens`, and `errors`.
- `summary.scannedFutures` is greater than 0.
- Each token score is within `0..100`.
- At least one no-spot futures candidate appears when Binance has active candidates.
- Repeating the request without `force=true` returns `"cached": true` within 60 seconds.

## Task 10: Commit Checkpoint

**Files:**
- All files changed above.

- [ ] **Step 1: Check repository state**

Run:

```bash
git status --short
```

Expected output in this workspace may be:

```text
fatal: not a git repository (or any of the parent directories): .git
```

If this workspace has no Git repository, skip the commit step and report that the files were changed locally. If a Git repository is available, continue.

- [ ] **Step 2: Commit when Git is available**

Run:

```bash
git add package.json lib/cex-radar.js lib/cex-radar-service.js test/cex-radar.test.js test/cex-radar-service.test.js server.js
git commit -m "feat: add CEX altcoin radar scan endpoint"
```

Expected output:

```text
[branch-name commit-hash] feat: add CEX altcoin radar scan endpoint
```

## Self-Review

**Spec coverage:** Covered full Binance USDT perpetual scan, ordinary Binance Spot exclusion, deep inspection cap, index constituents, mark/index/funding, open interest, ADL risk, Gate anchor volume, separate 0-100 attention/risk scores, phases, tags, same-symbol validation, caching, endpoint shape, partial errors, and backend-only V1 scope.

**Red flag scan:** No unresolved implementation markers are present. Every code step includes concrete code and every verification step includes commands plus expected output.

**Type consistency:** Public helper names used in tests match `module.exports`. Service constructor signature is `createCexRadarScanner({ fetchJson, getSpotTickerMap, now, cacheTtlMs })`; server wiring uses the same signature. Endpoint shape matches the design spec: `updatedAt`, `cached`, `summary`, `tokens`, `errors`.
