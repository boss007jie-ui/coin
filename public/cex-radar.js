const RADAR_PIN_STORAGE_KEY = "cex-radar-pinned-symbols-v1";
const RADAR_AUTO_SCAN_STORAGE_KEY = "cex-radar-auto-scan-enabled-v1";
const RADAR_AUTO_SCAN_INTERVAL_STORAGE_KEY = "cex-radar-auto-scan-interval-v1";
const AUTO_ATTENTION_THRESHOLD = 60;
const AUTO_RISK_THRESHOLD = 60;
const HIGH_ATTENTION_THRESHOLD = 70;
const HIGH_RISK_THRESHOLD = 50;
const DEFAULT_AUTO_SCAN_INTERVAL_MINUTES = 5;
const VALID_AUTO_SCAN_INTERVALS = [1, 3, 5, 15];

const radarState = {
  tokens: [],
  errors: [],
  selectedSymbol: null,
  tab: "auto",
  filter: "all",
  sort: "attention-desc",
  deepLimit: 20,
  pinnedSymbols: [],
  autoScanEnabled: true,
  autoScanIntervalMinutes: DEFAULT_AUTO_SCAN_INTERVAL_MINUTES,
  autoScanNextRunAt: null,
  journalEntries: [],
  journalError: null,
  paperTrades: [],
  paperFeedback: { closedCount: 0, setups: [], needsReview: [], worstSetups: [] },
  paperError: null,
  loading: false,
  lastError: null,
  updatedAt: null
};

const radarEls = {};
let autoScanTimer = null;

document.addEventListener("DOMContentLoaded", initCexRadarPage);
window.addEventListener("beforeunload", clearAutoScanTimer);

function initCexRadarPage() {
  cacheRadarElements();
  loadPinnedSymbols();
  loadAutoScanSettings();
  loadCexJournal();
  loadPaperTrades();
  bindRadarEvents();
  renderRadarPage();
  fetchCexRadarScan(false);
}

function cacheRadarElements() {
  [
    "radarRefreshButton",
    "radarUpdatedAt",
    "radarAutoScanToggle",
    "radarAutoScanInterval",
    "radarAutoScanStatus",
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
  radarEls.radarAutoScanToggle?.addEventListener("change", () => {
    radarState.autoScanEnabled = Boolean(radarEls.radarAutoScanToggle.checked);
    saveAutoScanSettings();
    scheduleAutoScan();
    renderRadarPage();
    showRadarToast(radarState.autoScanEnabled ? "自动扫描已开启" : "自动扫描已暂停");
  });
  radarEls.radarAutoScanInterval?.addEventListener("change", () => {
    radarState.autoScanIntervalMinutes = normalizeAutoScanInterval(radarEls.radarAutoScanInterval.value);
    saveAutoScanSettings();
    scheduleAutoScan();
    renderRadarPage();
    showRadarToast(`自动扫描间隔：${radarState.autoScanIntervalMinutes} 分钟`);
  });
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
    await syncCexJournal(radarState.tokens);
    await loadPaperTrades();
    radarState.selectedSymbol = chooseSelectedSymbol(radarState.selectedSymbol);
  } catch (error) {
    radarState.lastError = error;
    radarState.tokens = [];
    radarState.errors = [];
    radarState.updatedAt = null;
  } finally {
    radarState.loading = false;
    if (radarState.autoScanEnabled) {
      scheduleAutoScan();
    } else {
      clearAutoScanTimer();
    }
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
    indexConstituents: Array.isArray(token.indexConstituents) ? token.indexConstituents : [],
    signalReview: normalizeSignalReview(token.signalReview)
  };
}

function normalizeSignalReview(review) {
  return {
    bullCase: Array.isArray(review?.bullCase) ? review.bullCase : [],
    bearCase: Array.isArray(review?.bearCase) ? review.bearCase : [],
    riskGate: Array.isArray(review?.riskGate) ? review.riskGate : [],
    decisionSummary: review?.decisionSummary || "",
    decisionConfidence: review?.decisionConfidence || "",
    reviewLabel: review?.reviewLabel || ""
  };
}

