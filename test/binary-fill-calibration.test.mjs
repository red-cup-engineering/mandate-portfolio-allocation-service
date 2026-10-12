import test from 'node:test';
import assert from 'node:assert/strict';
import {fitBinaryOutcomeFillByDay,scoreBinaryOutcomeFillHoldout} from '../src/binary-fill-calibration.mjs';

const familyScope='AAA-national-regular-directional-greater',
 regime='rest-yes-95c|queue-0|horizon-240m',side='yes';
const freezeAt='2026-10-01T00:00:00Z',publishedAt='2026-10-01T01:00:00Z';
const record=(i,overrides={})=>{
 const date=new Date(Date.UTC(2026,4,1+i)).toISOString().slice(0,10);
 const won=i%2===0,filled=won?i%10!==0:i%10===1;
 return {venueOrderId:'order-'+i,executionReceiptId:'terminal-'+i,
  settlementReceiptId:'settled-'+date,source:'kalshi',
  familyScope,quoteRegime:regime,side,
  eventId:'KXAAAGASD-'+date,marketId:'KXAAAGASD-'+date+'-4.0000',
  targetDate:date,settlementSide:won?'yes':'no',
  settlementStatus:'finalized',filled,attemptedContracts:1,
  filledContracts:filled?1:0,
  bookReceivedAt:date+'T11:59:30Z',placedAt:date+'T12:00:00Z',
  terminalAt:date+'T12:10:00Z',settledAt:date+'T15:00:00Z',
  settlementAvailableAt:date+'T16:00:00Z',
  ...(filled?{fillReceivedAt:date+'T12:05:00Z'}:{}),
  evidenceIds:['book:'+date,'receipt:'+date],
  ...overrides};
};
const rows=(n=80)=>Array.from({length:n},(_,i)=>record(i));
const fit=(overrides={})=>fitBinaryOutcomeFillByDay({
 familyScope,quoteRegime:regime,side,freezeAt,publishedAt,
 minDaysPerOutcome:30,rows:rows(),...overrides});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-11,a+' != '+b);

test('source-bound daily fit learns winning and losing conditional hazards separately',()=>{
 const r=fit();
 assert.equal(r.status,'exploratory-intervals');
 assert.equal(r.admitted,false);
 assert.equal(r.outcomeDayEvidence.win.days,40);
 assert.equal(r.outcomeDayEvidence.loss.days,40);
 near(r.outcomeDayEvidence.win.mean,.8);
 near(r.outcomeDayEvidence.loss.mean,.2);
 assert.ok(r.modelCandidate);
 assert.ok(r.modelCandidate.probabilityFillGivenWin.low<.8);
 assert.ok(r.modelCandidate.probabilityFillGivenLoss.high>.2);
 assert.equal(r.tradeEligible,false);
 assert.equal(r.orderEffect,false);
});

test('one hundred repeated same-day orders cannot manufacture one hundred independent days',()=>{
 const original=rows(80);
 const more=original.concat(Array.from({length:99},(_,j)=>{
  const x=record(0,{venueOrderId:'repeat-'+j,executionReceiptId:'repeat-terminal-'+j});
  return x;
 }));
 const r=fit({rows:more});
 assert.equal(r.sourceOrderCount,179);
 assert.equal(r.outcomeDayEvidence.win.days,40);
 assert.equal(r.outcomeDayEvidence.loss.days,40);
 const reference=fit();
 near(r.outcomeDayEvidence.win.halfWidthBeforeClipping,
  reference.outcomeDayEvidence.win.halfWidthBeforeClipping);
});

test('too few independently settled losing days withholds hazard intervals',()=>{
 const many=Array.from({length:60},(_,i)=>record(i,{settlementSide:i<50?'yes':'no'}));
 const r=fit({rows:many});
 assert.equal(r.status,'insufficient-independent-outcome-days');
 assert.equal(r.modelCandidate,null);
 assert.equal(r.admitted,false);
 assert.equal(r.outcomeDayEvidence.loss.days,10);
});

test('exact source-family and quote regime must match every order',()=>{
 assert.throws(()=>fit({rows:[record(0,{familyScope:'diesel'})]}),TypeError);
 assert.throws(()=>fit({rows:[record(0,{quoteRegime:'different-queue'})]}),TypeError);
 assert.throws(()=>fit({rows:[record(0,{side:'no'})]}),TypeError);
});

test('retrospective aggregate gas/diesel histogram has no terminal exchange orders',()=>{
 assert.throws(()=>fit({rows:[{
  p:98,Q:0,H:240,yes:1,filled:100,clean:70,n:400,
 }]}),TypeError);
});

