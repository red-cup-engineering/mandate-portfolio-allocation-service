import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistory,historySection} from '@red-cup-engineering/signcraft/history';
import {address} from '@red-cup-engineering/signcell/cell';
import {projectMarketOutcomeEvidenceSigns} from '../src/settlement-sign-evidence.mjs';
import {composeMarketOutcomeEvidenceHistory,outcomeSourceReceiptCells} from '../src/scenario-sign-history.mjs';

const decision={id:'decision',principal:'test-principal',
 at:'2026-10-07T02:00:00Z',
 orders:[{id:'order',strategy:'conditional-alpha',venue:'kalshi',instrument:'CONTRACT'}],
};
const at='2026-10-08T20:00:00Z';
const claim=(id,pnlCents,when='2026-10-08T04:00:00Z')=>({
 id,decisionId:'decision',orderId:'order',receipt:'single-venue-economic-event',
 pnlCents,observedAt:when,
});
const state=(rows=[])=>({
 decisions:{decision},
 observations:{},
 outcomes:Object.fromEntries(rows.map(row=>[row.id,row])),
});

test('a sole assertion is SignCell support for a CLAIM, never authenticated P&L',()=>{
 const reading=projectMarketOutcomeEvidenceSigns({state:state([claim('one',5)]),at});
 assert.equal(reading.claims.length,1);
 const x=reading.claims[0];
 assert.equal(address(x.cell),x.address);
 assert.equal(x.cell.predicate,'has-claimed-economic-pnl-cents');
 assert.equal(x.proposition.claimedPnlCents,5);
 assert.equal(x.supportsClaim,true);
 assert.equal(x.opposesClaim,false);
 assert.equal(reading.acceptedOutcomeCount,0);
 assert.equal(reading.tradeEligible,false);
});
test('opposed telling is native FOUR both, without asserting profit',()=>{
 const r=projectMarketOutcomeEvidenceSigns({state:state([
  claim('a',5),claim('b',-5,'2026-10-08T04:10:00Z'),
 ]),at});
 assert.equal(r.disputedEconomicEvents,1);
 assert.equal(r.claims.length,2);
 assert.ok(r.claims.every(x=>x.supportsClaim&&x.opposesClaim));
 assert.notEqual(r.claims[0].address,r.claims[1].address);
 assert.ok(r.claims.every(x=>x.cell.for.length>0&&x.cell.against.length>0));
 assert.ok(r.claims.every(x=>x.sourceAuthenticated===false));
});
test('SignGraph references actual claim-premise addresses; SignCraft replay is idempotent',()=>{
 const source=state([claim('a',5)]);
 const first=composeMarketOutcomeEvidenceHistory({state:source,at});
 assert.equal(first.status,'composed');
 assert.equal(first.projection.claims.length,1);
 assert.equal(first.flow.kind,'signgraph.flowNetwork');
 assert.equal(first.flow.edges.length,1);
 assert.equal(first.flow.edges[0].from,'a');
 assert.equal(first.flow.edges[0].to,first.projection.claims[0].address);
 const repeated=composeMarketOutcomeEvidenceHistory({
  history:first.history,state:source,at,
 });
 assert.equal(repeated.status,'already-observed');
 assert.deepEqual(repeated.heads,first.heads);

 const contested=state([claim('a',5),claim('b',-5)]);
 const next=composeMarketOutcomeEvidenceHistory({
  history:first.history,state:contested,at,
 });
 assert.equal(next.status,'composed');
 assert.equal(next.projection.disputedEconomicEvents,1);
 assert.equal(next.flow.edges.length,2);
 assert.ok(historySection(next.history,'single-venue-economic-event',
  'has-claimed-economic-pnl-cents').length>=2);
 assert.equal(composeMarketOutcomeEvidenceHistory({
  history:next.history,state:contested,at,
 }).status,'already-observed');
});
test('later source claims cannot rewrite the earlier evidence filtration',()=>{
 const s=state([claim('a',5),claim('b',-5,'2026-10-09T04:00:00Z')]);
 const early=projectMarketOutcomeEvidenceSigns({
  state:s,at:'2026-10-08T06:00:00Z',
 });
 const late=projectMarketOutcomeEvidenceSigns({state:s,at:'2026-10-10T00:00:00Z'});
 assert.equal(early.disputedEconomicEvents,0);
 assert.equal(late.disputedEconomicEvents,1);
 const first=early.claims[0];
 const revised=late.claims.find(x=>x.proposition.claimedPnlCents===5);
 assert.equal(first.address,revised.address,
  'adding opposition changes knowledge, never the triple content address');
 assert.deepEqual(first.cell.for,revised.cell.for,
  'later opposition must not rewrite the original positive witness');
 assert.equal(first.cell.against.length,0);
 assert.equal(revised.cell.against.length,1);
});
test('empty evidence neither creates a revision nor a fictitious SignGraph',()=>{
 const empty=composeMarketOutcomeEvidenceHistory({
  history:createHistory(),state:state(),at,
 });
 assert.equal(empty.status,'already-observed');
 assert.equal(empty.projection.claims.length,0);
 assert.equal(empty.graph,null);
 assert.equal(empty.flow,null);
});


