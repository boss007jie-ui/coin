const test = require("node:test");
const assert = require("node:assert/strict");

const {
  fetchTextViaCurlProxy,
  resolveProxyUrl
} = require("../lib/http-proxy-fetch");

test("resolveProxyUrl chooses HTTPS proxy and honors no_proxy", () => {
  assert.equal(
    resolveProxyUrl("https://fapi.binance.com/fapi/v1/ticker/24hr", {
      HTTPS_PROXY: "http://127.0.0.1:7890"
    }),
    "http://127.0.0.1:7890"
  );

  assert.equal(
    resolveProxyUrl("https://fapi.binance.com/fapi/v1/ticker/24hr", {
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: "localhost,.binance.com"
    }),
    null
  );
});

test("fetchTextViaCurlProxy passes proxy and headers to curl", async () => {
  let observedCommand = null;
  let observedArgs = null;
  const execFileImpl = (command, args, options, callback) => {
    observedCommand = command;
    observedArgs = args;
    callback(null, "{\"ok\":true}", "");
  };

  const text = await fetchTextViaCurlProxy(
    "https://fapi.binance.com/fapi/v1/ticker/24hr",
    20_000,
    { "User-Agent": "AssetPortfolioHub" },
    "http://127.0.0.1:7890",
    execFileImpl
  );

  assert.equal(text, "{\"ok\":true}");
  assert.equal(observedCommand, "curl");
  assert.ok(observedArgs.includes("-sSL"));
  assert.ok(observedArgs.includes("--proxy"));
  assert.ok(observedArgs.includes("http://127.0.0.1:7890"));
  assert.ok(observedArgs.includes("User-Agent: AssetPortfolioHub"));
  assert.equal(observedArgs.at(-1), "https://fapi.binance.com/fapi/v1/ticker/24hr");
});