test('training evidence must precede freeze and cannot be backdated to its final settlement date',()=>{
 assert.throws(()=>fit({rows:[record(0,{settlementAvailableAt:'2026-10-02T00:00:00Z'})]}),RangeError);
 assert.throws(()=>fit({rows:[record(0,{placedAt:'2026-10-02T00:00:00Z'})]}),RangeError);
 assert.throws(()=>fit({publishedAt:'2026-09-30T00:00:00Z'}),TypeError);
});

test('no order after settlement and no source book from the future',()=>{
 assert.throws(()=>fit({rows:[record(0,{bookReceivedAt:'2026-05-01T12:05:00Z'})]}),RangeError);
 assert.throws(()=>fit({rows:[record(0,{bookReceivedAt:'2026-05-01T11:40:00Z'})]}),RangeError);
 assert.throws(()=>fit({rows:[record(0,{terminalAt:'2026-05-01T16:00:00Z'})]}),RangeError);
});

test('the final exchange result of one market cannot be both YES and NO',()=>{
 const r=record(0),s=record(0,{venueOrderId:'other-order',
  executionReceiptId:'other-terminal',settlementSide:'no'});
 assert.throws(()=>fit({rows:[r,s]}),RangeError);
});

test('failed or unconfirmed market orders cannot be quietly counted as definite no-fills',()=>{
 assert.throws(()=>fit({rows:[record(0,{settlementStatus:'provisional'})]}),TypeError);
 assert.throws(()=>fit({rows:[record(0,{executionReceiptId:''})]}),TypeError);
 assert.throws(()=>fit({rows:[record(0,{filled:false,fillReceivedAt:'2026-05-01T12:05:00Z'})]}),RangeError);
 assert.throws(()=>fit({rows:[record(0,{filled:true,fillReceivedAt:undefined})]}),RangeError);
});

test('permutation of receipt rows cannot alter the fitted study identity',()=>{
 const r=fit({rows:rows().slice().reverse()}),s=fit();
 assert.deepEqual(r,s);
 assert.equal(r.id,s.id);
});

test('independent-day intervals remain broad under conservative Hoeffding screening',()=>{
 const r=fit();
 const radius=Math.sqrt(Math.log(4/.05)/(2*40));
 near(r.outcomeDayEvidence.win.halfWidthBeforeClipping,radius);
 near(r.outcomeDayEvidence.loss.halfWidthBeforeClipping,radius);
 assert.ok(r.modelCandidate.probabilityFillGivenLoss.low===0);
});

test('validation guards group consistency and both outcome coverage',()=>{
 assert.throws(()=>fit({rows:[record(0),record(0)]}),TypeError);
 assert.throws(()=>fit({minDaysPerOutcome:1}),TypeError);
 assert.throws(()=>fit({alpha:0}),TypeError);
 assert.throws(()=>fit({maxBookAgeMs:0}),TypeError);
});


test('calibration identity commits actual outcome, fill and hyperparameters, not only reusable receipt labels',()=>{
 const original=fit();
 const flipped=rows();
 flipped[0]={...flipped[0],filled:!flipped[0].filled,
   ...(flipped[0].filled?{fillReceivedAt:undefined}:{fillReceivedAt:flipped[0].placedAt})};
 const revised=fit({rows:flipped});
 assert.notEqual(revised.id,original.id,'changed received fill result needs a new content address');
 assert.notDeepEqual(revised.outcomeDayEvidence.win,original.outcomeDayEvidence.win);
 const labelChange=rows();
 labelChange[0]={...labelChange[0],settlementSide:'no'};
 const reclassified=fit({rows:labelChange});
 assert.notEqual(reclassified.id,original.id);
 const newAlpha=fit({alpha:.1});
 assert.notEqual(newAlpha.id,original.id,'changing the confidence bound changes the model identity');
 const newThreshold=fit({minDaysPerOutcome:35});
 assert.notEqual(newThreshold.id,original.id);
 const stricterBook=fit({maxBookAgeMs:45_000});
 assert.notEqual(stricterBook.id,original.id);
});


test('partially filled and multi-lot orders cannot distort the binary one-lot fill hazard',()=>{
 assert.throws(()=>fit({rows:[record(0,{attemptedContracts:2,filledContracts:1})]}),TypeError);
 assert.throws(()=>fit({rows:[record(0,{attemptedContracts:1,filledContracts:.25})]}),TypeError);
 assert.throws(()=>fit({rows:[record(0,{attemptedContracts:1,filledContracts:0,filled:true})]}),TypeError);
 assert.throws(()=>fit({rows:[record(0,{attemptedContracts:1,filledContracts:1,filled:false})]}),TypeError);
});


const trainingFrozen=()=>fit({
 rows:rows(60),freezeAt:'2026-07-01T00:00:00Z',
 publishedAt:'2026-07-01T01:00:00Z',
});
const futureRows=()=>Array.from({length:60},(_,i)=>record(i+61));
const evaluate=(options={})=>scoreBinaryOutcomeFillHoldout({
 training:trainingFrozen(),rows:futureRows(),
 evaluatedAt:'2026-10-01T00:00:00Z',...options,
});

