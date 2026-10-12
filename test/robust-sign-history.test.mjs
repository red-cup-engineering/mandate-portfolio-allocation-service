import test from 'node:test';
import assert from 'node:assert/strict';
import {address,cell} from '@red-cup-engineering/signcell/cell';
import {
  createHistory,observeHistory,historySection,historyHeads,
} from '@red-cup-engineering/signcraft/history';
import {
  projectConditionalRobustActionSign,
} from '../src/settlement-sign-evidence.mjs';
import {
  robustActionSourceReceiptCells,composeConditionalRobustActionHistory,
} from '../src/scenario-sign-history.mjs';

const at='2026-10-12T20:00:00Z';
const forecast=()=>({
 id:'prior-joint',observedAt:'2026-10-12T18:00:00Z',
 availableAt:'2026-10-12T18:05:00Z',
 horizon:'2026-10-13T03:00:00Z',evidenceIds:['forecast-input'],
 scenarios:[{id:'up',probability:.5},{id:'down',probability:.5}],
});
const ambiguity=()=>({
 conditionedOnForecastId:'prior-joint',
 observedAt:'2026-10-12T19:00:00Z',
 availableAt:'2026-10-12T19:05:00Z',
 evidenceIds:['radius-input'],totalVariationRadius:.2,
});
const actions=()=>[
 {id:'abstain',payoffsUsdByScenario:{up:0,down:0}},
 {id:'kalshi-up',payoffsUsdByScenario:{up:2,down:-1}},
 {id:'alpaca-down',payoffsUsdByScenario:{up:-1,down:2}},
];
const projection=()=>projectConditionalRobustActionSign({
 forecast:forecast(),ambiguity:ambiguity(),actions:actions(),at,
 context:{source:'mixed-qualified-study',rules:'joint-source-rule-v1',
  scope:'cross-venue-fixed-actions',assumption:'model uncertainty radius only'},
});
const record=(id,observedAt,availableAt,hex)=>({
 id,sourceRef:'evidence://'+id,issuer:'synthetic-test-source',
 observedAt,availableAt,sha256:'sha256:'+hex.repeat(64),
});
const receipts=()=>[
 record('prior-joint','2026-10-12T18:00:00Z','2026-10-12T18:05:00Z','a'),
 record('forecast-input','2026-10-12T17:45:00Z','2026-10-12T17:50:00Z','b'),
 record('radius-input','2026-10-12T18:45:00Z','2026-10-12T18:50:00Z','c'),
];
const staged=(p=projection(),rs=receipts())=>observeHistory(
 createHistory(),robustActionSourceReceiptCells(p,rs),
 {source:'synthetic-original-receipt-claims'},
);

test('shared SignCell source receipt cells precede a real robust SignCraft causal revision',()=>{
 const p=projection(),h=staged(p);
 const r=composeConditionalRobustActionHistory({history:h,projection:p});
 assert.equal(r.kind,'conditional-robust-action-sign-history-v1');
 assert.equal(r.status,'composed');
 assert.ok(r.proofRevisionId);
 assert.deepEqual(r.priorHeads,historyHeads(h));
 assert.equal(r.sourceCells.length,p.premiseIds.length);
 assert.equal(r.linkCells.length,p.premiseIds.length);
 assert.equal(r.flow.kind,'signgraph.flowNetwork');
 assert.equal(r.flow.edges.length,p.premiseIds.length);
 assert.ok(r.flow.edges.every(edge=>edge.to===p.address));
 assert.deepEqual(r.flow.edges.map(e=>e.from).sort(),[...p.premiseIds].sort());
 // Every one-chain boundary is negative at its source, positive at its
 // conclusion; the old symmetric graph alone cannot establish this.
 const boundary=new Map(r.flow.terms.map(t=>[t,0]));
 for(const edge of r.flow.edges){
   boundary.set(edge.from,boundary.get(edge.from)-1);
   boundary.set(edge.to,boundary.get(edge.to)+1);
 }
 assert.equal(boundary.get(p.address),p.premiseIds.length);
 assert.ok(p.premiseIds.every(id=>boundary.get(id)===-1));
 assert.ok(r.linkCells.every(c=>c.object===p.address),
  'every cause edge targets the proof content address, not the forecast itself');
 assert.equal(historySection(r.history,p.cell.subject,p.cell.predicate).length,1);
 assert.equal(address(p.cell),r.proofAddress);
 assert.equal(r.tradeEligible,false);
 const replay=composeConditionalRobustActionHistory({
   history:r.history,projection:p,
 });
 assert.equal(replay.status,'already-recorded');
 assert.deepEqual(replay.heads,r.heads);
});

test('a numerical value changed without recomputing the canonical proof is refused',()=>{
 const p=projection(),h=staged(p);
 const forged={
  ...p,evaluation:{...p.evaluation,
   actionEvaluations:p.evaluation.actionEvaluations.map(x=>({...x})),
  },
 };
 forged.evaluation.actionEvaluations[1].worstCaseExpectedUsd+=.25;
 assert.throws(()=>composeConditionalRobustActionHistory({
  history:h,projection:forged,
 }),/replay disagrees/);
});

