import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMarketOutcome,readMarketOutcomeEvidence} from '../src/outcome-evidence-border.mjs';

const decision={principal:'test-principal',at:'2026-10-07T02:00:00Z'};
const order={venue:'evm',instrument:'USDC'};
const outcome={
 id:'outcome-1',decisionId:'decision-1',orderId:'order-1',
 receipt:'venue-original-event-42',
 observedAt:'2026-10-08T04:00:00Z',pnlCents:25,
 sourceObservationId:'source-1',
};
const sourceObservation={
 id:'source-1',source:'urn:synthetic:venue-reading',
 availableAt:'2026-10-08T02:30:00Z',
 observedAt:'2026-10-08T03:00:00Z',
 value:{
  kind:'venue-realized-pnl-v1',
  decisionId:'decision-1',orderId:'order-1',principal:'test-principal',
  venue:'evm',instrument:'USDC',currency:'USD',
  receipt:'venue-original-event-42',pnlCents:25,
  sourceDigest:'sha256:'+'a'.repeat(64),
 },
};
const classify=(o=outcome,src=sourceObservation)=>classifyMarketOutcome({
 outcome:o,decision,order,sourceObservation:src,
});
test('a bare receipt does not become a measurement',()=>{
 const reading=classify({...outcome,sourceObservationId:undefined},undefined);
 assert.equal(reading.status,'unqualified-claim');
 assert.equal(reading.sourceAuthenticated,false);
});
test('matched source identity yields only conditional source linkage, never authentication',()=>{
 const reading=classify();
 assert.equal(reading.status,'source-linked-claim');
 assert.equal(reading.pnlCents,25);
 assert.equal(reading.sourceAuthenticated,false);
 assert.equal(reading.independentlyReconciled,false);
});
test('source must match principal, venue, instrument, order, receipt and cents',()=>{
 for(const [key,value] of Object.entries({
  principal:'another-principal',venue:'kalshi',instrument:'OTHER',
  orderId:'other-order',receipt:'other-receipt',pnlCents:26,
  sourceDigest:'not-a-digest',currency:'ETH',
 })) {
  const source={...sourceObservation,value:{...sourceObservation.value,[key]:value}};
  assert.throws(()=>classify(outcome,source),/source-bound outcome differs/);
 }
});
test('future, predecision and unpublished source observations are not retroactive evidence',()=>{
 for(const change of [
  {observedAt:'2026-10-08T05:00:00Z'},
  {observedAt:'2026-10-07T01:00:00Z',availableAt:'2026-10-07T00:00:00Z'},
  {availableAt:'2026-10-08T03:30:00Z',observedAt:'2026-10-08T03:00:00Z'},
 ]) assert.throws(()=>classify(outcome,{...sourceObservation,...change}),/source-bound outcome differs/);
 assert.throws(()=>classify({...outcome,observedAt:'2026-10-07T01:00:00Z'}),/cannot precede the decision/);
});
test('USD-cent accounting must be integral and within the safe integer range',()=>{
 for(const pnlCents of [0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])
  assert.throws(()=>classify({...outcome,pnlCents}),/integer USD cents/);
});

const at='2026-10-09T00:00:00Z';
const decisionId='decision-1',orderId='order-1';
const marketState=()=>({
 observations:{'source-1':structuredClone(sourceObservation)},
 decisions:{[decisionId]:{
  ...decision,id:decisionId,orders:[{...order,id:orderId,strategy:'measured-strategy'}],
 }},
 outcomes:{},
});
const add=(state,record)=>{state.outcomes[record.id]=record;return state;};

