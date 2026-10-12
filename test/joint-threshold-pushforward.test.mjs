import test from 'node:test';
import assert from 'node:assert/strict';
import {projectJointThresholdScenarios} from '../src/joint-threshold-pushforward.mjs';

const at='2026-10-12T19:00:00Z';
const forecast={
 id:'shared-source-distribution',observedAt:'2026-10-12T16:00:00Z',
 availableAt:'2026-10-12T17:00:00Z',
 horizon:'2026-10-13T12:00:00Z',
 evidenceIds:['source-measurement','earlier-calibration'],
 scenarios:[
  {id:'low',probability:.2,values:{X:1}},
  {id:'middle',probability:.5,values:{X:2}},
  {id:'high',probability:.3,values:{X:3}},
 ],
};
const thresholds=[
 {id:'above-1',threshold:1},{id:'above-2',threshold:2},
 {id:'above-3',threshold:3},
];
const run=(override={})=>projectJointThresholdScenarios({
 forecast,outcomeValueKey:'X',thresholds,comparator:'>',at,...override,
});
test('nested events retain shared scenario dependence instead of independent Bernoulli draws',()=>{
 const result=run();
 assert.deepEqual(result.marketProbabilities.map(x=>x.probabilityYes),[.8,.3,0]);
 assert.equal(result.nestedPairs.length,6);
 const cross=result.nestedPairs.find(x=>x.first==='above-1'&&x.second==='above-2');
 assert.ok(Math.abs(cross.jointYesProbability-.3)<1e-12);
 assert.ok(Math.abs(cross.yesCovariance-(.3-.8*.3))<1e-12);
 assert.equal(result.tradeEligible,false);
});
test('opposite threshold order is an actual increasing nested family',()=>{
 const thresholds=[{id:'at-most-2',threshold:2},{id:'at-most-1',threshold:1}];
 const result=run({thresholds,comparator:'<='});
 assert.deepEqual(result.marketProbabilities.map(x=>x.probabilityYes),[.2,.7]);
 assert.ok(Math.abs(result.nestedPairs.at(-1).yesCovariance-(.7-.7*.7))<1e-12);
});
test('unknown source, duplicated strike, future publication or wrong scenario space cannot enter research',()=>{
 assert.throws(()=>run({thresholds:[{id:'a',threshold:1},{id:'b',threshold:1}]}),TypeError);
 assert.throws(()=>run({forecast:{...forecast,availableAt:'2026-10-12T21:00:00Z'}}),TypeError);
 assert.throws(()=>run({forecast:{...forecast,scenarios:forecast.scenarios.slice(0,2)}}),RangeError);
 assert.throws(()=>run({comparator:'==='}),TypeError);
});
