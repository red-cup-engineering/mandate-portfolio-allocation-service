import test from 'node:test';
import assert from 'node:assert/strict';
import { assayExternalCapitalIngress as assay } from '../src/external-capital-ingress.mjs';

// Synthetic stage records: these exercise structure, not a real payment,
// an actual ledger posting, brokerage funding or external demand.
const t = minute => '2026-10-22T00:' + String(minute).padStart(2, '0') + ':00Z';
const fixture = () => ({
  principal: '561-group', asOf: t(30), freshnessMs: 30 * 60_000,
  priorAllocationIds: [],
  receipt: { id: 'provider:receipt-1', principal: '561-group',
    evidenceRef: 'provider:balance-transaction-1', state: 'settled',
    payerRelation: 'independent-external', payer: 'external-customer',
    currency: 'USD', netCents: 12000, settledAt: t(1) },
  posting: { id: 'group:ledger-post-1', principal: '561-group',
    evidenceRef: 'group:eavt-post-1', state: 'posted',
    receiptId: 'provider:receipt-1', classification: 'earned-revenue',
    currency: 'USD', investableCents: 10000, postedAt: t(2) },
  treasury: { id: 'bank:credit-1', principal: '561-group', evidenceRef: 'bank:source-1',
    state: 'cleared', receiptId: 'provider:receipt-1', currency: 'USD',
    attributableCents: 11000, availableCents: 10000,
    protectedReserveCents: 2000, observedAt: t(9) },
  authorization: { id: 'group:finance-grant-1', principal: '561-group',
    state: 'approved', approvedBy: 'group:competent-authority',
    authorityEvidenceRef: 'group:mandate-1', destinationVenue: 'alpaca',
    maxCents: 8000, validUntil: '2026-10-23T00:00:00Z' },
  transfer: { id: 'bank:transfer-1', principal: '561-group',
    evidenceRef: 'bank:transfer-proof-1', state: 'settled',
    authorizationId: 'group:finance-grant-1', receiptId: 'provider:receipt-1',
    treasuryId: 'bank:credit-1', destinationAccount: 'alpaca:group-account',
    currency: 'USD', netCents: 7000, settledAt: t(11) },
  credit: { id: 'alpaca:deposit-1', principal: '561-group',
    evidenceRef: 'alpaca:activity-deposit-1', state: 'posted',
    transferId: 'bank:transfer-1', destinationAccount: 'alpaca:group-account',
    currency: 'USD', creditedCents: 6900, postedAt: t(12) },
  account: { principal: '561-group', venue: 'alpaca',
    accountId: 'alpaca:group-account', evidenceRef: 'alpaca:account-snapshot-1',
    currency: 'USD', equityCents: 16000, freeCashCents: 10000,
    reservedCents: 0, observedAt: t(14) },
});
const deny = (x, gate) => {
  const actual = assay(x);
  assert.equal(actual.admitted, false);
  assert.equal(actual.gate, gate);
  assert.equal(actual.accountMove, undefined);
  assert.equal(actual.effect, 'no-authority-no-transfer-no-account-move');
};

test('admitted trace narrows observed venue cash without inventing equity or effects', () => {
  const x = fixture(), before = structuredClone(x);
  const actual = assay(x);
  assert.equal(actual.admitted, true);
  assert.equal(actual.spendableCents, 6900);
  assert.equal(actual.accountMove.kind, 'account');
  assert.equal(actual.accountMove.account.equityCents, 16000);
  assert.equal(actual.accountMove.account.freeCashCents, 6900);
  assert.equal(actual.accountMove.account.principal, '561-group');
  assert.equal(actual.effect, 'read-only-intent-account-projection');
  assert.deepEqual(x, before);
});

test('pending, internal, self and unsupported receipts cannot become Group investment money', () => {
  for (const mutate of [
    x => x.receipt.state = 'pending',
    x => x.receipt.payerRelation = 'internal',
    x => x.receipt.payer = x.principal,
    x => x.receipt.netCents = 0,
  ]) { const x = fixture(); mutate(x); deny(x, 'receipt'); }
  const x = fixture(); delete x.receipt; deny(x, 'receipt');
  const y = fixture(); delete y.receipt.evidenceRef; deny(y, 'source');
});

test('unposted, restricted, unrelated and cross-principal receipts are refused', () => {
  for (const mutate of [
    x => x.posting.state = 'pending',
    x => x.posting.classification = 'loan',
    x => x.posting.receiptId = 'unrelated',
  ]) { const x = fixture(); mutate(x); deny(x, 'posting'); }
  const x = fixture(); x.treasury.principal = 'personal'; deny(x, 'principal');
  const y = fixture(); y.account.principal = 'personal'; deny(y, 'principal');
});

test('conservation, reserves and destination evidence are required', () => {
  const x = fixture(); x.treasury.protectedReserveCents = 11000; deny(x, 'treasury');
  for (const mutate of [
    x => x.transfer.netCents = 8001,
    x => x.transfer.netCents = 9000,
    x => x.credit.creditedCents = 7001,
    x => x.posting.investableCents = 13000,
    x => x.treasury.attributableCents = 13000,
  ]) { const y = fixture(); mutate(y); deny(y, 'conservation'); }
  const z = fixture(); z.credit.state = 'pending'; deny(z, 'credit');
  const w = fixture(); w.credit.transferId = 'unrelated'; deny(w, 'credit');
});

test('duplicate source allocations cannot be admitted a second time', () => {
  for (const id of ['provider:receipt-1', 'bank:transfer-1']) {
    const x = fixture(); x.priorAllocationIds = [id]; deny(x, 'deduplication');
  }
  const x = fixture(); delete x.priorAllocationIds;
  assert.throws(() => assay(x), /authoritative.*prior allocation/);
});

test('authorization must be approved, current, and name the destination', () => {
  const x = fixture(); x.authorization.state = 'proposed'; deny(x, 'mandate');
  const y = fixture(); y.authorization.validUntil = t(30); deny(y, 'mandate');
  const z = fixture(); z.authorization.destinationVenue = 'kalshi'; deny(z, 'account');
  const w = fixture(); w.transfer.authorizationId = 'unrelated'; deny(w, 'transfer');
});

test('clock order, freshness, chain and currency qualification are enforced', () => {
  const x = fixture(); x.treasury.observedAt = t(32); deny(x, 'clock');
  const y = fixture(); y.account.observedAt = t(5); deny(y, 'clock');
  const z = fixture(); z.freshnessMs = 5 * 60_000; deny(z, 'freshness');
  const w = fixture(); w.account.venue = 'evm'; deny(w, 'account');
  const u = fixture(); u.receipt.currency = 'USDC'; deny(u, 'currency');
});

test('unsafe cents and empty account balance cannot produce spend authority', () => {
  const x = fixture(); x.receipt.netCents = Number.MAX_SAFE_INTEGER + 1; deny(x, 'receipt');
  const y = fixture(); y.account.freeCashCents = NaN; deny(y, 'account');
  const z = fixture(); z.account.freeCashCents = -1; deny(z, 'account');
  const w = fixture(); w.account.freeCashCents = 0; deny(w, 'budget');
});

test('the tightest real cash, mandate, and venue ceiling wins', () => {
  const x = fixture();
  x.authorization.maxCents = 3000;
  x.transfer.netCents = 3000;
  x.credit.creditedCents = 3000;
  assert.equal(assay(x).spendableCents, 3000);
  const y = fixture(); y.treasury.protectedReserveCents = 5000;
  y.transfer.netCents = 5000; y.credit.creditedCents = 5000;
  assert.equal(assay(y).spendableCents, 5000);
});
