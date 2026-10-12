import {hashPosition} from '@red-cup-engineering/gaming/running/rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import {planMarket,planFleet,marketGame,allocationsFor,strategyPerformance} from '../src/market-game.mjs';
import {formAggressivePortfolioIntent} from '../../alpha-portfolio-order-intent-service/src/aggressive-intent.mjs';
import {validateExecutionRequest} from '../../brokerage-execution-transport-service/src/execute-intent.mjs';
const at='2026-10-07T02:00:00Z',horizon='2026-10-08T02:00:00Z';
const calibration={sampleSize:100,brier:0.1,baselineBrier:0.2,record:'cal',windowEnd:'2026-10-01T00:00:00Z',confidenceLowerBound:0.01,netReturnConfidenceLowerBound:0.01,liveUseLimitations:[]};
const swapScope={target:{venue:'evm',instrument:'USDC',carrier:'asset',side:'long',fundingInstrument:'ETH',chainId:8453,protocol:'test-only'},minHoldingPeriodMs:86400000-60000,maxHoldingPeriodMs:86400000};
const policy={principal:'synthetic-principal',minCalibrationSamples:20,maxDeployFraction:1,maxInstrumentFraction:1,maxScenarioLossFraction:0.9,maxObservationAgeMs:60000,kellyMultiple:1};
function state(availableUnits=1){return {observations:{cal:{observedAt:at,availableAt:at,value:{kind:'calibration',roundTripCostFraction:0.005,payoffScopes:[structuredClone(swapScope)],...calibration}},research:{observedAt:at,availableAt:at,value:{kind:'synthetic-test-only'}}},accounts:{evm:{venue:'evm',principal:'synthetic-principal',chainId:8453,observedAt:at,equityCents:100,freeCashCents:0,inventory:{ETH:{units:1,availableUnits,markPrice:1}}}},quotes:{swap:{id:'swap',venue:'evm',instrument:'USDC',observedAt:at,horizon,entryPrice:1,unitStep:0.01,availableUnits:1,transitionCostFraction:0,carryCostFraction:0,carrier:'asset',side:'long',chainId:8453,blockHash:'0x'+'ab'.repeat(32),blockTimestamp:String(Date.parse(at)/1000),finalized:true,protocol:'test-only',funding:{instrument:'ETH',unitsPerUnit:1}}},strategies:{hedge:{id:'hedge',observedAt:at,quoteIds:['swap'],evidenceIds:['research'],thesis:'Exchange held exposure for stable value',falsifier:'Held units or horizon differ'}},forecast:{id:'f',observedAt:at,horizon,calibration:{...calibration},evidenceIds:['cal'],scenarios:[{id:'down',probability:0.5,values:{swap:1},fundingValues:{ETH:0.5},heldPnlCentsByVenue:{evm:-50}},{id:'up',probability:0.5,values:{swap:1},fundingValues:{ETH:1.5},heldPnlCentsByVenue:{evm:50}}]},decisions:{},outcomes:{}};}
test('inventory exchange removes held exposure instead of counting another stablecoin purchase',()=>{
 const result=planMarket(state(),policy,at);assert.equal(result.orders.length,1);assert.ok(result.orders[0].funding.units>0.9);assert.ok(result.orders[0].funding.units<=1);assert.equal(result.orders[0].expectedReturn,0);
 for(const scenario of result.scenarioWealth)assert.ok(Math.abs(scenario.wealth-1)<0.06);
});
test('competing orders share one held funding balance, including reserved units',()=>{
 const s=state(0.5);s.quotes.second={...s.quotes.swap,id:'second'};s.strategies.hedge.quoteIds.push('second');for(const scenario of s.forecast.scenarios)scenario.values.second=1;
 const result=planMarket(s,policy,at);const spent=result.orders.reduce((n,o)=>n+o.funding.units,0);assert.ok(spent>0.4);assert.ok(spent<=0.5+1e-9);
});
test('no funding inventory or future funding valuation cannot create a funded order',()=>{
 const s=state();delete s.accounts.evm.inventory;assert.equal(planMarket(s,policy,at).orders.length,0);
 const missing=state();delete missing.forecast.scenarios[0].fundingValues;assert.throws(()=>planMarket(missing,policy,at),/funding value/);
 const mismatch=state();mismatch.accounts.evm.inventory.ETH.markPrice=2;assert.throws(()=>planMarket(mismatch,policy,at),/mark differs/);
});

