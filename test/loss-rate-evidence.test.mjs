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
  for (const [id, r] of Object.entries(records)) observe(id, { kind: 'binary-loss-rate', ...r });
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

test('the Brier form is unchanged: a forecast with neither form refuses as before', () => {
  const s = game({ records: { 'rec-A': { trials: 240, losses: 0 }, 'rec-B': { trials: 61, losses: 1 } }, calibration: { record: 'cal', windowEnd } });
  assert.throws(() => planMarket(s, policy, at), /lacks measured calibration better than its baseline|differs from its scored evidence/u);
});

test('a strategy naming loss-rate evidence must carry it among its evidence', () => {
  let s = marketGame.initialPosition();
  assert.throws(() => marketGame.extend(s, { kind: 'strategy', strategy: { id: 'x', observedAt: at, quoteIds: [], evidenceIds: ['other'], lossRateEvidence: 'rec', thesis: 't', falsifier: 'f' } }), /among the strategy evidence/u);
});
