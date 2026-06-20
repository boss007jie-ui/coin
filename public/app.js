const STORAGE_KEY = "asset-portfolio-hub-state-v1";
const SEED_URL = "/data/seed-assets.json";
const AUTO_REFRESH_MS = 60000;
const PALETTE = ["#f0c84b", "#e74d39", "#2fb1a0", "#4f7fd7", "#d8892f", "#8e6bbd", "#cfd36a", "#f4efe3", "#77735e"];

let state = {
  version: 1,
  baseCurrency: "CNY",
  colorMode: "cn",
  fxRates: { CNY: 1, USD: 7.25, HKD: 0.926 },
  assets: [],
  lastRefresh: null,
  lastSnapshotAt: null
};

let autoRefreshTimer = null;

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  await loadState();
  bindEvents();
  render();
  refreshBinanceStatus();
  if (state.autoRefresh) {
    toggleAutoRefresh();
  } else {
    setTimeout(refreshQuotes, 600);
  }
  setTimeout(initRadarBackgroundScanner, 1200);
}

function cacheElements() {
  [
    "refreshButton",
    "addAssetButton",
    "exportButton",
    "exportCsvButton",
    "importInput",
    "baseCurrency",
    "colorMode",
    "autoRefresh",
    "totalValue",
    "dayPnl",
    "totalPnl",
    "assetCount",
    "quoteStatus",
    "lastUpdated",
    "mainCurrencyLabel",
    "categoryTotal",
    "platformTotal",
    "currencyTotal",
    "categoryDonut",
    "categoryLegend",
    "platformBars",
    "currencyBars",
    "assetTable",
    "searchInput",
    "categoryFilter",
    "platformFilter",
    "sortSelect",
    "filterSummary",
    "assetDialog",
    "assetForm",
    "dialogTitle",
    "closeDialogButton",
    "deleteAssetButton",
    "resetSeedButton",
    "assetId",
    "platformField",
    "accountField",
    "categoryField",
    "nameField",
    "symbolField",
    "currencyField",
    "quantityField",
    "priceField",
    "marketValueField",
    "costBasisField",
    "dayPnlField",
    "pnlField",
    "quoteSourceField",
    "quoteSymbolField",
    "quoteIdField",
    "notesField",
    "binanceAccountButton",
    "binanceAccountStatus",
    "binanceDialog",
    "closeBinanceDialogButton",
    "binanceAccountTotalUsd",
    "binanceAccountTotalCny",
    "binanceAccountUpdatedAt",
    "binanceBalanceTable",
    "okxAccountButton",
    "okxDialog",
    "closeOkxDialogButton",
    "okxAccountTotalUsd",
    "okxAccountTotalCny",
    "okxAccountUpdatedAt",
    "okxBalanceTable",
    "bybitAccountButton",
    "bybitDialog",
    "closeBybitDialogButton",
    "bybitAccountTotalUsd",
    "bybitAccountTotalCny",
    "bybitAccountUpdatedAt",
    "bybitBalanceTable",
    "onchainButton",
    "onchainDialog",
    "closeOnchainDialogButton",
    "walletChainSelect",
    "walletAddressInput",
    "walletLabelInput",
    "addWalletButton",
    "walletList",
    "queryOnchainButton",
    "onchainUpdatedAt",
    "onchainBalanceResults",
    "channelsButton",
    "channelsDialog",
    "closeChannelsDialogButton",
    "channelsList",
    "toast",
    "radarButton",
    "radarDialog",
    "closeRadarDialogButton",
    "radarHighRiskCount",
    "radarMidRiskCount",
    "radarLastScanTime",
    "triggerScanButton",
    "radarScanStatus",
    "radarResultsList",
    "radarNotificationsEnabled",
    "radarSoundEnabled",
    "radarScanInterval",
    "radarTokenChain",
    "radarTokenAddress",
    "radarTokenLabel",
    "addRadarTokenButton",
    "radarWatchlist"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

async function loadState() {
  const seed = await fetchSeedState();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      state = normalizeState(JSON.parse(stored));
      mergeSeedAdditions(seed);
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  state = normalizeState(seed);
  saveState();
}

async function fetchSeedState() {
  try {
    const response = await fetch(SEED_URL, { cache: "no-store" });
    return response.json();
  } catch {
    return { version: 1, seedVersion: 0, assets: [] };
  }
}

function mergeSeedAdditions(seed) {
  const seedVersion = Number(seed.seedVersion || 0);
  if (!seedVersion || Number(state.seedVersion || 0) >= seedVersion) {
    return;
  }

  const syncIds = new Set(seed.seedSyncIds || []);
  let syncedCount = 0;
  const additions = [];

  for (const seedAsset of seed.assets || []) {
    if (!seedAsset.id) {
      continue;
    }

    const normalizedSeedAsset = normalizeAsset(seedAsset);
    const existingIndex = state.assets.findIndex((asset) => asset.id === seedAsset.id);
    if (existingIndex === -1) {
      additions.push(normalizedSeedAsset);
      continue;
    }

    if (syncIds.has(seedAsset.id)) {
      state.assets[existingIndex] = {
        ...normalizedSeedAsset,
        lastPriceAt: state.assets[existingIndex].lastPriceAt || normalizedSeedAsset.lastPriceAt,
        quoteStatus: state.assets[existingIndex].quoteStatus || normalizedSeedAsset.quoteStatus,
        quoteProvider: state.assets[existingIndex].quoteProvider || normalizedSeedAsset.quoteProvider
      };
      syncedCount += 1;
    }
  }

  if (additions.length) {
    state.assets.push(...additions);
  }

  state.seedVersion = seedVersion;
  saveState();
  if (additions.length || syncedCount) {
    showToast(`已自动同步 ${syncedCount} 条资产，新增 ${additions.length} 条`);
  }
}

function normalizeState(input) {
  const next = {
    version: input.version || 1,
    seedVersion: Number(input.seedVersion || 0),
    baseCurrency: input.baseCurrency || "CNY",
    colorMode: input.colorMode || "cn",
    autoRefresh: Boolean(input.autoRefresh),
    fxRates: normalizeFxRates(input.fxRates),
    lastRefresh: input.lastRefresh || null,
    lastSnapshotAt: input.lastSnapshotAt || null,
    assets: Array.isArray(input.assets) ? input.assets.map(normalizeAsset) : []
  };
  return next;
}

function normalizeAsset(asset) {
  const quantity = readNumber(asset.quantity);
  const price = readNumber(asset.price);
  const marketValue = readNumber(asset.marketValue);
  const calculatedValue = Number.isFinite(quantity) && Number.isFinite(price) ? quantity * price : null;
  const resolvedMarketValue = Number.isFinite(marketValue) ? marketValue : calculatedValue;
  const pnl = readNumber(asset.pnl);
  const costBasis = readNumber(asset.costBasis);
  const resolvedCostBasis = Number.isFinite(costBasis)
    ? costBasis
    : Number.isFinite(resolvedMarketValue) && Number.isFinite(pnl)
      ? resolvedMarketValue - pnl
      : null;

  return {
    id: asset.id || createId(asset),
    platform: asset.platform || "未分类平台",
    account: asset.account || "",
    category: asset.category || "其他",
    name: asset.name || asset.symbol || "未命名资产",
    symbol: asset.symbol || "",
    currency: normalizeCurrency(asset.currency || "CNY"),
    quantity: Number.isFinite(quantity) ? quantity : null,
    price: Number.isFinite(price) ? price : null,
    marketValue: Number.isFinite(resolvedMarketValue) ? roundMoney(resolvedMarketValue) : 0,
    costBasis: Number.isFinite(resolvedCostBasis) ? roundMoney(resolvedCostBasis) : null,
    dayPnl: nullableNumber(asset.dayPnl),
    pnl: Number.isFinite(pnl) ? roundMoney(pnl) : null,
    quoteSource: (asset.quoteSource || "manual").toLowerCase(),
    quoteSymbol: asset.quoteSymbol || "",
    quoteId: asset.quoteId || "",
    quoteProvider: asset.quoteProvider || "",
    notes: asset.notes || "",
    lastPriceAt: asset.lastPriceAt || null,
    quoteStatus: asset.quoteStatus || "snapshot"
  };
}

function normalizeFxRates(input = {}) {
  return {
    CNY: Number(input.CNY) || 1,
    USD: Number(input.USD) || 7.25,
    HKD: Number(input.HKD) || 0.926
  };
}

function bindEvents() {
  els.refreshButton.addEventListener("click", () => refreshQuotes());
  els.addAssetButton.addEventListener("click", () => openDialog());
  els.exportButton.addEventListener("click", exportJson);
  els.exportCsvButton.addEventListener("click", exportCsv);
  els.importInput.addEventListener("change", importJson);
  els.baseCurrency.addEventListener("change", () => {
    state.baseCurrency = els.baseCurrency.value;
    saveState();
    render();
  });
  els.colorMode.addEventListener("change", () => {
    state.colorMode = els.colorMode.value;
    saveState();
    render();
  });
  els.autoRefresh.addEventListener("change", toggleAutoRefresh);
  els.searchInput.addEventListener("input", render);
  els.categoryFilter.addEventListener("change", render);
  els.platformFilter.addEventListener("change", render);
  els.sortSelect.addEventListener("change", render);
  els.assetTable.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-id]");
    if (row) {
      openDialog(row.dataset.id);
    }
  });
  els.closeDialogButton.addEventListener("click", () => els.assetDialog.close());
  els.assetForm.addEventListener("submit", saveAssetFromForm);
  els.deleteAssetButton.addEventListener("click", deleteAssetFromForm);
  els.resetSeedButton.addEventListener("click", resetToSeed);
  els.binanceAccountButton.addEventListener("click", loadBinanceAccount);
  els.closeBinanceDialogButton.addEventListener("click", () => els.binanceDialog.close());
  els.okxAccountButton.addEventListener("click", loadOkxAccount);
  els.closeOkxDialogButton.addEventListener("click", () => els.okxDialog.close());
  els.bybitAccountButton.addEventListener("click", loadBybitAccount);
  els.closeBybitDialogButton.addEventListener("click", () => els.bybitDialog.close());
  els.onchainButton.addEventListener("click", openOnchainDialog);
  els.closeOnchainDialogButton.addEventListener("click", () => els.onchainDialog.close());
  els.addWalletButton.addEventListener("click", addWallet);
  els.queryOnchainButton.addEventListener("click", queryOnchainBalances);
  els.channelsButton.addEventListener("click", loadChannelsStatus);
  els.closeChannelsDialogButton.addEventListener("click", () => els.channelsDialog.close());
  els.radarButton.addEventListener("click", openRadarDialog);
  els.closeRadarDialogButton.addEventListener("click", () => els.radarDialog.close());
  els.triggerScanButton.addEventListener("click", () => loadRadarScan(true));
  els.radarNotificationsEnabled.addEventListener("change", saveRadarConfigFromUI);
  els.radarSoundEnabled.addEventListener("change", saveRadarConfigFromUI);
  els.radarScanInterval.addEventListener("change", saveRadarConfigFromUI);
  els.addRadarTokenButton.addEventListener("click", addRadarToken);
}

