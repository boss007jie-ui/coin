const http = require("http");
const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { createCexBackgroundMonitor } = require("./lib/cex-background-monitor");
const { createCexRadarScanner } = require("./lib/cex-radar-service");
const {
  reviewJournalEntries,
  upsertJournalEntries
} = require("./lib/cex-signal-journal");
const {
  loadCexSignalJournal,
  saveCexSignalJournal
} = require("./lib/cex-signal-journal-store");
const {
  loadCexPaperTrades,
  saveCexPaperTrades
} = require("./lib/cex-paper-trading-store");
const { fetchTextViaCurlProxy, resolveProxyUrl } = require("./lib/http-proxy-fetch");
const { createTelegramNotifier } = require("./lib/telegram-notifier");

const ROOT_DIR = __dirname;
loadLocalEnvIntoProcess(ROOT_DIR);
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const PORT = Number(process.env.PORT || 5173);
const CACHE_TTL_MS = 30000;
const BINANCE_TICKER_TTL_MS = 45000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const quoteCache = new Map();
let binanceTickerCache = null;
let onchainBalanceCache = null;
let cexBackgroundMonitor = null;
const ONCHAIN_CACHE_TTL_MS = 60000;
const WALLETS_FILE = path.join(ROOT_DIR, "data", "wallets.json");
const CEX_SIGNAL_JOURNAL_FILE = process.env.CEX_SIGNAL_JOURNAL_FILE || path.join(ROOT_DIR, "data", "cex-signal-journal.json");
const CEX_PAPER_TRADES_FILE = process.env.CEX_PAPER_TRADES_FILE || path.join(ROOT_DIR, "data", "cex-paper-trades.json");

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      return sendJson(res, { ok: true, now: new Date().toISOString() });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/fx") {
      const fx = await getFxRates();
      return sendJson(res, fx);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/binance/status") {
      const status = await getBinanceAccountStatus();
      return sendJson(res, status);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/binance/account") {
      const account = await getBinanceAccountSnapshot();
      return sendJson(res, account);
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/quotes") {
      const body = await readJson(req);
      const payload = await getQuotes(body.assets || []);
      return sendJson(res, payload);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/channels/status") {
      const status = await getChannelsStatus();
      return sendJson(res, status);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/okx/status") {
      const status = await getOkxAccountStatus();
      return sendJson(res, status);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/okx/account") {
      const account = await getOkxAccountSnapshot();
      return sendJson(res, account);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/bybit/status") {
      const status = await getBybitAccountStatus();
      return sendJson(res, status);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/bybit/account") {
      const account = await getBybitAccountSnapshot();
      return sendJson(res, account);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/wallets") {
      const wallets = await loadWallets();
      return sendJson(res, { wallets });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/wallets") {
      const body = await readJson(req);
      const wallets = await loadWallets();
      const wallet = {
        id: body.id || crypto.randomUUID(),
        label: body.label || "",
        address: body.address || "",
        chain: body.chain || "eth",
        tokens: body.tokens || [],
        updatedAt: new Date().toISOString()
      };
      const existingIndex = wallets.findIndex((w) => w.id === wallet.id);
      if (existingIndex >= 0) {
        wallets[existingIndex] = wallet;
      } else {
        wallets.push(wallet);
      }
      await saveWallets(wallets);
      return sendJson(res, { ok: true, wallet });
    }

    if (req.method === "DELETE" && requestUrl.pathname === "/api/wallets") {
      const body = await readJson(req);
      if (!body.id) {
        throw httpError("Missing wallet id", 400);
      }
      const wallets = await loadWallets();
      const filtered = wallets.filter((w) => w.id !== body.id);
      await saveWallets(filtered);
      return sendJson(res, { ok: true, deleted: body.id });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/onchain/balances") {
      const balances = await fetchOnchainBalances();
      return sendJson(res, balances);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/radar/scan") {
      const force = requestUrl.searchParams.get("force") === "true";
      const results = await fetchRadarScan(force);
      return sendJson(res, results);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/radar/cex-scan") {
      const force = requestUrl.searchParams.get("force") === "true";
      const deepInspectLimit = requestUrl.searchParams.get("deepInspectLimit");
      const results = await fetchCexRadarScan(force, deepInspectLimit);
      return sendJson(res, results);
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/radar/cex-journal") {
      const symbol = String(requestUrl.searchParams.get("symbol") || "").trim().toUpperCase();
      const entries = await loadCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE);
      const filtered = symbol ? entries.filter((entry) => String(entry.symbol || "").toUpperCase() === symbol) : entries;
      filtered.sort((a, b) => (Date.parse(b.observedAt || "") || 0) - (Date.parse(a.observedAt || "") || 0));
      return sendJson(res, { entries: filtered });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/radar/cex-journal/capture") {
      const body = await readJson(req);
      const tokens = Array.isArray(body.tokens)
        ? body.tokens
        : (await fetchCexRadarScan(false, body.deepInspectLimit)).tokens;
      const entries = await loadCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE);
      const result = upsertJournalEntries(entries, tokens, {
        now: new Date(),
        pinnedSymbols: Array.isArray(body.pinnedSymbols) ? body.pinnedSymbols : []
      });
      await saveCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE, result.entries);
      return sendJson(res, { ok: true, ...result });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/radar/cex-journal/review") {
      const body = await readJson(req);
      const tokens = Array.isArray(body.tokens)
        ? body.tokens
        : (await fetchCexRadarScan(false, body.deepInspectLimit)).tokens;
      const priceBySymbol = new Map(
        tokens
          .map((token) => [String(token.symbol || "").toUpperCase(), Number(token.lastPrice)])
          .filter(([, price]) => Number.isFinite(price))
      );
      const entries = await loadCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE);
      const result = reviewJournalEntries(entries, priceBySymbol, new Date());
      await saveCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE, result.entries);
      return sendJson(res, { ok: true, ...result });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/radar/paper-trades") {
      const trades = await loadCexPaperTrades(CEX_PAPER_TRADES_FILE);
      trades.sort((a, b) => (Date.parse(b.openedAt || b.createdAt || "") || 0) - (Date.parse(a.openedAt || a.createdAt || "") || 0));
      return sendJson(res, { trades });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/radar/cex-monitor/status") {
      return sendJson(res, { status: getCexBackgroundMonitorStatus() });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/radar/config") {
      const config = await loadRadarConfig();
      return sendJson(res, config);
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/radar/config") {
      const body = await readJson(req);
      const config = await saveRadarConfig(body);
      return sendJson(res, { ok: true, config });
    }

    return serveStatic(requestUrl.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message || "Internal server error", details: error.details || null }, error.statusCode || 500);
  }
});

server.listen(PORT, () => {
  console.log(`Asset Portfolio Hub is running at http://localhost:${PORT}`);
  startCexBackgroundMonitorFromEnv().catch((error) => {
    console.error("CEX background monitor failed to start:", error);
  });
});

