const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  loadCexSignalJournal,
  saveCexSignalJournal
} = require("../lib/cex-signal-journal-store");

async function tempJournalPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cex-journal-"));
  return path.join(dir, "nested", "cex-signal-journal.json");
}

test("missing journal file loads as empty array", async () => {
  const filePath = await tempJournalPath();
  const entries = await loadCexSignalJournal(filePath);
  assert.deepEqual(entries, []);
});

test("saves and loads journal entries", async () => {
  const filePath = await tempJournalPath();
  const entries = [{ id: "one", symbol: "LABUSDT" }];

  await saveCexSignalJournal(filePath, entries);
  const loaded = await loadCexSignalJournal(filePath);

  assert.deepEqual(loaded, entries);
});

test("malformed journal file throws local data error without overwriting", async () => {
  const filePath = await tempJournalPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{ broken json", "utf8");

  await assert.rejects(
    loadCexSignalJournal(filePath),
    (error) => {
      assert.equal(error.code, "CEX_SIGNAL_JOURNAL_MALFORMED");
      assert.equal(error.statusCode, 500);
      return true;
    }
  );

  const raw = await fs.readFile(filePath, "utf8");
  assert.equal(raw, "{ broken json");
});
