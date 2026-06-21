const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildJournalEntry,
  reviewJournalEntries,
  shouldCaptureToken,
  upsertJournalEntries
} = require("../lib/cex-signal-journal");

const now = new Date("2026-06-21T08:00:00.000Z");

function token(overrides = {}) {
  return {
    symbol: "LABUSDT",
    lastPrice: 10,
    actionBias: "watch-long",
    shortTermBias: "bullish",
    expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" },
    attentionScore: 82,
    riskScore: 35,
    phase: "acceleration",
    signalReview: {
      reviewLabel: "continuation",
      bullCase: ["外部锚同步"],
      bearCase: [],
      riskGate: [],
      decisionSummary: "高关注且外部锚同步，风险未失控，适合观察延续。",
      decisionConfidence: "high"
    },
    ...overrides
  };
}

test("captures high attention, directional, and pinned tokens", () => {
  assert.equal(shouldCaptureToken(token({ attentionScore: 70, actionBias: "watch-only" }), []), true);
  assert.equal(shouldCaptureToken(token({ attentionScore: 20, riskScore: 60, actionBias: "watch-only" }), []), true);
  assert.equal(shouldCaptureToken(token({ attentionScore: 20, riskScore: 20, actionBias: "watch-short" }), []), true);
  assert.equal(shouldCaptureToken(token({ symbol: "PINUSDT", attentionScore: 1, riskScore: 1, actionBias: "watch-only" }), ["PINUSDT"]), true);
  assert.equal(shouldCaptureToken(token({ attentionScore: 1, riskScore: 1, actionBias: "watch-only" }), []), false);
});

test("builds journal entry from token review", () => {
  const entry = buildJournalEntry(token(), now);

  assert.equal(entry.id, "LABUSDT-2026-06-21T08:00:00.000Z");
  assert.equal(entry.symbol, "LABUSDT");
  assert.equal(entry.entryPrice, 10);
  assert.equal(entry.reviewLabel, "continuation");
  assert.equal(entry.decisionConfidence, "high");
  assert.deepEqual(entry.bullCase, ["外部锚同步"]);
  assert.equal(entry.review1d, null);
  assert.equal(entry.review3d, null);
});

test("suppresses duplicate entries within twelve hours", () => {
  const first = buildJournalEntry(token(), now);
  const result = upsertJournalEntries([first], [token({ lastPrice: 11, attentionScore: 90 })], {
    now: new Date("2026-06-21T14:00:00.000Z"),
    pinnedSymbols: []
  });

  assert.equal(result.capturedCount, 0);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].latestPrice, 11);
  assert.equal(result.entries[0].lastSeenAt, "2026-06-21T14:00:00.000Z");
});

test("creates a new entry after twelve hours", () => {
  const first = buildJournalEntry(token(), now);
  const result = upsertJournalEntries([first], [token({ lastPrice: 12 })], {
    now: new Date("2026-06-21T20:01:00.000Z"),
    pinnedSymbols: []
  });

  assert.equal(result.capturedCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.entries.length, 2);
});

test("reviews 1d and 3d outcomes", () => {
  const entry = buildJournalEntry(token(), now);
  const oneDay = reviewJournalEntries([entry], new Map([["LABUSDT", 11.2]]), new Date("2026-06-22T08:05:00.000Z"));

  assert.equal(oneDay.reviewedCount, 1);
  assert.equal(oneDay.entries[0].review1d.movePct, 12);
  assert.equal(oneDay.entries[0].review1d.directionHit, true);
  assert.equal(oneDay.entries[0].review1d.rangeHit, true);
  assert.equal(oneDay.entries[0].review1d.outcomeLabel, "hit");
  assert.equal(oneDay.entries[0].review3d, null);

  const threeDay = reviewJournalEntries(oneDay.entries, new Map([["LABUSDT", 8.5]]), new Date("2026-06-24T08:05:00.000Z"));

  assert.equal(threeDay.reviewedCount, 1);
  assert.equal(threeDay.entries[0].review3d.movePct, -15);
  assert.equal(threeDay.entries[0].review3d.directionHit, false);
  assert.equal(threeDay.entries[0].review3d.outcomeLabel, "miss");
});

test("leaves due review pending when current price is unavailable", () => {
  const entry = buildJournalEntry(token(), now);
  const result = reviewJournalEntries([entry], new Map(), new Date("2026-06-22T08:05:00.000Z"));

  assert.equal(result.reviewedCount, 0);
  assert.equal(result.entries[0].review1d, null);
});
