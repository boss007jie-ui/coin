const RADAR_PIN_STORAGE_KEY = "cex-radar-pinned-symbols-v1";
const AUTO_ATTENTION_THRESHOLD = 60;
const AUTO_RISK_THRESHOLD = 60;
const HIGH_ATTENTION_THRESHOLD = 70;
const HIGH_RISK_THRESHOLD = 50;

const radarState = {
  tokens: [],
  errors: [],
  selectedSymbol: null,
  tab: "auto",
  filter: "all",
  sort: "attention-desc",
  deepLimit: 20,
  pinnedSymbols: [],
  loading: false,
  lastError: null,
  updatedAt: null
};

const radarEls = {};

document.addEventListener("DOMContentLoaded", initCexRadarPage);

function initCexRadarPage() {
  cacheRadarElements();
  loadPinnedSymbols();
  bindRadarEvents();
  renderRadarPage();
  fetchCexRadarScan(false);
}

function cacheRadarElements() {
  [
    "radarRefreshButton",
    "radarUpdatedAt",
    "radarDeepLimit",
    "radarSort",
    "radarSummaryGrid",
    "radarTableStatus",
    "radarPinForm",
    "radarManualSymbol",
    "radarError",
    "radarTokenTable",
    "radarDetailPanel",
    "radarToast"
  ].forEach((id) => {
    radarEls[id] = document.getElementById(id);
  });
  radarEls.tabs = [...document.querySelectorAll(".radar-tab")];
  radarEls.filters = [...document.querySelectorAll(".radar-filter")];
}

function bindRadarEvents() {
  radarEls.radarRefreshButton?.addEventListener("click", () => fetchCexRadarScan(true));
  radarEls.radarDeepLimit?.addEventListener("change", () => {
    radarState.deepLimit = Number(radarEls.radarDeepLimit.value || 20);
    fetchCexRadarScan(true);
  });
  radarEls.radarSort?.addEventListener("change", () => {
    radarState.sort = radarEls.radarSort.value;
    renderRadarPage();
  });
  radarEls.tabs.forEach((button) => {
    button.addEventListener("click", () => {
      radarState.tab = button.dataset.tab || "auto";
      radarState.selectedSymbol = chooseSelectedSymbol(radarState.selectedSymbol);
      renderRadarPage();
    });
  });
  radarEls.filters.forEach((button) => {
    button.addEventListener("click", () => {
      radarState.filter = button.dataset.filter || "all";
      radarState.selectedSymbol = chooseSelectedSymbol(radarState.selectedSymbol);
      renderRadarPage();
    });
  });
  radarEls.radarPinForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const symbol = normalizeSymbolInput(radarEls.radarManualSymbol.value);
    if (!symbol) return;
    pinSymbol(symbol);
    radarEls.radarManualSymbol.value = "";
  });
  radarEls.radarTokenTable?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-symbol]");
    if (!target) return;
    radarState.selectedSymbol = target.dataset.symbol;
    renderRadarPage();
  });
}

