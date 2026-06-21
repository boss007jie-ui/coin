# CEX Signal Review And Journal Design

## Purpose

Add a TradingAgents-inspired signal review layer and local review journal to the existing CEX altcoin radar. The goal is to make each LAB/RAVE/BEAT-like alert easier to understand and to measure whether the signal framework works after 1 day and 3 days.

This version does not use LLMs and does not trade. It turns existing structured market signals into clearer bull, bear, and risk explanations, then records outcomes for later review.

## Confirmed Direction

- Use TradingAgents as a conceptual model, not as a dependency.
- Do not add Python or LangGraph.
- Do not call an LLM in this version.
- Keep the backend rule-driven and testable.
- Add 1-day and 3-day outcome review.
- Store journal data locally.

## Current Baseline

The radar already computes:

- `attentionScore`
- `riskScore`
- `phase`
- `shortTermBias`
- `expectedMovePctRange`
- `expectationConfidence`
- `expectationReasons`
- `actionBias`
- `actionSetup`
- `invalidLevel`
- `actionReasons`

The new layer should build on those fields instead of replacing them.

## Signal Review Layer

Each token gets a deterministic review object:

```json
{
  "bullCase": [],
  "bearCase": [],
  "riskGate": [],
  "decisionSummary": "",
  "decisionConfidence": "high | medium | low",
  "reviewLabel": "continuation | fade-risk | wait-confirmation | avoid"
}
```

### Bull Case

`bullCase` lists reasons that support upside continuation or long-side observation.

Examples:

- No ordinary Binance Spot pair while futures volume is expanding.
- External/index anchors are synchronized.
- Futures-to-anchor volume ratio is high.
- Price is close to the 24h high without severe risk flags.
- Funding is normal while attention is high.

### Bear Case

`bearCase` lists reasons that support downside risk or short-side observation.

Examples:

- Deep pullback from the 24h high.
- ADL is high.
- Funding is abnormal.
- Mark/index premium is stretched.
- Anchor dispersion is rising.
- Same-symbol anchor risk exists.

### Risk Gate

`riskGate` lists reasons to avoid chasing or to downgrade confidence.

Examples:

- Same-symbol or unvalidated anchor risk.
- Missing valid external anchor.
- High attention and high risk appear together.
- Data source gaps reduce confidence.
- Current action is `avoid` or `watch-only`.

### Decision Summary

`decisionSummary` is a concise Chinese sentence generated from deterministic rules. It should be useful in the UI without needing an LLM.

Examples:

- `高关注且外部锚同步，风险未失控，适合观察延续。`
- `合约拥挤后冲高回落，短线更偏风险释放，适合观察做空或等待反弹失败。`
- `锚价无法验证，当前信号不适合交易观察。`

### Decision Confidence

`decisionConfidence` should usually mirror existing `expectationConfidence`, but can be downgraded when:

- `riskGate` has severe entries.
- Data source errors affect the token.
- Same-symbol risk or unvalidated anchor exists.

## Local Signal Journal

Create a local journal file:

`data/cex-signal-journal.json`

This file is private local data and must remain ignored by Git.

Each journal entry records a token state when it qualifies for review:

```json
{
  "id": "LABUSDT-2026-06-21T08:00:00.000Z",
  "symbol": "LABUSDT",
  "observedAt": "2026-06-21T08:00:00.000Z",
  "entryPrice": 1.23,
  "actionBias": "watch-long",
  "shortTermBias": "bullish",
  "expectedMovePctRange": {
    "lower": 8,
    "upper": 18,
    "label": "+8% ~ +18%"
  },
  "attentionScore": 82,
  "riskScore": 42,
  "phase": "acceleration",
  "reviewLabel": "continuation",
  "bullCase": [],
  "bearCase": [],
  "riskGate": [],
  "decisionSummary": "",
  "review1d": null,
  "review3d": null
}
```

## Journal Capture Rules

Record a journal entry when:

- `attentionScore >= 70`, or
- `riskScore >= 60`, or
- `actionBias` is `watch-long` or `watch-short`, or
- the symbol is pinned in the user's observation pool and present in the scan.

Avoid duplicate spam:

- At most one open journal entry per symbol per 12 hours.
- If a symbol is already journaled within 12 hours, update its latest snapshot metadata but do not create a new entry.

## Review Windows

The system reviews outcomes at:

- `review1d`: first scan at least 24 hours after `observedAt`.
- `review3d`: first scan at least 72 hours after `observedAt`.

Each review stores:

```json
{
  "reviewedAt": "2026-06-22T08:30:00.000Z",
  "price": 1.35,
  "movePct": 9.76,
  "directionHit": true,
  "rangeHit": true,
  "outcomeLabel": "hit | partial | miss | unclear"
}
```

### Direction Hit

- `bullish` or `watch-long`: hit when `movePct > 0`.
- `bearish` or `watch-short`: hit when `movePct < 0`.
- `volatile-unclear`, `watch-only`, or `avoid`: direction is `unclear`.

### Range Hit

For bullish ranges, hit when `movePct` is between `lower` and `upper`.

For bearish ranges, hit when `movePct` is between `lower` and `upper`.

For unclear ranges, range hit is true only if absolute move stays inside the expected band.

### Outcome Label

- `hit`: direction and range both hit.
- `partial`: direction hit but range missed.
- `miss`: direction missed.
- `unclear`: original decision was not directional or price data is missing.

## Backend API

Add endpoints:

- `GET /api/radar/cex-journal`
  - Returns recent journal entries, sorted newest first.
- `POST /api/radar/cex-journal/capture`
  - Captures qualifying tokens from the latest scan payload.
  - Accepts optional `{ "pinnedSymbols": ["LABUSDT"] }` because pinned symbols are stored in browser localStorage in V1.
- `POST /api/radar/cex-journal/review`
  - Reviews entries whose 1d or 3d window is due, using latest token prices from a fresh scan when available.

The frontend calls capture automatically after a successful scan so the page does not require a separate user action.

## Frontend Changes

The CEX radar detail panel adds:

- `信号辩论`
  - 牛方
  - 熊方
  - 风控
- `决策摘要`
  - Deterministic summary sentence.
- `历史复盘`
  - Recent journal entries for the selected symbol.
  - 1d and 3d review result when available.

The main page can show a compact journal count in the overview strip if the data is available.

## Error Handling

- If the journal file is missing, treat it as an empty journal.
- If the journal file is malformed, return a clear local data error and do not overwrite it.
- If current price is unavailable during review, leave the review window pending.
- If a scan fails because of a Binance data source issue, do not create new entries and do not mark reviews as failed.

## Testing

Backend tests should cover:

- Bull, bear, and risk case generation for deterministic token fixtures.
- Decision summary and confidence output.
- Journal creation from qualifying tokens.
- Duplicate suppression within 12 hours.
- 1d and 3d review calculations.
- Missing price and failed scan behavior.
- Malformed journal file behavior.

Frontend verification should cover:

- Signal debate renders in the detail panel.
- Journal entries render for the selected symbol.
- Empty journal state is stable.
- Malformed journal API error is visible but does not blank the page.

## Out Of Scope

- LLM-generated reports.
- Automatic trading.
- Position sizing.
- Cloud database or sync.
- Cross-device journal merge.
- Long historical backtesting beyond entries created by this local tool.

## Success Criteria

The user can open a radar token and answer:

- What is the bull case?
- What is the bear case?
- What blocks or downgrades the trade idea?
- What did the system decide last time this token appeared?
- Did the 1-day or 3-day outcome validate the signal?
