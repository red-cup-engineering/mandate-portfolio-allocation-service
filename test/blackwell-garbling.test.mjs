import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBlackwellGarbling,inferBinaryBlackwellGarbling} from '../src/blackwell-garbling.mjs';
import {
  evaluateMarketInformationValue,compareMarketResearchAcquisitions,
} from '../src/market-information-value.mjs';

const at='2026-10-12T20:00:00Z';
const forecast=()=>({
 id:'finite-shared-worlds',observedAt:'2026-10-12T18:00:00Z',
 availableAt:'2026-10-12T18:10:00Z',
 horizon:'2026-10-13T03:00:00Z',evidenceIds:['prior-worlds'],
 scenarios:[{id:'up',probability:.5},{id:'down',probability:.5}],
});
const signal=(id,up,down)=>({
 id,conditionedOnForecastId:forecast().id,
 availableAt:'2026-10-12T19:00:00Z',sourceEvidenceIds:['earlier-calibration'],
 signals:[
  {id:'up-signal',likelihoodByScenario:{up,down}},
  {id:'down-signal',likelihoodByScenario:{up:1-up,down:1-down}},
 ],
});
const fine=()=>signal('fine',.9,.1);
const coarse=()=>signal('coarse',.7,.3);
const matrix=()=>({
 'up-signal':{'up-signal':.75,'down-signal':.25},
 'down-signal':{'up-signal':.25,'down-signal':.75},
});
const menu=()=>[
 {id:'abstain',payoffsUsdByScenario:{up:0,down:0}},
 {id:'up-trade',payoffsUsdByScenario:{up:1,down:-1}},
 {id:'down-trade',payoffsUsdByScenario:{up:-1,down:1}},
];
const compare=(input={})=>compareMarketResearchAcquisitions({
 forecast:forecast(),at,actions:menu(),
 candidates:[
  {id:'more-information',signalModel:fine(),computeCostUsd:.1},
  {id:'less-information',signalModel:coarse(),computeCostUsd:.2},
 ],...input,
});
const witness=()=>({
 finerId:'more-information',coarserId:'less-information',
 kernel:matrix(),
});

test('a real finite stochastic factorization proves Blackwell dominance',()=>{
 assert.equal(assertBlackwellGarbling({
  forecast:forecast(),finerModel:fine(),coarserModel:coarse(),
  garbling:matrix(),at,
 }),true);
 const f=evaluateMarketInformationValue({
  forecast:forecast(),signalModel:fine(),actions:menu(),at,
 });
 const c=evaluateMarketInformationValue({
  forecast:forecast(),signalModel:coarse(),actions:menu(),at,
 });
 assert.ok(f.grossEvsiUsd>=c.grossEvsiUsd);
 assert.ok(Math.abs(f.grossEvsiUsd-.8)<1e-12);
 assert.ok(Math.abs(c.grossEvsiUsd-.4)<1e-12);
});

test('invalid stochastic rows, incorrect factorization or wrong forecast cannot prune research',()=>{
 const common={forecast:forecast(),finerModel:fine(),coarserModel:coarse(),at};
 const changed=matrix();changed['up-signal']['up-signal']=.9;
 assert.throws(()=>assertBlackwellGarbling({...common,garbling:changed}),/row-stochastic/);
 const wrong=matrix();wrong['up-signal']['up-signal']=.7;
 wrong['up-signal']['down-signal']=.3;
 assert.throws(()=>assertBlackwellGarbling({...common,garbling:wrong}),/does not factor/);
 assert.throws(()=>assertBlackwellGarbling({...common,garbling:matrix(),
   coarserModel:{...coarse(),conditionedOnForecastId:'other-worlds'}}),/exact forecast/);
 assert.throws(()=>assertBlackwellGarbling({...common,garbling:matrix(),
   finerModel:{...fine(),availableAt:'2026-10-12T23:00:00Z'}}),/available source-linked/);
});

test('prune cost-dominated research before the EVSI computation, but never omit a cheaper garbling',()=>{
 const result=compare({garblings:[witness()]});
 assert.equal(result.selectedResearchId,'more-information');
 assert.deepEqual(result.rankedAlternatives.map(x=>x.id),['more-information']);
 assert.deepEqual(result.mathematicallyDominatedAlternatives,
  [{id:'less-information',dominatedBy:'more-information'}]);
 assert.equal(result.noResearchPurchased,true);

 const moreExpensive=compare({
  candidates:[
   {id:'more-information',signalModel:fine(),computeCostUsd:.6},
   {id:'less-information',signalModel:coarse(),computeCostUsd:.0},
  ],
  garblings:[witness()],
 });
 assert.equal(moreExpensive.mathematicallyDominatedAlternatives.length,0);
 assert.equal(moreExpensive.rankedAlternatives.length,2);
 assert.equal(moreExpensive.selectedResearchId,'less-information');
});

