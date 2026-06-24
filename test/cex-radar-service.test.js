const test = require("node:test");
const assert = require("node:assert/strict");

const { createCexRadarScanner } = require("../lib/cex-radar-service");

test("scanner filters no-spot futures and deep-inspects top candidates", async () => {
  const calls = [];
  const spotMap = new Map([["BTCUSDT", {}]]);
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("/fapi/v1/ticker/24hr")) {
      return [
        {
          symbol: "LABUSDT",
          lastPrice: "16.884",
          priceChangePercent: "21.67",
          highPrice: "18.787",
          lowPrice: "13.331",
          quoteVolume: "376176179"
        },
        {
          symbol: "BTCUSDT",
          lastPrice: "65000",
          priceChangePercent: "1",
          highPrice: "66000",
          lowPrice: "64000",
          quoteVolume: "2200000000"
        }
      ];
    }
    if (url.includes("/fapi/v1/constituents") && url.includes("symbol=LABUSDT")) {
      return {
        symbol: "LABUSDT",
        constituents: [
          { exchange: "gateio", symbol: "LABUSDT", price: "16.851", weight: "0.3333" },
          { exchange: "binance_future", symbol: "LABUSDT", price: "16.854", weight: "0.2222" },
          { exchange: "binance_alpha", symbol: "LABUSDT", price: "16.8624", weight: "0.3333" }
        ]
      };
    }
    if (url.includes("/fapi/v1/premiumIndex") && url.includes("symbol=LABUSDT")) {
      return {
        symbol: "LABUSDT",
        markPrice: "16.79100386",
        indexPrice: "16.79021659",
        lastFundingRate: "0.00005000"
      };
    }
    if (url.includes("/fapi/v1/openInterest") && url.includes("symbol=LABUSDT")) {
      return { symbol: "LABUSDT", openInterest: "987654" };
    }
    if (url.includes("/fapi/v1/symbolAdlRisk") && url.includes("symbol=LABUSDT")) {
      return { symbol: "LABUSDT", adlRisk: "high", updateTime: 1597370495002 };
    }
    if (url.includes("api.gateio.ws") && url.includes("LAB_USDT")) {
      return [{ currency_pair: "LAB_USDT", last: "16.623", quote_volume: "24135033.78" }];
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const scanner = createCexRadarScanner({
    fetchJson,
    getSpotTickerMap: async () => spotMap,
    now: () => new Date("2026-06-19T04:00:00.000Z")
  });

  const first = await scanner.scan({ force: true, deepInspectLimit: 10 });
  const callCountAfterFirst = calls.length;
  const second = await scanner.scan({ deepInspectLimit: 10 });

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls.length, callCountAfterFirst);
  assert.equal(first.summary.scannedFutures, 2);
  assert.equal(first.summary.withoutBinanceSpot, 1);
  assert.equal(first.summary.deepInspected, 1);
  assert.equal(first.tokens.length, 1);
  assert.equal(first.tokens[0].symbol, "LABUSDT");
  assert.equal(first.tokens[0].adlRisk, "HIGH");
  assert.ok(first.tokens[0].futuresToAnchorVolumeRatio > 15);
  assert.ok(first.tokens[0].attentionScore >= 70);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(second.errors, []);
  const deepInspectionCalls = calls.filter(
    (url) =>
      url.includes("/fapi/v1/constituents") ||
      url.includes("/fapi/v1/premiumIndex") ||
      url.includes("/fapi/v1/openInterest") ||
      url.includes("/fapi/v1/symbolAdlRisk") ||
      url.includes("api.gateio.ws")
  );
  assert.ok(deepInspectionCalls.every((url) => !url.includes("symbol=BTCUSDT")));
  assert.ok(calls.some((url) => url.includes("/fapi/v1/constituents?symbol=LABUSDT")));
  assert.ok(calls.some((url) => url.includes("/fapi/v1/premiumIndex?symbol=LABUSDT")));
  assert.ok(calls.some((url) => url.includes("/fapi/v1/openInterest?symbol=LABUSDT")));
  assert.ok(calls.some((url) => url.includes("/fapi/v1/symbolAdlRisk?symbol=LABUSDT")));
  assert.ok(calls.some((url) => url.includes("api.gateio.ws") && url.includes("LAB_USDT")));
});

