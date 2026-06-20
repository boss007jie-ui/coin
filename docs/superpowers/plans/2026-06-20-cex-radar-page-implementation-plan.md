# CEX Radar Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dedicated CEX radar workbench with backend short-term expectation fields, long/short observation action fields, automatic discovery, and a manual pinned watchlist.

**Architecture:** Keep core decision logic in `lib/cex-radar.js` so it is testable and not duplicated in the browser. Add a static page at `public/cex-radar.html` with its own `public/cex-radar.js`, while reusing the existing Node server and stylesheet. Keep the existing asset dashboard behavior intact and add only a small navigation entry.

**Tech Stack:** Node.js CommonJS, native `node:test`, native browser JavaScript, existing Express-like local HTTP server, existing CSS design tokens.

---

## Source Spec

Implement the approved spec:

`docs/superpowers/specs/2026-06-20-cex-radar-page-design.md`

## File Structure

- Modify: `lib/cex-radar.js`
  - Add backend-computed `shortTermBias`, `expectedMovePctRange`, `expectationConfidence`, `expectationReasons`, `actionBias`, `actionSetup`, `invalidLevel`, and `actionReasons`.
  - Export helper functions for focused tests.
- Modify: `test/cex-radar.test.js`
  - Add deterministic tests for short-term expectation and action fields.
- Create: `public/cex-radar.html`
  - Dedicated radar workbench shell.
- Create: `public/cex-radar.js`
  - Fetch `/api/radar/cex-scan`, render table/details, manage pinned watchlist in localStorage.
- Modify: `public/index.html`
  - Add entry link to `/cex-radar.html`.
- Modify: `public/styles.css`
  - Add radar page layout, table, score badges, pinned watchlist, empty/error states, and responsive rules.
- Modify: `README.md`
  - Mention the CEX radar page route and local data exclusions.

## Task 1: Add Backend Expectation Tests

**Files:**
- Modify: `test/cex-radar.test.js`
- Test: `test/cex-radar.test.js`

- [ ] **Step 1: Extend the require block**

Update the import near the top of `test/cex-radar.test.js` to include the new helpers:

```js
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
```

- [ ] **Step 2: Add bullish continuation expectation test**

Append this test to `test/cex-radar.test.js`:

```js
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
```

- [ ] **Step 3: Add bearish pullback expectation test**

Append this test:

```js
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
```

- [ ] **Step 4: Add same-symbol avoid test**

Append this test:

```js
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
```

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- test/cex-radar.test.js
```

Expected:

```text
not ok ... Expected values to be strictly equal
```

or:

```text
not ok ... Cannot read properties of undefined
```

The exact first failure depends on which assertion runs first, but the new expectation/action fields should not pass before Task 2.

## Task 2: Implement Backend Expectation And Action Fields

**Files:**
- Modify: `lib/cex-radar.js`
- Test: `test/cex-radar.test.js`

- [ ] **Step 1: Add helper functions before `assembleCexToken`**

Insert this code in `lib/cex-radar.js` after `classifyCexPhase`:

```js
function hasSameSymbolRisk(candidate) {
  return Array.isArray(candidate?.sameSymbolMismatches) && candidate.sameSymbolMismatches.length > 0;
}

function hasUnvalidatedAnchor(candidate) {
  return (Array.isArray(candidate?.sameSymbolMismatches) ? candidate.sameSymbolMismatches : [])
    .some((row) => row?.unvalidated === true);
}

function signedRangeLabel(lower, upper) {
  const format = (value) => `${value > 0 ? "+" : ""}${value}%`;
  return `${format(lower)} ~ ${format(upper)}`;
}

