/** A shared, replayable evidence-to-portfolio game. No credentials or venue writes.
 * Independent venue observations commute; decisions bind the entire position.
 * A news item is evidence, never an implicit probability or an order.
 */
import { gameRules, hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { jointKellyForScenarioReturns } from '@red-cup-engineering/position-sizing-service';

const finite = (x, label) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`${label}: finite number required`); return x; };
const nonnegative = (x, label) => { finite(x, label); if (x < 0) throw new RangeError(`${label}: negative`); return x; };
const time = (x) => { if (!Number.isFinite(Date.parse(x))) throw new TypeError('ISO timestamp required'); return Date.parse(x); };
const name = (x) => { if (typeof x !== 'string' || !x.trim()) throw new TypeError('nonempty identifier required'); return x; };
const money = (x) => { nonnegative(x, 'cents'); if (!Number.isSafeInteger(x)) throw new TypeError('integer cents required'); return x; };
const venue = (x) => { if (!['kalshi', 'alpaca', 'evm'].includes(x)) throw new TypeError('venue must be kalshi, alpaca or evm'); return x; };
const initial = () => ({ observations: {}, accounts: {}, quotes: {}, strategies: {}, forecast: null, decisions: {}, outcomes: {} });
const newer = (old, next) => !old || time(next.observedAt) > time(old.observedAt) || (time(next.observedAt) === time(old.observedAt) && hashPosition(next) > hashPosition(old));
const put = (table, id, row) => newer(table[id], row) ? { ...table, [id]: row } : table;

