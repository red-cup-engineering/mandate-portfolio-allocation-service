import test from 'node:test';
import assert from 'node:assert/strict';
import {compareBinaryParticipationMenu} from '../src/binary-participation-menu.mjs';

const at='2026-10-12T20:00:00Z',scope='AAA|United States|regular|2026-10-13';
const evidence=(id='forecast')=>({id,scope,availableAt:'2026-10-12T19:30:00Z',
 evidenceIds:['source-vintage','prior-model-scores']});
const probabilityYes={low:.90,high:.95};
const env=(x={})=>({at,scope,settlementProbabilityYes:probabilityYes,
 settlementEvidence:evidence(),...x});
const quote=(opts={})=>({id:'one-lot',side:'yes',priceUsd:.91,feeUsd:.002,
 quoteObservedAt:'2026-10-12T19:59:45Z',closeAt:'2026-10-13T01:00:00Z',
 depthContracts:5,...opts});
const fillModel=(kind='outcome-conditioned',opts={})=>({...evidence('queue-model'),
 kind,...opts});

test('do nothing is a real zero-profit action in an empty menu',()=>{
 const r=compareBinaryParticipationMenu(env());
 assert.equal(r.decision.action,'abstain');
 assert.equal(r.decision.lowerExpectedUsdPerAttempt,0);
 assert.deepEqual(r.candidates,[]);
 assert.equal(r.orderEffect,false);
});

test('taker compares conservative settlement p to the exact acquired-side ask and fee',()=>{
 const r=compareBinaryParticipationMenu(env({takerCandidates:[quote({
  priceUsd:.8,feeUsd:.01,
 })]}));
 assert.equal(r.decision.action,'conditional-candidate');
 assert.equal(r.decision.kind,'taker');
 assert.ok(Math.abs(r.decision.lowerExpectedUsdPerAttempt-.09)<1e-12);
 assert.equal(r.tradeEligible,false);
});

test('NO taker correctly buys NO at purchased-side price, not YES mid',()=>{
 const r=compareBinaryParticipationMenu(env({takerCandidates:[
  quote({id:'take-no',side:'no',priceUsd:.03,feeUsd:.002}),
 ]}));
 assert.equal(r.candidates[0].expectedPnlUsdPerAttempt.low,1-.95-.032);
 assert.equal(r.candidates[0].expectedPnlUsdPerAttempt.high,1-.90-.032);
});

test('adversarial conditional maker selection can dominate a seemingly favorable taker',()=>{
 const r=compareBinaryParticipationMenu(env({
  settlementProbabilityYes:{low:.99,high:.99},
  takerCandidates:[quote({id:'take',priceUsd:.98,feeUsd:.005})],
  makerCandidates:[quote({id:'rest',priceUsd:.85,feeUsd:.002,
   fillEvidence:fillModel(),probabilityFillGivenWin:{low:.2,high:.2},
   probabilityFillGivenLoss:{low:.7,high:.7}})],
 }));
 assert.equal(r.decision.id,'rest');
 assert.ok(r.decision.lowerExpectedUsdPerAttempt>0);
 assert.ok(r.candidates.some(x=>x.kind==='taker'));
 assert.equal(r.tradeEligible,false);
});

test('maker cannot substitute unconditional settlement p for adverse fill selection',()=>{
 const r=compareBinaryParticipationMenu(env({
  makerCandidates:[quote({id:'bad-maker',priceUsd:.96,
   fillEvidence:fillModel(),probabilityFillGivenWin:{low:.15,high:.15},
   probabilityFillGivenLoss:{low:.9,high:.9}})],
 }));
 assert.equal(r.decision.action,'abstain');
 assert.ok(r.candidates[0].expectedPnlUsdPerAttempt.low<0);
});

test('marginal-only fill uncertainty delegates to the existing robust Frechet model',()=>{
 const r=compareBinaryParticipationMenu(env({
  makerCandidates:[quote({id:'marginal',feeUsd:.001,
   fillEvidence:fillModel('marginal'),
   probabilityFill:{low:.1,high:.3}})],
 }));
 assert.equal(r.candidates[0].details.kind,'binary-maker-frechet-placement-v1');
 assert.equal(r.candidates[0].fillModelId,'queue-model');
});

