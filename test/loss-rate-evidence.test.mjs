import test from 'node:test';
import assert from 'node:assert/strict';
import { marketGame, planMarket, lossRateUpperBound } from '../src/market-game.mjs';

const at = '2026-10-10T15:00:00.000Z', horizon = '2026-10-11T15:00:00.000Z', windowEnd = '2026-10-06T00:00:00.000Z';
const policy = { principal: 'p', maxObservationAgeMs: 60000, minCalibrationSamples: 30, maxDeployFraction: 1, maxInstrumentFraction: 0.5, maxScenarioLossFraction: 1, kellyMultiple: 1 };
const quote = (id, extra = {}) => ({ id, venue: 'kalshi', instrument: id, carrier: 'binary', side: 'no', entryPrice: 0.96, availableUnits: 1000, unitStep: 1, observedAt: at, horizon, transitionCostFraction: 0.0012, carryCostFraction: 0, ...extra });
const scope = (q) => ({ target: { venue: 'kalshi', instrument: q.id, carrier: 'binary', side: 'no', fundingInstrument: null }, minHoldingPeriodMs: 3_600_000, maxHoldingPeriodMs: 2 * 86_400_000 });

function game({ records, calibration = { method: 'binary-loss-rate', record: 'cal', windowEnd } }) {
  const quotes = [quote('KX-A'), quote('KX-B'), quote('KX-C')];
  let s = marketGame.initialPosition();
  const play = (intent) => { s = marketGame.extend(s, intent).state; };
  const observe = (id, value) => play({ kind: 'observe', observation: { id, source: 'urn:test', value, availableAt: at, observedAt: at } });
  observe('cal', { kind: 'calibration', method: 'binary-loss-rate', windowEnd, roundTripCostFraction: 0.01, liveUseLimitations: [], payoffScopes: quotes.map(scope) });
  for (const [id, r] of Object.entries(records)) observe(id, { kind: 'binary-loss-rate', counted: { by: 'test:counter', records: [`${id}:settlement-1`] }, ...r });
  play({ kind: 'account', account: { venue: 'kalshi', principal: 'p', observedAt: at, equityCents: 2500, freeCashCents: 2500 } });
  for (const q of quotes) play({ kind: 'quote', quote: q });
  // A: 0 losses in 240; B: 1 loss in 61; C: no counted record
  play({ kind: 'strategy', strategy: { id: 's-A', observedAt: at, quoteIds: ['KX-A'], evidenceIds: ['rec-A'], lossRateEvidence: 'rec-A', thesis: 'ruled-out bracket', falsifier: 'binomial test' } });
  play({ kind: 'strategy', strategy: { id: 's-B', observedAt: at, quoteIds: ['KX-B'], evidenceIds: ['rec-B'], lossRateEvidence: 'rec-B', thesis: 'tail', falsifier: 'binomial test' } });
  play({ kind: 'strategy', strategy: { id: 's-C', observedAt: at, quoteIds: ['KX-C'], evidenceIds: ['cal'], thesis: 'uncounted', falsifier: 'none' } });
  play({ kind: 'forecast', forecast: { id: 'f', observedAt: at, horizon, evidenceIds: ['cal'], calibration, scenarios: [
    { id: 'none', probability: 0.99, values: { 'KX-A': 0, 'KX-B': 0, 'KX-C': 0 }, heldPnlCentsByVenue: { kalshi: 0 } },
    { id: 'A-yes', probability: 0.004, values: { 'KX-A': 1, 'KX-B': 0, 'KX-C': 0 }, heldPnlCentsByVenue: { kalshi: 0 } },
    { id: 'B-yes', probability: 0.003, values: { 'KX-A': 0, 'KX-B': 1, 'KX-C': 0 }, heldPnlCentsByVenue: { kalshi: 0 } },
    { id: 'C-yes', probability: 0.003, values: { 'KX-A': 0, 'KX-B': 0, 'KX-C': 1 }, heldPnlCentsByVenue: { kalshi: 0 } },
  ] } });
  return s;
}

test('the one-sided Clopper-Pearson upper bound matches its closed form at zero losses and grows with losses', () => {
  assert.ok(Math.abs(lossRateUpperBound(0, 240) - (1 - 0.05 ** (1 / 240))) < 1e-9);
  assert.ok(lossRateUpperBound(1, 61) > lossRateUpperBound(0, 61));
  assert.equal(lossRateUpperBound(5, 5), 1);
  assert.throws(() => lossRateUpperBound(3, 2), /counts/);
});

