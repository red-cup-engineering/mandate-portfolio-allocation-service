import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMarketInformationValue, compareMarketResearchAcquisitions, conditionMarketForecastOnSignal} from '../src/market-information-value.mjs';

const now='2026-10-12T20:00:00Z';
const forecast=()=>({
  id:'existing-shared-game-forecast',observedAt:'2026-10-12T18:00:00Z',
  horizon:'2026-10-13T03:00:00Z',evidenceIds:['observed-source-before-market'],
  scenarios:[
    {id:'up',probability:.5,values:{price:4.2}},
    {id:'down',probability:.5,values:{price:3.9}},
  ],
});
const actions=()=>[
 {id:'abstain',payoffsUsdByScenario:{up:0,down:0}},
 {id:'buy-up',payoffsUsdByScenario:{up:1,down:-1}},
 {id:'buy-down',payoffsUsdByScenario:{up:-1,down:1}},
];
const signal=(correct=1)=>({
  id:'frozen-source-likelihoods',availableAt:'2026-10-12T19:00:00Z',
  conditionedOnForecastId:forecast().id,
  sourceEvidenceIds:['calibrated-before-decision'],
  signals:[
    {id:'rising',likelihoodByScenario:{up:correct,down:1-correct}},
    {id:'falling',likelihoodByScenario:{up:1-correct,down:correct}},
  ],
});
const evaluate=(opts={})=>evaluateMarketInformationValue({
 forecast:forecast(),actions:actions(),signalModel:signal(),at:now,...opts,
});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-11,a+' != '+b);

test('perfect information on a two-world fair game is worth one dollar before costs',()=>{
 const r=evaluate();
 near(r.baseExpectedUsd,0);
 near(r.expectedAfterSignalUsd,1);
 near(r.grossEvsiUsd,1);
 near(r.netEvsiUsd,1);
 assert.equal(r.shouldAcquireConditional,true);
 assert.equal(r.tradeEligible,false);
 assert.equal(r.orderEffect,false);
 assert.deepEqual(r.signals.map(x=>x.bestAction),['buy-up','buy-down']);
});

test('uninformative signal has zero gross value despite an unchanged action menu',()=>{
 const r=evaluate({signalModel:signal(.5)});
 near(r.grossEvsiUsd,0);
 assert.equal(r.shouldAcquireConditional,false);
 near(r.baseExpectedUsd,0);
});

test('imperfect information is worth less than the perfect signal and more than no signal',()=>{
 const p=evaluate({signalModel:signal(.8)});
 near(p.grossEvsiUsd,.6);
 assert.ok(p.grossEvsiUsd<evaluate().grossEvsiUsd);
 assert.ok(p.grossEvsiUsd>evaluate({signalModel:signal(.5)}).grossEvsiUsd);
});

test('computation and rival repricing costs can make valuable information uneconomic',()=>{
 const r=evaluate({signalModel:signal(.8),computeCostUsd:.1,repricingCostBoundUsd:.55});
 near(r.grossEvsiUsd,.6);
 near(r.netEvsiUsd,-.05);
 assert.equal(r.shouldAcquireConditional,false);
});

test('rare but possible preissued signal retains nonzero expected dollar value',()=>{
 const f=forecast();
 const model={
  id:'rare-receipt-calibrated-beforehand',
  conditionedOnForecastId:forecast().id,
  availableAt:'2026-10-12T19:00:00Z',
  sourceEvidenceIds:['preissued-rare-event-calibration'],
  signals:[
   {id:'rare-up',likelihoodByScenario:{up:1e-10,down:0}},
   {id:'ordinary',likelihoodByScenario:{up:1-1e-10,down:1}},
  ],
 };
 const menu=[
  {id:'abstain',payoffsUsdByScenario:{up:0,down:0}},
  {id:'leveraged-contingent-exposure',payoffsUsdByScenario:{up:1e10,down:-1e10}},
 ];
 const r=evaluate({forecast:f,actions:menu,signalModel:model});
 const rare=r.signals.find(s=>s.signal==='rare-up');
 near(rare.probability,5e-11);
 assert.equal(rare.bestAction,'leveraged-contingent-exposure');
 near(rare.probabilityWeightedPayoffUsd,.5);
 near(r.grossEvsiUsd,.5);
 assert.equal(r.tradeEligible,false);
});

