const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "cex-radar.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "..", "public", "cex-radar.js"), "utf8");

test("CEX radar page exposes auto-scan controls", () => {
  assert.match(html, /id="radarAutoScanToggle"/);
  assert.match(html, /id="radarAutoScanInterval"/);
  for (const minutes of ["1", "3", "5", "15"]) {
    assert.match(html, new RegExp(`<option value="${minutes}"`));
  }
});

test("CEX radar script persists auto-scan preferences and schedules scans", () => {
  assert.match(script, /RADAR_AUTO_SCAN_STORAGE_KEY/);
  assert.match(script, /RADAR_AUTO_SCAN_INTERVAL_STORAGE_KEY/);
  assert.match(script, /scheduleAutoScan/);
  assert.match(script, /clearAutoScanTimer/);
});