test('loss-rate calibration funds only quotes that earn their cost at their record\'s upper loss rate', () => {
  const s = game({ records: { 'rec-A': { trials: 240, losses: 0 }, 'rec-B': { trials: 61, losses: 1 } } });
  const d = planMarket(s, policy, at);
  const a = d.orders.find((o) => o.id === 'KX-A');
  assert.ok(a && a.units >= 1, JSON.stringify(d.skips));
  assert.deepEqual({ losses: a.lossRate.losses, trials: a.lossRate.trials }, { losses: 0, trials: 240 });
  // 1 in 61 bounds the loss rate near 7.5%: buying NO at 96c plus cost cannot earn at that rate
  assert.ok(d.skips.some((k) => k.id === 'KX-B' && /does not earn its cost/u.test(k.reason)));
  // a strategy with no counted record is not admitted under this form
  assert.ok(d.skips.some((k) => k.id === 'KX-C' && /counted loss record/u.test(k.reason)));
  assert.equal(d.orders.length, 1);
});

// The scored-forecast (Brier) form, pinned to the decision origin/main's planMarket makes on this game (computed there
// before the loss-rate form was added): the same decision id, units and capital, and the same refusal.
function brierGame() {
  const at = '2026-10-10T15:00:00.000Z', horizon = '2026-10-11T15:00:00.000Z';
  const calibration = { sampleSize: 100, brier: .1, baselineBrier: .2, windowEnd: '2026-10-09T15:00:00.000Z', record: 'cal', confidenceLowerBound: .01, netReturnConfidenceLowerBound: .01, liveUseLimitations: [] };
  const q = { id: 'kq', venue: 'kalshi', instrument: 'KX-TEST', carrier: 'binary', side: 'yes', entryPrice: .25, availableUnits: 10000, unitStep: 1, observedAt: at, horizon, transitionCostFraction: .001, carryCostFraction: .001 };
  let s = marketGame.initialPosition(); const play = (intent) => { s = marketGame.extend(s, intent).state; };
  const observe = (id, value) => play({ kind: 'observe', observation: { id, source: 'urn:test', value, availableAt: at, observedAt: at } });
  observe('news', { kind: 'news' });
  observe('cal', { kind: 'calibration', ...calibration, roundTripCostFraction: .05, payoffScopes: [{ target: { venue: 'kalshi', instrument: 'KX-TEST', carrier: 'binary', side: 'yes', fundingInstrument: null }, minHoldingPeriodMs: 86400000 - 60000, maxHoldingPeriodMs: 86400000 }] });
  play({ kind: 'account', account: { venue: 'kalshi', principal: 'p', observedAt: at, equityCents: 100000, freeCashCents: 100000 } });
  play({ kind: 'quote', quote: q });
  play({ kind: 'strategy', strategy: { id: 's', observedAt: at, quoteIds: ['kq'], evidenceIds: ['news'], thesis: 't', falsifier: 'f' } });
  play({ kind: 'forecast', forecast: { id: 'f', observedAt: at, horizon, evidenceIds: ['cal', 'news'], calibration, scenarios: [
    { id: 'yes', probability: .4, values: { kq: 1 }, heldPnlCentsByVenue: { kalshi: 0 } }, { id: 'no', probability: .6, values: { kq: 0 }, heldPnlCentsByVenue: { kalshi: 0 } }] } });
  return { s, at, policy: { principal: 'p', maxObservationAgeMs: 60000, minCalibrationSamples: 30, maxDeployFraction: .5, maxInstrumentFraction: .15, maxScenarioLossFraction: .25, kellyMultiple: .5 } };
}

test('the Brier form decides exactly as origin/main did', () => {
  const g = brierGame();
  const d = planMarket(g.s, g.policy, g.at);
  assert.equal(d.id, '6513bfbdcb2b30fee69390d2809894290b92fa2d0a86360e5648518c2a1ffefb');
  assert.deepEqual(d.orders.map((o) => [o.units, o.capitalCents, 'lossRate' in o]), [[299, 7490, false]]);
  assert.throws(() => planMarket(g.s, { ...g.policy, minCalibrationSamples: 200 }, g.at), /^RangeError: forecast lacks measured calibration better than its baseline$/u);
});