function render() {
  document.body.classList.toggle("cn", state.colorMode === "cn");
  document.body.classList.toggle("global", state.colorMode !== "cn");

  els.baseCurrency.value = state.baseCurrency;
  els.colorMode.value = state.colorMode;
  els.autoRefresh.checked = state.autoRefresh;
  els.mainCurrencyLabel.textContent = state.baseCurrency;

  renderFilters();
  const assets = getVisibleAssets();
  const totals = computeTotals(state.assets);
  const filteredTotals = computeTotals(assets);

  els.totalValue.textContent = formatMoney(totals.value, state.baseCurrency, 2);
  els.dayPnl.textContent = formatSignedMoney(totals.dayPnl, state.baseCurrency);
  els.dayPnl.className = signedClass(totals.dayPnl);
  els.totalPnl.textContent = formatSignedMoney(totals.pnl, state.baseCurrency);
  els.totalPnl.className = signedClass(totals.pnl);
  els.assetCount.textContent = `${state.assets.length} 条`;
  els.categoryTotal.textContent = formatMoney(filteredTotals.value, state.baseCurrency, 0);
  els.platformTotal.textContent = formatMoney(filteredTotals.value, state.baseCurrency, 0);
  els.currencyTotal.textContent = formatMoney(filteredTotals.value, state.baseCurrency, 0);
  els.quoteStatus.textContent = quoteStatusText();
  els.lastUpdated.textContent = lastUpdatedText();

  renderAllocation(assets);
  renderBars("platform", assets, els.platformBars);
  renderBars("currency", assets, els.currencyBars);
  renderTable(assets);
}

function renderFilters() {
  preserveSelectOptions(els.categoryFilter, uniqueValues(state.assets, "category"), "全部类别");
  preserveSelectOptions(els.platformFilter, uniqueValues(state.assets, "platform"), "全部平台");
}

