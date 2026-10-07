import test from 'node:test';
import assert from 'node:assert/strict';
import {planMarket,allocationsFor} from '../src/market-game.mjs';
import {formAggressivePortfolioIntent} from '../../alpha-portfolio-order-intent-service/src/aggressive-intent.mjs';
import {validateExecutionRequest} from '../../brokerage-execution-transport-service/src/execute-intent.mjs';
const at='2026-10-07T02:00:00Z',horizon='2026-10-08T02:00:00Z';
const calibration={sampleSize:100,brier:0.1,baselineBrier:0.2,record:'cal',windowEnd:'2026-10-01T00:00:00Z',confidenceLowerBound:0.01,netReturnConfidenceLowerBound:0.01,liveUseLimitations:[]};
const policy={principal:'synthetic-principal',minCalibrationSamples:20,maxDeployFraction:1,maxInstrumentFraction:1,maxScenarioLossFraction:0.9,maxObservationAgeMs:60000,kellyMultiple:1};
function state(availableUnits=1){return {observations:{cal:{observedAt:at,availableAt:at,value:{kind:'calibration',...calibration}},research:{observedAt:at,availableAt:at,value:{kind:'synthetic-test-only'}}},accounts:{evm:{venue:'evm',principal:'synthetic-principal',observedAt:at,equityCents:100,freeCashCents:0,inventory:{ETH:{units:1,availableUnits,markPrice:1}}}},quotes:{swap:{id:'swap',venue:'evm',instrument:'USDC',observedAt:at,horizon,entryPrice:1,unitStep:0.01,availableUnits:1,transitionCostFraction:0,carryCostFraction:0,carrier:'asset',side:'long',chainId:8453,blockHash:'0xblock',finalized:true,protocol:'test-only',funding:{instrument:'ETH',unitsPerUnit:1}}},strategies:{hedge:{id:'hedge',observedAt:at,quoteIds:['swap'],evidenceIds:['research'],thesis:'Exchange held exposure for stable value',falsifier:'Held units or horizon differ'}},forecast:{id:'f',observedAt:at,horizon,calibration:{...calibration},evidenceIds:['cal'],scenarios:[{id:'down',probability:0.5,values:{swap:1},fundingValues:{ETH:0.5},heldPnlCentsByVenue:{evm:-50}},{id:'up',probability:0.5,values:{swap:1},fundingValues:{ETH:1.5},heldPnlCentsByVenue:{evm:50}}]},decisions:{},outcomes:{}};}
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
 assert.throws(()=>formAggressivePortfolioIntent({contract,evidencePackets:[{type:'IssuerEvidencePacket',id:'test-only'}],symbol:'TEST',notional:1,maximumLoss:1,marketDecision:decision,asOf:at}),/another principal/);
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
 assert.throws(()=>planMarket(s,policy,at),/scored training-bin return and cost/);
});
