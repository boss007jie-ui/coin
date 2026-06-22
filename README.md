# Coin Asset Radar

Local asset dashboard and CEX altcoin radar prototype.

This project is now governed by the CEX trading charter in `docs/project-trading-charter.md`: monitoring exists to support practical trading decisions, risk control, review, and eventual automated execution. It is not a research dashboard for its own sake.

Use `docs/prompts/mission-watchdog-agent.md` for a read-only Mission Watchdog agent. If it finds a `Yellow` or `Red` drift, it should write a solution SPEC under `docs/superpowers/specs/` using `docs/prompts/watchdog-spec-template.md`.

## What is included

- Multi-platform asset dashboard frontend.
- Local Node.js API server.
- CEX altcoin radar backend scanner and scoring helpers.
- Tests for radar filtering, scoring, orchestration, and error handling.
- Design notes for the CEX radar page and signal engine.

## Local setup

```bash
npm start
```

Open the local pages:

- Asset dashboard: `http://localhost:5173/`
- CEX altcoin radar: `http://localhost:5173/cex-radar.html`

Run tests:

```bash
npm test
```

## CEX radar workflow

The CEX radar page scans Binance USDT futures that do not have ordinary Binance Spot pairs, deep-inspects selected candidates, and shows attention/risk scores, short-term move expectations, and long/short observation suggestions.

The observation pool supports automatic discovery and manual pinning. Pinned symbols are stored in browser `localStorage` for V1, so they stay local to your browser and are not committed to GitHub.

## Signal review journal

The CEX radar keeps a local review journal at `data/cex-signal-journal.json`.

The journal records high-attention, high-risk, long-watch, short-watch, and pinned observed tokens. It reviews outcomes after 1 day and 3 days when a later scan has a current price.

This data is local-only and ignored by Git.

## VPS background monitor

The server can run the CEX radar as a background monitor without keeping the browser open. Enable it with local `.env` values:

```bash
PORT=5187
CEX_BACKGROUND_MONITOR_ENABLED=true
CEX_BACKGROUND_MONITOR_INTERVAL_MINUTES=5
CEX_BACKGROUND_MONITOR_DEEP_LIMIT=20
CEX_ALERT_COOLDOWN_MINUTES=60
CEX_PAPER_TRADING_ENABLED=true
CEX_PAPER_KLINES_PROVIDER=binance
CEX_PAPER_STATE_FILE=
TELEGRAM_BOT_TOKEN=replace-with-bot-token
TELEGRAM_CHAT_ID=replace-with-chat-id
NO_PROXY=localhost,127.0.0.1
```

If the VPS cannot access Binance Futures directly, also set:

```bash
HTTPS_PROXY=http://proxy-host:proxy-port
HTTP_PROXY=http://proxy-host:proxy-port
```

Run on a VPS with:

```bash
npm start
```

For 24-hour operation, run the server under `pm2` or `systemd` so it restarts after crashes or VPS reboots.

When `CEX_PAPER_TRADING_ENABLED=true`, the background monitor also runs paper futures accounts with `1000 USDT` total starting equity per experiment group. The default `baseline` group uses conservative take profit, so `+8% ~ +18%` takes profit at `+8%`; the `optimistic` comparison group uses the optimistic end, so `+8% ~ +18%` takes profit at `+18%`. Both groups use isolated margin plus a `6%` trailing stop loss. Positions are sized from account risk, leverage is capped at `5x`, and futures candles are checked to see whether take profit or the trailing stop was hit first. If a live signal flips direction, the paper position exits with `signal-reversal`; if risk turns into avoid or exceeds the risk gate, it exits with `signal-risk-off`. `CEX_PAPER_KLINES_PROVIDER=binance` keeps the default Binance Futures candle source; use `aster` to test Aster public perpetuals candles. This is still simulation-only and does not place live orders. A future live adapter must keep isolated margin and must reject any order that lacks a trailing stop.

The paper monitor sends a daily Telegram summary after `22:00` Beijing time and a weekly summary after `22:00` Beijing time every Sunday. It stores summary markers in `data/cex-paper-state.json` by default so restarts do not resend the same report. If paper equity falls below `500 USDT`, it sends a capital-stop review and switches future entries to `defensive-v1`, which lowers risk, leverage, concurrent positions, and entry-risk tolerance.

If the CEX radar shows `Binance futures ticker scan failed`, the local network is probably blocking `https://fapi.binance.com`. Start your local proxy and set these private `.env` values:

```bash
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1
```

Restart `npm start` after changing `.env`.

## Private data

This repository intentionally excludes local secrets, wallet data, portfolio snapshots, runtime logs, and screenshot archives.

Use `.env.example` as the template for local API keys and create a private `.env` file locally.