function preserveSelectOptions(select, values, label) {
  const current = select.value;
  select.innerHTML = `<option value="">${label}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if (values.includes(current)) {
    select.value = current;
  }
}

function renderAllocation(assets) {
  const items = aggregateBy(assets, "category");
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let start = 0;
  const slices = items.map((item, index) => {
    const degrees = total > 0 ? (item.value / total) * 360 : 0;
    const color = PALETTE[index % PALETTE.length];
    const slice = `${color} ${start}deg ${start + degrees}deg`;
    start += degrees;
    return slice;
  });

  els.categoryDonut.style.background = slices.length
    ? `conic-gradient(${slices.join(", ")})`
    : "conic-gradient(var(--line) 0deg 360deg)";

  els.categoryLegend.innerHTML = items
    .slice(0, 7)
    .map((item, index) => {
      const pct = total > 0 ? item.value / total : 0;
      return `
        <div class="legend-item">
          <div class="legend-line">
            <span><i class="swatch" style="background:${PALETTE[index % PALETTE.length]}"></i>${escapeHtml(item.name)}</span>
            <strong>${formatPercent(pct)}</strong>
          </div>
          <small>${formatMoney(item.value, state.baseCurrency, 0)}</small>
        </div>
      `;
    })
    .join("");
}

function renderBars(field, assets, container) {
  const items = aggregateBy(assets, field);
  const total = items.reduce((sum, item) => sum + Math.abs(item.value), 0);
  container.innerHTML = items
    .slice(0, 8)
    .map((item, index) => {
      const pct = total > 0 ? Math.abs(item.value) / total : 0;
      const color = PALETTE[index % PALETTE.length];
      return `
        <div class="bar-item">
          <div class="bar-meta">
            <span>${escapeHtml(item.name)}</span>
            <strong>${formatMoney(item.value, state.baseCurrency, 0)}</strong>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, pct * 100)}%;background:${color}"></div></div>
        </div>
      `;
    })
    .join("");
}

function renderTable(assets) {
  els.filterSummary.textContent = filterSummary(assets.length);
  if (!assets.length) {
    els.assetTable.innerHTML = `<tr><td colspan="9" class="neutral">没有匹配的资产记录</td></tr>`;
    return;
  }

  els.assetTable.innerHTML = assets
    .map((asset) => {
      const currency = asset.currency;
      const marketValue = assetValue(asset);
      const price = resolvedPrice(asset);
      const valueBase = convertToBase(marketValue, currency);
      const pnl = assetPnl(asset);
      const dayPnl = nullableNumber(asset.dayPnl);
      const sourceIsLive = asset.quoteSource !== "manual";
      const sourceLabel = providerLabel(asset);
      return `
        <tr data-id="${escapeAttr(asset.id)}">
          <td>
            <div class="asset-cell">
              <div class="asset-avatar">${escapeHtml((asset.symbol || asset.name).slice(0, 2).toUpperCase())}</div>
              <div>
                <span class="asset-name">${escapeHtml(asset.name)}</span>
                <small>${escapeHtml(asset.symbol || "--")}</small>
              </div>
            </div>
          </td>
          <td>
            <strong>${escapeHtml(asset.platform)}</strong><br />
            <small>${escapeHtml(asset.account || "--")}</small>
          </td>
          <td><span class="badge">${escapeHtml(asset.category)}</span></td>
          <td>${formatQuantity(asset.quantity)}</td>
          <td>${Number.isFinite(price) ? formatMoney(price, currency, price < 10 ? 4 : 2) : "--"}</td>
          <td>
            <strong>${formatMoney(marketValue, currency, 2)}</strong><br />
            <small>${formatMoney(valueBase, state.baseCurrency, 2)}</small>
          </td>
          <td class="${signedClass(dayPnl)}">${Number.isFinite(dayPnl) ? formatSignedMoney(dayPnl, currency) : "--"}</td>
          <td class="${signedClass(pnl)}">${Number.isFinite(pnl) ? formatSignedMoney(pnl, currency) : "--"}</td>
          <td>
            <span class="source-dot ${sourceIsLive ? "live" : ""}"></span>${sourceLabel}<br />
            <small>${asset.lastPriceAt ? formatDateTime(asset.lastPriceAt) : "快照"}</small>
          </td>
        </tr>
      `;
    })
    .join("");
}

function getVisibleAssets() {
  const query = els.searchInput.value.trim().toLowerCase();
  const category = els.categoryFilter.value;
  const platform = els.platformFilter.value;
  const sort = els.sortSelect.value;

  const filtered = state.assets.filter((asset) => {
    const haystack = `${asset.platform} ${asset.account} ${asset.category} ${asset.name} ${asset.symbol}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!category || asset.category === category) && (!platform || asset.platform === platform);
  });

  return filtered.sort((a, b) => {
    if (sort === "pnl-desc") return comparablePnl(b) - comparablePnl(a);
    if (sort === "pnl-asc") return comparablePnl(a) - comparablePnl(b);
    if (sort === "name-asc") return a.name.localeCompare(b.name, "zh-CN");
    return convertToBase(assetValue(b), b.currency) - convertToBase(assetValue(a), a.currency);
  });
}

function filterSummary(count) {
  const parts = [];
  if (els.searchInput.value.trim()) parts.push(`搜索“${els.searchInput.value.trim()}”`);
  if (els.categoryFilter.value) parts.push(els.categoryFilter.value);
  if (els.platformFilter.value) parts.push(els.platformFilter.value);
  const prefix = parts.length ? parts.join(" · ") : "全部资产";
  return `${prefix}，共 ${count} 条`;
}

function computeTotals(assets) {
  return assets.reduce(
    (totals, asset) => {
      totals.value += convertToBase(assetValue(asset), asset.currency);
      const pnl = assetPnl(asset);
      if (Number.isFinite(pnl)) totals.pnl += convertToBase(pnl, asset.currency);
      const dayPnl = nullableNumber(asset.dayPnl);
      if (Number.isFinite(dayPnl)) totals.dayPnl += convertToBase(dayPnl, asset.currency);
      return totals;
    },
    { value: 0, pnl: 0, dayPnl: 0 }
  );
}

