# CEX Altcoin Radar Design

## Purpose

Build the first backend version of a CEX-focused altcoin radar that can scan the full Binance USDⓈ-M perpetual universe and surface LAB/RAVE/BEAT-like structures without requiring manual watchlists.

This radar is not a direct buy/sell engine. Its job is to identify targets worth watching and explain why they are unusual. Directional interpretation remains a second layer.

## Scope

V1 adds a backend-only endpoint:

`GET /api/radar/cex-scan`

The existing on-chain/DexScreener radar remains unchanged. The new endpoint returns JSON that can later power a dedicated altcoin radar page.

The user selected this V1 scope:

- Candidate pool: all Binance USDⓈ-M USDT perpetual contracts.
- Primary filter: futures exists, ordinary Binance Spot pair does not exist.
- First delivery: backend scanner and JSON response.
- Later UI direction: a separate altcoin radar page, not only the current asset dashboard modal.

## Core Signal

The core discovery signal is:

`Binance Futures + no ordinary Binance Spot + external/index anchor + abnormal futures volume + price movement`

This signal means "monitor this coin"; it does not by itself mean "price will rise".

Evidence from LAB/RAVE/BEAT research keeps this core signal intact but tightens interpretation:

- Futures volume is often the amplifier.
- External venues and Binance Alpha are often the price anchor.
- ADL HIGH is a leverage/volatility warning, not a standalone bearish signal.
- Same-symbol validation is mandatory because unrelated tokens can share tickers.

## Architecture

The scanner runs in two stages.

### Stage 1: Full Fast Scan

Fetch broad public Binance data and cheaply reduce the universe.

Inputs:

- Binance USDⓈ-M futures exchange info or 24h ticker list.
- Binance ordinary Spot ticker or exchange info.
- Futures 24h ticker statistics.
- Recent futures klines for shortlisted symbols when available.

Filters:

- Keep USDT perpetual symbols only.
- Exclude symbols with ordinary Binance Spot `SYMBOLUSDT`.
- Keep symbols with meaningful 24h futures quote volume.
- Prioritize large 24h moves, new highs, high intraday range, or large notional volume.

The fast scan should avoid expensive per-symbol requests for the full universe.

### Stage 2: Deep Inspection

Run deeper checks only on the top candidates from Stage 1. Default cap: 50 candidates.

Deep checks:

- Index constituents.
- Mark price and index price.
- Funding rate.
- Open interest.
- ADL risk.
- Optional recent 1h futures klines.
- Optional external anchor spot ticker when the constituent exchange has a reachable public API.

External anchor volume is best-effort. Missing external volume should reduce confidence, not fail the whole scan.

## Data Sources

Primary sources:

- Binance USDⓈ-M Futures public endpoints.
- Binance Spot public endpoints.
- Binance index constituents endpoint.
- Gate.io public spot ticker when an index constituent uses Gate.

Best-effort sources:

- MEXC public ticker.
- Bitget public ticker.
- Coinbase product/ticker endpoints.
- Aster only if a stable public source is available.

If an external API times out, blocks, or returns an incompatible symbol, the scanner records an access issue and continues.

## Output Shape

The endpoint returns:

```json
{
  "updatedAt": "2026-06-19T04:00:00.000Z",
  "cached": false,
  "summary": {
    "scannedFutures": 0,
    "withoutBinanceSpot": 0,
    "deepInspected": 0,
    "attentionCount": 0,
    "riskCount": 0
  },
  "tokens": [],
  "errors": []
}
```

Each token includes:

```json
{
  "symbol": "LABUSDT",
  "baseAsset": "LAB",
  "lastPrice": 16.88,
  "priceChange24h": 21.67,
  "high24h": 18.78,
  "low24h": 13.33,
  "quoteVolume24h": 376176179,
  "hasBinanceSpot": false,
  "indexConstituents": [],
  "anchorDispersionPct": 0.5,
  "futuresToAnchorVolumeRatio": 15.6,
  "markIndexPremiumPct": 0.01,
  "fundingRate": 0.00005,
  "openInterest": 0,
  "adlRisk": "HIGH",
  "attentionScore": 0,
  "riskScore": 0,
  "phase": "high-risk-extension",
  "tags": [],
  "warnings": [],
  "confidence": "medium"
}
```

## Scoring

V1 uses two separate scores.

