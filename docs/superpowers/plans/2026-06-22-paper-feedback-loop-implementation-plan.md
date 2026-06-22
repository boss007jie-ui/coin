# Paper Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert closed paper futures trades into deterministic setup-level feedback that can flag weak rules before live-trading automation consumes them.

**Architecture:** Add a focused `lib/cex-paper-feedback.js` module that groups closed trades by experiment group, side, action setup, signal review label, and phase. Reuse that module in the background monitor, API response, and radar detail panel so Telegram and UI show the same review state.

**Tech Stack:** Node.js CommonJS modules, `node:test`, existing static JS radar page, existing Telegram notifier path.

---

### Task 1: Paper Feedback Summary Module

**Files:**
- Create: `lib/cex-paper-feedback.js`
- Test: `test/cex-paper-feedback.test.js`

- [ ] **Step 1: Write failing tests**

Create tests that call `buildPaperFeedbackSummary(trades)` with closed baseline and optimistic trades. Assert that setup groups include `sampleSize`, `winRatePct`, `totalPnlUsdt`, `maxLossStreak`, `needsReview`, and `reviewReasons`.

- [ ] **Step 2: Run red test**

Run: `node --test test/cex-paper-feedback.test.js`

Expected: FAIL because `../lib/cex-paper-feedback` does not exist.

- [ ] **Step 3: Implement minimal module**

Implement `buildPaperFeedbackSummary`, grouping only closed trades and marking `needsReview` when sample size is at least 3 and the group has negative total PnL, win rate below 35%, or max loss streak of at least 2.

- [ ] **Step 4: Run green test**

Run: `node --test test/cex-paper-feedback.test.js`

Expected: PASS.

### Task 2: Persist Setup Fields On New Paper Trades

**Files:**
- Modify: `lib/cex-paper-trading.js`
- Modify: `test/cex-paper-trading.test.js`

- [ ] **Step 1: Write failing assertions**

Extend the existing open-trade test to assert new trades contain `actionBias`, `shortTermBias`, `reviewLabel`, and `phase`.

- [ ] **Step 2: Run red test**

Run: `node --test test/cex-paper-trading.test.js`

Expected: FAIL because the new fields are absent.

- [ ] **Step 3: Store setup fields**

Add those fields to the trade object returned by `buildPaperTradeFromToken` without changing sizing, isolated margin, trailing stop, leverage cap, or strategy-profile behavior.

- [ ] **Step 4: Run green test**

Run: `node --test test/cex-paper-trading.test.js`

Expected: PASS.

### Task 3: Telegram And Monitor Status Feedback

**Files:**
- Modify: `lib/cex-background-monitor.js`
- Modify: `test/cex-background-monitor.test.js`

- [ ] **Step 1: Write failing summary test**

Add closed losing trades to the daily summary test and assert the Telegram text includes a `需复盘` line with setup-level PnL and win rate.

- [ ] **Step 2: Run red test**

Run: `node --test test/cex-background-monitor.test.js`

Expected: FAIL because scheduled summaries do not include paper feedback.

- [ ] **Step 3: Import feedback module**

Compute feedback after `runPaperTradingCycle`, store the top review items under `state.lastPaperTrading.feedback`, and append concise feedback lines to daily/weekly summaries.

- [ ] **Step 4: Run green test**

Run: `node --test test/cex-background-monitor.test.js`

Expected: PASS.

### Task 4: API And Radar Detail Visibility

**Files:**
- Modify: `server.js`
- Modify: `public/cex-radar.js`
- Modify: `test/cex-signal-journal-api.test.js`

- [ ] **Step 1: Write failing API assertion**

Update `/api/radar/paper-trades` test to assert the response includes `feedback.closedCount` and `feedback.setups`.

- [ ] **Step 2: Run red test**

Run: `node --test test/cex-signal-journal-api.test.js`

Expected: FAIL because the API returns trades only.

- [ ] **Step 3: Return feedback and render it**

Return `feedback` from the API. In `public/cex-radar.js`, load paper trades beside the journal and add a compact `模拟反馈` section to the selected token detail panel showing symbol PnL, matching setup feedback, and review flags.

- [ ] **Step 4: Run green test**

Run: `node --test test/cex-signal-journal-api.test.js`

Expected: PASS.

### Task 5: Documentation And Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Document that paper trading now produces setup-level feedback, flags weak setups before live adapters may use them, and sends review lines in daily/weekly Telegram summaries.

- [ ] **Step 2: Run full tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Review git diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only planned files changed.
