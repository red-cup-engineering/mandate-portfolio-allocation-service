import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateJointScenarioAmbiguity} from '../src/joint-scenario-ambiguity.mjs';

const at='2026-10-12T20:00:00Z';
const forecast=()=>({
  id:'shared-forecast',observedAt:'2026-10-12T18:00:00Z',
  availableAt:'2026-10-12T18:05:00Z',
  horizon:'2026-10-13T03:00:00Z',
  evidenceIds:['source-measurement'],
  scenarios:[
    {id:'up',probability:0.5,heldPnlCentsByVenue:{}},
    {id:'down',probability:0.5,heldPnlCentsByVenue:{}},
  ],
});
const actions=()=>[
  {id:'abstain',payoffsUsdByScenario:{up:0,down:0}},
  {id:'alpaca-long',payoffsUsdByScenario:{up:2,down:-1}},
  {id:'kalshi-no',payoffsUsdByScenario:{up:-1,down:2}},
];
const ambiguity=()=>({
  conditionedOnForecastId:'shared-forecast',
  observedAt:'2026-10-12T19:00:00Z',
  availableAt:'2026-10-12T19:01:00Z',
  evidenceIds:['heldout-model-uncertainty'],
  totalVariationRadius:0.2,
});
const evaluate=(changes={})=>evaluateJointScenarioAmbiguity({
  forecast:forecast(),actions:actions(),ambiguity:ambiguity(),at,...changes,
});
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-10,String(x)+' != '+String(y));
const action=(result,id)=>result.actionEvaluations.find(row=>row.id===id);

test('one joint ambiguity ball changes both Alpaca and Kalshi payoffs coherently',()=>{
  const r=evaluate();
  for(const id of ['alpaca-long','kalshi-no']){
    near(action(r,id).nominalExpectedUsd,0.5);
    near(action(r,id).worstCaseExpectedUsd,-0.1);
    near(action(r,id).bestCaseExpectedUsd,1.1);
    near(action(r,id).worstCaseRegretUsd,1.2);
    near(action(r,id).worstCaseUsedTotalVariation,0.2);
    near(action(r,id).bestCaseUsedTotalVariation,0.2);
  }
  assert.equal(r.maximinExpectedPayoffAction,'abstain');
  assert.equal(r.minimaxRegretAction,'abstain');
  near(action(r,'abstain').worstCaseRegretUsd,1.1);
  assert.equal(r.radiusEmpiricallyVerified,false);
  assert.equal(r.tradeEligible,false);
  assert.equal(r.orderEffect,false);
});

test('zero ambiguity returns the nominal law; radius one bounds by state extremes',()=>{
  const z=evaluate({ambiguity:{...ambiguity(),totalVariationRadius:0}});
  near(action(z,'alpaca-long').worstCaseExpectedUsd,0.5);
  near(action(z,'alpaca-long').bestCaseExpectedUsd,0.5);
  near(action(z,'alpaca-long').worstCaseRegretUsd,0);
  const all=evaluate({ambiguity:{...ambiguity(),totalVariationRadius:1}});
  near(action(all,'alpaca-long').worstCaseExpectedUsd,-1);
  near(action(all,'alpaca-long').bestCaseExpectedUsd,2);
  near(action(all,'alpaca-long').worstCaseRegretUsd,3);
});

test('the numerical payoff of a 3-world cross-venue portfolio stays joint',()=>{
  const f={...forecast(),scenarios:[
    {id:'up',probability:.4},{id:'flat',probability:.2},{id:'down',probability:.4},
  ]};
  const menu=[
    {id:'abstain',payoffsUsdByScenario:{up:0,flat:0,down:0}},
    {id:'gmx-long-and-kalshi-hedge',payoffsUsdByScenario:{up:5,flat:-1,down:-3}},
    {id:'alpaca-long',payoffsUsdByScenario:{up:2,flat:0,down:-2}},
  ];
  const r=evaluate({forecast:f,actions:menu,
    ambiguity:{...ambiguity(),totalVariationRadius:.15}});
  near(action(r,'gmx-long-and-kalshi-hedge').nominalExpectedUsd,.6);
  near(action(r,'gmx-long-and-kalshi-hedge').worstCaseExpectedUsd,-.6);
  assert.equal(r.actionEvaluations.length,3);
  for(const row of r.actionEvaluations){
    near(row.worstCaseScenarioProbabilities.reduce((s,x)=>s+x[1],0),1);
    assert.ok(row.worstCaseUsedTotalVariation<=.15+1e-12);
  }
});

test('permutations change no action valuations or selected strategy',()=>{
  const orig=evaluate();
  const perm=evaluate({
    forecast:{...forecast(),scenarios:[...forecast().scenarios].reverse()},
    actions:[...actions()].reverse(),
  });
  for(const id of actions().map(a=>a.id)){
    near(action(orig,id).worstCaseExpectedUsd,action(perm,id).worstCaseExpectedUsd);
    near(action(orig,id).worstCaseRegretUsd,action(perm,id).worstCaseRegretUsd);
  }
  assert.equal(perm.maximinExpectedPayoffAction,orig.maximinExpectedPayoffAction);
  assert.equal(perm.minimaxRegretAction,orig.minimaxRegretAction);
});

