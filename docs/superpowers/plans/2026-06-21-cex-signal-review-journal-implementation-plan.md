# CEX Signal Review Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic bull/bear/risk signal explanations plus a local 1-day and 3-day review journal for CEX radar tokens.

**Architecture:** Keep scoring and signal review as pure, tested backend helpers. Store local review history in `data/cex-signal-journal.json` through a small store module, expose journal endpoints from the existing Node server, and render the review data in the existing static CEX radar page.

**Tech Stack:** Node.js CommonJS, native `node:test`, existing local HTTP server, browser `fetch`, local JSON files.

---

## Source Spec

Implement:

`docs/superpowers/specs/2026-06-21-cex-signal-review-journal-design.md`

## File Structure

- Create: `lib/cex-signal-review.js`
  - Pure deterministic signal review builder.
  - No file IO and no network calls.
- Create: `test/cex-signal-review.test.js`
  - Unit tests for bull, bear, risk gate, and assembled token integration.
- Modify: `lib/cex-radar.js`
  - Attach `signalReview` to each assembled token.
- Create: `lib/cex-signal-journal.js`
  - Pure journal capture, dedupe, and review calculations.
- Create: `test/cex-signal-journal.test.js`
  - Unit tests for capture rules, duplicate suppression, 1d review, 3d review, and missing prices.
- Create: `lib/cex-signal-journal-store.js`
  - Local JSON file load/save helpers with malformed-file protection.
- Create: `test/cex-signal-journal-store.test.js`
  - Unit tests using temp files.
- Modify: `server.js`
  - Add journal file path and three journal endpoints.
- Modify: `public/cex-radar.js`
  - Capture journal entries after successful scans, load entries, render signal debate and history.
- Modify: `public/styles.css`
  - Add compact styles for signal debate and journal history.
- Modify: `README.md`
  - Document the local journal and review windows.

## Task 1: Add Deterministic Signal Review

**Files:**
- Create: `lib/cex-signal-review.js`
- Create: `test/cex-signal-review.test.js`
- Modify: `lib/cex-radar.js`

- [ ] **Step 1: Write failing signal review tests**

Create `test/cex-signal-review.test.js`:

```js
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
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- test/cex-signal-review.test.js
```

Expected:

```text
Cannot find module '../lib/cex-signal-review'
```

- [ ] **Step 3: Implement `lib/cex-signal-review.js`**

Create `lib/cex-signal-review.js`:

```js
function addUnique(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasTag(token, tag) {
  return Array.isArray(token?.tags) && token.tags.includes(tag);
}

function buildCexSignalReview(token) {
  const bullCase = [];
  const bearCase = [];
  const riskGate = [];
  const attentionScore = toFiniteNumber(token?.attentionScore) || 0;
  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const fundingRate = toFiniteNumber(token?.fundingRate);
  const markIndexPremiumPct = Math.abs(toFiniteNumber(token?.markIndexPremiumPct) || 0);
  const anchorDispersionPct = toFiniteNumber(token?.anchorDispersionPct);
  const futuresToAnchorVolumeRatio = toFiniteNumber(token?.futuresToAnchorVolumeRatio);
  const adlRisk = String(token?.adlRisk || "").toUpperCase();
  const actionBias = token?.actionBias || "";
  const shortTermBias = token?.shortTermBias || "";
  const phase = token?.phase || "";

  if (hasTag(token, "无币安现货")) addUnique(bullCase, "无币安现货");
  if (hasTag(token, "合约放量")) addUnique(bullCase, "合约放量");
  if (hasTag(token, "外部锚同步")) addUnique(bullCase, "外部锚同步");
  if (Number.isFinite(futuresToAnchorVolumeRatio) && futuresToAnchorVolumeRatio >= 8) addUnique(bullCase, "合约量主导");
  if (phase === "acceleration") addUnique(bullCase, "接近新高且风险未失控");
  if (Number.isFinite(fundingRate) && Math.abs(fundingRate) < 0.0003) addUnique(bullCase, "Funding正常");

  if (hasTag(token, "冲高回落") || phase === "failed-breakout-risk") addUnique(bearCase, "冲高回落");
  if (adlRisk === "HIGH" || hasTag(token, "ADL拥挤")) addUnique(bearCase, "ADL拥挤");
  if (hasTag(token, "Funding异常")) addUnique(bearCase, "Funding异常");
  if (markIndexPremiumPct >= 0.3) addUnique(bearCase, "合约溢价扩大");
  if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) addUnique(bearCase, "锚价分歧");
  if (hasTag(token, "同名币风险")) addUnique(bearCase, "同名币风险");

  if (hasTag(token, "同名币风险") || phase === "same-symbol-risk") addUnique(riskGate, "同名币或锚价无法验证");
  if ((token?.confidence || token?.expectationConfidence) === "low" && !hasTag(token, "外部锚同步")) addUnique(riskGate, "缺少可验证外部锚");
  if (attentionScore >= 70 && riskScore >= 60) addUnique(riskGate, "高关注与高风险同时出现");
  if (Array.isArray(token?.warnings) && token.warnings.length > 0) addUnique(riskGate, "存在数据或锚价警告");
  if (actionBias === "avoid") addUnique(riskGate, "动作建议为回避");
  if (actionBias === "watch-only") addUnique(riskGate, "只观察不追");

  const reviewLabel = deriveReviewLabel({ actionBias, shortTermBias, phase, riskGate });
  const decisionConfidence = deriveDecisionConfidence(token, riskGate);
  const decisionSummary = deriveDecisionSummary({ actionBias, reviewLabel, riskGate });

  return {
    bullCase,
    bearCase,
    riskGate,
    decisionSummary,
    decisionConfidence,
    reviewLabel
  };
}

function deriveReviewLabel({ actionBias, shortTermBias, phase, riskGate }) {
  if (riskGate.includes("同名币或锚价无法验证") || actionBias === "avoid") return "avoid";
  if (actionBias === "watch-short" || shortTermBias === "bearish" || phase === "failed-breakout-risk") return "fade-risk";
  if (actionBias === "watch-long" || shortTermBias === "bullish") return "continuation";
  return "wait-confirmation";
}

function deriveDecisionConfidence(token, riskGate) {
  if (riskGate.includes("同名币或锚价无法验证") || riskGate.includes("缺少可验证外部锚")) return "low";
  if (riskGate.length >= 2) return "medium";
  if (token?.expectationConfidence === "high" || token?.confidence === "high") return "high";
  if (token?.expectationConfidence === "medium" || token?.confidence === "medium") return "medium";
  return "low";
}

function deriveDecisionSummary({ actionBias, reviewLabel, riskGate }) {
  if (riskGate.includes("同名币或锚价无法验证") || actionBias === "avoid") {
    return "锚价无法验证，当前信号不适合交易观察。";
  }
  if (actionBias === "watch-short" || reviewLabel === "fade-risk") {
    return "合约拥挤后冲高回落，短线更偏风险释放，适合观察做空或等待反弹失败。";
  }
  if (actionBias === "watch-long" || reviewLabel === "continuation") {
    return "高关注且外部锚同步，风险未失控，适合观察延续。";
  }
  return "多空信号未形成一致，适合继续观察等待确认。";
}

module.exports = {
  buildCexSignalReview
};
```

- [ ] **Step 4: Attach `signalReview` in `lib/cex-radar.js`**

At the top of `lib/cex-radar.js`, add:

```js
const { buildCexSignalReview } = require("./cex-signal-review");
```

In `assembleCexToken`, replace the direct `return { ... }` with:

```js
  const token = {
    symbol: candidate.symbol,
    baseAsset: candidate.baseAsset,
    lastPrice: toFiniteNumber(candidate.lastPrice),
    priceChange24h: toFiniteNumber(candidate.priceChange24h),
    high24h: toFiniteNumber(candidate.high24h),
    low24h: toFiniteNumber(candidate.low24h),
    quoteVolume24h: toFiniteNumber(candidate.quoteVolume24h),
    hasBinanceSpot,
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
    confidence: scores.confidence,
    shortTermBias: expectation.shortTermBias,
    expectedMovePctRange: expectation.expectedMovePctRange,
    expectationConfidence: expectation.expectationConfidence,
    expectationReasons: expectation.expectationReasons,
    actionBias: action.actionBias,
    actionSetup: action.actionSetup,
    invalidLevel: action.invalidLevel,
    actionReasons: action.actionReasons
  };

  return {
    ...token,
    signalReview: buildCexSignalReview(token)
  };
```

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- test/cex-signal-review.test.js
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test
```

Expected:

```text
fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/cex-signal-review.js lib/cex-radar.js test/cex-signal-review.test.js
git commit -m "Add CEX signal review layer"
```

## Task 2: Add Pure Journal Capture And Review Logic

**Files:**
- Create: `lib/cex-signal-journal.js`
- Create: `test/cex-signal-journal.test.js`

- [ ] **Step 1: Write failing journal tests**

Create `test/cex-signal-journal.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildJournalEntry,
  reviewJournalEntries,
  shouldCaptureToken,
  upsertJournalEntries
} = require("../lib/cex-signal-journal");