function extend(state, move) {
  let next;
  switch (move.kind) {
    case 'observe': {
      const row = move.observation;
      name(row.id); name(row.source); time(row.availableAt); time(row.observedAt);
      if (time(row.availableAt) > time(row.observedAt)) throw new RangeError('observation precedes public availability');
      if (row.value === undefined) throw new TypeError('observation value required');
      if (state.observations[row.id] && hashPosition(state.observations[row.id]) !== hashPosition(row)) throw new RangeError('observation identity reused with different evidence');
      next = { ...state, observations: { ...state.observations, [row.id]: row } }; break;
    }
    case 'account': {
      const row = move.account; venue(row.venue); time(row.observedAt);
      if (row.principal !== undefined) name(row.principal);
      money(row.equityCents); money(row.freeCashCents); money(row.reservedCents ?? 0);
      if (row.freeCashCents > row.equityCents) throw new RangeError('deployable cash exceeds equity; borrowing is not equity');
      for (const [instrument, holding] of Object.entries(row.inventory ?? {})) {
        name(instrument); nonnegative(holding.units, 'held inventory units'); nonnegative(holding.availableUnits, 'available inventory units');
        if (!(finite(holding.markPrice, 'inventory mark') > 0) || holding.availableUnits > holding.units) throw new RangeError('inventory availability or mark invalid');
      }
      next = { ...state, accounts: put(state.accounts, row.venue, row) }; break;
    }
    case 'quote': {
      const row = move.quote; name(row.id); venue(row.venue); name(row.instrument); time(row.observedAt);
      finite(row.entryPrice, 'entry price'); if (row.entryPrice <= 0) throw new RangeError('positive entry price required');
      if (!(finite(row.unitStep, 'unit step') > 0)) throw new RangeError('positive unit step required');
      nonnegative(row.availableUnits, 'displayed liquidity');
      nonnegative(row.transitionCostFraction, 'round-trip transaction cost'); nonnegative(row.carryCostFraction, 'holding cost');
      if (!['binary', 'asset', 'collateral'].includes(row.carrier)) throw new TypeError('quote carrier required');
      if (!['yes', 'no', 'long', 'short'].includes(row.side)) throw new TypeError('quote side required');
      if (row.carrier === 'asset' && row.side !== 'long') throw new TypeError('shorts require a collateral payoff model');
      if (row.carrier === 'binary' && (!['yes', 'no'].includes(row.side) || row.entryPrice >= 1)) throw new TypeError('binary entry must be a YES/NO price below one dollar');
      if (row.funding !== undefined) {
        if (row.venue !== 'evm') throw new TypeError('inventory exchanges require an EVM venue consumer');
        name(row.funding.instrument);
        if (!(finite(row.funding.unitsPerUnit, 'funding units per acquired unit') > 0)) throw new RangeError('positive funding quantity required');
      }
      next = { ...state, quotes: put(state.quotes, row.id, row) }; break;
    }
    case 'strategy': {
      const row = move.strategy; name(row.id); time(row.observedAt);
      if (!Array.isArray(row.quoteIds) || new Set(row.quoteIds).size !== row.quoteIds.length) throw new TypeError('unique strategy quote IDs required');
      row.quoteIds.forEach(name);
      if (!Array.isArray(row.evidenceIds) || !row.evidenceIds.length) throw new TypeError('strategy requires source evidence');
      row.evidenceIds.forEach(name); name(row.thesis); name(row.falsifier);
      next = { ...state, strategies: put(state.strategies, row.id, row) }; break;
    }
    case 'forecast': {
      const row = move.forecast; name(row.id); time(row.observedAt); time(row.horizon);
      if (!Array.isArray(row.scenarios) || row.scenarios.length < 2 || row.scenarios.length > 512) throw new TypeError('2..512 shared scenarios required');
      if (new Set(row.scenarios.map((s) => name(s.id))).size !== row.scenarios.length) throw new TypeError('unique scenario IDs required');
      let mass = 0; for (const s of row.scenarios) { mass += nonnegative(s.probability, 'scenario probability'); if (!s.values || !s.heldPnlCentsByVenue) throw new TypeError('scenario values and existing holdings P&L required'); }
      if (Math.abs(mass - 1) > 1e-9) throw new RangeError('scenario probabilities must sum to one');
      if (!Array.isArray(row.evidenceIds) || !row.evidenceIds.length) throw new TypeError('forecast evidence required');
      next = { ...state, forecast: newer(state.forecast, row) ? row : state.forecast }; break;
    }
    case 'condition': {
      const forecast = conditionMarketForecast(state, move.observationId, move.model, move.at);
      return extend(state, { kind: 'forecast', forecast });
    }
    case 'decide': {
      const decision = planMarket(state, move.policy, move.at);
      if (move.expectedPosition !== hashPosition(state)) throw new RangeError('decision was based on another position');
      next = { ...state, decisions: { ...state.decisions, [decision.id]: decision } }; break;
    }
    case 'outcome': {
      const row = move.outcome; const d = state.decisions[row.decisionId];
      if (!d || !d.orders.some((o) => o.id === row.orderId)) throw new TypeError('outcome must reference a planned order');
      name(row.id); name(row.receipt); time(row.observedAt); finite(row.pnlCents, 'realized P&L');
      if (state.outcomes[row.id] && hashPosition(state.outcomes[row.id]) !== hashPosition(row)) throw new RangeError('outcome identity reused');
      if (Object.values(state.outcomes).some((o) => o.id !== row.id && o.receipt === row.receipt)) throw new RangeError('receipt already counted as an outcome');
      next = { ...state, outcomes: { ...state.outcomes, [row.id]: row } }; break;
    }
    default: throw new TypeError(`unknown market move ${move.kind}`);
  }
  return { state: next, events: [{ kind: move.kind, polarity: ['strategy', 'forecast', 'decide'].includes(move.kind) ? 'P' : 'O' }] };
}

export const marketGame = gameRules(initial, extend);

/** A measured likelihood model lets a prediction-market probability, release
 * value, or upstream numeric news feature update the COMMON scenarios. The
 * likelihood table and its out-of-sample calibration are observed evidence.
 * Repeated observations recompute from the same prior rather than counting
 * one publisher's revised telling as independent evidence. Multiple signals
 * need a jointly calibrated model, not a product of assumed independences.
 */
