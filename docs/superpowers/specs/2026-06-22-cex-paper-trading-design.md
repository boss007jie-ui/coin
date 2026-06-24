# CEX Paper Trading Design

## Context

The CEX radar currently produces directional observations (`watch-long`, `watch-short`, `watch-only`, `avoid`), expected move ranges, journal entries, 1D/3D outcome reviews, Telegram alerts, and daily prediction feedback digests.

The next step is a paper-trading layer that treats these signals like trade candidates. It must be designed for future automated futures trading while remaining simulation-only by default.

The user may later connect an exchange API such as Aster. Aster's public documentation currently describes a Binance Futures-style Perpetuals REST API with base URL `https://fapi.asterdex.com`, signed HMAC SHA256 trade endpoints, `GET /fapi/v1/klines` for candlestick data, `POST /fapi/v1/order` for order placement, and conditional order fields such as `stopPrice`, `STOP_MARKET`, and `TAKE_PROFIT_MARKET`. The simulation data model should map cleanly to that shape, but no real order placement is in scope for this phase.

## Goals

- Start a paper account with exactly `1000 USDT` total capital.
- Open simulated futures positions from radar signals, not fixed-size bets.
- Allocate capital by risk budget, not by "1000 USDT per trade".
- Use dynamic leverage per symbol, capped at `5x`.
- Require every simulated position to have a stop loss.
- Evaluate exits using the full holding-period candle path, not only the final price.
- Use conservative ambiguity handling: when one candle touches both TP and SL, record SL first.
- Report paper-trading events and daily summaries to Telegram.
- Keep the structure ready for future Aster or other futures exchange adapters, while staying paper-only.

## Non-Goals

- No live trading.
- No exchange API keys for trading.
- No automatic real order placement.
- No strategy optimizer or multi-strategy grid yet.
- No UI-heavy trading terminal in the first pass.

## Paper Account Rules

- Initial equity: `1000 USDT`.
- Maximum concurrent positions: `5`.
- Maximum total margin usage: `50%` of current equity.
- Default risk per trade: `1.5%` of current equity.
- Risk per trade range:
  - Strong low-risk signal: up to `2%`.
  - Normal signal: `1.5%`.
  - Higher-risk signal still eligible for paper trading: `1%`.
- A position is skipped when:
  - action is not `watch-long` or `watch-short`;
  - entry price is invalid;
  - stop loss or take profit cannot be computed;
  - expected reward/risk is too weak;
  - risk score is above the no-trade threshold;
  - account margin cap or max positions would be exceeded;
  - the same symbol already has an open paper position.

## Leverage Selection

Leverage is chosen by the simulator, capped at `5x`:

- `5x`: high-confidence directional signal, risk controlled, reward/risk acceptable.
- `3x`: normal strong signal.
- `1x-2x`: higher volatility or higher risk but still eligible.
- No trade: risk too high, same-symbol validation risk, low confidence, or poor reward/risk.

Leverage affects margin usage and PnL, but the stop loss is still computed from price movement. This keeps the "must have stop loss" rule explicit and portable to real futures trading.

## Position Sizing

Position sizing uses risk budget:

```text
risk_budget_usdt = equity * risk_pct
notional_usdt = risk_budget_usdt / stop_loss_pct
margin_usdt = notional_usdt / leverage
```

Example:

```text
equity = 1000 USDT
risk_pct = 1.5%
risk_budget = 15 USDT
stop_loss_pct = 6%
leverage = 3x
notional = 15 / 0.06 = 250 USDT
margin = 250 / 3 = 83.33 USDT
```

If margin cap or max concurrent positions are exceeded, the trade is skipped.

## Entry, Stop Loss, and Take Profit

- Entry price: signal `lastPrice` at paper trade creation.
- Long entry: `watch-long`.
- Short entry: `watch-short`.
- Take profit:
  - Use the expected move range boundary nearest to entry as the first TP.
  - Example long `+8% ~ +18%` uses `+8%`.
  - Example short `-25% ~ -10%` uses `-10%` as the first TP.