function deriveCexExpectation(candidate, scores, phase) {
  const pullbackPct = getPullbackFromHighPct(candidate);
  const adlRisk = String(candidate?.adlRisk || "").toUpperCase();
  const fundingRate = toFiniteNumber(candidate?.fundingRate);
  const fundingAbs = Math.abs(fundingRate || 0);
  const anchorDispersionPct = toFiniteNumber(candidate?.anchorDispersionPct);
  const markIndexPremiumPct = Math.abs(toFiniteNumber(candidate?.markIndexPremiumPct) || 0);
  const validExternalAnchor = hasValidExternalAnchor(candidate);
  const sameSymbolRisk = hasSameSymbolRisk(candidate) || hasUnvalidatedAnchor(candidate);
  const reasons = [];

  if (sameSymbolRisk || !validExternalAnchor) {
    addUnique(reasons, sameSymbolRisk ? "同名币或锚价风险" : "缺少可验证外部锚");
    return {
      shortTermBias: "volatile-unclear",
      expectedMovePctRange: { lower: -20, upper: 20, label: signedRangeLabel(-20, 20) },
      expectationConfidence: "low",
      expectationReasons: reasons
    };
  }

  const riskBroken =
    scores.riskScore >= 70 &&
    (
      (Number.isFinite(pullbackPct) && pullbackPct >= 12) ||
      adlRisk === "HIGH" ||
      fundingAbs >= 0.001 ||
      markIndexPremiumPct >= 0.3 ||
      (Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) ||
      phase === "failed-breakout-risk"
    );

  if (riskBroken) {
    addUnique(reasons, "冲高回落风险");
    if (adlRisk === "HIGH") addUnique(reasons, "ADL拥挤");
    if (fundingAbs >= 0.001) addUnique(reasons, "Funding异常");
    if (markIndexPremiumPct >= 0.3) addUnique(reasons, "合约溢价扩大");
    if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) addUnique(reasons, "锚价分歧");
    return {
      shortTermBias: "bearish",
      expectedMovePctRange: { lower: -25, upper: -10, label: signedRangeLabel(-25, -10) },
      expectationConfidence: scores.confidence === "high" ? "medium" : "low",
      expectationReasons: reasons
    };
  }

  if (scores.attentionScore >= 70 && scores.riskScore < 70) {
    addUnique(reasons, "高关注且风险未失控");
    if (validExternalAnchor) addUnique(reasons, "外部锚同步");
    if (Number.isFinite(candidate?.futuresToAnchorVolumeRatio) && candidate.futuresToAnchorVolumeRatio >= 8) {
      addUnique(reasons, "合约量主导");
    }
    return {
      shortTermBias: "bullish",
      expectedMovePctRange: { lower: 8, upper: 18, label: signedRangeLabel(8, 18) },
      expectationConfidence: scores.confidence === "high" ? "high" : "medium",
      expectationReasons: reasons
    };
  }

  addUnique(reasons, "多空信号未形成一致");
  return {
    shortTermBias: "volatile-unclear",
    expectedMovePctRange: { lower: -15, upper: 15, label: signedRangeLabel(-15, 15) },
    expectationConfidence: scores.confidence === "high" ? "medium" : "low",
    expectationReasons: reasons
  };
}

function deriveCexAction(candidate, scores, phase, expectation) {
  const pullbackPct = getPullbackFromHighPct(candidate);
  const adlRisk = String(candidate?.adlRisk || "").toUpperCase();
  const reasons = [];
  const sameSymbolRisk = hasSameSymbolRisk(candidate) || hasUnvalidatedAnchor(candidate);

  if (sameSymbolRisk || expectation.expectationConfidence === "low") {
    addUnique(reasons, sameSymbolRisk ? "同名币或锚价无法验证" : "关键数据不足");
    return {
      actionBias: "avoid",
      actionSetup: sameSymbolRisk ? "same-symbol-avoid" : "insufficient-data",
      invalidLevel: "锚价无法验证，暂不设失效位",
      actionReasons: reasons
    };
  }

  if (expectation.shortTermBias === "bearish") {
    addUnique(reasons, "冲高回落风险");
    if (adlRisk === "HIGH") addUnique(reasons, "ADL拥挤");
    return {
      actionBias: "watch-short",
      actionSetup: "blowoff-fade",
      invalidLevel: "重新站上 24h 高点后失效",
      actionReasons: reasons
    };
  }

  if (expectation.shortTermBias === "bullish" && scores.riskScore < 60) {
    addUnique(reasons, "高关注且风险未失控");
    addUnique(reasons, "外部锚同步");
    return {
      actionBias: "watch-long",
      actionSetup: Number.isFinite(pullbackPct) && pullbackPct <= 5
        ? "breakout-continuation"
        : "pullback-confirmation",
      invalidLevel: "跌破 24h 低点后失效",
      actionReasons: reasons
    };
  }

  addUnique(reasons, "关注度高但风险同步升高");
  return {
    actionBias: "watch-only",
    actionSetup: "insufficient-data",
    invalidLevel: null,
    actionReasons: reasons
  };
}
```

- [ ] **Step 2: Merge fields into `assembleCexToken`**

In `assembleCexToken`, after `const phase = classifyCexPhase(candidate, scores);`, add:

```js
  const expectation = deriveCexExpectation(candidate, scores, phase);
  const action = deriveCexAction(candidate, scores, phase, expectation);