function aggregateBy(assets, field) {
  const map = new Map();
  for (const asset of assets) {
    const key = asset[field] || "未分类";
    map.set(key, (map.get(key) || 0) + convertToBase(assetValue(asset), asset.currency));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

async function refreshQuotes() {
  els.refreshButton.disabled = true;
  els.refreshButton.textContent = "…";
  showToast("正在刷新可联网资产的行情");

  try {
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assets: state.assets })
    });

    if (!response.ok) {
      throw new Error(`刷新失败：HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload.fx) {
      state.fxRates = fxFromServer(payload.fx);
    }

    let updatedCount = 0;
    for (const asset of state.assets) {
      const quote = payload.quotes?.[asset.id];
      if (!quote || !Number.isFinite(Number(quote.price))) {
        continue;
      }
      applyQuote(asset, quote, payload.updatedAt);
      updatedCount += 1;
    }

    state.lastRefresh = payload.updatedAt || new Date().toISOString();
    saveState();
    render();

    const errorText = payload.errors?.length ? `；部分接口提示：${payload.errors.join("；")}` : "";
    showToast(`已更新 ${updatedCount} 条行情${errorText}`);
  } catch (error) {
    showToast(error.message || "行情刷新失败");
  } finally {
    els.refreshButton.disabled = false;
    els.refreshButton.textContent = "↻";
  }
}

async function refreshBinanceStatus() {
  try {
    const response = await fetch("/api/binance/status", { cache: "no-store" });
    const payload = await response.json();
    if (payload.configured) {
      els.binanceAccountStatus.textContent = `已配置 ${payload.keyPreview || ""}`.trim();
      els.binanceAccountStatus.className = "positive";
    } else {
      els.binanceAccountStatus.textContent = "未配置 .env";
      els.binanceAccountStatus.className = "neutral";
    }
  } catch {
    els.binanceAccountStatus.textContent = "状态不可用";
    els.binanceAccountStatus.className = "negative";
  }
}

async function loadBinanceAccount() {
  els.binanceAccountButton.disabled = true;
  els.binanceAccountButton.textContent = "查询中";
  els.binanceBalanceTable.innerHTML = `<tr><td colspan="5" class="neutral">正在读取币安账户余额</td></tr>`;
  els.binanceDialog.showModal();

  try {
    const response = await fetch("/api/binance/account", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      const missing = payload.details?.missing?.join(" / ");
      throw new Error(missing ? `需要先配置 ${missing}` : payload.error || "币安账户查询失败");
    }

    renderBinanceAccount(payload);
    refreshBinanceStatus();
    showToast(`已读取 Binance ${payload.balances?.length || 0} 个余额`);
  } catch (error) {
    els.binanceAccountTotalUsd.textContent = "--";
    els.binanceAccountTotalCny.textContent = "--";
    els.binanceAccountUpdatedAt.textContent = "--";
    els.binanceBalanceTable.innerHTML = `<tr><td colspan="5" class="negative">${escapeHtml(error.message)}</td></tr>`;
    showToast(error.message || "币安账户查询失败");
  } finally {
    els.binanceAccountButton.disabled = false;
    els.binanceAccountButton.textContent = "查询余额";
  }
}

function renderBinanceAccount(payload) {
  els.binanceAccountTotalUsd.textContent = formatMoney(payload.totalUsd, "USD", 2);
  els.binanceAccountTotalCny.textContent = formatMoney(payload.totalCny, "CNY", 2);
  els.binanceAccountUpdatedAt.textContent = payload.updatedAt ? formatDateTime(payload.updatedAt) : "--";

  const balances = payload.balances || [];
  if (!balances.length) {
    els.binanceBalanceTable.innerHTML = `<tr><td colspan="5" class="neutral">没有非零余额</td></tr>`;
    return;
  }

  els.binanceBalanceTable.innerHTML = balances
    .map((balance) => {
      const price = Number.isFinite(balance.priceUsd) ? formatMoney(balance.priceUsd, "USD", balance.priceUsd < 1 ? 6 : 2) : "--";
      const value = Number.isFinite(balance.valueUsd) ? formatMoney(balance.valueUsd, "USD", 2) : "--";
      return `
        <tr>
          <td>
            <strong>${escapeHtml(balance.asset)}</strong><br />
            <small>${escapeHtml(balance.quotePair || "未匹配价格")}</small>
          </td>
          <td>${formatQuantity(balance.free)}</td>
          <td>${formatQuantity(balance.locked)}</td>
          <td>${price}</td>
          <td><strong>${value}</strong></td>
        </tr>
      `;
    })
    .join("");
}

function applyQuote(asset, quote, updatedAt) {
  const price = Number(quote.price);
  asset.price = price;
  asset.currency = normalizeCurrency(quote.currency || asset.currency);
  asset.lastPriceAt = quote.marketTime || updatedAt || new Date().toISOString();
  asset.quoteStatus = "live";
  asset.quoteProvider = quote.source || asset.quoteSource;

  if (Number.isFinite(asset.quantity)) {
    asset.marketValue = roundMoney(asset.quantity * price);
    const dayChange = nullableNumber(quote.dayChange);
    const changePercent = nullableNumber(quote.changePercent);
    if (Number.isFinite(dayChange)) {
      asset.dayPnl = roundMoney(dayChange * asset.quantity);
    } else if (Number.isFinite(changePercent) && changePercent !== -100) {
      const previousPrice = price / (1 + changePercent / 100);
      asset.dayPnl = roundMoney((price - previousPrice) * asset.quantity);
    }
  }

  if (Number.isFinite(asset.costBasis)) {
    asset.pnl = roundMoney(asset.marketValue - asset.costBasis);
  }
}

function fxFromServer(payload) {
  const rates = payload.rates || {};
  if (payload.base === "USD" && rates.CNY && rates.HKD) {
    return {
      CNY: 1,
      USD: Number(rates.CNY),
      HKD: Number(rates.CNY) / Number(rates.HKD)
    };
  }
  return normalizeFxRates(state.fxRates);
}

function toggleAutoRefresh() {
  state.autoRefresh = els.autoRefresh.checked;
  saveState();
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (els.autoRefresh.checked) {
    refreshQuotes();
    autoRefreshTimer = setInterval(refreshQuotes, AUTO_REFRESH_MS);
  }
}

function openDialog(assetId = null) {
  const asset = assetId ? state.assets.find((item) => item.id === assetId) : null;
  els.dialogTitle.textContent = asset ? "编辑资产" : "新增资产";
  els.deleteAssetButton.style.visibility = asset ? "visible" : "hidden";

  setField("assetId", asset?.id || "");
  setField("platformField", asset?.platform || "");
  setField("accountField", asset?.account || "");
  setField("categoryField", asset?.category || "加密货币");
  setField("nameField", asset?.name || "");
  setField("symbolField", asset?.symbol || "");
  setField("currencyField", asset?.currency || state.baseCurrency);
  setField("quantityField", valueForInput(asset?.quantity));
  setField("priceField", valueForInput(asset?.price));
  setField("marketValueField", valueForInput(asset?.marketValue));
  setField("costBasisField", valueForInput(asset?.costBasis));
  setField("dayPnlField", valueForInput(asset?.dayPnl));
  setField("pnlField", valueForInput(asset?.pnl));
  setField("quoteSourceField", asset?.quoteSource || "manual");
  setField("quoteSymbolField", asset?.quoteSymbol || "");
  setField("quoteIdField", asset?.quoteId || "");
  setField("notesField", asset?.notes || "");

  els.assetDialog.showModal();
}

function saveAssetFromForm(event) {
  event.preventDefault();
  const id = els.assetId.value || createId({ platform: els.platformField.value, symbol: els.symbolField.value, name: els.nameField.value });
  const asset = normalizeAsset({
    id,
    platform: els.platformField.value.trim(),
    account: els.accountField.value.trim(),
    category: els.categoryField.value.trim(),
    name: els.nameField.value.trim(),
    symbol: els.symbolField.value.trim(),
    currency: els.currencyField.value,
    quantity: readNumber(els.quantityField.value),
    price: readNumber(els.priceField.value),
    marketValue: readNumber(els.marketValueField.value),
    costBasis: readNumber(els.costBasisField.value),
    dayPnl: readNumber(els.dayPnlField.value),
    pnl: readNumber(els.pnlField.value),
    quoteSource: els.quoteSourceField.value,
    quoteSymbol: els.quoteSymbolField.value.trim(),
    quoteId: els.quoteIdField.value.trim(),
    quoteProvider: state.assets.find((item) => item.id === id)?.quoteProvider || "",
    notes: els.notesField.value.trim(),
    lastPriceAt: state.assets.find((item) => item.id === id)?.lastPriceAt || null
  });

  const index = state.assets.findIndex((item) => item.id === id);
  if (index >= 0) {
    state.assets[index] = asset;
  } else {
    state.assets.push(asset);
  }
  saveState();
  render();
  els.assetDialog.close();
  showToast("资产已保存");
}

function deleteAssetFromForm() {
  const id = els.assetId.value;
  if (!id) return;
  const asset = state.assets.find((item) => item.id === id);
  if (!asset || !confirm(`删除 ${asset.name}？`)) return;
  state.assets = state.assets.filter((item) => item.id !== id);
  saveState();
  render();
  els.assetDialog.close();
  showToast("资产已删除");
}

async function resetToSeed() {
  if (!confirm("恢复截图种子数据会覆盖当前本地编辑，确定继续？")) return;
  localStorage.removeItem(STORAGE_KEY);
  await loadState();
  render();
  els.assetDialog.close();
  showToast("已恢复截图种子数据");
}

function exportJson() {
  downloadFile(`asset-portfolio-${dateStamp()}.json`, JSON.stringify(state, null, 2), "application/json");
}

function exportCsv() {
  const rows = [
    ["platform", "account", "category", "name", "symbol", "currency", "quantity", "price", "marketValue", "costBasis", "dayPnl", "pnl", "quoteSource", "quoteSymbol", "quoteId", "notes"],
    ...state.assets.map((asset) => [
      asset.platform,
      asset.account,
      asset.category,
      asset.name,
      asset.symbol,
      asset.currency,
      asset.quantity ?? "",
      asset.price ?? "",
      asset.marketValue ?? "",
      asset.costBasis ?? "",
      asset.dayPnl ?? "",
      asset.pnl ?? "",
      asset.quoteSource,
      asset.quoteSymbol,
      asset.quoteId,
      asset.notes
    ])
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadFile(`asset-portfolio-${dateStamp()}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
}

async function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const imported = Array.isArray(json) ? { ...state, assets: json } : json;
    state = normalizeState(imported);
    saveState();
    render();
    showToast(`已导入 ${state.assets.length} 条资产记录`);
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ── OKX Account ── */

async function loadOkxAccount() {
  els.okxAccountButton.disabled = true;
  els.okxAccountButton.textContent = "查询中…";
  els.okxBalanceTable.innerHTML = `<tr><td colspan="4" class="neutral">正在读取 OKX 账户余额</td></tr>`;
  els.okxDialog.showModal();

  try {
    const response = await fetch("/api/okx/account", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "OKX 账户查询失败");
    }
    renderOkxAccount(payload);
    showToast(`已读取 OKX ${payload.balances?.length || 0} 个余额`);
  } catch (error) {
    els.okxAccountTotalUsd.textContent = "--";
    els.okxAccountTotalCny.textContent = "--";
    els.okxAccountUpdatedAt.textContent = "--";
    els.okxBalanceTable.innerHTML = `<tr><td colspan="4" class="negative">${escapeHtml(error.message)}</td></tr>`;
    showToast(error.message || "OKX 账户查询失败");
  } finally {
    els.okxAccountButton.disabled = false;
    els.okxAccountButton.textContent = "OKX 账户";
  }
}

