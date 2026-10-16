import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateOpportunities } from '../src/allocate-opportunities.mjs';

// The weather desk's policy (weather-desk-policy.json v2) in venue-neutral terms.
const LANE = 'weather-tail-premium';
const lanes = { [LANE]: { fraction: 1 } };
const sizing = { kellyMultiple: 1 };
const limits = { perEventFraction: 0.5, perDateFraction: 0.75, maxOpenFraction: 1 };
const venue = (equityCents, freeCashCents = equityCents) => [{ venue: 'kalshi', equityCents, freeCashCents, minCashCents: 0 }];
// A resting sell of YES at `askCents` is a NO bought at 100 - askCents earning askCents; lossRate is already floored.
const tail = (id, event, date, askCents, lossRate, modelProbability, extra = {}) => ({
  id, lane: LANE, venue: 'kalshi', instrument: { venue: 'kalshi', id, kind: 'binary-no' }, side: 'no',
  priceCents: 100 - askCents, payoffCents: askCents, winProbability: 1 - lossRate, settlesOn: date,
  correlation: { event, date }, rankEdge: askCents / 100 - modelProbability, heldRiskCents: 0, ...extra,
});
const counts = (result) => result.orders.map((order) => [order.id, order.count, order.priceCents]);

// Expected counts below are planCycle's own output (tail-premium-policy.mjs) on the same inputs, captured 2026-10-03.
const NY = 'KXHIGHNY-20261004', CHI = 'KXHIGHCHI-20261004', NY5 = 'KXHIGHNY-20261005';

test('one certified tail on a fresh $25 stake sizes to the same count as planCycle', () => {
  const result = allocateOpportunities({ opportunities: [tail(`${NY}-T1`, NY, '2026-10-04', 3, 0.01, 0.003)], venues: venue(2500), lanes, sizing, limits });
  assert.equal(result.laneCapital[LANE], 2500);
  assert.deepEqual(counts(result), [[`${NY}-T1`, 12, 97]]);
  assert.equal(result.orders[0].riskCents, 1164);
  assert.deepEqual(result.skips, []);
});

test('simultaneous tails across events and dates rank by edge and match planCycle', () => {
  const opportunities = [
    tail(`${NY5}-T1`, NY5, '2026-10-05', 2, 0.012, 0.001),
    tail(`${CHI}-T1`, CHI, '2026-10-04', 3, 0.01, 0.004),
    tail(`${NY}-T1`, NY, '2026-10-04', 4, 0.01, 0.002),
  ];
  const result = allocateOpportunities({ opportunities, venues: venue(10000), lanes, sizing, limits });
  assert.deepEqual(counts(result), [[`${NY}-T1`, 41, 96], [`${CHI}-T1`, 36, 97], [`${NY5}-T1`, 26, 98]]);
});

test('risk already held on the instrument reduces the stake', () => {
  const result = allocateOpportunities({
    opportunities: [tail(`${NY}-T1`, NY, '2026-10-04', 3, 0.01, 0.003, { heldRiskCents: 480 })], venues: venue(2500, 2000), lanes, sizing, limits,
    exposure: { byEvent: new Map([[NY, 480]]), byDate: new Map([['2026-10-04', 480]]), total: 480 },
  });
  assert.deepEqual(counts(result), [[`${NY}-T1`, 7, 97]]);
});

test('an order never exceeds its venue free cash', () => {
  const result = allocateOpportunities({ opportunities: [tail(`${NY}-T1`, NY, '2026-10-04', 3, 0.01, 0.003)], venues: venue(2500, 500), lanes, sizing, limits });
  assert.deepEqual(counts(result), [[`${NY}-T1`, 5, 97]]);
});

test('lane capital is the lane fraction of the summed venue equity, whichever venue the cash is on', () => {
  const venues = [{ venue: 'kalshi', equityCents: 1000, freeCashCents: 1000 }, { venue: 'other', equityCents: 1500, freeCashCents: 0 }];
  const result = allocateOpportunities({ opportunities: [tail(`${NY}-T1`, NY, '2026-10-04', 3, 0.01, 0.003)], venues, lanes: { [LANE]: { fraction: 0.5 } }, sizing, limits });
  assert.equal(result.laneCapital[LANE], 1250);
  // The 625c event cap (half of 1250c) binds below the Kelly stake and the 1000c of kalshi cash: 6 contracts at 97c.
  assert.deepEqual(counts(result), [[`${NY}-T1`, 6, 97]]);
});