```

Then add these fields to the returned object after `confidence: scores.confidence`:

```js
    confidence: scores.confidence,
    shortTermBias: expectation.shortTermBias,
    expectedMovePctRange: expectation.expectedMovePctRange,
    expectationConfidence: expectation.expectationConfidence,
    expectationReasons: expectation.expectationReasons,
    actionBias: action.actionBias,
    actionSetup: action.actionSetup,
    invalidLevel: action.invalidLevel,
    actionReasons: action.actionReasons
```

- [ ] **Step 3: Export the helpers**

Add these names to `module.exports`:

```js
  deriveCexAction,
  deriveCexExpectation,
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- test/cex-radar.test.js
```

Expected:

```text
pass
```

- [ ] **Step 5: Run the full test suite**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test
```

Expected:

```text
fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/cex-radar.js test/cex-radar.test.js
git commit -m "Add CEX radar expectation fields"
```

## Task 3: Add Dedicated Radar Page Shell

**Files:**
- Create: `public/cex-radar.html`
- Modify: `public/index.html`
- Test: manual browser load

- [ ] **Step 1: Create `public/cex-radar.html`**

Create the file with this content:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#10110f" />
    <title>CEX 山寨币雷达</title>
    <link rel="stylesheet" href="/styles.css?v=9" />
  </head>
  <body class="radar-page">
    <div class="app-shell radar-shell">
      <header class="topbar radar-topbar">
        <div>
          <p class="eyebrow">CEX Altcoin Radar</p>
          <h1>CEX 山寨币雷达</h1>
        </div>
        <div class="topbar-actions">
          <a class="icon-button" href="/" title="返回资产看板" aria-label="返回资产看板">↩</a>
          <button class="icon-button" id="radarRefreshButton" title="刷新扫描" aria-label="刷新扫描">↻</button>
        </div>
      </header>

      <main>
        <section class="radar-control-panel">
          <div>
            <span class="muted">最后扫描</span>
            <strong id="radarUpdatedAt">尚未扫描</strong>
          </div>
          <label>
            <span>深度检查</span>
            <select id="radarDeepLimit">
              <option value="10">10</option>
              <option value="20" selected>20</option>
              <option value="50">50</option>
            </select>
          </label>
          <label>
            <span>排序</span>
            <select id="radarSort">
              <option value="attention-desc">关注度</option>
              <option value="risk-desc">风险</option>
              <option value="change-desc">24h 涨跌</option>
              <option value="volume-desc">合约成交额</option>
            </select>
          </label>
        </section>

        <section class="radar-summary-grid" id="radarSummaryGrid" aria-label="雷达概览"></section>

        <section class="radar-tabs" aria-label="雷达视图">
          <button class="radar-tab active" data-tab="auto" type="button">自动发现</button>
          <button class="radar-tab" data-tab="pinned" type="button">我的观察池</button>
        </section>

        <section class="radar-filter-bar" aria-label="雷达过滤">
          <button class="radar-filter active" data-filter="all" type="button">全部</button>
          <button class="radar-filter" data-filter="attention" type="button">高关注</button>
          <button class="radar-filter" data-filter="risk" type="button">高风险</button>
          <button class="radar-filter" data-filter="same-symbol" type="button">同名币风险</button>
          <button class="radar-filter" data-filter="source-issue" type="button">数据源异常</button>
          <button class="radar-filter" data-filter="pinned" type="button">已固定</button>
        </section>

        <section class="radar-workspace">
          <article class="radar-table-panel">
            <div class="radar-table-toolbar">
              <div>
                <h2>候选币</h2>
                <p id="radarTableStatus">等待扫描</p>
              </div>
              <form id="radarPinForm" class="radar-pin-form">
                <input id="radarManualSymbol" type="text" placeholder="手动添加，如 LABUSDT" />
                <button class="secondary-button" type="submit">固定</button>
              </form>
            </div>
            <div id="radarError" class="radar-error" hidden></div>
            <div class="table-wrap radar-table-wrap">
              <table class="radar-table">
                <thead>
                  <tr>
                    <th>币种</th>
                    <th>24h</th>
                    <th>合约成交额</th>
                    <th>关注</th>
                    <th>风险</th>
                    <th>短线预期</th>
                    <th>动作</th>
                    <th>阶段</th>
                    <th>标签</th>
                  </tr>
                </thead>
                <tbody id="radarTokenTable"></tbody>
              </table>
            </div>
          </article>

          <aside class="radar-detail-panel" id="radarDetailPanel">
            <div class="empty-state">选择一个币查看信号解释</div>
          </aside>
        </section>
      </main>
    </div>

    <div class="toast" id="radarToast" role="status" aria-live="polite"></div>
    <script src="/cex-radar.js?v=1"></script>
  </body>
