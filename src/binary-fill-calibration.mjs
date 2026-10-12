/**
 * Research-only prospective calibration of conditional maker FILL hazards.
 * Shared across gas, weather, sports and any binary venue.
 *
 * Correct sampling unit: SETTLEMENT DAY (source-local target date), NOT
 * repeated quote ticks, grid-search permutations or submitted orders.
 * Each day's bounded mean fill rate has unit weight, regardless of how many
 * orders the experiment placed that day.
 *
 * The input requires ACTUAL, individually identified, terminal venue order
 * evidence and FINAL settlement receipts; a retrospective aggregate bucket
 * cannot satisfy this contract. An identical market cannot have conflicting
 * settlement labels. Separate P(fill|purchased side wins) and
 * P(fill|purchased side loses) are estimated from independently held-out
 * past days within the exact same source-family and quote regime.
 *
 * Hoeffding intervals below are valid *only under independent, stable
 * day-block assumptions*, which real fuel/sports/weather time series may
 * violate. They are exploratory mathematical bounds, not a certified
 * live model. No false binomial 'n=orders' confidence or edge admission.
 */
import {hashPosition} from '@red-cup-engineering/gaming/running/rules';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clock=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const label=x=>typeof x==='string'&&x.trim().length>0;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const cap=(x)=>Math.min(1,Math.max(0,x));
const cmp=(a,b)=>a.localeCompare(b);
/**
 * @param {Object} input
 *  familyScope: source/publisher/series/methodology across many target dates.
 *  quoteRegime: immutable side/queue/horizon/limit-price cohort ID.
 *  freezeAt: all settlement labels available strictly before this time.
 *  publishedAt: when THIS fitted model actually became available.
 *  rows: one ACTUAL attempted one-lot venue order, with a unique order ID,
 *    true no-fill terminal receipt or true filled receipt, and final
 *    market-settlement availability time.
 */
