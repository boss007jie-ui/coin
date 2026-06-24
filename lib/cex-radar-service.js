const {
  assembleCexToken,
  buildCexScanSummary,
  buildSpotSymbolSet,
  calculateAnchorDispersionPct,
  filterNoSpotFutures,
  normalizeConstituent,
  rankFastCandidates,
  splitConstituentsBySymbolMatch,
  toFiniteNumber
} = require("./cex-radar");

const BINANCE_FAPI_BASE = "https://fapi.binance.com";
const GATE_API_BASE = "https://api.gateio.ws";
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_DEEP_INSPECT_LIMIT = 50;
const USER_AGENT = "Mozilla/5.0 AssetPortfolioHub/0.1";

function cexRadarServiceError(message, statusCode, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function normalizeDeepInspectLimit(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_DEEP_INSPECT_LIMIT;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULT_DEEP_INSPECT_LIMIT;
  }
  if (number < 0) {
    return 0;
  }
  if (number > DEFAULT_DEEP_INSPECT_LIMIT) {
    return DEFAULT_DEEP_INSPECT_LIMIT;
  }
  return Math.floor(number);
}

function buildCacheKey({ deepInspectLimit }) {
  return `deepInspectLimit:${deepInspectLimit}`;
}

function cloneScanValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeGateCurrencyPair(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase().replace(/[/-]/g, "_");
  const compact = normalized.replace(/_/g, "");
  if (compact.endsWith("USDT") && compact.length > 4) {
    return `${compact.slice(0, -4)}_USDT`;
  }
  return normalized;
}