test('frozen real-order model can be scored on later distinct source-local days',()=>{
 const r=evaluate();
 assert.equal(r.status,'held-out-research-screen');
 assert.equal(r.independentHeldoutDays,60);
 assert.equal(r.actualHeldoutOrderCount,60);
 near(r.trainingUnconditionalFillProbability,.5);
 near(r.trainingFillGivenWin,.8);
 near(r.trainingFillGivenLoss,.2);
 near(r.holdoutBrier.unconditional,.25);
 near(r.holdoutBrier.outcomeConditioned,.16);
 near(r.holdoutBrier.pairedImprovement,.09);
 assert.equal(r.conditionallyImproved,false,'small day sample cannot pass conservative Hoeffding');
 assert.equal(r.admitted,false);
 assert.equal(r.tradeEligible,false);
});

test('repeated same-day real fills do not inflate the count of independent evaluation days',()=>{
 const base=evaluate(),more=futureRows();
 for(let i=0;i<80;i++){
  const original=more[0];
  more.push({...original,venueOrderId:'heldout-repeat-'+i,
   executionReceiptId:'terminal-repeat-'+i});
 }
 const r=evaluate({rows:more});
 assert.equal(r.independentHeldoutDays,base.independentHeldoutDays);
 assert.equal(r.actualHeldoutOrderCount,140);
 near(r.holdoutBrier.exploratoryRadius,
  base.holdoutBrier.exploratoryRadius);
});

test('valid evaluation must occur after model was frozen and source labels were finally received',()=>{
 assert.throws(()=>evaluate({evaluatedAt:'2026-07-01T01:00:00Z'}),TypeError);
 assert.throws(()=>evaluate({rows:[record(0)]}),RangeError);
 assert.throws(()=>evaluate({rows:[record(60)]}),RangeError);
 assert.throws(()=>evaluate({rows:futureRows().map(r=>({...r,
  settlementAvailableAt:'2026-10-02T00:00:00Z'}))}),RangeError);
});

test('training receipts may not be counted again in the heldout sample',()=>{
 const f=futureRows();
 f[0]={...f[0],executionReceiptId:'terminal-0'};
 assert.throws(()=>evaluate({rows:f}),RangeError);
 const g=futureRows();
 g[0]={...g[0],settlementReceiptId:'settled-2026-05-01'};
 assert.throws(()=>evaluate({rows:g}),RangeError);
});

test('holdout must preserve source family, quote regime and one-lot terminal receipt',()=>{
 assert.throws(()=>evaluate({rows:[record(65,{familyScope:'diesel'})]}),TypeError);
 assert.throws(()=>evaluate({rows:[record(65,{quoteRegime:'other'})]}),TypeError);
 assert.throws(()=>evaluate({rows:[record(65,{filledContracts:.5})]}),TypeError);
 assert.throws(()=>evaluate({rows:[record(65,{settlementStatus:'preliminary'})]}),TypeError);
});

test('holdout evaluation is deterministic and the fitted model is never overwritten',()=>{
 const first=evaluate(),second=evaluate({rows:futureRows().reverse()});
 assert.deepEqual(first,second);
 assert.equal(first.trainingId,trainingFrozen().id);
 assert.notEqual(first.trainingId,first.holdoutReceiptId);
});

test('fewer than predeclared held-out days gives a descriptive metric but no better-model finding',()=>{
 const r=evaluate({rows:futureRows().slice(0,12),minEvaluationDays:20});
 assert.equal(r.independentHeldoutDays,12);
 assert.equal(r.status,'insufficient-independent-evaluation-days');
 assert.equal(r.conditionallyImproved,false);
 assert.equal(r.tradeEligible,false);
});

test('a corrupted frozen model or invalid validation design cannot be scored',()=>{
 const train=trainingFrozen();
 assert.throws(()=>evaluate({training:{...train,modelCandidate:null}}),TypeError);
 assert.throws(()=>evaluate({training:{...train,dayStatistics:[]}}),TypeError);
 assert.throws(()=>evaluate({minEvaluationDays:3}),TypeError);
 assert.throws(()=>evaluate({alpha:0}),TypeError);
 assert.throws(()=>evaluate({rows:[]}),TypeError);
});

test('no empirical Brier improvement can ever grant an execution order or a source-rights waiver',()=>{
 const r=evaluate();
 assert.equal(r.kind,'outcome-fill-holdout-brier-v1');
 assert.ok(r.limitations.some(l=>l.includes('settlement')));
 assert.equal(r.tradeEligible,false);
 assert.equal(r.orderEffect,false);
 assert.equal(r.admitted,false);
});
