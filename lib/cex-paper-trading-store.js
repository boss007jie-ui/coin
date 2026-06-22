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

module.exports = {
  loadCexPaperTrades,
  saveCexPaperTrades
};