test('a repeated economic outcome is ONE logical trial, not two claimed returns',()=>{
 const s=marketState(),first={...outcome};
 add(s,first);add(s,{...first,id:'retelling',observedAt:'2026-10-08T05:00:00Z'});
 const read=readMarketOutcomeEvidence(s,at);
 assert.equal(read.events.length,1);
 assert.equal(read.events[0].claims[0].claimIds.length,2);
 assert.equal(read.performance['measured-strategy'].unverifiedClaims,1);
 assert.equal(read.performance['measured-strategy'].sourceLinkedClaims,1);
 assert.equal(read.performance['measured-strategy'].sourceLinkedClaimedPnlCents,25);
 assert.equal(read.performance['measured-strategy'].observations,0);
 assert.equal(read.performance['measured-strategy'].pnlCents,null);
 assert.equal(read.independentlyReconciled,false);
});
test('contradictory claim amounts coexist but cannot be silently summed or scored',()=>{
 const s=marketState();
 add(s,{...outcome});
 add(s,{...outcome,id:'opposed-assertion',pnlCents:-40,
  observedAt:'2026-10-08T06:00:00Z',sourceObservationId:undefined});
 const read=readMarketOutcomeEvidence(s,at);
 assert.equal(read.events.length,1);
 assert.equal(read.disputes.length,1);
 assert.equal(read.riskBlockingDisputes.length,0,
  'a bare contrary assertion cannot acquire operational risk-blocking authority');
 assert.equal(read.disputes[0].status,'contested');
 assert.deepEqual(read.disputes[0].claims.map(x=>x.pnlCents),[-40,25]);
 const stats=read.performance['measured-strategy'];
 assert.equal(stats.unverifiedClaims,1);
 assert.equal(stats.sourceLinkedClaims,1);
 assert.equal(stats.contestedOutcomes,1);
 assert.equal(stats.unverifiedClaimedPnlCents,null);
 assert.equal(stats.sourceLinkedClaimedPnlCents,null);
 assert.equal(stats.pnlCents,null);
});
test('conflicting source-linked original observations remain competing evidence',()=>{
 const s=marketState();
 add(s,{...outcome});
 s.observations['source-2']={...sourceObservation,id:'source-2',
  value:{...sourceObservation.value,pnlCents:-5}};
 add(s,{...outcome,id:'opposite-linked',sourceObservationId:'source-2',
  pnlCents:-5,observedAt:'2026-10-08T05:00:00Z'});
 const read=readMarketOutcomeEvidence(s,at);
 assert.equal(read.disputes.length,1);
 assert.deepEqual(read.disputes[0].claims.map(x=>x.sourceLinked),[true,true]);
 assert.equal(read.riskBlockingDisputes.length,1);
 assert.equal(read.performance['measured-strategy'].sourceLinkedDisputes,1);
 assert.equal(read.performance['measured-strategy'].sourceLinkedClaims,1);
});
test('a later telling cannot leak through the earlier observation filtration',()=>{
 const s=marketState();
 add(s,{...outcome});
 add(s,{...outcome,id:'future-rebuttal',pnlCents:-20,
  observedAt:'2026-10-09T10:00:00Z',sourceObservationId:undefined});
 const first=readMarketOutcomeEvidence(s,at);
 assert.equal(first.disputes.length,0);
 assert.equal(first.performance['measured-strategy'].unverifiedClaimedPnlCents,25);
 const later=readMarketOutcomeEvidence(s,'2026-10-10T00:00:00Z');
 assert.equal(later.disputes.length,1);
});
test('a receipt cannot be spent as evidence of two different orders',()=>{
 const s=marketState();
 add(s,{...outcome});
 s.decisions.second={...decision,id:'second',orders:[{...order,id:'another-order',strategy:'other'}]};
 add(s,{...outcome,id:'misattributed',decisionId:'second',orderId:'another-order',
  sourceObservationId:undefined});
 assert.throws(()=>readMarketOutcomeEvidence(s,at),/different planned orders/);
});
test('permutation of tellings and redundant claims cannot affect evidential state',()=>{
 const rows=[
  {...outcome},
  {...outcome,id:'copy',observedAt:'2026-10-08T05:00:00Z'},
  {...outcome,id:'dispute',pnlCents:-1,sourceObservationId:undefined},
 ];
 const a=marketState(),b=marketState();
 rows.forEach(row=>add(a,row));
 [...rows].reverse().forEach(row=>add(b,row));
 assert.deepEqual(readMarketOutcomeEvidence(a,at),readMarketOutcomeEvidence(b,at));
});
test('unknown source aliases do not count as measurements and unsafe cents are refused',()=>{
 const s=marketState();add(s,{...outcome,sourceObservationId:undefined});
 assert.equal(readMarketOutcomeEvidence(s,at).performance['measured-strategy'].observations,0);
 add(s,{...outcome,id:'invalid',pnlCents:Number.MAX_SAFE_INTEGER+1});
 assert.throws(()=>readMarketOutcomeEvidence(s,at),/integer USD cents/);
});