test('zero-probability signal is ignored instead of producing NaN posteriors',()=>{
 const m=signal(1);
 m.signals.push({id:'never-seen',likelihoodByScenario:{up:0,down:0}});
 const r=evaluate({signalModel:m});
 const z=r.signals.find(x=>x.signal==='never-seen');
 assert.equal(z.probability,0);
 assert.equal(z.conditionalExpectedUsd,null);
 near(r.grossEvsiUsd,1);
});

test('abstain must be present with zero payoff in every state',()=>{
 assert.throws(()=>evaluate({actions:actions().filter(x=>x.id!=='abstain')}),TypeError);
 assert.throws(()=>evaluate({actions:actions().map(x=>x.id==='abstain'?
  {...x,payoffsUsdByScenario:{up:0,down:.01}}:x)}),TypeError);
});

test('no lookahead: frozen forecast, price horizon, signal and source timestamps are required',()=>{
 assert.throws(()=>evaluate({forecast:{...forecast(),observedAt:'2026-10-13T01:00:00Z'}}),TypeError);
 assert.throws(()=>evaluate({forecast:{...forecast(),horizon:'2026-10-12T18:00:00Z'}}),TypeError);
 assert.throws(()=>evaluate({signalModel:{...signal(),availableAt:'2026-10-12T23:00:00Z'}}),TypeError);
 assert.throws(()=>evaluate({signalModel:{...signal(),sourceEvidenceIds:[]}}),TypeError);
});

test('per-state likelihoods must each form a proper partition',()=>{
 const m=signal(.8);
 m.signals[0].likelihoodByScenario.down=.8;
 assert.throws(()=>evaluate({signalModel:m}),RangeError);
 const n=signal(.8);
 n.signals[0].likelihoodByScenario.up=1.2;
 assert.throws(()=>evaluate({signalModel:n}),TypeError);
});

test('scenario labels and payoff completeness are checked rather than inferred',()=>{
 const a=forecast();
 a.scenarios[1].id='up';
 assert.throws(()=>evaluate({forecast:a}),TypeError);
 assert.throws(()=>evaluate({actions:[...actions(),{id:'missing',payoffsUsdByScenario:{up:1}}]}),TypeError);
 const b=forecast();b.scenarios[1].probability=.7;
 assert.throws(()=>evaluate({forecast:b}),RangeError);
});

test('reordering scenario and action rows cannot alter information value',()=>{
 const a=evaluate();
 const b=evaluate({forecast:{...forecast(),scenarios:[...forecast().scenarios].reverse()},
   actions:[...actions()].reverse(),signalModel:{...signal(),signals:[...signal().signals].reverse()}});
 near(a.grossEvsiUsd,b.grossEvsiUsd);
 near(a.netEvsiUsd,b.netEvsiUsd);
});

test('a 3-world nested-threshold gas value-of-information example retains exact shared scenarios',()=>{
 const f={...forecast(),scenarios:[
  {id:'4.00',probability:.3},{id:'4.01',probability:.3},{id:'4.02',probability:.4},
 ]};
 const actions3=[
  {id:'abstain',payoffsUsdByScenario:{'4.00':0,'4.01':0,'4.02':0}},
  {id:'buy->4.005',payoffsUsdByScenario:{'4.00':-.7,'4.01':.3,'4.02':.3}},
  {id:'buy->4.015',payoffsUsdByScenario:{'4.00':-.35,'4.01':-.35,'4.02':.65}},
 ];
 const s={...signal(),signals:[
  {id:'upstream-price-rising',likelihoodByScenario:{'4.00':.2,'4.01':.5,'4.02':.8}},
  {id:'upstream-price-falling',likelihoodByScenario:{'4.00':.8,'4.01':.5,'4.02':.2}},
 ]};
 const r=evaluate({forecast:f,actions:actions3,signalModel:s});
 assert.ok(r.grossEvsiUsd>=0);
 assert.ok(r.baseExpectedUsd>=0);
 assert.equal(r.forecastId,forecast().id);
 assert.equal(r.tradeEligible,false);
});

