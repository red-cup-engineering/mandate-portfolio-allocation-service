import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateMandatePortfolio } from '../src/allocate.mjs';

const mandate = { type: 'PortfolioAllocationMandate', id: 'bounded-case', maximumWeight: 1, grossLimit: 1 };

test('refuse malformed leverage mandates rather than allow a NaN comparison bypass', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'not-a-limit', -1, 0]) {
    assert.throws(
      () => allocateMandatePortfolio({
        scores: { a: 1, b: 1 },
        mandate: { ...mandate, grossLimit: 2, leverageLimit: bad },
      }),
      /leverage-limit-invalid|allocation-mandate-invalid/,
    );
  }
});

test('ordinary long-only mandate still admits weights bounded by available equity', () => {
  const allocation = allocateMandatePortfolio({ scores: { a: 1, b: 1 }, mandate });
  assert.equal(allocation.grossExposure, 1);
  assert.equal(allocation.cashWeight, 0);
  assert.deepEqual(allocation.weights, { a: 0.5, b: 0.5 });
  assert.equal(allocation.effect, 'target-weights-only');
});

test('explicit authorized leverage remains usable within the stated cap', () => {
  const allocation = allocateMandatePortfolio({
    scores: { a: 1, b: 1 },
    mandate: { ...mandate, grossLimit: 1.5, leverageLimit: 1.5 },
  });
  assert.equal(allocation.grossExposure, 1.5);
  assert.deepEqual(allocation.weights, { a: 0.75, b: 0.75 });
});

test('omitted leverage limit cannot admit gross exposure above one', () => {
  assert.throws(
    () => allocateMandatePortfolio({
      scores: { a: 1, b: 1 },
      mandate: { ...mandate, grossLimit: 1.2 },
    }),
    /allocation-mandate-invalid/,
  );
});