export function conditionMarketForecast(state, observationId, model, at) {
  const f = state.forecast, o = state.observations[observationId], evidence = state.observations[model?.evidenceId];
  if (!f || !o || !evidence || time(o.observedAt) > time(at) || time(evidence.observedAt) > time(at)) throw new RangeError('conditioning requires presently available evidence');
  if (f.conditioning && f.conditioning.model !== model.evidenceId) throw new RangeError('multiple signals require one jointly calibrated model');
  if (evidence.value?.kind !== 'scenario-likelihood-model' || hashPosition(evidence.value.model) !== hashPosition(model.specification)) throw new TypeError('conditioning model differs from its observed evidence');
  const spec = model.specification;
  if (o.source !== spec.source) throw new TypeError('conditioning source differs from its calibrated model');
  let value = o.value; for (const key of spec.path ?? []) value = value?.[key]; finite(value, 'conditioning feature');
  if (!Array.isArray(spec.bins) || spec.bins.length > 128) throw new TypeError('bounded calibrated likelihood bins required');
  const matches = spec.bins.filter((bin) => value >= bin.lower && value < bin.upper);
  if (matches.length !== 1) throw new RangeError('conditioning value needs exactly one calibrated bin');
  const base = f.baseProbabilities ?? Object.fromEntries(f.scenarios.map((s) => [s.id, s.probability]));
  if (spec.prior && (Object.keys(spec.prior).length !== f.scenarios.length || f.scenarios.some(s => !Number.isFinite(spec.prior[s.id]) || Math.abs(base[s.id] - spec.prior[s.id]) > 1e-9))) throw new RangeError('conditioning-prior-differs-from-scored-study');
  const weighted = f.scenarios.map((s) => {
    const likelihood = nonnegative(matches[0].likelihoods[s.id], 'scenario likelihood');
    if (likelihood > 1) throw new RangeError('binned scenario likelihood exceeds one');
    return base[s.id] * likelihood;
  });
  const mass = weighted.reduce((a, b) => a + b, 0); if (!(mass > 0)) throw new RangeError('observation has no likelihood under this model');
  const body = { ...f, observedAt: at, baseProbabilities: base, scenarios: f.scenarios.map((s, k) => ({ ...s, probability: weighted[k] / mass })),
    calibration: spec.calibration, evidenceIds: [...new Set([...f.evidenceIds, observationId, model.evidenceId, spec.calibration.record])].sort(),
    conditioning: { observation: observationId, model: model.evidenceId, value, bin: spec.bins.indexOf(matches[0]) } };
  return { ...body, id: hashPosition(body) };
}

/** Measure outcomes from receipts; an unfilled proposal contributes no win. */
export function strategyPerformance(state) {
  const by = {};
  for (const row of Object.values(state.outcomes)) {
    const order = state.decisions[row.decisionId].orders.find((o) => o.id === row.orderId);
    const s = by[order.strategy] ??= { observations: 0, pnlCents: 0 };
    s.observations += 1; s.pnlCents += row.pnlCents;
  }
  return by;
}

/** Joint scenarios carry common-factor dependence across all three venues.
 * Limits act on funded capital; they do not imply fungible venue cash or atomic
 * cross-venue execution. Existing holdings enter every scenario explicitly.
 */
