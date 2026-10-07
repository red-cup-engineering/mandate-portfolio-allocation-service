import test from 'node:test';
import assert from 'node:assert/strict';
import {observePredictionMarketStrategy,resolveProspectiveStrategyRows,studyProspectiveStrategy,createProspectiveProtocol} from '../src/prediction-market-research.mjs';
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
import {observation} from '../src/public-observations.mjs';
function acquired(hours,price=2000,ticker=market.ticker){
 const observedAt=new Date(Date.parse('2026-10-01T00:00:01Z')+hours*3600000).toISOString(),featureAt=new Date(Date.parse(observedAt)-1000).toISOString();
 const sources=[{source:`https://api.elections.kalshi.com/trade-api/v2/markets/${ticker}`,externalId:ticker,at:featureAt,value:{market:{...market,ticker}}},{source:'https://api.exchange.coinbase.com/products/ETH-USD/ticker',externalId:'ETH-USD',at:observedAt,value:{bid:String(price),ask:String(price+1)}}].map(({source,externalId,at,value})=>{const text=JSON.stringify(value);return observation({source,externalId,availableAt:at,observedAt:at,value,retrieval:{requestedUrl:source,finalUrl:source,text,responseBytes:Buffer.byteLength(text),selector:[],responseDigest:hashPosition(text),acquiredAt:at}});});
 const body={kind:'prediction-market-prospective-observation/v1',market:ticker,asset:'ETH-USD',rawMidpoint:0.31,signalBid:.30,signalAsk:.32,assetBid:price,assetAsk:price+1,featureAt,observedAt,sources};return {id:hashPosition(body),...body};
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
 const second=acquired(24,2000,'KXFED-26DEC-T4.25');
 assert.throws(()=>resolveProspectiveStrategyRows({observations:[acquired(0),second],observedAt:acquired(25).observedAt}),/one-declared/);
});

test('prospective assessment waits for resolved training and evaluation instead of fabricating a model',()=>{
 const protocol=createProspectiveProtocol({market:market.ticker,registeredAt:'2026-09-30T00:00:00Z',closeTime:market.close_time});const result=studyProspectiveStrategy({observations:[acquired(0),acquired(24)],observedAt:acquired(25).observedAt,protocol});assert.equal(result.status,'awaiting-frozen-evaluation-end');assert.equal(result.completedIntervals,1);assert.equal(result.eligibleForLiveUse,false);assert.equal(result.study,undefined);
});
test('resolved prospective assessment retains causal source rows and refuses unmeasured execution and repeated exploratory looks',()=>{
 const protocol=createProspectiveProtocol({market:market.ticker,registeredAt:'2026-09-30T00:00:00Z',closeTime:market.close_time,roundTripCostFraction:0});const observations=Array.from({length:141},(_,i)=>acquired(i*24,2000+i*2));const result=studyProspectiveStrategy({observations,observedAt:acquired(141*24).observedAt,protocol});
 assert.equal(result.status,'studied');assert.equal(result.completedIntervals,140);assert.ok(result.study.scores.blockCount>=3);assert.equal(result.eligibleForLiveUse,false);assert.equal(result.study.scores.liveUseLimitations.length,2);assert.ok(result.study.scores.sourceObservationIds.includes(acquired(24).sources[0].observation.id));assert.ok(result.study.observations.every(row=>row.observation.source==='urn:red-cup-engineering:mandate-portfolio-allocation-service:scenario-study'));
});

test('rehashing an outer record cannot detach prices or provenance from retained responses',()=>{
 const rehash=row=>{const {id,...body}=row;return {id:hashPosition(body),...body};};
 for(const mutate of [r=>{r.assetBid=1;},r=>{r.rawMidpoint=.9;},r=>{r.sources[0].observation.value.market.yes_bid_dollars='.9';},r=>{r.sources[1].observation.retrieval.text='{}';},r=>{r.sources[1].observation.source='https://fixture.invalid';},r=>{r.sources[1].observation.retrieval.responseBytes=1;}]){
  const row=structuredClone(acquired(0));mutate(row);assert.throws(()=>resolveProspectiveStrategyRows({observations:[rehash(row)],observedAt:acquired(1).observedAt}),/prospective-source/);
 }
 const row=structuredClone(acquired(0));row.sources[1].observation.value.bid='1';const {id,...source}=row.sources[1].observation;row.sources[1].observation={id:hashPosition(source),...source};assert.throws(()=>resolveProspectiveStrategyRows({observations:[rehash(row)],observedAt:acquired(1).observedAt}),/source-value-mismatch/);
});

test('preregistered windows cannot move with new outcomes, edits or contract lifetime',()=>{
 const protocol=createProspectiveProtocol({market:market.ticker,registeredAt:'2026-09-30T00:00:00Z',closeTime:market.close_time});
 const observations=Array.from({length:80},(_,i)=>acquired(i*24,2000+i));
 const first=studyProspectiveStrategy({protocol,observations:observations.slice(0,60),observedAt:acquired(61*24).observedAt}),later=studyProspectiveStrategy({protocol,observations,observedAt:acquired(81*24).observedAt});assert.deepEqual(first.study.predictions,later.study.predictions);assert.deepEqual(first.study.model.specification.expectedReturns,later.study.model.specification.expectedReturns);assert.equal(first.study.observations[0].observation.observedAt,acquired(61*24).observedAt);assert.equal(first.study.scores.rowDigest,later.study.scores.rowDigest);
 const {id,...changed}=protocol;changed.roundTripCostFraction=0;assert.throws(()=>studyProspectiveStrategy({protocol:{id,...changed},observations,observedAt:acquired(81*24).observedAt}),/unchanged-preregistered/);
 const edited={...changed,id:hashPosition(changed)};assert.throws(()=>studyProspectiveStrategy({protocol:edited,observations,observedAt:'2026-09-01T00:00:00Z'}),/unchanged-preregistered/);
 const short=createProspectiveProtocol({market:market.ticker,registeredAt:'2026-09-30T00:00:00Z',closeTime:'2026-10-28T00:00:00Z'});assert.equal(studyProspectiveStrategy({protocol:short,observations:[],observedAt:'2026-10-01T00:00:00Z'}).status,'contract-lifetime-insufficient');
});