const now = new Date("2026-06-21T08:00:00.000Z");

function token(overrides = {}) {
  return {
    symbol: "LABUSDT",
    lastPrice: 10,
    actionBias: "watch-long",
    shortTermBias: "bullish",
    expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" },
    attentionScore: 82,
    riskScore: 35,
    phase: "acceleration",
    signalReview: {
      reviewLabel: "continuation",
      bullCase: ["外部锚同步"],
      bearCase: [],
      riskGate: [],
      decisionSummary: "高关注且外部锚同步，风险未失控，适合观察延续。",
      decisionConfidence: "high"
    },
    ...overrides
  };
}

test("captures high attention, directional, and pinned tokens", () => {
  assert.equal(shouldCaptureToken(token({ attentionScore: 70, actionBias: "watch-only" }), []), true);
  assert.equal(shouldCaptureToken(token({ attentionScore: 20, riskScore: 60, actionBias: "watch-only" }), []), true);
  assert.equal(shouldCaptureToken(token({ attentionScore: 20, riskScore: 20, actionBias: "watch-short" }), []), true);
  assert.equal(shouldCaptureToken(token({ symbol: "PINUSDT", attentionScore: 1, riskScore: 1, actionBias: "watch-only" }), ["PINUSDT"]), true);
  assert.equal(shouldCaptureToken(token({ attentionScore: 1, riskScore: 1, actionBias: "watch-only" }), []), false);
});

test("builds journal entry from token review", () => {
  const entry = buildJournalEntry(token(), now);

  assert.equal(entry.id, "LABUSDT-2026-06-21T08:00:00.000Z");
  assert.equal(entry.symbol, "LABUSDT");
  assert.equal(entry.entryPrice, 10);
  assert.equal(entry.reviewLabel, "continuation");
  assert.equal(entry.decisionConfidence, "high");
  assert.deepEqual(entry.bullCase, ["外部锚同步"]);
  assert.equal(entry.review1d, null);
  assert.equal(entry.review3d, null);
});

test("suppresses duplicate entries within twelve hours", () => {
  const first = buildJournalEntry(token(), now);
  const result = upsertJournalEntries([first], [token({ lastPrice: 11, attentionScore: 90 })], {
    now: new Date("2026-06-21T14:00:00.000Z"),
    pinnedSymbols: []
  });

  assert.equal(result.capturedCount, 0);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].latestPrice, 11);
  assert.equal(result.entries[0].lastSeenAt, "2026-06-21T14:00:00.000Z");
});

test("creates a new entry after twelve hours", () => {
  const first = buildJournalEntry(token(), now);
  const result = upsertJournalEntries([first], [token({ lastPrice: 12 })], {
    now: new Date("2026-06-21T20:01:00.000Z"),
    pinnedSymbols: []
  });

  assert.equal(result.capturedCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.entries.length, 2);
});

test("reviews 1d and 3d outcomes", () => {
  const entry = buildJournalEntry(token(), now);
  const oneDay = reviewJournalEntries([entry], new Map([["LABUSDT", 11.2]]), new Date("2026-06-22T08:05:00.000Z"));

  assert.equal(oneDay.reviewedCount, 1);
  assert.equal(oneDay.entries[0].review1d.movePct, 12);
  assert.equal(oneDay.entries[0].review1d.directionHit, true);
  assert.equal(oneDay.entries[0].review1d.rangeHit, true);
  assert.equal(oneDay.entries[0].review1d.outcomeLabel, "hit");
  assert.equal(oneDay.entries[0].review3d, null);

  const threeDay = reviewJournalEntries(oneDay.entries, new Map([["LABUSDT", 8.5]]), new Date("2026-06-24T08:05:00.000Z"));

  assert.equal(threeDay.reviewedCount, 1);
  assert.equal(threeDay.entries[0].review3d.movePct, -15);
  assert.equal(threeDay.entries[0].review3d.directionHit, false);
  assert.equal(threeDay.entries[0].review3d.outcomeLabel, "miss");
});