function renderOkxAccount(payload) {
  els.okxAccountTotalUsd.textContent = formatMoney(payload.totalUsd, "USD", 2);
  els.okxAccountTotalCny.textContent = formatMoney(payload.totalCny, "CNY", 2);
  els.okxAccountUpdatedAt.textContent = payload.updatedAt ? formatDateTime(payload.updatedAt) : "--";

  const balances = payload.balances || [];
  if (!balances.length) {
    els.okxBalanceTable.innerHTML = `<tr><td colspan="4" class="neutral">没有非零余额</td></tr>`;
    return;
  }

  els.okxBalanceTable.innerHTML = balances
    .map((balance) => {
      const value = Number.isFinite(balance.valueUsd) ? formatMoney(balance.valueUsd, "USD", 2) : "--";
      return `
        <tr>
          <td><strong>${escapeHtml(balance.asset)}</strong></td>
          <td>${formatQuantity(balance.available)}</td>
          <td>${formatQuantity(balance.frozen)}</td>
          <td><strong>${value}</strong></td>
        </tr>
      `;
    })
    .join("");
}

/* ── Bybit Account ── */

async function loadBybitAccount() {
  els.bybitAccountButton.disabled = true;
  els.bybitAccountButton.textContent = "查询中…";
  els.bybitBalanceTable.innerHTML = `<tr><td colspan="4" class="neutral">正在读取 Bybit 账户余额</td></tr>`;
  els.bybitDialog.showModal();

  try {
    const response = await fetch("/api/bybit/account", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Bybit 账户查询失败");
    }
    renderBybitAccount(payload);
    showToast(`已读取 Bybit ${payload.balances?.length || 0} 个余额`);
  } catch (error) {
    els.bybitAccountTotalUsd.textContent = "--";
    els.bybitAccountTotalCny.textContent = "--";
    els.bybitAccountUpdatedAt.textContent = "--";
    els.bybitBalanceTable.innerHTML = `<tr><td colspan="4" class="negative">${escapeHtml(error.message)}</td></tr>`;
    showToast(error.message || "Bybit 账户查询失败");
  } finally {
    els.bybitAccountButton.disabled = false;
    els.bybitAccountButton.textContent = "Bybit 账户";
  }
}

function renderBybitAccount(payload) {
  els.bybitAccountTotalUsd.textContent = formatMoney(payload.totalUsd, "USD", 2);
  els.bybitAccountTotalCny.textContent = formatMoney(payload.totalCny, "CNY", 2);
  els.bybitAccountUpdatedAt.textContent = payload.updatedAt ? formatDateTime(payload.updatedAt) : "--";

  const balances = payload.balances || [];
  if (!balances.length) {
    els.bybitBalanceTable.innerHTML = `<tr><td colspan="4" class="neutral">没有非零余额</td></tr>`;
    return;
  }

  els.bybitBalanceTable.innerHTML = balances
    .map((balance) => {
      const value = Number.isFinite(balance.valueUsd) ? formatMoney(balance.valueUsd, "USD", 2) : "--";
      return `
        <tr>
          <td><strong>${escapeHtml(balance.asset)}</strong></td>
          <td>${formatQuantity(balance.available)}</td>
          <td>${formatQuantity(balance.frozen)}</td>
          <td><strong>${value}</strong></td>
        </tr>
      `;
    })
    .join("");
}

/* ── On-chain Monitoring ── */

async function openOnchainDialog() {
  els.onchainDialog.showModal();
  try {
    const response = await fetch("/api/wallets", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "钱包列表获取失败");
    renderWalletList(payload.wallets || []);
  } catch (error) {
    els.walletList.innerHTML = `<div class="neutral">${escapeHtml(error.message)}</div>`;
  }
}