export function fitBinaryOutcomeFillByDay({
 familyScope,quoteRegime,side,freezeAt,publishedAt,rows=[],
 minDaysPerOutcome=30,alpha=.05,maxBookAgeMs=60000,
}={}){
 if(!label(familyScope)||!label(quoteRegime)||!['yes','no'].includes(side)||
    !clock(freezeAt)||!clock(publishedAt)||Date.parse(publishedAt)<Date.parse(freezeAt)||
    !Number.isInteger(minDaysPerOutcome)||minDaysPerOutcome<10||minDaysPerOutcome>2000||
    !finite(alpha)||alpha<=0||alpha>=.5||
    !Number.isSafeInteger(maxBookAgeMs)||maxBookAgeMs<1||maxBookAgeMs>3600_000||
    !Array.isArray(rows)||rows.length>100000)
  throw new TypeError('bounded source-family, quote-regime, calibration cutoff and published model time required');
 const cutoff=Date.parse(freezeAt);
 const orderIds=new Set(),eventResults=new Map(),grouped=new Map();
 const accepted=[];
 for(const r of rows){
  if(!r||!label(r.venueOrderId)||orderIds.has(r.venueOrderId)||
     r.familyScope!==familyScope||r.quoteRegime!==quoteRegime||r.side!==side||
     !label(r.eventId)||!label(r.marketId)||!day(r.targetDate)||
     !['yes','no'].includes(r.settlementSide)||r.settlementStatus!=='finalized'||
     typeof r.filled!=='boolean'||r.attemptedContracts!==1||
     r.filledContracts!==(r.filled?1:0)||
     !label(r.executionReceiptId)||!label(r.settlementReceiptId)||
     !Array.isArray(r.evidenceIds)||!r.evidenceIds.length||
     r.evidenceIds.some(id=>!label(id))||
     !clock(r.bookReceivedAt)||!clock(r.placedAt)||!clock(r.terminalAt)||
     !clock(r.settledAt)||!clock(r.settlementAvailableAt))
   throw new TypeError('one distinct, source-matched actual order and final settlement receipt required');
  const bt=Date.parse(r.bookReceivedAt),placed=Date.parse(r.placedAt);
  const terminal=Date.parse(r.terminalAt),settled=Date.parse(r.settledAt);
  const available=Date.parse(r.settlementAvailableAt);
  if(bt>placed||placed-bt>maxBookAgeMs||placed>=terminal||terminal>settled||settled>available||
     available>=cutoff||placed>=settled)
   throw new RangeError('lookahead, missing terminal custody or unsettled training data refused');
  if(r.filled&&(!clock(r.fillReceivedAt)||Date.parse(r.fillReceivedAt)<placed||
      Date.parse(r.fillReceivedAt)>terminal))
   throw new RangeError('filled order needs a real order-bounded fill receipt');
  if(!r.filled&&r.fillReceivedAt!==undefined&&r.fillReceivedAt!==null)
   throw new RangeError('unfilled terminal order cannot carry a fill receipt');
  orderIds.add(r.venueOrderId);
  const eventKey=r.eventId+'|'+r.marketId+'|'+r.targetDate;
  const earlier=eventResults.get(eventKey);
  if(earlier!==undefined&&earlier!==r.settlementSide)
   throw new RangeError('contradictory market settlement receipts cannot train a hazard');
  eventResults.set(eventKey,r.settlementSide);
  const won=r.settlementSide===side;
  const key=(won?'win':'loss')+'|'+r.targetDate;
  const bucket=grouped.get(key)??{date:r.targetDate,won,n:0,fills:0,events:new Set()};
  bucket.n++;bucket.fills+=Number(r.filled);bucket.events.add(eventKey);
  grouped.set(key,bucket);
  accepted.push({
   venueOrderId:r.venueOrderId,
   eventId:r.eventId,marketId:r.marketId,settlementDay:r.targetDate,
   won,filled:r.filled,attemptedContracts:r.attemptedContracts,
   filledContracts:r.filledContracts,settlementAvailableAt:r.settlementAvailableAt,
   evidenceIds:[...r.evidenceIds],executionReceiptId:r.executionReceiptId,
   settlementReceiptId:r.settlementReceiptId,
  });
 }
 const groups=[...grouped.values()].sort((a,b)=>cmp(a.date,b.date)||Number(b.won)-Number(a.won));
 const byOutcome=(won)=>groups.filter(x=>x.won===won);
 const sums=groups.map(g=>({date:g.date,won:g.won,
   distinctMarkets:g.events.size,attempts:g.n,fills:g.fills,
   dailyFillFraction:g.fills/g.n}));
 const summarize=(won)=>{
  const p=byOutcome(won),count=p.length;
  if(!count)return {days:0,attempts:0,mean:null,interval:null};
  const mean=p.reduce((s,g)=>s+g.fills/g.n,0)/count;
  const radius=Math.sqrt(Math.log(4/alpha)/(2*count));
  return {days:count,attempts:p.reduce((s,g)=>s+g.n,0),mean,
   interval:{low:cap(mean-radius),high:cap(mean+radius)},
   halfWidthBeforeClipping:radius};
 };
 const win=summarize(true),loss=summarize(false);
 const ready=win.days>=minDaysPerOutcome&&loss.days>=minDaysPerOutcome;
 const provenance=accepted.sort((a,b)=>cmp(a.venueOrderId,b.venueOrderId));
 const modelId=hashPosition({
  kind:'outcome-conditioned-day-block-fill-fit-v1',
  familyScope,quoteRegime,side,freezeAt,publishedAt,maxBookAgeMs,
  alpha,minDaysPerOutcome,
  // Semantic training identity MUST commit the received value, not merely
  // reused receipt identifiers. Different wins, fills or hyperparameters
  // cannot share one content address or masquerade as the old calibration.
  sourceOrders:provenance.map(x=>[x.venueOrderId,x.eventId,x.marketId,
   x.settlementDay,x.won,x.filled,x.attemptedContracts,
   x.filledContracts,x.evidenceIds.slice().sort(cmp),
   x.settlementReceiptId,x.executionReceiptId,x.settlementAvailableAt]),
 });
 return {
  kind:'outcome-conditioned-day-block-fill-fit-v1',
  id:modelId,familyScope,quoteRegime,side,freezeAt,maxBookAgeMs,
  alpha,minDaysPerOutcome,availableAt:publishedAt,
  admitted:false,status:ready?'exploratory-intervals':'insufficient-independent-outcome-days',
  modelCandidate:ready?{
   probabilityFillGivenWin:win.interval,
   probabilityFillGivenLoss:loss.interval,
  }:null,
  independentDayMinimumPerOutcome:minDaysPerOutcome,
  outcomeDayEvidence:{win,loss},
  dayStatistics:sums,
  sourceReceiptIds:provenance.flatMap(x=>[x.executionReceiptId,x.settlementReceiptId]).sort(cmp),
  sourceOrderCount:provenance.length,
  limitations:[
   'only individually identified terminal real one-lot venue orders and final settlements are admissible',
   'multiple positions or quotes within one source-local day contribute one bounded day mean',
   'Hoeffding intervals require independent stable settlement-day blocks; that assumption is unverified',
   'no model family/regime transfer, out-of-sample calibration or paid incentive/capital admission is proven',
  ],
  tradeEligible:false,orderEffect:false,
 };
}