async function loadCexJournal() {
  try {
    const response = await fetch("/api/radar/cex-journal", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    radarState.journalEntries = Array.isArray(payload.entries) ? payload.entries : [];
    radarState.journalError = null;
    renderRadarPage();
  } catch (error) {
    radarState.journalEntries = [];
    radarState.journalError = error.message || "复盘日志读取失败";
  }
}

async function loadPaperTrades() {
  try {
    const response = await fetch("/api/radar/paper-trades", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    radarState.paperTrades = Array.isArray(payload.trades) ? payload.trades : [];
    radarState.paperFeedback = normalizePaperFeedback(payload.feedback);
    radarState.paperError = null;
    renderRadarPage();
  } catch (error) {
    radarState.paperTrades = [];
    radarState.paperFeedback = normalizePaperFeedback(null);
    radarState.paperError = error.message || "模拟交易读取失败";
    renderRadarPage();
  }
}

async function syncCexJournal(tokens) {
  radarState.journalError = null;
  try {
    const captureResponse = await fetch("/api/radar/cex-journal/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokens,
        pinnedSymbols: radarState.pinnedSymbols
      })
    });
    if (!captureResponse.ok) {
      throw new Error(`HTTP ${captureResponse.status}`);
    }
    const reviewResponse = await fetch("/api/radar/cex-journal/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens })
    });
    if (!reviewResponse.ok) {
      throw new Error(`HTTP ${reviewResponse.status}`);
    }
    const payload = await reviewResponse.json();
    radarState.journalEntries = Array.isArray(payload.entries) ? payload.entries : [];
  } catch (error) {
    radarState.journalError = error.message || "复盘日志同步失败";
  }
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

function loadAutoScanSettings() {
  const enabledValue = localStorage.getItem(RADAR_AUTO_SCAN_STORAGE_KEY);
  radarState.autoScanEnabled = enabledValue === null ? true : enabledValue === "true";
  radarState.autoScanIntervalMinutes = normalizeAutoScanInterval(
    localStorage.getItem(RADAR_AUTO_SCAN_INTERVAL_STORAGE_KEY) || DEFAULT_AUTO_SCAN_INTERVAL_MINUTES
  );
}

function saveAutoScanSettings() {
  localStorage.setItem(RADAR_AUTO_SCAN_STORAGE_KEY, String(radarState.autoScanEnabled));
  localStorage.setItem(RADAR_AUTO_SCAN_INTERVAL_STORAGE_KEY, String(radarState.autoScanIntervalMinutes));
}

function normalizeAutoScanInterval(value) {
  const minutes = Number(value);
  return VALID_AUTO_SCAN_INTERVALS.includes(minutes) ? minutes : DEFAULT_AUTO_SCAN_INTERVAL_MINUTES;
}

function scheduleAutoScan() {
  clearAutoScanTimer();
  if (!radarState.autoScanEnabled) {
    radarState.autoScanNextRunAt = null;
    return;
  }

  const intervalMs = radarState.autoScanIntervalMinutes * 60 * 1000;
  radarState.autoScanNextRunAt = new Date(Date.now() + intervalMs).toISOString();
  autoScanTimer = setTimeout(() => {
    if (!radarState.autoScanEnabled) return;
    if (radarState.loading) {
      scheduleAutoScan();
      renderRadarPage();
      return;
    }
    fetchCexRadarScan(true);
  }, intervalMs);
}

function clearAutoScanTimer() {
  if (autoScanTimer) {
    clearTimeout(autoScanTimer);
    autoScanTimer = null;
  }
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
  if (radarEls.radarAutoScanToggle) {
    radarEls.radarAutoScanToggle.checked = radarState.autoScanEnabled;
  }
  if (radarEls.radarAutoScanInterval) {
    radarEls.radarAutoScanInterval.value = String(radarState.autoScanIntervalMinutes);
    radarEls.radarAutoScanInterval.disabled = !radarState.autoScanEnabled;
  }
  if (radarEls.radarAutoScanStatus) {
    radarEls.radarAutoScanStatus.textContent = autoScanStatusText();
  }
  radarEls.tabs?.forEach((button) => button.classList.toggle("active", button.dataset.tab === radarState.tab));
  radarEls.filters?.forEach((button) => button.classList.toggle("active", button.dataset.filter === radarState.filter));
}

