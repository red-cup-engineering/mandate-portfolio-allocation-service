import test from 'node:test';
import assert from 'node:assert/strict';
import {observePredictionMarketStrategy} from '../src/prediction-market-research.mjs';
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