test('a source digest, witness or causal evidence cannot be silently fabricated',()=>{
 const p=projection(),r=receipts();
 const wrong=r.map(x=>({...x}));
 wrong[1].availableAt='2026-10-12T18:01:00Z';
 assert.throws(()=>robustActionSourceReceiptCells(p,wrong),/after model observation/);
 const after=r.map(x=>({...x}));
 after[2].availableAt='2026-10-12T19:02:00Z';
 assert.throws(()=>robustActionSourceReceiptCells(p,after),/after its observation/);
 const wrongReceipt=staged(p,r).revisions;
 assert.ok(wrongReceipt.length>0);
 const h=createHistory();
 assert.throws(()=>composeConditionalRobustActionHistory({history:h,projection:p}),
   /pre-received/);
 const sourceCells=robustActionSourceReceiptCells(p,r);
 const adulterated=sourceCells.map(c=>c.subject==='forecast-input'?
  cell(c.subject,c.predicate,c.object,{for:[{kind:'unfounded-source-proof'}]}):c);
 assert.throws(()=>composeConditionalRobustActionHistory({
  history:observeHistory(createHistory(),adulterated,{source:'unverified-claims'}),
  projection:p,
 }),/differ from the declared original-byte receipt shape/);
});

test('a changed scenario payoff, posterior assumption or action list changes the proof address',()=>{
 const a=projection();
 const changedActions=actions();
 changedActions[1].payoffsUsdByScenario.up=3;
 const b=projectConditionalRobustActionSign({
  forecast:forecast(),ambiguity:ambiguity(),actions:changedActions,at,
  context:{source:'mixed-qualified-study',rules:'joint-source-rule-v1',
    scope:'cross-venue-fixed-actions',assumption:'model uncertainty radius only'},
 });
 assert.notEqual(a.address,b.address);
 const altered=projection();
 const polluted={...altered,context:{...altered.context,
    assumedTotalVariationRadius:.8}};
 assert.throws(()=>composeConditionalRobustActionHistory({
  history:staged(a),projection:polluted,
 }),/conditional robust SignCell/);
});


test('optional joint downside tail-risk preference and values are part of the canonical SignCell proof',()=>{
 const p=projectConditionalRobustActionSign({
  forecast:forecast(),ambiguity:{...ambiguity(),tailFraction:.8},
  actions:actions(),at,
  context:{source:'mixed-qualified-study',rules:'joint-source-rule-v1',
    scope:'cross-venue-fixed-actions',assumption:'hypothetical TV radius and tail preference'},
 });
 const q=projectConditionalRobustActionSign({
  forecast:forecast(),ambiguity:ambiguity(),
  actions:actions(),at,
  context:{source:'mixed-qualified-study',rules:'joint-source-rule-v1',
    scope:'cross-venue-fixed-actions',assumption:'hypothetical TV radius and tail preference'},
 });
 assert.notEqual(p.address,q.address);
 assert.equal(p.context.assumedTailFraction,.8);
 assert.equal(p.context.minWorstExpectedShortfallAction,'abstain');
 assert.ok(p.context.robustValues.every(row=>row.length===7));
 const result=composeConditionalRobustActionHistory({
  history:staged(p),projection:p,
 });
 assert.equal(result.status,'composed');
 assert.equal(result.tradeEligible,false);
 const forged={...p,evaluation:{...p.evaluation,
   actionEvaluations:p.evaluation.actionEvaluations.map(row=>({...row})),
 }};
 forged.evaluation.actionEvaluations[1].worstCaseExpectedShortfallUsd+=.5;
 assert.throws(()=>composeConditionalRobustActionHistory({
  history:staged(p),projection:forged,
 }),/replay disagrees/);
});


test('Metrologic receiver refuses forged extremal distribution even when copied headline values are unchanged',()=>{
  const p=projection();
  const tampered={...p,evaluation:{
    ...p.evaluation,
    actionEvaluations:p.evaluation.actionEvaluations.map(row=>({
      ...row,
      worstCaseScenarioProbabilities:row.worstCaseScenarioProbabilities
        .map(([id,mass])=>[id,mass]),
    })),
  }};
  const changed=tampered.evaluation.actionEvaluations.find(row=>row.id==='kalshi-up');
  // Headline expected return and canonical SignCell are left untouched.
  // A forged witness q can no longer borrow their signed calculation.
  changed.worstCaseScenarioProbabilities[0][1]=.99;
  changed.worstCaseScenarioProbabilities[1][1]=.01;
  assert.throws(()=>composeConditionalRobustActionHistory({
    history:staged(p),projection:tampered,
  }),/Metrologic finite-law receiving disagrees/);
});

test('Metrologic receives a complete tail proof without asserting the assumed radius is measured',()=>{
  const p=projectConditionalRobustActionSign({
    forecast:forecast(),ambiguity:{...ambiguity(),tailFraction:.8},
    actions:actions(),at,
    context:{source:'mixed-qualified-study',rules:'joint-source-rule-v1',
      scope:'cross-venue-fixed-actions',assumption:'hypothetical uncertainty'},
  });
  const result=composeConditionalRobustActionHistory({
    history:staged(p),projection:p,
  });
  assert.equal(result.status,'composed');
  assert.equal(result.tradeEligible,false);
  assert.equal(result.orderEffect,false);
  assert.equal(p.radiusEmpiricallyVerified,false);
});