test('lookahead, guessed radius, malformed actions and non-simplex models fail closed',()=>{
  assert.throws(()=>evaluate({ambiguity:{...ambiguity(),evidenceIds:[]}}),TypeError);
  assert.throws(()=>evaluate({ambiguity:{...ambiguity(),conditionedOnForecastId:'older-model'}}),TypeError);
  assert.throws(()=>evaluate({ambiguity:{...ambiguity(),availableAt:'2026-10-12T21:00:00Z'}}),TypeError);
  assert.throws(()=>evaluate({ambiguity:{...ambiguity(),totalVariationRadius:1.1}}),TypeError);
  assert.throws(()=>evaluate({forecast:{...forecast(),availableAt:'2026-10-12T23:00:00Z'}}),TypeError);
  assert.throws(()=>evaluate({at:'2026-10-13T05:00:00Z'}),TypeError);
  assert.throws(()=>evaluate({actions:actions().filter(a=>a.id!=='abstain')}),TypeError);
  assert.throws(()=>evaluate({actions:[...actions(),{id:'partial',payoffsUsdByScenario:{up:1}}]}),TypeError);
  const f=forecast();f.scenarios[0].probability=.7;
  assert.throws(()=>evaluate({forecast:f}),RangeError);
});

test('a state with zero prior weight can be inside the assumed ambiguity ball',()=>{
  const f={...forecast(),scenarios:[
    {id:'up',probability:1},{id:'down',probability:0},
  ]};
  const r=evaluate({forecast:f,
    ambiguity:{...ambiguity(),totalVariationRadius:.2}});
  near(action(r,'alpaca-long').worstCaseExpectedUsd,1.4);
  near(action(r,'alpaca-long').bestCaseExpectedUsd,2);
  assert.deepEqual(action(r,'alpaca-long').worstCaseScenarioProbabilities,
    [['up',.8],['down',.2]]);
});


test('vanishing high-payoff donor cannot abort later large adverse mass transfers',()=>{
  // A floating addition of 1e-20 to the 0.6 recipient rounds to 0.6.
  // The former extremizer stopped at that unrepresentable microtransfer,
  // leaving the 0.4-probability high-payoff world untouched.
  const f={...forecast(),scenarios:[
    {id:'low',probability:0.6},
    {id:'dust-high',probability:1e-20},
    {id:'high',probability:0.4},
  ]};
  const menu=[
    {id:'abstain',payoffsUsdByScenario:{low:0,'dust-high':0,high:0}},
    {id:'joint-risk',payoffsUsdByScenario:{low:-10,'dust-high':100,high:10}},
  ];
  const r=evaluate({
    forecast:f,actions:menu,
    ambiguity:{...ambiguity(),totalVariationRadius:.35},
  });
  const a=action(r,'joint-risk');
  near(a.nominalExpectedUsd,-2);
  near(a.worstCaseExpectedUsd,-9);
  near(a.bestCaseExpectedUsd,36.5);
  near(a.worstCaseUsedTotalVariation,.35);
  assert.ok(a.worstCaseScenarioProbabilities.every(([,q])=>q>=0&&q<=1));
  near(a.worstCaseScenarioProbabilities.reduce((n,[,q])=>n+q,0),1);
  assert.equal(r.tradeEligible,false);
});

test('vanishing low-payoff donor also cannot suppress a maximum payoff bound',()=>{
  const f={...forecast(),scenarios:[
    {id:'high',probability:0.4},
    {id:'dust-low',probability:1e-20},
    {id:'low',probability:0.6},
  ]};
  const menu=[
    {id:'abstain',payoffsUsdByScenario:{high:0,'dust-low':0,low:0}},
    {id:'joint-risk',payoffsUsdByScenario:{high:10,'dust-low':-100,low:-10}},
  ];
  const r=evaluate({
    forecast:f,actions:menu,
    ambiguity:{...ambiguity(),totalVariationRadius:.25},
  });
  const a=action(r,'joint-risk');
  near(a.nominalExpectedUsd,-2);
  near(a.bestCaseExpectedUsd,3);
  near(a.bestCaseUsedTotalVariation,.25);
  near(a.bestCaseScenarioProbabilities.reduce((n,[,q])=>n+q,0),1);
});

test('greedy TV extremal values are monotonic in the ambiguity radius',()=>{
  const f={...forecast(),scenarios:[
    {id:'severe',probability:.15},
    {id:'neutral',probability:.65},
    {id:'good',probability:.2},
  ]};
  const menu=[
    {id:'abstain',payoffsUsdByScenario:{severe:0,neutral:0,good:0}},
    {id:'package',payoffsUsdByScenario:{severe:-8,neutral:1,good:12}},
  ];
  let previousWorst=Infinity,previousBest=-Infinity;
  for(const radius of [0,.01,.1,.3,.7,1]){
    const r=evaluate({
      forecast:f,actions:menu,
      ambiguity:{...ambiguity(),totalVariationRadius:radius},
    });
    const a=action(r,'package');
    assert.ok(a.worstCaseExpectedUsd<=previousWorst+1e-10);
    assert.ok(a.bestCaseExpectedUsd>=previousBest-1e-10);
    assert.ok(a.worstCaseUsedTotalVariation<=radius+1e-10);
    assert.ok(a.bestCaseUsedTotalVariation<=radius+1e-10);
    previousWorst=a.worstCaseExpectedUsd;
    previousBest=a.bestCaseExpectedUsd;
  }
});
