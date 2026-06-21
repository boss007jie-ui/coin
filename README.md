# Coin Asset Radar

Local asset dashboard and CEX altcoin radar prototype.

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