test('a loss record without its counting provenance is refused, never trusted', () => {
  for (const counted of [undefined, { by: 'x' }, { by: '', records: ['r'] }, { by: 'x', records: [] }, { by: 'x', digest: 'not-a-digest' }]) {
    const s = game({ records: { 'rec-A': { trials: 240, losses: 0 }, 'rec-B': { trials: 61, losses: 1 } } });
    const bare = { ...s, observations: { ...s.observations, 'rec-A': { ...s.observations['rec-A'], value: { kind: 'binary-loss-rate', trials: 240, losses: 0, ...(counted ? { counted } : {}) } } } };
    const d = planMarket(bare, policy, at);
    assert.ok(d.skips.some((k) => k.id === 'KX-A' && /counted loss record/u.test(k.reason)), JSON.stringify(counted));
  }
  const s = game({ records: { 'rec-A': { trials: 240, losses: 0 }, 'rec-B': { trials: 61, losses: 1 } } });
  const digest = { ...s, observations: { ...s.observations, 'rec-A': { ...s.observations['rec-A'], value: { kind: 'binary-loss-rate', trials: 240, losses: 0, counted: { by: 'x', digest: 'a'.repeat(64) } } } } };
  assert.ok(planMarket(digest, policy, at).orders.some((o) => o.id === 'KX-A'));
});

test('a forecast with neither form refuses as before', () => {
  const s = game({ records: { 'rec-A': { trials: 240, losses: 0 }, 'rec-B': { trials: 61, losses: 1 } }, calibration: { record: 'cal', windowEnd } });
  assert.throws(() => planMarket(s, policy, at), /lacks measured calibration better than its baseline|differs from its scored evidence/u);
});

test('a strategy naming loss-rate evidence must carry it among its evidence', () => {
  let s = marketGame.initialPosition();
  assert.throws(() => marketGame.extend(s, { kind: 'strategy', strategy: { id: 'x', observedAt: at, quoteIds: [], evidenceIds: ['other'], lossRateEvidence: 'rec', thesis: 't', falsifier: 'f' } }), /among the strategy evidence/u);
});


test('the funded market planner acts on usable side-specific bid/ask liquidity, not the modelled fantasy quote',()=>{
 const g=brierGame();
 const p={...g.policy,requireExecutableBook:true,maxExecutableBookAgeMs:30_000,maxRelativeSpread:.005};
 const without=planMarket(g.s,p,g.at);
 assert.equal(without.orders.length,0);
 assert.ok(without.skips.some(row=>/bid\/ask required/.test(row.reason)));
 const book={
  sourceRef:'fixture:external-kalshi-book',sourceObservationId:'book-source',
  venue:'kalshi',instrument:'KX-TEST',side:'yes',
  observedAt:g.at,bid:.249,ask:.25,bidSize:100,askSize:100,
 };
 const base={...g.s,
  observations:{...g.s.observations,
   'book-source':{observedAt:g.at,availableAt:g.at,value:{kind:'original-market-book',book}}},
  quotes:{...g.s.quotes,kq:{...g.s.quotes.kq,book}},
 };
 const accepted=planMarket(base,p,g.at);
 const order=accepted.orders.find(row=>row.id==='kq');
 assert.ok(order,'a genuine fresh quoted side should remain an admissible candidate');
 assert.ok(order.units<=book.askSize,'same-price displayed liquidity caps the actual planned quantity');
 const changed=(patch,policy=p)=>{
  const next={...base,quotes:{...base.quotes,kq:{...base.quotes.kq,book:{...book,...patch}}}};
  return planMarket(next,policy,g.at);
 };
 for(const [patch,reason] of [
  [{bid:.1},/spread/],
  [{instrument:'DIFFERENT'},/another market side/],
  [{sourceObservationId:'absent'},/original observation/],
  [{ask:.26},/improves on ask/],
  [{askSize:.1},/liquidity/],
  [{observedAt:'2026-10-10T14:59:00Z'},/stale/],
 ]){
  const d=changed(patch);
  assert.equal(d.orders.length,0);
  assert.ok(d.skips.some(row=>reason.test(row.reason)),JSON.stringify(d.skips));
 }
});
