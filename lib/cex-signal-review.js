function addUnique(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasTag(token, tag) {
  return Array.isArray(token?.tags) && token.tags.includes(tag);
}

function buildCexSignalReview(token) {
  const bullCase = [];
  const bearCase = [];
  const riskGate = [];
  const attentionScore = toFiniteNumber(token?.attentionScore) || 0;
  const riskScore = toFiniteNumber(token?.riskScore) || 0;
  const fundingRate = toFiniteNumber(token?.fundingRate);
  const markIndexPremiumPct = Math.abs(toFiniteNumber(token?.markIndexPremiumPct) || 0);
  const anchorDispersionPct = toFiniteNumber(token?.anchorDispersionPct);
  const futuresToAnchorVolumeRatio = toFiniteNumber(token?.futuresToAnchorVolumeRatio);
  const adlRisk = String(token?.adlRisk || "").toUpperCase();
  const actionBias = token?.actionBias || "";
  const shortTermBias = token?.shortTermBias || "";
  const phase = token?.phase || "";

  if (hasTag(token, "无币安现货")) addUnique(bullCase, "无币安现货");
  if (hasTag(token, "合约放量")) addUnique(bullCase, "合约放量");
  if (hasTag(token, "外部锚同步")) addUnique(bullCase, "外部锚同步");
  if (Number.isFinite(futuresToAnchorVolumeRatio) && futuresToAnchorVolumeRatio >= 8) addUnique(bullCase, "合约量主导");
  if (phase === "acceleration") addUnique(bullCase, "接近新高且风险未失控");
  if (Number.isFinite(fundingRate) && Math.abs(fundingRate) < 0.0003) addUnique(bullCase, "Funding正常");

  if (hasTag(token, "冲高回落") || phase === "failed-breakout-risk") addUnique(bearCase, "冲高回落");
  if (adlRisk === "HIGH" || hasTag(token, "ADL拥挤")) addUnique(bearCase, "ADL拥挤");
  if (hasTag(token, "Funding异常")) addUnique(bearCase, "Funding异常");
  if (markIndexPremiumPct >= 0.3) addUnique(bearCase, "合约溢价扩大");
  if ((Number.isFinite(anchorDispersionPct) && anchorDispersionPct >= 3) || hasTag(token, "锚价分歧")) addUnique(bearCase, "锚价分歧");
  if (hasTag(token, "同名币风险")) addUnique(bearCase, "同名币风险");

  if (hasTag(token, "同名币风险") || phase === "same-symbol-risk") addUnique(riskGate, "同名币或锚价无法验证");
  if ((token?.confidence || token?.expectationConfidence) === "low" && !hasTag(token, "外部锚同步")) addUnique(riskGate, "缺少可验证外部锚");
  if (attentionScore >= 70 && riskScore >= 60) addUnique(riskGate, "高关注与高风险同时出现");
  if (Array.isArray(token?.warnings) && token.warnings.length > 0) addUnique(riskGate, "存在数据或锚价警告");
  if (actionBias === "avoid") addUnique(riskGate, "动作建议为回避");
  if (actionBias === "watch-only") addUnique(riskGate, "只观察不追");

  const reviewLabel = deriveReviewLabel({ actionBias, shortTermBias, phase, riskGate });
  const decisionConfidence = deriveDecisionConfidence(token, riskGate);
  const decisionSummary = deriveDecisionSummary({ actionBias, reviewLabel, riskGate });

  return {
    bullCase,
    bearCase,
    riskGate,
    decisionSummary,
    decisionConfidence,
    reviewLabel
  };
}

function deriveReviewLabel({ actionBias, shortTermBias, phase, riskGate }) {
  if (riskGate.includes("同名币或锚价无法验证") || actionBias === "avoid") return "avoid";
  if (actionBias === "watch-short" || shortTermBias === "bearish" || phase === "failed-breakout-risk") return "fade-risk";
  if (actionBias === "watch-long" || shortTermBias === "bullish") return "continuation";
  return "wait-confirmation";
}

function deriveDecisionConfidence(token, riskGate) {
  if (riskGate.includes("同名币或锚价无法验证") || riskGate.includes("缺少可验证外部锚")) return "low";
  if (riskGate.length >= 2) return "medium";
  if (token?.expectationConfidence === "high") return "high";
  if (token?.expectationConfidence === "medium") return "medium";
  if (token?.confidence === "high") return "high";
  if (token?.confidence === "medium") return "medium";
  return "low";
}

function deriveDecisionSummary({ actionBias, reviewLabel, riskGate }) {
  if (riskGate.includes("同名币或锚价无法验证") || actionBias === "avoid") {
    return "锚价无法验证，当前信号不适合交易观察。";
  }
  if (actionBias === "watch-short" || reviewLabel === "fade-risk") {
    return "合约拥挤后冲高回落，短线更偏风险释放，适合观察做空或等待反弹失败。";
  }
  if (actionBias === "watch-long" || reviewLabel === "continuation") {
    return "高关注且外部锚同步，风险未失控，适合观察延续。";
  }
  return "多空信号未形成一致，适合继续观察等待确认。";
}

module.exports = {
  buildCexSignalReview
};