async function addWallet() {
  const chain = els.walletChainSelect.value;
  const address = els.walletAddressInput.value.trim();
  const label = els.walletLabelInput.value.trim();

  if (!address) {
    showToast("请输入钱包地址");
    return;
  }

  els.addWalletButton.disabled = true;
  try {
    const response = await fetch("/api/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chain, address, label })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "添加钱包失败");

    els.walletAddressInput.value = "";
    els.walletLabelInput.value = "";
    renderWalletList(payload.wallets || []);
    showToast("钱包已添加");
  } catch (error) {
    showToast(error.message || "添加钱包失败");
  } finally {
    els.addWalletButton.disabled = false;
  }
}

async function deleteWallet(walletId) {
  if (!confirm("确定删除该钱包地址？")) return;
  try {
    const response = await fetch("/api/wallets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: walletId })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "删除钱包失败");
    renderWalletList(payload.wallets || []);
    showToast("钱包已删除");
  } catch (error) {
    showToast(error.message || "删除钱包失败");
  }
}

function renderWalletList(wallets) {
  if (!wallets.length) {
    els.walletList.innerHTML = `<div class="neutral" style="padding:12px 0">暂无钱包地址，请添加</div>`;
    return;
  }

  const chainLabels = {
    ethereum: "ETH", bsc: "BSC", polygon: "MATIC",
    arbitrum: "ARB", solana: "SOL", bitcoin: "BTC"
  };

  els.walletList.innerHTML = wallets
    .map((wallet) => {
      const chainName = chainLabels[wallet.chain] || wallet.chain;
      const shortAddr = wallet.address.length > 16
        ? `${wallet.address.slice(0, 8)}…${wallet.address.slice(-6)}`
        : wallet.address;
      return `
        <div class="wallet-item">
          <span class="chain-badge chain-${escapeAttr(wallet.chain)}">${escapeHtml(chainName)}</span>
          <code class="wallet-addr" title="${escapeAttr(wallet.address)}">${escapeHtml(shortAddr)}</code>
          <span class="wallet-label">${escapeHtml(wallet.label || "--")}</span>
          <button class="danger-button wallet-delete" onclick="deleteWallet('${escapeAttr(wallet.id)}')">删除</button>
        </div>
      `;
    })
    .join("");
}

async function queryOnchainBalances() {
  els.queryOnchainButton.disabled = true;
  els.queryOnchainButton.textContent = "查询中…";
  els.onchainBalanceResults.innerHTML = `<div class="neutral">正在查询链上余额…</div>`;

  try {
    const response = await fetch("/api/onchain/balances", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "链上余额查询失败");

    els.onchainUpdatedAt.textContent = payload.updatedAt ? `更新于 ${formatDateTime(payload.updatedAt)}` : "";
    renderOnchainBalances(payload);
    showToast("链上余额已更新");
  } catch (error) {
    els.onchainBalanceResults.innerHTML = `<div class="negative">${escapeHtml(error.message)}</div>`;
    showToast(error.message || "链上余额查询失败");
  } finally {
    els.queryOnchainButton.disabled = false;
    els.queryOnchainButton.textContent = "查询链上余额";
  }
}

function renderOnchainBalances(payload) {
  const results = payload.results || [];
  if (!results.length) {
    els.onchainBalanceResults.innerHTML = `<div class="neutral">没有链上余额数据</div>`;
    return;
  }

  els.onchainBalanceResults.innerHTML = results
    .map((group) => {
      const shortAddr = group.address && group.address.length > 16
        ? `${group.address.slice(0, 8)}…${group.address.slice(-6)}`
        : group.address || "--";
      const tokens = (group.tokens || []).map((token) => {
        const value = Number.isFinite(token.valueUsd) ? formatMoney(token.valueUsd, "USD", 2) : "--";
        return `
          <tr>
            <td><strong>${escapeHtml(token.symbol || token.name || "--")}</strong></td>
            <td>${formatQuantity(token.balance)}</td>
            <td>${value}</td>
          </tr>
        `;
      }).join("");

      return `
        <div class="onchain-group">
          <div class="onchain-group-header">
            <span class="chain-badge chain-${escapeAttr(group.chain || "")}">${escapeHtml((group.chain || "").toUpperCase())}</span>
            <code title="${escapeAttr(group.address || "")}">${escapeHtml(shortAddr)}</code>
            <span class="muted">${escapeHtml(group.label || "")}</span>
          </div>
          <div class="mini-table-wrap">
            <table class="mini-table">
              <thead><tr><th>代币</th><th>余额</th><th>估值(USD)</th></tr></thead>
              <tbody>${tokens || '<tr><td colspan="3" class="neutral">无数据</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join("");
}

/* ── Channels Status ── */

async function loadChannelsStatus() {
  els.channelsList.innerHTML = `<div class="neutral" style="padding:18px">正在获取渠道状态…</div>`;
  els.channelsDialog.showModal();

  try {
    const response = await fetch("/api/channels/status", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "渠道状态获取失败");
    renderChannelsStatus(payload.channels || []);
  } catch (error) {
    els.channelsList.innerHTML = `<div class="negative" style="padding:18px">${escapeHtml(error.message)}</div>`;
    showToast(error.message || "渠道状态获取失败");
  }
}

function renderChannelsStatus(channels) {
  if (!channels.length) {
    els.channelsList.innerHTML = `<div class="neutral" style="padding:18px">暂无渠道数据</div>`;
    return;
  }

  els.channelsList.innerHTML = `<div class="channels-grid">${channels
    .map((channel) => {
      const statusClass = channel.status === "active" ? "active"
        : channel.status === "error" ? "error" : "unconfigured";
      const statusLabel = channel.status === "active" ? "正常"
        : channel.status === "error" ? "异常" : "未配置";
      const needsKey = channel.needsKey ? '<span class="badge">需要密钥</span>' : "";
      return `
        <div class="channel-card">
          <div class="channel-card-header">
            <span class="channel-status ${statusClass}"></span>
            <strong>${escapeHtml(channel.name || channel.id || "--")}</strong>
          </div>
          <div class="channel-card-meta">
            <span class="badge">${escapeHtml(channel.type || "--")}</span>
            ${needsKey}
            <span class="muted">${escapeHtml(statusLabel)}</span>
          </div>
        </div>
      `;
    })
    .join("")}</div>`;
}

function assetValue(asset) {
  const marketValue = nullableNumber(asset.marketValue);
  if (Number.isFinite(marketValue)) return marketValue;
  if (Number.isFinite(asset.quantity) && Number.isFinite(asset.price)) return asset.quantity * asset.price;
  return 0;
}

function resolvedPrice(asset) {
  if (Number.isFinite(asset.price)) return asset.price;
  if (Number.isFinite(asset.quantity) && asset.quantity !== 0) return assetValue(asset) / asset.quantity;
  return null;
}

function assetPnl(asset) {
  const pnl = nullableNumber(asset.pnl);
  if (Number.isFinite(pnl)) return pnl;
  if (Number.isFinite(asset.costBasis)) return assetValue(asset) - asset.costBasis;
  return null;
}

function comparablePnl(asset) {
  const pnl = assetPnl(asset);
  return Number.isFinite(pnl) ? convertToBase(pnl, asset.currency) : Number.NEGATIVE_INFINITY;
}

function convertToBase(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  const cnyRate = state.fxRates[normalizeCurrency(currency)] || 1;
  const baseRate = state.fxRates[state.baseCurrency] || 1;
  return (amount * cnyRate) / baseRate;
}

function quoteStatusText() {
  const live = state.assets.filter((asset) => asset.quoteStatus === "live").length;
  const refreshable = state.assets.filter((asset) => asset.quoteSource !== "manual").length;
  if (!refreshable) return "本地记录";
  if (!live) return `${refreshable} 条可刷新`;
  return `${live}/${refreshable} 条已联网`;
}

function lastUpdatedText() {
  if (state.lastRefresh) return `最近刷新 ${formatDateTime(state.lastRefresh)}`;
  if (state.lastSnapshotAt) return `截图快照 ${formatDateTime(state.lastSnapshotAt)}`;
  return "尚未刷新";
}

function providerLabel(asset) {
  const provider = (asset.quoteProvider || asset.quoteSource || "manual").toLowerCase();
  const labels = {
    manual: "手动",
    yahoo: "Yahoo",
    binance: "Binance",
    tencent: "腾讯行情",
    coingecko: "CoinGecko",
    coinbase: "Coinbase",
    okx: "OKX",
    coinmarketcap: "CMC",
    defillama: "DefiLlama",
    dexscreener: "DexScreener",
    moralis: "Moralis",
    "1inch": "1inch",
    alchemy: "Alchemy",
    blockchain: "Blockchain"
  };
  return labels[provider] || provider;
}

function uniqueValues(assets, field) {
  return [...new Set(assets.map((asset) => asset[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setField(id, value) {
  els[id].value = value ?? "";
}

function readNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 1000000) / 1000000;
}

function normalizeCurrency(currency) {
  const normalized = String(currency || "CNY").toUpperCase();
  if (["CNY", "USD", "HKD"].includes(normalized)) return normalized;
  if (normalized === "CNH") return "CNY";
  return normalized;
}

function createId(asset) {
  const seed = `${asset.platform || "asset"}-${asset.symbol || asset.name || Date.now()}-${Date.now()}`;
  return seed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "")
    .slice(0, 80);
}

function valueForInput(value) {
  return Number.isFinite(Number(value)) ? String(value) : "";
}

function formatMoney(value, currency, maximumFractionDigits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: maximumFractionDigits === 0 ? 0 : 2,
    maximumFractionDigits
  }).format(number);
}

function formatSignedMoney(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${formatMoney(number, currency, 2)}`;
}

function formatQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: Math.abs(number) < 1 ? 8 : 4
  }).format(number);
}

function formatPercent(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function signedClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "neutral";
  return number > 0 ? "positive" : "negative";
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function dateStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 4200);
}

