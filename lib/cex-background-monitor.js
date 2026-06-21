const {
  reviewJournalEntries,
  upsertJournalEntries
} = require("./cex-signal-journal");

const DEFAULT_INTERVAL_MINUTES = 5;
const DEFAULT_DEEP_INSPECT_LIMIT = 20;
const DEFAULT_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

function createCexBackgroundMonitor({
  scanCexRadar,
  loadJournal,
  saveJournal,
  notifier,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  intervalMinutes = DEFAULT_INTERVAL_MINUTES,
  deepInspectLimit = DEFAULT_DEEP_INSPECT_LIMIT,
  pinnedSymbols = [],
  alertCooldownMs = DEFAULT_ALERT_COOLDOWN_MS,
  logger = console
}) {
  if (typeof scanCexRadar !== "function") throw new TypeError("scanCexRadar dependency is required");
  if (typeof loadJournal !== "function") throw new TypeError("loadJournal dependency is required");
  if (typeof saveJournal !== "function") throw new TypeError("saveJournal dependency is required");

  const cooldowns = new Map();
  const errorCooldowns = new Map();
  let timer = null;
  const state = {
    running: false,
    intervalMinutes: normalizePositiveNumber(intervalMinutes, DEFAULT_INTERVAL_MINUTES),
    deepInspectLimit: normalizePositiveNumber(deepInspectLimit, DEFAULT_DEEP_INSPECT_LIMIT),
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    lastSummary: null,
    lastAlertCount: 0,
    lastFeedbackDigestAt: null,
    lastFeedbackDigestCount: 0,
    runCount: 0
  };

  function getStatus() {
    return { ...state };
  }

  function start() {
    if (state.running) return getStatus();
    state.running = true;
    scheduleNextRun(0);
    return getStatus();
  }

  function stop() {
    state.running = false;
    state.nextRunAt = null;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    return getStatus();
  }

  function scheduleNextRun(delayMs = state.intervalMinutes * 60 * 1000) {
    if (!state.running) return;
    if (timer) clearTimer(timer);
    state.nextRunAt = new Date(now().getTime() + delayMs).toISOString();
    timer = setTimer(async () => {
      await runOnce();
      scheduleNextRun();
    }, delayMs);
  }

  async function runOnce() {
    const currentTime = now();
    const nowMs = currentTime.getTime();
    state.lastRunAt = currentTime.toISOString();
    state.lastError = null;
    state.runCount += 1;

    try {
      const scan = await scanCexRadar({ force: true, deepInspectLimit: state.deepInspectLimit });
      const tokens = Array.isArray(scan.tokens) ? scan.tokens : [];
      const entries = await loadJournal();
      const captured = upsertJournalEntries(entries, tokens, {
        now: currentTime,
        pinnedSymbols
      });
      const reviewed = reviewJournalEntries(captured.entries, priceMapFromTokens(tokens), currentTime);
      const feedbackDigest = buildCexFeedbackDigest(reviewed.entries, { now: currentTime });
      let feedbackDigestCount = 0;
      if (feedbackDigest) {
        const result = await sendNotification(feedbackDigest.text);
        if (result.ok !== false) {
          markFeedbackDigestNotified(reviewed.entries, feedbackDigest.items, currentTime);
          feedbackDigestCount = feedbackDigest.items.length;
          state.lastFeedbackDigestAt = currentTime.toISOString();
        }
      }
      await saveJournal(reviewed.entries);

      const alerts = buildCexAlertMessages(tokens, {
        cooldowns,
        nowMs,
        cooldownMs: alertCooldownMs
      });
      let alertCount = 0;
      for (const alert of alerts) {
        const result = await sendNotification(alert.text);
        if (result.ok !== false) alertCount += 1;
      }

      state.lastSummary = scan.summary || null;
      state.lastAlertCount = alertCount;
      state.lastFeedbackDigestCount = feedbackDigestCount;
      return {
        ok: true,
        capturedCount: captured.capturedCount,
        updatedCount: captured.updatedCount,
        reviewedCount: reviewed.reviewedCount,
        alertCount,
        feedbackDigestCount,
        summary: state.lastSummary
      };
    } catch (error) {
      state.lastError = {
        message: error.message || "CEX background monitor failed",
        details: error.details || null,
        at: currentTime.toISOString()
      };
      state.lastAlertCount = 0;
      logger.error?.(error);
      await maybeSendErrorAlert(error, nowMs);
      return {
        ok: false,
        error: state.lastError.message,
        details: state.lastError.details
      };
    }
  }

  async function maybeSendErrorAlert(error, nowMs) {
    const key = `error:${error.details?.source || "cex-monitor"}`;
    const lastSentAt = errorCooldowns.get(key) || 0;
    if (nowMs - lastSentAt < alertCooldownMs) return;
    errorCooldowns.set(key, nowMs);
    await sendNotification(formatErrorAlert(error));
  }

  async function sendNotification(text) {
    if (!notifier || typeof notifier.sendMessage !== "function") {
      return { ok: false, skipped: true, reason: "notifier-missing" };
    }
    try {
      return await notifier.sendMessage(text);
    } catch (error) {
      logger.warn?.("CEX Telegram notification failed:", error);
      return {
        ok: false,
        error: error.message || "telegram-notification-failed",
        details: error.details || null
      };
    }
  }

  return {
    getStatus,
    runOnce,
    start,
    stop
  };
}

