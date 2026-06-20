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

## Private data

This repository intentionally excludes local secrets, wallet data, portfolio snapshots, runtime logs, and screenshot archives.

Use `.env.example` as the template for local API keys and create a private `.env` file locally.