</html>
```

- [ ] **Step 2: Add entry link in `public/index.html`**

In `.topbar-actions`, add this link before the existing `radarButton`:

```html
          <a class="icon-button" href="/cex-radar.html" title="CEX 山寨币雷达" aria-label="CEX 山寨币雷达">⌁</a>
```

- [ ] **Step 3: Start server and load the page**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH PORT=5187 npm start
```

Open:

```text
http://localhost:5187/cex-radar.html
```

Expected:

- The page loads without JavaScript behavior yet.
- The title, controls, tabs, empty detail panel, and table header are visible.

- [ ] **Step 4: Commit**

Run:

```bash
git add public/cex-radar.html public/index.html
git commit -m "Add CEX radar page shell"
```

## Task 4: Implement Radar Frontend State And Rendering

**Files:**
- Create: `public/cex-radar.js`
- Test: manual browser load with real endpoint and failure state

- [ ] **Step 1: Create `public/cex-radar.js`**

Create the file with this complete initial implementation:

```js
const RADAR_PIN_STORAGE_KEY = "cex-radar-pinned-symbols-v1";
const AUTO_ATTENTION_THRESHOLD = 60;
const AUTO_RISK_THRESHOLD = 60;

const radarState = {
  tokens: [],
  errors: [],
  selectedSymbol: null,
  tab: "auto",
  filter: "all",
  sort: "attention-desc",
  deepLimit: 20,
  pinnedSymbols: [],
  loading: false,
  lastError: null,
  updatedAt: null
};

const radarEls = {};

document.addEventListener("DOMContentLoaded", initCexRadarPage);

function initCexRadarPage() {
  cacheRadarElements();
  loadPinnedSymbols();
  bindRadarEvents();
  renderRadarPage();
  fetchCexRadarScan(false);
}

function cacheRadarElements() {
  [
    "radarRefreshButton",
    "radarUpdatedAt",
    "radarDeepLimit",
    "radarSort",
    "radarSummaryGrid",
    "radarTableStatus",
    "radarPinForm",
    "radarManualSymbol",
    "radarError",
    "radarTokenTable",
    "radarDetailPanel",
    "radarToast"
  ].forEach((id) => {
    radarEls[id] = document.getElementById(id);
  });
  radarEls.tabs = [...document.querySelectorAll(".radar-tab")];
  radarEls.filters = [...document.querySelectorAll(".radar-filter")];
}

function bindRadarEvents() {
  radarEls.radarRefreshButton?.addEventListener("click", () => fetchCexRadarScan(true));
  radarEls.radarDeepLimit?.addEventListener("change", () => {
    radarState.deepLimit = Number(radarEls.radarDeepLimit.value || 20);
    fetchCexRadarScan(true);
  });
  radarEls.radarSort?.addEventListener("change", () => {
    radarState.sort = radarEls.radarSort.value;
    renderRadarPage();
  });
  radarEls.tabs.forEach((button) => {
    button.addEventListener("click", () => {
      radarState.tab = button.dataset.tab || "auto";
      renderRadarPage();
    });
  });
  radarEls.filters.forEach((button) => {
    button.addEventListener("click", () => {
      radarState.filter = button.dataset.filter || "all";
      renderRadarPage();
    });
  });
  radarEls.radarPinForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const symbol = normalizeSymbolInput(radarEls.radarManualSymbol.value);
    if (!symbol) return;
    pinSymbol(symbol);
    radarEls.radarManualSymbol.value = "";
  });
}

async function fetchCexRadarScan(force) {
  radarState.loading = true;
  radarState.lastError = null;
  renderRadarPage();

  const params = new URLSearchParams({ deepInspectLimit: String(radarState.deepLimit) });
  if (force) params.set("force", "true");

  try {
    const response = await fetch(`/api/radar/cex-scan?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(payload.error || "CEX radar scan failed"), {
        status: response.status,
        details: payload.details || null
      });
    }
    radarState.tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
    radarState.errors = Array.isArray(payload.errors) ? payload.errors : [];
    radarState.updatedAt = payload.updatedAt || new Date().toISOString();
    radarState.selectedSymbol = chooseSelectedSymbol(radarState.selectedSymbol);
  } catch (error) {
    radarState.lastError = error;
    radarState.tokens = [];
    radarState.errors = [];
    radarState.updatedAt = null;
  } finally {
    radarState.loading = false;
    renderRadarPage();
  }
}

function loadPinnedSymbols() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RADAR_PIN_STORAGE_KEY) || "[]");
    radarState.pinnedSymbols = Array.isArray(parsed) ? parsed.map(normalizeSymbolInput).filter(Boolean) : [];
  } catch {
    radarState.pinnedSymbols = [];
  }
}