function buildCexAlertMessages(tokens, { cooldowns = new Map(), nowMs = Date.now(), cooldownMs = DEFAULT_ALERT_COOLDOWN_MS } = {}) {
  const alerts = [];

  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (!shouldAlertToken(token)) continue;
    const symbol = normalizeSymbol(token.symbol);
    if (!symbol) continue;

    const key = `token:${symbol}`;
    const lastSentAt = cooldowns.get(key) || 0;
    if (nowMs - lastSentAt < cooldownMs) continue;
    cooldowns.set(key, nowMs);

    alerts.push({
      key,
      symbol,
      text: formatTokenAlert(token)
    });
  }

  return alerts;
}

function buildCexFeedbackDigest(entries, { now = new Date() } = {}) {
  const localDateKey = toShanghaiDateKey(now);
  const allReviews = collectFeedbackReviews(entries);
  if (allReviews.some((item) => toShanghaiDateKey(item.review.feedbackDigestSentAt) === localDateKey)) {
    return null;
  }

  const items = allReviews.filter((item) => !item.review.feedbackDigestSentAt);
  if (!items.length) return null;

  const oneDayItems = items.filter((item) => item.reviewKey === "review1d");
  const threeDayItems = items.filter((item) => item.reviewKey === "review3d");
  const examples = [
    ...items.filter((item) => item.review.outcomeLabel === "hit").slice(0, 2),
    ...items.filter((item) => item.review.outcomeLabel === "partial").slice(0, 2),
    ...items.filter((item) => item.review.outcomeLabel === "miss").slice(0, 2)
  ].slice(0, 6);

  const text = [
    "[CEX 雷达] 预测反馈日报",
    `复盘日期: ${localDateKey}`,
    `新增复盘: ${items.length} 条`,
    formatFeedbackGroup("1天", oneDayItems),
    formatFeedbackGroup("3天", threeDayItems),
    "样例:",
    ...(examples.length ? examples.map(formatFeedbackExample) : ["--"])
  ].join("\n");

  return { items, text };
}

function collectFeedbackReviews(entries) {
  const items = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const reviewKey of ["review1d", "review3d"]) {
      const review = entry?.[reviewKey];
      if (!review || !review.reviewedAt) continue;
      items.push({
        entry,
        id: entry.id,
        symbol: normalizeSymbol(entry.symbol),
        reviewKey,
        horizonLabel: reviewKey === "review1d" ? "1天" : "3天",
        review
      });
    }
  }
  return items.sort((a, b) => Date.parse(a.review.reviewedAt) - Date.parse(b.review.reviewedAt));
}

function formatFeedbackGroup(label, items) {
  const stats = countFeedbackOutcomes(items);
  return `${label}: ${items.length} 条 / 命中 ${stats.hit} / 部分 ${stats.partial} / 失败 ${stats.miss} / 命中率 ${formatRate(stats.hit, items.length)}`;
}

