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
 minDaysPerOutcome=30,alpha=.05,
}={}){
 if(!label(familyScope)||!label(quoteRegime)||!['yes','no'].includes(side)||
    !clock(freezeAt)||!clock(publishedAt)||Date.parse(publishedAt)<Date.parse(freezeAt)||
    !Number.isInteger(minDaysPerOutcome)||minDaysPerOutcome<10||minDaysPerOutcome>2000||
    !finite(alpha)||alpha<=0||alpha>=.5||
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
     typeof r.filled!=='boolean'||
     !label(r.executionReceiptId)||!label(r.settlementReceiptId)||
     !Array.isArray(r.evidenceIds)||!r.evidenceIds.length||
     r.evidenceIds.some(id=>!label(id))||
     !clock(r.bookReceivedAt)||!clock(r.placedAt)||!clock(r.terminalAt)||
     !clock(r.settledAt)||!clock(r.settlementAvailableAt))
   throw new TypeError('one distinct, source-matched actual order and final settlement receipt required');
  const bt=Date.parse(r.bookReceivedAt),placed=Date.parse(r.placedAt);
  const terminal=Date.parse(r.terminalAt),settled=Date.parse(r.settledAt);
  const available=Date.parse(r.settlementAvailableAt);
  if(bt>placed||placed>=terminal||terminal>available||settled>available||
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
   won,filled:r.filled,settlementAvailableAt:r.settlementAvailableAt,
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
  familyScope,quoteRegime,side,freezeAt,publishedAt,
  sourceOrders:provenance.map(x=>[x.venueOrderId,x.settlementReceiptId,
   x.executionReceiptId,x.settlementAvailableAt]),
 });
 return {
  kind:'outcome-conditioned-day-block-fill-fit-v1',
  id:modelId,familyScope,quoteRegime,side,freezeAt,
  availableAt:publishedAt,
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
