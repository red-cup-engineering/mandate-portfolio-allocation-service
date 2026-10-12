/** A shared, replayable evidence-to-portfolio game. No credentials or venue writes.
 * Independent venue observations commute; decisions bind the entire position.
 * A news item is evidence, never an implicit probability or an order.
 */
import { gameRules, hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { jointKellyForScenarioReturns } from '@red-cup-engineering/position-sizing-service';
import {conditionJointScenarioWeights} from './joint-scenario-condition.mjs';
import {assessExecutableBook} from './executable-book.mjs';
import { principalVenueKey, indexPrincipalAccounts, sharedPrincipalVenues, scenarioHeldPnLCents } from './principal-account-border.mjs';

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
      name(row.principal);
      money(row.equityCents); money(row.freeCashCents); money(row.reservedCents ?? 0);
      if (row.freeCashCents > row.equityCents) throw new RangeError('deployable cash exceeds equity; borrowing is not equity');
      for (const [instrument, holding] of Object.entries(row.inventory ?? {})) {
        name(instrument); nonnegative(holding.units, 'held inventory units'); nonnegative(holding.availableUnits, 'available inventory units');
        if (!(finite(holding.markPrice, 'inventory mark') > 0) || holding.availableUnits > holding.units) throw new RangeError('inventory availability or mark invalid');
      }
      next = { ...state, accounts: put(state.accounts, principalVenueKey(row), row) }; break;
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
      if (row.lossRateEvidence !== undefined && !row.evidenceIds.includes(name(row.lossRateEvidence))) throw new TypeError('loss-rate evidence must be among the strategy evidence');
      next = { ...state, strategies: put(state.strategies, row.id, row) }; break;
    }
    case 'forecast': {
      const row = move.forecast; name(row.id); time(row.observedAt); time(row.horizon);
      if (!Array.isArray(row.scenarios) || row.scenarios.length < 2 || row.scenarios.length > 512) throw new TypeError('2..512 shared scenarios required');
      if (new Set(row.scenarios.map((s) => name(s.id))).size !== row.scenarios.length) throw new TypeError('unique scenario IDs required');
      let mass = 0; for (const s of row.scenarios) { mass += nonnegative(s.probability, 'scenario probability'); if (!s.values || (!s.heldPnlCentsByVenue && !s.heldPnlCentsByPrincipalVenue)) throw new TypeError('scenario values and existing holdings P&L required'); }
      if (Math.abs(mass - 1) > 1e-9) throw new RangeError('scenario probabilities must sum to one');
      if (!Array.isArray(row.evidenceIds) || !row.evidenceIds.length) throw new TypeError('forecast evidence required');
      next = { ...state, forecast: newer(state.forecast, row) ? row : state.forecast }; break;
    }
    case 'condition': {
      // A conditioned forecast is derived from the current one, so it succeeds it outright: it is validated as any
      // forecast is, then adopted without a newer() race against its own base (an equal-time tie there is broken by
      // content hashes, which would keep the base about half the time).
      const base = state.forecast;
      const forecast = conditionMarketForecast(state, move.observationId, move.model, move.at);
      if (time(forecast.observedAt) < time(base.observedAt)) throw new RangeError('a conditioned forecast cannot precede the forecast it conditions');
      const adopted = extend({ ...state, forecast: null }, { kind: 'forecast', forecast }).state.forecast;
      return { state: { ...state, forecast: adopted }, events: [{ kind: 'forecast', polarity: 'P' }] };
    }
    case 'decide': {
      const decision = planMarket(state, move.policy, move.at);
      if (move.expectedPosition !== hashPosition(state)) throw new RangeError('decision was based on another position');
      next = { ...state, decisions: { ...state.decisions, [decision.id]: decision } }; break;
    }
    case 'decide-fleet': {
      if (move.expectedPosition !== hashPosition(state)) throw new RangeError('fleet decision was based on another position');
      const decisions = planFleet(state, move.policies, move.at);
      next = { ...state, decisions: { ...state.decisions, ...Object.fromEntries(decisions.map(decision => [decision.id, decision])) } }; break;
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
  return { state: next, events: [{ kind: move.kind, polarity: ['strategy', 'forecast', 'decide', 'decide-fleet'].includes(move.kind) ? 'P' : 'O' }] };
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
  if (!f || !o || !evidence || time(o.observedAt) > time(at) ||
      time(evidence.observedAt) > time(at))
    throw new RangeError('conditioning requires presently available evidence');
  if(time(evidence.observedAt)>time(o.observedAt) ||
     time(evidence.availableAt)>time(o.observedAt))
    throw new RangeError('a model published after its target signal cannot be treated as prospective likelihood');
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
  const likelihoodByScenario=Object.fromEntries(f.scenarios.map(s=>
    [s.id,nonnegative(matches[0].likelihoods[s.id],'scenario likelihood')]));
  const conditioned=conditionJointScenarioWeights({
    scenarios:f.scenarios.map(s=>({...s,probability:base[s.id]})),
    likelihoodByScenario,
  });
  if(conditioned.status!=='conditioned')
    throw new RangeError('observation has no likelihood under this model');
  const body = { ...f, observedAt: at, baseProbabilities: base,
    scenarios: f.scenarios.map((s, k) => ({ ...s, probability: conditioned.probabilities[k] })),
    calibration: spec.calibration, evidenceIds: [...new Set([...f.evidenceIds, observationId, model.evidenceId, spec.calibration.record])].sort(),
    conditioning: { observation: observationId, model: model.evidenceId, value, bin: spec.bins.indexOf(matches[0]) } };
  return { ...body, id: hashPosition(body) };
}