test('research purchases compete on one predeclared joint-scenario action menu', () => {
  const menu = compareMarketResearchAcquisitions({ forecast: forecast(), actions: actions(), at: now,
    candidates: [
      { id: 'filing-surprise', signalModel: { ...signal(.9), id: 'filing-kernel' }, computeCostUsd: .1 },
      { id: 'news-repetition', signalModel: { ...signal(.6), id: 'news-kernel' }, computeCostUsd: .3 },
      { id: 'options-interpretation', signalModel: { ...signal(.8), id: 'options-kernel' }, computeCostUsd: .2 },
    ],
  });
  assert.equal(menu.selectedResearchId, 'filing-surprise');
  assert.deepEqual(menu.rankedAlternatives.map(x => x.id), ['filing-surprise']);
  assert.deepEqual(menu.mathematicallyDominatedAlternatives.map(x=>x.id),
    ['news-repetition','options-interpretation']);
  assert.ok(Math.abs(menu.rankedAlternatives[0].netEvsiUsd - .7) < 1e-10);
  assert.equal(menu.noResearchPurchased, true);
  assert.equal(menu.tradeEligible, false);
  assert.equal(menu.orderEffect, false);
});

test('unknown or future evidence becomes an explicit gap, never an inferred alpha source', () => {
  const model = { ...signal(.8), id: 'future-news', availableAt: '2026-10-13T01:00:00Z' };
  const menu = compareMarketResearchAcquisitions({ forecast: forecast(), actions: actions(), at: now,
    candidates: [
      { id: 'unverified-social-sentiment' },
      { id: 'hindsight-news', signalModel: model },
      { id: 'calibrated-filing', signalModel: signal(.8), computeCostUsd: .01 },
    ],
  });
  assert.equal(menu.evidenceGaps.length, 2);
  assert.equal(menu.selectedResearchId, 'calibrated-filing');
  assert.equal(menu.rankedAlternatives.length, 1);
  assert.equal(menu.mathematicallyDominatedAlternatives.length,0);
});

test('alternative interpretations of the same news cannot manufacture additive information value', () => {
  const s = signal(.8);
  const menu = compareMarketResearchAcquisitions({ forecast: forecast(), actions: actions(), at: now,
    candidates: [
      { id: 'expensive-model', signalModel: s, computeCostUsd: .2 },
      { id: 'cheap-model', signalModel: s, computeCostUsd: .05 },
    ],
  });
  assert.equal(menu.selectedResearchId, 'cheap-model');
  assert.ok(menu.rankedAlternatives.every(x => Math.abs(x.grossEvsiUsd-.6)<1e-10));
  assert.deepEqual(menu.rankedAlternatives.map(x=>x.id),['cheap-model']);
  assert.deepEqual(menu.mathematicallyDominatedAlternatives,
    [{id:'expensive-model',dominatedBy:'cheap-model'}]);
  assert.ok(menu.limitations.some(x => x.includes('NOT additive')));
});

test('abstention from new research is real, and duplicate candidate identifiers refuse', () => {
  const menu = compareMarketResearchAcquisitions({ forecast: forecast(), actions: actions(), at: now,
    candidates: [{ id: 'costly', signalModel: signal(.8), computeCostUsd: 1 }],
  });
  assert.equal(menu.selectedResearchId, null);
  assert.equal(menu.selectedConditionalNetEvsiUsd, null);
  assert.throws(() => compareMarketResearchAcquisitions({ forecast: forecast(), actions: actions(), at: now,
    candidates: [{ id: 'same', signalModel: signal() }, { id: 'same', signalModel: signal() }],
  }), /unique-research-acquisition-identity-required/);
});


const receivedSignal = (more={}) => ({
  id:'AAA-received-report-1',signalId:'rising',
  observedAt:'2026-10-12T19:30:00Z',
  availableAt:'2026-10-12T19:40:00Z',
  evidenceIds:['publisher-byte-receipt-1'],...more,
});
const conditionalModel=(correct=.8)=>({
 ...signal(correct),conditionedOnForecastId:forecast().id,
});

