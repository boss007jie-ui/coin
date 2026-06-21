const DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000;
const REVIEW_1D_MS = 24 * 60 * 60 * 1000;
const REVIEW_3D_MS = 72 * 60 * 60 * 1000;

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function shouldCaptureToken(token, pinnedSymbols = []) {
  const symbol = normalizeSymbol(token?.symbol);
  const pinnedSet = new Set((Array.isArray(pinnedSymbols) ? pinnedSymbols : []).map(normalizeSymbol));
  const attentionScore = toFiniteNumber(token?.attentionScore) || 0;
  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const actionBias = token?.actionBias || "";

  return (
    attentionScore >= 70 ||
    riskScore >= 60 ||
    actionBias === "watch-long" ||
    actionBias === "watch-short" ||
    (symbol && pinnedSet.has(symbol))
  );
}

function buildJournalEntry(token, now = new Date()) {
  const observedAt = now.toISOString();
  const signalReview = token.signalReview || {};
  return {
    id: `${normalizeSymbol(token.symbol)}-${observedAt}`,
    symbol: normalizeSymbol(token.symbol),
    observedAt,
    lastSeenAt: observedAt,
    entryPrice: toFiniteNumber(token.lastPrice),
    latestPrice: toFiniteNumber(token.lastPrice),
    actionBias: token.actionBias || null,
    shortTermBias: token.shortTermBias || null,
    expectedMovePctRange: token.expectedMovePctRange || null,
    attentionScore: toFiniteNumber(token.attentionScore),
    riskScore: toFiniteNumber(token.riskScore),
    phase: token.phase || null,
    reviewLabel: signalReview.reviewLabel || null,
    bullCase: Array.isArray(signalReview.bullCase) ? signalReview.bullCase : [],
    bearCase: Array.isArray(signalReview.bearCase) ? signalReview.bearCase : [],
    riskGate: Array.isArray(signalReview.riskGate) ? signalReview.riskGate : [],
    decisionSummary: signalReview.decisionSummary || "",
    decisionConfidence: signalReview.decisionConfidence || token.expectationConfidence || token.confidence || "low",
    review1d: null,
    review3d: null
  };
}

function upsertJournalEntries(existingEntries, tokens, options = {}) {
  const now = options.now || new Date();
  const pinnedSymbols = options.pinnedSymbols || [];
  const entries = Array.isArray(existingEntries) ? existingEntries.map((entry) => ({ ...entry })) : [];
  let capturedCount = 0;
  let updatedCount = 0;

  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (!shouldCaptureToken(token, pinnedSymbols)) continue;

    const symbol = normalizeSymbol(token.symbol);
    const duplicate = entries.find((entry) => {
      if (normalizeSymbol(entry.symbol) !== symbol) return false;
      const observedMs = Date.parse(entry.observedAt);
      return Number.isFinite(observedMs) && now.getTime() - observedMs < DEDUPE_WINDOW_MS;
    });

    if (duplicate) {
      const nextEntry = buildJournalEntry(token, now);
      duplicate.lastSeenAt = now.toISOString();
      duplicate.latestPrice = nextEntry.latestPrice;
      duplicate.attentionScore = nextEntry.attentionScore;
      duplicate.riskScore = nextEntry.riskScore;
      duplicate.phase = nextEntry.phase;
      duplicate.reviewLabel = nextEntry.reviewLabel;
      duplicate.bullCase = nextEntry.bullCase;
      duplicate.bearCase = nextEntry.bearCase;
      duplicate.riskGate = nextEntry.riskGate;
      duplicate.decisionSummary = nextEntry.decisionSummary;
      duplicate.decisionConfidence = nextEntry.decisionConfidence;
      updatedCount += 1;
      continue;
    }

    entries.push(buildJournalEntry(token, now));
    capturedCount += 1;
  }

  entries.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  return { entries, capturedCount, updatedCount };
}

function reviewJournalEntries(existingEntries, priceBySymbol, now = new Date()) {
  const entries = Array.isArray(existingEntries) ? existingEntries.map((entry) => ({ ...entry })) : [];
  let reviewedCount = 0;

  for (const entry of entries) {
    const observedMs = Date.parse(entry.observedAt);
    if (!Number.isFinite(observedMs)) continue;

    const currentPrice = toFiniteNumber(priceBySymbol.get(normalizeSymbol(entry.symbol)));
    if (!Number.isFinite(currentPrice)) continue;

    const ageMs = now.getTime() - observedMs;
    if (!entry.review1d && ageMs >= REVIEW_1D_MS) {
      entry.review1d = buildReviewResult(entry, currentPrice, now);
      reviewedCount += 1;
    }
    if (!entry.review3d && ageMs >= REVIEW_3D_MS) {
      entry.review3d = buildReviewResult(entry, currentPrice, now);
      reviewedCount += 1;
    }
  }

  return { entries, reviewedCount };
}

function buildReviewResult(entry, price, now) {
  const movePct = calculateMovePct(entry.entryPrice, price);
  const directionHit = calculateDirectionHit(entry, movePct);
  const rangeHit = calculateRangeHit(entry.expectedMovePctRange, movePct, directionHit);
  return {
    reviewedAt: now.toISOString(),
    price,
    movePct,
    directionHit,
    rangeHit,
    outcomeLabel: calculateOutcomeLabel(directionHit, rangeHit)
  };
}

function calculateMovePct(entryPrice, price) {
  const start = toFiniteNumber(entryPrice);
  const end = toFiniteNumber(price);
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) return null;
  return Number((((end - start) / start) * 100).toFixed(2));
}

function calculateDirectionHit(entry, movePct) {
  if (!Number.isFinite(movePct)) return null;
  if (entry.shortTermBias === "bullish" || entry.actionBias === "watch-long") return movePct > 0;
  if (entry.shortTermBias === "bearish" || entry.actionBias === "watch-short") return movePct < 0;
  return null;
}

function calculateRangeHit(range, movePct, directionHit) {
  if (!Number.isFinite(movePct) || !range) return null;
  const lower = toFiniteNumber(range.lower);
  const upper = toFiniteNumber(range.upper);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return null;
  if (directionHit === null) return Math.abs(movePct) <= Math.max(Math.abs(lower), Math.abs(upper));
  return movePct >= lower && movePct <= upper;
}

function calculateOutcomeLabel(directionHit, rangeHit) {
  if (directionHit === null) return "unclear";
  if (directionHit === false) return "miss";
  if (rangeHit === true) return "hit";
  return "partial";
}

module.exports = {
  buildJournalEntry,
  reviewJournalEntries,
  shouldCaptureToken,
  upsertJournalEntries
};
