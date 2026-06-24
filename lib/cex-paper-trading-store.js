const fs = require("fs/promises");
const path = require("path");

async function loadCexPaperTrades(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    if (error instanceof SyntaxError) {
      const ledgerError = new Error("CEX paper trades ledger is malformed");
      ledgerError.code = "CEX_PAPER_TRADES_MALFORMED";
      ledgerError.statusCode = 500;
      ledgerError.details = { filePath };
      throw ledgerError;
    }
    throw error;
  }
}

async function saveCexPaperTrades(filePath, trades) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const normalized = Array.isArray(trades) ? trades : [];
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

async function archiveCexPaperTrades(filePath, trades, metadata = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const normalized = Array.isArray(trades) ? trades : [];
  const archivePath = `${filePath}.backup-${Date.now()}`;
  const payload = {
    metadata: {
      archivedAt: new Date().toISOString(),
      ...metadata
    },
    trades: normalized
  };
  await fs.writeFile(archivePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { filePath: archivePath, count: normalized.length };
}

async function loadCexPaperState(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) {
      const stateError = new Error("CEX paper trading state is malformed");
      stateError.code = "CEX_PAPER_STATE_MALFORMED";
      stateError.statusCode = 500;
      stateError.details = { filePath };
      throw stateError;
    }
    throw error;
  }
}

async function saveCexPaperState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const normalized = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

module.exports = {
  loadCexPaperTrades,
  saveCexPaperTrades,
  archiveCexPaperTrades,
  loadCexPaperState,
  saveCexPaperState
};
