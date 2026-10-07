import test from 'node:test';
import assert from 'node:assert/strict';
import {planMarket} from '../src/market-game.mjs';
const at='2026-10-07T02:00:00Z',horizon='2026-10-08T02:00:00Z';
const calibration={sampleSize:100,brier:0.1,baselineBrier:0.2,record:'cal',windowEnd:'2026-10-01T00:00:00Z'};
const policy={minCalibrationSamples:20,maxDeployFraction:1,maxInstrumentFraction:1,maxScenarioLossFraction:0.9,maxObservationAgeMs:60000,kellyMultiple:1};
function state(availableUnits=1){return {observations:{cal:{observedAt:at,availableAt:at,value:{kind:'calibration',...calibration}},research:{observedAt:at,availableAt:at,value:{kind:'synthetic-test-only'}}},accounts:{evm:{venue:'evm',observedAt:at,equityCents:100,freeCashCents:0,inventory:{ETH:{units:1,availableUnits,markPrice:1}}}},quotes:{swap:{id:'swap',venue:'evm',instrument:'USDC',observedAt:at,horizon,entryPrice:1,unitStep:0.01,availableUnits:1,transitionCostFraction:0,carryCostFraction:0,carrier:'asset',side:'long',chainId:8453,blockHash:'0xblock',finalized:true,protocol:'test-only',funding:{instrument:'ETH',unitsPerUnit:1}}},strategies:{hedge:{id:'hedge',observedAt:at,quoteIds:['swap'],evidenceIds:['research'],thesis:'Exchange held exposure for stable value',falsifier:'Held units or horizon differ'}},forecast:{id:'f',observedAt:at,horizon,calibration,evidenceIds:['cal'],scenarios:[{id:'down',probability:0.5,values:{swap:1},fundingValues:{ETH:0.5},heldPnlCentsByVenue:{evm:-50}},{id:'up',probability:0.5,values:{swap:1},fundingValues:{ETH:1.5},heldPnlCentsByVenue:{evm:50}}]},decisions:{},outcomes:{}};}
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
 const s=state();s.forecast.conditioning={model:'test-model'};s.forecast.calibration={...calibration,confidenceLowerBound:0.01,netReturnConfidenceLowerBound:-0.01};s.observations.cal.value={...s.observations.cal.value,...s.forecast.calibration};
 assert.throws(()=>planMarket(s,policy,at),/lacks positive measured/);
 s.forecast.calibration.netReturnConfidenceLowerBound=0.01;
 assert.throws(()=>planMarket(s,policy,at),/differs from scored evidence/);
 s.observations.cal.value.netReturnConfidenceLowerBound=0.01;
 assert.equal(planMarket(s,policy,at).orders.length,1);
});
test('removing conditioning metadata cannot bypass a scored study rejection',()=>{
 const s=state();s.observations.cal.value.method='fixed-binned-likelihood-temporal-holdout/v2';
 assert.throws(()=>planMarket(s,policy,at),/lacks positive measured/);
});