async function serveStatic(urlPath, res) {
  const pathname = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const resolvedPath = path.normalize(path.join(ROOT_DIR, pathname));
  const publicPath = path.normalize(path.join(PUBLIC_DIR, pathname.replace(/^\/public\//, "")));
  const dataPath = path.normalize(path.join(ROOT_DIR, pathname));

  let filePath = publicPath;
  if (pathname.startsWith("/data/")) {
    filePath = dataPath;
  }

  if (!filePath.startsWith(PUBLIC_DIR) && !filePath.startsWith(path.join(ROOT_DIR, "data"))) {
    return sendText(res, "Not found", 404);
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    sendText(res, "Not found", 404);
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function sendText(res, text, status = 200) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function getQuotes(assets) {
  const normalizedAssets = assets
    .filter((asset) => asset && asset.id && asset.quoteSource && asset.quoteSource !== "manual")
    .map((asset) => ({
      id: asset.id,
      quoteSource: String(asset.quoteSource || "manual").toLowerCase(),
      quoteSymbol: asset.quoteSymbol || asset.symbol,
      quoteId: asset.quoteId,
      symbol: asset.symbol,
      currency: asset.currency || "USD"
    }));

  const cacheKey = JSON.stringify(normalizedAssets);
  const cached = quoteCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  const equitySymbols = [
    ...new Set(
      normalizedAssets
        .filter((asset) => asset.quoteSource === "yahoo" && asset.quoteSymbol)
        .map((asset) => asset.quoteSymbol)
    )
  ];

  const cryptoAssets = normalizedAssets.filter((asset) => ["coingecko", "binance"].includes(asset.quoteSource));

  const [fx, equityQuotes, cryptoQuotes] = await Promise.all([
    getFxRates(),
    fetchEquityQuotes(equitySymbols),
    fetchCryptoQuotes(cryptoAssets)
  ]);

  const quotes = {};
  const errors = [];

  for (const asset of normalizedAssets) {
    if (asset.quoteSource === "yahoo" && asset.quoteSymbol) {
      const quote = equityQuotes.quotes[asset.quoteSymbol];
      if (quote) {
        quotes[asset.id] = quote;
      }
      continue;
    }

    if (["coingecko", "binance"].includes(asset.quoteSource)) {
      const quote = cryptoQuotes.quotes[toCryptoQuoteKey(asset)];
      if (quote) {
        const targetCurrency = String(asset.currency || "USD").toLowerCase();
        const hasTargetPrice = Number.isFinite(quote.prices[targetCurrency]);
        quotes[asset.id] = {
          source: quote.source || "coingecko",
          price: hasTargetPrice ? quote.prices[targetCurrency] : quote.prices.usd,
          currency: hasTargetPrice ? (targetCurrency || "usd").toUpperCase() : "USD",
          changePercent: quote.changePercent,
          raw: quote.raw
        };
      }
    }
  }

  errors.push(...equityQuotes.errors, ...cryptoQuotes.errors);

  const value = {
    quotes,
    fx,
    errors,
    updatedAt: new Date().toISOString()
  };
  quoteCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function getBinanceAccountStatus() {
  const config = await getBinanceConfig();
  return {
    configured: config.configured,
    baseUrl: config.baseUrl,
    recvWindow: config.recvWindow,
    missing: config.missing,
    keyPreview: config.apiKey ? maskSecret(config.apiKey) : null,
    now: new Date().toISOString()
  };
}

async function getBinanceAccountSnapshot() {
  const config = await getBinanceConfig();
  if (!config.configured) {
    throw httpError("Binance API key is not configured", 400, {
      missing: config.missing,
      envFile: ".env"
    });
  }

  const timestamp = await getBinanceSignedTimestamp(config.baseUrl);
  const params = new URLSearchParams({
    omitZeroBalances: "true",
    recvWindow: String(config.recvWindow),
    timestamp: String(timestamp)
  });
  const signature = crypto.createHmac("sha256", config.apiSecret).update(params.toString()).digest("hex");
  params.set("signature", signature);

  const url = `${config.baseUrl}/api/v3/account?${params.toString()}`;
  const json = await fetchBinanceSignedJson(url, config.apiKey);
  const balances = await enrichBinanceBalances(json.balances || []);
  const fx = await getFxRates();
  const cnyRate = Number(fx.rates?.CNY) || 7.25;
  const totalUsd = balances.reduce((sum, balance) => sum + (Number.isFinite(balance.valueUsd) ? balance.valueUsd : 0), 0);

  return {
    configured: true,
    baseUrl: config.baseUrl,
    accountType: json.accountType || "",
    canTrade: Boolean(json.canTrade),
    canWithdraw: Boolean(json.canWithdraw),
    canDeposit: Boolean(json.canDeposit),
    permissions: Array.isArray(json.permissions) ? json.permissions : [],
    updateTime: json.updateTime || null,
    totalUsd,
    totalCny: totalUsd * cnyRate,
    balances,
    fx,
    updatedAt: new Date().toISOString()
  };
}

async function getBinanceSignedTimestamp(baseUrl) {
  try {
    const json = await fetchJsonWithFallback(`${baseUrl}/api/v3/time`, 10000, {
      headers: {
        "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
      }
    });
    const serverTime = Number(json.serverTime);
    if (Number.isFinite(serverTime)) {
      return Math.trunc(serverTime);
    }
  } catch {
    // Local clock is the official fallback when server time is temporarily unavailable.
  }
  return Date.now();
}

async function getBinanceConfig() {
  const env = { ...(await readLocalEnv()), ...process.env };
  const apiKey = String(env.BINANCE_API_KEY || "").trim();
  const apiSecret = String(env.BINANCE_API_SECRET || "").trim();
  const baseUrl = sanitizeBinanceBaseUrl(env.BINANCE_API_BASE_URL || "https://api.binance.com");
  const recvWindow = clampNumber(Number(env.BINANCE_RECV_WINDOW || 5000), 1000, 60000, 5000);
  const missing = [];
  if (!apiKey) missing.push("BINANCE_API_KEY");
  if (!apiSecret) missing.push("BINANCE_API_SECRET");

  return {
    apiKey,
    apiSecret,
    baseUrl,
    recvWindow,
    missing,
    configured: !missing.length
  };
}

async function readLocalEnv() {
  try {
    const text = await fs.readFile(path.join(ROOT_DIR, ".env"), "utf8");
    return parseDotEnv(text);
  } catch {
    return {};
  }
}

function loadLocalEnvIntoProcess(rootDir) {
  try {
    const values = parseDotEnv(fsSync.readFileSync(path.join(rootDir, ".env"), "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Missing local .env is expected for tests and clean checkouts.
  }
}

function parseDotEnv(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function sanitizeBinanceBaseUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") {
      return "https://api.binance.com";
    }
    return `${url.protocol}//${url.host}`.replace(/\/+$/, "");
  } catch {
    return "https://api.binance.com";
  }
}

async function fetchBinanceSignedJson(url, apiKey) {
  const headers = {
    "X-MBX-APIKEY": apiKey,
    "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
  };

  try {
    const response = await fetchWithTimeout(url, 18000, { headers });
    const text = await response.text();
    const payload = safeJsonParse(text);
    if (!response.ok) {
      throw binanceApiError(response.status, payload, text);
    }
    return payload;
  } catch (nodeError) {
    if (nodeError.statusCode || process.platform !== "win32") {
      throw nodeError;
    }

    const text = await fetchTextViaPowerShell(url, 26000, headers);
    const payload = safeJsonParse(text);
    if (payload && payload.code && payload.msg) {
      throw binanceApiError(502, payload, text);
    }
    return payload;
  }
}

async function enrichBinanceBalances(rawBalances) {
  const balances = rawBalances
    .map((row) => {
      const free = toFiniteNumber(row.free);
      const locked = toFiniteNumber(row.locked);
      const total = (free || 0) + (locked || 0);
      return {
        asset: String(row.asset || "").toUpperCase(),
        free: free || 0,
        locked: locked || 0,
        total
      };
    })
    .filter((balance) => balance.asset && balance.total > 0);

  let tickerMap = new Map();
  try {
    tickerMap = await getBinanceTickerMap();
  } catch {
    tickerMap = new Map();
  }

  return balances
    .map((balance) => {
      const priceInfo = estimateBinanceAssetUsd(balance.asset, tickerMap);
      const valueUsd = Number.isFinite(priceInfo.priceUsd) ? balance.total * priceInfo.priceUsd : null;
      return {
        ...balance,
        priceUsd: priceInfo.priceUsd,
        valueUsd,
        quotePair: priceInfo.quotePair,
        priceSource: priceInfo.priceSource
      };
    })
    .sort((a, b) => {
      const aValue = Number.isFinite(a.valueUsd) ? a.valueUsd : -1;
      const bValue = Number.isFinite(b.valueUsd) ? b.valueUsd : -1;
      return bValue - aValue || b.total - a.total || a.asset.localeCompare(b.asset);
    });
}

function estimateBinanceAssetUsd(symbol, tickerMap) {
  const asset = { symbol, quoteSymbol: symbol };
  const stablePrice = getStablecoinUsdPrice(asset);
  if (Number.isFinite(stablePrice)) {
    return { priceUsd: stablePrice, quotePair: "USD", priceSource: "stablecoin" };
  }

  for (const pair of getBinancePairCandidates(asset)) {
    const row = tickerMap.get(pair);
    const price = toFiniteNumber(row?.lastPrice);
    if (Number.isFinite(price) && price > 0) {
      return { priceUsd: price, quotePair: pair, priceSource: "binance" };
    }
  }

  return { priceUsd: null, quotePair: "", priceSource: "missing" };
}

async function getFxRates() {
  const fallback = {
    base: "USD",
    rates: { USD: 1, CNY: 7.25, HKD: 7.83 },
    updatedAt: new Date().toISOString(),
    source: "fallback"
  };

  try {
    const response = await fetchWithTimeout("https://open.er-api.com/v6/latest/USD", 8000);
    if (!response.ok) {
      throw new Error(`FX request failed: ${response.status}`);
    }

    const json = await response.json();
    const rates = json.rates || {};
    if (!rates.CNY || !rates.HKD) {
      throw new Error("FX response did not include CNY/HKD");
    }

    return {
      base: "USD",
      rates: {
        USD: 1,
        CNY: Number(rates.CNY),
        HKD: Number(rates.HKD)
      },
      updatedAt: new Date().toISOString(),
      source: "open.er-api.com"
    };
  } catch (error) {
    return { ...fallback, error: error.message };
  }
}

async function fetchEquityQuotes(symbols) {
  const result = { quotes: {}, errors: [] };
  if (!symbols.length) {
    return result;
  }

  const tencentQuotes = await fetchTencentQuotes(symbols);
  Object.assign(result.quotes, tencentQuotes.quotes);
  result.errors.push(...tencentQuotes.errors);

  const missingSymbols = symbols.filter((symbol) => !result.quotes[symbol]);
  if (missingSymbols.length) {
    const yahooQuotes = await fetchYahooQuotes(missingSymbols);
    Object.assign(result.quotes, yahooQuotes.quotes);
    result.errors.push(...yahooQuotes.errors);
  }

  return result;
}

async function fetchTencentQuotes(symbols) {
  const result = { quotes: {}, errors: [] };
  const symbolEntries = symbols
    .map((symbol) => [symbol, toTencentSymbol(symbol)])
    .filter((entry) => entry[1]);

  if (!symbolEntries.length) {
    return result;
  }

  const keyToSymbol = new Map(symbolEntries.map(([symbol, key]) => [key.toLowerCase(), symbol]));
  const keys = [...new Set(symbolEntries.map((entry) => entry[1]))];

  try {
    for (const chunk of chunkArray(keys, 60)) {
      const url = `https://qt.gtimg.cn/q=${encodeURIComponent(chunk.join(","))}`;
      const response = await fetchWithTimeout(url, 12000, {
        headers: {
          "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1",
          Referer: "https://gu.qq.com/"
        }
      });
      if (!response.ok) {
        throw new Error(`Tencent quote request failed: ${response.status}`);
      }

      const text = await response.text();
      for (const match of text.matchAll(/v_([^=]+)="([^"]*)";/g)) {
        const key = match[1].toLowerCase();
        const symbol = keyToSymbol.get(key);
        if (!symbol) {
          continue;
        }

        const fields = match[2].split("~");
        const price = toFiniteNumber(fields[3]);
        if (!Number.isFinite(price) || price <= 0) {
          continue;
        }

        result.quotes[symbol] = {
          source: "tencent",
          price,
          currency: currencyFromTencentKey(key),
          dayChange: toFiniteNumber(fields[31]),
          changePercent: toFiniteNumber(fields[32]),
          marketTime: parseTencentTime(fields[30]),
          displayName: fields[1] || symbol
        };
      }
    }
  } catch (error) {
    result.errors.push(`Tencent: ${error.message}`);
  }

  return result;
}

async function fetchYahooQuotes(symbols) {
  const result = { quotes: {}, errors: [] };
  if (!symbols.length) {
    return result;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
    const response = await fetchWithTimeout(url, 10000, {
      headers: {
        "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
      }
    });
    if (!response.ok) {
      throw new Error(`Yahoo request failed: ${response.status}`);
    }

    const json = await response.json();
    const rows = json.quoteResponse?.result || [];
    for (const row of rows) {
      const price = Number(row.regularMarketPrice ?? row.postMarketPrice ?? row.preMarketPrice);
      if (!Number.isFinite(price)) {
        continue;
      }
      result.quotes[row.symbol] = {
        source: "yahoo",
        price,
        currency: row.currency || "USD",
        dayChange: toFiniteNumber(row.regularMarketChange),
        changePercent: toFiniteNumber(row.regularMarketChangePercent),
        marketTime: row.regularMarketTime ? new Date(row.regularMarketTime * 1000).toISOString() : null,
        displayName: row.shortName || row.longName || row.symbol
      };
    }
  } catch (error) {
    result.errors.push(`Yahoo: ${error.message}`);
  }

  return result;
}

async function fetchCryptoQuotes(assets) {
  const result = { quotes: {}, errors: [] };
  if (!assets.length) {
    return result;
  }

  const mergeStep = (stepResult) => {
    Object.assign(result.quotes, stepResult.quotes);
    result.errors.push(...stepResult.errors);
  };
  const missing = (filterFn) =>
    assets.filter((asset) => !result.quotes[toCryptoQuoteKey(asset)] && (filterFn ? filterFn(asset) : true));

  // Step 1: Binance
  mergeStep(await fetchBinanceSpotQuotes(assets));

  // Step 2: OKX public spot tickers
  const missingOkx = missing();
  if (missingOkx.length) {
    mergeStep(await fetchOkxSpotQuotes(missingOkx));
  }

  // Step 3: CoinGecko
  const missingCoinGeckoAssets = missing((a) => a.quoteId);
  const ids = [...new Set(missingCoinGeckoAssets.map((asset) => asset.quoteId).filter(Boolean))];

  for (const chunk of chunkArray(ids, 35)) {
    try {
      const params = new URLSearchParams({
        ids: chunk.join(","),
        vs_currencies: "usd,cny,hkd",
        include_24hr_change: "true"
      });
      const url = `https://api.coingecko.com/api/v3/simple/price?${params.toString()}`;
      const json = await fetchJsonWithFallback(url, 25000, {
        headers: {
          "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
        }
      });
      for (const id of chunk) {
        const row = json[id];
        if (!row) {
          continue;
        }
        result.quotes[id] = {
          source: "coingecko",
          prices: {
            usd: toFiniteNumber(row.usd),
            cny: toFiniteNumber(row.cny),
            hkd: toFiniteNumber(row.hkd)
          },
          changePercent: toFiniteNumber(row.usd_24h_change),
          raw: row
        };
      }
    } catch (error) {
      result.errors.push(`CoinGecko: ${error.message}`);
    }
  }

  // Step 4: CoinMarketCap
  const missingCmc = missing((a) => a.quoteSymbol);
  if (missingCmc.length) {
    mergeStep(await fetchCmcQuotes(missingCmc));
  }

  // Step 5: DefiLlama
  const missingLlama = missing((a) => a.quoteId);
  if (missingLlama.length) {
    mergeStep(await fetchDefiLlamaQuotes(missingLlama));
  }

  // Step 6: DexScreener
  const missingDex = missing((a) => a.quoteSymbol);
  if (missingDex.length) {
    mergeStep(await fetchDexScreenerQuotes(missingDex));
  }

  // Step 7: Coinbase (final fallback)
  const missingAssets = missing((a) => a.quoteSymbol);
  if (missingAssets.length) {
    mergeStep(await fetchCoinbaseQuotes(missingAssets));
  }

  return result;
}

async function fetchBinanceSpotQuotes(assets) {
  const result = { quotes: {}, errors: [] };
  const candidates = assets
    .map((asset) => [asset, getBinancePairCandidates(asset)])
    .filter((entry) => entry[1].length);

  if (!candidates.length) {
    return result;
  }

  try {
    const tickerMap = await getBinanceTickerMap();
    for (const [asset, pairs] of candidates) {
      const stablePrice = getStablecoinUsdPrice(asset);
      if (Number.isFinite(stablePrice)) {
        result.quotes[toCryptoQuoteKey(asset)] = {
          source: "binance",
          prices: { usd: stablePrice, cny: null, hkd: null },
          changePercent: 0,
          raw: { syntheticStablecoin: true }
        };
        continue;
      }

      const pair = pairs.find((candidate) => tickerMap.has(candidate));
      if (!pair) {
        continue;
      }

      const row = tickerMap.get(pair);
      const price = toFiniteNumber(row.lastPrice);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }

      const openPrice = toFiniteNumber(row.openPrice);
      const changePercent = Number.isFinite(openPrice) && openPrice > 0 ? ((price - openPrice) / openPrice) * 100 : null;
      result.quotes[toCryptoQuoteKey(asset)] = {
        source: "binance",
        prices: { usd: price, cny: null, hkd: null },
        changePercent,
        raw: {
          symbol: row.symbol,
          openPrice: row.openPrice,
          lastPrice: row.lastPrice,
          closeTime: row.closeTime
        }
      };
    }
  } catch (error) {
    result.errors.push(`Binance: ${error.message}`);
  }

  return result;
}

async function getBinanceTickerMap() {
  if (binanceTickerCache && Date.now() - binanceTickerCache.at < BINANCE_TICKER_TTL_MS) {
    return binanceTickerCache.map;
  }

  const url = "https://data-api.binance.vision/api/v3/ticker/24hr?type=MINI";
  const rows = await fetchJsonWithFallback(url, 30000, {
    headers: {
      "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
    }
  });

  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.symbol) {
      map.set(String(row.symbol).toUpperCase(), row);
    }
  }

  binanceTickerCache = { at: Date.now(), map };
  return map;
}

async function fetchCoinbaseQuotes(assets) {
  const result = { quotes: {}, errors: [] };
  const bySymbol = new Map();
  for (const asset of assets) {
    const symbol = String(asset.quoteSymbol || asset.symbol || "").toUpperCase();
    if (symbol && !bySymbol.has(symbol)) {
      bySymbol.set(symbol, asset);
    }
  }

  for (const [symbol, asset] of bySymbol.entries()) {
    try {
      const url = `https://api.coinbase.com/v2/exchange-rates?currency=${encodeURIComponent(symbol)}`;
      const json = await fetchJsonWithFallback(url, 20000, {
        headers: {
          "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
        }
      });
      const price = toFiniteNumber(json.data?.rates?.USD);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }

      result.quotes[toCryptoQuoteKey(asset)] = {
        source: "coinbase",
        prices: {
          usd: price,
          cny: null,
          hkd: null
        },
        changePercent: null,
        raw: json.data
      };
    } catch (error) {
      result.errors.push(`Coinbase ${symbol}: ${error.message}`);
    }
  }

  return result;
}

function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchJsonWithFallback(url, timeoutMs, options = {}) {
  try {
    const response = await fetchWithTimeout(url, timeoutMs, options);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (nodeError) {
    const env = { ...(await readLocalEnv()), ...process.env };
    const proxyUrl = resolveProxyUrl(url, env);

    if (proxyUrl && process.platform !== "win32") {
      try {
        const text = await fetchTextViaCurlProxy(url, timeoutMs + 8000, options.headers || {}, proxyUrl);
        return JSON.parse(text);
      } catch (curlError) {
        throw new Error(`${nodeError.message}; curl proxy fallback failed: ${curlError.message}`);
      }
    }

    if (process.platform !== "win32") {
      throw nodeError;
    }

    try {
      const text = await fetchTextViaPowerShell(url, timeoutMs + 8000, options.headers || {});
      return JSON.parse(text);
    } catch (powershellError) {
      throw new Error(`${nodeError.message}; PowerShell fallback failed: ${powershellError.message}`);
    }
  }
}

function fetchTextViaPowerShell(url, timeoutMs, headers = {}) {
  return new Promise((resolve, reject) => {
    const timeoutSec = Math.max(10, Math.ceil(timeoutMs / 1000));
    const encodedUrl = Buffer.from(url, "utf16le").toString("base64");
    const encodedHeaders = Buffer.from(JSON.stringify(headers || {}), "utf16le").toString("base64");
    const script = [
      "$ProgressPreference='SilentlyContinue'",
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
      `$url = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${encodedUrl}'))`,
      `$headersJson = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${encodedHeaders}'))`,
      "$headersObject = ConvertFrom-Json $headersJson",
      "$headers = @{}",
      "foreach ($property in $headersObject.PSObject.Properties) { $headers[$property.Name] = [string]$property.Value }",
      `$response = Invoke-WebRequest -UseBasicParsing -TimeoutSec ${timeoutSec} -Uri $url -Headers $headers`,
      "$response.Content"
    ].join("; ");

    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PART 2: OKX Public Spot Quotes
// ═══════════════════════════════════════════════════════════════════════

async function fetchOkxSpotQuotes(assets) {
  const result = { quotes: {}, errors: [] };
  if (!assets.length) {
    return result;
  }

  try {
    const url = "https://www.okx.com/api/v5/market/tickers?instType=SPOT";
    const json = await fetchJsonWithFallback(url, 20000, {
      headers: {
        "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
      }
    });

    const tickers = Array.isArray(json.data) ? json.data : [];
    const tickerMap = new Map();
    for (const ticker of tickers) {
      if (ticker.instId) {
        tickerMap.set(String(ticker.instId).toUpperCase(), ticker);
      }
    }

    for (const asset of assets) {
      const stablePrice = getStablecoinUsdPrice(asset);
      if (Number.isFinite(stablePrice)) {
        result.quotes[toCryptoQuoteKey(asset)] = {
          source: "okx",
          prices: { usd: stablePrice, cny: null, hkd: null },
          changePercent: 0,
          raw: { syntheticStablecoin: true }
        };
        continue;
      }

      const symbol = String(asset.quoteSymbol || asset.symbol || "").toUpperCase();
      if (!symbol) {
        continue;
      }

      const instId = `${symbol}-USDT`;
      const ticker = tickerMap.get(instId);
      if (!ticker) {
        continue;
      }

      const price = toFiniteNumber(ticker.last);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }

      const open24h = toFiniteNumber(ticker.open24h);
      const changePercent = Number.isFinite(open24h) && open24h > 0
        ? ((price - open24h) / open24h) * 100
        : null;

      result.quotes[toCryptoQuoteKey(asset)] = {
        source: "okx",
        prices: { usd: price, cny: null, hkd: null },
        changePercent,
        raw: {
          instId: ticker.instId,
          last: ticker.last,
          open24h: ticker.open24h,
          ts: ticker.ts
        }
      };
    }
  } catch (error) {
    result.errors.push(`OKX: ${error.message}`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// PART 3: CoinMarketCap Quotes
// ═══════════════════════════════════════════════════════════════════════

async function fetchCmcQuotes(assets) {
  const result = { quotes: {}, errors: [] };
  if (!assets.length) {
    return result;
  }

  try {
    const env = { ...(await readLocalEnv()), ...process.env };
    const apiKey = String(env.COINMARKETCAP_API_KEY || "").trim();
    if (!apiKey) {
      return result;
    }

    const bySymbol = new Map();
    for (const asset of assets) {
      const symbol = String(asset.quoteSymbol || asset.symbol || "").toUpperCase();
      if (symbol && !bySymbol.has(symbol)) {
        bySymbol.set(symbol, asset);
      }
    }

    const symbols = [...bySymbol.keys()];
    if (!symbols.length) {
      return result;
    }

    for (const chunk of chunkArray(symbols, 50)) {
      const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(chunk.join(","))}`;
      const json = await fetchJsonWithFallback(url, 20000, {
        headers: {
          "X-CMC_PRO_API_KEY": apiKey,
          "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
        }
      });

      const data = json.data || {};
      for (const [symbol, entries] of Object.entries(data)) {
        const entry = Array.isArray(entries) ? entries[0] : entries;
        if (!entry) {
          continue;
        }

        const quote = entry.quote?.USD;
        if (!quote) {
          continue;
        }

        const price = toFiniteNumber(quote.price);
        if (!Number.isFinite(price) || price <= 0) {
          continue;
        }

        const asset = bySymbol.get(symbol.toUpperCase());
        if (!asset) {
          continue;
        }

        result.quotes[toCryptoQuoteKey(asset)] = {
          source: "coinmarketcap",
          prices: { usd: price, cny: null, hkd: null },
          changePercent: toFiniteNumber(quote.percent_change_24h),
          raw: entry
        };
      }
    }
  } catch (error) {
    result.errors.push(`CoinMarketCap: ${error.message}`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// PART 4: DefiLlama Quotes
// ═══════════════════════════════════════════════════════════════════════

async function fetchDefiLlamaQuotes(assets) {
  const result = { quotes: {}, errors: [] };
  const assetsWithId = assets.filter((a) => a.quoteId);
  if (!assetsWithId.length) {
    return result;
  }

  try {
    const byId = new Map();
    for (const asset of assetsWithId) {
      byId.set(asset.quoteId, asset);
    }

    const ids = [...byId.keys()];
    for (const chunk of chunkArray(ids, 30)) {
      const coins = chunk.map((id) => `coingecko:${id}`).join(",");
      const url = `https://api.llama.fi/prices/current/${coins}`;
      const json = await fetchJsonWithFallback(url, 20000, {
        headers: {
          "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
        }
      });

      const coinsData = json.coins || {};
      for (const id of chunk) {
        const key = `coingecko:${id}`;
        const row = coinsData[key];
        if (!row) {
          continue;
        }

        const price = toFiniteNumber(row.price);
        if (!Number.isFinite(price) || price <= 0) {
          continue;
        }

        const asset = byId.get(id);
        if (!asset) {
          continue;
        }

        result.quotes[toCryptoQuoteKey(asset)] = {
          source: "defillama",
          prices: { usd: price, cny: null, hkd: null },
          changePercent: null,
          raw: row
        };
      }
    }
  } catch (error) {
    result.errors.push(`DefiLlama: ${error.message}`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// PART 5: DexScreener Quotes
// ═══════════════════════════════════════════════════════════════════════

async function fetchDexScreenerQuotes(assets) {
  const result = { quotes: {}, errors: [] };
  const bySymbol = new Map();
  for (const asset of assets) {
    const symbol = String(asset.quoteSymbol || asset.symbol || "").toUpperCase();
    if (symbol && !bySymbol.has(symbol)) {
      bySymbol.set(symbol, asset);
    }
  }

  for (const [symbol, asset] of bySymbol.entries()) {
    try {
      const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`;
      const json = await fetchJsonWithFallback(url, 15000, {
        headers: {
          "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
        }
      });

      const pairs = Array.isArray(json.pairs) ? json.pairs : [];
      if (!pairs.length) {
        continue;
      }

      const first = pairs[0];
      const price = toFiniteNumber(first.priceUsd);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }

      const priceChange = toFiniteNumber(first.priceChange?.h24);
      result.quotes[toCryptoQuoteKey(asset)] = {
        source: "dexscreener",
        prices: { usd: price, cny: null, hkd: null },
        changePercent: priceChange,
        raw: {
          pairAddress: first.pairAddress,
          chainId: first.chainId,
          dexId: first.dexId,
          priceUsd: first.priceUsd,
          baseToken: first.baseToken,
          quoteToken: first.quoteToken
        }
      };
    } catch (error) {
      result.errors.push(`DexScreener ${symbol}: ${error.message}`);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// PART 7: OKX Account API
// ═══════════════════════════════════════════════════════════════════════

async function getOkxConfig() {
  const env = { ...(await readLocalEnv()), ...process.env };
  const apiKey = String(env.OKX_API_KEY || "").trim();
  const apiSecret = String(env.OKX_API_SECRET || "").trim();
  const passphrase = String(env.OKX_API_PASSPHRASE || "").trim();
  const missing = [];
  if (!apiKey) missing.push("OKX_API_KEY");
  if (!apiSecret) missing.push("OKX_API_SECRET");
  if (!passphrase) missing.push("OKX_API_PASSPHRASE");

  return {
    apiKey,
    apiSecret,
    passphrase,
    missing,
    configured: !missing.length
  };
}

async function getOkxAccountStatus() {
  const config = await getOkxConfig();
  return {
    configured: config.configured,
    missing: config.missing,
    keyPreview: config.apiKey ? maskSecret(config.apiKey) : null,
    now: new Date().toISOString()
  };
}

async function getOkxAccountSnapshot() {
  const config = await getOkxConfig();
  if (!config.configured) {
    throw httpError("OKX API key is not configured", 400, {
      missing: config.missing,
      envFile: ".env"
    });
  }

  const requestPath = "/api/v5/asset/balances";
  const timestamp = new Date().toISOString();
  const prehash = timestamp + "GET" + requestPath;
  const sign = crypto.createHmac("sha256", config.apiSecret).update(prehash).digest("base64");

  const url = `https://www.okx.com${requestPath}`;
  let json;
  try {
    json = await fetchJsonWithFallback(url, 20000, {
      headers: {
        "OK-ACCESS-KEY": config.apiKey,
        "OK-ACCESS-SIGN": sign,
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": config.passphrase,
        "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
      }
    });
  } catch (error) {
    throw httpError(`OKX API: ${error.message}`, 502);
  }

  if (json.code !== "0") {
    throw httpError(`OKX API: ${json.msg || "unknown error"}`, 502, { code: json.code });
  }

  const rawBalances = Array.isArray(json.data) ? json.data : [];
  let tickerMap = new Map();
  try {
    tickerMap = await getBinanceTickerMap();
  } catch {
    tickerMap = new Map();
  }

  const balances = rawBalances
    .filter((row) => {
      const bal = toFiniteNumber(row.bal);
      return Number.isFinite(bal) && bal > 0;
    })
    .map((row) => {
      const asset = String(row.ccy || "").toUpperCase();
      const bal = toFiniteNumber(row.bal) || 0;
      const availBal = toFiniteNumber(row.availBal) || 0;
      const frozenBal = toFiniteNumber(row.frozenBal) || 0;
      const priceInfo = estimateBinanceAssetUsd(asset, tickerMap);
      const valueUsd = Number.isFinite(priceInfo.priceUsd) ? bal * priceInfo.priceUsd : null;
      return {
        asset,
        total: bal,
        free: availBal,
        locked: frozenBal,
        priceUsd: priceInfo.priceUsd,
        valueUsd,
        priceSource: priceInfo.priceSource
      };
    })
    .sort((a, b) => {
      const aValue = Number.isFinite(a.valueUsd) ? a.valueUsd : -1;
      const bValue = Number.isFinite(b.valueUsd) ? b.valueUsd : -1;
      return bValue - aValue || b.total - a.total;
    });

  const fx = await getFxRates();
  const cnyRate = Number(fx.rates?.CNY) || 7.25;
  const totalUsd = balances.reduce((sum, b) => sum + (Number.isFinite(b.valueUsd) ? b.valueUsd : 0), 0);

  return {
    configured: true,
    exchange: "okx",
    totalUsd,
    totalCny: totalUsd * cnyRate,
    balances,
    fx,
    updatedAt: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PART 8: Bybit Account API
// ═══════════════════════════════════════════════════════════════════════

async function getBybitConfig() {
  const env = { ...(await readLocalEnv()), ...process.env };
  const apiKey = String(env.BYBIT_API_KEY || "").trim();
  const apiSecret = String(env.BYBIT_API_SECRET || "").trim();
  const missing = [];
  if (!apiKey) missing.push("BYBIT_API_KEY");
  if (!apiSecret) missing.push("BYBIT_API_SECRET");

  return {
    apiKey,
    apiSecret,
    missing,
    configured: !missing.length
  };
}

async function getBybitAccountStatus() {
  const config = await getBybitConfig();
  return {
    configured: config.configured,
    missing: config.missing,
    keyPreview: config.apiKey ? maskSecret(config.apiKey) : null,
    now: new Date().toISOString()
  };
}

async function getBybitAccountSnapshot() {
  const config = await getBybitConfig();
  if (!config.configured) {
    throw httpError("Bybit API key is not configured", 400, {
      missing: config.missing,
      envFile: ".env"
    });
  }

  const recvWindow = "5000";
  const timestamp = String(Date.now());
  const queryString = "accountType=UNIFIED";
  const prehash = timestamp + config.apiKey + recvWindow + queryString;
  const sign = crypto.createHmac("sha256", config.apiSecret).update(prehash).digest("hex");

  const url = `https://api.bybit.com/v5/account/wallet-balance?${queryString}`;
  let json;
  try {
    json = await fetchJsonWithFallback(url, 20000, {
      headers: {
        "X-BAPI-API-KEY": config.apiKey,
        "X-BAPI-SIGN": sign,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
      }
    });
  } catch (error) {
    throw httpError(`Bybit API: ${error.message}`, 502);
  }

  if (json.retCode !== undefined && json.retCode !== 0) {
    throw httpError(`Bybit API: ${json.retMsg || "unknown error"}`, 502, { retCode: json.retCode });
  }

  const accounts = json.result?.list || [];
  const coins = [];
  for (const account of accounts) {
    for (const coin of Array.isArray(account.coin) ? account.coin : []) {
      const walletBalance = toFiniteNumber(coin.walletBalance);
      if (!Number.isFinite(walletBalance) || walletBalance <= 0) {
        continue;
      }
      const usdValue = toFiniteNumber(coin.usdValue);
      coins.push({
        asset: String(coin.coin || "").toUpperCase(),
        total: walletBalance,
        free: toFiniteNumber(coin.availableToWithdraw) || walletBalance,
        locked: (walletBalance - (toFiniteNumber(coin.availableToWithdraw) || walletBalance)),
        priceUsd: Number.isFinite(usdValue) && walletBalance > 0 ? usdValue / walletBalance : null,
        valueUsd: usdValue,
        priceSource: "bybit"
      });
    }
  }

  coins.sort((a, b) => {
    const aValue = Number.isFinite(a.valueUsd) ? a.valueUsd : -1;
    const bValue = Number.isFinite(b.valueUsd) ? b.valueUsd : -1;
    return bValue - aValue || b.total - a.total;
  });

  const fx = await getFxRates();
  const cnyRate = Number(fx.rates?.CNY) || 7.25;
  const totalUsd = coins.reduce((sum, c) => sum + (Number.isFinite(c.valueUsd) ? c.valueUsd : 0), 0);

  return {
    configured: true,
    exchange: "bybit",
    totalUsd,
    totalCny: totalUsd * cnyRate,
    balances: coins,
    fx,
    updatedAt: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PART 9: Wallet Management
// ═══════════════════════════════════════════════════════════════════════

async function loadWallets() {
  try {
    const text = await fs.readFile(WALLETS_FILE, "utf8");
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveWallets(wallets) {
  const dir = path.dirname(WALLETS_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(WALLETS_FILE, JSON.stringify(wallets, null, 2), "utf8");
}

// ═══════════════════════════════════════════════════════════════════════
// PART 10: On-chain Balance Queries
// ═══════════════════════════════════════════════════════════════════════

async function fetchOnchainBalances() {
  if (onchainBalanceCache && Date.now() - onchainBalanceCache.at < ONCHAIN_CACHE_TTL_MS) {
    return { ...onchainBalanceCache.value, cached: true };
  }

  const wallets = await loadWallets();
  const env = { ...(await readLocalEnv()), ...process.env };
  const etherscanKey = String(env.ETHERSCAN_API_KEY || "").trim();
  const solscanKey = String(env.SOLSCAN_API_KEY || "").trim();
  const moralisKey = String(env.MORALIS_API_KEY || "").trim();
  const oneinchKey = String(env.ONEINCH_API_KEY || "").trim();
  const alchemyKey = String(env.ALCHEMY_API_KEY || "").trim();
  const infuraKey = String(env.INFURA_API_KEY || "").trim();

  const results = [];
  const errors = [];

  for (const wallet of wallets) {
    const address = String(wallet.address || "").trim();
    if (!address) {
      continue;
    }

    const chain = String(wallet.chain || "eth").toLowerCase();
    const walletResult = {
      id: wallet.id,
      label: wallet.label || "",
      address,
      chain,
      balances: [],
      errors: []
    };

    try {
      if (chain === "btc" || chain === "bitcoin") {
        const btcBal = await fetchBtcBalance(address);
        walletResult.balances.push(...btcBal);
      } else if (chain === "sol" || chain === "solana") {
        const solBal = await fetchSolanaBalances(address, solscanKey);
        walletResult.balances.push(...solBal);
      } else {
        // EVM chains
        const chainIdMap = { eth: 1, bsc: 56, polygon: 137, arbitrum: 42161 };
        const chainId = chainIdMap[chain] || 1;

        if (etherscanKey) {
          const evmBal = await fetchEvmBalances(address, chainId, etherscanKey);
          walletResult.balances.push(...evmBal);
        }

        if (moralisKey) {
          const moralisChainMap = { eth: "eth", bsc: "bsc", polygon: "polygon", arbitrum: "arbitrum" };
          const moralisChain = moralisChainMap[chain] || "eth";
          const moralisBal = await fetchMoralisBalances(address, [moralisChain], moralisKey);
          walletResult.balances.push(...moralisBal);
        }

        if (oneinchKey) {
          const chainIdMap1inch = { eth: 1, bsc: 56, polygon: 137, arbitrum: 42161 };
          const cid = chainIdMap1inch[chain] || 1;
          const oneinchBal = await fetch1inchBalances(address, cid, oneinchKey);
          walletResult.balances.push(...oneinchBal);
        }

        if (alchemyKey && (chain === "eth" || chain === "ethereum")) {
          const alchemyBal = await fetchAlchemyBalances(address, alchemyKey);
          walletResult.balances.push(...alchemyBal);
        }

        if (infuraKey && (chain === "eth" || chain === "ethereum")) {
          const infuraBal = await fetchInfuraBalance(address, infuraKey);
          walletResult.balances.push(...infuraBal);
        }
      }
    } catch (error) {
      walletResult.errors.push(error.message);
    }

    results.push(walletResult);
    errors.push(...walletResult.errors);
  }

  const value = {
    wallets: results,
    errors,
    updatedAt: new Date().toISOString()
  };
  onchainBalanceCache = { at: Date.now(), value };
  return value;
}

async function fetchEvmBalances(address, chainId, apiKey) {
  const balances = [];
  try {
    const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=balance&address=${encodeURIComponent(address)}&tag=latest&apikey=${encodeURIComponent(apiKey)}`;
    const json = await fetchJsonWithFallback(url, 15000, {
      headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
    });

    if (json.status === "1" && json.result) {
      const wei = BigInt(json.result);
      const nativeBalance = Number(wei) / 1e18;
      const nativeSymbolMap = { 1: "ETH", 56: "BNB", 137: "MATIC", 42161: "ETH" };
      balances.push({
        token: nativeSymbolMap[chainId] || "ETH",
        balance: nativeBalance,
        type: "native",
        source: "etherscan"
      });
    }
  } catch (error) {
    balances.push({ token: "ETH", balance: 0, type: "native", source: "etherscan", error: error.message });
  }

  // Try ERC-20 token list
  try {
    const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=tokentx&address=${encodeURIComponent(address)}&page=1&offset=100&sort=desc&apikey=${encodeURIComponent(apiKey)}`;
    const json = await fetchJsonWithFallback(url, 15000, {
      headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
    });

    if (json.status === "1" && Array.isArray(json.result)) {
      const tokenSet = new Map();
      for (const tx of json.result) {
        const contractAddress = tx.contractAddress;
        if (contractAddress && !tokenSet.has(contractAddress)) {
          tokenSet.set(contractAddress, {
            symbol: tx.tokenSymbol || "UNKNOWN",
            decimals: Number(tx.tokenDecimal) || 18
          });
        }
      }

      for (const [contractAddress, tokenInfo] of tokenSet.entries()) {
        try {
          const balUrl = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=tokenbalance&contractaddress=${contractAddress}&address=${encodeURIComponent(address)}&tag=latest&apikey=${encodeURIComponent(apiKey)}`;
          const balJson = await fetchJsonWithFallback(balUrl, 10000, {
            headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
          });

          if (balJson.status === "1" && balJson.result) {
            const rawBal = BigInt(balJson.result);
            const tokenBalance = Number(rawBal) / Math.pow(10, tokenInfo.decimals);
            if (tokenBalance > 0) {
              balances.push({
                token: tokenInfo.symbol,
                balance: tokenBalance,
                contractAddress,
                type: "erc20",
                source: "etherscan"
              });
            }
          }
        } catch {
          // Skip failed token balance queries
        }
      }
    }
  } catch {
    // ERC-20 queries are best-effort
  }

  return balances;
}

async function fetchBtcBalance(address) {
  const balances = [];
  try {
    const url = `https://blockchain.info/balance?active=${encodeURIComponent(address)}`;
    const json = await fetchJsonWithFallback(url, 15000, {
      headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
    });

    const data = json[address];
    if (data && Number.isFinite(data.final_balance)) {
      balances.push({
        token: "BTC",
        balance: data.final_balance / 1e8,
        type: "native",
        source: "blockchain.info"
      });
    }
  } catch (error) {
    balances.push({ token: "BTC", balance: 0, type: "native", source: "blockchain.info", error: error.message });
  }

  return balances;
}

async function fetchSolanaBalances(address, apiKey) {
  const balances = [];
  if (!apiKey) {
    return balances;
  }

  try {
    const url = `https://pro-api.solscan.io/v2.0/account/token-accounts?address=${encodeURIComponent(address)}`;
    const json = await fetchJsonWithFallback(url, 15000, {
      headers: {
        token: apiKey,
        "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
      }
    });

    const tokens = Array.isArray(json.data) ? json.data : [];
    for (const token of tokens) {
      const amount = toFiniteNumber(token.amount);
      const decimals = Number(token.decimals) || 9;
      const balance = Number.isFinite(amount) ? amount / Math.pow(10, decimals) : 0;
      if (balance > 0) {
        balances.push({
          token: token.tokenSymbol || token.tokenAddress || "UNKNOWN",
          balance,
          tokenAddress: token.tokenAddress,
          type: token.tokenSymbol === "SOL" ? "native" : "spl",
          source: "solscan"
        });
      }
    }
  } catch (error) {
    balances.push({ token: "SOL", balance: 0, type: "native", source: "solscan", error: error.message });
  }

  return balances;
}

async function fetchMoralisBalances(address, chains, apiKey) {
  const balances = [];
  if (!apiKey) {
    return balances;
  }

  for (const chain of chains) {
    try {
      const url = `https://deep-index.moralis.io/api/v2.2/wallets/${encodeURIComponent(address)}/tokens?chain=${encodeURIComponent(chain)}`;
      const json = await fetchJsonWithFallback(url, 15000, {
        headers: {
          "X-API-Key": apiKey,
          "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
        }
      });

      const results = Array.isArray(json.result) ? json.result : [];
      for (const row of results) {
        const balance = toFiniteNumber(row.balance);
        const decimals = Number(row.decimals) || 18;
        const tokenBalance = Number.isFinite(balance) ? balance / Math.pow(10, decimals) : 0;
        if (tokenBalance > 0) {
          balances.push({
            token: row.symbol || row.name || "UNKNOWN",
            balance: tokenBalance,
            contractAddress: row.token_address,
            type: row.native_token ? "native" : "erc20",
            chain,
            source: "moralis"
          });
        }
      }
    } catch (error) {
      balances.push({ token: "UNKNOWN", balance: 0, chain, source: "moralis", error: error.message });
    }
  }

  return balances;
}

async function fetch1inchBalances(address, chainId, apiKey) {
  const balances = [];
  if (!apiKey) {
    return balances;
  }

  try {
    const url = `https://api.1inch.dev/balance/v1.2/${chainId}/balances/${encodeURIComponent(address)}`;
    const json = await fetchJsonWithFallback(url, 15000, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
      }
    });

    for (const [tokenAddress, rawBalance] of Object.entries(json || {})) {
      const balance = toFiniteNumber(rawBalance);
      if (Number.isFinite(balance) && balance > 0) {
        const normalizedBalance = balance / 1e18;
        balances.push({
          token: tokenAddress,
          balance: normalizedBalance,
          type: "token",
          chainId,
          source: "1inch"
        });
      }
    }
  } catch (error) {
    balances.push({ token: "UNKNOWN", balance: 0, chainId, source: "1inch", error: error.message });
  }

  return balances;
}

async function fetchAlchemyBalances(address, apiKey) {
  const balances = [];
  if (!apiKey) {
    return balances;
  }

  try {
    const url = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getTokenBalances",
      params: [address, "erc20"]
    });

    const response = await fetchWithTimeout(url, 15000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
      },
      body
    });

    if (!response.ok) {
      throw new Error(`Alchemy HTTP ${response.status}`);
    }

    const json = await response.json();
    const tokenBalances = json.result?.tokenBalances || [];
    for (const tb of tokenBalances) {
      if (tb.tokenBalance && tb.tokenBalance !== "0x0" && tb.tokenBalance !== "0x") {
        const rawBalance = parseInt(tb.tokenBalance, 16);
        if (Number.isFinite(rawBalance) && rawBalance > 0) {
          balances.push({
            token: tb.contractAddress,
            balance: rawBalance / 1e18,
            contractAddress: tb.contractAddress,
            type: "erc20",
            source: "alchemy"
          });
        }
      }
    }
  } catch (error) {
    balances.push({ token: "UNKNOWN", balance: 0, source: "alchemy", error: error.message });
  }

  return balances;
}

async function fetchInfuraBalance(address, apiKey) {
  const balances = [];
  if (!apiKey) {
    return balances;
  }

  try {
    const url = `https://mainnet.infura.io/v3/${apiKey}`;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"]
    });

    const response = await fetchWithTimeout(url, 15000, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
      },
      body
    });

    if (!response.ok) {
      throw new Error(`Infura HTTP ${response.status}`);
    }

    const json = await response.json();
    if (json.result) {
      const weiBalance = parseInt(json.result, 16);
      if (Number.isFinite(weiBalance) && weiBalance > 0) {
        balances.push({
          token: "ETH",
          balance: weiBalance / 1e18,
          type: "native",
          source: "infura"
        });
      }
    }
  } catch (error) {
    balances.push({ token: "ETH", balance: 0, source: "infura", error: error.message });
  }

  return balances;
}


// ═══════════════════════════════════════════════════════════════════════
// PART 11: Channels Status
// ═══════════════════════════════════════════════════════════════════════

async function getChannelsStatus() {
  const env = { ...(await readLocalEnv()), ...process.env };

  const hasKey = (name) => Boolean(String(env[name] || "").trim());

  const channels = [
    {
      id: "binance",
      name: "Binance",
      type: "行情",
      status: "active",
      needsKey: false
    },
    {
      id: "okx",
      name: "OKX 公开行情",
      type: "行情",
      status: "active",
      needsKey: false
    },
    {
      id: "coingecko",
      name: "CoinGecko",
      type: "行情",
      status: "active",
      needsKey: false
    },
    {
      id: "coinmarketcap",
      name: "CoinMarketCap",
      type: "行情",
      status: hasKey("COINMARKETCAP_API_KEY") ? "active" : "unconfigured",
      needsKey: true
    },
    {
      id: "defillama",
      name: "DefiLlama",
      type: "行情",
      status: "active",
      needsKey: false
    },
    {
      id: "dexscreener",
      name: "DexScreener",
      type: "行情",
      status: "active",
      needsKey: false
    },
    {
      id: "coinbase",
      name: "Coinbase",
      type: "行情",
      status: "active",
      needsKey: false
    },

    {
      id: "binance-account",
      name: "Binance 账户",
      type: "账户",
      status: hasKey("BINANCE_API_KEY") && hasKey("BINANCE_API_SECRET") ? "active" : "unconfigured",
      needsKey: true
    },
    {
      id: "okx-account",
      name: "OKX 账户",
      type: "账户",
      status: hasKey("OKX_API_KEY") && hasKey("OKX_API_SECRET") && hasKey("OKX_API_PASSPHRASE") ? "active" : "unconfigured",
      needsKey: true
    },
    {
      id: "bybit-account",
      name: "Bybit 账户",
      type: "账户",
      status: hasKey("BYBIT_API_KEY") && hasKey("BYBIT_API_SECRET") ? "active" : "unconfigured",
      needsKey: true
    },
    {
      id: "etherscan",
      name: "Etherscan V2",
      type: "链上",
      status: hasKey("ETHERSCAN_API_KEY") ? "active" : "unconfigured",
      needsKey: true
    },
    {
      id: "blockchain-info",
      name: "Blockchain.com (BTC)",
      type: "链上",
      status: "active",
      needsKey: false
    },
    {
      id: "solscan",
      name: "Solscan",
      type: "链上",
      status: hasKey("SOLSCAN_API_KEY") ? "active" : "unconfigured",
      needsKey: true
    },
    {
      id: "moralis",
      name: "Moralis",
      type: "链上",
      status: hasKey("MORALIS_API_KEY") ? "active" : "unconfigured",
      needsKey: true
    },
    {
      id: "1inch",
      name: "1inch Balance",
      type: "链上",
      status: hasKey("ONEINCH_API_KEY") ? "active" : "unconfigured",
      needsKey: true
    },
    {
      id: "alchemy",
      name: "Alchemy",
      type: "链上",
      status: hasKey("ALCHEMY_API_KEY") ? "active" : "unconfigured",
      needsKey: true
    },
    {
      id: "infura",
      name: "Infura",
      type: "链上",
      status: hasKey("INFURA_API_KEY") ? "active" : "unconfigured",
      needsKey: true
    }
  ];

  return {
    channels,
    updatedAt: new Date().toISOString()
  };
}

function toCryptoQuoteKey(asset) {
  return asset.quoteId || asset.id;
}

function getBinancePairCandidates(asset) {
  const rawQuoteSymbol = String(asset.quoteSymbol || "").trim().toUpperCase();
  const rawSymbol = String(asset.symbol || "").trim().toUpperCase();
  const base = rawQuoteSymbol || rawSymbol;
  if (!base) {
    return [];
  }

  const sanitized = base.replace(/[^A-Z0-9]/g, "");
  if (!sanitized || sanitized === "MISC") {
    return [];
  }

  const candidates = [];
  if (sanitized.endsWith("USDT") || sanitized.endsWith("USDC") || sanitized.endsWith("FDUSD")) {
    candidates.push(sanitized);
  }
  candidates.push(`${sanitized}USDT`, `${sanitized}USDC`, `${sanitized}FDUSD`);
  return [...new Set(candidates)];
}

function getStablecoinUsdPrice(asset) {
  const symbol = String(asset.quoteSymbol || asset.symbol || "").trim().toUpperCase();
  if (["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USD1", "BYUSDT"].includes(symbol)) {
    return 1;
  }
  return null;
}

function toTencentSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const hkMatch = normalized.match(/^0?(\d{3,5})\.HK$/);
  if (hkMatch) {
    return `hk${hkMatch[1].padStart(5, "0")}`;
  }

  const shMatch = normalized.match(/^(\d{6})\.(SS|SH)$/);
  if (shMatch) {
    return `sh${shMatch[1]}`;
  }

  const szMatch = normalized.match(/^(\d{6})\.(SZ)$/);
  if (szMatch) {
    return `sz${szMatch[1]}`;
  }

  if (/^\d{6}$/.test(normalized)) {
    return /^(5|6|9)/.test(normalized) ? `sh${normalized}` : `sz${normalized}`;
  }

  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) {
    return `us${normalized.replace(".", "-")}`;
  }

  return null;
}

function currencyFromTencentKey(key) {
  if (key.startsWith("hk")) return "HKD";
  if (key.startsWith("us")) return "USD";
  return "CNY";
}

function parseTencentTime(value) {
  if (!value) return null;
  if (/^\d{14}$/.test(value)) {
    const formatted = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+08:00`;
    return new Date(formatted).toISOString();
  }

  const normalized = value.replace(/\//g, "-").replace(" ", "T");
  const withZone = /^\d{4}-\d{2}-\d{2}T/.test(normalized) ? `${normalized}+08:00` : normalized;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

function maskSecret(value) {
  const text = String(value || "");
  if (text.length <= 8) {
    return "****";
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function httpError(message, statusCode = 500, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function binanceApiError(statusCode, payload, rawText) {
  const message = payload?.msg || rawText || "Binance API request failed";
  return httpError(`Binance API: ${message}`, statusCode, {
    code: payload?.code || null
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PART 11: Early Warning Radar Logic
// ═══════════════════════════════════════════════════════════════════════

let radarScanCache = null;
let cexRadarScanner = null;
const RADAR_CACHE_TTL_MS = 60000;
const radarLiquidityHistory = new Map();
const RADAR_CONFIG_FILE = path.join(ROOT_DIR, "data", "radar-watchlist.json");

async function loadRadarConfig() {
  try {
    const text = await fs.readFile(RADAR_CONFIG_FILE, "utf8");
    return JSON.parse(text);
  } catch {
    const defaultConfig = {
      version: 1,
      scanIntervalMinutes: 5,
      notificationsEnabled: true,
      soundEnabled: false,
      customTokens: [],
      mutedTokens: []
    };
    await fs.mkdir(path.dirname(RADAR_CONFIG_FILE), { recursive: true });
    await fs.writeFile(RADAR_CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), "utf8");
    return defaultConfig;
  }
}

async function saveRadarConfig(newConfig) {
  const config = await loadRadarConfig();
  if (newConfig.scanIntervalMinutes !== undefined) config.scanIntervalMinutes = Number(newConfig.scanIntervalMinutes);
  if (newConfig.notificationsEnabled !== undefined) config.notificationsEnabled = Boolean(newConfig.notificationsEnabled);
  if (newConfig.soundEnabled !== undefined) config.soundEnabled = Boolean(newConfig.soundEnabled);
  if (newConfig.customTokens !== undefined) config.customTokens = Array.isArray(newConfig.customTokens) ? newConfig.customTokens : [];
  if (newConfig.mutedTokens !== undefined) config.mutedTokens = Array.isArray(newConfig.mutedTokens) ? newConfig.mutedTokens : [];
  
  await fs.writeFile(RADAR_CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  return config;
}

function getCexRadarScanner() {
  if (!cexRadarScanner) {
    cexRadarScanner = createCexRadarScanner({
      fetchJson: (url, timeoutMs, options) => fetchJsonWithFallback(url, timeoutMs, options),
      getSpotTickerMap: getBinanceTickerMap,
      now: () => new Date()
    });
  }
  return cexRadarScanner;
}

async function fetchCexRadarScan(force = false, deepInspectLimit = undefined) {
  return getCexRadarScanner().scan({ force, deepInspectLimit });
}

function getCexBackgroundMonitorStatus() {
  if (!cexBackgroundMonitor) {
    return {
      running: false,
      enabled: false,
      lastRunAt: null,
      nextRunAt: null,
      lastError: null,
      lastSummary: null,
      lastAlertCount: 0,
      lastPaperTrading: null,
      lastPaperTradingError: null,
      runCount: 0
    };
  }
  return {
    enabled: true,
    ...cexBackgroundMonitor.getStatus()
  };
}

async function startCexBackgroundMonitorFromEnv() {
  const env = { ...(await readLocalEnv()), ...process.env };
  if (!parseBoolean(env.CEX_BACKGROUND_MONITOR_ENABLED, false)) {
    return;
  }

  const paperTradingEnabled = parseBoolean(env.CEX_PAPER_TRADING_ENABLED, true);
  cexBackgroundMonitor = createCexBackgroundMonitor({
    scanCexRadar: ({ force, deepInspectLimit }) => fetchCexRadarScan(force, deepInspectLimit),
    loadJournal: () => loadCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE),
    saveJournal: (entries) => saveCexSignalJournal(CEX_SIGNAL_JOURNAL_FILE, entries),
    loadPaperTrades: paperTradingEnabled ? () => loadCexPaperTrades(CEX_PAPER_TRADES_FILE) : undefined,
    savePaperTrades: paperTradingEnabled ? (trades) => saveCexPaperTrades(CEX_PAPER_TRADES_FILE, trades) : undefined,
    fetchKlines: paperTradingEnabled ? (symbol, options) => fetchBinanceFuturesKlines(symbol, options) : undefined,
    notifier: createTelegramNotifier({ env }),
    intervalMinutes: parsePositiveNumber(env.CEX_BACKGROUND_MONITOR_INTERVAL_MINUTES, 5),
    deepInspectLimit: parsePositiveNumber(env.CEX_BACKGROUND_MONITOR_DEEP_LIMIT, 20),
    pinnedSymbols: parseCsv(env.CEX_BACKGROUND_MONITOR_PINNED_SYMBOLS),
    alertCooldownMs: parsePositiveNumber(env.CEX_ALERT_COOLDOWN_MINUTES, 60) * 60 * 1000
  });
  cexBackgroundMonitor.start();
  console.log("CEX background monitor started");
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parsePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

async function fetchBinanceFuturesKlines(symbol, options = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) return [];

  const url = new URL("https://fapi.binance.com/fapi/v1/klines");
  url.searchParams.set("symbol", normalizedSymbol);
  url.searchParams.set("interval", options.interval || "5m");
  url.searchParams.set("limit", String(options.limit || 1000));
  if (options.startTime) url.searchParams.set("startTime", String(options.startTime));
  if (options.endTime) url.searchParams.set("endTime", String(options.endTime));

  const rows = await fetchJsonWithFallback(url.toString(), 15_000, {
    headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
  });
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeKlineRow).filter(Boolean);
}

function normalizeKlineRow(row) {
  const openTime = Number(row?.[0]);
  const high = Number(row?.[2]);
  const low = Number(row?.[3]);
  const close = Number(row?.[4]);
  if (!Number.isFinite(openTime) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return null;
  return { openTime, high, low, close };
}

async function fetchRadarScan(force = false) {
  if (!force && radarScanCache && (Date.now() - radarScanCache.at < RADAR_CACHE_TTL_MS)) {
    return { ...radarScanCache.value, cached: true };
  }

  const config = await loadRadarConfig();
  const candidates = new Set();

  // 1. Discover candidates from DexScreener top boosted
  try {
    const boostedRes = await fetchJsonWithFallback("https://api.dexscreener.com/token-boosts/top/v1", 10000, {
      headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
    });
    if (Array.isArray(boostedRes)) {
      boostedRes.slice(0, 15).forEach(b => {
        if (b.tokenAddress) candidates.add(b.tokenAddress.toLowerCase());
      });
    }
  } catch (err) {
    console.error("DexScreener boosted scan failed:", err.message);
  }

  // 2. Discover candidates from DexScreener new profiles
  try {
    const profilesRes = await fetchJsonWithFallback("https://api.dexscreener.com/token-profiles/latest/v1", 10000, {
      headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
    });
    if (Array.isArray(profilesRes)) {
      profilesRes.slice(0, 15).forEach(p => {
        if (p.tokenAddress) candidates.add(p.tokenAddress.toLowerCase());
      });
    }
  } catch (err) {
    console.error("DexScreener new profiles scan failed:", err.message);
  }

  // 3. Add custom tokens from watchlist
  if (Array.isArray(config.customTokens)) {
    config.customTokens.forEach(t => {
      if (t.address) candidates.add(t.address.toLowerCase());
    });
  }

  const candidateList = Array.from(candidates);
  const subset = candidateList.slice(0, 15);

  const results = [];
  const errors = [];

  let binanceTickerMap = new Map();
  try {
    binanceTickerMap = await getBinanceTickerMap();
  } catch {
    // fallback
  }

  const env = { ...(await readLocalEnv()), ...process.env };
  const ethplorerKey = "freekey";
  const moralisKey = String(env.MORALIS_API_KEY || "").trim();

  for (const address of subset) {
    let dexData = null;
    try {
      const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
      const dexRes = await fetchJsonWithFallback(dexUrl, 10000, {
        headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
      });
      if (dexRes && Array.isArray(dexRes.pairs) && dexRes.pairs.length > 0) {
        dexRes.pairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
        dexData = dexRes.pairs[0];
      }
    } catch (err) {
      errors.push(`DexScreener error for ${address}: ${err.message}`);
    }

    if (!dexData) {
      const isCustom = config.customTokens.some(t => t.address.toLowerCase() === address);
      if (isCustom) {
        const customTokenInfo = config.customTokens.find(t => t.address.toLowerCase() === address);
        results.push({
          address,
          name: customTokenInfo.label || "Custom Token",
          symbol: "UNKNOWN",
          chain: customTokenInfo.chain || "ethereum",
          price: 0,
          liquidity: 0,
          volume24h: 0,
          marketCap: 0,
          ageDays: 999,
          score: 0,
          warningLevel: "low",
          signals: {
            holderConcentration: { score: 0, val: 0, detail: "无数据" },
            volToMcRatio: { score: 0, val: 0, detail: "无数据" },
            priceAcceleration: { score: 0, val: 0, detail: "无数据" },
            liquidityAnomaly: { score: 0, val: 0, detail: "无数据" },
            tokenAge: { score: 0, val: 0, detail: "无数据" },
            cexListing: { score: 0, val: 0, detail: "未上线" }
          }
        });
      }
      continue;
    }

    const chain = String(dexData.chainId || "ethereum").toLowerCase();
    const symbol = String(dexData.baseToken?.symbol || "UNKNOWN").toUpperCase();
    const name = dexData.baseToken?.name || symbol;

    // 4. Query Holder Concentration (30% weight)
    let holderPercentage = 0;
    let holderQueryType = "none";
    let holderDetailStr = "无数据";

    if (chain === "ethereum" || chain === "eth") {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        const ethplorerUrl = `https://api.ethplorer.io/getTopTokenHolders/${address}?limit=10&apiKey=${ethplorerKey}`;
        const ethplorerRes = await fetchJsonWithFallback(ethplorerUrl, 10000, {
          headers: { "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1" }
        });
        if (ethplorerRes && Array.isArray(ethplorerRes.holders)) {
          let sum = 0;
          ethplorerRes.holders.forEach(h => {
            sum += Number(h.share || 0);
          });
          holderPercentage = sum;
          holderQueryType = "ethplorer";
          holderDetailStr = `前10持仓: ${holderPercentage.toFixed(1)}%`;
        }
      } catch (err) {
        console.error(`Ethplorer query failed for ${address}:`, err.message);
      }
    } else if (moralisKey) {
      try {
        await new Promise(resolve => setTimeout(resolve, 300));
        const moralisChainMap = { ethereum: "eth", eth: "eth", bsc: "bsc", polygon: "polygon", arbitrum: "arbitrum" };
        const mChain = moralisChainMap[chain] || "eth";
        const ownersUrl = `https://deep-index.moralis.io/api/v2.2/erc20/${address}/owners?chain=${mChain}&order=DESC&limit=10`;
        const moralisRes = await fetchJsonWithFallback(ownersUrl, 10000, {
          headers: {
            "accept": "application/json",
            "X-API-Key": moralisKey,
            "User-Agent": "Mozilla/5.0 AssetPortfolioHub/0.1"
          }
        });
        if (moralisRes && Array.isArray(moralisRes.result)) {
          const metaUrl = `https://deep-index.moralis.io/api/v2.2/erc20/${address}/metadata?chain=${mChain}`;
          const metaRes = await fetchJsonWithFallback(metaUrl, 10000, {
            headers: { "X-API-Key": moralisKey }
          });
          const decimals = Number(metaRes?.[0]?.decimals || 18);
          const totalSupply = Number(metaRes?.[0]?.total_supply || 0) / Math.pow(10, decimals);
          if (totalSupply > 0) {
            let sumBalances = 0;
            moralisRes.result.forEach(owner => {
              sumBalances += Number(owner.balance || 0) / Math.pow(10, decimals);
            });
            holderPercentage = (sumBalances / totalSupply) * 100;
            if (holderPercentage > 100) holderPercentage = 100;
            holderQueryType = "moralis";
            holderDetailStr = `前10持仓: ${holderPercentage.toFixed(1)}%`;
          }
        }
      } catch (err) {
        console.error(`Moralis query failed for ${address}:`, err.message);
      }
    }

    // 1. Holder Concentration (30 points)
    let scoreHolders = 0;
    if (holderQueryType !== "none") {
      if (holderPercentage >= 85) {
        scoreHolders = 30;
      } else if (holderPercentage >= 60) {
        scoreHolders = Math.round(((holderPercentage - 60) / 25) * 30);
      }
    } else {
      holderDetailStr = "无 API Key 无法分析";
    }

    // 2. Volume to Market Cap Ratio (20 points)
    const vol24h = Number(dexData.volume?.h24 || 0);
    const marketCap = Number(dexData.marketCap || dexData.fdv || 1);
    const volToMc = vol24h / marketCap;
    let scoreVolToMc = 0;
    if (volToMc >= 1.0) {
      scoreVolToMc = 20;
    } else if (volToMc > 0) {
      scoreVolToMc = Math.round(volToMc * 20);
    }

    // 3. Price Acceleration (15 points)
    const change1h = Number(dexData.priceChange?.h1 || 0);
    const change6h = Number(dexData.priceChange?.h6 || 0);
    let scorePriceAccel = 0;
    if (change1h >= 15 && change6h >= 50) {
      scorePriceAccel = 15;
    } else if (change1h > 0 || change6h > 0) {
      const points1h = Math.min(7.5, (change1h / 15) * 7.5);
      const points6h = Math.min(7.5, (change6h / 50) * 7.5);
      scorePriceAccel = Math.round((points1h > 0 ? points1h : 0) + (points6h > 0 ? points6h : 0));
    }

    // 4. Liquidity Anomaly (15 points)
    const currentLiq = Number(dexData.liquidity?.usd || 0);
    const prevLiq = radarLiquidityHistory.get(address.toLowerCase());
    let scoreLiquidity = 0;
    let liquidityDetail = "无异动";
    
    if (prevLiq !== undefined && prevLiq > 0) {
      const multiplier = currentLiq / prevLiq;
      if (multiplier >= 5.0) {
        scoreLiquidity = 15;
        liquidityDetail = `流动性飙升 ${multiplier.toFixed(1)}x`;
      } else if (multiplier > 1.2) {
        scoreLiquidity = Math.round(((multiplier - 1.2) / 3.8) * 15);
        liquidityDetail = `流动性增加 ${multiplier.toFixed(1)}x`;
      } else {
        liquidityDetail = "流动性稳定";
      }
    } else {
      const liqToMc = currentLiq / marketCap;
      if (liqToMc < 0.03 && vol24h > 100000) {
        scoreLiquidity = 10;
        liquidityDetail = "极低池占比 (高波动风险)";
      } else {
        liquidityDetail = "初次扫描 (未检测到异动)";
      }
    }
    radarLiquidityHistory.set(address.toLowerCase(), currentLiq);

    // 5. Token Age (10 points)
    const pairCreatedAt = Number(dexData.pairCreatedAt || 0);
    const ageMs = Date.now() - pairCreatedAt;
    const ageDays = pairCreatedAt > 0 ? ageMs / (1000 * 60 * 60 * 24) : 999;
    let scoreAge = 0;
    if (ageDays < 30) {
      scoreAge = 10;
    } else if (ageDays < 180) {
      scoreAge = Math.round(((180 - ageDays) / 150) * 10);
    }

    // 6. CEX Listings (10 points)
    let scoreCex = 0;
    let cexListingDetail = "未上线";
    const isListedOnBinance = binanceTickerMap.has(`${symbol}USDT`) || binanceTickerMap.has(`${symbol}BUSD`) || binanceTickerMap.has(`${symbol}BTC`);
    if (isListedOnBinance) {
      scoreCex = 10;
      cexListingDetail = "已上线币安";
    }

    // Calculate Total Score
    const totalScore = scoreHolders + scoreVolToMc + scorePriceAccel + scoreLiquidity + scoreAge + scoreCex;
    let warningLevel = "low";
    if (totalScore >= 70) {
      warningLevel = "high";
    } else if (totalScore >= 50) {
      warningLevel = "mid";
    }

    results.push({
      address,
      name,
      symbol,
      chain,
      price: Number(dexData.priceUsd || 0),
      liquidity: currentLiq,
      volume24h: vol24h,
      marketCap,
      ageDays,
      score: totalScore,
      warningLevel,
      dexUrl: dexData.url || `https://dexscreener.com/${chain}/${address}`,
      signals: {
        holderConcentration: { score: scoreHolders, val: holderPercentage, detail: holderDetailStr },
        volToMcRatio: { score: scoreVolToMc, val: volToMc, detail: `24h量/市值比: ${volToMc.toFixed(2)}` },
        priceAcceleration: { score: scorePriceAccel, val: change1h, detail: `1h: +${change1h.toFixed(1)}%, 6h: +${change6h.toFixed(1)}%` },
        liquidityAnomaly: { score: scoreLiquidity, val: currentLiq, detail: liquidityDetail },
        tokenAge: { score: scoreAge, val: ageDays, detail: ageDays < 1 ? "部署不足 1 天" : `部署约 ${Math.round(ageDays)} 天` },
        cexListing: { score: scoreCex, val: isListedOnBinance ? 1 : 0, detail: cexListingDetail }
      }
    });
  }

  results.sort((a, b) => b.score - a.score);

  const value = {
    tokens: results,
    errors,
    updatedAt: new Date().toISOString()
  };
  radarScanCache = { at: Date.now(), value };
  return value;
}