test("leaves due review pending when current price is unavailable", () => {
  const entry = buildJournalEntry(token(), now);
  const result = reviewJournalEntries([entry], new Map(), new Date("2026-06-22T08:05:00.000Z"));

  assert.equal(result.reviewedCount, 0);
  assert.equal(result.entries[0].review1d, null);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- test/cex-signal-journal.test.js
```

Expected:

```text
Cannot find module '../lib/cex-signal-journal'
```

- [ ] **Step 3: Implement `lib/cex-signal-journal.js`**

Create `lib/cex-signal-journal.js`:

```js
const DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;
const REVIEW_1D_MS = 24 * 60 * 60 * 1000;
const REVIEW_3D_MS = 72 * 60 * 60 * 1000;

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function shouldCaptureToken(token, pinnedSymbols = []) {
  const symbol = normalizeSymbol(token?.symbol);
  const pinnedSet = new Set((Array.isArray(pinnedSymbols) ? pinnedSymbols : []).map(normalizeSymbol));
  const attentionScore = toFiniteNumber(token?.attentionScore) || 0;
  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const actionBias = token?.actionBias || "";

  return (
    attentionScore >= 70 ||
    riskScore >= 60 ||
    actionBias === "watch-long" ||
    actionBias === "watch-short" ||
    (symbol && pinnedSet.has(symbol))
  );
}

function buildJournalEntry(token, now = new Date()) {
  const observedAt = now.toISOString();
  const signalReview = token.signalReview || {};
  return {
    id: `${normalizeSymbol(token.symbol)}-${observedAt}`,
    symbol: normalizeSymbol(token.symbol),
    observedAt,
    lastSeenAt: observedAt,
    entryPrice: toFiniteNumber(token.lastPrice),
    latestPrice: toFiniteNumber(token.lastPrice),
    actionBias: token.actionBias || null,
    shortTermBias: token.shortTermBias || null,
    expectedMovePctRange: token.expectedMovePctRange || null,
    attentionScore: toFiniteNumber(token.attentionScore),
    riskScore: toFiniteNumber(token.riskScore),
    phase: token.phase || null,
    reviewLabel: signalReview.reviewLabel || null,
    bullCase: Array.isArray(signalReview.bullCase) ? signalReview.bullCase : [],
    bearCase: Array.isArray(signalReview.bearCase) ? signalReview.bearCase : [],
    riskGate: Array.isArray(signalReview.riskGate) ? signalReview.riskGate : [],
    decisionSummary: signalReview.decisionSummary || "",
    decisionConfidence: signalReview.decisionConfidence || token.expectationConfidence || token.confidence || "low",
    review1d: null,
    review3d: null
  };
}

function upsertJournalEntries(existingEntries, tokens, options = {}) {
  const now = options.now || new Date();
  const pinnedSymbols = options.pinnedSymbols || [];
  const entries = Array.isArray(existingEntries) ? existingEntries.map((entry) => ({ ...entry })) : [];
  let capturedCount = 0;
  let updatedCount = 0;

  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (!shouldCaptureToken(token, pinnedSymbols)) continue;

    const symbol = normalizeSymbol(token.symbol);
    const duplicate = entries.find((entry) => {
      if (normalizeSymbol(entry.symbol) !== symbol) return false;
      const observedMs = Date.parse(entry.observedAt);
      return Number.isFinite(observedMs) && now.getTime() - observedMs < DEDUPE_WINDOW_MS;
    });

    if (duplicate) {
      const nextEntry = buildJournalEntry(token, now);
      duplicate.lastSeenAt = now.toISOString();
      duplicate.latestPrice = nextEntry.latestPrice;
      duplicate.attentionScore = nextEntry.attentionScore;
      duplicate.riskScore = nextEntry.riskScore;
      duplicate.phase = nextEntry.phase;
      duplicate.reviewLabel = nextEntry.reviewLabel;
      duplicate.bullCase = nextEntry.bullCase;
      duplicate.bearCase = nextEntry.bearCase;
      duplicate.riskGate = nextEntry.riskGate;
      duplicate.decisionSummary = nextEntry.decisionSummary;
      duplicate.decisionConfidence = nextEntry.decisionConfidence;
      updatedCount += 1;
      continue;
    }

    entries.push(buildJournalEntry(token, now));
    capturedCount += 1;
  }

  entries.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  return { entries, capturedCount, updatedCount };
}

function reviewJournalEntries(existingEntries, priceBySymbol, now = new Date()) {
  const entries = Array.isArray(existingEntries) ? existingEntries.map((entry) => ({ ...entry })) : [];
  let reviewedCount = 0;

  for (const entry of entries) {
    const observedMs = Date.parse(entry.observedAt);
    if (!Number.isFinite(observedMs)) continue;

    const currentPrice = toFiniteNumber(priceBySymbol.get(normalizeSymbol(entry.symbol)));
    if (!Number.isFinite(currentPrice)) continue;

    const ageMs = now.getTime() - observedMs;
    if (!entry.review1d && ageMs >= REVIEW_1D_MS) {
      entry.review1d = buildReviewResult(entry, currentPrice, now);
      reviewedCount += 1;
    }
    if (!entry.review3d && ageMs >= REVIEW_3D_MS) {
      entry.review3d = buildReviewResult(entry, currentPrice, now);
      reviewedCount += 1;
    }
  }

  return { entries, reviewedCount };
}

function buildReviewResult(entry, price, now) {
  const movePct = calculateMovePct(entry.entryPrice, price);
  const directionHit = calculateDirectionHit(entry, movePct);
  const rangeHit = calculateRangeHit(entry.expectedMovePctRange, movePct, directionHit);
  return {
    reviewedAt: now.toISOString(),
    price,
    movePct,
    directionHit,
    rangeHit,
    outcomeLabel: calculateOutcomeLabel(directionHit, rangeHit)
  };
}

function calculateMovePct(entryPrice, price) {
  const start = toFiniteNumber(entryPrice);
  const end = toFiniteNumber(price);
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) return null;
  return Number((((end - start) / start) * 100).toFixed(2));
}