test('the same strategy label in two principals cannot silently pool economic outcomes',()=>{
 const s=marketState();
 s.decisions.other={
  id:'other',principal:'another-principal',at:decision.at,
  orders:[{id:'other-order',strategy:'measured-strategy',
    venue:'kalshi',instrument:'OTHER'}],
 };
 add(s,{...outcome,sourceObservationId:undefined});
 add(s,{...outcome,id:'other-claim',decisionId:'other',
  orderId:'other-order',receipt:'different-economic-event',
  sourceObservationId:undefined,pnlCents:-30});
 const r=readMarketOutcomeEvidence(s,at);
 assert.deepEqual(r.ambiguousStrategyNames,['measured-strategy']);
 assert.equal(Object.hasOwn(r.performance,'measured-strategy'),false);
 assert.equal(r.performanceByPrincipal['test-principal']
  ['measured-strategy'].unverifiedClaimedPnlCents,25);
 assert.equal(r.performanceByPrincipal['another-principal']
  ['measured-strategy'].unverifiedClaimedPnlCents,-30);
});


test('sub-millisecond ordering cannot admit outcome evidence before a decision', () => {
 const t0='2026-10-12T14:00:00.000000001Z';
 const t1='2026-10-12T14:00:00.000000002Z';
 const decisionNow={...decision,at:t1};
 const atStart={...outcome,observedAt:t0,sourceObservationId:undefined};
 assert.throws(()=>classifyMarketOutcome({outcome:atStart,decision:decisionNow,order}),
   /cannot precede the decision/);
 const atDecision={...atStart,observedAt:t1};
 assert.equal(classifyMarketOutcome({outcome:atDecision,decision:decisionNow,order}).status,'unqualified-claim');
});

test('original venue source must respect exact availability, observation and outcome clocks', () => {
 const t0='2026-10-12T14:00:00.000000001Z';
 const t1='2026-10-12T14:00:00.000000002Z';
 const t2='2026-10-12T14:00:00.000000003Z';
 const d={...decision,at:t0};
 const o={...outcome,observedAt:t2};
 const source={...sourceObservation,availableAt:t0,observedAt:t1};
 assert.equal(classifyMarketOutcome({outcome:o,decision:d,order,sourceObservation:source}).status,'source-linked-claim');
 for (const changed of [
   {...source,availableAt:t2},
   {...source,observedAt:'2026-10-12T14:00:00.000000004Z'},
   {...source,observedAt:'2026-02-30T14:00:00Z'},
 ]) assert.throws(()=>classifyMarketOutcome({outcome:o,decision:d,order,sourceObservation:changed}),
   /source-bound outcome differs/);
});

test('Kalshi, Alpaca and EVM/GMX claimed results cannot leak across nanosecond replay cuts', () => {
 const at='2026-10-12T14:00:00.000000001Z';
 const future='2026-10-12T14:00:00.000000002Z';
 for(const venue of ['kalshi','alpaca','evm']) {
  const s=marketState();
  s.decisions[decisionId].orders[0].venue=venue;
  s.decisions[decisionId].orders[0].instrument='TEST';
  s.decisions[decisionId].at='2026-10-12T13:59:59Z';
  s.observations['source-1']={
    ...sourceObservation,availableAt:'2026-10-12T13:59:59Z',observedAt:at,
    value:{...sourceObservation.value,venue,instrument:'TEST'}
  };
  add(s,{...outcome,observedAt:at});
  add(s,{...outcome,id:'future-contrary',observedAt:future,pnlCents:-25,sourceObservationId:undefined});
  const early=readMarketOutcomeEvidence(s,at);
  assert.equal(early.events.length,1);
  assert.equal(early.disputes.length,0);
  assert.equal(early.events[0].claims[0].sourceLinked,true);
  const later=readMarketOutcomeEvidence(s,future);
  assert.equal(later.disputes.length,1);
  assert.equal(later.events[0].claims.length,2);
 }
});
