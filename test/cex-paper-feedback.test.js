const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPaperFeedbackSummary
} = require("../lib/cex-paper-feedback");

function closedTrade(overrides = {}) {
  return {
    id: overrides.id || `${overrides.symbol || "LABUSDT"}-${overrides.exitAt || "2026-06-22T01:00:00.000Z"}`,
    symbol: overrides.symbol || "LABUSDT",
    status: "closed",
    experimentGroup: overrides.experimentGroup || "baseline",
    experimentGroupLabel: overrides.experimentGroupLabel || "保守止盈",
    side: overrides.side || "long",
    actionBias: overrides.actionBias || "watch-long",
    shortTermBias: overrides.shortTermBias || "bullish",
    reviewLabel: overrides.reviewLabel || "continuation",
    phase: overrides.phase || "acceleration",
    exitReason: overrides.exitReason || "trailing-stop",
    openedAt: overrides.openedAt || "2026-06-22T00:00:00.000Z",
    exitAt: overrides.exitAt || "2026-06-22T01:00:00.000Z",
    pnlUsdt: overrides.pnlUsdt ?? -8,
    riskBudgetUsdt: overrides.riskBudgetUsdt ?? 15,
    ...overrides
  };
}

test("buildPaperFeedbackSummary flags poor setup groups before capital stop", () => {
  const feedback = buildPaperFeedbackSummary([
    closedTrade({ id: "baseline-1", pnlUsdt: -10, exitAt: "2026-06-22T01:00:00.000Z" }),
    closedTrade({ id: "baseline-2", pnlUsdt: -5, exitAt: "2026-06-22T02:00:00.000Z" }),
    closedTrade({ id: "baseline-3", pnlUsdt: -8, exitAt: "2026-06-22T03:00:00.000Z" }),
    closedTrade({
      id: "optimistic-1",
      experimentGroup: "optimistic",
      experimentGroupLabel: "乐观止盈",
      pnlUsdt: 12,
      exitReason: "take-profit",
      exitAt: "2026-06-22T01:30:00.000Z"
    }),
    closedTrade({
      id: "optimistic-2",
      experimentGroup: "optimistic",
      experimentGroupLabel: "乐观止盈",
      pnlUsdt: -6,
      exitAt: "2026-06-22T02:30:00.000Z"
    }),
    closedTrade({
      id: "optimistic-3",
      experimentGroup: "optimistic",
      experimentGroupLabel: "乐观止盈",
      pnlUsdt: 18,
      exitReason: "take-profit",
      exitAt: "2026-06-22T03:30:00.000Z"
    })
  ], {
    now: new Date("2026-06-22T04:00:00.000Z")
  });

  assert.equal(feedback.closedCount, 6);
  assert.equal(feedback.setupCount, 2);

  const weak = feedback.setups.find((setup) => setup.experimentGroup === "baseline");
  assert.equal(weak.actionSetup, "watch-long");
  assert.equal(weak.side, "long");
  assert.equal(weak.reviewLabel, "continuation");
  assert.equal(weak.phase, "acceleration");
  assert.equal(weak.sampleSize, 3);
  assert.equal(weak.winRatePct, 0);
  assert.equal(weak.totalPnlUsdt, -23);
  assert.equal(weak.averagePnlUsdt, -7.67);
  assert.equal(weak.maxLossStreak, 3);
  assert.equal(weak.needsReview, true);
  assert.deepEqual(weak.reviewReasons, ["negative-total-pnl", "low-win-rate", "loss-streak", "poor-risk-realization"]);
  assert.deepEqual(feedback.needsReview.map((setup) => setup.key), [weak.key]);

  const optimistic = feedback.setups.find((setup) => setup.experimentGroup === "optimistic");
  assert.equal(optimistic.sampleSize, 3);
  assert.equal(optimistic.winRatePct, 66.67);
  assert.equal(optimistic.totalPnlUsdt, 24);
  assert.equal(optimistic.needsReview, false);
});