test('conditioned portfolio decisions require positive measured financial confidence',()=>{
 const s=state();s.forecast.conditioning={model:'test-model',bin:0};s.forecast.evidenceIds.push('test-model');s.observations['test-model']={observedAt:at,availableAt:at,value:{kind:'scenario-likelihood-model',model:{expectedReturns:[{trainingSamples:50,gross:0.02}]}}};s.observations.cal.value.roundTripCostFraction=0.005;s.forecast.calibration={...calibration,confidenceLowerBound:0.01,netReturnConfidenceLowerBound:-0.01};s.observations.cal.value={...s.observations.cal.value,...s.forecast.calibration};
 assert.throws(()=>planMarket(s,policy,at),/lacks positive measured/);
 s.forecast.calibration.netReturnConfidenceLowerBound=0.01;
 assert.throws(()=>planMarket(s,policy,at),/differs from scored evidence/);
 s.observations.cal.value.netReturnConfidenceLowerBound=0.01;
 assert.equal(planMarket(s,policy,at).orders.length,1);
});
test('removing conditioning metadata cannot bypass a scored study rejection',()=>{
 const s=state();s.observations.cal.value.method='fixed-binned-likelihood-temporal-holdout/v2';delete s.forecast.calibration.confidenceLowerBound;
 assert.throws(()=>planMarket(s,policy,at),/lacks positive measured/);
});

test('a conditioned plan cannot override recorded research limitations',()=>{const s=state();s.forecast.conditioning={model:'test-model',bin:0};s.forecast.evidenceIds.push('test-model');s.observations['test-model']={observedAt:at,availableAt:at,value:{kind:'scenario-likelihood-model',model:{expectedReturns:[{trainingSamples:50,gross:0.02}]}}};s.observations.cal.value.roundTripCostFraction=0.005;s.forecast.calibration={...calibration,confidenceLowerBound:0.01,netReturnConfidenceLowerBound:0.01};s.observations.cal.value={...s.observations.cal.value,...s.forecast.calibration,liveUseLimitations:['venue fees were assumed']};assert.throws(()=>planMarket(s,policy,at),/unresolved live-use limitations/);});

// Synthetic bounds here exercise admission only; they are not research evidence.
test('every method and unconditioned forecast must retain measured financial confidence',()=>{
 for(const method of [undefined,'fixed-binned-likelihood-temporal-holdout/v1','fixed-binned-likelihood-temporal-holdout/v2','fixed-binned-likelihood-and-return-temporal-holdout/v3','future-method']){
  for(const field of ['confidenceLowerBound','netReturnConfidenceLowerBound']){
   for(const value of [undefined,null,0,-0.01]){
    const s=state();s.observations.cal.value.method=method;s.forecast.calibration={...calibration,[field]:value};s.observations.cal.value={...s.observations.cal.value,[field]:value};
    assert.throws(()=>planMarket(s,policy,at),/lacks positive measured/);
   }
  }
  const s=state();s.observations.cal.value.method=method;
  delete s.observations.cal.value.liveUseLimitations;
  assert.throws(()=>planMarket(s,policy,at),/unresolved live-use limitations/);
  s.observations.cal.value.liveUseLimitations=['unobserved execution costs'];
  assert.throws(()=>planMarket(s,policy,at),/unresolved live-use limitations/);
 }
});

test('shared research cannot combine different principals or consume their allocations',()=>{
 const s=state();s.accounts.alpaca={venue:'alpaca',principal:'another-principal',observedAt:at,equityCents:10000,freeCashCents:10000};
 assert.throws(()=>planMarket(s,policy,at),/declared decision principal/);
 delete s.accounts.alpaca;
 const decision=planMarket(s,policy,at);assert.equal(decision.principal,policy.principal);
 const request={venue:'evm',instrument:'USDC',side:'long',chainId:8453,protocol:'test-only',at};
 assert.throws(()=>allocationsFor(decision,{...request,principal:'another-principal'}),/another principal/);
 assert.throws(()=>allocationsFor(decision,request),/identifier required/);
 assert.equal(allocationsFor(decision,{...request,principal:policy.principal}).length,1);
 delete s.accounts.evm.principal;
 assert.throws(()=>planMarket(s,policy,at),/declared decision principal/);
});

