const FUTURES_KLINE_PROVIDERS = {
  binance: {
    id: "binance",
    label: "Binance USD-M Futures",
    baseUrl: "https://fapi.binance.com",
    klinesPath: "/fapi/v1/klines"
  },
  aster: {
    id: "aster",
    label: "Aster Perpetuals",
    baseUrl: "https://fapi.asterdex.com",
    klinesPath: "/fapi/v1/klines"
  }
};

function createFuturesKlineFetcher({
  provider = "binance",
  fetchJson,
  timeoutMs = 15_000,
  userAgent = "Mozilla/5.0 AssetPortfolioHub/0.1"
} = {}) {
  if (typeof fetchJson !== "function") {
    throw new TypeError("fetchJson dependency is required");
  }

  const resolvedProvider = resolveFuturesKlineProvider(provider);

  return async function fetchFuturesKlines(symbol, options = {}) {
    const normalizedSymbol = String(symbol || "").trim().toUpperCase();
    if (!normalizedSymbol) return [];

    const url = buildFuturesKlineUrl(resolvedProvider, normalizedSymbol, options);
    const rows = await fetchJson(url, timeoutMs, {
      headers: { "User-Agent": userAgent }
    });

    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeFuturesKlineRow).filter(Boolean);
  };
}

function resolveFuturesKlineProvider(provider) {
  const key = String(provider || "binance").trim().toLowerCase();
  const config = FUTURES_KLINE_PROVIDERS[key];
  if (!config) {
    const error = new Error(`Unsupported futures kline provider: ${provider}`);
    error.code = "UNSUPPORTED_FUTURES_KLINE_PROVIDER";
    error.details = {
      provider,
      supportedProviders: Object.keys(FUTURES_KLINE_PROVIDERS)
    };
    throw error;
  }
  return { ...config };
}

function buildFuturesKlineUrl(provider, symbol, options = {}) {
  const url = new URL(provider.klinesPath, provider.baseUrl);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", options.interval || "5m");
  url.searchParams.set("limit", String(options.limit || 1000));
  if (options.startTime) url.searchParams.set("startTime", String(options.startTime));
  if (options.endTime) url.searchParams.set("endTime", String(options.endTime));
  return url.toString();
}

function normalizeFuturesKlineRow(row) {
  const openTime = Number(row?.[0]);
  const high = Number(row?.[2]);
  const low = Number(row?.[3]);
  const close = Number(row?.[4]);
  if (!Number.isFinite(openTime) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return null;
  return { openTime, high, low, close };
}

module.exports = {
  FUTURES_KLINE_PROVIDERS,
  createFuturesKlineFetcher,
  resolveFuturesKlineProvider,
  buildFuturesKlineUrl,
  normalizeFuturesKlineRow
};