test('equal-price experiments can be ordered without deleting every equivalent choice',()=>{
 const a=signal('a',.8,.2),b=signal('b',.8,.2);
 const identity={
  'up-signal':{'up-signal':1,'down-signal':0},
  'down-signal':{'up-signal':0,'down-signal':1},
 };
 const result=compare({
  candidates:[
   {id:'zeta',signalModel:a,computeCostUsd:.1},
   {id:'alpha',signalModel:b,computeCostUsd:.1},
  ],
  garblings:[
   {finerId:'alpha',coarserId:'zeta',kernel:identity},
   {finerId:'zeta',coarserId:'alpha',kernel:identity},
  ],
 });
 assert.deepEqual(result.mathematicallyDominatedAlternatives,
  [{id:'zeta',dominatedBy:'alpha'}]);
 assert.deepEqual(result.rankedAlternatives.map(x=>x.id),['alpha']);
});

test('finite Blackwell ordering is action-menu independent over many three-world priors',()=>{
 for(let p=0;p<=10;p++)for(let q=0;q<=10-p;q++){
  const prior={...forecast(),scenarios:[
   {id:'a',probability:p/10},{id:'b',probability:q/10},
   {id:'c',probability:(10-p-q)/10},
  ]};
  const probs=[
   {id:'red',likelihoodByScenario:{a:.9,b:.15,c:.05}},
   {id:'green',likelihoodByScenario:{a:.1,b:.5,c:.25}},
   {id:'blue',likelihoodByScenario:{a:0,b:.35,c:.7}},
  ];
  const coarsening={
   red:{warm:.9,cold:.1},green:{warm:.5,cold:.5},
   blue:{warm:.1,cold:.9},
  };
  const coarseLikelihood=id=>Object.fromEntries(['a','b','c'].map(s=>[
   s,probs.reduce((acc,z)=>acc+z.likelihoodByScenario[s]*coarsening[z.id][id],0),
  ]));
  const fm={
   ...fine(),signals:probs,
  };
  const cm={
   ...coarse(),signals:[
    {id:'warm',likelihoodByScenario:coarseLikelihood('warm')},
    {id:'cold',likelihoodByScenario:coarseLikelihood('cold')},
   ],
  };
  assert.equal(assertBlackwellGarbling({
   forecast:prior,finerModel:fm,coarserModel:cm,garbling:coarsening,at,
  }),true);
  const acts=[
   {id:'abstain',payoffsUsdByScenario:{a:0,b:0,c:0}},
   {id:'a-trade',payoffsUsdByScenario:{a:3,b:-2,c:-4}},
   {id:'b-trade',payoffsUsdByScenario:{a:-2,b:3,c:-2}},
   {id:'c-trade',payoffsUsdByScenario:{a:-2,b:-3,c:4}},
  ];
  const assess=(signalModel)=>evaluateMarketInformationValue({
   forecast:prior,signalModel,actions:acts,at,
  }).grossEvsiUsd;
  assert.ok(assess(fm)+1e-10>=assess(cm));
 }
});


test('derive the binary stochastic transformation itself, without an agent-supplied certificate',()=>{
 const input={forecast:forecast(),finerModel:fine(),coarserModel:coarse(),at};
 const inferred=inferBinaryBlackwellGarbling(input);
 assert.ok(inferred);
 assert.equal(assertBlackwellGarbling({...input,garbling:inferred}),true);
 assert.ok(Math.abs(inferred['up-signal']['up-signal']-.75)<1e-12);
 assert.ok(Math.abs(inferred['down-signal']['up-signal']-.25)<1e-12);
});
test('binary derivation cannot manufacture dominance from wrong state mapping or stale models',()=>{
 const input={forecast:forecast(),finerModel:coarse(),coarserModel:fine(),at};
 assert.equal(inferBinaryBlackwellGarbling(input),null);
 assert.equal(inferBinaryBlackwellGarbling({
  ...input,finerModel:{...coarse(),availableAt:'2026-10-12T22:00:00Z'},
 }),null);
 assert.equal(inferBinaryBlackwellGarbling({
  ...input,finerModel:{...coarse(),conditionedOnForecastId:'another-forecast'},
 }),null);
});