// ═══════════════════════════════════════════════════════════════════════
// PART 12: Early Warning Radar UI Control
// ═══════════════════════════════════════════════════════════════════════

let radarNotifiedTokens = new Set();
let radarBackgroundTimer = null;
let radarWatchlistData = [];

function initRadarBackgroundScanner() {
  loadRadarConfig().then(() => {
    // Run initial scan in background after a short delay
    setTimeout(() => {
      silentRadarScan();
    }, 2000);
    setupRadarInterval();
  });
}

function setupRadarInterval() {
  if (radarBackgroundTimer) {
    clearInterval(radarBackgroundTimer);
    radarBackgroundTimer = null;
  }
  const intervalMinutes = parseInt(els.radarScanInterval?.value || "5", 10);
  radarBackgroundTimer = setInterval(silentRadarScan, intervalMinutes * 60 * 1000);
}

async function silentRadarScan() {
  try {
    const response = await fetch("/api/radar/scan");
    if (!response.ok) return;
    const payload = await response.json();
    processRadarScanAlerts(payload);
  } catch (err) {
    console.error("Silent radar scan failed:", err);
  }
}

function processRadarScanAlerts(payload) {
  if (!payload || !Array.isArray(payload.tokens)) return;
  const isEnabledNotifications = els.radarNotificationsEnabled?.checked;
  const isEnabledSound = els.radarSoundEnabled?.checked;
  let newHighRiskAlert = false;

  payload.tokens.forEach(token => {
    if (token.warningLevel === "high") {
      const addr = token.address.toLowerCase();
      if (!radarNotifiedTokens.has(addr)) {
        radarNotifiedTokens.add(addr);
        newHighRiskAlert = true;
        if (isEnabledNotifications) {
          showRadarBrowserNotification(token);
        }
      }
    }
  });

  if (newHighRiskAlert && isEnabledSound) {
    playRadarAlertSound();
  }
}

async function openRadarDialog() {
  els.radarDialog.showModal();
  els.radarScanStatus.textContent = "正在加载预警数据...";
  await loadRadarConfig();
  await loadRadarScan(false);
}

