const TIMEFRAME_SECONDS = Object.freeze({
  "1Min": 60, "5Min": 300, "15Min": 900, "30Min": 1800,
  "1Hour": 3600, "1Day": 86400, "1Week": 604800,
});

function finiteInteger(value, name) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
  return value;
}

function instant(value, name) {
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`${name} must be an ISO timestamp or finite epoch milliseconds`);
  return ms;
}

function timeframeSeconds(timeframe) {
  const seconds = TIMEFRAME_SECONDS[timeframe];
  if (!seconds) throw new TypeError(`unsupported crypto bar timeframe: ${timeframe}`);
  return seconds;
}

/**
 * Plan explicit non-overlapping provider requests. The planning bound is
 * intentionally conservative because some market-data wrappers expose a
 * provider page token without exposing the token to their caller.
 */
export function planCryptoHistoryWindows({
  start,
  end,
  timeframe = "1Hour",
  maxBarsPerWindow = 150,
  maxWindows = 256,
} = {}) {
  const startMs = instant(start, "start");
  const endMs = instant(end, "end");
  const intervalMs = timeframeSeconds(timeframe) * 1000;
  finiteInteger(maxBarsPerWindow, "maxBarsPerWindow");
  finiteInteger(maxWindows, "maxWindows");
  if (endMs <= startMs) throw new RangeError("end must be after start");
  if (maxBarsPerWindow < 2) throw new RangeError("maxBarsPerWindow must be at least 2");
  if (maxWindows < 1) throw new RangeError("maxWindows must be positive");

  const windows = [];
  let cursor = startMs;
  while (cursor <= endMs) {
    const windowEnd = Math.min(endMs, cursor + (maxBarsPerWindow - 1) * intervalMs);
    windows.push(Object.freeze({
      start: new Date(cursor).toISOString(),
      end: new Date(windowEnd).toISOString(),
      expectedMaximumBars: Math.floor((windowEnd - cursor) / intervalMs) + 1,
    }));
    if (windowEnd >= endMs) break;
    cursor = windowEnd + intervalMs;
    if (windows.length >= maxWindows) {
      throw new RangeError("crypto history request exceeds maxWindows");
    }
  }
  return Object.freeze(windows);
}

function parseBarTimestamp(bar, name) {
  const raw = bar?.t ?? bar?.timestamp ?? bar?.time;
  const ms = instant(raw, `${name}.timestamp`);
  return ms;
}

/**
 * Diagnose a single returned history page. A page-token is an explicit
 * incompleteness witness, never an implementation detail to ignore.
 */
export function assessCryptoBarsPage({
  symbol,
  timeframe = "1Hour",
  start,
  end,
  bars,
  nextPageToken = null,
  now = new Date().toISOString(),
  staleAfterSeconds,
} = {}) {
  if (typeof symbol !== "string" || !symbol.trim()) throw new TypeError("symbol must be non-empty");
  const startMs = instant(start, "start");
  const endMs = instant(end, "end");
  const nowMs = instant(now, "now");
  const intervalMs = timeframeSeconds(timeframe) * 1000;
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array");
  if (endMs <= startMs) throw new RangeError("end must be after start");
  if (nowMs < endMs) throw new RangeError("now must not precede requested end");

  const timestamps = bars.map((bar, i) => parseBarTimestamp(bar, `bars[${i}]`));
  if (timestamps.some((t) => t < startMs || t > endMs)) throw new RangeError("bar timestamp outside requested window");
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] <= timestamps[i - 1]) throw new RangeError("bar timestamps must be strictly increasing");
  }

  const expectedFirst = Math.floor(startMs / intervalMs) * intervalMs;
  const expectedLast = Math.floor(endMs / intervalMs) * intervalMs;
  let largestGapMs = 0;
  for (let i = 1; i < timestamps.length; i++) largestGapMs = Math.max(largestGapMs, timestamps[i] - timestamps[i - 1]);

  const missingBuckets = timestamps.length
    ? Math.max(0, Math.round((timestamps.at(-1) - timestamps[0]) / intervalMs) + 1 - timestamps.length)
    : 0;
  const pageTruncated = typeof nextPageToken === "string" && nextPageToken.length > 0;
  const missingStartCoverage = !timestamps.length || timestamps[0] > expectedFirst + intervalMs;
  const missingEndCoverage = !timestamps.length || timestamps.at(-1) < expectedLast - intervalMs;
  const gapTooLarge = largestGapMs > intervalMs * 1.5;

  let stale = false;
  if (staleAfterSeconds != null) {
    finiteInteger(staleAfterSeconds, "staleAfterSeconds");
    stale = nowMs - (timestamps.at(-1) ?? 0) > staleAfterSeconds * 1000;
  }

  const reasons = [];
  if (!timestamps.length) reasons.push("EMPTY");
  if (pageTruncated) reasons.push("PAGINATION_REQUIRED");
  if (missingStartCoverage) reasons.push("START_COVERAGE_MISSING");
  if (missingEndCoverage) reasons.push("END_COVERAGE_MISSING");
  if (gapTooLarge) reasons.push("MISSING_BUCKETS");
  if (stale) reasons.push("STALE");

  return Object.freeze({
    symbol,
    timeframe,
    requested: Object.freeze({ start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() }),
    count: bars.length,
    firstBarAt: timestamps[0] ? new Date(timestamps[0]).toISOString() : null,
    lastBarAt: timestamps.at(-1) ? new Date(timestamps.at(-1)).toISOString() : null,
    expectedFirstBarAt: new Date(expectedFirst).toISOString(),
    expectedLastBarAt: new Date(expectedLast).toISOString(),
    missingBuckets,
    largestGapSeconds: largestGapMs / 1000,
    pageTruncated,
    stale,
    complete: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}

/**
 * Combine already-retrieved chunk pages without silently repairing evidence.
 * Duplicate timestamps are collapsed only when their complete rows are exactly
 * identical; conflicting duplicate bars are rejected.
 */
export function mergeCryptoBarsPages(pages, { symbol, timeframe = "1Hour" } = {}) {
  if (!Array.isArray(pages) || !pages.length) throw new TypeError("at least one page is required");
  if (typeof symbol !== "string" || !symbol.trim()) throw new TypeError("symbol must be non-empty");
  const seen = new Map();
  const pageAssessments = [];

  for (const page of pages) {
    const assessment = page.assessment ?? assessCryptoBarsPage({
      symbol,
      timeframe,
      start: page.start,
      end: page.end,
      bars: page.bars,
      nextPageToken: page.nextPageToken ?? null,
      now: page.now,
    });
    pageAssessments.push(assessment);
    for (const bar of page.bars) {
      const key = String(parseBarTimestamp(bar, "bar"));
      const old = seen.get(key);
      if (old && JSON.stringify(old) !== JSON.stringify(bar)) throw new RangeError("conflicting duplicate crypto bar");
      seen.set(key, bar);
    }
  }

  const bars = [...seen.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, bar]) => bar);
  return Object.freeze({
    symbol,
    timeframe,
    bars: Object.freeze(bars),
    complete: pageAssessments.every((assessment) => assessment.complete),
    pages: pageAssessments.length,
    incompletePages: Object.freeze(pageAssessments.filter((assessment) => !assessment.complete)),
  });
}