test('Alpaca intent formation and live execution reject another principal before venue placement',()=>{
 const decision=planMarket(state(),policy,at);
 const contract={type:'PrincipalBrokerageServiceContract',id:'test-contract',principal:'another-principal',scopes:['orders:intent','orders:live'],validUntil:horizon,risk:{maximumOrderNotional:10,maximumLossAmount:10,concentrationLimit:1},capital:{amount:10,currency:'USD'}};
 assert.throws(()=>formAggressivePortfolioIntent({contract,evidencePackets:[{type:'IssuerEvidencePacket',id:'test-only',ticker:'TEST'}],symbol:'TEST',notional:1,maximumLoss:1,marketDecision:decision,asOf:at}),/another principal/);
 const authorityGrant={type:'RevocableBrokerageAuthorityGrant',revoked:false,scopes:['orders:live'],principalContract:contract.id,validUntil:horizon};
 const intent={type:'AggressiveBrokerageOrderIntent',contract:contract.id,side:'buy',symbol:'TEST',notional:1,maximumLoss:1,marketDecision:decision};
 assert.throws(()=>validateExecutionRequest({contract,authorityGrant,intent,now:at}),/another principal/);
});

test('conditioning preserves the scored training-bin cash rule regardless of directional probabilities',()=>{
 const s=state();s.forecast.conditioning={model:'test-model',bin:0};s.forecast.evidenceIds.push('test-model');
 s.observations['test-model']={observedAt:at,availableAt:at,value:{kind:'scenario-likelihood-model',model:{expectedReturns:[{trainingSamples:50,gross:0.001}]}}};
 s.observations.cal.value.roundTripCostFraction=0.005;
 assert.throws(()=>planMarket(s,policy,at),/selection requires cash/);
 s.observations['test-model'].value.model.expectedReturns[0].gross=0.02;
 assert.equal(planMarket(s,policy,at).orders.length,1);
 s.quotes.swap.transitionCostFraction=0.006;assert.equal(planMarket(s,policy,at).orders.length,0);assert.match(planMarket(s,policy,at).skips[0].reason,/scored strategy cost budget/);
 s.quotes.swap.transitionCostFraction=0;
 delete s.observations.cal.value.roundTripCostFraction;
 assert.throws(()=>planMarket(s,policy,at),/scored nonnegative strategy cost budget/);
});


test('unconditioned selection cannot spend beyond the net-return study cost budget',()=>{
 const s=state();assert.equal(planMarket(s,policy,at).orders.length,1);
 s.quotes.swap.transitionCostFraction=0.003;s.quotes.swap.carryCostFraction=0.003;
 const decision=planMarket(s,policy,at);assert.equal(decision.orders.length,0);
 assert.match(decision.skips[0].reason,/scored strategy cost budget/);
 for(const value of [undefined,-1,NaN,Infinity]){
  s.observations.cal.value.roundTripCostFraction=value;
  assert.throws(()=>planMarket(s,policy,at),/scored nonnegative strategy cost budget/);
 }
});

