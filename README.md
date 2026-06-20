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

Run tests:

```bash
npm test
```

## Private data

This repository intentionally excludes local secrets, wallet data, portfolio snapshots, runtime logs, and screenshot archives.

Use `.env.example` as the template for local API keys and create a private `.env` file locally.