function calculateDirectionHit(entry, movePct) {
  if (!Number.isFinite(movePct)) return null;
  if (entry.shortTermBias === "bullish" || entry.actionBias === "watch-long") return movePct > 0;
  if (entry.shortTermBias === "bearish" || entry.actionBias === "watch-short") return movePct < 0;
  return null;
}

function calculateRangeHit(range, movePct, directionHit) {
  if (!Number.isFinite(movePct) || !range) return null;
  const lower = toFiniteNumber(range.lower);
  const upper = toFiniteNumber(range.upper);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  if (directionHit === null) return Math.abs(movePct) <= Math.max(Math.abs(lower), Math.abs(upper));
  return movePct >= lower && movePct <= upper;
}

function calculateOutcomeLabel(directionHit, rangeHit) {
  if (directionHit === null) return "unclear";
  if (directionHit === false) return "miss";
  if (rangeHit === true) return "hit";
  return "partial";
}

module.exports = {
  buildJournalEntry,
  reviewJournalEntries,
  shouldCaptureToken,
  upsertJournalEntries
};
```

- [ ] **Step 4: Run focused and full tests**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- test/cex-signal-journal.test.js
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test
```

Expected:

```text
fail 0
```

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/cex-signal-journal.js test/cex-signal-journal.test.js
git commit -m "Add CEX signal journal logic"
```

## Task 3: Add Local Journal Store

**Files:**
- Create: `lib/cex-signal-journal-store.js`
- Create: `test/cex-signal-journal-store.test.js`

- [ ] **Step 1: Write failing store tests**

Create `test/cex-signal-journal-store.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  loadCexSignalJournal,
  saveCexSignalJournal
} = require("../lib/cex-signal-journal-store");

async function tempJournalPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cex-journal-"));
  return path.join(dir, "nested", "cex-signal-journal.json");
}

test("missing journal file loads as empty array", async () => {
  const filePath = await tempJournalPath();
  const entries = await loadCexSignalJournal(filePath);
  assert.deepEqual(entries, []);
});

test("saves and loads journal entries", async () => {
  const filePath = await tempJournalPath();
  const entries = [{ id: "one", symbol: "LABUSDT" }];

  await saveCexSignalJournal(filePath, entries);
  const loaded = await loadCexSignalJournal(filePath);

  assert.deepEqual(loaded, entries);
});

