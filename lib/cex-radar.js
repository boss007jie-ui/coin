const DEFAULT_MIN_QUOTE_VOLUME = 5_000_000;
const { buildCexSignalReview } = require("./cex-signal-review");

function toFiniteNumber(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNonNegativeInteger(value) {
  const number = toFiniteNumber(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function hasQualifyingScore(value, threshold) {
  return typeof value === "number" && Number.isFinite(value) && value >= threshold;
}

function baseAssetFromUsdtSymbol(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  return normalized.endsWith("USDT") ? normalized.slice(0, -4) : "";
}

function buildSpotSymbolSet(input) {
  if (input instanceof Map) {
    return new Set([...input.keys()].map((symbol) => String(symbol).toUpperCase()));
  }
  if (input instanceof Set) {
    return new Set([...input].map((symbol) => String(symbol).toUpperCase()));
  }
  if (Array.isArray(input)) {
    return new Set(input.map((row) => String(row.symbol || row).toUpperCase()).filter(Boolean));
  }
  return new Set();
}

function normalizeFuturesTicker(row) {
  const symbol = String(row?.symbol || "").toUpperCase();
  const baseAsset = baseAssetFromUsdtSymbol(symbol);
  const lastPrice = toFiniteNumber(row?.lastPrice);
  const priceChange24h = toFiniteNumber(row?.priceChangePercent);
  const high24h = toFiniteNumber(row?.highPrice);
  const low24h = toFiniteNumber(row?.lowPrice);
  const quoteVolume24h = toFiniteNumber(row?.quoteVolume);
  const highLowRangePct = Number.isFinite(high24h) && Number.isFinite(low24h) && low24h > 0
    ? ((high24h - low24h) / low24h) * 100
    : null;
  const pullbackFromHighPct = Number.isFinite(high24h) && Number.isFinite(lastPrice) && high24h > 0
    ? ((high24h - lastPrice) / high24h) * 100
    : null;

  return {
    symbol,
    baseAsset,
    lastPrice,
    priceChange24h,
    high24h,
    low24h,
    quoteVolume24h,
    highLowRangePct,
    pullbackFromHighPct
  };
}

function filterNoSpotFutures(futuresRows, spotSymbols, options = {}) {
  const minQuoteVolume = toFiniteNumber(options.minQuoteVolume) ?? DEFAULT_MIN_QUOTE_VOLUME;
  const spotSet = buildSpotSymbolSet(spotSymbols);

  return (Array.isArray(futuresRows) ? futuresRows : [])
    .map(normalizeFuturesTicker)
    .filter((row) => row.symbol.endsWith("USDT"))
    .filter((row) => row.baseAsset && !row.symbol.includes("_"))
    .filter((row) => !spotSet.has(row.symbol))
    .filter((row) => (row.quoteVolume24h || 0) >= minQuoteVolume)
    .map((row) => ({ ...row, hasBinanceSpot: false }));
}

function fastRankScore(row) {
  const volumeScore = Math.log10(Math.max(row.quoteVolume24h || 1, 1));
  const moveScore = Math.abs(row.priceChange24h || 0) / 5;
  const rangeScore = (row.highLowRangePct || 0) / 8;
  return volumeScore + moveScore + rangeScore;
}

function rankFastCandidates(candidates, limit = 50) {
  return [...(Array.isArray(candidates) ? candidates : [])]
    .sort((a, b) => fastRankScore(b) - fastRankScore(a))
    .slice(0, limit);
}

function normalizeConstituent(row) {
  return {
    exchange: String(row?.exchange || "").toLowerCase(),
    symbol: String(row?.symbol || "").toUpperCase(),
    price: toFiniteNumber(row?.price),
    weight: toFiniteNumber(row?.weight)
  };
}

function calculatePriceDiffPct(price, referencePrice) {
  if (!Number.isFinite(price) || !Number.isFinite(referencePrice) || referencePrice <= 0) {
    return null;
  }
  return Math.abs((price - referencePrice) / referencePrice) * 100;
}

function splitConstituentsBySymbolMatch(constituents, referencePrice, tolerancePct = 8) {
  const matched = [];
  const mismatched = [];
  const unvalidated = [];
  const normalized = (Array.isArray(constituents) ? constituents : [])
    .map(normalizeConstituent)
    .filter((row) => Number.isFinite(row.price) && row.price > 0);

  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return { matched, mismatched, unvalidated: normalized };
  }

  for (const row of normalized) {
    const priceDiffPct = calculatePriceDiffPct(row.price, referencePrice);
    const enriched = { ...row, priceDiffPct };
    if (Number.isFinite(priceDiffPct) && priceDiffPct > tolerancePct) {
      mismatched.push(enriched);
    } else {
      matched.push(enriched);
    }
  }

  return { matched, mismatched, unvalidated };
}

function calculateAnchorDispersionPct(constituents, referencePrice = null) {
  const prices = (Array.isArray(constituents) ? constituents : [])
    .map((row) => toFiniteNumber(row?.price))
    .filter((price) => Number.isFinite(price) && price > 0);

  if (prices.length < 2) {
    return 0;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const denominator = Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : min;
  return ((max - min) / denominator) * 100;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function addUnique(list, item) {
  if (item && !list.includes(item)) {
    list.push(item);
  }
}

function getPullbackFromHighPct(candidate) {
  if (Number.isFinite(candidate?.pullbackFromHighPct)) {
    return candidate.pullbackFromHighPct;
  }
  const high = toFiniteNumber(candidate?.high24h);
  const last = toFiniteNumber(candidate?.lastPrice);
  if (!Number.isFinite(high) || !Number.isFinite(last) || high <= 0) {
    return null;
  }
  return ((high - last) / high) * 100;
}

function getHighLowRangePct(candidate) {
  if (Number.isFinite(candidate?.highLowRangePct)) {
    return candidate.highLowRangePct;
  }
  const high = toFiniteNumber(candidate?.high24h);
  const low = toFiniteNumber(candidate?.low24h);
  if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) {
    return null;
  }
  return ((high - low) / low) * 100;
}

function hasValidExternalAnchor(candidate) {
  return (candidate.indexConstituents || []).some((row) => {
    const exchange = String(row.exchange || "").toLowerCase();
    const price = toFiniteNumber(row.price);
    return exchange && exchange !== "binance_future" && Number.isFinite(price) && price > 0;
  });
}

function scoreCexCandidate(candidate) {
  const tags = [];
  const warnings = [];
  const quoteVolume = toFiniteNumber(candidate?.quoteVolume24h) || 0;
  const priceChange = Math.abs(toFiniteNumber(candidate?.priceChange24h) || 0);
  const rangePct = getHighLowRangePct(candidate);
  const pullbackPct = getPullbackFromHighPct(candidate);
  const anchorDispersionPct = toFiniteNumber(candidate?.anchorDispersionPct);
  const futuresToAnchorVolumeRatio = toFiniteNumber(candidate?.futuresToAnchorVolumeRatio);
  const markIndexPremiumPct = Math.abs(toFiniteNumber(candidate?.markIndexPremiumPct) || 0);
  const fundingRate = toFiniteNumber(candidate?.fundingRate);
  const fundingAbs = Math.abs(fundingRate || 0);
  const adlRisk = String(candidate?.adlRisk || "").toUpperCase();
  const mismatches = Array.isArray(candidate?.sameSymbolMismatches) ? candidate.sameSymbolMismatches : [];
  const validExternalAnchor = hasValidExternalAnchor(candidate);

  let attentionScore = 0;
  let riskScore = 0;

  if (candidate?.hasBinanceSpot === false) {
    attentionScore += 20;
    addUnique(tags, "无币安现货");
  }

  if (quoteVolume >= 100_000_000) {
    attentionScore += 20;
    addUnique(tags, "合约放量");
  } else if (quoteVolume >= 20_000_000) {
    attentionScore += 14;
    addUnique(tags, "合约放量");
  } else if (quoteVolume >= 5_000_000) {
    attentionScore += 8;
  }

  if (priceChange >= 20) attentionScore += 15;
  else if (priceChange >= 10) attentionScore += 10;
  else if (priceChange >= 5) attentionScore += 5;

  if (Number.isFinite(rangePct) && rangePct >= 30) riskScore += 15;
  if (Number.isFinite(rangePct) && rangePct >= 30) attentionScore += 15;
  else if (Number.isFinite(rangePct) && rangePct >= 15) {
    attentionScore += 10;
    riskScore += 8;
  }

  if (validExternalAnchor) {
    attentionScore += 15;
  }

  if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct < 1) {
    if (validExternalAnchor) {
      attentionScore += 10;
      addUnique(tags, "外部锚同步");
    }
  } else if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct < 3) {
    if (validExternalAnchor) {
      attentionScore += 5;
      addUnique(tags, "外部锚同步");
    }
  } else if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) {
    riskScore += 15;
    addUnique(tags, "锚价分歧");
  }

  if (Number.isFinite(futuresToAnchorVolumeRatio) && futuresToAnchorVolumeRatio >= 15) {
    attentionScore += 15;
    riskScore += 15;
    addUnique(tags, "合约量主导");
  } else if (Number.isFinite(futuresToAnchorVolumeRatio) && futuresToAnchorVolumeRatio >= 8) {
    attentionScore += 10;
    riskScore += 10;
    addUnique(tags, "合约量主导");
  } else if (Number.isFinite(futuresToAnchorVolumeRatio) && futuresToAnchorVolumeRatio >= 3) {
    attentionScore += 5;
  }

  if (Number.isFinite(pullbackPct) && pullbackPct <= 5) {
    attentionScore += 10;
    addUnique(tags, "接近新高");
  } else if (Number.isFinite(pullbackPct) && pullbackPct <= 12) {
    attentionScore += 5;
  }

  if (Number.isFinite(pullbackPct) && pullbackPct >= 15) {
    riskScore += 20;
    addUnique(tags, "冲高回落");
  } else if (Number.isFinite(pullbackPct) && pullbackPct >= 8) {
    riskScore += 12;
    addUnique(tags, "冲高回落");
  }

  if (adlRisk === "HIGH") {
    riskScore += 20;
    addUnique(tags, "ADL拥挤");
  } else if (adlRisk === "MIDDLE" || adlRisk === "MEDIUM") {
    riskScore += 10;
  }

  if (markIndexPremiumPct >= 1) riskScore += 12;
  else if (markIndexPremiumPct >= 0.3) riskScore += 6;

  if (Number.isFinite(fundingRate) && fundingAbs >= 0.001) {
    riskScore += 12;
    addUnique(tags, "Funding异常");
  } else if (Number.isFinite(fundingRate) && fundingAbs >= 0.0003) {
    riskScore += 6;
    addUnique(tags, "Funding异常");
  } else if (Number.isFinite(fundingRate)) {
    addUnique(tags, "Funding正常");
  }

  if (mismatches.length > 0) {
    riskScore += 25;
    addUnique(tags, "同名币风险");
    addUnique(tags, "锚价分歧");
    for (const mismatch of mismatches) {
      const exchange = String(mismatch.exchange || "unknown");
      const displayExchange = exchange.charAt(0).toUpperCase() + exchange.slice(1);
      if (mismatch.unvalidated === true) {
        warnings.push(`${displayExchange} ${mismatch.symbol || ""} 无法验证参考价`);
        continue;
      }
      const diff = Number.isFinite(mismatch.priceDiffPct) ? mismatch.priceDiffPct.toFixed(1) : "unknown";
      warnings.push(`${displayExchange} ${mismatch.symbol || ""} 与参考价偏离 ${diff}%`);
    }
  }

  const confidence = validExternalAnchor
    ? (Number.isFinite(futuresToAnchorVolumeRatio) ? "high" : "medium")
    : "low";

  return {
    attentionScore: clampScore(attentionScore),
    riskScore: clampScore(riskScore),
    tags,
    warnings,
    confidence
  };
}