function savePinnedSymbols() {
  localStorage.setItem(RADAR_PIN_STORAGE_KEY, JSON.stringify(radarState.pinnedSymbols));
}

function normalizeSymbolInput(value) {
  const upper = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!upper) return "";
  return upper.endsWith("USDT") ? upper : `${upper}USDT`;
}

function pinSymbol(symbol) {
  if (!radarState.pinnedSymbols.includes(symbol)) {
    radarState.pinnedSymbols.push(symbol);
    savePinnedSymbols();
    showRadarToast(`${symbol} 已加入观察池`);
  }
  radarState.tab = "pinned";
  radarState.selectedSymbol = symbol;
  renderRadarPage();
}

function unpinSymbol(symbol) {
  radarState.pinnedSymbols = radarState.pinnedSymbols.filter((item) => item !== symbol);
  savePinnedSymbols();
  showRadarToast(`${symbol} 已移出观察池`);
  if (radarState.selectedSymbol === symbol) {
    radarState.selectedSymbol = chooseSelectedSymbol(null);
  }
  renderRadarPage();
}

function chooseSelectedSymbol(currentSymbol) {
  const visible = getVisibleTokens();
  if (currentSymbol && visible.some((token) => token.symbol === currentSymbol)) return currentSymbol;
  return visible[0]?.symbol || currentSymbol || null;
}

function renderRadarPage() {
  renderRadarControls();
  renderRadarSummary();
  renderRadarError();
  renderRadarTable();
  renderRadarDetail();
}

function renderRadarControls() {
  if (radarEls.radarRefreshButton) {
    radarEls.radarRefreshButton.disabled = radarState.loading;
    radarEls.radarRefreshButton.textContent = radarState.loading ? "…" : "↻";
  }
  if (radarEls.radarUpdatedAt) {
    radarEls.radarUpdatedAt.textContent = radarState.updatedAt
      ? new Date(radarState.updatedAt).toLocaleString("zh-CN")
      : "尚未扫描";
  }
  radarEls.tabs?.forEach((button) => button.classList.toggle("active", button.dataset.tab === radarState.tab));
  radarEls.filters?.forEach((button) => button.classList.toggle("active", button.dataset.filter === radarState.filter));
}

