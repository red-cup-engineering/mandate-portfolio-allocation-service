import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateOpportunities } from '../src/allocate-opportunities.mjs';

const opportunity = (id = 'contract') => ({
  id, lane: 'main', venue: 'kalshi',
  instrument: { venue: 'kalshi', id: 'KX-FIXTURE', kind: 'binary' }, side: 'yes',
  priceCents: 50, payoffCents: 50, winProbability: 0.99,
  settlesOn: '2026-10-20', correlation: { event: 'KX-DAY', date: '2026-10-20' },
});
const packet = (changes = {}) => ({
  opportunities: [opportunity()],
  venues: [{ venue: 'kalshi', equityCents: 10000, freeCashCents: 100 }],
  lanes: { main: { fraction: 1 } }, sizing: { kellyMultiple: 1 },
  limits: { perEventFraction: 1, perDateFraction: 1, maxOpenFraction: 1 },
  ...changes,
});
const risk = value => value.orders.reduce((sum, row) => sum + row.riskCents, 0);

test('a funded real account cannot be inflated by negative minimum cash', () => {
  assert.equal(risk(allocateOpportunities(packet())), 100);
  assert.throws(() => allocateOpportunities(packet({
    venues: [{ venue: 'kalshi', equityCents: 10000, freeCashCents: 100, minCashCents: -1000 }],
  })), /cash-floor-must-be-nonnegative-safe-integer-cents/);
});
test('duplicate venue snapshots cannot double the account equity', () => {
  const v = { venue: 'kalshi', equityCents: 10000, freeCashCents: 100 };
  assert.throws(() => allocateOpportunities(packet({ venues: [v, { ...v }] })), /distinct-named-venue-accounts-required/);
});
test('distinct venues remain valid and the budget stays cash constrained', () => {
  const x = allocateOpportunities(packet({
    venues: [{ venue: 'kalshi', equityCents: 10000, freeCashCents: 100 }, { venue: 'alpaca', equityCents: 10000, freeCashCents: 0 }],
  }));
  assert.equal(x.laneCapital.main, 20000);
  assert.equal(risk(x), 100);
});
test('cash claims and integer precision are admissible or refused before sizing', () => {
  const original = packet().venues[0];
  for (const venue of [
    { ...original, freeCashCents: 10001 },
    { ...original, equityCents: Number.MAX_SAFE_INTEGER + 1 },
    { ...original, freeCashCents: NaN },
    { ...original, minCashCents: -1 },
    { ...original, minCashCents: 1.5 },
  ]) assert.throws(() => allocateOpportunities(packet({ venues: [venue] })), /cash|equity|integer/);
});
test('a conservative cash floor may withhold all capital without creating an error', () => {
  assert.equal(risk(allocateOpportunities(packet({
    venues: [{ venue: 'kalshi', equityCents: 10000, freeCashCents: 100, minCashCents: 200 }],
  }))), 0);
});
test('lane funding never claims more than the observed equity', () => {
  assert.throws(() => allocateOpportunities(packet({ lanes: { main: { fraction: 1 }, next: { fraction: 1 } } })), /lane-capital-cannot-exceed-observed-equity/);
  const okay = allocateOpportunities(packet({ lanes: { main: { fraction: 0.5 }, next: { fraction: 0.5 } } }));
  assert.equal(okay.laneCapital.main + okay.laneCapital.next, 10000);
});
test('an invalid Kelly multiple or cap cannot silently amplify a target', () => {
  for (const kellyMultiple of [NaN, Infinity, -1, 1.001, '1']) {
    assert.throws(() => allocateOpportunities(packet({ sizing: { kellyMultiple } })), /kelly-multiple-invalid/);
  }
  for (const name of ['perEventFraction', 'perDateFraction', 'maxOpenFraction']) {
    assert.throws(() => allocateOpportunities(packet({
      limits: { ...packet().limits, [name]: 2 },
    })), /fraction-invalid/);
  }
  assert.equal(risk(allocateOpportunities(packet({ sizing: { kellyMultiple: 0 } }))), 0);
});
test('held and booked risk cannot be negative or non-integer', () => {
  for (const heldRiskCents of [-50, Infinity, 1.5]) {
    assert.throws(() => allocateOpportunities(packet({
      opportunities: [{ ...opportunity(), heldRiskCents }],
    })), /held-risk-must-be-nonnegative-safe-integer-cents/);
  }
  for (const exposure of [{ total: -1000 }, { byEvent: { 'KX-DAY': -100 } }, { byDate: { '2026-10-20': -100 } }]) {
    assert.throws(() => allocateOpportunities(packet({ exposure })), /exposure-|open-risk/);
  }
});
test('the same identity cannot fund two purported distinct positions', () => {
  assert.throws(() => allocateOpportunities(packet({
    opportunities: [opportunity(), opportunity()],
  })), /distinct-opportunity-identities-required/);
});
test('existing legitimate reserve and exposure decrease rather than mint risk', () => {
  const held = allocateOpportunities(packet({
    opportunities: [{ ...opportunity(), heldRiskCents: 20000 }],
    exposure: { total: 100 },
  }));
  assert.equal(held.orders.length, 0);
  assert.equal(risk(allocateOpportunities(packet())), 100);
});