function mixedFleet(){
 const s=state();s.accounts.alpaca={venue:'alpaca',principal:'synthetic-personal-principal',observedAt:at,equityCents:500,freeCashCents:500};
 s.quotes.asset={id:'asset',venue:'alpaca',instrument:'TEST',assetClass:'us_equity',observedAt:at,horizon,entryPrice:1,unitStep:1,availableUnits:5,transitionCostFraction:0,carryCostFraction:0,carrier:'asset',side:'long'};
 s.strategies.hedge.quoteIds.push('asset');
 s.observations.cal.value.payoffScopes.push({target:{venue:'alpaca',instrument:'TEST',carrier:'asset',side:'long',fundingInstrument:null,assetClass:'us_equity'},minHoldingPeriodMs:86400000-60000,maxHoldingPeriodMs:86400000});
 s.forecast.scenarios.forEach((scenario,index)=>{scenario.values.asset=index?1.5:0.9;scenario.heldPnlCentsByVenue.alpaca=0;});
 return s;
}
const personalPolicy={...policy,principal:'synthetic-personal-principal'};
test('one scenario family funds separate principals without pooling their capital or holdings',()=>{
 const s=mixedFleet(),before=structuredClone(s);const fleet=planFleet(s,[personalPolicy,policy],at);
 assert.deepEqual(s,before);assert.equal(fleet.length,2);
 const group=fleet.find(d=>d.principal===policy.principal),personal=fleet.find(d=>d.principal===personalPolicy.principal);
 assert.equal(group.equityCents,100);assert.equal(personal.equityCents,500);
 assert.ok(group.orders.length&&personal.orders.length);
 assert.ok(group.orders.every(o=>o.venue==='evm'));assert.ok(personal.orders.every(o=>o.venue==='alpaca'));
 assert.equal(group.fleetPosition,hashPosition(s));assert.equal(personal.fleetPosition,group.fleetPosition);
 const base=planMarket(state(),policy,at);assert.deepEqual(group.scenarioWealth,base.scenarioWealth);assert.deepEqual(group.orders,base.orders);
 assert.throws(()=>allocationsFor(group,{venue:'evm',principal:personalPolicy.principal,instrument:'USDC',side:'long',chainId:8453,protocol:'test-only',at}),/another principal/);
 s.accounts.alpaca.freeCashCents=0;
 const unfunded=planFleet(s,[policy,personalPolicy],at);assert.equal(unfunded.find(d=>d.principal===personalPolicy.principal).orders.length,0);assert.deepEqual(unfunded.find(d=>d.principal===policy.principal).orders,group.orders);
});
test('fleet move records replayable per-principal decisions and requires every scoped policy',()=>{
 const s=mixedFleet();
 for(const policies of [[policy],[policy,policy],[policy,{...policy,principal:'unobserved-principal'}]])assert.throws(()=>planFleet(s,policies,at),/principal polic|per observed fleet principal/);
 const move={kind:'decide-fleet',at,policies:[policy,personalPolicy],expectedPosition:hashPosition(s)};
 const result=marketGame.extend(s,move);assert.equal(Object.keys(result.state.decisions).length,2);assert.equal(result.events[0].polarity,'P');
 assert.deepEqual(marketGame.extend(s,move),result);
 const warmup=[...Object.entries(s.observations).map(([id,row])=>({kind:'observe',observation:{...row,id,source:'urn:synthetic:replay'}})),...Object.values(s.accounts).map(account=>({kind:'account',account})),...Object.values(s.quotes).map(quote=>({kind:'quote',quote})),...Object.values(s.strategies).map(strategy=>({kind:'strategy',strategy})),{kind:'forecast',forecast:s.forecast}];
 const witnessed=marketGame.replay(undefined,warmup);assert.equal(witnessed.valid,true);
 const fleetMove={...move,expectedPosition:witnessed.stateHash};const arrived=marketGame.extend(witnessed.finalState,fleetMove);
 const replay=marketGame.replay(undefined,[...warmup,fleetMove]);assert.equal(replay.valid,true);assert.equal(replay.stateHash,hashPosition(arrived.state));
 assert.throws(()=>marketGame.extend(s,{...move,expectedPosition:'another-position'}),/another position/);
 for(const decision of Object.values(result.state.decisions)){
  const {id,...body}=decision;assert.equal(id,hashPosition(body));
 }
});

// Matching numeric confidence cannot stand in for a study of another payoff.
test('scored payoff identity and holding period bind every candidate',()=>{
 for(const changes of [{instrument:'UNSTUDIED'},{side:'short',carrier:'collateral',leverage:2,collateralToken:'TEST'},{chainId:42161},{protocol:'another-protocol'},{funding:{instrument:'WETH',unitsPerUnit:1}}]){
  const s=state();Object.assign(s.quotes.swap,changes);
  const result=planMarket(s,policy,at);assert.equal(result.orders.length,0);assert.match(result.skips[0].reason,/scored payoff scope/);
 }
 const delayed=state();delayed.forecast.horizon='2026-10-09T02:00:00Z';delayed.quotes.swap.horizon=delayed.forecast.horizon;
 assert.equal(planMarket(delayed,policy,at).orders.length,0);
 const unscoped=state();delete unscoped.observations.cal.value.payoffScopes;
 assert.throws(()=>planMarket(unscoped,policy,at),/scored payoff scopes required/);
 const s=mixedFleet();s.observations.cal.value.payoffScopes=[structuredClone(swapScope)];
 const fleet=planFleet(s,[policy,personalPolicy],at);assert.ok(fleet.find(d=>d.principal===policy.principal).orders.length);assert.equal(fleet.find(d=>d.principal===personalPolicy.principal).orders.length,0);
});