function renderRadarSummary() {
  const tokens = radarState.tokens;
  const cards = [
    ["候选", tokens.length],
    ["高关注", tokens.filter((token) => token.attentionScore >= 70).length],
    ["高风险", tokens.filter((token) => token.riskScore >= 50).length],
    ["数据源异常", radarState.errors.length + (radarState.lastError ? 1 : 0)],
    ["观察池", radarState.pinnedSymbols.length]
  ];

  radarEls.radarSummaryGrid.innerHTML = cards.map(([label, value]) => `
    <article class="radar-summary-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");
}

function renderRadarError() {
  if (!radarEls.radarError) return;
  if (!radarState.lastError && radarState.errors.length === 0) {
    radarEls.radarError.hidden = true;
    radarEls.radarError.innerHTML = "";
    return;
  }
  radarEls.radarError.hidden = false;
  const topError = radarState.lastError
    ? `${radarState.lastError.message}${radarState.lastError.details?.source ? ` / ${radarState.lastError.details.source}` : ""}`
    : radarState.errors.map((error) => error.message || String(error)).join("；");
  radarEls.radarError.textContent = `数据源异常：${topError}`;
}

function getAutoTokens() {
  return radarState.tokens.filter((token) => (
    (token.attentionScore || 0) >= AUTO_ATTENTION_THRESHOLD ||
    (token.riskScore || 0) >= AUTO_RISK_THRESHOLD
  ));
}

function getPinnedTokens() {
  const tokenMap = new Map(radarState.tokens.map((token) => [token.symbol, token]));
  return radarState.pinnedSymbols.map((symbol) => tokenMap.get(symbol) || {
    symbol,
    baseAsset: symbol.replace(/USDT$/, ""),
    unavailable: true,
    tags: ["暂无数据"],
    warnings: ["当前扫描结果中没有该币种"]
  });
}

function getVisibleTokens() {
  const source = radarState.tab === "pinned" ? getPinnedTokens() : getAutoTokens();
  return sortTokens(source.filter(matchesFilter));
}

function matchesFilter(token) {
  if (radarState.filter === "attention") return (token.attentionScore || 0) >= 70;
  if (radarState.filter === "risk") return (token.riskScore || 0) >= 50;
  if (radarState.filter === "same-symbol") return (token.tags || []).includes("同名币风险");
  if (radarState.filter === "source-issue") return token.unavailable || (token.warnings || []).length > 0;
  if (radarState.filter === "pinned") return radarState.pinnedSymbols.includes(token.symbol);
  return true;
}

function sortTokens(tokens) {
  const sorted = [...tokens];
  const key = radarState.sort;
  sorted.sort((a, b) => {
    if (key === "risk-desc") return (b.riskScore || 0) - (a.riskScore || 0);
    if (key === "change-desc") return (b.priceChange24h || 0) - (a.priceChange24h || 0);
    if (key === "volume-desc") return (b.quoteVolume24h || 0) - (a.quoteVolume24h || 0);
    return (b.attentionScore || 0) - (a.attentionScore || 0);
  });
  return sorted;
}

function renderRadarTable() {
  const visible = getVisibleTokens();
  radarEls.radarTableStatus.textContent = radarState.loading
    ? "扫描中"
    : visible.length ? `显示 ${visible.length} 个候选` : "暂无候选";

  if (!visible.length) {
    radarEls.radarTokenTable.innerHTML = `<tr><td colspan="9"><div class="empty-state">暂无候选</div></td></tr>`;
    return;
  }

  radarEls.radarTokenTable.innerHTML = visible.map((token) => {
    const selected = token.symbol === radarState.selectedSymbol ? " selected" : "";
    const pinned = radarState.pinnedSymbols.includes(token.symbol);
    return `
      <tr class="radar-row${selected}" data-symbol="${token.symbol}">
        <td><button class="radar-symbol-button" type="button" data-symbol="${token.symbol}">${token.symbol}</button>${pinned ? " ★" : ""}</td>
        <td class="${valueClass(token.priceChange24h)}">${formatPct(token.priceChange24h)}</td>
        <td>${formatCompactUsd(token.quoteVolume24h)}</td>
        <td>${scoreBadge(token.attentionScore, "attention")}</td>
        <td>${scoreBadge(token.riskScore, "risk")}</td>
        <td>${expectationLabel(token)}</td>
        <td>${actionLabel(token.actionBias)}</td>
        <td>${phaseLabel(token.phase)}</td>
        <td>${tagList(token.tags)}</td>
      </tr>
    `;
  }).join("");

  radarEls.radarTokenTable.querySelectorAll("[data-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      radarState.selectedSymbol = button.dataset.symbol;
      renderRadarPage();
    });
  });
}

function renderRadarDetail() {
  const token = [...radarState.tokens, ...getPinnedTokens()].find((item) => item.symbol === radarState.selectedSymbol);
  if (!token) {
    radarEls.radarDetailPanel.innerHTML = `<div class="empty-state">选择一个币查看信号解释</div>`;
    return;
  }

  const pinned = radarState.pinnedSymbols.includes(token.symbol);
  radarEls.radarDetailPanel.innerHTML = `
    <div class="radar-detail-header">
      <div>
        <p class="eyebrow">${token.baseAsset || ""}</p>
        <h2>${token.symbol}</h2>
      </div>
      <button class="secondary-button" id="radarPinToggle" type="button">${pinned ? "取消固定" : "固定观察"}</button>
    </div>
    ${token.unavailable ? `<div class="radar-error">当前扫描结果中没有该币种。</div>` : ""}
    <div class="radar-detail-grid">
      ${detailMetric("短线预期", expectationLabel(token))}
      ${detailMetric("预期区间", token.expectedMovePctRange?.label || "--")}
      ${detailMetric("置信度", confidenceLabel(token.expectationConfidence || token.confidence))}
      ${detailMetric("观察动作", actionLabel(token.actionBias))}
      ${detailMetric("失效条件", token.invalidLevel || "--")}
      ${detailMetric("阶段", phaseLabel(token.phase))}
    </div>
    ${detailList("预期依据", token.expectationReasons)}
    ${detailList("动作依据", token.actionReasons)}
    ${detailList("标签", token.tags)}
    ${detailList("警告", token.warnings)}
    <div class="radar-raw-metrics">
      ${detailMetric("Funding", formatPct((token.fundingRate || 0) * 100))}
      ${detailMetric("ADL", token.adlRisk || "--")}
      ${detailMetric("锚价偏差", formatPct(token.anchorDispersionPct))}
      ${detailMetric("合约/锚成交量", formatRatio(token.futuresToAnchorVolumeRatio))}
    </div>
  `;

  document.getElementById("radarPinToggle")?.addEventListener("click", () => {
    pinned ? unpinSymbol(token.symbol) : pinSymbol(token.symbol);
  });
}

function detailMetric(label, value) {
  return `<div class="radar-detail-metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function detailList(label, items) {
  const safeItems = Array.isArray(items) && items.length ? items : ["--"];
  return `<div class="radar-detail-list"><h3>${label}</h3><div>${safeItems.map((item) => `<span>${item}</span>`).join("")}</div></div>`;
}

function scoreBadge(value, kind) {
  if (!Number.isFinite(value)) return `<span class="score-badge">--</span>`;
  return `<span class="score-badge ${kind}">${Math.round(value)}</span>`;
}

function tagList(tags) {
  return (Array.isArray(tags) ? tags : []).slice(0, 3).map((tag) => `<span class="mini-tag">${tag}</span>`).join("");
}

function expectationLabel(token) {
  if (token.shortTermBias === "bullish") return "偏涨";
  if (token.shortTermBias === "bearish") return "偏跌";
  if (token.shortTermBias === "volatile-unclear") return "高波动不明";
  return "--";
}

function actionLabel(value) {
  if (value === "watch-long") return "观察做多";
  if (value === "watch-short") return "观察做空";
  if (value === "watch-only") return "只观察不追";
  if (value === "avoid") return "回避";
  return "--";
}

function phaseLabel(value) {
  const labels = {
    candidate: "候选",
    acceleration: "加速",
    "high-risk-extension": "高风险延伸",
    "pullback-watch": "回撤观察",
    "failed-breakout-risk": "突破失败风险",
    "same-symbol-risk": "同名币风险"
  };
  return labels[value] || value || "--";
}

function confidenceLabel(value) {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  if (value === "low") return "低";
  return "--";
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatRatio(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}x`;
}

function formatCompactUsd(value) {
  if (!Number.isFinite(value)) return "--";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function valueClass(value) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "positive" : "negative";
}

function showRadarToast(message) {
  if (!radarEls.radarToast) return;
  radarEls.radarToast.textContent = message;
  radarEls.radarToast.classList.add("show");
  setTimeout(() => radarEls.radarToast.classList.remove("show"), 1800);
}
```

- [ ] **Step 2: Load the page with the live endpoint**

Run the server:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH PORT=5187 npm start
```

Open:

```text
http://localhost:5187/cex-radar.html
```

Expected in the current local network:

- If Binance Futures is blocked, the page shows `数据源异常`.
- The page still keeps controls visible.
- The table shows `暂无候选`.

- [ ] **Step 3: Verify pin/unpin localStorage**

In the page:

1. Enter `LAB` in the manual pin input.
2. Click `固定`.
3. Confirm the `我的观察池` tab shows `LABUSDT`.
4. Reload the page.
5. Confirm `LABUSDT` remains in the watchlist.

- [ ] **Step 4: Commit**

Run:

```bash
git add public/cex-radar.js
git commit -m "Add CEX radar frontend behavior"
```

## Task 5: Add Radar Page Styles

**Files:**
- Modify: `public/styles.css`
- Test: browser desktop and mobile widths

- [ ] **Step 1: Append radar styles**

Append this CSS to `public/styles.css`:

```css
.radar-page .app-shell {
  max-width: 1500px;
}

.radar-control-panel,
.radar-filter-bar,
.radar-tabs,
.radar-workspace,
.radar-summary-grid {
  margin-top: 16px;
}

.radar-control-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px 220px;
  gap: 12px;
  align-items: end;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 16px;
}

.radar-control-panel label {
  display: grid;
  gap: 8px;
}

.radar-control-panel select,
.radar-pin-form input {
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
  padding: 0 12px;
}

.radar-summary-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.radar-summary-card,
.radar-table-panel,
.radar-detail-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}

