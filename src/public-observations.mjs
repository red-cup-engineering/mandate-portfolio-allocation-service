/** Codecs from existing public information carriers to the shared market game.
 * Public availability and local observation time remain distinct.
 */
import { hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { admitSetOfFeedArrivals } from '@red-cup-engineering/communicating/messaging/newswire/feed-arrivals';

export function observation({ source, externalId, availableAt, observedAt, value, lineage = externalId, retrieval }) {
  const body = { source, externalId: String(externalId), availableAt, observedAt, lineage: String(lineage), value, ...(retrieval ? { retrieval } : {}) };
  return { kind: 'observe', observation: { id: hashPosition(body), ...body } };
}

/** communicating's CloudEvents newswire, including existing Kalshi sources. */
export function newswireObservation(event, observedAt) {
  const item = event.data?.item;
  if (!item) throw new TypeError('newswire item required');
  return observation({ source: event.data.feed.url, externalId: event.id, availableAt: item.published ?? event.time,
    observedAt, lineage: item.url ?? event.id, value: { kind: 'news', ...item } });
}

/** Reuse the house's RSS/Atom acquisition and deduplication; no new scraper. */
export async function readNewsObservations({ feeds, cursor, now = () => new Date().toISOString() }) {
  if (!Array.isArray(feeds) || feeds.length > 20) throw new RangeError('at most 20 news feeds per pass');
  const result = await admitSetOfFeedArrivals({ feeds, cursor, now });
  return { moves: result.events.map((event) => newswireObservation(event, event.time)), cursor: result.cursor, obstructions: result.obstructions };
}

/** The Alpaca news API's published message schema; credentials stay upstream. */
export function alpacaNewsObservation(message, observedAt) {
  if (message.T !== 'n' || !message.url || !Array.isArray(message.symbols)) throw new TypeError('Alpaca news message required');
  return observation({ source: message.url, externalId: `${message.id}:${message.updated_at}`, availableAt: message.updated_at ?? message.created_at,
    observedAt, lineage: String(message.id), value: { kind: 'news', headline: message.headline, summary: message.summary, symbols: message.symbols, publisher: message.source } });
}

/** Finalized RPC logs carry chain identity; a later reorg is evidence too. */
export function evmLogObservation({ chainId, log, finalized, blockTime }, observedAt) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !log.blockHash || !log.transactionHash || log.logIndex == null) throw new TypeError('EVM chain/log identity required');
  return observation({ source: `eip155:${chainId}/${log.address}`, externalId: `${log.blockHash}:${log.transactionHash}:${log.logIndex}:${Boolean(log.removed)}`,
    availableAt: blockTime, observedAt, lineage: `${chainId}:${log.transactionHash}:${log.logIndex}`,
    value: { kind: 'evm-log', chainId, finalized: Boolean(finalized), ...log } });
}

/** Bounded public JSON acquisition. Uses declared endpoints and exact selectors,
 * no exchange universe crawl and no conversion of a headline into an edge.
 */
export async function readPublicObservation({ source, externalId, path = [], availableAt, lineage, retainResponse = false }, { fetchImpl = fetch, now = new Date().toISOString(), maxBytes = 1048576 } = {}) {
  const url = new URL(source); if (url.protocol !== 'https:') throw new TypeError('public source requires HTTPS');
  const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`public source HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); throw new RangeError('public source byte limit'); }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0, text = '';
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength;
      if (bytes > maxBytes) throw new RangeError('public source byte limit'); text += decoder.decode(value, { stream: true }); }
  } finally { await reader.cancel(); }
  text += decoder.decode();
  if (retainResponse && bytes > 131072) throw new RangeError('retained research source must be <= 128 KiB');
  let value = JSON.parse(text);
  for (const key of path) { if (value == null || !(key in Object(value))) throw new TypeError(`public source selector missing ${key}`); value = value[key]; }
  // Fetch completion, rather than fetch start, is the admissible local clock.
  const observedAt = new Date(Math.max(Date.parse(now), Date.now())).toISOString();
  return observation({ source, externalId, availableAt: availableAt ?? observedAt, observedAt, value, lineage,
    ...(retainResponse ? { retrieval: { requestedUrl: source, finalUrl: response.url || source, text, responseBytes: bytes,
      selector: path, responseDigest: hashPosition(text), acquiredAt: observedAt } } : {}) });
}

/** State-price bands for one mutually ordered macro threshold event. Bid/ask
 * uncertainty is retained; no midpoint is presented as a physical forecast. */
export function kalshiMacroObservation(move, observedAt) {
  const parent = move?.observation;
  if (move?.kind !== 'observe' || !parent?.id || !parent.source?.startsWith('https://api.elections.kalshi.com/trade-api/v2/markets?')) throw new TypeError('observed-public-Kalshi-markets-required');
  const markets = parent.value?.markets ?? parent.value;
  if (!Array.isArray(markets) || markets.length < 2 || markets.length > 128 || parent.value?.cursor) throw new RangeError('complete-bounded-macro-event-required');
  if (!Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) < Date.parse(parent.observedAt)) throw new RangeError('macro-observation-clock-invalid');
  const event = markets[0].event_ticker;
  const rows = markets.map(m => {
    if (m.event_ticker !== event || m.strike_type !== 'greater' || m.status !== 'active') throw new TypeError('single-active-threshold-event-required');
    const threshold = Number(m.floor_strike), bid = Number(m.yes_bid_dollars), ask = Number(m.yes_ask_dollars);
    if (m.floor_strike == null || m.yes_bid_dollars == null || m.yes_ask_dollars == null || ![threshold,bid,ask].every(Number.isFinite) || bid < 0 || ask > 1 || bid > ask) throw new RangeError('valid-threshold-price-band-required');
    if (!Number.isFinite(Date.parse(m.close_time)) || Date.parse(m.close_time) <= Date.parse(observedAt)) throw new RangeError('macro-event-closed');
    return { ticker: m.ticker, threshold, bid, ask, closeTime: m.close_time };
  }).sort((a,b) => a.threshold-b.threshold);
  if (rows.some((r,i) => i && (r.threshold === rows[i-1].threshold || r.closeTime !== rows[0].closeTime))) throw new TypeError('unique-thresholds-and-one-event-clock-required');
  const bands = rows.map((r,i) => ({ ...r,
    lower: Math.max(...rows.slice(i).map(x=>x.bid)),
    upper: Math.min(...rows.slice(0,i+1).map(x=>x.ask)),
  }));
  if (bands.some(r=>r.lower>r.upper)) throw new RangeError('inconsistent-macro-state-price-bands');
  return observation({ source: parent.source, externalId: `${event}:state-price-bands`, lineage: event,
    availableAt: parent.availableAt, observedAt,
    value: { kind: 'macro-state-price-bands', event, sourceObservationIds: [parent.id],
      interpretation: 'risk-neutral-threshold-bands-before-fees', bands,
      signals: Object.fromEntries(bands.map(b => [b.ticker, { midpoint: (b.lower + b.upper) / 2, spread: b.upper - b.lower }])) } });
}