test('current pinned EVM state can be planned without claiming finality; stale finalized state cannot',()=>{
 for(const finalized of [false,true]){
  const s=state();s.quotes.swap.finalized=finalized;
  const planned=planMarket(s,policy,at);assert.equal(planned.orders.length,1);
  assert.equal(planned.orders[0].finalized,finalized);assert.equal(planned.orders[0].blockTimestamp,s.quotes.swap.blockTimestamp);
  for(const timestamp of [undefined,'not-a-time',String(Date.parse(at)/1000-61),String(Date.parse(at)/1000+1)]){
   if(timestamp===undefined)delete s.quotes.swap.blockTimestamp;else s.quotes.swap.blockTimestamp=timestamp;
   const refused=planMarket(s,policy,at);assert.equal(refused.orders.length,0);assert.match(refused.skips[0].reason,/timestamp|market state/);
  }
 }
 const malformed=state();malformed.quotes.swap.blockHash='0xblock';assert.equal(planMarket(malformed,policy,at).orders.length,0);
});

test('one venue retains two principals and demands independently valued held inventory',()=>{
 const first=state().accounts.evm;
 const second={venue:'evm',principal:personalPolicy.principal,chainId:8453,observedAt:at,equityCents:500,freeCashCents:0,inventory:{}};
 const afterFirst=marketGame.extend(marketGame.initialPosition(),{kind:'account',account:first}).state;
 const afterBoth=marketGame.extend(afterFirst,{kind:'account',account:second}).state;
 assert.equal(Object.values(afterBoth.accounts).length,2);
 assert.deepEqual(new Set(Object.values(afterBoth.accounts).map(a=>a.principal)),new Set([policy.principal,personalPolicy.principal]));
 const s=mixedFleet();
 s.accounts.otherEvm=second;
 assert.throws(()=>planFleet(s,[policy,personalPolicy],at),/shared venue requires principal-scoped held P&L/);
 for(const scenario of s.forecast.scenarios){
  scenario.heldPnlCentsByPrincipalVenue={
   [policy.principal]:{evm:scenario.heldPnlCentsByVenue.evm},
   [personalPolicy.principal]:{evm:0},
  };
 }
 const baseline=planFleet(mixedFleet(),[policy,personalPolicy],at);
 const fleet=planFleet(s,[policy,personalPolicy],at);
 const group=fleet.find(d=>d.principal===policy.principal);
 const personal=fleet.find(d=>d.principal===personalPolicy.principal);
 assert.equal(group.equityCents,100);
 assert.equal(personal.equityCents,1000);
 assert.deepEqual(group.orders,baseline.find(d=>d.principal===policy.principal).orders);
 assert.equal(group.fleetPosition,personal.fleetPosition);
});
test('no future-authored strategy can claim a presently executable quote',()=>{
 const s=state();s.strategies.hedge.observedAt=horizon;
 const result=planMarket(s,policy,at);
 assert.equal(result.orders.length,0);
 assert.ok(result.skips.some(skip=>/strategy proposed after decision time/.test(skip.reason)));
});

test('funded EVM actions require an account observation on the exact quoted chain',()=>{
 const s=state();
 assert.equal(planMarket(s,policy,at).orders.length,1);
 s.accounts.evm.chainId=42161;
 const refused=planMarket(s,policy,at);
 assert.equal(refused.orders.length,0);
 assert.ok(refused.skips.some(skip=>/account and quote chainId differ/.test(skip.reason)));
 delete s.accounts.evm.chainId;
 assert.throws(()=>planMarket(s,policy,at),/explicit positive chainId/);
});
test('a principal EVM slot cannot silently replace its chain identity',()=>{
 const first=state().accounts.evm;
 const state1=marketGame.extend(marketGame.initialPosition(),{kind:'account',account:first}).state;
 assert.throws(()=>marketGame.extend(state1,{kind:'account',account:{...first,chainId:42161}}),/cannot silently switch chains/);
 assert.throws(()=>marketGame.extend(state1,{kind:'account',account:{...first,chainId:0}}),/positive chainId/);
});