.radar-summary-card {
  min-height: 82px;
  padding: 14px;
  display: grid;
  align-content: space-between;
}

.radar-summary-card span,
.radar-detail-metric span {
  color: var(--muted);
  font-size: 13px;
}

.radar-summary-card strong {
  font-size: 30px;
}

.radar-tabs,
.radar-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.radar-tab,
.radar-filter {
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  padding: 0 14px;
}

.radar-tab.active,
.radar-filter.active {
  border-color: var(--accent);
  background: var(--surface-3);
  color: var(--accent);
}

.radar-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.7fr);
  gap: 16px;
  align-items: start;
}

.radar-table-panel,
.radar-detail-panel {
  min-width: 0;
  padding: 16px;
}

.radar-table-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: end;
  margin-bottom: 12px;
}

.radar-table-toolbar p {
  margin: 6px 0 0;
  color: var(--muted);
}

.radar-pin-form {
  display: flex;
  gap: 8px;
  align-items: center;
}

.radar-table-wrap {
  overflow-x: auto;
}

.radar-table {
  min-width: 1040px;
}

.radar-row.selected {
  background: rgba(240, 200, 75, 0.08);
}

.radar-symbol-button {
  border: 0;
  background: transparent;
  color: var(--accent);
  font-weight: 800;
  padding: 0;
}