test("cached scan payloads cannot be mutated by callers", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("/fapi/v1/ticker/24hr")) {
      return [{
        symbol: "LABUSDT",
        lastPrice: "16.884",
        priceChangePercent: "21.67",
        highPrice: "18.787",
        lowPrice: "13.331",
        quoteVolume: "376176179"
      }];
    }
    if (url.includes("/fapi/v1/constituents")) {
      return {
        constituents: [
          { exchange: "gateio", symbol: "LAB_USDT", price: "16.851", weight: "0.3333" },
          { exchange: "binance_future", symbol: "LABUSDT", price: "16.854", weight: "0.2222" }
        ]
      };
    }
    if (url.includes("/fapi/v1/premiumIndex")) {
      return { markPrice: "16.79100386", indexPrice: "16.79021659", lastFundingRate: "0.00005000" };
    }
    if (url.includes("/fapi/v1/openInterest")) {
      return { openInterest: "987654" };
    }
    if (url.includes("/fapi/v1/symbolAdlRisk")) {
      return { symbol: "LABUSDT", adlRisk: "high" };
    }
    if (url.includes("api.gateio.ws") && url.includes("LAB_USDT")) {
      return [{ currency_pair: "LAB_USDT", quote_volume: "24135033.78" }];
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const scanner = createCexRadarScanner({
    fetchJson,
    getSpotTickerMap: async () => new Map(),
    now: () => new Date("2026-06-19T04:00:00.000Z")
  });

  const first = await scanner.scan({ deepInspectLimit: 10 });
  const callCountAfterFirst = calls.length;

  first.tokens[0].symbol = "MUTATEDUSDT";
  first.errors.push("caller mutation");
  first.summary.scannedFutures = 999;

  const second = await scanner.scan({ deepInspectLimit: 10 });

  assert.equal(calls.length, callCountAfterFirst);
  assert.equal(second.cached, true);
  assert.equal(second.tokens[0].symbol, "LABUSDT");
  assert.deepEqual(second.errors, []);
  assert.equal(second.summary.scannedFutures, 1);
});

test("cache is keyed by sanitized deep inspection limit", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("/fapi/v1/ticker/24hr")) {
      return [
        {
          symbol: "AAAUSDT",
          lastPrice: "2",
          priceChangePercent: "30",
          highPrice: "2.2",
          lowPrice: "1.5",
          quoteVolume: "300000000"
        },
        {
          symbol: "BBBUSDT",
          lastPrice: "1",
          priceChangePercent: "20",
          highPrice: "1.1",
          lowPrice: "0.8",
          quoteVolume: "200000000"
        }
      ];
    }
    if (url.includes("/fapi/v1/constituents")) {
      const symbol = new URL(url).searchParams.get("symbol");
      return {
        constituents: [
          { exchange: "gateio", symbol: `${symbol.slice(0, -4)}_USDT`, price: "1", weight: "0.5" },
          { exchange: "binance_future", symbol, price: "1", weight: "0.5" }
        ]
      };
    }
    if (url.includes("/fapi/v1/premiumIndex")) {
      return { markPrice: "1", indexPrice: "1", lastFundingRate: "0.00001" };
    }
    if (url.includes("/fapi/v1/openInterest")) {
      return { openInterest: "1000" };
    }
    if (url.includes("/fapi/v1/symbolAdlRisk")) {
      return { adlRisk: "middle" };
    }
    if (url.includes("api.gateio.ws")) {
      return [{ quote_volume: "1000000" }];
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const scanner = createCexRadarScanner({
    fetchJson,
    getSpotTickerMap: async () => new Map(),
    now: () => new Date("2026-06-19T04:00:00.000Z")
  });

  const negative = await scanner.scan({ deepInspectLimit: -1 });
  assert.equal(negative.summary.deepInspected, 0);
  assert.equal(calls.filter((url) => url.includes("/fapi/v1/constituents")).length, 0);

  const decimal = await scanner.scan({ deepInspectLimit: 1.9 });
  assert.equal(decimal.summary.deepInspected, 1);
  assert.equal(calls.filter((url) => url.includes("/fapi/v1/constituents")).length, 1);

  const two = await scanner.scan({ deepInspectLimit: 2 });
  assert.equal(two.summary.deepInspected, 2);
  assert.equal(calls.filter((url) => url.includes("/fapi/v1/constituents")).length, 3);

  const callCountAfterTwo = calls.length;
  const cachedTwo = await scanner.scan({ deepInspectLimit: 2 });
  assert.equal(cachedTwo.cached, true);
  assert.equal(cachedTwo.summary.deepInspected, 2);
  assert.equal(calls.length, callCountAfterTwo);
});

