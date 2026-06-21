const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("fs/promises");
const net = require("node:net");
const os = require("os");
const path = require("node:path");

const ROOT_DIR = path.join(__dirname, "..");

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer(env) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Server did not start:\n${output}`));
    }, 5000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with ${code}:\n${output}`));
    });
    const interval = setInterval(() => {
      if (output.includes("Asset Portfolio Hub is running")) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve();
      }
    }, 25);
  });

  return child;
}

function sampleToken(overrides = {}) {
  return {
    symbol: "LABUSDT",
    lastPrice: 10,
    actionBias: "watch-long",
    shortTermBias: "bullish",
    expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" },
    attentionScore: 82,
    riskScore: 35,
    phase: "acceleration",
    signalReview: {
      reviewLabel: "continuation",
      bullCase: ["外部锚同步"],
      bearCase: [],
      riskGate: [],
      decisionSummary: "高关注且外部锚同步，风险未失控，适合观察延续。",
      decisionConfidence: "high"
    },
    ...overrides
  };
}

test("CEX journal API loads, captures, filters, and reviews entries", async (t) => {
  const port = await getFreePort();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cex-journal-api-"));
  const journalFile = path.join(dir, "cex-signal-journal.json");
  const child = await startServer({
    PORT: String(port),
    CEX_SIGNAL_JOURNAL_FILE: journalFile
  });
  t.after(() => child.kill());

  const baseUrl = `http://127.0.0.1:${port}`;

  let response = await fetch(`${baseUrl}/api/radar/cex-journal`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { entries: [] });

  response = await fetch(`${baseUrl}/api/radar/cex-journal/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens: [sampleToken()], pinnedSymbols: [] })
  });
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.capturedCount, 1);
  assert.equal(payload.entries[0].symbol, "LABUSDT");

  response = await fetch(`${baseUrl}/api/radar/cex-journal?symbol=LABUSDT`);
  assert.equal(response.status, 200);
  payload = await response.json();
  assert.equal(payload.entries.length, 1);

  await fs.writeFile(journalFile, JSON.stringify([{
    id: "LABUSDT-2020-01-01T00:00:00.000Z",
    symbol: "LABUSDT",
    observedAt: "2020-01-01T00:00:00.000Z",
    lastSeenAt: "2020-01-01T00:00:00.000Z",
    entryPrice: 10,
    latestPrice: 10,
    actionBias: "watch-long",
    shortTermBias: "bullish",
    expectedMovePctRange: { lower: 8, upper: 18, label: "+8% ~ +18%" },
    review1d: null,
    review3d: null
  }], null, 2), "utf8");

  response = await fetch(`${baseUrl}/api/radar/cex-journal/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens: [sampleToken({ lastPrice: 11.2 })] })
  });
  assert.equal(response.status, 200);
  payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.reviewedCount, 2);
  assert.equal(payload.entries[0].review1d.outcomeLabel, "hit");
  assert.equal(payload.entries[0].review3d.outcomeLabel, "hit");
});