function autoScanStatusText() {
  if (!radarState.autoScanEnabled) return "已暂停";
  if (radarState.loading) return "本轮扫描中";
  if (radarState.autoScanNextRunAt) {
    return `下次 ${new Date(radarState.autoScanNextRunAt).toLocaleTimeString("zh-CN")}`;
  }
  return `每 ${radarState.autoScanIntervalMinutes} 分钟`;
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
    indexConstituents: [],
    signalReview: normalizeSignalReview(null)
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
    ${signalDebate(token.signalReview)}
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
    ${paperFeedbackPanel(token)}
    ${journalHistory(token.symbol)}
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

function signalDebate(review) {
  const safeReview = normalizeSignalReview(review);
  return `
    <div class="signal-debate">
      <h3>信号辩论</h3>
      <div class="signal-debate-grid">
        ${signalColumn("牛方", safeReview.bullCase)}
        ${signalColumn("熊方", safeReview.bearCase)}
        ${signalColumn("风控", safeReview.riskGate)}
      </div>
      <div class="decision-summary">${escapeHtml(safeReview.decisionSummary || "暂无决策摘要")}</div>
    </div>
  `;
}

function signalColumn(title, items) {
  const safeItems = Array.isArray(items) && items.length ? items : ["--"];
  return `
    <section>
      <h4>${escapeHtml(title)}</h4>
      <div>${safeItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    </section>
  `;
}

function paperFeedbackPanel(token) {
  if (radarState.paperError) {
    return `<div class="radar-error">模拟交易：${escapeHtml(radarState.paperError)}</div>`;
  }

  const symbol = normalizeSymbolInput(token.symbol);
  const symbolTrades = radarState.paperTrades
    .filter((trade) => normalizeSymbolInput(trade.symbol) === symbol)
    .slice(0, 8);
  const closed = symbolTrades.filter((trade) => trade.status === "closed");
  const open = symbolTrades.filter((trade) => trade.status === "open");
  const pnl = closed.reduce((sum, trade) => sum + (toFiniteNumber(trade.pnlUsdt) || 0), 0);
  const wins = closed.filter((trade) => (toFiniteNumber(trade.pnlUsdt) || 0) > 0).length;
  const setupMatches = matchingPaperSetups(token).slice(0, 4);

  if (!symbolTrades.length && !setupMatches.length) {
    return `<div class="journal-history"><h3>模拟反馈</h3><div class="empty-state">暂无该币或同类 setup 的模拟结果</div></div>`;
  }

  return `
    <div class="journal-history">
      <h3>模拟反馈</h3>
      <div class="radar-detail-grid">
        ${detailMetric("该币平仓", closed.length)}
        ${detailMetric("该币胜率", formatWinRate(wins, closed.length))}
        ${detailMetric("该币PnL", formatSignedUsdt(pnl))}
        ${detailMetric("未平仓", open.length)}
      </div>
      ${setupMatches.length ? setupMatches.map((setup) => `
        <article class="journal-entry">
          <div>
            <strong>${escapeHtml(setup.needsReview ? "需复盘" : "同类表现")}</strong>
            <span>${escapeHtml(setup.experimentGroup)}/${escapeHtml(setup.experimentGroupLabel)} ${escapeHtml(setup.actionSetup)}/${escapeHtml(setup.reviewLabel)}/${escapeHtml(setup.phase)}</span>
          </div>
          <div class="journal-review-row">
            <span class="review-pill ${setup.needsReview ? "miss" : "hit"}">样本 ${escapeHtml(setup.sampleSize)}</span>
            <span class="review-pill ${setup.needsReview ? "miss" : "hit"}">胜率 ${escapeHtml(formatPctValue(setup.winRatePct))}</span>
            <span class="review-pill ${(setup.totalPnlUsdt || 0) >= 0 ? "hit" : "miss"}">PnL ${escapeHtml(formatSignedUsdt(setup.totalPnlUsdt))}</span>
            <span class="review-pill ${setup.needsReview ? "miss" : "pending"}">连亏 ${escapeHtml(setup.maxLossStreak)}</span>
          </div>
        </article>
      `).join("") : `<div class="empty-state">暂无同类 setup 样本</div>`}
      ${symbolTrades.length ? `
        <div class="radar-detail-list">
          <h3>该币近单</h3>
          <div>${symbolTrades.slice(0, 4).map((trade) => `<span>${escapeHtml(formatPaperTradeLine(trade))}</span>`).join("")}</div>
        </div>
      ` : ""}
    </div>
  `;
}

function matchingPaperSetups(token) {
  const feedback = normalizePaperFeedback(radarState.paperFeedback);
  const side = actionToSide(token.actionBias);
  const reviewLabel = token.signalReview?.reviewLabel || token.phase || "unknown-signal";
  const phase = token.phase || "unknown-phase";
  return feedback.setups
    .filter((setup) => {
      const sideMatch = !side || setup.side === side;
      const actionMatch = !token.actionBias || setup.actionSetup === token.actionBias;
      const labelMatch = setup.reviewLabel === reviewLabel || setup.phase === phase;
      return sideMatch && (actionMatch || labelMatch);
    })
    .sort((a, b) => {
      if (a.needsReview !== b.needsReview) return a.needsReview ? -1 : 1;
      return (a.totalPnlUsdt || 0) - (b.totalPnlUsdt || 0);
    });
}

function formatPaperTradeLine(trade) {
  const group = trade.experimentGroup || "baseline";
  const side = trade.side === "short" ? "空" : "多";
  const status = trade.status === "open" ? "持仓" : (trade.exitReason || "平仓");
  const pnl = trade.status === "closed" ? ` / ${formatSignedUsdt(trade.pnlUsdt)}` : "";
  const evidence = formatEntryEvidenceLine(trade.entryEvidence);
  return `${group} ${side} ${status}${pnl}${evidence ? ` / ${evidence}` : ""}`;
}

function formatEntryEvidenceLine(entryEvidence) {
  const evidence = entryEvidence && typeof entryEvidence === "object" ? entryEvidence : {};
  const confirmations = Array.isArray(evidence.confirmations) ? evidence.confirmations : [];
  if (!confirmations.length) return "";
  const angleCount = toFiniteNumber(evidence.angleCount) || confirmations.length;
  const minRequired = toFiniteNumber(evidence.minRequiredConfirmations) || 0;
  const labels = confirmations.slice(0, 2).map((item) => item.label).filter(Boolean);
  return `证据 ${angleCount}/${minRequired}: ${labels.join(" / ")}`;
}

function journalHistory(symbol) {
  const rows = radarState.journalEntries
    .filter((entry) => String(entry.symbol || "").toUpperCase() === String(symbol || "").toUpperCase())
    .slice(0, 5);
  if (radarState.journalError) {
    return `<div class="radar-error">复盘日志：${escapeHtml(radarState.journalError)}</div>`;
  }
  if (!rows.length) {
    return `<div class="journal-history"><h3>历史复盘</h3><div class="empty-state">暂无复盘记录</div></div>`;
  }
  return `
    <div class="journal-history">
      <h3>历史复盘</h3>
      ${rows.map((entry) => `
        <article class="journal-entry">
          <div>
            <strong>${escapeHtml(formatDateTime(entry.observedAt))}</strong>
            <span>${escapeHtml(actionLabel(entry.actionBias))} / ${escapeHtml(entry.expectedMovePctRange?.label || "--")}</span>
          </div>
          <div class="journal-review-row">
            ${reviewPill("1D", entry.review1d)}
            ${reviewPill("3D", entry.review3d)}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function reviewPill(label, review) {
  if (!review) return `<span class="review-pill pending">${escapeHtml(label)} 待复盘</span>`;
  return `<span class="review-pill ${escapeAttr(review.outcomeLabel || "unclear")}">${escapeHtml(label)} ${formatPct(review.movePct)} ${escapeHtml(outcomeLabel(review.outcomeLabel))}</span>`;
}

function outcomeLabel(value) {
  if (value === "hit") return "命中";
  if (value === "partial") return "方向命中";
  if (value === "miss") return "未命中";
  return "不明确";
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

function formatSignedUsdt(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)} USDT`;
}

function formatWinRate(wins, total) {
  if (!total) return "0.00%";
  return `${((wins / total) * 100).toFixed(2)}%`;
}

function formatPctValue(value) {
  const numeric = toFiniteNumber(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : "--";
}

function actionToSide(value) {
  if (value === "watch-long") return "long";
  if (value === "watch-short") return "short";
  return null;
}

function formatRatio(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${numeric.toFixed(1)}x`;
}

function normalizePaperFeedback(feedback) {
  return {
    closedCount: Number(feedback?.closedCount) || 0,
    setupCount: Number(feedback?.setupCount) || 0,
    needsReviewCount: Number(feedback?.needsReviewCount) || 0,
    setups: Array.isArray(feedback?.setups) ? feedback.setups : [],
    needsReview: Array.isArray(feedback?.needsReview) ? feedback.needsReview : [],
    worstSetups: Array.isArray(feedback?.worstSetups) ? feedback.worstSetups : []
  };
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

function formatDateTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN");
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
