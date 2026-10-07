import test from 'node:test';
import assert from 'node:assert/strict';
import {fitScenarioStudy} from '../src/scenario-study.mjs';
const iso=t=>new Date(t).toISOString(),start=Date.parse('2026-01-01T00:00:00Z');
function study({duration=86400000,cost=0.001,uncertain=false,overlap=false,limitations=[]}={}){
 const rows=Array.from({length:140},(_,i)=>({id:'synthetic-only-'+i,availableAt:iso(start+i*duration-2000),featureAt:iso(start+i*duration-1000),entryAt:iso(start+i*duration),outcomeAt:iso(start+(i+1)*duration),value:i%2?0.1:0.9,scenario:i%2?'down':'up',returnFraction:i%2?-0.01:uncertain?(i===138?0.5:0.0005):0.01,evidenceIds:['synthetic-only']}));
 if(overlap)rows[1]={...rows[0],id:'another-id-same-return'};
 return fitScenarioStudy({rows,source:'https://fixture.invalid/signal',path:['signal'],bins:[{lower:0,upper:0.5},{lower:0.5,upper:1}],scenarios:['up','down'],roundTripCostFraction:cost,liveUseLimitations:limitations,observedAt:'2026-10-07T00:00:00Z'});
}
test('positive measured calibration and net returns admit the study; high costs refuse it',()=>{
 assert.equal(study().eligibleForLiveUse,true);const costly=study({cost:0.02});assert.equal(costly.eligibleForLiveUse,false);assert.ok(costly.scores.netReturnConfidenceLowerBound<0);
});
test('positive mean from one outlier cannot establish financial confidence',()=>{
 const uncertain=study({uncertain:true});assert.ok(uncertain.scores.strategyMeanNetReturn>0);assert.ok(uncertain.scores.brier<uncertain.scores.baselineBrier);assert.ok(uncertain.scores.netReturnConfidenceLowerBound<0);assert.equal(uncertain.eligibleForLiveUse,false);
});
test('many intraday rows cannot manufacture independent calendar blocks',()=>{
 const dense=study({duration:60000});assert.equal(dense.scores.blockCount,0);assert.equal(dense.scores.confidenceLowerBound,null);assert.equal(dense.eligibleForLiveUse,false);
});
test('overlapping returns cannot enlarge a single-asset study',()=>assert.throws(()=>study({overlap:true}),/overlapping-asset-return/));

test('positive statistics do not remove unresolved live-use assumptions',()=>{const result=study({limitations:['historical availability unobserved']});assert.ok(result.scores.confidenceLowerBound>0);assert.ok(result.scores.netReturnConfidenceLowerBound>0);assert.equal(result.eligibleForLiveUse,false);});

test('raw prediction-market signal remains distinct from order-constrained bands',async()=>{
 const {kalshiMacroObservation,observation}=await import('../src/public-observations.mjs');
 const at='2026-10-07T00:00:00Z';const common={event_ticker:'KXFED-26OCT',strike_type:'greater',status:'active',close_time:'2026-11-01T00:00:00Z'};
 const parent=observation({source:'https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=KXFED-26OCT',externalId:'fixture',availableAt:at,observedAt:at,value:{markets:[{...common,ticker:'low',floor_strike:4,yes_bid_dollars:'0.2',yes_ask_dollars:'0.6'},{...common,ticker:'high',floor_strike:4.25,yes_bid_dollars:'0.4',yes_ask_dollars:'0.5'}]}});
 const value=kalshiMacroObservation(parent,at).observation.value;assert.equal(value.signals.low.midpoint,0.5);assert.equal(value.signals.low.rawMidpoint,0.4);
});
