import test from 'node:test';
import assert from 'node:assert/strict';
import {address} from '@red-cup-engineering/signcell/cell';
import {
  createHistory,historySection,historyHeads,
} from '@red-cup-engineering/signcraft/history';
import {flowNetworkOfCells} from '@red-cup-engineering/signgraph/cell-graph';
import {
  projectAgentPredictionFillSourceSigns,
  composeAgentPredictionFillHistory,
  circulateAgentPredictionFillToHistory,
} from '../src/scenario-sign-history.mjs';

const A=c=>'0x'+c.repeat(40),H=c=>'0x'+c.repeat(64);
const AT='2026-10-16T22:00:00Z';
function observed(overrides={}) {
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

test('real native SignCell/SignGraph projects separate outcome inventory and fee consideration',()=>{
  const r=projectAgentPredictionFillSourceSigns({receipt:observed(),at:AT});
  assert.equal(r.kind,'agent-prediction-market-fill-native-sign-projection');
  assert.equal(r.sourceAddress,address(r.sourceCell));
  assert.equal(r.positionAddress,address(r.positionCell));
  assert.equal(r.feeAddress,address(r.feeCell));
  assert.equal(r.sourceCell.subject.logIndex,6);
  assert.equal(r.sourceCell.subject.transactionHash,H('6'));
  assert.equal(r.positionCell.object.positionId,'36');
  assert.equal(r.positionCell.object.lots,'2');
  assert.equal(r.feeCell.object.consideration.providerFeeAtomic,'4400');
  assert.equal(r.feeCell.object.consideration.protocolFeeAtomic,'6600');
  assert.equal(r.feeCell.object.consideration.recognition.includes('no realized profit'),true);
  assert.equal(r.sourceCell.for.length,1);
  assert.equal(r.sourceAuthenticated,false);
  assert.equal(r.customerAccepted,false);
  assert.equal(r.realizedProfitAccepted,false);
  assert.equal(r.grantsTradingAuthority,false);
  assert.equal(r.flow.kind,'signgraph.flowNetwork');
  assert.equal(r.flow.edges.length,2);
  assert.deepEqual(r.flow.edges.map(e=>e.from),[r.sourceAddress,r.sourceAddress]);
  assert.deepEqual(r.flow.edges.map(e=>e.to),[r.positionAddress,r.feeAddress]);
  assert.equal(r.observationsSeavt.length,2);
});

test('the same economic event becomes two causal native SignCraft revisions, not a new journal',()=>{
  const before=createHistory();
  const first=composeAgentPredictionFillHistory({history:before,receipt:observed(),at:AT});
  assert.equal(first.status,'composed');
  assert.equal(first.history.kind,'signcraft.history');
  assert.equal(first.history.revisions.length,2);
  assert.equal(first.history.revisions[0].id,first.sourceRevisionId);
  assert.deepEqual(first.history.revisions[1].parents,[first.sourceRevisionId]);
  assert.equal(historySection(first.history,first.projection.sourceCell.subject,
    first.projection.sourceCell.predicate).length,1);
  assert.deepEqual(historyHeads(first.history),first.heads);
  const observedAgain=composeAgentPredictionFillHistory({
    history:first.history,receipt:observed(),at:'2026-10-17T07:00:00Z',
  });
  assert.equal(observedAgain.status,'already-observed');
  assert.equal(observedAgain.history,first.history);
  assert.equal(observedAgain.projection.sourceAddress,first.projection.sourceAddress);
  assert.equal(observedAgain.projection.positionAddress,first.projection.positionAddress);
  assert.equal(observedAgain.projection.feeAddress,first.projection.feeAddress);
});

test('multiple legitimately distinct fills append to one continuing enterprise history',()=>{
  const first=composeAgentPredictionFillHistory({receipt:observed(),at:AT});
  const second=composeAgentPredictionFillHistory({history:first.history,at:AT,receipt:observed({
    transactionHash:H('a'),buyNonce:H('d'),paymentNonce:H('e'),
    sourceEconomicEvent:{...observed().sourceEconomicEvent,transactionHash:H('a'),logIndex:7},
  })});
  assert.equal(second.status,'composed');
  assert.equal(second.history.revisions.length,4);
  assert.equal(second.history.revisions[2].parents[0],first.positionRevisionId);
  assert.equal(flowNetworkOfCells(second.projection.linkCells).edges.length,2);
});

test('a wrong market, changed transaction, missing finality or invented source identity refuses',()=>{
  const bad=[
    {market:A('f')},
    {network:'eip155:1'},
    {transactionHash:H('9')},
    {sourceEconomicEvent:{...observed().sourceEconomicEvent,emitter:A('1')}},
    {sourceEconomicEvent:{...observed().sourceEconomicEvent,logIndex:-1}},
    {sourceEconomicEvent:{...observed().sourceEconomicEvent,blockHash:'0x45'}},
    {sourceEconomicEvent:{...observed().sourceEconomicEvent,type:'TypedCommitment'}},
    {finalized:false},
    {authorizationNonceConsumed:false},
    {sharesReceived:false},
  ];
  for(const change of bad){
    assert.throws(()=>projectAgentPredictionFillSourceSigns({
      receipt:observed(change),at:AT,
    }));
  }
});

test('source amounts are atomic exact units, never inferred profit or floating-point',()=>{
  for(const change of [
    {amount:'1111001'}, {makerAmount:'1099999'}, {providerFee:'4401'},
    {protocolFee:'6601'}, {lots:2}, {makerAmount:'1100000.0'},
    {amount:'9007199254740993'}, {outcome:7},
  ])assert.throws(()=>projectAgentPredictionFillSourceSigns({receipt:observed(change),at:AT}));
});

test('the same chain coordinate cannot silently acquire different payout or position claims',()=>{
  const first=composeAgentPredictionFillHistory({receipt:observed(),at:AT});
  const changed=observed({providerFee:'4399',protocolFee:'6601'});
  assert.throws(()=>composeAgentPredictionFillHistory({
    history:first.history,receipt:changed,at:AT,
  }),/conflicting economic source claims/u);
  assert.equal(first.history.revisions.length,2);
});

test('the original date remains an observation clock and cannot authorize an order',()=>{
  assert.throws(()=>projectAgentPredictionFillSourceSigns({
    receipt:observed(),at:'2026-10-16T22:00:00',
  }),/absolute/u);
  const projection=projectAgentPredictionFillSourceSigns({receipt:observed(),at:AT});
  assert.equal(projection.positionCell.predicate,'has-reported-atomic-market-position-transfer');
  assert.equal(projection.feeCell.predicate,'has-reported-atomic-market-consideration');
  assert.equal(projection.sourceCell.for[0].sourceAuthenticated,false);
});


function storeOf(initial=createHistory()) {
  let history=initial;
  let writes=0;
  return Object.freeze({
    load:()=>({history,control:{kind:'synthetic-existing-signcraft-writer'}}),
    commit(next){
      writes++;
      history=next;
    },
    count:()=>writes,
  });
}
const sameRequest=()=>({transactionHash:H('6'),expected:{resource:'synthetic-signed-buyer-intent'},at:AT});

test('installed native SignCraft store receives exact EVM source once, then reuses same history',async()=>{
  const store=storeOf();
  let originalReads=0;
  const readFinalizedFill=async()=>{originalReads++;return observed();};
  const first=await circulateAgentPredictionFillToHistory({
    store,readFinalizedFill,...sameRequest(),
  });
  assert.equal(first.status,'persisted');
  assert.equal(first.persisted,true);
  assert.equal(first.graphEdges,2);
  assert.equal(first.sourceEvent.logIndex,6);
  assert.equal(first.customerAccepted,false);
  assert.equal(first.sourceAuthenticated,false);
  assert.equal(store.count(),1);
  const repeated=await circulateAgentPredictionFillToHistory({
    store,readFinalizedFill,...sameRequest(),at:'2026-10-17T07:00:00Z',
  });
  assert.equal(repeated.status,'already-persisted');
  assert.equal(repeated.persisted,true);
  assert.equal(store.count(),1,'same event must never create a second economic effect');
  assert.equal(originalReads,2,'source reader remains accountable for repeated observations');
});

test('native market source pending/refusal does not mutate the enterprise history',async()=>{
  const store=storeOf();
  const pending=await circulateAgentPredictionFillToHistory({
    store,...sameRequest(),readFinalizedFill:async()=>null,
  });
  assert.equal(pending.status,'finality-pending');
  const offline=await circulateAgentPredictionFillToHistory({
    store,...sameRequest(),readFinalizedFill:async()=>{throw Error('independent RPC unavailable');},
  });
  assert.equal(offline.status,'source-unavailable');
  const fake=await circulateAgentPredictionFillToHistory({
    store,...sameRequest(),readFinalizedFill:async()=>observed({amount:'999'}),
  });
  assert.equal(fake.status,'source-refused');
  assert.equal(store.count(),0);
});

test('conflicting payout for same original event never rewrites prior market claim',async()=>{
  const store=storeOf();
  const readFinalizedFill=async()=>observed();
  assert.equal((await circulateAgentPredictionFillToHistory({
    store,readFinalizedFill,...sameRequest(),
  })).status,'persisted');
  const second=await circulateAgentPredictionFillToHistory({
    store,readFinalizedFill:async()=>observed({
      providerFee:'4399',protocolFee:'6601',
    }),...sameRequest(),
  });
  assert.equal(second.status,'source-refused');
  assert.equal(store.count(),1);
});

test('uncertain write/readback is not automatically attempted again',async()=>{
  let writes=0;
  const store={
    load:()=>({history:createHistory()}),
    commit:()=>{writes++;throw Error('write may have persisted');},
  };
  const result=await circulateAgentPredictionFillToHistory({
    store,readFinalizedFill:async()=>observed(),...sameRequest(),
  });
  assert.equal(result.status,'commit-or-readback-uncertain');
  assert.equal(writes,1);
  assert.equal(result.customerAccepted,false);
});

test('one real later source event adds exactly one new pair of native revisions',async()=>{
  const store=storeOf();
  const original=await circulateAgentPredictionFillToHistory({
    store,readFinalizedFill:async()=>observed(),...sameRequest(),
  });
  assert.equal(original.status,'persisted');
  const other=observed({
    transactionHash:H('a'),paymentNonce:H('e'),buyNonce:H('d'),
    sourceEconomicEvent:{...observed().sourceEconomicEvent,transactionHash:H('a'),logIndex:7},
  });
  const next=await circulateAgentPredictionFillToHistory({
    store,readFinalizedFill:async()=>other,
    transactionHash:H('a'),expected:{resource:'second independent signed buyer order'},at:AT,
  });
  assert.equal(next.status,'persisted');
  assert.equal(store.count(),2);
  assert.equal(store.load().history.revisions.length,4);
});