async function fetchCexRadarScan(force) {
  radarState.loading = true;
  radarState.lastError = null;
  renderRadarPage();

  const params = new URLSearchParams({ deepInspectLimit: String(radarState.deepLimit) });
  if (force) params.set("force", "true");

  try {
    const response = await fetch(`/api/radar/cex-scan?${params.toString()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(payload.error || "CEX radar scan failed"), {
        status: response.status,
        details: payload.details || null
      });
    }
    radarState.tokens = Array.isArray(payload.tokens) ? payload.tokens.map(normalizeToken) : [];
    radarState.errors = Array.isArray(payload.errors) ? payload.errors : [];
    radarState.updatedAt = payload.updatedAt || new Date().toISOString();
    radarState.selectedSymbol = chooseSelectedSymbol(radarState.selectedSymbol);
  } catch (error) {
    radarState.lastError = error;
    radarState.tokens = [];
    radarState.errors = [];
    radarState.updatedAt = null;
  } finally {
    radarState.loading = false;
    renderRadarPage();
  }
}

function normalizeToken(token) {
  return {
    ...token,
    symbol: normalizeSymbolInput(token.symbol),
    baseAsset: token.baseAsset || normalizeSymbolInput(token.symbol).replace(/USDT$/, ""),
    tags: Array.isArray(token.tags) ? token.tags : [],
    warnings: Array.isArray(token.warnings) ? token.warnings : [],
    expectationReasons: Array.isArray(token.expectationReasons) ? token.expectationReasons : [],
    actionReasons: Array.isArray(token.actionReasons) ? token.actionReasons : [],
    indexConstituents: Array.isArray(token.indexConstituents) ? token.indexConstituents : []
  };
}

function loadPinnedSymbols() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RADAR_PIN_STORAGE_KEY) || "[]");
    radarState.pinnedSymbols = Array.isArray(parsed)
      ? parsed.map(normalizeSymbolInput).filter(Boolean)
      : [];
  } catch {
    radarState.pinnedSymbols = [];
  }
}

function savePinnedSymbols() {
  localStorage.setItem(RADAR_PIN_STORAGE_KEY, JSON.stringify(radarState.pinnedSymbols));
}

function normalizeSymbolInput(value) {
  const upper = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!upper) return "";
  return upper.endsWith("USDT") ? upper : `${upper}USDT`;
}

function pinSymbol(symbol) {
  if (!radarState.pinnedSymbols.includes(symbol)) {
    radarState.pinnedSymbols.push(symbol);
    savePinnedSymbols();
    showRadarToast(`${symbol} 已加入观察池`);
  }
  radarState.tab = "pinned";
  radarState.selectedSymbol = symbol;
  renderRadarPage();
}

function unpinSymbol(symbol) {
  radarState.pinnedSymbols = radarState.pinnedSymbols.filter((item) => item !== symbol);
  savePinnedSymbols();
  showRadarToast(`${symbol} 已移出观察池`);
  if (radarState.selectedSymbol === symbol) {
    radarState.selectedSymbol = chooseSelectedSymbol(null);
  }
  renderRadarPage();
}

function chooseSelectedSymbol(currentSymbol) {
  const visible = getVisibleTokens();
  if (currentSymbol && visible.some((token) => token.symbol === currentSymbol)) return currentSymbol;
  return visible[0]?.symbol || null;
}

function renderRadarPage() {
  renderRadarControls();
  renderRadarSummary();
  renderRadarError();
  renderRadarTable();
  renderRadarDetail();
}

function renderRadarControls() {
  if (radarEls.radarRefreshButton) {
    radarEls.radarRefreshButton.disabled = radarState.loading;
    radarEls.radarRefreshButton.textContent = radarState.loading ? "…" : "↻";
  }
  if (radarEls.radarUpdatedAt) {
    radarEls.radarUpdatedAt.textContent = radarState.updatedAt
      ? new Date(radarState.updatedAt).toLocaleString("zh-CN")
      : "尚未扫描";
  }
  radarEls.tabs?.forEach((button) => button.classList.toggle("active", button.dataset.tab === radarState.tab));
  radarEls.filters?.forEach((button) => button.classList.toggle("active", button.dataset.filter === radarState.filter));
}

function renderRadarSummary() {
  const tokens = radarState.tokens;
  const dataIssueCount = radarState.errors.length + (radarState.lastError ? 1 : 0);
  const cards = [
    ["候选", tokens.length],
    ["高关注", tokens.filter((token) => toFiniteNumber(token.attentionScore) >= HIGH_ATTENTION_THRESHOLD).length],
    ["高风险", tokens.filter((token) => toFiniteNumber(token.riskScore) >= HIGH_RISK_THRESHOLD).length],
    ["数据源异常", dataIssueCount],
    ["观察池", radarState.pinnedSymbols.length]
  ];

  radarEls.radarSummaryGrid.innerHTML = cards.map(([label, value]) => `
    <article class="radar-summary-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join("");
}

function renderRadarError() {
  if (!radarEls.radarError) return;
  if (!radarState.lastError && radarState.errors.length === 0) {
    radarEls.radarError.hidden = true;
    radarEls.radarError.innerHTML = "";
    return;
  }
  radarEls.radarError.hidden = false;
  const topError = radarState.lastError
    ? formatFetchError(radarState.lastError)
    : radarState.errors.map(formatSourceError).join("；");
  radarEls.radarError.textContent = `数据源异常：${topError}`;
}

function formatFetchError(error) {
  const detail = error.details || {};
  const parts = [error.message || "请求失败"];
  if (detail.source) parts.push(detail.source);
  if (detail.endpoint) parts.push(detail.endpoint);
  if (detail.cause) parts.push(detail.cause);
  return parts.filter(Boolean).join(" / ");
}

function formatSourceError(error) {
  if (!error || typeof error !== "object") return String(error || "未知错误");
  return [error.source, error.endpoint, error.message || error.cause]
    .filter(Boolean)
    .join(" / ");
}

function getAutoTokens() {
  return radarState.tokens.filter((token) => (
    toFiniteNumber(token.attentionScore) >= AUTO_ATTENTION_THRESHOLD ||
    toFiniteNumber(token.riskScore) >= AUTO_RISK_THRESHOLD
  ));
}

function getPinnedTokens() {
  const tokenMap = new Map(radarState.tokens.map((token) => [token.symbol, token]));
  return radarState.pinnedSymbols.map((symbol) => tokenMap.get(symbol) || {
    symbol,
    baseAsset: symbol.replace(/USDT$/, ""),
    unavailable: true,
    tags: ["暂无数据"],
    warnings: ["当前扫描结果中没有该币种"],
    expectationReasons: [],
    actionReasons: [],
    indexConstituents: []
  });
}

function getVisibleTokens() {
  const source = radarState.tab === "pinned" ? getPinnedTokens() : getAutoTokens();
  return sortTokens(source.filter(matchesFilter));
}

function matchesFilter(token) {
  if (radarState.filter === "attention") return toFiniteNumber(token.attentionScore) >= HIGH_ATTENTION_THRESHOLD;
  if (radarState.filter === "risk") return toFiniteNumber(token.riskScore) >= HIGH_RISK_THRESHOLD;
  if (radarState.filter === "same-symbol") return (token.tags || []).includes("同名币风险");
  if (radarState.filter === "source-issue") return token.unavailable || (token.warnings || []).length > 0;
  if (radarState.filter === "pinned") return radarState.pinnedSymbols.includes(token.symbol);
  return true;
}

function sortTokens(tokens) {
  const sorted = [...tokens];
  sorted.sort((a, b) => {
    if (radarState.sort === "risk-desc") return toFiniteNumber(b.riskScore) - toFiniteNumber(a.riskScore);
    if (radarState.sort === "change-desc") return toFiniteNumber(b.priceChange24h) - toFiniteNumber(a.priceChange24h);
    if (radarState.sort === "volume-desc") return toFiniteNumber(b.quoteVolume24h) - toFiniteNumber(a.quoteVolume24h);
    return toFiniteNumber(b.attentionScore) - toFiniteNumber(a.attentionScore);
  });
  return sorted;
}

function renderRadarTable() {
  const visible = getVisibleTokens();
  radarEls.radarTableStatus.textContent = radarState.loading
    ? "扫描中"
    : visible.length ? `显示 ${visible.length} 个候选` : "暂无候选";

  if (!visible.length) {
    radarEls.radarTokenTable.innerHTML = `<tr><td colspan="9"><div class="empty-state">暂无候选</div></td></tr>`;
    return;
  }

  radarEls.radarTokenTable.innerHTML = visible.map((token) => {
    const selected = token.symbol === radarState.selectedSymbol ? " selected" : "";
    const pinned = radarState.pinnedSymbols.includes(token.symbol);
    return `
      <tr class="radar-row${selected}" data-symbol="${escapeAttr(token.symbol)}">
        <td>
          <button class="radar-symbol-button" type="button" data-symbol="${escapeAttr(token.symbol)}">
            ${escapeHtml(token.symbol)}
          </button>
          ${pinned ? `<span class="pin-star" aria-label="已固定">★</span>` : ""}
        </td>
        <td class="${escapeAttr(valueClass(token.priceChange24h))}">${formatPct(token.priceChange24h)}</td>
        <td>${formatCompactUsd(token.quoteVolume24h)}</td>
        <td>${scoreBadge(token.attentionScore, "attention")}</td>
        <td>${scoreBadge(token.riskScore, "risk")}</td>
        <td>${expectationLabel(token)}</td>
        <td>${actionLabel(token.actionBias)}</td>
        <td>${phaseLabel(token.phase)}</td>
        <td>${tagList(token.tags)}</td>
      </tr>
    `;
  }).join("");
}

function renderRadarDetail() {
  const token = [...radarState.tokens, ...getPinnedTokens()].find((item) => item.symbol === radarState.selectedSymbol);
  if (!token) {
    radarEls.radarDetailPanel.innerHTML = `<div class="empty-state">选择一个币查看信号解释</div>`;
    return;
  }

  const pinned = radarState.pinnedSymbols.includes(token.symbol);
  radarEls.radarDetailPanel.innerHTML = `
    <div class="radar-detail-header">
      <div>
        <p class="eyebrow">${escapeHtml(token.baseAsset || "")}</p>
        <h2>${escapeHtml(token.symbol)}</h2>
      </div>
      <button class="secondary-button" id="radarPinToggle" type="button">${pinned ? "取消固定" : "固定观察"}</button>
    </div>
    ${token.unavailable ? `<div class="radar-error">当前扫描结果中没有该币种。</div>` : ""}
    <div class="radar-detail-grid">
      ${detailMetric("短线预期", expectationLabel(token))}
      ${detailMetric("预期区间", token.expectedMovePctRange?.label || "--")}
      ${detailMetric("置信度", confidenceLabel(token.expectationConfidence || token.confidence))}
      ${detailMetric("观察动作", actionLabel(token.actionBias))}
      ${detailMetric("失效条件", token.invalidLevel || "--")}
      ${detailMetric("阶段", phaseLabel(token.phase))}
    </div>
    ${detailList("预期依据", token.expectationReasons)}
    ${detailList("动作依据", token.actionReasons)}
    ${detailList("核心标签", token.tags)}
    ${detailList("风险提示", token.warnings)}
    <div class="radar-raw-metrics">
      ${detailMetric("现价", formatUsdPrice(token.lastPrice))}
      ${detailMetric("24h 高/低", `${formatUsdPrice(token.high24h)} / ${formatUsdPrice(token.low24h)}`)}
      ${detailMetric("Funding", formatFunding(token.fundingRate))}
      ${detailMetric("ADL", token.adlRisk || "--")}
      ${detailMetric("锚价偏差", formatPct(token.anchorDispersionPct))}
      ${detailMetric("合约/锚成交量", formatRatio(token.futuresToAnchorVolumeRatio))}
      ${detailMetric("Mark/Index 溢价", formatPct(token.markIndexPremiumPct))}
      ${detailMetric("Open Interest", formatCompactNumber(token.openInterest))}
    </div>
    ${constituentList(token.indexConstituents)}
  `;

  document.getElementById("radarPinToggle")?.addEventListener("click", () => {
    pinned ? unpinSymbol(token.symbol) : pinSymbol(token.symbol);
  });
}

function detailMetric(label, value) {
  return `
    <div class="radar-detail-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function detailList(label, items) {
  const safeItems = Array.isArray(items) && items.length ? items : ["--"];
  return `
    <div class="radar-detail-list">
      <h3>${escapeHtml(label)}</h3>
      <div>${safeItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    </div>
  `;
}

function constituentList(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return detailList("指数锚价成分", ["--"]);
  }
  return `
    <div class="radar-detail-list">
      <h3>指数锚价成分</h3>
      <div class="radar-constituents">
        ${rows.map((row) => `
          <span>
            ${escapeHtml(row.exchange || "unknown")}
            ${escapeHtml(row.symbol || "")}
            ${formatUsdPrice(row.price)}
            ${formatWeight(row.weight)}
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function scoreBadge(value, kind) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return `<span class="score-badge">--</span>`;
  return `<span class="score-badge ${escapeAttr(kind)}">${Math.round(numeric)}</span>`;
}

function tagList(tags) {
  const items = Array.isArray(tags) ? tags : [];
  if (!items.length) return `<span class="mini-tag">--</span>`;
  return items.slice(0, 3).map((tag) => `<span class="mini-tag">${escapeHtml(tag)}</span>`).join("");
}

function expectationLabel(token) {
  if (token.shortTermBias === "bullish") return "偏涨";
  if (token.shortTermBias === "bearish") return "偏跌";
  if (token.shortTermBias === "volatile-unclear") return "高波动不明";
  return "--";
}

function actionLabel(value) {
  if (value === "watch-long") return "观察做多";
  if (value === "watch-short") return "观察做空";
  if (value === "watch-only") return "只观察不追";
  if (value === "avoid") return "回避";
  return "--";
}

function phaseLabel(value) {
  const labels = {
    candidate: "候选",
    acceleration: "加速",
    "high-risk-extension": "高风险延伸",
    "pullback-watch": "回撤观察",
    "failed-breakout-risk": "突破失败风险",
    "same-symbol-risk": "同名币风险"
  };
  return labels[value] || value || "--";
}

function confidenceLabel(value) {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  if (value === "low") return "低";
  return "--";
}

function formatPct(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatFunding(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${(numeric * 100).toFixed(4)}%`;
}

function formatRatio(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric.toFixed(1)}x`;
}

function formatCompactUsd(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return "--";
  if (numeric >= 1_000_000_000) return `$${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (numeric >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(numeric).toLocaleString("en-US")}`;
}

function formatCompactNumber(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return "--";
  if (numeric >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  return Math.round(numeric).toLocaleString("en-US");
}

function formatUsdPrice(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return "--";
  const maximumFractionDigits = numeric >= 1 ? 4 : 8;
  return `$${numeric.toLocaleString("en-US", { maximumFractionDigits })}`;
}

function formatWeight(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return "";
  return `权重 ${numeric.toFixed(2)}`;
}

function valueClass(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return numeric > 0 ? "positive" : "negative";
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function showRadarToast(message) {
  if (!radarEls.radarToast) return;
  radarEls.radarToast.textContent = message;
  radarEls.radarToast.classList.add("show");
  clearTimeout(showRadarToast.timer);
  showRadarToast.timer = setTimeout(() => radarEls.radarToast.classList.remove("show"), 1800);
}