test('opportunities without Kelly edge, with a full stake, or without room are skipped with a reason', () => {
  const noEdge = tail('flat', NY, '2026-10-04', 1, 0.01, 0.003);
  const held = tail('held', CHI, '2026-10-04', 3, 0.01, 0.003, { heldRiskCents: 5000 });
  const broke = tail('broke', NY5, '2026-10-05', 3, 0.01, 0.003);
  const result = allocateOpportunities({ opportunities: [noEdge, held, { ...broke, venue: 'elsewhere' }], venues: venue(2500), lanes, sizing, limits });
  assert.deepEqual(result.orders, []);
  assert.deepEqual(result.skips.map((skip) => skip.id), ['flat', 'held', 'broke']);
  assert.match(result.skips[0].reason, /no Kelly edge/);
  assert.match(result.skips[1].reason, /already holds/);
  assert.match(result.skips[2].reason, /not in the account reading/);
});

test('count under one contract skips with the room it had', () => {
  const result = allocateOpportunities({ opportunities: [tail('thin', NY, '2026-10-04', 3, 0.01, 0.003)], venues: venue(2500, 50), lanes, sizing, limits });
  assert.deepEqual(result.orders, []);
  assert.match(result.skips[0].reason, /no room under the limits \(50c for 97c a contract\)/);
});

test('without rankEdge the break-even edge ranks the orders', () => {
  const a = tail('a', NY, '2026-10-04', 4, 0.01, 0.002), b = tail('b', CHI, '2026-10-04', 3, 0.01, 0.004);
  delete a.rankEdge; delete b.rankEdge;
  const result = allocateOpportunities({ opportunities: [b, a], venues: venue(10000), lanes, sizing, limits });
  assert.deepEqual(result.orders.map((order) => order.id), ['a', 'b']);
});