function createCexRadarScanner({
  fetchJson,
  getSpotTickerMap,
  now = () => new Date(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS
}) {
  if (typeof fetchJson !== "function") {
    throw new TypeError("fetchJson dependency is required");
  }
  if (typeof getSpotTickerMap !== "function") {
    throw new TypeError("getSpotTickerMap dependency is required");
  }

  const cache = new Map();

  async function scan(options = {}) {
    const force = options.force === true;
    const deepInspectLimit = normalizeDeepInspectLimit(options.deepInspectLimit);
    const cacheKey = buildCacheKey({ deepInspectLimit });
    const currentTime = now();
    const currentMs = currentTime.getTime();

    const cached = cache.get(cacheKey);
    if (!force && cached && currentMs - cached.at < cacheTtlMs) {
      return { ...cloneScanValue(cached.value), cached: true };
    }

    const errors = [];
    let futuresRows;
    let spotTickerMap;
    try {
      futuresRows = await fetchJson(`${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`, 20_000, {
        headers: { "User-Agent": USER_AGENT }
      });
      if (!Array.isArray(futuresRows)) {
        throw new Error(formatUnexpectedResponse(futuresRows));
      }
    } catch (error) {
      throw cexRadarServiceError("Binance futures ticker scan failed", 502, {
        source: "binance-futures",
        endpoint: "/fapi/v1/ticker/24hr",
        cause: error.message
      });
    }

    try {
      spotTickerMap = await getSpotTickerMap();
    } catch (error) {
      throw cexRadarServiceError("Binance spot ticker scan failed", 502, {
        source: "binance-spot",
        cause: error.message
      });
    }
    const spotSymbols = buildSpotSymbolSet(spotTickerMap);
    const fastCandidates = filterNoSpotFutures(futuresRows, spotSymbols, { minQuoteVolume: 5_000_000 });
    const rankedCandidates = rankFastCandidates(fastCandidates, deepInspectLimit);

    const tokens = [];
    for (const candidate of rankedCandidates) {
      tokens.push(await inspectCandidate(candidate, errors));
    }

    tokens.sort((a, b) => {
      return (
        (b.attentionScore - a.attentionScore) ||
        (b.riskScore - a.riskScore) ||
        ((b.quoteVolume24h || 0) - (a.quoteVolume24h || 0))
      );
    });

    const value = {
      updatedAt: currentTime.toISOString(),
      cached: false,
      summary: buildCexScanSummary({
        scannedFutures: Array.isArray(futuresRows) ? futuresRows.length : 0,
        withoutBinanceSpot: fastCandidates.length,
        deepInspected: rankedCandidates.length,
        tokens
      }),
      tokens,
      errors
    };

    cache.set(cacheKey, { at: currentMs, value: cloneScanValue(value) });
    return value;
  }

  async function inspectCandidate(candidate, errors) {
    const [
      constituentResult,
      premiumResult,
      openInterestResult,
      adlRiskResult
    ] = await Promise.all([
      fetchIndexConstituents(candidate.symbol, errors),
      fetchPremiumIndex(candidate.symbol, errors),
      fetchOpenInterest(candidate.symbol, errors),
      fetchAdlRisk(candidate.symbol, errors)
    ]);

    const referencePrice = premiumResult.indexPrice || candidate.lastPrice;
    const split = splitConstituentsBySymbolMatch(constituentResult.constituents, referencePrice, 8);
    const anchorDispersionPct = calculateAnchorDispersionPct(
      constituentResult.constituents,
      referencePrice
    );
    const gateVolume = await fetchGateAnchorVolume(split.matched, errors);
    const futuresToAnchorVolumeRatio = gateVolume > 0 && candidate.quoteVolume24h
      ? candidate.quoteVolume24h / gateVolume
      : null;

    return assembleCexToken({
      ...candidate,
      indexConstituents: constituentResult.constituents,
      anchorDispersionPct,
      futuresToAnchorVolumeRatio,
      markIndexPremiumPct: premiumResult.markIndexPremiumPct,
      fundingRate: premiumResult.fundingRate,
      openInterest: openInterestResult.openInterest,
      adlRisk: adlRiskResult.adlRisk,
      sameSymbolMismatches: [
        ...split.mismatched,
        ...split.unvalidated.map((row) => ({ ...row, unvalidated: true }))
      ]
    });
  }

  async function fetchIndexConstituents(symbol, errors) {
    try {
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/constituents?symbol=${encodeURIComponent(symbol)}`;
      const json = await fetchJson(url, 12_000, {
        headers: { "User-Agent": USER_AGENT }
      });
      const rows = Array.isArray(json?.constituents) ? json.constituents : [];
      return { constituents: rows.map(normalizeConstituent) };
    } catch (error) {
      errors.push(`Index constituents ${symbol}: ${error.message}`);
      return { constituents: [] };
    }
  }

  async function fetchPremiumIndex(symbol, errors) {
    try {
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
      const json = await fetchJson(url, 10_000, {
        headers: { "User-Agent": USER_AGENT }
      });
      const markPrice = toFiniteNumber(json?.markPrice);
      const indexPrice = toFiniteNumber(json?.indexPrice);
      const markIndexPremiumPct = Number.isFinite(markPrice) &&
        Number.isFinite(indexPrice) &&
        indexPrice > 0
        ? ((markPrice - indexPrice) / indexPrice) * 100
        : null;

      return {
        markPrice,
        indexPrice,
        markIndexPremiumPct,
        fundingRate: toFiniteNumber(json?.lastFundingRate)
      };
    } catch (error) {
      errors.push(`Premium index ${symbol}: ${error.message}`);
      return {
        markPrice: null,
        indexPrice: null,
        markIndexPremiumPct: null,
        fundingRate: null
      };
    }
  }

  async function fetchOpenInterest(symbol, errors) {
    try {
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`;
      const json = await fetchJson(url, 10_000, {
        headers: { "User-Agent": USER_AGENT }
      });
      return { openInterest: toFiniteNumber(json?.openInterest) };
    } catch (error) {
      errors.push(`Open interest ${symbol}: ${error.message}`);
      return { openInterest: null };
    }
  }

  async function fetchAdlRisk(symbol, errors) {
    try {
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/symbolAdlRisk?symbol=${encodeURIComponent(symbol)}`;
      const json = await fetchJson(url, 10_000, {
        headers: { "User-Agent": USER_AGENT }
      });
      const normalizedSymbol = String(symbol || "").toUpperCase();
      const row = Array.isArray(json)
        ? json.find((item) => String(item.symbol || "").toUpperCase() === normalizedSymbol)
        : json;
      const adlRisk = String(row?.adlRisk || "").toUpperCase();
      return { adlRisk: adlRisk || null };
    } catch (error) {
      errors.push(`ADL risk ${symbol}: ${error.message}`);
      return { adlRisk: null };
    }
  }

  async function fetchGateAnchorVolume(constituents, errors) {
    const gateRows = (Array.isArray(constituents) ? constituents : [])
      .filter((row) => String(row.exchange || "").toLowerCase() === "gateio");
    let quoteVolume = 0;

    for (const row of gateRows) {
      try {
        const pair = normalizeGateCurrencyPair(row.symbol);
        const url = `${GATE_API_BASE}/api/v4/spot/tickers?currency_pair=${encodeURIComponent(pair)}`;
        const json = await fetchJson(url, 10_000, {
          headers: { "User-Agent": USER_AGENT }
        });
        const ticker = Array.isArray(json) ? json[0] : json;
        const rowVolume = toFiniteNumber(ticker?.quote_volume);
        if (Number.isFinite(rowVolume) && rowVolume > 0) {
          quoteVolume += rowVolume;
        }
      } catch (error) {
        errors.push(`Gate ticker ${row.symbol}: ${error.message}`);
      }
    }

    return quoteVolume;
  }

  return { scan };
}

function formatUnexpectedResponse(value) {
  if (value && typeof value === "object") {
    const message = value.msg || value.message || value.error;
    if (message) {
      return `Unexpected Binance futures response: ${message}`;
    }
  }
  return "Unexpected Binance futures response";
}

module.exports = {
  createCexRadarScanner
};
