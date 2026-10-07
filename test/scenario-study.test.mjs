import test from 'node:test';
import assert from 'node:assert/strict';
import {fitScenarioStudy} from '../src/scenario-study.mjs';
const iso=t=>new Date(t).toISOString(),start=Date.parse('2026-01-01T00:00:00Z');
function study({duration=86400000,cost=0.001,uncertain=false,overlap=false}={}){
 const rows=Array.from({length:140},(_,i)=>({id:'synthetic-only-'+i,availableAt:iso(start+i*duration-2000),featureAt:iso(start+i*duration-1000),entryAt:iso(start+i*duration),outcomeAt:iso(start+(i+1)*duration),value:i%2?0.1:0.9,scenario:i%2?'down':'up',returnFraction:i%2?-0.01:uncertain?(i===138?0.5:0.0005):0.01,evidenceIds:['synthetic-only']}));
 if(overlap)rows[1]={...rows[0],id:'another-id-same-return'};
 return fitScenarioStudy({rows,source:'https://fixture.invalid/signal',path:['signal'],bins:[{lower:0,upper:0.5},{lower:0.5,upper:1}],scenarios:['up','down'],roundTripCostFraction:cost,observedAt:'2026-10-07T00:00:00Z'});
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