test('incentive pool is NOT added as guaranteed dollars to maker ranking',()=>{
 const base=quote({id:'lip-quote',priceUsd:.96,
  fillEvidence:fillModel(),probabilityFillGivenWin:{low:.1,high:.1},
  probabilityFillGivenLoss:{low:.9,high:.9}});
 const r=compareBinaryParticipationMenu(env({
  makerCandidates:[{...base,incentiveScenario:{low:1,high:10}}],
 }));
 assert.equal(r.candidates[0].kind,'incentive-maker');
 assert.deepEqual(r.candidates[0].hypotheticalIncentiveUsdPerAttempt,{low:1,high:10});
 assert.equal(r.candidates[0].rewardAlreadyIncludedUsd,0);
 assert.equal(r.decision.action,'abstain');
});

test('structural hedge with no joint partial-execution model remains visible but unranked',()=>{
 const r=compareBinaryParticipationMenu(env({
  structuralCandidates:[{id:'dutch',allLegsGuaranteedPnlUsd:.2}],
 }));
 assert.equal(r.decision.action,'abstain');
 assert.equal(r.gaps.length,1);
 assert.match(r.gaps[0].reason,/joint leg-execution/u);
});

test('hypothetically qualified joint hedge uses all-fill profits and bounded partial-loss',()=>{
 const r=compareBinaryParticipationMenu(env({
  structuralCandidates:[{
   id:'joint-hedge',allLegsGuaranteedPnlUsd:.20,
   allLegsFillModel:fillModel('atomic-joint'),
   allLegsFillProbability:{low:.8,high:.95},
   maxPartialExecutionLossUsd:.1,carryUsd:.01,
  }],
 }));
 assert.equal(r.decision.id,'joint-hedge');
 assert.ok(Math.abs(r.decision.lowerExpectedUsdPerAttempt-.13)<1e-11);
 assert.equal(r.tradeEligible,false);
});

test('stale quote, expired event and missing one-lot depth cannot become taker edge',()=>{
 const r=compareBinaryParticipationMenu(env({takerCandidates:[
  quote({id:'stale',quoteObservedAt:'2026-10-12T19:30:00Z'}),
  quote({id:'closed',closeAt:'2026-10-12T19:00:00Z'}),
  quote({id:'empty',depthContracts:0}),
 ]}));
 assert.equal(r.decision.action,'abstain');
 assert.equal(r.gaps.length,3);
});

test('source scope and availability protect against post-event and cross-market hindsight',()=>{
 assert.throws(()=>compareBinaryParticipationMenu(env({
  settlementEvidence:{...evidence(),scope:'wrong-scope'},
 })),TypeError);
 assert.throws(()=>compareBinaryParticipationMenu(env({
  settlementEvidence:{...evidence(),availableAt:'2026-10-12T21:00:00Z'},
 })),TypeError);
 const r=compareBinaryParticipationMenu(env({makerCandidates:[
  quote({id:'late-fill',fillEvidence:{...fillModel(),availableAt:'2026-10-13T00:00:00Z'},
   probabilityFillGivenWin:{low:.2,high:.2},probabilityFillGivenLoss:{low:.2,high:.2}}),
 ]}));
 assert.equal(r.gaps.length,1);
 assert.equal(r.decision.action,'abstain');
});

test('malformed probability bands and overlapping action IDs are rejected',()=>{
 assert.throws(()=>compareBinaryParticipationMenu(env({
  settlementProbabilityYes:{low:.6,high:.5},
 })),TypeError);
 assert.throws(()=>compareBinaryParticipationMenu(env({
  takerCandidates:[quote({id:'duplicate'}),quote({id:'duplicate'})],
 })),TypeError);
});

test('scenario earnings beyond cash costs do not grant venue or inventory authority',()=>{
 const r=compareBinaryParticipationMenu(env({takerCandidates:[quote({priceUsd:.7,feeUsd:.001})]}));
 assert.equal(r.decision.action,'conditional-candidate');
 assert.equal(r.orderEffect,false);
 assert.equal(r.candidates[0].tradeEligible,false);
});
