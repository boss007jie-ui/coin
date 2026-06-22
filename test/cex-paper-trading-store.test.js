const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  loadCexPaperTrades,
  saveCexPaperTrades,
  loadCexPaperState,
  saveCexPaperState
} = require("../lib/cex-paper-trading-store");

async function tempLedgerPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cex-paper-trades-"));
  return path.join(dir, "nested", "cex-paper-trades.json");
}

test("missing paper trades file loads as empty array", async () => {
  const trades = await loadCexPaperTrades(await tempLedgerPath());
  assert.deepEqual(trades, []);
});

test("saves and loads paper trades", async () => {
  const filePath = await tempLedgerPath();
  const trades = [{
    id: "LABUSDT-2026-06-22T00:00:00.000Z",
    symbol: "LABUSDT",
    status: "open",
    marginUsdt: 83.33
  }];

  await saveCexPaperTrades(filePath, trades);
  assert.deepEqual(await loadCexPaperTrades(filePath), trades);
});

test("malformed paper trades file throws local data error without overwriting", async () => {
  const filePath = await tempLedgerPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{ bad json", "utf8");

  await assert.rejects(
    loadCexPaperTrades(filePath),
    (error) => {
      assert.equal(error.code, "CEX_PAPER_TRADES_MALFORMED");
      assert.equal(error.statusCode, 500);
      assert.deepEqual(error.details, { filePath });
      return true;
    }
  );

  assert.equal(await fs.readFile(filePath, "utf8"), "{ bad json");
});

test("saves and loads paper trading state", async () => {
  const filePath = await tempLedgerPath();

  assert.deepEqual(await loadCexPaperState(filePath), {});

  await saveCexPaperState(filePath, {
    strategyProfile: "defensive-v1",
    lastDailySummaryDateKey: "2026-06-22"
  });

  assert.deepEqual(await loadCexPaperState(filePath), {
    strategyProfile: "defensive-v1",
    lastDailySummaryDateKey: "2026-06-22"
  });
});