function classifyCexPhase(candidate, scores) {
  const pullbackPct = getPullbackFromHighPct(candidate);
  const anchorDispersionPct = toFiniteNumber(candidate?.anchorDispersionPct);
  const markIndexPremiumPct = Math.abs(toFiniteNumber(candidate?.markIndexPremiumPct) || 0);
  const hasMismatch = Array.isArray(candidate?.sameSymbolMismatches) && candidate.sameSymbolMismatches.length > 0;

  if (hasMismatch) {
    return "same-symbol-risk";
  }

  if (
    scores.riskScore >= 70 &&
    Number.isFinite(pullbackPct) &&
    pullbackPct >= 8 &&
    ((Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) || markIndexPremiumPct >= 0.3)
  ) {
    return "failed-breakout-risk";
  }

  if (Number.isFinite(pullbackPct) && pullbackPct >= 8) {
    return "pullback-watch";
  }

  if (scores.attentionScore >= 70 && scores.riskScore >= 60) {
    return "high-risk-extension";
  }

  if (scores.attentionScore >= 70 && (!Number.isFinite(pullbackPct) || pullbackPct <= 5)) {
    return "acceleration";
  }

  return "candidate";
}

function hasSameSymbolRisk(candidate) {
  return Array.isArray(candidate?.sameSymbolMismatches) && candidate.sameSymbolMismatches.length > 0;
}