test("malformed journal file throws local data error without overwriting", async () => {
  const filePath = await tempJournalPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{ broken json", "utf8");

  await assert.rejects(
    loadCexSignalJournal(filePath),
    (error) => {
      assert.equal(error.code, "CEX_SIGNAL_JOURNAL_MALFORMED");
      assert.equal(error.statusCode, 500);
      return true;
    }
  );

  const raw = await fs.readFile(filePath, "utf8");
  assert.equal(raw, "{ broken json");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- test/cex-signal-journal-store.test.js
```

Expected:

```text
Cannot find module '../lib/cex-signal-journal-store'
```

- [ ] **Step 3: Implement store module**

Create `lib/cex-signal-journal-store.js`:

```js
const fs = require("fs/promises");
const path = require("path");

async function loadCexSignalJournal(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    if (error instanceof SyntaxError) {
      const journalError = new Error("CEX signal journal is malformed");
      journalError.code = "CEX_SIGNAL_JOURNAL_MALFORMED";
      journalError.statusCode = 500;
      journalError.details = { filePath };
      throw journalError;
    }
    throw error;
  }
}

async function saveCexSignalJournal(filePath, entries) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const normalized = Array.isArray(entries) ? entries : [];
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

module.exports = {
  loadCexSignalJournal,
  saveCexSignalJournal
};
```

- [ ] **Step 4: Run focused and full tests**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- test/cex-signal-journal-store.test.js
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test
```

Expected:

```text
fail 0
```

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/cex-signal-journal-store.js test/cex-signal-journal-store.test.js
git commit -m "Add CEX signal journal storage"
```

## Task 4: Add Journal API Endpoints

**Files:**
- Modify: `server.js`
- Test: `test/cex-signal-journal.test.js`, `test/cex-signal-journal-store.test.js`

- [ ] **Step 1: Add imports and journal file path**

In `server.js`, add imports near the existing CEX radar import:

```js
const {
  reviewJournalEntries,
  upsertJournalEntries
} = require("./lib/cex-signal-journal");
const {
  loadCexSignalJournal,
  saveCexSignalJournal
} = require("./lib/cex-signal-journal-store");
```

Near the existing radar config file constant, add:

```js
const CEX_SIGNAL_JOURNAL_FILE = path.join(ROOT_DIR, "data", "cex-signal-journal.json");
```

- [ ] **Step 2: Add routes inside the main server handler**

Insert these routes before `return serveStatic(requestUrl.pathname, res);`:

```js
    if (req.method === "GET" && requestUrl.pathname === "/api/radar/cex-journal") {
      const symbol = String(requestUrl.searchParams.get("symbol") || "").trim().toUpperCase();
      const entries = await loadCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE);
      const filtered = symbol ? entries.filter((entry) => String(entry.symbol || "").toUpperCase() === symbol) : entries;
      filtered.sort((a, b) => Date.parse(b.observedAt || 0) - Date.parse(a.observedAt || 0));
      return sendJson(res, { entries: filtered });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/radar/cex-journal/capture") {
      const body = await readJson(req);
      const tokens = Array.isArray(body.tokens)
        ? body.tokens
        : (await fetchCexRadarScan(false, body.deepInspectLimit)).tokens;
      const entries = await loadCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE);
      const result = upsertJournalEntries(entries, tokens, {
        now: new Date(),
        pinnedSymbols: Array.isArray(body.pinnedSymbols) ? body.pinnedSymbols : []
      });
      await saveCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE, result.entries);
      return sendJson(res, { ok: true, ...result });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/radar/cex-journal/review") {
      const body = await readJson(req);
      const tokens = Array.isArray(body.tokens)
        ? body.tokens
        : (await fetchCexRadarScan(false, body.deepInspectLimit)).tokens;
      const priceBySymbol = new Map(
        tokens
          .map((token) => [String(token.symbol || "").toUpperCase(), Number(token.lastPrice)])
          .filter(([, price]) => Number.isFinite(price))
      );
      const entries = await loadCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE);
      const result = reviewJournalEntries(entries, priceBySymbol, new Date());
      await saveCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE, result.entries);
      return sendJson(res, { ok: true, ...result });
    }
```

- [ ] **Step 3: Run tests**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test
```

Expected:

```text
fail 0
```

- [ ] **Step 4: Manual route smoke test with mock-free empty journal**

Start the server:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH PORT=5187 npm start
```

In another shell, run:

```bash
curl -sS http://localhost:5187/api/radar/cex-journal
```

Expected if no local journal exists:

```json
{"entries":[]}
```

Stop the server after the check.

- [ ] **Step 5: Commit**

Run:

```bash
git add server.js
git commit -m "Add CEX signal journal API"
```

## Task 5: Render Signal Debate And Journal History

**Files:**
- Modify: `public/cex-radar.js`
- Modify: `public/styles.css`
- Test: browser smoke test with mocked endpoint payloads

- [ ] **Step 1: Extend radar state and token normalization**

In `public/cex-radar.js`, add state fields:

```js
  journalEntries: [],
  journalError: null,
```

In `normalizeToken`, add:

```js
    signalReview: normalizeSignalReview(token.signalReview)
```

Add this helper:

```js
function normalizeSignalReview(review) {
  return {
    bullCase: Array.isArray(review?.bullCase) ? review.bullCase : [],
    bearCase: Array.isArray(review?.bearCase) ? review.bearCase : [],
    riskGate: Array.isArray(review?.riskGate) ? review.riskGate : [],
    decisionSummary: review?.decisionSummary || "",
    decisionConfidence: review?.decisionConfidence || "",
    reviewLabel: review?.reviewLabel || ""
  };
}
```

- [ ] **Step 2: Sync journal after successful scans**

After successful token assignment in `fetchCexRadarScan`, before `radarState.selectedSymbol = ...`, call:

```js
    await syncCexJournal(radarState.tokens);