function countFeedbackOutcomes(items) {
  return {
    hit: items.filter((item) => item.review.outcomeLabel === "hit").length,
    partial: items.filter((item) => item.review.outcomeLabel === "partial").length,
    miss: items.filter((item) => item.review.outcomeLabel === "miss").length
  };
}

function formatFeedbackExample(item) {
  const entry = item.entry;
  return [
    `${outcomeLabel(item.review.outcomeLabel)} ${item.symbol}`,
    item.horizonLabel,
    `${formatMovePct(item.review.movePct)}`,
    `预期 ${entry.expectedMovePctRange?.label || "--"}`
  ].join(" / ");
}

function markFeedbackDigestNotified(entries, items, now = new Date()) {
  const sentAt = now.toISOString();
  const entriesById = new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.id, entry]));
  for (const item of items) {
    const entry = entriesById.get(item.id);
    const review = entry?.[item.reviewKey];
    if (review) {
      review.feedbackDigestSentAt = sentAt;
    }
  }
}

function shouldAlertToken(token) {
  const attentionScore = toFiniteNumber(token?.attentionScore) || 0;
  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const actionBias = token?.actionBias || "";
  return (
    actionBias === "watch-long" ||
    actionBias === "watch-short" ||
    attentionScore >= 80 ||
    riskScore >= 70
  );
}

function formatTokenAlert(token) {
  const symbol = normalizeSymbol(token.symbol);
  const review = token.signalReview || {};
  const reasons = [
    ...(Array.isArray(token.actionReasons) ? token.actionReasons : []),
    ...(Array.isArray(token.expectationReasons) ? token.expectationReasons : [])
  ].slice(0, 4);

  return [
    `[CEX 雷达] ${symbol}`,
    `动作: ${actionLabel(token.actionBias)}`,
    `短线: ${biasLabel(token.shortTermBias)} ${token.expectedMovePctRange?.label || "--"}`,
    `关注/风险: ${scoreLabel(token.attentionScore)} / ${scoreLabel(token.riskScore)}`,
    `阶段: ${token.phase || "--"}`,
    `结论: ${review.decisionSummary || "--"}`,
    `理由: ${reasons.length ? reasons.join(" / ") : "--"}`
  ].join("\n");
}

function formatErrorAlert(error) {
  const details = error.details || {};
  const parts = [
    "[CEX 雷达] 数据源异常",
    `错误: ${error.message || "unknown"}`,
    details.source ? `来源: ${details.source}` : "",
    details.endpoint ? `接口: ${details.endpoint}` : "",
    details.cause ? `原因: ${details.cause}` : ""
  ].filter(Boolean);
  return parts.join("\n");
}

function priceMapFromTokens(tokens) {
  return new Map(
    (Array.isArray(tokens) ? tokens : [])
      .map((token) => [normalizeSymbol(token.symbol), Number(token.lastPrice)])
      .filter(([symbol, price]) => symbol && Number.isFinite(price))
  );
}

function actionLabel(value) {
  if (value === "watch-long") return "观察做多";
  if (value === "watch-short") return "观察做空";
  if (value === "watch-only") return "只观察不追";
  if (value === "avoid") return "回避";
  return "--";
}

function biasLabel(value) {
  if (value === "bullish") return "偏涨";
  if (value === "bearish") return "偏跌";
  if (value === "volatile-unclear") return "高波动不明";
  return "--";
}

function scoreLabel(value) {
  const number = toFiniteNumber(value);
  return Number.isFinite(number) ? String(Math.round(number)) : "--";
}

function outcomeLabel(value) {
  if (value === "hit") return "命中";
  if (value === "partial") return "部分";
  if (value === "miss") return "失败";
  return "不明";
}

function formatMovePct(value) {
  const number = toFiniteNumber(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatRate(count, total) {
  if (!total) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function toShanghaiDateKey(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

module.exports = {
  buildCexFeedbackDigest,
  buildCexAlertMessages,
  createCexBackgroundMonitor
};
