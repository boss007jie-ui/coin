const fs = require("fs/promises");
const path = require("path");

async function loadCexSignalJournal(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    if (error instanceof SyntaxError) {
      const journalError = new Error("CEX signal journal is malformed");
      journalError.code = "CEX_SIGNAL_JOURNAL_MALFORMED";
      journalError.statusCode = 500;
      journalError.details = { filePath };
      throw journalError;
    }
    throw error;
  }
}

async function saveCexSignalJournal(filePath, entries) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const normalized = Array.isArray(entries) ? entries : [];
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

module.exports = {
  loadCexSignalJournal,
  saveCexSignalJournal
};