```

Add:

```js
async function syncCexJournal(tokens) {
  radarState.journalError = null;
  try {
    await fetch("/api/radar/cex-journal/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokens,
        pinnedSymbols: radarState.pinnedSymbols
      })
    });
    const reviewResponse = await fetch("/api/radar/cex-journal/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens })
    });
    if (!reviewResponse.ok) {
      throw new Error(`HTTP ${reviewResponse.status}`);
    }
    const payload = await reviewResponse.json();
    radarState.journalEntries = Array.isArray(payload.entries) ? payload.entries : [];
  } catch (error) {
    radarState.journalError = error.message || "复盘日志同步失败";
  }
}
```

Also add a lightweight load on startup after `loadPinnedSymbols()`:

```js
  loadCexJournal();
```

with:

```js
async function loadCexJournal() {
  try {
    const response = await fetch("/api/radar/cex-journal", { cache: "no-store" });
    const payload = await response.json();
    radarState.journalEntries = Array.isArray(payload.entries) ? payload.entries : [];
    renderRadarPage();
  } catch {
    radarState.journalEntries = [];
  }
}
```

- [ ] **Step 3: Render signal debate in detail panel**

In `renderRadarDetail`, after the first `.radar-detail-grid`, insert:

```js
    ${signalDebate(token.signalReview)}
```

Add:

```js
function signalDebate(review) {
  const safeReview = normalizeSignalReview(review);
  return `
    <div class="signal-debate">
      <h3>信号辩论</h3>
      <div class="signal-debate-grid">
        ${signalColumn("牛方", safeReview.bullCase)}
        ${signalColumn("熊方", safeReview.bearCase)}
        ${signalColumn("风控", safeReview.riskGate)}
      </div>
      <div class="decision-summary">${escapeHtml(safeReview.decisionSummary || "暂无决策摘要")}</div>
    </div>
  `;
}

function signalColumn(title, items) {
  const safeItems = Array.isArray(items) && items.length ? items : ["--"];
  return `
    <section>
      <h4>${escapeHtml(title)}</h4>
      <div>${safeItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    </section>
  `;
}
```

- [ ] **Step 4: Render journal history in detail panel**

In `renderRadarDetail`, before `constituentList(...)`, insert:

```js
    ${journalHistory(token.symbol)}
```

Add:

```js
function journalHistory(symbol) {
  const rows = radarState.journalEntries
    .filter((entry) => String(entry.symbol || "").toUpperCase() === String(symbol || "").toUpperCase())
    .slice(0, 5);
  if (radarState.journalError) {
    return `<div class="radar-error">复盘日志：${escapeHtml(radarState.journalError)}</div>`;
  }
  if (!rows.length) {
    return `<div class="journal-history"><h3>历史复盘</h3><div class="empty-state">暂无复盘记录</div></div>`;
  }
  return `
    <div class="journal-history">
      <h3>历史复盘</h3>
      ${rows.map((entry) => `
        <article class="journal-entry">
          <div>
            <strong>${escapeHtml(formatDateTime(entry.observedAt))}</strong>
            <span>${escapeHtml(actionLabel(entry.actionBias))} / ${escapeHtml(entry.expectedMovePctRange?.label || "--")}</span>
          </div>
          <div class="journal-review-row">
            ${reviewPill("1D", entry.review1d)}
            ${reviewPill("3D", entry.review3d)}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function reviewPill(label, review) {
  if (!review) return `<span class="review-pill pending">${escapeHtml(label)} 待复盘</span>`;
  return `<span class="review-pill ${escapeAttr(review.outcomeLabel || "unclear")}">${escapeHtml(label)} ${formatPct(review.movePct)} ${escapeHtml(outcomeLabel(review.outcomeLabel))}</span>`;
}

function outcomeLabel(value) {
  if (value === "hit") return "命中";
  if (value === "partial") return "方向命中";
  if (value === "miss") return "未命中";
  return "不明确";
}

function formatDateTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN");
}
```

- [ ] **Step 5: Add styles**

Append to `public/styles.css`:

```css
.signal-debate,
.journal-history {
  margin-top: 14px;
}

.signal-debate h3,
.journal-history h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.signal-debate-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.signal-debate-grid section,
.journal-entry {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
  padding: 10px;
}

.signal-debate-grid h4 {
  margin: 0 0 8px;
  font-size: 13px;
}

.signal-debate-grid div,
.journal-review-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.signal-debate-grid span,
.review-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 7px;
  background: var(--surface);
  font-size: 12px;
}

.decision-summary {
  margin-top: 10px;
  border-left: 4px solid var(--accent);
  background: var(--surface-2);
  padding: 10px 12px;
  color: var(--text);
}