function hasUnvalidatedAnchor(candidate) {
  return (Array.isArray(candidate?.sameSymbolMismatches) ? candidate.sameSymbolMismatches : [])
    .some((row) => row?.unvalidated === true);
}

function signedRangeLabel(lower, upper) {
  const format = (value) => `${value > 0 ? "+" : ""}${value}%`;
  return `${format(lower)} ~ ${format(upper)}`;
}

function deriveCexExpectation(candidate, scores, phase) {
  const pullbackPct = getPullbackFromHighPct(candidate);
  const adlRisk = String(candidate?.adlRisk || "").toUpperCase();
  const fundingRate = toFiniteNumber(candidate?.fundingRate);
  const fundingAbs = Math.abs(fundingRate || 0);
  const anchorDispersionPct = toFiniteNumber(candidate?.anchorDispersionPct);
  const markIndexPremiumPct = Math.abs(toFiniteNumber(candidate?.markIndexPremiumPct) || 0);
  const validExternalAnchor = hasValidExternalAnchor(candidate);
  const sameSymbolRisk = hasSameSymbolRisk(candidate) || hasUnvalidatedAnchor(candidate);
  const reasons = [];

  if (sameSymbolRisk || !validExternalAnchor) {
    addUnique(reasons, sameSymbolRisk ? "同名币或锚价风险" : "缺少可验证外部锚");
    return {
      shortTermBias: "volatile-unclear",
      expectedMovePctRange: { lower: -20, upper: 20, label: signedRangeLabel(-20, 20) },
      expectationConfidence: "low",
      expectationReasons: reasons
    };
  }

  const riskBroken = scores.riskScore >= 70 &&
    (
      (Number.isFinite(pullbackPct) && pullbackPct >= 12) ||
      adlRisk === "HIGH" ||
      fundingAbs >= 0.001 ||
      markIndexPremiumPct >= 0.3 ||
      (Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) ||
      phase === "failed-breakout-risk"
    );

  if (riskBroken) {
    addUnique(reasons, "冲高回落风险");
    if (adlRisk === "HIGH") addUnique(reasons, "ADL拥挤");
    if (fundingAbs >= 0.001) addUnique(reasons, "Funding异常");
    if (markIndexPremiumPct >= 0.3) addUnique(reasons, "合约溢价扩大");
    if (Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) addUnique(reasons, "锚价分歧");
    return {
      shortTermBias: "bearish",
      expectedMovePctRange: { lower: -25, upper: -10, label: signedRangeLabel(-25, -10) },
      expectationConfidence: scores.confidence === "high" ? "medium" : "low",
      expectationReasons: reasons
    };
  }

  if (scores.attentionScore >= 70 && scores.riskScore < 70) {
    addUnique(reasons, "高关注且风险未失控");
    if (validExternalAnchor) addUnique(reasons, "外部锚同步");
    if (Number.isFinite(candidate?.futuresToAnchorVolumeRatio) && candidate.futuresToAnchorVolumeRatio >= 8) {
      addUnique(reasons, "合约量主导");
    }
    return {
      shortTermBias: "bullish",
      expectedMovePctRange: { lower: 8, upper: 18, label: signedRangeLabel(8, 18) },
      expectationConfidence: scores.confidence === "high" ? "high" : "medium",
      expectationReasons: reasons
    };
  }

  addUnique(reasons, "多空信号未形成一致");
  return {
    shortTermBias: "volatile-unclear",
    expectedMovePctRange: { lower: -15, upper: 15, label: signedRangeLabel(-15, 15) },
    expectationConfidence: scores.confidence === "high" ? "medium" : "low",
    expectationReasons: reasons
  };
}

