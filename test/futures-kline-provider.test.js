const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createFuturesKlineFetcher,
  resolveFuturesKlineProvider
} = require("../lib/futures-kline-provider");

test("default futures kline provider uses Binance-compatible kline rows", async () => {
  const calls = [];
  const fetchKlines = createFuturesKlineFetcher({
    fetchJson: async (url, timeoutMs, options) => {
      calls.push({ url, timeoutMs, options });
      return [
        [1760000000000, "1", "1.25", "0.95", "1.10"],
        ["bad"]
      ];
    }
  });

  const rows = await fetchKlines("labusdt", {
    interval: "5m",
    limit: 150,
    startTime: 1760000000000,
    endTime: 1760000300000
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?/);
  assert.match(calls[0].url, /symbol=LABUSDT/);
  assert.match(calls[0].url, /interval=5m/);
  assert.match(calls[0].url, /limit=150/);
  assert.equal(calls[0].timeoutMs, 15_000);
  assert.equal(calls[0].options.headers["User-Agent"], "Mozilla/5.0 AssetPortfolioHub/0.1");
  assert.deepEqual(rows, [
    {
      openTime: 1760000000000,
      high: 1.25,
      low: 0.95,
      close: 1.1
    }
  ]);
});

test("aster futures kline provider uses Aster perpetuals base URL", async () => {
  const calls = [];
  const fetchKlines = createFuturesKlineFetcher({
    provider: "aster",
    fetchJson: async (url) => {
      calls.push(url);
      return [[1760000000000, "1", "2", "0.5", "1.5"]];
    }
  });

  const rows = await fetchKlines("RAVEUSDT");

  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/fapi\.asterdex\.com\/fapi\/v1\/klines\?/);
  assert.match(calls[0], /symbol=RAVEUSDT/);
  assert.deepEqual(rows, [
    {
      openTime: 1760000000000,
      high: 2,
      low: 0.5,
      close: 1.5
    }
  ]);
});

test("unsupported futures kline provider fails explicitly", () => {
  assert.throws(
    () => resolveFuturesKlineProvider("unknown"),
    /Unsupported futures kline provider/
  );
});
