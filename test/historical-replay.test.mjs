import test from 'node:test';import assert from 'node:assert/strict';
import {researchPredictionMarketStrategy,replayPredictionMarketStudy} from '../src/prediction-market-research.mjs';
const now=Date.now(),end=Math.floor(now/86400000)*86400,start=end-90*86400;
const quotes=Array.from({length:90},(_,i)=>({end_period_ts:start+i*86400-600,yes_bid:{close_dollars:'0.20'},yes_ask:{close_dollars:'0.22'},volume_fp:'10'}));
const candles=Array.from({length:90},(_,i)=>[start+i*86400,90,110,100,100+(i%3-1),10]);
const fetchImpl=async url=>new Response(JSON.stringify(String(url).includes('coinbase')?candles:{candlesticks:quotes}),{headers:{'content-type':'application/json'}});
const acquired=await researchPredictionMarketStrategy({now,fetchImpl});
test('retained exploratory study replays without a new fetch or acceptance',()=>{const result=replayPredictionMarketStudy(acquired);assert.equal(result.status,'reproduced');assert.equal(result.studyId,acquired.study.id);assert.equal(result.rows,90);assert.equal(result.eligibleForLiveUse,false);assert.equal(result.independentlyAccepted,false);});
test('replay rejects changed rows, claimed scores, design and response bytes',()=>{
 for(const mutate of [a=>a.rows[0].returnFraction=.9,a=>a.study.eligibleForLiveUse=true,a=>a.study.scores.brier=0,a=>a.design.asset='BTC-USD',a=>a.sources[1].observation.retrieval.text='[]',a=>a.sources[0].observation.value.candlesticks[0].volume_fp='11']){
  const modified=structuredClone(acquired);mutate(modified);assert.throws(()=>replayPredictionMarketStudy(modified),/historical/);
 }
});
