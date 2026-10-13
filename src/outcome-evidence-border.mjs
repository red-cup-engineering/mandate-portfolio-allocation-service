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


/**
 * Read a market game's outcome claims as a finite evidential partition.
 *
 * This is a view over the EXISTING immutable observations and outcome moves,
 * not another tally/ledger/event store. A "receipt" names ONE underlying
 * economic event, even if it has several confirming or conflicting tellings.
 * Same-event claims never create new independent trials or duplicate P&L.
 *
 * All claims remain unverified; source linkage is NOT source authentication.
 * Opposed tellings coexist. No unverified value enters observed P&L or scored
 * strategy performance. Disputed events invalidate even claimed P&L totals.
 *
 * The returned disputes can prevent a strategy from acquiring new risk until
 * its source disagreement is independently resolved in the receiving system.
 */
export function readMarketOutcomeEvidence(state, asOf) {
  if(!instant(asOf) || !state || typeof state!=='object' ||
     !state.decisions || !state.outcomes || !state.observations)
    throw new TypeError('point-in-time market evidence state required');
  const end=Date.parse(asOf),byReceipt=new Map();
  const originalRows=Object.values(state.outcomes);
  if(originalRows.length>100000)
    throw new RangeError('bounded outcome evidence population required');
  for(const row of originalRows) {
    if(!instant(row?.observedAt))
      throw new TypeError('each outcome must carry an absolute observation clock');
    if(Date.parse(row.observedAt)>end) continue;
    const decision=state.decisions[row.decisionId];
    const order=decision?.orders?.find(o=>o.id===row.orderId);
    if(!order) throw new TypeError('outcome evidence must cite its existing planned order');
    const reading=classifyMarketOutcome({
      outcome:row,decision,order,
      sourceObservation:state.observations[row.sourceObservationId],
    });
    if(!named(row.receipt)||!named(order.strategy))
      throw new TypeError('economic-event and strategy identity required');
    const old=byReceipt.get(row.receipt);
    if(old && (old.decisionId!==row.decisionId||old.orderId!==row.orderId))
      throw new RangeError('one economic receipt cannot identify different planned orders');
    const event=old??{
      receipt:row.receipt,decisionId:row.decisionId,orderId:row.orderId,
      strategy:order.strategy,principal:decision.principal,
      claims:new Map(),
    };
    const entry=event.claims.get(row.pnlCents)??{
      pnlCents:row.pnlCents,sourceLinked:false,claimIds:new Set(),sourceObservationIds:new Set(),
    };
    entry.claimIds.add(row.id);
    if(reading.status==='source-linked-claim') {
      entry.sourceLinked=true;
      entry.sourceObservationIds.add(reading.sourceObservationId);
    }
    event.claims.set(row.pnlCents,entry);
    byReceipt.set(row.receipt,event);
  }
  const perPrincipal=new Map(),strategyOwners=new Map(),ambiguousStrategies=new Set();
  const disputes=[],riskBlockingDisputes=[],events=[];
  const all=[...byReceipt.values()].sort((a,b)=>a.receipt<b.receipt?-1:a.receipt>b.receipt?1:0);
  for(const event of all) {
    const claimReadings=[...event.claims.values()].sort((a,b)=>a.pnlCents-b.pnlCents)
      .map(claim=>Object.freeze({
        pnlCents:claim.pnlCents,
        sourceLinked:claim.sourceLinked,
        claimIds:[...claim.claimIds].sort(),
        sourceObservationIds:[...claim.sourceObservationIds].sort(),
      }));
    const contested=claimReadings.length>1;
    const linked=claimReadings.some(x=>x.sourceLinked);
    // An unsupported contrary assertion may be kept as evidence, but must
    // NOT itself have the operational force of a source-backed contradiction.
    const sourceConflict=claimReadings.filter(x=>x.sourceLinked).length>1;
    const row=Object.freeze({
      receipt:event.receipt,decisionId:event.decisionId,orderId:event.orderId,
      principal:event.principal,strategy:event.strategy,
      status:contested?'contested':linked?'source-linked-claim':'unqualified-claim',
      sourceConflict,
      claims:claimReadings,sourceAuthenticated:false,independentlyReconciled:false,
    });
    events.push(row);
    const own=perPrincipal.get(event.principal)??new Map();
    perPrincipal.set(event.principal,own);
    const previousOwner=strategyOwners.get(event.strategy);
    if(previousOwner!==undefined && previousOwner!==event.principal)
      ambiguousStrategies.add(event.strategy);
    else if(previousOwner===undefined)
      strategyOwners.set(event.strategy,event.principal);
    const stats=own.get(event.strategy)??{
      observations:0,pnlCents:null,
      unverifiedClaims:0,unverifiedClaimedPnlCents:0,
      sourceLinkedClaims:0,sourceLinkedClaimedPnlCents:0,
      contestedOutcomes:0,sourceLinkedDisputes:0,
      sourceAuthenticated:false,independentlyReconciled:false,
    };
    own.set(event.strategy,stats);
    // A receipt contributes exactly one logical outcome, even if multiple
    // different custodians provided redundant observations of the same event.
    stats.unverifiedClaims++;
    if(linked)stats.sourceLinkedClaims++;
    if(contested) {
      stats.contestedOutcomes++;
      if(sourceConflict){
        stats.sourceLinkedDisputes++;
        riskBlockingDisputes.push(row);
      }
      stats.unverifiedClaimedPnlCents=null;
      stats.sourceLinkedClaimedPnlCents=null;
      disputes.push(row);
      continue;
    }
    const value=claimReadings[0].pnlCents;
    if(stats.unverifiedClaimedPnlCents!==null){
      stats.unverifiedClaimedPnlCents+=value;
      if(!Number.isSafeInteger(stats.unverifiedClaimedPnlCents))
        throw new RangeError('unverified claimed P&L tally exceeds integer cents');
    }
    if(linked && stats.sourceLinkedClaimedPnlCents!==null){
      stats.sourceLinkedClaimedPnlCents+=value;
      if(!Number.isSafeInteger(stats.sourceLinkedClaimedPnlCents))
        throw new RangeError('source-linked claimed P&L tally exceeds integer cents');
    }
  }
  // Legacy strategy-keyed readings are safe only when that strategy identity
  // belongs to ONE principal. Do not silently net two enterprises' outcomes.
  const performance=Object.fromEntries([...strategyOwners]
    .filter(([strategy])=>!ambiguousStrategies.has(strategy))
    .map(([strategy,owner])=>[strategy,perPrincipal.get(owner).get(strategy)]));
  const performanceByPrincipal=Object.fromEntries([...perPrincipal]
    .sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([principal,strategies])=>[principal,Object.fromEntries(
      [...strategies].sort(([a],[b])=>a<b?-1:a>b?1:0),
    )]));
  return Object.freeze({
    events:Object.freeze(events),disputes:Object.freeze(disputes),
    riskBlockingDisputes:Object.freeze(riskBlockingDisputes),
    performance:Object.freeze(performance),
    performanceByPrincipal:Object.freeze(performanceByPrincipal),
    ambiguousStrategyNames:Object.freeze([...ambiguousStrategies].sort()),
    tradeEligible:false,independentlyReconciled:false,
  });
}