.journal-entry {
  display: grid;
  gap: 8px;
  margin-bottom: 8px;
}

.journal-entry span {
  color: var(--muted);
  font-size: 12px;
}

.review-pill.hit {
  border-color: rgba(47, 177, 160, 0.5);
  color: var(--accent-3);
}

.review-pill.partial {
  border-color: rgba(240, 200, 75, 0.55);
  color: var(--accent);
}

.review-pill.miss {
  border-color: rgba(255, 90, 79, 0.55);
  color: var(--red);
}

@media (max-width: 980px) {
  .signal-debate-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 6: Browser smoke test with mocked scan and journal APIs**

Run the server:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH PORT=5187 npm start
```

In another shell, run this Playwright smoke test:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH NODE_PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.60.0/node_modules node - <<'NODE'
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const token = {
    symbol: "LABUSDT",
    baseAsset: "LAB",
    lastPrice: 10,
    priceChange24h: 18,
    high24h: 10.2,
    low24h: 8.2,
    quoteVolume24h: 140000000,
    hasBinanceSpot: false,
    indexConstituents: [],
    attentionScore: 88,
    riskScore: 35,
    phase: "acceleration",
    tags: ["无币安现货", "合约放量"],
    warnings: [],
    confidence: "high",
    shortTermBias: "bullish",
    expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" },
    expectationConfidence: "high",
    expectationReasons: [],
    actionBias: "watch-long",
    actionSetup: "观察延续",
    actionReasons: [],
    signalReview: {
      reviewLabel: "continuation",
      bullCase: ["外部锚同步"],
      bearCase: [],
      riskGate: [],
      decisionSummary: "高关注且外部锚同步，风险未失控，适合观察延续。",
      decisionConfidence: "high"
    }
  };
  const entries = [{
    id: "LABUSDT-2026-06-21T08:00:00.000Z",
    symbol: "LABUSDT",
    observedAt: "2026-06-21T08:00:00.000Z",
    entryPrice: 10,
    actionBias: "watch-long",
    expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" },
    review1d: { movePct: 12, outcomeLabel: "hit" },
    review3d: { movePct: 5, outcomeLabel: "partial" }
  }];

  await page.route("**/api/radar/cex-scan", (route) => {
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ tokens: [token], updatedAt: "2026-06-21T08:00:00.000Z" }) });
  });
  await page.route("**/api/radar/cex-journal", (route) => {
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ entries }) });
  });
  await page.route("**/api/radar/cex-journal/capture", (route) => {
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries, capturedCount: 0, updatedCount: 1 }) });
  });
  await page.route("**/api/radar/cex-journal/review", (route) => {
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries, reviewedCount: 0 }) });
  });

  await page.goto("http://localhost:5187/cex-radar.html", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /扫描/ }).click();
  await page.getByText("信号辩论").waitFor();
  await page.getByText("牛方").waitFor();
  await page.getByText("历史复盘").waitFor();
  await page.getByText("1D +12.00% 命中").waitFor();

  await page.setViewportSize({ width: 390, height: 840 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false);

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
```

Expected: command exits with status `0`.

- [ ] **Step 7: Commit**

Run:

```bash
git add public/cex-radar.js public/styles.css
git commit -m "Render CEX signal review journal"
```

## Task 6: README And Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add this section after the CEX radar workflow section:

```md
## Signal review journal

The CEX radar keeps a local review journal at `data/cex-signal-journal.json`.

The journal records high-attention, high-risk, long-watch, short-watch, and pinned observed tokens. It reviews outcomes after 1 day and 3 days when a later scan has a current price.

This data is local-only and ignored by Git.
```

- [ ] **Step 2: Run final verification**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --check lib/cex-signal-review.js
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --check lib/cex-signal-journal.js
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --check lib/cex-signal-journal-store.js
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --check public/cex-radar.js
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test
git status --short
```

Expected:

```text
tests pass with fail 0
git status --short shows only intended README changes before the final commit
```

- [ ] **Step 3: Commit**

Run:

```bash
git add README.md
git commit -m "Document CEX signal journal"
```

- [ ] **Step 4: Push**

Run:

```bash
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push
```

Expected:

```text
codex/cex-radar-page -> codex/cex-radar-page
```

## Implementation Notes

- Keep `data/cex-signal-journal.json` out of Git. The current `.gitignore` already ignores `data/*.json`.
- Do not make LLM calls in this implementation.
- Do not change `actionBias` from frontend code. The backend remains the source of truth.
- If Binance Futures is blocked by the active proxy node, journal review should remain pending rather than recording a failed outcome.
- Use deterministic Chinese summary strings so tests can assert exact output.
