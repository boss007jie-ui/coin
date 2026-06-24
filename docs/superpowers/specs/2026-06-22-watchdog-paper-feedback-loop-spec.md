# Watchdog SPEC: Paper Trading Feedback Loop Drift

## Watchdog Verdict

- Level: Yellow
- Date: 2026-06-22
- Reviewer: Mission Watchdog

## Problem

The project has a working CEX radar, signal journal, paper trading ledger, Telegram summaries, and risk controls. The weak point is that paper trading results are still mostly reported as account/trade summaries instead of being converted into strategy feedback that can downgrade bad setups, validate good setups, or force review before more entries.

This is a light mission drift risk: the system is not abandoning trading execution, but simulated trades can become a ledger/reporting layer instead of a rule-improvement loop. The charter requires using real results to remove ineffective rules, not using more indicators to hide bad decisions.

## Evidence

- `README.md:81`: Paper trading is simulation-only, uses isolated margin, trailing stops, risk sizing, leverage cap, and signal exits. This is strong execution alignment, but it describes position handling more than rule feedback.
- `README.md:83`: Daily/weekly Telegram summaries and capital-stop defensive mode exist, but only the capital-stop case explicitly changes behavior.
- `docs/project-trading-charter.md:18`: The charter requires review optimization, using trade results to correct strategy rather than hiding errors with more metrics.
- `docs/project-trading-charter.md:26`: One top priority is using real results to eliminate invalid rules.
- `lib/cex-background-monitor.js:202`: Last paper-trading status exposes account-level totals and grouped accounts, but not setup-level or rule-level performance.
- `lib/cex-background-monitor.js:231`: Equity below 500 USDT triggers a defensive profile, proving behavior can change from results, but the trigger is only account-level.
- `public/cex-radar.js:365`: The radar summary shows candidate, attention, risk, data issue, and observation-pool counts, but not paper PnL, drawdown, win rate, or setup degradation signals.
- `public/cex-radar.js:589`: The detail panel shows 1D/3D signal journal history, but not paper trade outcome history for the selected setup.
- `test/cex-paper-trading.test.js:210`: Baseline and optimistic comparison groups are tested independently.
- `test/cex-background-monitor.test.js:425`: Defensive mode after equity loss is tested, but no test verifies that repeated losing setups are surfaced or downgraded before more entries.

## Trading Risk

- Losing setups may continue opening because only account-level capital-stop changes behavior.
- Baseline vs optimistic comparison may become reporting instead of decision input.
- The radar page may keep growing as a candidate board while hiding whether a setup actually makes money.
- Telegram summaries may report PnL without forcing rule review unless equity is already badly damaged.
- Future automation could inherit unvalidated setups because the simulator did not produce rule-level acceptance/rejection signals.

## Desired Behavior

Paper trading results should feed back into trading decisions and review:

- Show setup-level paper performance by action setup, side, signal label, and experiment group.
- Surface loss clusters before the account reaches the capital-stop threshold.
- Mark setups that require review after repeated losses, poor reward/risk realization, or high drawdown.
- Include rule-feedback items in Telegram summaries so the system can act without manual page watching.
- Preserve the existing isolated margin, trailing stop, leverage cap, risk sizing, and defensive mode.

## Proposed Solution

- Add a paper-performance review layer that groups closed trades by `actionSetup`, `side`, `experimentGroup`, `exitReason`, and signal review label when those fields are available.
- Add derived feedback fields such as win rate, average PnL, total PnL, max drawdown or worst loss, loss streak, and sample size.
- Add a conservative review gate such as `needs-review` for setups with enough sample size and poor outcomes.
- Add Telegram daily/weekly summary lines for worst setups and setups that require review.
- Add radar page visibility for paper performance without turning the page into a decorative dashboard: selected token/setup should show whether similar paper trades made or lost money.
- Add tests proving that poor setup performance is summarized and does not lower risk controls.

## Acceptance Criteria

- [ ] Closed paper trades can be summarized by experiment group and setup/signal category.
- [ ] Daily or weekly Telegram summaries include worst setup groups when enough closed trades exist.
- [ ] Radar detail or summary surfaces paper performance tied to the selected symbol/setup, not only generic account totals.
- [ ] A setup with repeated poor results is flagged for review before any live-trading adapter can use it.
- [ ] Tests cover baseline vs optimistic performance comparison, poor-setup detection, and Telegram summary output.
- [ ] Existing constraints remain intact: isolated margin, trailing stop, leverage cap, risk sizing, and defensive mode.

## Non-Goals

- Do not add live trading.
- Do not place or recommend real orders.
- Do not touch secrets, API keys, Telegram tokens, or VPS credentials.
- Do not lower the risk threshold to chase better paper returns.
- Do not add cosmetic-only charts that do not change review, risk, or execution decisions.

## Implementation Notes for Builder Agent

- Keep all work simulation-only.
- Do not weaken isolated margin, trailing stop, leverage cap, max position, margin cap, or defensive-profile behavior.
- Treat paper feedback as a risk/review input, not a promise that a setup will be profitable.
- Prefer deterministic summaries and tests so Telegram output and review gates can be verified.
- Do not touch local secret files or deployment configuration.
- Do not make the radar page prettier at the expense of faster trading review and execution decisions.
