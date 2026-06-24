# CEX Paper Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paper-trading ledger that opens simulated futures positions from CEX radar signals using a 1000 USDT total account, risk-based sizing, dynamic leverage capped at 5x, mandatory stop loss, candle-path TP/SL simulation, and Telegram summaries.

**Architecture:** Add focused paper-trading modules under `lib/` and keep the existing radar scanner unchanged. The background monitor injects journal entries, current tokens, kline fetching, ledger storage, and notifier dependencies into the paper-trading workflow. The data model is shaped so a later Aster adapter can map paper trades to live futures order intents, but this plan does not place real orders.

**Tech Stack:** Node.js CommonJS modules, `node:test`, local JSON storage, Binance Futures public klines via existing `fetchJsonWithFallback`, Telegram notifier.

---

## File Structure

- Create `lib/cex-paper-trading.js`: pure paper-trading engine for account state, eligibility, leverage, sizing, TP/SL price calculation, candle-path exit simulation, and ledger updates.
- Create `lib/cex-paper-trading-store.js`: JSON save/load helpers for `data/cex-paper-trades.json`.
- Create `test/cex-paper-trading.test.js`: unit tests for sizing, leverage, eligibility, long/short exits, conservative same-candle behavior, and ledger updates.
- Create `test/cex-paper-trading-store.test.js`: store tests matching the journal store pattern.
- Modify `lib/cex-background-monitor.js`: inject paper-trading dependencies and run the paper workflow after journal review.
- Modify `test/cex-background-monitor.test.js`: verify paper-trading integration does not break existing alerts and does not crash on Telegram failure.
- Modify `server.js`: add paper ledger file path, API endpoint, Binance kline fetcher, and monitor wiring.
- Modify `.env.example` and `README.md`: document paper trading settings.

---

## Task 1: Paper-Trading Engine

**Files:**
- Create: `lib/cex-paper-trading.js`
- Test: `test/cex-paper-trading.test.js`

- [ ] **Step 1: Write failing engine tests**

Add tests that require:

```js
const {
  buildPaperTradeFromToken,
  evaluatePaperTradeWithCandles,
  runPaperTradingCycle
} = require("../lib/cex-paper-trading");
```

Test cases:

- `buildPaperTradeFromToken` sizes a long trade from `1000 USDT`, `1.5%` risk, `3x`, `6%` stop into about `250 USDT` notional and `83.33 USDT` margin.
- Leverage selection never exceeds `5`.
- `watch-only` and `avoid` signals return skipped decisions.
- Long candles hitting both TP and SL in the same candle close by `stop-loss`.
- Short candles hitting TP close by `take-profit`.
- `runPaperTradingCycle` opens at most 5 concurrent positions and refuses duplicate open symbols.

- [ ] **Step 2: Run failing tests**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --test test/cex-paper-trading.test.js
```

Expected: fail because `lib/cex-paper-trading.js` does not exist.

- [ ] **Step 3: Implement engine**

Create pure functions with this public API:

```js
const DEFAULT_PAPER_ACCOUNT = {
  initialEquityUsdt: 1000,
  maxConcurrentPositions: 5,
  maxMarginUsagePct: 50,
  defaultRiskPct: 1.5,
  minRewardRisk: 1.2,
  defaultStopLossPct: 6,
  maxLeverage: 5
};

function buildPaperTradeFromToken(token, context = {}) {}
function evaluatePaperTradeWithCandles(trade, candles, options = {}) {}
async function runPaperTradingCycle({ ledger, tokens, fetchKlines, now }) {}
```

Use conservative same-candle ordering: if TP and SL are both touched, choose SL.

- [ ] **Step 4: Run engine tests**

Run the same `node --test test/cex-paper-trading.test.js` command. Expected: all engine tests pass.

---

## Task 2: Paper Ledger Store

**Files:**
- Create: `lib/cex-paper-trading-store.js`
- Test: `test/cex-paper-trading-store.test.js`

- [ ] **Step 1: Write failing store tests**

Mirror `cex-signal-journal-store` behavior:

- missing file returns `[]`;
- save then load preserves trades;
- malformed JSON throws `CEX_PAPER_TRADES_MALFORMED`.

- [ ] **Step 2: Run failing store tests**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --test test/cex-paper-trading-store.test.js
```

Expected: fail because store module does not exist.

- [ ] **Step 3: Implement store**

