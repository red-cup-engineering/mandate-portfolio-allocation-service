/**
 * Read-only, source-qualified external cash ingress for an existing market-game
 * account move. No receipt schema, journal, signer, transfer or order effect.
 *
 * The caller must authenticate original provider/bank/venue records first.
 * This gate checks their joins and bounds; it cannot verify source signatures.
 */
import { assertAccountChainScope } from './principal-account-border.mjs';

const named = x => typeof x === 'string' && x.trim().length > 0;
const cents = x => Number.isSafeInteger(x) && x >= 0;
const parseTime = (x, label) => {
  if (!named(x) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u.test(x))
    throw new TypeError(label + ': UTC timestamp required');
  const n = Date.parse(x);
  if (!Number.isFinite(n)) throw new TypeError(label + ': invalid timestamp');
  return n;
};
const block = (gate, reason) => Object.freeze({
  admitted: false, gate, reason,
  effect: 'no-authority-no-transfer-no-account-move',
});
const fresh = (recordTime, decisionTime, freshnessMs) =>
  recordTime <= decisionTime && decisionTime - recordTime <= freshnessMs;

/**
 * Assess one source-traced portion of an independently paid, settled,
 * USD-denominated external receipt AFTER the original Group book, treasury,
 * approved mandate, bank transfer, and receiving venue have each observed it.
 * Ingress is a conservative single-lot funding view, not a new venue account.
 *
 * A batch payout must be independently allocated to its constituent receipts
 * by the source adapters. priorAllocationIds must be drawn from the owning
 * financial journal, not caller-invented; an already allocated lot is refused.
 * Combining lots requires the original ledger/venue to reconcile them once.
 */