export function planMarket(state, policy, at) {
  if (!policy || !Number.isSafeInteger(policy.minCalibrationSamples) || policy.minCalibrationSamples < 1) throw new TypeError('positive calibration sample minimum required');
  for (const field of ['maxDeployFraction', 'maxInstrumentFraction', 'maxScenarioLossFraction']) if (!(finite(policy[field], field) > 0) || policy[field] > 1) throw new RangeError(`${field} must be in (0,1]`);
  const now = time(at); const f = state.forecast;
  const maxAge = nonnegative(policy.maxObservationAgeMs, 'observation age');
  const fresh = (row) => row && time(row.observedAt) <= now && now - time(row.observedAt) <= maxAge;
  const evidenceOK = (ids) => ids.every((id) => { const row = state.observations[id]; return row && time(row.observedAt) <= now && time(row.availableAt) <= now; });
  if (!fresh(f) || time(f.horizon) <= now || !evidenceOK(f.evidenceIds)) throw new RangeError('forecast unavailable, expired or uses future/missing evidence');
  const calibration = f.calibration;
  if (!calibration || !Number.isSafeInteger(calibration.sampleSize) || calibration.sampleSize < policy.minCalibrationSamples
    || !Number.isFinite(calibration.brier) || !Number.isFinite(calibration.baselineBrier) || calibration.brier < 0 || calibration.brier >= calibration.baselineBrier
    || !calibration.record || !f.evidenceIds.includes(calibration.record) || time(calibration.windowEnd) > time(f.observedAt)) throw new RangeError('forecast lacks measured calibration better than its baseline');
  const measured = state.observations[calibration.record]?.value;
  if (measured?.kind !== 'calibration' || measured.sampleSize !== calibration.sampleSize || measured.brier !== calibration.brier || measured.baselineBrier !== calibration.baselineBrier || measured.windowEnd !== calibration.windowEnd) throw new TypeError('forecast calibration differs from its scored evidence');
  // Every funded strategy needs measured confidence, regardless of method
  // name or whether prediction-market conditioning metadata is present.
  {
    if (!Array.isArray(measured.liveUseLimitations)||measured.liveUseLimitations.length)throw new RangeError('study has unresolved live-use limitations');
    if (!Number.isFinite(calibration.confidenceLowerBound) || calibration.confidenceLowerBound<=0
        || !Number.isFinite(calibration.netReturnConfidenceLowerBound) || calibration.netReturnConfidenceLowerBound<=0)
      throw new RangeError('financial strategy lacks positive measured calibration and net-return confidence');
    if (measured.confidenceLowerBound!==calibration.confidenceLowerBound
        || measured.netReturnConfidenceLowerBound!==calibration.netReturnConfidenceLowerBound)
      throw new TypeError('strategy confidence differs from scored evidence');
  }
  const accounts = Object.values(state.accounts).sort((a, b) => a.venue.localeCompare(b.venue));
  if (!accounts.length || accounts.some((a) => !fresh(a))) throw new RangeError('fresh account readings required');
  const principal = name(policy.principal);
  if (accounts.some(account => account.principal !== principal)) throw new TypeError('funded accounts must belong to the declared decision principal');
  const equity = accounts.reduce((s, a) => s + a.equityCents, 0); if (equity <= 0) throw new RangeError('positive portfolio equity required');
  const baseline = f.scenarios.map((s) => 1 + accounts.reduce((pnl, a) => pnl + finite(s.heldPnlCentsByVenue[a.venue], `held P&L ${a.venue}`), 0) / equity);
  const skips = [], candidates = [], seen = new Set();
  for (const strategy of Object.values(state.strategies).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const id of strategy.quoteIds) {
      const q = state.quotes[id];
      const refuse = (reason) => skips.push({ strategy: strategy.id, id, reason });
      if (strategy.falsifierFired) { refuse('strategy falsified'); continue; }
      if (!evidenceOK(strategy.evidenceIds)) { refuse('future or missing strategy evidence'); continue; }
      if (!fresh(q) || !state.accounts[q?.venue]) { refuse('quote/account absent or stale'); continue; }
      if (time(q.horizon) !== time(f.horizon)) { refuse('payoff horizon differs from the common scenarios'); continue; }
      if (q.stale || q.availableUnits < q.unitStep) { refuse('no known executable liquidity'); continue; }
      if (q.venue === 'alpaca' && !['us_equity', 'crypto'].includes(q.assetClass)) { refuse('Alpaca asset class required'); continue; }
      if (seen.has(id)) { refuse('same liquidity already claimed by another strategy'); continue; }
      if (q.venue === 'evm' && (!Number.isSafeInteger(q.chainId) || !q.blockHash || !q.finalized || !q.protocol)) { refuse('EVM quote lacks finalized chain/protocol identity'); continue; }
      if (q.venue === 'evm' && q.carrier === 'collateral' && (!(q.leverage > 0) || !Number.isFinite(q.leverage) || !q.collateralToken)) { refuse('collateral payoff requires leverage and token identity'); continue; }
      if (q.funding && q.venue !== 'evm') throw new TypeError('inventory exchanges require an EVM venue consumer');
      const holding = q.funding && state.accounts[q.venue].inventory?.[q.funding.instrument];
      if (q.funding && (!holding || !(holding.availableUnits > 0))) { refuse('funding inventory absent or unavailable'); continue; }
      if (q.funding && Math.abs(q.funding.unitsPerUnit * holding.markPrice - q.entryPrice) > 1e-9 * Math.max(1, q.entryPrice)) throw new RangeError('funding inventory mark differs from entry value');
      const capitalPerUnit = q.entryPrice * (1 + q.transitionCostFraction + q.carryCostFraction);
      const fundingUnitsPerUnit = q.funding ? q.funding.unitsPerUnit * (1 + q.transitionCostFraction + q.carryCostFraction) : null;
      const returns = f.scenarios.map((s) => {
        // For collateral instruments each scenario states net payoff per unit
        // of collateral INCLUDING liquidation/ADL and protocol-specific effects.
        const value = finite(s.values[id], `scenario ${s.id} payoff ${id}`);
        if (q.carrier === 'binary' && (value < 0 || value > 1)) throw new RangeError('binary settlement value outside [0,1]');
        const payout = q.carrier === 'binary' && q.side === 'no' ? 1 - value : value;
        // The held funding asset is already in baseline wealth. Exchanging it
        // removes its future value, including inventory reserved for costs.
        const spent = q.funding ? fundingUnitsPerUnit * nonnegative(s.fundingValues?.[q.funding.instrument], `scenario ${s.id} funding value ${q.funding.instrument}`) : capitalPerUnit;
        return (payout - spent) / capitalPerUnit;
      });
      seen.add(id); candidates.push({ strategy, q, capitalPerUnit, fundingUnitsPerUnit, returns });
    }
  }
  const constraints = [];
  const add = (coefficients, cap) => constraints.push({ coefficients, cap });
  for (const account of accounts) {
    add(candidates.map(({ q }) => Number(q.venue === account.venue && !q.funding)), Math.max(0, account.freeCashCents - (policy.minCashCentsByVenue?.[account.venue] ?? 0)) / equity);
    for (const [instrument, holding] of Object.entries(account.inventory ?? {})) {
      add(candidates.map(({ q, capitalPerUnit, fundingUnitsPerUnit }) => q.venue === account.venue && q.funding?.instrument === instrument ? fundingUnitsPerUnit * equity / (capitalPerUnit * 100) : 0), holding.availableUnits);
    }
  }
  for (const [i, { q, capitalPerUnit }] of candidates.entries()) {
    const cap = Math.min(nonnegative(policy.maxInstrumentFraction, 'instrument cap'), q.availableUnits * capitalPerUnit * 100 / equity);
    add(candidates.map((_, j) => Number(i === j)), cap);
  }
  for (const [factor, cap] of Object.entries(policy.factorCaps ?? {})) {
    const held = accounts.reduce((s, a) => s + nonnegative(a.factorExposureCents?.[factor] ?? 0, 'held factor exposure'), 0) / equity;
    const loadings = candidates.map(({ q }) => q.funding ? finite(q.factors?.[factor] ?? 0, 'inventory exchange factor change') : nonnegative(q.factors?.[factor] ?? 0, 'factor loading'));
    add(loadings, nonnegative(cap, 'factor cap') - held);
    if (loadings.some(value => value < 0)) add(loadings.map(value => -value), held);
  }
  const maxLoss = nonnegative(policy.maxScenarioLossFraction, 'scenario loss');
  f.scenarios.forEach((s, k) => add(candidates.map((c) => -c.returns[k]), maxLoss + baseline[k] - 1));
  const sized = jointKellyForScenarioReturns({ scenarios: f.scenarios.map((s, k) => ({ probability: s.probability, returns: candidates.map((c) => c.returns[k]) })), baselineWealth: baseline, constraints, budget: policy.maxDeployFraction, maxIterations: 3000, tolerance: 1e-8 });
  if (!sized.converged) throw new RangeError(`joint sizing did not converge (${sized.kktResidual})`);
  const multiple = nonnegative(policy.kellyMultiple, 'Kelly multiple'); if (multiple > 1) throw new RangeError('market plan requires Kelly multiple <= 1');
  const orders = [];
  candidates.forEach(({ strategy, q, capitalPerUnit, fundingUnitsPerUnit, returns }, i) => {
    const room = Math.floor(sized.fractions[i] * multiple * equity);
    const units = Math.floor(room / (capitalPerUnit * 100) / q.unitStep + 1e-10) * q.unitStep;
    if (units < q.unitStep) { skips.push({ strategy: strategy.id, id: q.id, reason: 'no funded edge under joint limits' }); return; }
    // Round the money upward at the boundary; executable quantity is rounded down.
    const capitalCents = Math.ceil(units * capitalPerUnit * 100 - 1e-9);
    orders.push({ id: q.id, strategy: strategy.id, venue: q.venue, instrument: q.instrument, carrier: q.carrier, side: q.side, units, unitStep: q.unitStep, entryPrice: q.entryPrice, capitalCents,
      expectedReturn: returns.reduce((r, x, k) => r + f.scenarios[k].probability * x, 0), returns,
      ...(q.venue === 'evm' ? { chainId: q.chainId, blockHash: q.blockHash, protocol: q.protocol, ...(q.carrier === 'collateral' ? { leverage: q.leverage, collateralToken: q.collateralToken } : {}) } : {}),
      ...(q.venue === 'alpaca' ? { assetClass: q.assetClass } : {}),
      ...(q.funding ? { funding: { instrument: q.funding.instrument, units: units * fundingUnitsPerUnit } } : {}),
      evidence: [...new Set([...strategy.evidenceIds, ...f.evidenceIds])].sort(), thesis: strategy.thesis, falsifier: strategy.falsifier });
  });
  // Monetary rounding and signed hedge returns can invalidate continuous limits.
  // Admit only the actually executable discrete portfolio; never silently claim
  // that an optimizer's fractional portfolio proves a different order batch.
  const fractions = candidates.map(({ q }) => (orders.find((o) => o.id === q.id)?.capitalCents ?? 0) / equity);
  if (constraints.some(({ coefficients: a, cap }) => a.reduce((s, x, i) => s + x * fractions[i], 0) > cap + 1e-9)) throw new RangeError('discrete quantities breach joint limits');
  const body = { type: 'MarketGameDecision', principal, at, position: hashPosition(state), forecast: f.id, horizon: f.horizon, orders, skips, equityCents: equity,
    scenarioWealth: f.scenarios.map((s, k) => ({ id: s.id, probability: s.probability, wealth: baseline[k] + candidates.reduce((sum, c, i) => sum + c.returns[k] * fractions[i], 0) })),
    sizing: { converged: sized.converged, kktResidual: sized.kktResidual }, performance: strategyPerformance(state), effect: 'intent-only' };
  return { id: hashPosition(body), ...body };
}

/** Venue consumers use the funded decision as a cap, with a matching horizon.
 * It is never an authority grant or an execution receipt. */
export function allocationsFor(decision, { venue: v, principal, instrument, side, chainId, protocol, at, maxAgeMs = 60000 }) {
  venue(v); const age = time(at) - time(decision?.at);
  if (decision?.type !== 'MarketGameDecision' || decision.effect !== 'intent-only' || age < 0 || age > maxAgeMs || time(decision.horizon) <= time(at)) throw new RangeError('market decision is stale or invalid');
  const { id, ...body } = decision; if (id !== hashPosition(body)) throw new RangeError('market decision content address differs');
  if (!side || (v === 'evm' && (!chainId || !protocol))) throw new TypeError('allocation side and EVM chain/protocol required');
  if (name(principal) !== decision.principal) throw new TypeError('market decision belongs to another principal');
  return decision.orders.filter((o) => o.venue === v && o.instrument === instrument && o.side === side
    && (v !== 'evm' || (o.chainId === chainId && o.protocol === protocol)));
}
export const allocationFor = (decision, input) => allocationsFor(decision, input).reduce((s, o) => s + o.capitalCents, 0);