test('a common Alpaca book is proportionally cleared and each principal is reoptimized',()=>{
  const s=mixedFleet();
  const first={venue:'alpaca',principal:policy.principal,observedAt:at,
    equityCents:500,freeCashCents:500};
  const second={...first,principal:personalPolicy.principal};
  s.accounts={first,second};
  s.quotes={asset:{...s.quotes.asset,availableUnits:3,unitStep:1}};
  s.strategies.hedge.quoteIds=['asset'];
  for(const world of s.forecast.scenarios){
    world.heldPnlCentsByPrincipalVenue={
      [policy.principal]:{alpaca:0},
      [personalPolicy.principal]:{alpaca:0},
    };
  }
  const before=structuredClone(s);
  const independentFirst=planMarket({...s,accounts:{first}},policy,at);
  const independentSecond=planMarket({...s,accounts:{second}},personalPolicy,at);
  assert.equal(independentFirst.orders.reduce((n,o)=>n+o.units,0),3);
  assert.equal(independentSecond.orders.reduce((n,o)=>n+o.units,0),3);
  const fleet=planFleet(s,[personalPolicy,policy],at);
  assert.deepEqual(s,before);
  assert.deepEqual(fleet,planFleet(s,[policy,personalPolicy],at),
    'independent policy iteration order cannot change the clearing result');
  const amounts=Object.fromEntries(fleet.map(d=>[
    d.principal,d.orders.reduce((n,o)=>n+o.units,0),
  ]));
  const total=Object.values(amounts).reduce((n,x)=>n+x,0);
  assert.equal(total,3);
  assert.ok(Object.values(amounts).every(n=>n>=1));
  for(const decision of fleet){
    assert.equal(decision.clearing.kind,'fleet-proportional-integer-book-clearing-v1');
    assert.equal(decision.effect,'intent-only');
    const {id,...body}=decision;assert.equal(id,hashPosition(body));
    assert.equal(decision.scenarioWealth.length,2);
  }
});
test('one principal cannot consume a shared quote twice through independent aliases',()=>{
  const s=mixedFleet();
  delete s.accounts.evm;
  s.quotes.asset.availableUnits=2;
  s.quotes.asset2={...s.quotes.asset,id:'asset2',availableUnits:2};
  s.strategies.hedge.quoteIds=['asset','asset2'];
  for(const world of s.forecast.scenarios) world.values.asset2=world.values.asset;
  const result=planMarket(s,personalPolicy,at);
  assert.ok(result.orders.reduce((n,o)=>n+o.units,0)<=2+1e-9);
});


test('market performance keeps historical outcome assertions separate from source-bound claims',()=>{
 const start=state();
 const decision=planMarket(start,policy,at);
 start.decisions[decision.id]=decision;
 const claim={
  id:'claim-only',decisionId:decision.id,orderId:'swap',receipt:'synthetic-claimed-event',
  observedAt:'2026-10-08T04:00:00Z',pnlCents:10,
 };
 const afterClaim=marketGame.extend(start,{kind:'outcome',outcome:claim}).state;
 assert.deepEqual(strategyPerformance(afterClaim,'2026-10-08T00:00:00Z'),{},
  'future outcomes cannot leak into a prior decision');
 const bucket=strategyPerformance(afterClaim,'2026-10-09T00:00:00Z').hedge;
 assert.equal(bucket.observations,0);
 assert.equal(bucket.pnlCents,null);
 assert.equal(bucket.unverifiedClaims,1);
 assert.equal(bucket.sourceLinkedClaims,0);
 const observed={
  id:'observed-venue-event',
  source:'urn:synthetic:source-check',
  observedAt:'2026-10-08T03:00:00Z',
  availableAt:'2026-10-08T02:30:00Z',
  value:{
    kind:'venue-realized-pnl-v1',
    decisionId:decision.id,orderId:'swap',principal:policy.principal,
    venue:'evm',instrument:'USDC',receipt:'source-linked-claimed-event',
    currency:'USD',pnlCents:25,sourceDigest:'sha256:'+'b'.repeat(64),
  },
 };
 const withSource=marketGame.extend(afterClaim,{kind:'observe',observation:observed}).state;
 const sourceLinked={
  id:'conditional-source-claim',decisionId:decision.id,orderId:'swap',
  receipt:'source-linked-claimed-event',
  sourceObservationId:observed.id,
  observedAt:'2026-10-08T04:00:00Z',pnlCents:25,
 };
 const combined=marketGame.extend(withSource,{kind:'outcome',outcome:sourceLinked}).state;
 const results=strategyPerformance(combined,'2026-10-09T00:00:00Z').hedge;
 assert.equal(results.unverifiedClaims,2);
 assert.equal(results.unverifiedClaimedPnlCents,35);
 assert.equal(results.sourceLinkedClaims,1);
 assert.equal(results.sourceLinkedClaimedPnlCents,25);
 assert.equal(results.pnlCents,null);
 assert.equal(results.sourceAuthenticated,false);
 assert.throws(()=>marketGame.extend(withSource,{kind:'outcome',
  outcome:{...sourceLinked,pnlCents:26}}),/source-bound outcome differs/);
 assert.throws(()=>marketGame.extend(start,{kind:'outcome',
  outcome:{...claim,pnlCents:.25}}),/integer USD cents/);
});
