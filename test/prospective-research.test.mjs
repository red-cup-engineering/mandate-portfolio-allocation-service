import test from 'node:test';
import assert from 'node:assert/strict';
import {observePredictionMarketStrategy,resolveProspectiveStrategyRows,studyProspectiveStrategy} from '../src/prediction-market-research.mjs';
const market={ticker:'KXFED-26OCT-T4.25',status:'active',yes_bid_dollars:'0.30',yes_ask_dollars:'0.32',close_time:'2099-01-01T00:00:00Z'};
function fetcher(signal=market,asset={bid:'2000',ask:'2001'}){
 const calls=[];return {calls,fetchImpl:async url=>{calls.push(String(url));return new Response(JSON.stringify(calls.length===1?{market:signal}:asset),{headers:{'content-type':'application/json'}});}};
}
test('prospective input preserves acquisition order and raw responses without outcome claims',async()=>{
 const f=fetcher(),row=await observePredictionMarketStrategy(f);
 assert.equal(f.calls.length,2);assert.ok(f.calls[0].includes('/markets/KXFED'));assert.ok(f.calls[1].endsWith('/ETH-USD/ticker'));
 assert.ok(Date.parse(row.featureAt)<=Date.parse(row.observedAt));assert.equal(row.rawMidpoint,0.31);assert.equal(row.eligibleForLiveUse,false);
 assert.equal(row.sources.length,2);assert.ok(row.sources.every(s=>s.observation.retrieval.responseDigest));assert.equal(row.returnFraction,undefined);
});
test('invalid or closed signals refuse before acquiring an entry mark',async()=>{
 for(const changes of [{status:'finalized'},{ticker:'another-market'},{yes_bid_dollars:null},{yes_ask_dollars:'0.2'},{yes_ask_dollars:'0.9'},{close_time:'2020-01-01T00:00:00Z'}]){
  const f=fetcher({...market,...changes});await assert.rejects(observePredictionMarketStrategy(f),/signal-price/);assert.equal(f.calls.length,1);
 }
});
test('asset marks must contain positive uncrossed quotes',async()=>{
 for(const asset of [{bid:null,ask:'1'},{bid:'1',ask:'0.5'},{bid:'NaN',ask:'1'}])await assert.rejects(observePredictionMarketStrategy(fetcher(market,asset)),/asset-price/);
});

import {hashPosition} from '@red-cup-engineering/gaming/running/rules';
function acquired(hours,price=2000){
 const observedAt=new Date(Date.parse('2026-10-01T00:00:01Z')+hours*3600000).toISOString(),featureAt=new Date(Date.parse(observedAt)-1000).toISOString();
 const body={kind:'prediction-market-prospective-observation/v1',market:market.ticker,asset:'ETH-USD',rawMidpoint:0.31,assetBid:price,assetAsk:price+1,featureAt,observedAt,sources:[{observation:{id:'signal-'+hours,observedAt:featureAt}},{observation:{id:'asset-'+hours,observedAt}}]};return {id:hashPosition(body),...body};
}
test('dense and duplicate looks yield only non-overlapping daily outcomes',()=>{
 const observations=Array.from({length:49},(_,h)=>acquired(h));observations.push(observations[0]);
 const result=resolveProspectiveStrategyRows({observations,observedAt:acquired(49).observedAt});
 assert.equal(result.rows.length,2);assert.equal(result.observations,49);assert.equal(result.rows[0].outcomeAt,result.rows[1].entryAt);assert.equal(result.rows[0].returnFraction,2000/2001-1);assert.equal(result.design.fillsObserved,false);
});
test('missed endpoints are not scored using later prices',()=>{
 const result=resolveProspectiveStrategyRows({observations:[acquired(0),acquired(25),acquired(49)],observedAt:acquired(50).observedAt});
 assert.equal(result.missedEndpoints,1);assert.equal(result.rows.length,1);assert.equal(result.rows[0].entryAt,acquired(25).observedAt);
});
test('mutated, future and mixed-market inputs cannot produce outcomes',()=>{
 assert.throws(()=>resolveProspectiveStrategyRows({observations:[{...acquired(0),assetBid:1}],observedAt:acquired(1).observedAt}),/identified-causal/);
 assert.throws(()=>resolveProspectiveStrategyRows({observations:[acquired(2)],observedAt:acquired(1).observedAt}),/identified-causal/);
 const second=acquired(24),{id,...body}=second;body.market='KXFED-26DEC-T4.25';
 assert.throws(()=>resolveProspectiveStrategyRows({observations:[acquired(0),{id:hashPosition(body),...body}],observedAt:acquired(25).observedAt}),/one-declared/);
});

test('prospective assessment waits for resolved training and evaluation instead of fabricating a model',()=>{
 const result=studyProspectiveStrategy({observations:[acquired(0),acquired(24)],observedAt:acquired(25).observedAt});assert.equal(result.status,'awaiting-resolved-outcomes');assert.equal(result.completedIntervals,1);assert.equal(result.eligibleForLiveUse,false);assert.equal(result.study,undefined);
});
test('resolved prospective assessment retains causal source rows and refuses unmeasured execution and repeated exploratory looks',()=>{
 const observations=Array.from({length:141},(_,i)=>acquired(i*24,2000+i*2));const result=studyProspectiveStrategy({observations,observedAt:acquired(141*24).observedAt,roundTripCostFraction:0});
 assert.equal(result.status,'studied');assert.equal(result.completedIntervals,140);assert.ok(result.study.scores.blockCount>=3);assert.equal(result.eligibleForLiveUse,false);assert.equal(result.study.scores.liveUseLimitations.length,2);assert.ok(result.study.scores.sourceObservationIds.includes('signal-0'));assert.ok(result.study.observations.every(row=>row.observation.source==='urn:red-cup-engineering:mandate-portfolio-allocation-service:scenario-study'));
});