test('outcome receiving reuses canonical SignCell custody used by Bayes and robust proofs',()=>{
 const original={
  id:'source-1',issuer:'synthetic-independent-reader',
  sourceRef:'fixture://original-order-1',
  sha256:'sha256:'+'a'.repeat(64),
  observedAt:'2026-10-08T03:00:00Z',
  availableAt:'2026-10-08T03:30:00Z',
 };
 const receipt=()=>({
  sourceObservationIds:['source-1'],sourceReceipts:[original],at,
 });
 const cells=outcomeSourceReceiptCells(receipt());
 assert.equal(cells.length,1);
 assert.equal(cells[0].subject,original.id);
 assert.equal(cells[0].predicate,'prediction-market-source-receipt');
 assert.equal(cells[0].object.sha256,original.sha256);
 assert.ok(cells[0].for.length);
 assert.throws(()=>outcomeSourceReceiptCells({
  ...receipt(),sourceObservationIds:['source-1','source-1'],
 }),/distinct/);
 assert.throws(()=>outcomeSourceReceiptCells({
  ...receipt(),sourceReceipts:[{...original,availableAt:'2026-10-10T00:00:00Z'}],
 }),/bounded absolute clocks/);
});

test('later corroboration adds its own source witness without reclassifying the first',()=>{
 const source={
  id:'source-1',source:'urn:synthetic:kalshi',
  availableAt:'2026-10-08T04:08:00Z',
  observedAt:'2026-10-08T04:09:00Z',
  value:{kind:'venue-realized-pnl-v1',
   decisionId:'decision',orderId:'order',principal:'test-principal',
   venue:'kalshi',instrument:'CONTRACT',receipt:'single-venue-economic-event',
   currency:'USD',pnlCents:5,sourceDigest:'sha256:'+'a'.repeat(64)},
 };
 const original=claim('first',5);
 const corroboration={...claim('second',5,'2026-10-08T04:10:00Z'),
   sourceObservationId:source.id};
 const s=state([original,corroboration]);
 s.observations[source.id]=source;
 const early=projectMarketOutcomeEvidenceSigns({state:s,at:'2026-10-08T04:05:00Z'});
 const later=projectMarketOutcomeEvidenceSigns({state:s,at:'2026-10-08T05:00:00Z'});
 const one=early.claims[0],two=later.claims[0];
 assert.equal(one.address,two.address);
 assert.equal(one.cell.for.length,1);
 assert.equal(two.cell.for.length,2);
 assert.deepEqual(one.cell.for[0],two.cell.for.find(w=>w.claimId==='first'));
 assert.deepEqual(two.cell.for.find(w=>w.claimId==='first').sourceObservationIds,[]);
 assert.equal(two.cell.for.find(w=>w.claimId==='first').sourceLinked,false);
 assert.deepEqual(two.cell.for.find(w=>w.claimId==='second').sourceObservationIds,['source-1']);
 assert.equal(two.cell.for.find(w=>w.claimId==='second').sourceLinked,true);
 assert.equal(two.cell.against.length,0);
 assert.equal(later.tradeEligible,false);
});

test('future reused claim identity cannot rewrite a historical point-in-time reading',()=>{
 const s=state([claim('first',5)]);
 s.outcomes.forgedFuture={...claim('first',9,'2026-10-09T04:00:00Z')};
 const earlier=projectMarketOutcomeEvidenceSigns({state:s,at:'2026-10-08T05:00:00Z'});
 assert.equal(earlier.claims.length,1);
 assert.equal(earlier.claims[0].cell.for.length,1);
 assert.throws(()=>projectMarketOutcomeEvidenceSigns({state:s,at:'2026-10-10T00:00:00Z'}),
  /unique original economic-outcome claim ID/);
});
