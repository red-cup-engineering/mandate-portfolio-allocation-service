/**
 * Shared-book capacity constraint for principal-separated portfolio decisions.
 *
 * Capital belongs to a principal; executable displayed venue liquidity does
 * not. Two separately optimized principal plans must not jointly claim the
 * same visible ask twice, even when quote aliases have different IDs or
 * observation times. This check composes admitted decisions, without creating
 * a second order, authority, ledger, signer or journal.
 *
 * For multiple snapshots of one market side, take the SMALLEST stated size.
 * Old/new snapshots do not constitute additive liquidity. This is a necessary
 * planning condition, not a sufficient fill guarantee.
 */
const named = s => typeof s === 'string' && s.trim().length > 0;
const finiteNonnegative = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function marketSideKey(quote) {
  if (!named(quote?.venue) || !named(quote?.instrument) ||
      !named(quote?.side) || !named(quote?.carrier))
    throw new TypeError('market-side identity requires venue, instrument, carrier and side');
  if (quote.venue === 'evm' &&
      (!Number.isSafeInteger(quote.chainId) || quote.chainId <= 0 ||
       !named(quote.protocol)))
    throw new TypeError('EVM market side requires chain and protocol');
  return JSON.stringify([
    quote.venue, quote.instrument, quote.carrier, quote.side,
    quote.venue === 'evm' ? quote.chainId : null,
    quote.venue === 'evm' ? quote.protocol : null,
  ]);
}

export function assertFleetBookCapacity(quotes, decisions) {
  if (!quotes || typeof quotes !== 'object' || Array.isArray(quotes) ||
      !Array.isArray(decisions))
    throw new TypeError('quoted markets and principal decisions required');

  const caps = new Map(), claimed = new Map(), owners = new Set();
  // Every alias of the same market side constrains a shared capacity. Do not
  // add different quote snapshots or account-specific estimates together.
  for (const [id, q] of Object.entries(quotes)) {
    if (!named(id) || q?.id !== id || !finiteNonnegative(q.availableUnits) ||
        (q.book !== undefined && !finiteNonnegative(q.book?.askSize)))
      throw new TypeError('unique quote identity and available ask-side units required');
    const key = marketSideKey(q);
    const available = Math.min(q.availableUnits, q.book?.askSize ?? Infinity);
    caps.set(key, Math.min(caps.get(key) ?? Infinity, available));
  }
  for (const decision of decisions) {
    if (!named(decision?.principal) || owners.has(decision.principal) ||
        !Array.isArray(decision.orders))
      throw new TypeError('one decision per named principal required');
    owners.add(decision.principal);
    for (const order of decision.orders) {
      const q = quotes[order?.id];
      if (!q) throw new RangeError('fleet order has no common quote');
      const key = marketSideKey(q);
      if (!finiteNonnegative(order.units) || !Number.isFinite(order.units) ||
          order.venue !== q.venue || order.instrument !== q.instrument ||
          order.carrier !== q.carrier || order.side !== q.side ||
          (q.venue === 'evm' &&
           (order.chainId !== q.chainId || order.protocol !== q.protocol)))
        throw new TypeError('fleet order differs from its common market-side quote');
      const next = (claimed.get(key) ?? 0) + order.units;
      if (!Number.isFinite(next)) throw new RangeError('aggregate fleet size overflow');
      claimed.set(key, next);
    }
  }
  for (const [key, amount] of claimed) {
    const cap = caps.get(key);
    // Representational slack only, not permission to round quantities UP.
    if (amount > cap + 1e-10 * Math.max(1, cap))
      throw new RangeError('fleet orders overclaim shared displayed market-side liquidity');
  }
  return true;
}