const logGamma = (x) => { // Lanczos, g = 7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1; let a = c[0]; const t = x + 7.5; for (let i = 1; i < 9; i += 1) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};
const binomialCdf = (k, n, p) => {
  if (p <= 0) return 1; if (p >= 1) return k >= n ? 1 : 0;
  let sum = 0; for (let i = 0; i <= k; i += 1) sum += Math.exp(logGamma(n + 1) - logGamma(i + 1) - logGamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, sum);
};
/** The one-sided Clopper-Pearson upper bound on a loss rate: the p at which `losses` or fewer in `trials` has probability `alpha`. */
export function lossRateUpperBound(losses, trials, alpha = 0.05) {
  if (!Number.isSafeInteger(trials) || trials < 1 || !Number.isSafeInteger(losses) || losses < 0 || losses > trials) throw new RangeError('losses and trials must be counts with 0 <= losses <= trials, trials >= 1');
  if (losses === trials) return 1;
  let lo = losses / trials, hi = 1;
  for (let i = 0; i < 100; i += 1) { const mid = (lo + hi) / 2; if (binomialCdf(losses, trials, mid) > alpha) lo = mid; else hi = mid; }
  return hi;
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

// Calibration belongs to a particular payoff, not just a probability vector.
// Inventory exchanges include what is surrendered; collateral includes leverage.
function payoffTarget(quote){
  return {venue:quote.venue,instrument:quote.instrument,carrier:quote.carrier,side:quote.side,fundingInstrument:quote.funding?.instrument??null,
    ...(quote.venue==='alpaca'?{assetClass:quote.assetClass}:{}),
    ...(quote.venue==='evm'?{chainId:quote.chainId,protocol:quote.protocol,...(quote.carrier==='collateral'?{leverage:quote.leverage,collateralToken:quote.collateralToken}:{})}:{})};
}
function scoredPayoffScopes(measured){
  const scopes=measured.payoffScopes;
  if(!Array.isArray(scopes)||!scopes.length||scopes.length>128)throw new TypeError('scored payoff scopes required');
  for(const scope of scopes){
    const target=scope?.target;
    if(!target||typeof target!=='object'||Array.isArray(target)||!Number.isSafeInteger(scope.minHoldingPeriodMs)||scope.minHoldingPeriodMs<=0||!Number.isSafeInteger(scope.maxHoldingPeriodMs)||scope.maxHoldingPeriodMs<scope.minHoldingPeriodMs)throw new TypeError('scored payoff scope requires a target and positive measured holding-period bounds');
    venue(target.venue);name(target.instrument);
    if(!['binary','asset','collateral'].includes(target.carrier)||!(target.carrier==='binary'?['yes','no']:target.carrier==='asset'?['long']:['long','short']).includes(target.side))throw new TypeError('scored payoff carrier and side required');
    if(target.fundingInstrument!==null){name(target.fundingInstrument);if(target.venue!=='evm')throw new TypeError('scored funding inventory requires EVM');}
    if(target.venue==='alpaca'&&!['us_equity','crypto'].includes(target.assetClass))throw new TypeError('scored Alpaca asset class required');
    if(target.venue==='evm'){
      if(!Number.isSafeInteger(target.chainId)||target.chainId<=0)throw new TypeError('scored EVM chain required');name(target.protocol);
      if(target.carrier==='collateral'){if(!(finite(target.leverage,'scored leverage')>0))throw new RangeError('positive scored leverage required');name(target.collateralToken);}
    }
  }
  return scopes;
}

/** The scored-forecast form: one Brier calibration better than its baseline, with positive confidence bounds.
 * These checks are planMarket's own, moved here unchanged. */
function brierCalibration(state, f, policy) {
  const calibration = f.calibration;
  if (!calibration || !Number.isSafeInteger(calibration.sampleSize) || calibration.sampleSize < policy.minCalibrationSamples
    || !Number.isFinite(calibration.brier) || !Number.isFinite(calibration.baselineBrier) || calibration.brier < 0 || calibration.brier >= calibration.baselineBrier
    || !calibration.record || !f.evidenceIds.includes(calibration.record) || time(calibration.windowEnd) > time(f.observedAt)) throw new RangeError('forecast lacks measured calibration better than its baseline');
  const measured = state.observations[calibration.record]?.value;
  if (measured?.kind !== 'calibration' || measured.sampleSize !== calibration.sampleSize || measured.brier !== calibration.brier || measured.baselineBrier !== calibration.baselineBrier || measured.windowEnd !== calibration.windowEnd) throw new TypeError('forecast calibration differs from its scored evidence');
  // Every funded strategy needs measured confidence, regardless of method
  // name or whether prediction-market conditioning metadata is present.
  {
    if (!Number.isFinite(measured.roundTripCostFraction) || measured.roundTripCostFraction < 0) throw new TypeError('scored nonnegative strategy cost budget required');
    if (!Array.isArray(measured.liveUseLimitations)||measured.liveUseLimitations.length)throw new RangeError('study has unresolved live-use limitations');
    if (!Number.isFinite(calibration.confidenceLowerBound) || calibration.confidenceLowerBound<=0
        || !Number.isFinite(calibration.netReturnConfidenceLowerBound) || calibration.netReturnConfidenceLowerBound<=0)
      throw new RangeError('financial strategy lacks positive measured calibration and net-return confidence');
    if (measured.confidenceLowerBound!==calibration.confidenceLowerBound
        || measured.netReturnConfidenceLowerBound!==calibration.netReturnConfidenceLowerBound)
      throw new TypeError('strategy confidence differs from scored evidence');
  }
  return measured;
}

/** The counted loss-rate form (`calibration.method: 'binary-loss-rate'`): the calibration record carries the cost
 * budget, live-use limitations and payoff scopes; each binary quote's strategy names a counted loss record, and the
 * quote is admitted only if it earns after its costs at that record's 95% upper loss rate (planMarket, per candidate). */
function lossRateCalibration(state, f) {
  const calibration = f.calibration;
  if (!calibration.record || !f.evidenceIds.includes(calibration.record) || time(calibration.windowEnd) > time(f.observedAt)) throw new RangeError('forecast lacks measured calibration better than its baseline');
  const measured = state.observations[calibration.record]?.value;
  if (measured?.kind !== 'calibration' || measured.method !== 'binary-loss-rate' || measured.windowEnd !== calibration.windowEnd) throw new TypeError('forecast calibration differs from its scored evidence');
  if (!Number.isFinite(measured.roundTripCostFraction) || measured.roundTripCostFraction < 0) throw new TypeError('scored nonnegative strategy cost budget required');
  if (!Array.isArray(measured.liveUseLimitations)||measured.liveUseLimitations.length)throw new RangeError('study has unresolved live-use limitations');
  return measured;
}

/** A counted loss record: integer counts, and who counted them from which witnessed records (ids or a digest). */
function countedLossRecord(record) {
  if (record?.kind !== 'binary-loss-rate' || !Number.isSafeInteger(record.trials) || record.trials < 1 || !Number.isSafeInteger(record.losses) || record.losses < 0 || record.losses > record.trials) return null;
  const counted = record.counted;
  if (!counted || typeof counted.by !== 'string' || !counted.by.trim()) return null;
  const cites = (Array.isArray(counted.records) && counted.records.length > 0 && counted.records.every((id) => typeof id === 'string' && id.trim()))
    || (typeof counted.digest === 'string' && /^[0-9a-f]{64}$/u.test(counted.digest));
  return cites ? record : null;
}

/** Joint scenarios carry common-factor dependence across all three venues.
 * Limits act on funded capital; they do not imply fungible venue cash or atomic
 * cross-venue execution. Existing holdings enter every scenario explicitly.
 */
export function planMarket(state, policy, at) {
  if (!policy || !Number.isSafeInteger(policy.minCalibrationSamples) || policy.minCalibrationSamples < 1) throw new TypeError('positive calibration sample minimum required');
  for (const field of ['maxDeployFraction', 'maxInstrumentFraction', 'maxScenarioLossFraction']) if (!(finite(policy[field], field) > 0) || policy[field] > 1) throw new RangeError(`${field} must be in (0,1]`);
  if(policy.requireExecutableBook!==undefined&&
     typeof policy.requireExecutableBook!=='boolean')
    throw new TypeError('boolean executable-book requirement required');
  const now = time(at); const f = state.forecast;
  const maxAge = nonnegative(policy.maxObservationAgeMs, 'observation age');
  const fresh = (row) => row && time(row.observedAt) <= now && now - time(row.observedAt) <= maxAge;
  const evidenceOK = (ids) => ids.every((id) => { const row = state.observations[id]; return row && time(row.observedAt) <= now && time(row.availableAt) <= now; });
  if (!fresh(f) || time(f.horizon) <= now || !evidenceOK(f.evidenceIds)) throw new RangeError('forecast unavailable, expired or uses future/missing evidence');
  // Two forms of measured confidence: the scored-forecast (Brier) form, whose checks are unchanged in
  // brierCalibration, and the counted loss-rate form for binary strategies (lossRateCalibration).
  const lossRateForm = f.calibration?.method === 'binary-loss-rate';
  const measured = lossRateForm ? lossRateCalibration(state, f) : brierCalibration(state, f, policy);
  if (f.conditioning) {
    if (!f.evidenceIds.includes(f.conditioning.model) || !evidenceOK([f.conditioning.model])) throw new TypeError('conditioned selection model requires presently available forecast evidence');
    const model = state.observations[f.conditioning.model]?.value;
    const bin = f.conditioning.bin, fitted = model?.model?.expectedReturns?.[bin];
    if (model?.kind !== 'scenario-likelihood-model' || !Number.isSafeInteger(bin) || bin < 0
        || !Number.isSafeInteger(fitted?.trainingSamples) || fitted.trainingSamples < 1
        || !Number.isFinite(fitted.gross) || !Number.isFinite(measured.roundTripCostFraction)
        || measured.roundTripCostFraction < 0) throw new TypeError('conditioned strategy requires the scored training-bin return and cost');
    if (!(fitted.gross > measured.roundTripCostFraction)) throw new RangeError('scored training-bin selection requires cash');
  }
  const payoffScopes=scoredPayoffScopes(measured),holdingPeriodMs=time(f.horizon)-now;
  const accounts = Object.values(state.accounts).sort((a, b) => a.venue.localeCompare(b.venue));
  if (!accounts.length || accounts.some((a) => !fresh(a))) throw new RangeError('fresh account readings required');
  const principal = name(policy.principal);
  const accountByVenue = indexPrincipalAccounts(state.accounts, principal);
  const equity = accounts.reduce((s, a) => s + a.equityCents, 0); if (equity <= 0) throw new RangeError('positive portfolio equity required');
  const baseline = f.scenarios.map((s) => 1 + accounts.reduce((pnl, a) => pnl + scenarioHeldPnLCents(s, principal, a.venue), 0) / equity);
  const skips = [], candidates = [], seen = new Set();
  for (const strategy of Object.values(state.strategies).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const id of strategy.quoteIds) {
      const q = state.quotes[id];
      const refuse = (reason) => skips.push({ strategy: strategy.id, id, reason });
      if (time(strategy.observedAt) > now) { refuse('strategy proposed after decision time'); continue; }
      if (strategy.falsifierFired) { refuse('strategy falsified'); continue; }
      if (!evidenceOK(strategy.evidenceIds)) { refuse('future or missing strategy evidence'); continue; }
      if (!fresh(q) || !accountByVenue.has(q?.venue)) { refuse('quote/account absent or stale'); continue; }
      if (time(q.horizon) !== time(f.horizon)) { refuse('payoff horizon differs from the common scenarios'); continue; }
      if (!payoffScopes.some(scope=>holdingPeriodMs>=scope.minHoldingPeriodMs&&holdingPeriodMs<=scope.maxHoldingPeriodMs&&hashPosition(scope.target)===hashPosition(payoffTarget(q)))) { refuse('candidate differs from the scored payoff scope or holding period'); continue; }
      if (q.transitionCostFraction + q.carryCostFraction > measured.roundTripCostFraction) { refuse('execution costs exceed the scored strategy cost budget'); continue; }
      if (q.stale || q.availableUnits < q.unitStep) { refuse('no known executable liquidity'); continue; }
      // One operational book, one real consumed unit. Do not let a speculative
      // historical edge borrow an old or crossed current ask. This checks only
      // the already-quoted side; the venue adapter remains the execution owner.
      if(policy.requireExecutableBook&&!q.book){
        refuse('current executable side-specific bid/ask required');continue;
      }
      let quotedCapacity=q.availableUnits;
      if(q.book){
        if(typeof q.book.sourceObservationId!=='string'||
           !q.book.sourceObservationId.trim()||
           !evidenceOK([q.book.sourceObservationId])){
          refuse('side-specific book has no available original observation');continue;
        }
        if(q.book.venue!==q.venue||q.book.instrument!==q.instrument||
           q.book.side!==q.side){
          refuse('execution book belongs to another market side or venue');continue;
        }
        const quality=assessExecutableBook({
          book:q.book,at,
          maxQuoteAgeMs:Math.min(maxAge,policy.maxExecutableBookAgeMs??60000),
          maxRelativeSpread:policy.maxRelativeSpread??0.005,
          minUnits:q.unitStep,proposedEntryPrice:q.entryPrice,
        });
        if(!quality.eligibleForPlanning){
          refuse(quality.reason);continue;
        }
        quotedCapacity=Math.min(quotedCapacity,quality.maxDisplayedUnits);
      }
      if (q.venue === 'alpaca' && !['us_equity', 'crypto'].includes(q.assetClass)) { refuse('Alpaca asset class required'); continue; }
      if (seen.has(id)) { refuse('same liquidity already claimed by another strategy'); continue; }
      if (q.venue === 'evm') {
        if (!Number.isSafeInteger(q.chainId) || q.chainId<=0 || typeof q.blockHash!=='string' || !/^0x[0-9a-fA-F]{64}$/.test(q.blockHash) || typeof q.finalized!=='boolean' || typeof q.protocol!=='string' || !q.protocol.trim()) { refuse('EVM quote lacks pinned chain/protocol and explicit finality identity'); continue; }
        if (typeof q.blockTimestamp!=='string' || !/^\d{1,16}$/.test(q.blockTimestamp)) { refuse('EVM quote lacks its observed block timestamp'); continue; }
        const stateAge=BigInt(now)-BigInt(q.blockTimestamp)*1000n;
        if (stateAge<0n || stateAge>BigInt(Math.floor(Math.min(maxAge,60000))) || now-time(q.observedAt)>60000) { refuse('EVM quote market state is future or stale'); continue; }
      }
      if (q.venue === 'evm' && q.carrier === 'collateral' && (!(q.leverage > 0) || !Number.isFinite(q.leverage) || !q.collateralToken)) { refuse('collateral payoff requires leverage and token identity'); continue; }
      if (q.funding && q.venue !== 'evm') throw new TypeError('inventory exchanges require an EVM venue consumer');
      const holding = q.funding && accountByVenue.get(q.venue).inventory?.[q.funding.instrument];
      if (q.funding && (!holding || !(holding.availableUnits > 0))) { refuse('funding inventory absent or unavailable'); continue; }
      if (q.funding && Math.abs(q.funding.unitsPerUnit * holding.markPrice - q.entryPrice) > 1e-9 * Math.max(1, q.entryPrice)) throw new RangeError('funding inventory mark differs from entry value');
      let lossRate = null;
      if (lossRateForm) {
        const record = strategy.lossRateEvidence ? countedLossRecord(state.observations[strategy.lossRateEvidence]?.value) : null;
        if (!record || q.carrier !== 'binary') { refuse('loss-rate calibration requires a binary quote and its strategy\'s counted loss record (counts and the witnessed records they were counted from)'); continue; }
        const upper = lossRateUpperBound(record.losses, record.trials, policy.lossRateAlpha ?? 0.05);
        const cost = q.entryPrice * (1 + q.transitionCostFraction + q.carryCostFraction);
        if (!((1 - upper) - cost > 0)) { refuse(`at the ${record.losses}/${record.trials} loss record's upper rate ${upper.toFixed(4)} the quote does not earn its cost`); continue; }
        lossRate = { losses: record.losses, trials: record.trials, upper, counted: record.counted };
      }
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
      seen.add(id); candidates.push({ strategy, q, capitalPerUnit, fundingUnitsPerUnit, returns, lossRate, quotedCapacity });
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
  for (const [i, { q, capitalPerUnit, quotedCapacity }] of candidates.entries()) {
    const cap = Math.min(nonnegative(policy.maxInstrumentFraction, 'instrument cap'), quotedCapacity * capitalPerUnit * 100 / equity);
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
  candidates.forEach(({ strategy, q, capitalPerUnit, fundingUnitsPerUnit, returns, lossRate }, i) => {
    const room = Math.floor(sized.fractions[i] * multiple * equity);
    const units = Math.floor(room / (capitalPerUnit * 100) / q.unitStep + 1e-10) * q.unitStep;
    if (units < q.unitStep) { skips.push({ strategy: strategy.id, id: q.id, reason: 'no funded edge under joint limits' }); return; }
    // Round the money upward at the boundary; executable quantity is rounded down.
    const capitalCents = Math.ceil(units * capitalPerUnit * 100 - 1e-9);
    orders.push({ id: q.id, strategy: strategy.id, venue: q.venue, instrument: q.instrument, carrier: q.carrier, side: q.side, units, unitStep: q.unitStep, entryPrice: q.entryPrice, capitalCents,
      expectedReturn: returns.reduce((r, x, k) => r + f.scenarios[k].probability * x, 0), returns,
      ...(q.venue === 'evm' ? { chainId: q.chainId, blockHash: q.blockHash, blockTimestamp: q.blockTimestamp, finalized: q.finalized, protocol: q.protocol, ...(q.carrier === 'collateral' ? { leverage: q.leverage, collateralToken: q.collateralToken } : {}) } : {}),
      ...(q.venue === 'alpaca' ? { assetClass: q.assetClass } : {}),
      ...(q.funding ? { funding: { instrument: q.funding.instrument, units: units * fundingUnitsPerUnit } } : {}),
      ...(lossRate ? { lossRate } : {}),
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

/** Shared information, separately funded principal decisions. The common
 * scenarios never make another principal's cash, holdings or losses available.
 * Each resulting decision remains consumable under its own current mandate. */
export function planFleet(state, policies, at) {
  const accounts = Object.values(state.accounts), principals = [...new Set(accounts.map(account => name(account.principal)))].sort();
  if (!principals.length || !Array.isArray(policies) || policies.length !== principals.length) throw new TypeError('one policy per observed fleet principal required');
  const byPrincipal = new Map();
  for (const policy of policies) {
    const principal = name(policy?.principal);
    if (!principals.includes(principal) || byPrincipal.has(principal)) throw new TypeError('unique observed fleet principal policies required');
    byPrincipal.set(principal, policy);
  }
  // A single venue's holdings P&L cannot be credited to multiple principals.
  // Require principal-specific scenario valuations wherever venue ownership overlaps.
  const sharedVenues = sharedPrincipalVenues(state.accounts);
  for (const scenario of state.forecast?.scenarios ?? [])
    for (const account of accounts)
      if (sharedVenues.has(account.venue))
        scenarioHeldPnLCents(scenario, account.principal, account.venue, { requireScoped: true });
  const fleetPosition = hashPosition(state);
  return principals.map(principal => {
    const ownAccounts = accounts.filter(account => account.principal === principal), venues = new Set(ownAccounts.map(account => account.venue));
    const quotes = Object.fromEntries(Object.entries(state.quotes).filter(([,quote]) => venues.has(quote.venue)));
    const strategies = Object.fromEntries(Object.entries(state.strategies).map(([id,strategy]) => [id,{...strategy,quoteIds:strategy.quoteIds.filter(id => Object.hasOwn(quotes,id))}]).filter(([,strategy]) => strategy.quoteIds.length));
    const decisions = Object.fromEntries(Object.entries(state.decisions).filter(([,decision]) => decision.principal === principal));
    const outcomes = Object.fromEntries(Object.entries(state.outcomes).filter(([,outcome]) => Object.hasOwn(decisions,outcome.decisionId)));
    const position = {...state,accounts:Object.fromEntries(ownAccounts.map(account => [principalVenueKey(account),account])),quotes,strategies,decisions,outcomes};
    const {id,...body} = planMarket(position, byPrincipal.get(principal), at);
    const decision = {...body,fleetPosition};
    return {id:hashPosition(decision),...decision};
  });
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
