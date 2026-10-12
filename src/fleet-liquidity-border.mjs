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
// Code-point ordering, not process-locale collation: hashed plans replay equally.
const lexical = (a,b) => a < b ? -1 : a > b ? 1 : 0;

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

/**
 * Deterministic finite-capacity clearing of independently optimized demand.
 *
 * This is a Hamilton/largest-remainder apportionment on the actual integer
 * order-lot lattice, NOT an independent portfolio solver or authority grant.
 *
 * The common book supplies one quantity of lots; principals supply their
 * already-sized demand. If demand exceeds book supply, allocate as close as
 * possible to proportional demand subject to integral lots. Equal remainders
 * break ties by principal identifier, independent of input iteration order.
 *
 * The consuming fleet MUST rerun its full joint scenario optimizer within
 * these per-principal quotas. A quota is NOT itself an executable order or
 * proof of a profitable strategy. Underfilled quotas are not borrowed by a
 * different principal without a new clearing round.
 */
export function apportionFleetBookDemand(quotes, decisions) {
  if (!quotes || typeof quotes !== 'object' || Array.isArray(quotes) ||
      !Array.isArray(decisions))
    throw new TypeError('quotes and candidate principal decisions required');
  const caps = new Map(), lotSteps = new Map();
  for (const [id, q] of Object.entries(quotes)) {
    if (!named(id) || q?.id !== id ||
        !finiteNonnegative(q.availableUnits) ||
        (q.book !== undefined && !finiteNonnegative(q.book?.askSize)) ||
        !Number.isFinite(q.unitStep) || !(q.unitStep > 0))
      throw new TypeError('market quote requires named ID, finite capacity and positive unit step');
    const key = marketSideKey(q);
    const previous = lotSteps.get(key);
    if (previous !== undefined && previous !== q.unitStep)
      throw new RangeError('market-side aliases disagree about the executable lot step');
    lotSteps.set(key, q.unitStep);
    caps.set(key, Math.min(caps.get(key) ?? Infinity, q.availableUnits,
      q.book?.askSize ?? Infinity));
  }
  const owners = new Set();
  const demands = new Map([...caps.keys()].map(key => [key, new Map()]));
  const lotsOf = (units, step) => {
    if (!finiteNonnegative(units)) throw new TypeError('nonnegative finite quantity required');
    const lots = Math.round(units / step);
    if (!Number.isSafeInteger(lots) || lots < 0 ||
        Math.abs(lots * step - units) > Math.max(
          step * 1e-7, 16 * Number.EPSILON * Math.max(step, units)))
      throw new RangeError('order quantity is not an exact market-side lot multiple');
    return lots;
  };
  for (const d of decisions) {
    if (!named(d?.principal) || owners.has(d.principal) || !Array.isArray(d.orders))
      throw new TypeError('unique principal decision and order set required');
    owners.add(d.principal);
    for (const order of d.orders) {
      const q = quotes[order?.id];
      if (!q) throw new TypeError('planned order refers to an unknown market quote');
      if (order.venue !== q.venue || order.instrument !== q.instrument ||
          order.carrier !== q.carrier || order.side !== q.side ||
          (q.venue === 'evm' && (order.chainId !== q.chainId ||
                                order.protocol !== q.protocol)))
        throw new TypeError('planned order and market side disagree');
      if (order.unitStep !== q.unitStep)
        throw new TypeError('planned order lot step differs from market quote');
      const key = marketSideKey(q), n = lotsOf(order.units, q.unitStep);
      const byPrincipal = demands.get(key);
      const total = (byPrincipal.get(d.principal) ?? 0) + n;
      if (!Number.isSafeInteger(total)) throw new RangeError('principal market lot demand overflow');
      byPrincipal.set(d.principal, total);
    }
  }
  const quotasByPrincipal = Object.fromEntries([...owners].sort().map(p => [p, {}]));
  let oversubscribed = false;
  for (const [key, cap] of [...caps].sort(([a],[b]) => lexical(a,b))) {
    const step = lotSteps.get(key);
    const requested = demands.get(key);
    const entries = [...owners].sort(lexical).map(principal => ({
      principal, demand: requested.get(principal) ?? 0, lots: 0, remainder: 0,
    }));
    const total = entries.reduce((n,e) => n + e.demand, 0);
    if (!Number.isSafeInteger(total))
      throw new RangeError('fleet market lot demand overflow');
    // Quoted decimal steps such as 0.1 are binary floating values:
    // 0.3/0.1 often evaluates to 2.9999999999999996. Correct only such
    // representational ulps, never an economically material lot shortfall.
    const ratio = cap / step;
    const nearest = Math.round(ratio);
    const nearlyInteger = Number.isFinite(ratio) &&
      Math.abs(ratio-nearest) <= Math.min(1e-8,
        8 * Number.EPSILON * Math.max(1,Math.abs(ratio)));
    const availableLots = !Number.isFinite(ratio) ||
      ratio >= Number.MAX_SAFE_INTEGER ? total :
      Math.min(total,nearlyInteger ? nearest : Math.floor(ratio));
    if (!Number.isSafeInteger(availableLots) || availableLots < 0)
      throw new RangeError('market capacity cannot be expressed in safe integer lots');
    if (total <= availableLots) {
      for (const e of entries) e.lots = e.demand;
    } else {
      oversubscribed = true;
      let assigned = 0;
      for (const e of entries) {
        const ideal = availableLots * (e.demand / total);
        e.lots = Math.min(e.demand, Math.floor(ideal));
        e.remainder = ideal - e.lots;
        assigned += e.lots;
      }
      // Hamilton largest remainders; at most one extra lot per principal,
      // because the sum of fractional remainders is an integer < row count.
      const priority = entries.filter(e => e.lots < e.demand)
        .sort((a,b) => b.remainder - a.remainder ||
          lexical(a.principal,b.principal));
      for (let i=0; i<availableLots-assigned; i++) {
        if (!priority[i]) throw new RangeError('insufficient eligible remainder recipients');
        priority[i].lots++;
      }
    }
    if (entries.reduce((n,e)=>n+e.lots,0) > availableLots)
      throw new RangeError('cleared integer lots exceed the common market-side book');
    for (const e of entries) quotasByPrincipal[e.principal][key] = e.lots * step;
  }
  return Object.freeze({
    kind: 'fleet-proportional-integer-book-clearing-v1',
    oversubscribed, quotasByPrincipal,
    allocationRule: 'largest-remainder-proportional-demand-in-executable-lots',
    effect: 'planning-constraint-only',
  });
}
