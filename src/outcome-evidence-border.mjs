/**
 * Strictly separate asserted P&L from source-linked and authenticated results.
 *
 * Market-game replay admits historical assertions, but a bare 'receipt'
 * string cannot measure returns or calibrate a strategy. This pure predicate
 * checks the original observed source's semantic identity, timing, currency,
 * venue and principal WITHOUT inventing source authentication. Independent
 * external byte/source receiving is a separate Operations duty.
 */
const named=x=>typeof x==='string'&&x.trim().length>0;
const instant=x=>typeof x==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&
  Number.isFinite(Date.parse(x));
const digest=x=>typeof x==='string'&&/^sha256:[0-9a-f]{64}$/.test(x);

export function classifyMarketOutcome({outcome,decision,order,sourceObservation}={}) {
  if(!outcome||!decision||!order)
    throw new TypeError('a planned decision and order must bound the outcome');
  if(!Number.isSafeInteger(outcome.pnlCents))
    throw new TypeError('outcome P&L must be integer USD cents');
  if(!instant(outcome.observedAt)||!instant(decision.at)||
     Date.parse(outcome.observedAt)<Date.parse(decision.at))
    throw new RangeError('a realized outcome cannot precede the decision');
  if(!named(outcome.sourceObservationId))
    return Object.freeze({status:'unqualified-claim',reason:'no original source observation',sourceAuthenticated:false});
  const observed=sourceObservation, v=observed?.value;
  if(!observed||!named(observed.id)||observed.id!==outcome.sourceObservationId||
     !named(observed.source)||!instant(observed.observedAt)||
     !instant(observed.availableAt)||Date.parse(observed.availableAt)>Date.parse(observed.observedAt)||
     Date.parse(observed.observedAt)<Date.parse(decision.at)||
     Date.parse(observed.observedAt)>Date.parse(outcome.observedAt)||
     v?.kind!=='venue-realized-pnl-v1'||v.decisionId!==outcome.decisionId||
     v.orderId!==outcome.orderId||v.principal!==decision.principal||
     v.venue!==order.venue||v.instrument!==order.instrument||
     v.receipt!==outcome.receipt||v.currency!=='USD'||
     !Number.isSafeInteger(v.pnlCents)||v.pnlCents!==outcome.pnlCents||
     !digest(v.sourceDigest))
    throw new RangeError('source-bound outcome differs from the original time-qualified venue observation');
  return Object.freeze({
    status:'source-linked-claim',sourceObservationId:observed.id,
    pnlCents:v.pnlCents,currency:'USD',sourceDigest:v.sourceDigest,
    sourceAuthenticated:false,independentlyReconciled:false,
  });
}