- Stop loss:
  - Default price stop: `6%`.
  - It may widen or narrow based on volatility, but must stay compatible with risk budget sizing.
- Reward/risk gate:
  - Default minimum expected reward/risk: `1.2`.
  - If expected TP distance is too small compared with SL distance, skip.

## Candle-Based Exit Simulation

The simulator must fetch or receive candle data covering the position holding period.

Default evaluation:

- Candle interval: `5m` for up to 72h simulations.
- Holding windows: 24h and 72h.
- For each candle after entry:
  - Long:
    - TP touched if candle high >= takeProfitPrice.
    - SL touched if candle low <= stopLossPrice.
  - Short:
    - TP touched if candle low <= takeProfitPrice.
    - SL touched if candle high >= stopLossPrice.
- Conservative ambiguity:
  - If a single candle touches both TP and SL, record `stop-loss` as the exit.
- If neither TP nor SL is touched by the review window, record an open-window mark result using the last available close.

The result must include:

- exit type: `take-profit`, `stop-loss`, `time-expired`, or `open`;
- exit time;
- exit price;
- raw move percentage;
- leveraged PnL USDT;
- account equity after closed exits;
- whether the exit was ambiguous/conservative.

## Data Storage

Create a local paper trading ledger at:

```text
data/cex-paper-trades.json
```

The file is local runtime data and ignored by Git.

Each paper trade stores:

- id;
- source journal entry id or signal timestamp;
- symbol;
- side: `long` or `short`;
- status: `open`, `closed`, `skipped`;
- skippedReason when applicable;
- entryAt, entryPrice;
- leverage;
- marginUsdt;
- notionalUsdt;
- riskBudgetUsdt;
- riskPct;
- stopLossPct, stopLossPrice;
- takeProfitPct, takeProfitPrice;
- expectedMovePctRange;
- attentionScore, riskScore, phase, decisionConfidence;
- exitAt, exitPrice, exitReason, pnlUsdt, pnlPct, equityAfter when closed;
- simulationReview24h and simulationReview72h where needed;
- createdAt, updatedAt;
- telegram notification timestamps.

## Integration Points

Background monitor flow:

1. Scan CEX radar.
2. Upsert signal journal.
3. Review signal journal.
4. Create eligible paper trades from new or updated signals.
5. Fetch klines for open paper trades.
6. Evaluate TP/SL/time outcomes.
7. Save paper ledger.
8. Send Telegram open/close/daily paper trading summaries.

Server API additions:

- `GET /api/radar/paper-trades`
- `POST /api/radar/paper-trades/review`
- Optional later: `POST /api/radar/paper-trades/reset`

V1 can be backend-first with Telegram summaries. UI can show paper trades later.

## Telegram Reporting

Immediate event alerts:

- Paper trade opened.
- Paper trade closed by TP or SL.

Daily digest:

- equity;
- realized PnL;
- open positions;
- closed positions;
- win rate;
- TP count;
- SL count;
- time-expired count;
- max drawdown if available;
- top wins and worst losses.

## Future Aster Adapter Shape

The paper trade model maps to an exchange order intent:

- set leverage first;
- place entry order;
- place mandatory stop-loss conditional order;
- optionally place take-profit conditional order;
- use client order IDs tied to paper/live trade IDs;
- subscribe to user/order updates for reconciliation.

Live trading must remain disabled unless a dedicated setting explicitly enables it. Even then, a live adapter must reject any trade without a stop loss.

## Testing Requirements

- Position sizing from 1000 USDT total equity.
- Dynamic leverage never exceeds 5x.
- Margin cap prevents over-allocation.
- Same-symbol open trade prevents duplicate entries.
- Long TP/SL simulation from candle high/low.
- Short TP/SL simulation from candle high/low.
- Same-candle TP+SL uses conservative SL result.
- Time-expired result uses last close.
- Ledger save/load handles missing and malformed files.
- Background monitor integrates paper trade creation without breaking existing signal alerts.
- Telegram failures do not crash simulation.
