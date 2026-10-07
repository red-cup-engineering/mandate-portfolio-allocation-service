import test from "node:test";
import assert from "node:assert/strict";
import {
  planCryptoHistoryWindows,
  assessCryptoBarsPage,
  mergeCryptoBarsPages,
} from "../src/crypto-historical-observations.mjs";

const bar = (t, close = 100) => ({ t: new Date(t).toISOString(), o: close, h: close + 1, l: close - 1, c: close, v: 1 });

test("hourly 45-day history is split into bounded explicit windows", () => {
  const windows = planCryptoHistoryWindows({
    start: "2026-08-23T00:00:00Z",
    end: "2026-10-07T00:00:00Z",
    timeframe: "1Hour",
    maxBarsPerWindow: 150,
  });
  assert.equal(windows.length, 8);
  assert.ok(windows.every((window) => window.expectedMaximumBars <= 150));
  for (let i = 1; i < windows.length; i++) {
    assert.equal(
      Date.parse(windows[i].start),
      Date.parse(windows[i - 1].end) + 3600 * 1000,
    );
  }
});

test("an exposed page token makes the evidence explicitly incomplete", () => {
  const assessment = assessCryptoBarsPage({
    symbol: "BTC/USD",
    timeframe: "1Hour",
    start: "2026-09-07T00:00:00Z",
    end: "2026-10-07T00:00:00Z",
    bars: Array.from({ length: 150 }, (_, i) => bar(2026, i)),
    nextPageToken: "opaque-token",
    now: "2026-10-07T00:01:00Z",
  });
  assert.equal(assessment.complete, false);
  assert.equal(assessment.pageTruncated, true);
  assert.ok(assessment.reasons.includes("PAGINATION_REQUIRED"));
});

test("missing hourly buckets are detected rather than reconstructed", () => {
  const bars = [
    bar("2026-10-07T00:00:00Z"),
    bar("2026-10-07T01:00:00Z"),
    bar("2026-10-07T04:00:00Z"),
  ];
  const assessment = assessCryptoBarsPage({
    symbol: "BTC/USD",
    timeframe: "1Hour",
    start: "2026-10-07T00:00:00Z",
    end: "2026-10-07T04:00:00Z",
    bars,
    now: "2026-10-07T05:00:00Z",
  });
  assert.equal(assessment.complete, false);
  assert.equal(assessment.missingBuckets, 2);
  assert.ok(assessment.reasons.includes("MISSING_BUCKETS"));
});

test("chunked pages merge identical boundary bars but reject conflicts", () => {
  const first = [bar("2026-10-07T00:00:00Z", 100), bar("2026-10-07T01:00:00Z", 101)];
  const second = [bar("2026-10-07T01:00:00Z", 101), bar("2026-10-07T02:00:00Z", 102)];
  const merged = mergeCryptoBarsPages([
    { start: "2026-10-07T00:00:00Z", end: "2026-10-07T01:00:00Z", bars: first, now: "2026-10-07T03:00:00Z" },
    { start: "2026-10-07T01:00:00Z", end: "2026-10-07T02:00:00Z", bars: second, now: "2026-10-07T03:00:00Z" },
  ], { symbol: "BTC/USD", timeframe: "1Hour" });
  assert.equal(merged.bars.length, 3);
  assert.equal(merged.complete, true);

  assert.throws(() => mergeCryptoBarsPages([
    { start: "2026-10-07T00:00:00Z", end: "2026-10-07T01:00:00Z", bars: first, now: "2026-10-07T03:00:00Z" },
    { start: "2026-10-07T01:00:00Z", end: "2026-10-07T02:00:00Z", bars: [bar("2026-10-07T01:00:00Z", 999), bar("2026-10-07T02:00:00Z", 102)], now: "2026-10-07T03:00:00Z" },
  ], { symbol: "BTC/USD", timeframe: "1Hour" }), /conflicting duplicate/);
});