async function loadRadarScan(force = false) {
  els.triggerScanButton.disabled = true;
  els.triggerScanButton.textContent = "扫描中...";
  els.radarScanStatus.textContent = "连接中, 请稍候...";

  try {
    const url = `/api/radar/scan${force ? "?force=true" : ""}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    renderRadarResults(payload);
    processRadarScanAlerts(payload);
    els.radarScanStatus.textContent = payload.cached ? "使用缓存数据" : "扫描已完成";
  } catch (err) {
    showToast(`雷达扫描失败: ${err.message}`);
    els.radarScanStatus.textContent = "扫描失败";
  } finally {
    els.triggerScanButton.disabled = false;
    els.triggerScanButton.textContent = "立即扫描";
  }
}

function renderRadarResults(payload) {
  const tokens = payload.tokens || [];
  const highRisk = tokens.filter(t => t.warningLevel === "high").length;
  const midRisk = tokens.filter(t => t.warningLevel === "mid").length;

  els.radarHighRiskCount.textContent = highRisk;
  els.radarMidRiskCount.textContent = midRisk;
  els.radarLastScanTime.textContent = payload.updatedAt ? formatDateTime(payload.updatedAt) : "尚未扫描";

  if (tokens.length === 0) {
    els.radarResultsList.innerHTML = `<div class="neutral" style="text-align: center; padding: 20px;">未扫描到异常代币</div>`;
    return;
  }

  els.radarResultsList.innerHTML = tokens.map(t => {
    let riskClass = "neutral";
    let riskIcon = "🟢";
    if (t.warningLevel === "high") {
      riskClass = "negative";
      riskIcon = "🔴";
    } else if (t.warningLevel === "mid") {
      riskClass = "positive";
      riskIcon = "🟡";
    }

    // Determine target speculative status
    let statusLabel = "";
    let statusStyle = "";
    const change1h = t.signals.priceAcceleration.val || 0;
    if (t.score >= 50 && change1h < 15 && t.ageDays < 14) {
      statusLabel = "💎 蓄势埋伏期 (控盘完成/尚未拉升)";
      statusStyle = "background: rgba(47, 177, 160, 0.15); color: var(--accent-3); border: 1px solid rgba(47, 177, 160, 0.3); font-size: 11px; padding: 2px 6px;";
    } else if (t.score >= 65 && change1h >= 15) {
      statusLabel = "🚀 拉盘爆发期 (正在冲高/谨防接盘)";
      statusStyle = "background: rgba(255, 90, 79, 0.12); color: var(--red); border: 1px solid rgba(255, 90, 79, 0.3); font-size: 11px; padding: 2px 6px;";
    } else {
      statusLabel = "🔎 观望分析期";
      statusStyle = "background: rgba(255, 255, 255, 0.05); color: var(--muted); border: 1px solid var(--line); font-size: 11px; padding: 2px 6px;";
    }

    return `
      <div class="radar-card" style="border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; margin-bottom: 12px; background: var(--surface-3); display: grid; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
          <div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px;">
              <span class="chain-badge chain-${escapeAttr(t.chain)}">${escapeHtml(t.chain.toUpperCase())}</span>
              <span class="chain-badge" style="${statusStyle}">${escapeHtml(statusLabel)}</span>
            </div>
            <strong style="font-size: 15px; color: var(--text);">${escapeHtml(t.name)} (${escapeHtml(t.symbol)})</strong>
            <code style="display: block; font-size: 11px; color: var(--muted); margin-top: 4px;">${escapeHtml(t.address)}</code>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 13px; font-weight: bold;" class="${riskClass}">${riskIcon} ${t.score} 分</span>
            <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">价格: $${t.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 6})}</div>
          </div>
        </div>

        <div style="display: flex; gap: 14px; border-top: 1px solid var(--line); padding-top: 8px; font-size: 12px; color: var(--muted); flex-wrap: wrap;">
          <div>流动性: <strong>$${Math.round(t.liquidity).toLocaleString()}</strong></div>
          <div>24h交易量: <strong>$${Math.round(t.volume24h).toLocaleString()}</strong></div>
          <div>市值/FDV: <strong>$${Math.round(t.marketCap).toLocaleString()}</strong></div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin-top: 4px; padding: 8px; background: var(--surface-2); border-radius: 4px;">
          ${renderRadarProgressLine("持仓集中度 (30%)", t.signals.holderConcentration.score, 30, t.signals.holderConcentration.detail)}
          ${renderRadarProgressLine("Volume/MC 比率 (20%)", t.signals.volToMcRatio.score, 20, t.signals.volToMcRatio.detail)}
          ${renderRadarProgressLine("价格加速度 (15%)", t.signals.priceAcceleration.score, 15, t.signals.priceAcceleration.detail)}
          ${renderRadarProgressLine("流动性异动 (15%)", t.signals.liquidityAnomaly.score, 15, t.signals.liquidityAnomaly.detail)}
          ${renderRadarProgressLine("代币生命周期 (10%)", t.signals.tokenAge.score, 10, t.signals.tokenAge.detail)}
          ${renderRadarProgressLine("CEX 上线检测 (10%)", t.signals.cexListing.score, 10, t.signals.cexListing.detail)}
        </div>

        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
          <a href="${escapeAttr(t.dexUrl)}" target="_blank" class="secondary-button" style="min-height: 32px; padding: 0 10px; font-size: 12px; display: inline-flex; align-items: center; text-decoration: none; text-align: center; justify-content: center; line-height: 32px;">DexScreener ↗</a>
          ${t.chain === "ethereum" || t.chain === "eth" ? `<a href="https://etherscan.io/token/${escapeAttr(t.address)}" target="_blank" class="secondary-button" style="min-height: 32px; padding: 0 10px; font-size: 12px; display: inline-flex; align-items: center; text-decoration: none; text-align: center; justify-content: center; line-height: 32px;">Etherscan ↗</a>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function renderRadarProgressLine(label, score, max, detail) {
  const pct = (score / max) * 100;
  let color = "var(--green)";
  if (pct >= 75) color = "var(--red)";
  else if (pct >= 40) color = "var(--accent)";

  return `
    <div style="display: grid; gap: 3px; font-size: 11px;">
      <div style="display: flex; justify-content: space-between; color: var(--text);">
        <span>${escapeHtml(label)}</span>
        <strong>${score}/${max}</strong>
      </div>
      <div style="height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; border: 1px solid var(--line);">
        <div style="height: 100%; width: ${pct}%; background: ${color}; transition: width 0.3s;"></div>
      </div>
      <small style="color: var(--muted); font-size: 10px;">${escapeHtml(detail)}</small>
    </div>
  `;
}

async function loadRadarConfig() {
  try {
    const response = await fetch("/api/radar/config");
    if (!response.ok) throw new Error("Failed to load radar config");
    const config = await response.json();

    els.radarNotificationsEnabled.checked = config.notificationsEnabled;
    els.radarSoundEnabled.checked = config.soundEnabled;
    els.radarScanInterval.value = config.scanIntervalMinutes;
    radarWatchlistData = config.customTokens || [];
    renderRadarWatchlist();
  } catch (err) {
    console.error(err);
  }
}

function renderRadarWatchlist() {
  if (radarWatchlistData.length === 0) {
    els.radarWatchlist.innerHTML = `<div class="neutral" style="font-size: 12px;">暂无自定义监控代币</div>`;
    return;
  }

  els.radarWatchlist.innerHTML = radarWatchlistData.map(t => {
    return `
      <div class="wallet-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border: 1px solid var(--line); background: var(--surface-3); border-radius: var(--radius);">
        <div style="display: flex; gap: 10px; align-items: center; min-width: 0;">
          <span class="chain-badge chain-${escapeAttr(t.chain)}">${escapeHtml(t.chain.toUpperCase())}</span>
          <span class="wallet-label" style="font-weight: bold;">${escapeHtml(t.label)}</span>
          <code class="wallet-addr" style="font-size: 11px;">${escapeHtml(t.address)}</code>
        </div>
        <button type="button" class="danger-button wallet-delete" style="min-height: 28px; padding: 0 10px; line-height: 28px; flex-shrink: 0;" onclick="deleteRadarToken('${escapeAttr(t.address)}')">删除</button>
      </div>
    `;
  }).join("");
}

async function addRadarToken() {
  const chain = els.radarTokenChain.value;
  const address = els.radarTokenAddress.value.trim();
  const label = els.radarTokenLabel.value.trim();

  if (!address) {
    showToast("请输入代币合约地址");
    return;
  }

  if (chain !== "solana" && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    showToast("EVM 合约地址格式不正确");
    return;
  }

  if (radarWatchlistData.some(t => t.address.toLowerCase() === address.toLowerCase())) {
    showToast("该合约地址已在监控列表中");
    return;
  }

  const newToken = {
    address,
    chain,
    label: label || "自定义代币",
    addedAt: new Date().toISOString()
  };

  radarWatchlistData.push(newToken);
  await saveRadarConfigToServer();
  els.radarTokenAddress.value = "";
  els.radarTokenLabel.value = "";
  renderRadarWatchlist();
  showToast("已成功添加监控");
}

async function deleteRadarToken(address) {
  if (!confirm(`确定删除该监控合约？`)) return;
  radarWatchlistData = radarWatchlistData.filter(t => t.address.toLowerCase() !== address.toLowerCase());
  await saveRadarConfigToServer();
  renderRadarWatchlist();
  showToast("已删除监控");
}
window.deleteRadarToken = deleteRadarToken;

async function saveRadarConfigFromUI() {
  if (els.radarNotificationsEnabled.checked) {
    requestNotificationPermission();
  }
  await saveRadarConfigToServer();
  setupRadarInterval();
}

async function saveRadarConfigToServer() {
  try {
    const response = await fetch("/api/radar/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanIntervalMinutes: parseInt(els.radarScanInterval.value, 10),
        notificationsEnabled: els.radarNotificationsEnabled.checked,
        soundEnabled: els.radarSoundEnabled.checked,
        customTokens: radarWatchlistData
      })
    });
    if (!response.ok) throw new Error("Failed to save config");
  } catch (err) {
    showToast(`配置保存失败: ${err.message}`);
  }
}

function playRadarAlertSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const playBeep = (freq, duration, delay) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + delay);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + delay);
      osc.stop(audioCtx.currentTime + delay + duration);
    };
    playBeep(587.33, 0.15, 0); // D5
    playBeep(880.00, 0.25, 0.15); // A5
  } catch (err) {
    console.error("Failed to play sound:", err);
  }
}

function showRadarBrowserNotification(token) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(`⚠️ 早期预警雷达警告`, {
      body: `发现高风险代币 [${token.symbol}] (${token.name})，风险评分: ${token.score} 分！主要特征: ${token.signals.holderConcentration.detail}`,
      icon: "/favicon.ico"
    });
  }
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}