test('lanes keep separate capital and exposure', () => {
  const second = { ...tail('s', CHI, '2026-10-04', 3, 0.01, 0.003), lane: 'other-lane' };
  const result = allocateOpportunities({
    opportunities: [tail('f', NY, '2026-10-04', 3, 0.01, 0.003), second], venues: venue(10000),
    lanes: { [LANE]: { fraction: 0.2 }, 'other-lane': { fraction: 0.1 } }, sizing, limits,
    exposure: { lanes: { [LANE]: { byEvent: { [NY]: 1000 }, total: 1000 } } },
  });
  assert.deepEqual(result.laneCapital, { [LANE]: 2000, 'other-lane': 1000 });
  // Lane one's event cap (half of 2000c) is already spent by its exposure; lane two is untouched by it.
  assert.deepEqual(result.orders.map((order) => [order.id, order.count]), [['s', 5]]);
  assert.match(result.skips[0].reason, /no room under the limits \(0c/);
});

test('malformed opportunities are refused', () => {
  assert.throws(() => allocateOpportunities({ opportunities: [{ ...tail('x', NY, '2026-10-04', 3, 0.01, 0.003), priceCents: 96.5 }], venues: venue(2500), lanes, sizing, limits }), /positive-integer-cents/);
  assert.throws(() => allocateOpportunities({}), /required/);
});

// ── sizing.method: 'bayesian-joint' (opt-in) ─────────────────────────────────────────────
const ladder = (lossRate, asks = [3, 3, 2]) => asks.map((ask, i) => tail(`${NY}-B${i}`, NY, '2026-10-04', ask, lossRate, 0.001, {outcomeStructure:'exclusive-losses'}));

test('the default method is unchanged by an explicit sizing.method kelly', () => {
  const opportunities = ladder(0.01);
  const a = allocateOpportunities({ opportunities, venues: venue(2500), lanes, sizing, limits });
  const b = allocateOpportunities({ opportunities, venues: venue(2500), lanes, sizing: { ...sizing, method: 'kelly' }, limits });
  assert.deepEqual(b, a);
  assert.equal(a.sizingGroups, undefined);
});

test('bayesian-joint sizes one event ladder together as exclusive bands and reports the group', () => {
  const result = allocateOpportunities({ opportunities: ladder(0.005), venues: venue(10000), lanes, sizing: { ...sizing, method: 'bayesian-joint' }, limits });
  assert.deepEqual(result.sizingGroups.map((g) => g.structure), ['exclusive-losses']);
  assert.ok(result.orders.length >= 1);
  const spent = result.orders.reduce((s, o) => s + o.riskCents, 0);
  assert.ok(spent <= 0.5 * 10000, 'the per-event cap still binds');
});

test('bayesian-joint uses a posterior mean in place of winProbability and treats separate events independently', () => {
  const withPosterior = tail(`${NY}-T1`, NY, '2026-10-04', 3, 0.5, 0.001, { posterior: { alpha: 422.5, beta: 0.5 } });
  const other = tail(`${CHI}-T1`, CHI, '2026-10-04', 3, 0.01, 0.001);
  const result = allocateOpportunities({ opportunities: [withPosterior, other], venues: venue(10000), lanes, sizing: { ...sizing, method: 'bayesian-joint' }, limits });
  assert.deepEqual(result.sizingGroups.map((g) => g.structure), ['single', 'single']);
  const byId = Object.fromEntries(result.orders.map((o) => [o.id, o]));
  assert.ok(Math.abs(byId[`${NY}-T1`].winProbability - 0.5) < 1e-12, 'the order still reports the stated winProbability');
  assert.ok(byId[`${NY}-T1`].kellyFraction > byId[`${CHI}-T1`].kellyFraction, 'the 0/422 posterior mean sizes above a 1% loss rate');
});

test('an unknown sizing method is refused', () => {
  assert.throws(() => allocateOpportunities({ opportunities: [], venues: venue(100), lanes, sizing: { method: 'x' }, limits }), RangeError);
});

// ── sizing.modelRisk: shared model error ─────────────────────────────────────────────────
const modelRisk = { modes: [{ id: 'bad-day', weight: 0.04, lambda: 10 }] };
const dayBook = () => [
  ...ladder(0.02, [4, 3, 2]).map((o, i) => ({ ...o, id: `${NY}-S${i}`, correlation: { event: NY, date: '2026-10-04' } })),
  ...ladder(0.02, [4, 3, 2]).map((o, i) => ({ ...o, id: `${CHI}-S${i}`, correlation: { event: CHI, date: '2026-10-04' } })),
];
const joint = { ...sizing, method: 'bayesian-joint' };

test('modelRisk shares one latent state across same-day ladders and sizes smaller than without it', () => {
  const plain = allocateOpportunities({ opportunities: dayBook(), venues: venue(100000), lanes, sizing: joint, limits });
  const shared = allocateOpportunities({ opportunities: dayBook(), venues: venue(100000), lanes, sizing: { ...joint, modelRisk }, limits });
  assert.equal(shared.sizingGroups.length, 1, 'both ladders settle on one date: one group');
  assert.equal(shared.sizingGroups[0].structure, 'model-risk');
  assert.equal(shared.sizingGroups[0].level, 'date');
  assert.deepEqual(shared.sizingGroups[0].events.map((e) => e.structure), ['exclusive-losses', 'exclusive-losses']);
  const risk = (r) => r.orders.reduce((s, o) => s + o.kellyFraction, 0); // uncapped growth-optimal fractions: the per-event cap can mask the difference in risk
  assert.ok(risk(shared) < risk(plain));
});

test('modelRisk level event gives each ladder its own state', () => {
  const result = allocateOpportunities({ opportunities: dayBook(), venues: venue(100000), lanes, sizing: { ...joint, modelRisk: { ...modelRisk, level: 'event' } }, limits });
  assert.equal(result.sizingGroups.length, 2);
  assert.ok(result.sizingGroups.every((g) => g.level === 'event'));
});

test('modelRisk without bayesian-joint, or with an unknown level, is refused; the default path is unchanged', () => {
  assert.throws(() => allocateOpportunities({ opportunities: dayBook(), venues: venue(100000), lanes, sizing: { ...sizing, modelRisk }, limits }), /needs-bayesian-joint/);
  assert.throws(() => allocateOpportunities({ opportunities: dayBook(), venues: venue(100000), lanes, sizing: { ...joint, modelRisk: { ...modelRisk, level: 'x' } }, limits }), RangeError);
  const a = allocateOpportunities({ opportunities: dayBook(), venues: venue(100000), lanes, sizing, limits });
  const b = allocateOpportunities({ opportunities: dayBook(), venues: venue(100000), lanes, sizing: { ...sizing, method: 'kelly' }, limits });
  assert.deepEqual(a, b);
});

test('modelRisk falls back per event when a date group is too large to enumerate', () => {
  const events = Array.from({ length: 9 }, (_, e) => `KXHIGHX${e}-20261004`);
  const opportunities = events.flatMap((ev) => ladder(0.02, [4, 3, 2]).map((o, i) => ({ ...o, id: `${ev}-${i}`, correlation: { event: ev, date: '2026-10-04' } })));
  const result = allocateOpportunities({ opportunities, venues: venue(100000), lanes, sizing: { ...joint, modelRisk }, limits });
  assert.equal(result.sizingGroups[0].fallback, 'per-event');
  assert.ok(result.orders.length > 0);
});

test('joint sizing refuses to invent exclusivity or independence from marginals',()=>{
 const unknown=ladder(.005).map(({outcomeStructure,...o})=>o);
 assert.throws(()=>allocateOpportunities({opportunities:unknown,venues:venue(10000),lanes,sizing:joint,limits}),/explicit-consistent-outcome-structure/);
 assert.throws(()=>allocateOpportunities({opportunities:unknown,venues:venue(10000),lanes,sizing:{...joint,modelRisk},limits}),/explicit-consistent-outcome-structure/);
});

// A structurally decided bracket: selling YES at 1c holds NO bought at 99c, and it cannot lose.
const MAKER = 'structural-maker';
const decided = (id, event, extra = {}) => ({
  id, lane: MAKER, venue: 'kalshi', instrument: { venue: 'kalshi', id, kind: 'binary-no' }, side: 'no',
  priceCents: 99, payoffCents: 1, winProbability: 1 - 1e-6, settlesOn: '2026-10-16', correlation: { event, date: '2026-10-16' }, heldRiskCents: 0, ...extra,
});

test("a lane's own limit replaces the global one for that lane only", () => {
  const twoLanes = { [LANE]: { fraction: 1 }, [MAKER]: { fraction: 1 } };
  const base = { perEventFraction: 0.1, perDateFraction: 1, maxOpenFraction: 1 };
  const opportunities = [decided('KXTEMPNYCH-26OCT16H15-B70', 'KXTEMPNYCH-26OCT16H15'), tail(`${NY}-T1`, NY, '2026-10-04', 3, 0.01, 0.003)];
  const capped = allocateOpportunities({ opportunities, venues: venue(10000), lanes: twoLanes, sizing, limits: base });
  const own = allocateOpportunities({ opportunities, venues: venue(10000), lanes: twoLanes, sizing, limits: { ...base, lanes: { [MAKER]: { perEventFraction: 1 } } } });
  const riskOf = (result, id) => result.orders.find((order) => order.id === id)?.riskCents ?? 0;
  assert.ok(riskOf(capped, 'KXTEMPNYCH-26OCT16H15-B70') <= 1000, 'the global 10% event cap binds the maker lane without its own limit');
  assert.ok(riskOf(own, 'KXTEMPNYCH-26OCT16H15-B70') > 1000, "the maker lane's own event limit lifts its cap");
  assert.ok(riskOf(own, `${NY}-T1`) <= 1000, 'the other lane keeps the global 10% event cap');
});

test('a per-instrument ceiling bounds the new risk an opportunity adds', () => {
  const lanesOne = { [MAKER]: { fraction: 1 } };
  const open = { perEventFraction: 1, perDateFraction: 1, maxOpenFraction: 1 };
  const result = allocateOpportunities({ opportunities: [decided('B70', 'E', { maxNewRiskCents: 1500 })], venues: venue(10000), lanes: lanesOne, sizing, limits: open });
  assert.deepEqual(counts(result), [['B70', 15, 99]]);
  assert.equal(result.orders[0].riskCents, 1485);
  const full = allocateOpportunities({ opportunities: [decided('B70', 'E', { maxNewRiskCents: 50 })], venues: venue(10000), lanes: lanesOne, sizing, limits: open });
  assert.deepEqual(full.orders, []);
  assert.match(full.skips[0].reason, /no room under the limits/u);
});

test('malformed lane limits and ceilings are refused', () => {
  const lanesOne = { [MAKER]: { fraction: 1 } };
  const open = { perEventFraction: 1, perDateFraction: 1, maxOpenFraction: 1 };
  assert.throws(() => allocateOpportunities({ opportunities: [decided('B70', 'E')], venues: venue(10000), lanes: lanesOne, sizing, limits: { ...open, lanes: { [MAKER]: { perEventFraction: 1.5 } } } }), /lane-structural-maker-perEventFraction-invalid/u);
  assert.throws(() => allocateOpportunities({ opportunities: [decided('B70', 'E', { maxNewRiskCents: -1 })], venues: venue(10000), lanes: lanesOne, sizing, limits: open }), /B70-max-new-risk/u);
});