test('receiving a source-conditioned observation updates every shared scenario and changes the best action',()=>{
 const r=conditionMarketForecastOnSignal({
  forecast:forecast(),signalModel:conditionalModel(),observation:receivedSignal(),
  at:now,actions:actions(),
 });
 assert.equal(r.status,'conditional-research-posterior');
 near(r.forecast.scenarios[0].probability,.8);
 near(r.forecast.scenarios[1].probability,.2);
 near(r.forecast.scenarios.reduce((s,x)=>s+x.probability,0),1);
 assert.equal(r.conditionalAction.priorBestAction,'abstain');
 assert.equal(r.conditionalAction.posteriorBestAction,'buy-up');
 near(r.conditionalAction.posteriorExpectedUsd,.6);
 assert.ok(r.posteriorPriorDivergenceNats>0);
 assert.ok(r.forecast.evidenceIds.includes('publisher-byte-receipt-1'));
 assert.equal(r.tradeEligible,false);
 assert.equal(r.sourceAuthenticated,false);
});

test('a later likelihood cannot double-count a prior forecast without explicit conditional binding',()=>{
 assert.throws(()=>conditionMarketForecastOnSignal({
  forecast:forecast(),signalModel:{...signal(.8),conditionedOnForecastId:undefined},
  observation:receivedSignal(),at:now,
 }),/precommitted conditional signal/);
 assert.throws(()=>conditionMarketForecastOnSignal({
  forecast:forecast(),signalModel:conditionalModel(),
  observation:receivedSignal({availableAt:'2026-10-12T22:00:00Z'}),at:now,
 }),/precommitted conditional signal/);
 const model=conditionalModel();model.availableAt='2026-10-12T20:00:00Z';
 assert.throws(()=>conditionMarketForecastOnSignal({
  forecast:forecast(),signalModel:model,observation:receivedSignal(),at:now,
 }),/precommitted conditional signal/);
});

test('an unmodeled received signal has no posterior, not an invented decisive forecast',()=>{
 const m=conditionalModel(.8);
 m.signals=[
  {id:'rising',likelihoodByScenario:{up:0,down:0}},
  {id:'falling',likelihoodByScenario:{up:1,down:1}},
 ];
 const r=conditionMarketForecastOnSignal({
  forecast:forecast(),signalModel:m,observation:receivedSignal(),at:now,actions:actions(),
 });
 assert.equal(r.status,'observation-impossible-under-frozen-model');
 assert.equal(r.forecast,null);
 assert.equal(r.conditionalAction,null);
 assert.equal(r.orderEffect,false);
});


test('research EVSI must target the exact frozen common forecast before attention is spent',()=>{
 assert.throws(()=>evaluate({signalModel:{...signal(.8),conditionedOnForecastId:'other-prior'}}),/preissued signal kernel/);
 assert.throws(()=>evaluate({signalModel:{...signal(.8),conditionedOnForecastId:undefined}}),/preissued signal kernel/);
 assert.throws(()=>evaluate({forecast:{...forecast(),availableAt:'2026-10-12T21:00:00Z'}}),/point-in-time/);
 assert.throws(()=>evaluate({forecast:{...forecast(),availableAt:'2026-10-12T17:00:00Z'}}),/point-in-time/);
 assert.throws(()=>evaluate({signalModel:{...signal(.8),availableAt:'yesterday'}}),/preissued signal kernel/);
 assert.throws(()=>evaluate({actions:[...actions(),{id:'unbounded',payoffsUsdByScenario:{up:1e300,down:-1e300}}]}),/bounded complete payoff/);
});


test('automatic binary Blackwell pruning can be disabled without changing EVSI mathematics',()=>{
 const a=compareMarketResearchAcquisitions({
  forecast:forecast(),actions:actions(),at:now,
  candidates:[
   {id:'fine',signalModel:{...signal(.9),id:'finer'},computeCostUsd:.1},
   {id:'coarse',signalModel:{...signal(.6),id:'coarser'},computeCostUsd:.2},
  ],
 });
 assert.deepEqual(a.rankedAlternatives.map(x=>x.id),['fine']);
 assert.deepEqual(a.mathematicallyDominatedAlternatives,
  [{id:'coarse',dominatedBy:'fine'}]);
 const b=compareMarketResearchAcquisitions({
  forecast:forecast(),actions:actions(),at:now,autoGarbling:false,
  candidates:[
   {id:'fine',signalModel:{...signal(.9),id:'finer'},computeCostUsd:.1},
   {id:'coarse',signalModel:{...signal(.6),id:'coarser'},computeCostUsd:.2},
  ],
 });
 assert.deepEqual(b.rankedAlternatives.map(x=>x.id),['fine','coarse']);
 assert.equal(b.mathematicallyDominatedAlternatives.length,0);
});
