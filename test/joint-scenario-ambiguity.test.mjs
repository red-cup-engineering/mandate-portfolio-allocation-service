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