export function assayExternalCapitalIngress(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('ingress request object required');
  const { principal, asOf, freshnessMs, receipt, posting, treasury,
    authorization, transfer, credit, account, priorAllocationIds } = input;
  if (!named(principal) || !named(asOf) || !Number.isSafeInteger(freshnessMs) ||
      freshnessMs < 0 || freshnessMs > 31 * 86400_000)
    throw new TypeError('named principal, UTC asOf and bounded freshnessMs required');
  const now = parseTime(asOf, 'asOf');
  if (!Array.isArray(priorAllocationIds) ||
      priorAllocationIds.some(x => !named(x)) ||
      new Set(priorAllocationIds).size !== priorAllocationIds.length)
    throw new TypeError('authoritative, unique prior allocation IDs required');

  // Unknown coverage stays unknown; it is never converted to a zero balance.
  for (const [label, row] of Object.entries({ receipt, posting, treasury, authorization, transfer, credit, account })) {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      return block(label, 'source-unavailable');
  }
  const ownerRows = [receipt, posting, treasury, authorization, transfer, credit, account];
  if (ownerRows.some(x => x.principal !== principal))
    return block('principal', 'cross-principal-capital');
  const sourceRows = [receipt, posting, treasury, transfer, credit, account];
  if (sourceRows.some(x => !named(x.evidenceRef)))
    return block('source', 'original-source-evidence-missing');
  if ([receipt, posting, treasury, transfer, credit].some(x => !named(x.id)))
    return block('source', 'original-record-identity-missing');
  if ([receipt, posting, treasury, transfer, credit, account].some(x => x.currency !== 'USD'))
    return block('currency', 'usd-only-no-unverified-fx');
  if ([receipt.id, posting.id, treasury.id, transfer.id, credit.id].some(id => priorAllocationIds.includes(id)))
    return block('deduplication', 'already-allocated-source');

  if (receipt.state !== 'settled' || receipt.payerRelation !== 'independent-external' ||
      !named(receipt.payer) || receipt.payer === principal ||
      !cents(receipt.netCents) || receipt.netCents === 0)
    return block('receipt', 'externally-settled-net-cash-not-established');
  if (posting.state !== 'posted' || posting.receiptId !== receipt.id ||
      !['earned-revenue', 'unrestricted-external-grant'].includes(posting.classification) ||
      !cents(posting.investableCents))
    return block('posting', 'qualified-book-posting-missing');
  if (treasury.state !== 'cleared' || treasury.receiptId !== receipt.id ||
      !cents(treasury.attributableCents) || !cents(treasury.availableCents) ||
      !cents(treasury.protectedReserveCents))
    return block('treasury', 'cleared-attributable-reserve-adjusted-cash-missing');

  if (authorization.state !== 'approved' || authorization.revoked !== false ||
      !named(authorization.id) || !named(authorization.approvedBy) ||
      authorization.principal !== principal ||
      !named(authorization.destinationVenue) || !cents(authorization.maxCents) ||
      !named(authorization.authorityEvidenceRef))
    return block('mandate', 'investment-authorization-not-established');
  if (transfer.state !== 'settled' || transfer.authorizationId !== authorization.id ||
      transfer.receiptId !== receipt.id || transfer.treasuryId !== treasury.id ||
      !named(transfer.destinationAccount) || !cents(transfer.netCents))
    return block('transfer', 'authorized-treasury-transfer-not-settled');
  if (credit.state !== 'posted' || credit.transferId !== transfer.id ||
      credit.destinationAccount !== transfer.destinationAccount ||
      !cents(credit.creditedCents))
    return block('credit', 'receiving-venue-credit-not-posted');

  try { assertAccountChainScope(account); }
  catch { return block('account', 'principal-venue-or-chain-invalid'); }
  if (account.venue !== authorization.destinationVenue ||
      account.accountId !== credit.destinationAccount ||
      !cents(account.equityCents) || !cents(account.freeCashCents) ||
      !cents(account.reservedCents ?? 0) ||
      account.freeCashCents + (account.reservedCents ?? 0) > account.equityCents)
    return block('account', 'venue-account-cash-not-established');
  const amountFields = [receipt.netCents, posting.investableCents, treasury.attributableCents,
    treasury.availableCents, authorization.maxCents, transfer.netCents, credit.creditedCents,
    account.freeCashCents];
  if (amountFields.some(x => !cents(x)))
    return block('amounts', 'unsafe-or-negative-amount');
  if (treasury.protectedReserveCents > treasury.availableCents)
    return block('treasury', 'reserve-exceeds-available-cash');
  if (posting.investableCents > receipt.netCents ||
      treasury.attributableCents > receipt.netCents ||
      transfer.netCents > receipt.netCents ||
      transfer.netCents > posting.investableCents ||
      transfer.netCents > authorization.maxCents ||
      transfer.netCents > treasury.attributableCents ||
      transfer.netCents > treasury.availableCents - treasury.protectedReserveCents ||
      credit.creditedCents > transfer.netCents)
    return block('conservation', 'credit-transfer-or-authority-exceeds-cleared-cash');

  const dates = [
    ['receipt', receipt.settledAt], ['receiptObservation', receipt.observedAt],
    ['posting', posting.postedAt], ['treasury', treasury.observedAt],
    ['mandateApproved', authorization.approvedAt], ['mandateObserved', authorization.observedAt],
    ['transfer', transfer.settledAt], ['credit', credit.postedAt],
    ['account', account.observedAt],
  ];
  let timestamps;
  try { timestamps = Object.fromEntries(dates.map(([label, value]) => [label, parseTime(value, label)])); }
  catch { return block('clock', 'source-timestamp-invalid'); }
  if (Object.values(timestamps).some(x => x > now) ||
      !(timestamps.receipt <= timestamps.posting &&
        timestamps.receipt <= timestamps.treasury &&
        timestamps.receipt <= timestamps.receiptObservation &&
        timestamps.mandateApproved <= timestamps.mandateObserved &&
        timestamps.mandateApproved <= timestamps.transfer &&
        timestamps.treasury <= timestamps.transfer &&
        timestamps.transfer <= timestamps.credit &&
        timestamps.credit <= timestamps.account))
    return block('clock', 'impossible-or-future-receipt-order');
  if (!fresh(timestamps.treasury, now, freshnessMs) ||
      !fresh(timestamps.account, now, freshnessMs) ||
      !fresh(timestamps.receiptObservation, now, freshnessMs) ||
      !fresh(timestamps.mandateObserved, now, freshnessMs))
    return block('freshness', 'payment-treasury-mandate-or-venue-reading-stale');
  let validUntil;
  try { validUntil = parseTime(authorization.validUntil, 'mandate-expiry'); }
  catch { return block('mandate', 'authorization-expiry-invalid'); }
  if (validUntil <= now)
    return block('mandate', 'investment-authorization-expired');

  // Existing venue cash, not a payment-notification amount, sets the ceiling.
  const spendableCents = Math.min(receipt.netCents, posting.investableCents,
    treasury.attributableCents, treasury.availableCents - treasury.protectedReserveCents,
    authorization.maxCents, transfer.netCents, credit.creditedCents,
    account.freeCashCents);
  if (spendableCents === 0) return block('budget', 'no-remaining-investable-cash');
  return Object.freeze({
    admitted: true,
    effect: 'read-only-intent-account-projection',
    spendableCents,
    sourceIds: Object.freeze({
      receipt: receipt.id, posting: posting.id, treasury: treasury.id,
      mandate: authorization.id, transfer: transfer.id, credit: credit.id,
    }),
    // Market-game still enforces mandate and venue constraints. This narrowed
    // existing account move does not authorize an order, sign, or send.
    accountMove: Object.freeze({
      kind: 'account',
      account: Object.freeze({ ...account, freeCashCents: spendableCents }),
    }),
  });
}