/**
 * Strict chronological OUT-OF-SAMPLE check for an already frozen
 * outcome-conditioned fill fit, with a training-only unconditional
 * fill-rate baseline. No new source parser: each evaluation receipt
 * passes the SAME one-lot terminal-order validator as the fitter.
 *
 * The unit for uncertainty is one target settlement day. Each day
 * receives equal weight even when that day contains hundreds of orders
 * or both winning/losing market outcomes. Pair Brier differences within
 * each date before forming the exploratory one-sided confidence bound.
 *
 * This evaluates P(FILL | EVENTUAL OUTCOME) conditional on a finalized
 * outcome, i.e. a scientific adverse-selection diagnostic. The eventual
 * outcome is NOT available to the trader at quotation time: this
 * function cannot certify any executable strategy or provide ex-ante
 * fill probabilities without an independent settlement model.
 */
export function scoreBinaryOutcomeFillHoldout({
  training,rows=[],evaluatedAt,minEvaluationDays=20,alpha=.05,
}={}){
  if(!training||training.kind!=='outcome-conditioned-day-block-fill-fit-v1'||
     !label(training.id)||!label(training.familyScope)||
     !label(training.quoteRegime)||!['yes','no'].includes(training.side)||
     !clock(training.freezeAt)||!clock(training.availableAt)||
     !clock(evaluatedAt)||Date.parse(evaluatedAt)<=Date.parse(training.availableAt)||
     !Number.isInteger(minEvaluationDays)||minEvaluationDays<10||
     minEvaluationDays>2000||!finite(alpha)||alpha<=0||alpha>=.5||
     !Array.isArray(training.dayStatistics)||!training.dayStatistics.length||
     !Array.isArray(training.sourceReceiptIds)||
     !training.modelCandidate||!training.outcomeDayEvidence?.win||
     !training.outcomeDayEvidence?.loss||
     !finite(training.outcomeDayEvidence.win.mean)||
     !finite(training.outcomeDayEvidence.loss.mean)||
     !Number.isSafeInteger(training.maxBookAgeMs))
    throw new TypeError('valid frozen prior actual-order outcome-fill model and evaluation design required');
  const latestTrainingDate=[...training.dayStatistics].map(r=>r.date).sort(cmp).at(-1);
  if(!day(latestTrainingDate))throw new TypeError('training must expose verifiable source-local day support');
  const alreadyReceived=new Set(training.sourceReceiptIds);
  if(!Array.isArray(rows)||!rows.length||rows.length>100000)
    throw new TypeError('nonempty bounded actually settled holdout order receipts required');
  for(const r of rows){
    if(!r||!day(r.targetDate)||r.targetDate<=latestTrainingDate||
       !clock(r.placedAt)||Date.parse(r.placedAt)<=Date.parse(training.availableAt))
      throw new RangeError('holdout must follow frozen model issuance and all training settlement days');
    if(alreadyReceived.has(r.executionReceiptId)||
       alreadyReceived.has(r.settlementReceiptId))
      throw new RangeError('training evidence receipt reused in the held-out window');
  }
  const validated=fitBinaryOutcomeFillByDay({
    familyScope:training.familyScope,quoteRegime:training.quoteRegime,
    side:training.side,freezeAt:evaluatedAt,publishedAt:evaluatedAt,
    minDaysPerOutcome:10,alpha,maxBookAgeMs:training.maxBookAgeMs,rows,
  });
  const means=training.outcomeDayEvidence;
  const priorByDay=new Map();
  for(const r of training.dayStatistics){
    if(!day(r.date)||!Number.isSafeInteger(r.attempts)||r.attempts<1||
       !Number.isSafeInteger(r.fills)||r.fills<0||r.fills>r.attempts)
      throw new TypeError('training daily receipt counts are missing or inconsistent');
    const prior=priorByDay.get(r.date)??{attempts:0,fills:0};
    prior.attempts+=r.attempts;prior.fills+=r.fills;
    priorByDay.set(r.date,prior);
  }
  const baseline=[...priorByDay.values()].reduce((a,r)=>a+r.fills/r.attempts,0)/priorByDay.size;
  if(!finite(baseline)||baseline<0||baseline>1||
     ![means.win.mean,means.loss.mean].every(p=>finite(p)&&p>=0&&p<=1))
    throw new TypeError('fitted fill probabilities must lie in [0,1]');
  const byDay=new Map();
  for(const r of validated.dayStatistics){
    const p=r.won?means.win.mean:means.loss.mean;
    const forecastError=r.fills*(1-p)**2+(r.attempts-r.fills)*p**2;
    const baselineError=r.fills*(1-baseline)**2+
      (r.attempts-r.fills)*baseline**2;
    const old=byDay.get(r.date)??{date:r.date,attempts:0,fills:0,
      conditionalSquaredError:0,baselineSquaredError:0};
    old.attempts+=r.attempts;old.fills+=r.fills;
    old.conditionalSquaredError+=forecastError;
    old.baselineSquaredError+=baselineError;
    byDay.set(r.date,old);
  }
  const daily=[...byDay.values()].sort((a,b)=>cmp(a.date,b.date)).map(r=>{
    const conditionalBrier=r.conditionalSquaredError/r.attempts;
    const baselineBrier=r.baselineSquaredError/r.attempts;
    return {date:r.date,attempts:r.attempts,fills:r.fills,
      conditionalBrier,baselineBrier,
      pairedImprovement:baselineBrier-conditionalBrier};
  });
  const days=daily.length,average=(property)=>
    daily.reduce((sum,r)=>sum+r[property],0)/days;
  const gain=average('pairedImprovement');
  // Brier scores lie in [0,1]; paired improvement in [-1,+1],
  // hence Hoeffding one-sided radius = sqrt(2*log(1/alpha)/N).
  const radius=Math.sqrt(2*Math.log(1/alpha)/days);
  const lowerBound=gain-radius;
  const enough=days>=minEvaluationDays;
  const studyId=hashPosition({kind:'outcome-fill-holdout-brier-v1',
    trainingId:training.id,evaluationId:validated.id,
    evaluatedAt,minEvaluationDays,alpha});
  return {
    kind:'outcome-fill-holdout-brier-v1',
    id:studyId,trainingId:training.id,holdoutReceiptId:validated.id,
    familyScope:training.familyScope,quoteRegime:training.quoteRegime,
    side:training.side,trainedAvailableAt:training.availableAt,
    evaluatedAt,latestTrainingDate,
    independentHeldoutDays:days,actualHeldoutOrderCount:rows.length,
    trainingUnconditionalFillProbability:baseline,
    trainingFillGivenWin:means.win.mean,trainingFillGivenLoss:means.loss.mean,
    holdoutBrier:{
      outcomeConditioned:average('conditionalBrier'),
      unconditional:average('baselineBrier'),
      pairedImprovement:gain,
      exploratoryOneSidedLowerBound:lowerBound,
      exploratoryRadius:radius,
    },
    perDay:daily,
    status:enough?'held-out-research-screen':'insufficient-independent-evaluation-days',
    conditionallyImproved:enough&&lowerBound>0,
    limitations:[
      'test days are later than the fit freeze and contain actual terminal one-contract venue receipts',
      'Brier compares fill probabilities conditioned on eventual settlement, which cannot be observed before a trade',
      'day-block Hoeffding bound assumes stable independent days; model-family selection multiplicity is uncorrected',
      'historical fills may be selection-biased and do not establish a causal effect of changing a quote',
      'holdout forecast improvement alone never proves trading P&L or admits an automated order',
    ],
    admitted:false,tradeEligible:false,orderEffect:false,
  };
}