.score-badge,
.mini-tag,
.radar-detail-list span {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 8px;
  background: var(--surface-2);
  white-space: nowrap;
}

.score-badge.attention {
  border-color: rgba(240, 200, 75, 0.65);
  color: var(--accent);
}

.score-badge.risk {
  border-color: rgba(255, 90, 79, 0.65);
  color: var(--red);
}

.radar-detail-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: start;
  margin-bottom: 16px;
}

.radar-detail-grid,
.radar-raw-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.radar-detail-metric {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
  padding: 12px;
  display: grid;
  gap: 8px;
}

.radar-detail-list {
  margin-top: 14px;
}

.radar-detail-list h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.radar-detail-list div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.radar-error,
.empty-state {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--muted);
  padding: 14px;
}

.radar-error {
  border-color: rgba(255, 90, 79, 0.5);
  color: var(--red);
  margin-bottom: 12px;
}

.positive {
  color: var(--red);
}

.negative {
  color: var(--green);
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}

@media (max-width: 980px) {
  .radar-control-panel,
  .radar-workspace,
  .radar-summary-grid {
    grid-template-columns: 1fr;
  }

  .radar-table-toolbar,
  .radar-pin-form,
  .radar-detail-header {
    align-items: stretch;
    flex-direction: column;
  }

  .radar-detail-grid,
  .radar-raw-metrics {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Check CSS color balance**

Run:

```bash
rg -n "#[0-9a-fA-F]{3,6}|rgba|var\\(--" public/styles.css
```

Expected:

- Radar CSS reuses existing variables.
- No new purple/blue gradient or one-hue palette is introduced.

- [ ] **Step 3: Browser verify desktop and mobile**

Use the browser at:

```text
http://localhost:5187/cex-radar.html
```

Check:

- Desktop width: table and detail panel sit side by side.
- Mobile width around 390px: layout stacks, table scrolls horizontally, controls do not overlap.
- Error and empty states are visible.

- [ ] **Step 4: Commit**

Run:

```bash
git add public/styles.css
git commit -m "Style CEX radar workbench"
```

## Task 6: README And Final Verification

**Files:**
- Modify: `README.md`
- Test: full suite and browser smoke test

- [ ] **Step 1: Update README route notes**

Add this section to `README.md` after local setup:

```md
## Pages

- `/` - local asset dashboard
- `/cex-radar.html` - CEX altcoin radar workbench

The radar backend endpoint is:

```text
GET /api/radar/cex-scan?deepInspectLimit=20
```
```

- [ ] **Step 2: Run all tests**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test
```

Expected:

```text
tests 26
fail 0
```

The exact test count may be higher if extra tests were added, but failures must be zero.

- [ ] **Step 3: Start the local server**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH PORT=5187 npm start
```

Expected:

```text
Asset dashboard running at http://localhost:5187
```

- [ ] **Step 4: Verify endpoint failure is UI-safe**

Open:

```text
http://localhost:5187/cex-radar.html
```

Expected in the current local network:

- If `fapi.binance.com` is blocked, the UI shows data-source failure.
- There is no blank page.
- Pinning still works.

- [ ] **Step 5: Verify the asset dashboard entry**

Open:

```text
http://localhost:5187/
```

Expected:

- Existing dashboard loads.
- The CEX radar entry opens `/cex-radar.html`.
- Existing old radar dialog button still exists and does not throw JavaScript errors.

- [ ] **Step 6: Commit**

Run:

```bash
git add README.md
git commit -m "Document CEX radar page"
```

- [ ] **Step 7: Push to GitHub through local proxy**

Run:

```bash
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push
```

Expected:

```text
main -> main
```

## Self-Review Checklist

- Spec coverage:
  - Dedicated page: Task 3.
  - Watch-decision workflow: Tasks 4 and 5.
  - Short-term expectation: Tasks 1 and 2.
  - Long/short observation action: Tasks 1 and 2.
  - Auto discovery and manual pinned watchlist: Task 4.
  - Error handling and empty state: Tasks 4 and 6.
  - Tests and verification: Tasks 1, 2, 5, and 6.
- Placeholder scan:
  - No placeholder markers or intentionally vague implementation steps.
- Type consistency:
  - Backend fields match the spec: `shortTermBias`, `expectedMovePctRange`, `expectationConfidence`, `expectationReasons`, `actionBias`, `actionSetup`, `invalidLevel`, `actionReasons`.
  - Frontend uses the same field names and treats missing fields as display `--`.
