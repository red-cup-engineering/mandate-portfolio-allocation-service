import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHistory} from '@red-cup-engineering/signcraft/history';
import {marketGame} from '../src/market-game.mjs';
import {circulateAgentPredictionFillToHistory} from '../src/scenario-sign-history.mjs';
import {
  appendReceivedAgentPredictionMarketFill,marketObservationOfReceivedAgentPredictionFill,
  readMarketPlay,
} from '../src/play.mjs';

const A=c=>'0x'+c.repeat(40),H=c=>'0x'+c.repeat(64);
const AT='2026-10-16T22:00:00Z';
function fill(overrides={}) {
  return {
    finalized:true,transactionStatus:1,network:'eip155:84532',
    transactionHash:H('6'),market:A('c'),asset:A('e'),buyer:A('b'),
    askId:'42',marketId:'12',lots:'2',outcome:0,
    paymentNonce:H('5'),buyNonce:H('4'),amount:'1111000',
    maker:A('2'),provider:A('1'),protocolRecipient:A('3'),
    makerAmount:'1100000',providerFee:'4400',protocolFee:'6600',
    authorizationNonceConsumed:true,buyerDebited:true,sharesReceived:true,
    feesSettled:true,backingConserved:true,
    sourceEconomicEvent:{type:'EvmAgentPredictionAskFilled',
      chain:'eip155:84532',blockNumber:125,blockHash:H('8'),
      transactionHash:H('6'),logIndex:6,emitter:A('c'),event:'AskFilled'},
    ...overrides,
  };
}
function storeOf(){
  let history=createHistory(),writes=0;
  return {
    load:()=>({history,control:{}}),
    commit:(next)=>{history=next;writes++;},
    count:()=>writes,
  };
}
const temp=()=>{
  const dir=mkdtempSync(join(tmpdir(),'agent-prediction-market-play-'));
  const path=join(dir,'play.jsonl');
  writeFileSync(path,'');
  return {path,dispose:()=>rmSync(dir,{recursive:true,force:true})};
};
const receive=(store,reading=fill())=>circulateAgentPredictionFillToHistory({
  store,readFinalizedFill:async()=>reading,transactionHash:reading.transactionHash,
  expected:{resource:'synthetic-original-buyer-order'},at:AT,
});

test('source-received ERC1155 fill actually enters the original durable native SEAVT market play',async()=>{
  const store=storeOf(),fx=temp(),reading=fill();
  try {
    const circulated=await receive(store,reading);
    assert.equal(circulated.status,'persisted');
    const move=marketObservationOfReceivedAgentPredictionFill({store,receipt:reading,at:AT});
    assert.equal(move.kind,'observe');
    assert.equal(move.observation.id,circulated.sourceAddress);
    assert.equal(move.observation.value.positionId,'36');
    assert.equal(move.observation.value.lots,'2');
    assert.equal(move.observation.value.consideration.providerFeeAtomic,'4400');
    assert.equal(move.observation.value.customerAccepted,false);
    assert.equal(move.observation.value.realizedProfitAccepted,false);
    const appended=appendReceivedAgentPredictionMarketFill({
      path:fx.path,state:marketGame.initialPosition(),seq:0,
      receipt:reading,store,receivedAt:AT,
    });
    assert.equal(appended.status,'appended');
    assert.equal(appended.appended,true);
    const actual=await readMarketPlay(fx.path);
    assert.equal(actual.seq,0);
    assert.equal(actual.rows,1);
    assert.equal(actual.state.observations[circulated.sourceAddress].value.lots,'2');
    assert.deepEqual(Object.keys(actual.state.accounts),[]);
    assert.deepEqual(Object.keys(actual.state.outcomes),[]);
    const size=statSync(fx.path).size;
    const repeated=appendReceivedAgentPredictionMarketFill({
      path:fx.path,state:actual.state,seq:1,receipt:reading,store,
      receivedAt:'2026-10-17T00:00:00Z',precedingReceivedAt:AT,
    });
    assert.equal(repeated.status,'already-in-market-game');
    assert.equal(repeated.appended,false);
    assert.equal(statSync(fx.path).size,size,'a repeated economic event must not add a second market play');
  } finally {fx.dispose();}
});

test('an unreceived, conflicting or absent SignCraft source cannot enter the market game',async()=>{
  const store=storeOf(),fx=temp();
  try{
    assert.throws(()=>appendReceivedAgentPredictionMarketFill({
      path:fx.path,state:marketGame.initialPosition(),seq:0,receipt:fill(),
      store,receivedAt:AT,
    }),/prior SignCraft source/u);
    assert.equal(statSync(fx.path).size,0);
    assert.equal((await receive(store)).status,'persisted');
    assert.throws(()=>marketObservationOfReceivedAgentPredictionFill({
      store,receipt:fill({amount:'1111001'}),at:AT,
    }));
    assert.throws(()=>marketObservationOfReceivedAgentPredictionFill({
      store,receipt:fill({sourceEconomicEvent:{
        ...fill().sourceEconomicEvent,transactionHash:H('9'),
      }}),at:AT,
    }));
    assert.equal(statSync(fx.path).size,0);
  }finally{fx.dispose();}
});

test('a second genuine source event produces a second independently replayable market observation',async()=>{
  const store=storeOf(),fx=temp();
  try{
    const f0=fill();
    assert.equal((await receive(store,f0)).status,'persisted');
    appendReceivedAgentPredictionMarketFill({path:fx.path,state:marketGame.initialPosition(),
      seq:0,receipt:f0,store,receivedAt:AT});
    const prior=await readMarketPlay(fx.path);
    const f1=fill({transactionHash:H('a'),buyNonce:H('d'),paymentNonce:H('e'),
      sourceEconomicEvent:{...f0.sourceEconomicEvent,transactionHash:H('a'),logIndex:7}});
    assert.equal((await receive(store,f1)).status,'persisted');
    const second=appendReceivedAgentPredictionMarketFill({path:fx.path,state:prior.state,
      seq:1,receipt:f1,store,receivedAt:'2026-10-17T00:00:00Z',
      precedingReceivedAt:AT});
    assert.equal(second.status,'appended');
    const actual=await readMarketPlay(fx.path);
    assert.equal(actual.rows,2);
    assert.equal(Object.keys(actual.state.observations).length,2);
    assert.equal(Object.keys(actual.state.accounts).length,0);
  }finally{fx.dispose();}
});
