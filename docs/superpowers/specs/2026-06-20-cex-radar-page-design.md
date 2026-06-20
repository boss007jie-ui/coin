# CEX Altcoin Radar Page Design

## Purpose

Build a dedicated CEX altcoin radar page for LAB/RAVE/BEAT-like coins. The page turns the existing backend scan into a daily watch workflow: find abnormal coins, explain why they matter, estimate short-term movement, and suggest whether the setup is worth watching for long or short action.

This is not an auto-trading system. V1 provides structured monitoring and decision support.

## Confirmed Direction

The user approved:

- A dedicated page rather than embedding the feature inside the asset dashboard.
- A watch-decision first workflow.
- Short-term price movement expectation.
- Long/short observation action.
- An observation pool that supports automatic discovery and manual pinning.

## Page Entry

Add a new page:

`/cex-radar.html`

The existing asset dashboard keeps its current purpose. Its top navigation adds a small entry button or link to open the CEX radar page. The radar page also includes a return link to the asset dashboard.

## First Screen

The first screen is a working dashboard, not a landing page.

Top controls:

- Page title: `CEX 山寨币雷达`
- Last updated time.
- Refresh button.
- Deep inspection limit control: `10 / 20 / 50`, default `20`.

Overview strip:

- Candidate count.
- High attention count.
- High risk count.
- Data source issue count.
- Pinned watchlist count.

Main work area:

- Left/main area: token table.
- Right/detail area on desktop, stacked detail area on mobile.
- Tabs: `自动发现` and `我的观察池`.

## Token Table

Default sort: `attentionScore` descending.

Visible columns:

- Symbol.
- 24h change.
- 24h futures quote volume.
- Attention score.
- Risk score.
- Short-term expectation.
- Expected move range.
- Action bias.
- Phase.
- Core tags.

Sort options:

- Attention score.
- Risk score.
- 24h change.
- Futures quote volume.

Filters:

- All.
- High attention.
- High risk.
- Same-symbol risk.
- Data source issue.
- Pinned only.

## Detail Panel

Selecting a token shows:

- Why it is abnormal.
- `attentionScore` and `riskScore` explanations.
- `shortTermBias`, expected move range, confidence, and reasons.
- `actionBias`, setup type, invalidation condition, and reasons.
- Index constituents.
- Mark/index premium.
- Funding rate.
- Open interest.
- ADL risk.
- Anchor dispersion.
- Futures-to-anchor volume ratio when available.
- Warnings, including same-symbol risk and unvalidated anchor risk.

## Short-Term Expectation

Add backend-computed fields to each token:

```json
{
  "shortTermBias": "bullish | bearish | volatile-unclear",
  "expectedMovePctRange": {
    "lower": 8,
    "upper": 18,
    "label": "+8% ~ +18%"
  },
  "expectationConfidence": "high | medium | low",
  "expectationReasons": []
}
```

`lower` and `upper` are signed percentage numbers. A bullish case can use `8` and `18`; a bearish case can use `-25` and `-10`; an unclear high-volatility case can use `-20` and `20`.

Interpretation rules:

- High attention with controlled risk favors `bullish`.
- High risk with pullback from high, ADL crowding, abnormal funding, or anchor deterioration favors `bearish` or `volatile-unclear`.
- Futures volume dominance with synchronized external anchors supports trend continuation.
- Futures volume dominance with anchor divergence, same-symbol risk, or unvalidated anchors downgrades confidence.
- Deep pullback from the 24h high shifts interpretation toward pullback or failed-breakout risk.

The expectation is a scenario estimate for the next 1-3 days, not a promise.

## Long/Short Observation Action

Add backend-computed fields:

```json
{
  "actionBias": "watch-long | watch-short | watch-only | avoid",
  "actionSetup": "breakout-continuation | pullback-confirmation | blowoff-fade | failed-bounce | same-symbol-avoid | insufficient-data",
  "invalidLevel": null,
  "actionReasons": []
}
```

Interpretation rules:

- `watch-long`: high attention, anchor synchronization, expanding futures volume, and no major failed-breakout signal.
- `watch-short`: high risk, pullback from high, ADL crowding, abnormal funding, anchor divergence, or failed-breakout behavior.
- `watch-only`: attention is high but risk is also high, so chasing is unsafe.
- `avoid`: same-symbol risk, unvalidated anchor, severe data gap, or contradictory signals.

UI wording should use `观察做多`, `观察做空`, `只观察不追`, and `回避`.

`invalidLevel` is a concise display string or `null`, such as `跌破 24h 低点后失效`, `重新站上 24h 高点后失效`, or `锚价无法验证，暂不设失效位`.

## Observation Pool

V1 uses two layers.

`自动发现`:

- Populated by every scan.
- Include tokens that meet V1 automatic thresholds: `attentionScore >= 60` or `riskScore >= 60`.
- The thresholds should be constants so later versions can tune them.

`我的观察池`:

- User can pin any scanned token.
- Pinned tokens remain visible even if they fall below automatic discovery thresholds.
- Store pinned symbols in browser localStorage for V1.
- Each pinned token can later support notes, but V1 only needs pin/unpin.

Manual add:

- V1 includes a simple symbol input for manual pinning.
- If the symbol is not present in the current scan, show it as pinned but data unavailable.

## Data Flow

The page calls one backend endpoint:

Default load:

`GET /api/radar/cex-scan?deepInspectLimit=20`

Manual refresh:

`GET /api/radar/cex-scan?force=true&deepInspectLimit=20`

The frontend should not calculate core scores, short-term expectation, or long/short action. Those fields belong in the backend so they can be tested.

The frontend may calculate display-only summaries, such as filtered row counts.

## Error Handling

If the endpoint succeeds with partial errors:

- Show available token rows.
- Show a data source warning in the overview strip.
- Surface top-level `errors` in a compact diagnostics section.

If the endpoint fails:

- Show an explicit failure state.
- Display source and cause when available, such as `binance-futures / fetch failed`.
- Keep the refresh button available.
- Avoid blank pages.

If no tokens match:

- Show `暂无候选`.
- Keep controls visible.

If a pinned token is not in the scan:

- Show it in the watchlist with a data unavailable state.

## Testing

Backend tests:

- Preserve existing candidate filtering and score behavior.
- Add tests for `shortTermBias`.
- Add tests for expected move ranges.
- Add tests for `expectationConfidence`.
- Add tests for `actionBias`.
- Cover bullish continuation, bearish pullback, volatile unclear, same-symbol avoid, and insufficient data.

Frontend verification:

- Normal response renders overview, table, and details.
- 502 response renders source-specific failure.
- Empty response renders a stable empty state.
- Manual pin/unpin persists through reload.
- Mobile layout keeps the table scrollable and detail panel readable.

## Out Of Scope For V1

- Automatic trading.
- Browser or system-level push notifications.
- Complex user-defined alert rule editor.
- Historical backtesting.
- Accuracy tracking for predictions.
- External proxy infrastructure for blocked data sources.

## Success Criteria

The user can open the CEX radar page and, within 10 seconds, answer:

- Which coins should I watch now?
- Which coins are high risk?
- Is the current setup more suitable for watching long, watching short, waiting, or avoiding?
- What is the expected short-term move range?
- What data or signal supports that view?
- Are any data sources failing or unreliable?