Create `loadCexPaperTrades(filePath)` and `saveCexPaperTrades(filePath, trades)` with the same directory creation and newline formatting used by journal storage.

- [ ] **Step 4: Run store tests**

Run the same store test command. Expected: pass.

---

## Task 3: Background Monitor Integration

**Files:**
- Modify: `lib/cex-background-monitor.js`
- Modify: `test/cex-background-monitor.test.js`

- [ ] **Step 1: Write failing monitor test**

Add a test creating a monitor with:

```js
loadPaperTrades: async () => [],
savePaperTrades: async (trades) => { savedPaperTrades = trades; },
fetchKlines: async () => [{ openTime: ..., high: ..., low: ..., close: ... }]
```

Assert one eligible `watch-long` token opens a paper trade and the `runOnce()` result includes paper trading counts.

- [ ] **Step 2: Run monitor test**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --test test/cex-background-monitor.test.js
```

Expected: fail because monitor does not call paper trading.

- [ ] **Step 3: Implement monitor integration**

Add optional dependencies:

```js
loadPaperTrades,
savePaperTrades,
fetchKlines
```

When all are present, call `runPaperTradingCycle` after journal review and before status return. Paper errors should be logged and captured in status, but not fail the CEX scan.

- [ ] **Step 4: Run monitor test**

Run the same monitor test command. Expected: pass.

---

## Task 4: Server Wiring and API

**Files:**
- Modify: `server.js`
- Modify: `test/cex-signal-journal-api.test.js`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write failing server/API test**

Extend server API tests to assert:

- `GET /api/radar/paper-trades` returns `{ trades: [] }` when no file exists.
- monitor status includes paper fields when monitor is enabled in injected tests.

- [ ] **Step 2: Implement server wiring**

Add:

```js
const CEX_PAPER_TRADES_FILE = process.env.CEX_PAPER_TRADES_FILE || path.join(ROOT_DIR, "data", "cex-paper-trades.json");
```

Add route:

```js
GET /api/radar/paper-trades
```

Add Binance kline fetcher:

```js
async function fetchBinanceFuturesKlines(symbol, options = {}) {
  const url = new URL("https://fapi.binance.com/fapi/v1/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", options.interval || "5m");
  url.searchParams.set("limit", String(options.limit || 1000));
  if (options.startTime) url.searchParams.set("startTime", String(options.startTime));
  if (options.endTime) url.searchParams.set("endTime", String(options.endTime));
  const rows = await fetchJsonWithFallback(url.toString(), 15000, { headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" } });
  return rows.map(normalizeKlineRow);
}
```

Wire paper storage and fetcher into `createCexBackgroundMonitor`.

- [ ] **Step 3: Run server/API tests**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --test test/cex-signal-journal-api.test.js
```

Expected: pass.

---

## Task 5: Full Verification and Deployment

**Files:**
- All changed files.

- [ ] **Step 1: Run full local test suite**

Run:

```bash
PATH=/Users/husbandshawn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test
```

Expected: all tests pass.

- [ ] **Step 2: Commit implementation**

Run:

```bash
git add .env.example README.md server.js lib/cex-background-monitor.js lib/cex-paper-trading.js lib/cex-paper-trading-store.js test/cex-background-monitor.test.js test/cex-paper-trading.test.js test/cex-paper-trading-store.test.js test/cex-signal-journal-api.test.js
git commit -m "Add CEX paper trading simulator"
```

- [ ] **Step 3: Push and deploy**

Push the current branch, then update VPS:

```bash
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push
```

Then on VPS:

```bash
cd /opt/coin
git pull --ff-only origin codex/cex-radar-page
npm test
set -a && . ./.env && set +a
pm2 restart coin-radar --update-env
pm2 save
curl -fsS http://127.0.0.1:5187/api/radar/cex-monitor/status
```

Expected: remote tests pass and monitor status reports paper trading status fields.

---

## Self-Review

- Spec coverage: covered account sizing, dynamic leverage, mandatory stop loss, high/low candle path simulation, conservative same-candle behavior, storage, Telegram-safe integration, and future Aster-compatible model.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: public functions are consistently named `buildPaperTradeFromToken`, `evaluatePaperTradeWithCandles`, and `runPaperTradingCycle`; storage functions are consistently named `loadCexPaperTrades` and `saveCexPaperTrades`.