function deriveCexAction(candidate, scores, phase, expectation) {
  const pullbackPct = getPullbackFromHighPct(candidate);
  const adlRisk = String(candidate?.adlRisk || "").toUpperCase();
  const reasons = [];
  const sameSymbolRisk = hasSameSymbolRisk(candidate) || hasUnvalidatedAnchor(candidate);

  if (sameSymbolRisk || expectation.expectationConfidence === "low") {
    addUnique(reasons, sameSymbolRisk ? "同名币或锚价无法验证" : "关键数据不足");
    return {
      actionBias: "avoid",
      actionSetup: sameSymbolRisk ? "same-symbol-avoid" : "insufficient-data",
      invalidLevel: "锚价无法验证，暂不设失效位",
      actionReasons: reasons
    };
  }

  if (expectation.shortTermBias === "bearish") {
    addUnique(reasons, "冲高回落风险");
    if (adlRisk === "HIGH") addUnique(reasons, "ADL拥挤");
    return {
      actionBias: "watch-short",
      actionSetup: "blowoff-fade",
      invalidLevel: "重新站上 24h 高点后失效",
      actionReasons: reasons
    };
  }

  if (expectation.shortTermBias === "bullish" && scores.riskScore < 60) {
    addUnique(reasons, "高关注且风险未失控");
    addUnique(reasons, "外部锚同步");
    return {
      actionBias: "watch-long",
      actionSetup: Number.isFinite(pullbackPct) && pullbackPct <= 5
        ? "breakout-continuation"
        : "pullback-confirmation",
      invalidLevel: "跌破 24h 低点后失效",
      actionReasons: reasons
    };
  }

  addUnique(reasons, "关注度高但风险同步升高");
  return {
    actionBias: "watch-only",
    actionSetup: "insufficient-data",
    invalidLevel: null,
    actionReasons: reasons
  };
}

