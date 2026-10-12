import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMarketOutcome} from '../src/outcome-evidence-border.mjs';

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