test("unvalidated anchors surface same-symbol risk without Gate volume lookup", async () => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes("/fapi/v1/ticker/24hr")) {
      return [{
        symbol: "LABUSDT",
        lastPrice: "not-a-price",
        priceChangePercent: "21.67",
        highPrice: "18.787",
        lowPrice: "13.331",
        quoteVolume: "376176179"
      }];
    }
    if (url.includes("/fapi/v1/constituents")) {
      return {
        constituents: [
          { exchange: "gateio", symbol: "LAB_USDT", price: "16.851", weight: "0.3333" }
        ]
      };
    }
    if (url.includes("/fapi/v1/premiumIndex")) {
      return { markPrice: "invalid", indexPrice: "", lastFundingRate: "0.00005000" };
    }
    if (url.includes("/fapi/v1/openInterest")) {
      return { openInterest: "987654" };
    }
    if (url.includes("/fapi/v1/symbolAdlRisk")) {
      return { symbol: "LABUSDT", adlRisk: "high" };
    }
    if (url.includes("api.gateio.ws")) {
      throw new Error(`Gate volume should not be called for unvalidated anchors: ${url}`);
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const scanner = createCexRadarScanner({
    fetchJson,
    getSpotTickerMap: async () => new Map(),
    now: () => new Date("2026-06-19T04:00:00.000Z")
  });

  const result = await scanner.scan({ force: true, deepInspectLimit: 1 });
  const token = result.tokens[0];

  assert.ok(token.phase === "same-symbol-risk" || token.tags.includes("同名币风险"));
  assert.ok(token.warnings.some((warning) => warning.includes("无法验证")));
  assert.ok(!calls.some((url) => url.includes("api.gateio.ws")));
});

test("broad futures scan failure surfaces source-specific upstream error", async () => {
  const scanner = createCexRadarScanner({
    fetchJson: async () => {
      throw new Error("connect timeout");
    },
    getSpotTickerMap: async () => new Map(),
    now: () => new Date("2026-06-19T04:00:00.000Z")
  });

  await assert.rejects(
    scanner.scan({ force: true }),
    (error) => {
      assert.equal(error.message, "Binance futures ticker scan failed");
      assert.equal(error.statusCode, 502);
      assert.equal(error.details.source, "binance-futures");
      assert.equal(error.details.endpoint, "/fapi/v1/ticker/24hr");
      assert.equal(error.details.cause, "connect timeout");
      return true;
    }
  );
});

test("non-array futures scan response surfaces upstream response message", async () => {
  const scanner = createCexRadarScanner({
    fetchJson: async () => ({
      code: 0,
      msg: "Service unavailable from a restricted location"
    }),
    getSpotTickerMap: async () => new Map(),
    now: () => new Date("2026-06-19T04:00:00.000Z")
  });

  await assert.rejects(
    scanner.scan({ force: true }),
    (error) => {
      assert.equal(error.message, "Binance futures ticker scan failed");
      assert.equal(error.statusCode, 502);
      assert.equal(error.details.source, "binance-futures");
      assert.equal(error.details.endpoint, "/fapi/v1/ticker/24hr");
      assert.match(error.details.cause, /restricted location/);
      return true;
    }
  );
});