function assembleCexToken(candidate) {
  const scores = scoreCexCandidate(candidate);
  const phase = classifyCexPhase(candidate, scores);
  const expectation = deriveCexExpectation(candidate, scores, phase);
  const action = deriveCexAction(candidate, scores, phase, expectation);
  const hasBinanceSpot = candidate.hasBinanceSpot === true
    ? true
    : candidate.hasBinanceSpot === false ? false : null;

  const token = {
    symbol: candidate.symbol,
    baseAsset: candidate.baseAsset,
    lastPrice: toFiniteNumber(candidate.lastPrice),
    priceChange24h: toFiniteNumber(candidate.priceChange24h),
    high24h: toFiniteNumber(candidate.high24h),
    low24h: toFiniteNumber(candidate.low24h),
    quoteVolume24h: toFiniteNumber(candidate.quoteVolume24h),
    hasBinanceSpot,
    indexConstituents: Array.isArray(candidate.indexConstituents) ? candidate.indexConstituents : [],
    anchorDispersionPct: toFiniteNumber(candidate.anchorDispersionPct),
    futuresToAnchorVolumeRatio: toFiniteNumber(candidate.futuresToAnchorVolumeRatio),
    markIndexPremiumPct: toFiniteNumber(candidate.markIndexPremiumPct),
    fundingRate: toFiniteNumber(candidate.fundingRate),
    openInterest: toFiniteNumber(candidate.openInterest),
    adlRisk: candidate.adlRisk || null,
    attentionScore: scores.attentionScore,
    riskScore: scores.riskScore,
    phase,
    tags: scores.tags,
    warnings: scores.warnings,
    confidence: scores.confidence,
    shortTermBias: expectation.shortTermBias,
    expectedMovePctRange: expectation.expectedMovePctRange,
    expectationConfidence: expectation.expectationConfidence,
    expectationReasons: expectation.expectationReasons,
    actionBias: action.actionBias,
    actionSetup: action.actionSetup,
    invalidLevel: action.invalidLevel,
    actionReasons: action.actionReasons
  };

  return {
    ...token,
    signalReview: buildCexSignalReview(token)
  };
}

function buildCexScanSummary({ scannedFutures, withoutBinanceSpot, deepInspected, tokens }) {
  const safeTokens = Array.isArray(tokens) ? tokens : [];
  return {
    scannedFutures: toNonNegativeInteger(scannedFutures),
    withoutBinanceSpot: toNonNegativeInteger(withoutBinanceSpot),
    deepInspected: toNonNegativeInteger(deepInspected),
    attentionCount: safeTokens.filter((token) => hasQualifyingScore(token.attentionScore, 70)).length,
    riskCount: safeTokens.filter((token) => hasQualifyingScore(token.riskScore, 50)).length
  };
}

module.exports = {
  assembleCexToken,
  buildCexScanSummary,
  buildSpotSymbolSet,
  calculateAnchorDispersionPct,
  classifyCexPhase,
  deriveCexAction,
  deriveCexExpectation,
  filterNoSpotFutures,
  normalizeConstituent,
  normalizeFuturesTicker,
  rankFastCandidates,
  scoreCexCandidate,
  splitConstituentsBySymbolMatch,
  toFiniteNumber
};