### Attention Score

Measures whether the coin deserves monitoring.

Inputs:

- No Binance Spot.
- 24h futures quote volume.
- 24h price change.
- 24h high/low range.
- Price near 24h high or making new local highs.
- Index constituents include external venues and/or Binance Alpha.
- Anchor prices are synchronized.
- Futures-to-anchor spot volume ratio is high when anchor volume is available.

Suggested thresholds:

- `attentionScore >= 70`: monitor closely.
- `attentionScore >= 50`: keep on radar.
- `< 50`: low priority unless watchlisted later.

### Risk Score

Measures high-volatility or high-level failure risk.

Inputs:

- ADL HIGH.
- Large futures volume dominance.
- Pullback from 24h high.
- Mark/index premium expansion.
- Funding rate abnormality.
- Anchor dispersion.
- Long upper-wick or high range with weak close when kline data is available.

Suggested thresholds:

- `riskScore >= 70`: high-volatility/high-failure risk.
- `riskScore >= 50`: risk building.
- `< 50`: normal monitoring risk.

## Phases

V1 assigns one phase per token:

- `candidate`: structure matches but movement is not strong yet.
- `acceleration`: price and futures volume are expanding with synchronized anchors.
- `high-risk-extension`: attention is high and leverage/volume risk is elevated.
- `pullback-watch`: coin pulled back materially from recent high but anchors still sync.
- `failed-breakout-risk`: price failed near highs, risk score elevated, anchor/premium signals deteriorate.
- `same-symbol-risk`: external venue symbol appears inconsistent with Binance/index price.

The phase is explanatory. It is not a trade instruction.

## Tags

Initial tags:

- `无币安现货`
- `合约放量`
- `外部锚同步`
- `合约量主导`
- `接近新高`
- `冲高回落`
- `ADL拥挤`
- `同名币风险`
- `锚价分歧`
- `Funding正常`
- `Funding异常`

Tags should be short and UI-ready.

## Same-Symbol Validation

When a constituent or external ticker uses the same base symbol, validate it before using it as an anchor:

- Compare external price with Binance index/mark price.
- If the difference is greater than a strict threshold, mark `same-symbol-risk`.
- Suggested threshold: `> 8%` for stable quote pairs.
- Do not use mismatched external venue volume in the futures-to-anchor ratio.

RAVE is the reference case: Gate RAVE was around `0.405`, while Binance/Bitget/Coinbase RAVE was around `0.274`. That must be flagged, not averaged.

## Caching And Performance

Use separate caches:

- Broad futures/spot universe: 45-60 seconds.
- CEX scan result: 60 seconds.
- Deep inspection per symbol: 60 seconds.

The endpoint should return within a practical local dashboard window. If external anchor checks are slow, return partial results with `errors` and `confidence: "low"` for affected symbols.

## Error Handling

The scanner must be resilient:

- A failed external venue request does not fail the endpoint.
- A failed Binance broad scan should fail the endpoint with a clear error.
- Per-symbol deep inspection errors are attached to that symbol or the top-level `errors` array.
- Missing optional metrics should be represented as `null`, not fake zeros.

## Testing Strategy

Write tests before implementation.

Recommended test seams:

- Pure scoring helpers.
- Same-symbol validation helper.
- Candidate filtering helper.
- Phase classification helper.
- Response assembly with partial data.

Initial test cases:

- LAB-like structure gets high attention and elevated risk, but not an automatic bullish label.
- RAVE-like Gate mismatch receives `same-symbol-risk`.
- BEAT-like high-volume pullback receives `pullback-watch` or elevated risk.
- A normal Binance Spot+Futures symbol is filtered out.
- External API failure returns partial results instead of failing the whole scan.

## Future UI Direction

The later UI should be a dedicated altcoin radar page. It should not be forced into the current asset dashboard modal.

Future page sections:

- Market-wide candidate table.
- Phase filters.
- Attention/risk score columns.
- Anchor constituent breakdown.
- Futures/anchor volume ratio.
- Symbol detail drawer with recent klines and warnings.

V1 should keep the response shape stable enough for this page.

## Out Of Scope For V1

- Real trading or order placement.
- Private account data.
- Telegram/WeChat alerts.
- Persistent historical database.
- Full backtesting.
- Guaranteed external venue coverage.
- UI redesign.

