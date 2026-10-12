/**
 * Compare binary prediction-market PARTICIPATION actions on the same
 * point-in-time settlement forecast. Shared market-science, NOT a venue
 * adapter, an order actuator, a new game runner or a second probability model.
 *
 * One action per research decision: take, rest, rest with potential incentive,
 * conditional all-leg structural hedge, and abstain. Maker probability-fills
 * flow through the EXISTING binary-maker-game operators; do not equate an
 * unconditional settlement probability to settlement conditional on fills.
 *
 * All numbers are USD EXPECTED P&L PER ATTEMPT, not per observed fill.
 * Taker assumes one lot executes at the sampled price (explicit upper-level
 * assumption); structural hedge requires a valid joint-fill/partial-loss
 * model or stays unranked. LIP does NOT contribute guaranteed money.
 *
 * No source authority, empirical model admission, capital custody, account
 * balances, live orderbooks, active incentives or remote calls live here.
 */
import {
  binaryMakerPlacementBounds,binaryMakerOutcomeConditionedBounds,
} from './binary-maker-game.mjs';
const finite=(x)=>typeof x==='number'&&Number.isFinite(x);
const nonneg=(x)=>finite(x)&&x>=0;
const time=(x)=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const name=(x)=>typeof x==='string'&&x.trim().length>0;
const prob=(x)=>finite(x)&&x>=0&&x<=1;
function band(x,label){
 if(!x||!prob(x.low)||!prob(x.high)||x.low>x.high)
  throw new TypeError(label+' must be bounded in [0,1]');
 return {low:x.low,high:x.high};
}
function stamp(e,scope,at,label){
 if(!e||!name(e.id)||e.scope!==scope||!time(e.availableAt)||
    Date.parse(e.availableAt)>Date.parse(at)||!Array.isArray(e.evidenceIds)||
    !e.evidenceIds.length||e.evidenceIds.some(x=>!name(x)))
  throw new TypeError(label+' needs exact scope and before-decision evidence');
}
function observation(row,now,maxAgeMs){
 if(!time(row?.quoteObservedAt)||Date.parse(row.quoteObservedAt)>now||
    now-Date.parse(row.quoteObservedAt)>maxAgeMs)
  throw new TypeError('quote requires a fresh original order-book receipt');
 if(row.closeAt!==undefined&&(!time(row.closeAt)||Date.parse(row.closeAt)<=now))
  throw new TypeError('quote is after venue close');
 if(!['yes','no'].includes(row.side)||!name(row.id)||!nonneg(row.priceUsd)||
    row.priceUsd<=0||row.priceUsd>=1||!nonneg(row.feeUsd))
  throw new TypeError('valid binary side, purchased-side price and exact venue fee required');
}
const purchased=(side,yes)=>side==='yes'?yes:{low:1-yes.high,high:1-yes.low};
const nontrade=()=>({tradeEligible:false,orderEffect:false});

/**
 * @param {{
 *  at:string,scope:string,settlementProbabilityYes:{low:number,high:number},
 *  settlementEvidence:{id,scope,availableAt,evidenceIds:string[]},
 *  takerCandidates?: object[],makerCandidates?:object[],
 *  structuralCandidates?:object[],maxQuoteAgeMs?:number
 * }} options
 */
export function compareBinaryParticipationMenu({
 at,scope,settlementProbabilityYes,settlementEvidence,
 takerCandidates=[],makerCandidates=[],structuralCandidates=[],
 maxQuoteAgeMs=60000,
}={}){
 if(!time(at)||!name(scope)||!Number.isSafeInteger(maxQuoteAgeMs)||
    maxQuoteAgeMs<1||maxQuoteAgeMs>3600_000||
    ![takerCandidates,makerCandidates,structuralCandidates].every(Array.isArray)||
    takerCandidates.length>256||makerCandidates.length>256||
    structuralCandidates.length>256)
  throw new TypeError('bounded point-in-time, source-scoped participation menu required');
 stamp(settlementEvidence,scope,at,'settlement probability');
 const yes=band(settlementProbabilityYes,'settlement probability');
 const now=Date.parse(at),rows=[],gaps=[],seen=new Set();
 function candidateId(row,kind){
  if(!name(row?.id)||seen.has(row.id)||row.id==='abstain')
   throw new TypeError('unique non-abstain candidate ID required');
  seen.add(row.id);return row.id;
 }
 function keepGap(id,kind,reason){gaps.push({id,kind,reason});}
 for(const row of takerCandidates){
  const id=candidateId(row,'taker');
  try{
   observation(row,now,maxQuoteAgeMs);
   if(!finite(row.depthContracts)||row.depthContracts<1)
    throw new TypeError('one executable lot of book depth required');
   const win=purchased(row.side,yes);
   const low=win.low-row.priceUsd-row.feeUsd-(row.carryUsd??0);
   const high=win.high-row.priceUsd-row.feeUsd-(row.carryUsd??0);
   if(!nonneg(row.carryUsd??0))throw new TypeError('bounded per-attempt carry required');
   rows.push({id,kind:'taker',scope,side:row.side,
    observedAt:row.quoteObservedAt,sourceModelId:settlementEvidence.id,
    expectedPnlUsdPerAttempt:{low,high},
    limits:['assumes the full one-lot taker executes immediately at observed price and depth',
      'post-observation quote change, latency and settlement-source revisions are not modeled'],
    ...nontrade()});
  }catch(e){keepGap(id,'taker',e.message);}
 }
 for(const row of makerCandidates){
  const id=candidateId(row,'maker');
  try{
   observation(row,now,maxQuoteAgeMs);
   stamp(row.fillEvidence,scope,at,'fill model');
   if(row.incentiveScenario!==undefined&&
      (!row.incentiveScenario||!nonneg(row.incentiveScenario.low)||
      !nonneg(row.incentiveScenario.high)||row.incentiveScenario.low>row.incentiveScenario.high))
    throw new TypeError('optional incentive scenario must be a nonnegative interval');
   // No credited LIP payment or eligible-snapshot proof is inferred from an
   // incentive scenario: its whole interval is an unadmitted what-if.
   const param={
    side:row.side,priceUsd:row.priceUsd,
    makerFeeUsdPerFill:row.feeUsd,
    probabilityYes:yes,carryUsdPerPlacement:row.carryUsd??0,
   };
   let score;
   if(row.fillEvidence.kind==='outcome-conditioned'){
    if(!row.probabilityFillGivenWin||!row.probabilityFillGivenLoss)
     throw new TypeError('outcome-conditioned fill model needs BOTH hazard bands');
    score=binaryMakerOutcomeConditionedBounds({
     ...param,probabilityFillGivenWin:row.probabilityFillGivenWin,
     probabilityFillGivenLoss:row.probabilityFillGivenLoss});
   }else if(row.fillEvidence.kind==='marginal'){
    score=binaryMakerPlacementBounds({...param,probabilityFill:row.probabilityFill});
   }else throw new TypeError('recognized marginal or outcome-conditioned fill model required');
   rows.push({id,kind:row.incentiveScenario?'incentive-maker':'maker',
    scope,side:row.side,observedAt:row.quoteObservedAt,
    fillModelId:row.fillEvidence.id,sourceModelId:settlementEvidence.id,
    expectedPnlUsdPerAttempt:score.conditionalPnlUsdPerPlacement,
    hypotheticalIncentiveUsdPerAttempt:row.incentiveScenario??null,
    // LIP = zero until a period-wide credited source is separately proven.
    rewardAlreadyIncludedUsd:0,
    details:score,...nontrade()});
  }catch(e){keepGap(id,'maker',e.message);}
 }
 for(const row of structuralCandidates){
  const id=candidateId(row,'structural');
  try{
   if(!nonneg(row.allLegsGuaranteedPnlUsd))
    throw new TypeError('existing coherence fee/depth-qualified guaranteed all-fill P&L required');
   if(row.allLegsFillModel===undefined){
    keepGap(id,'structural','no joint leg-execution/partial-fill model; guarantee holds only when all legs fill');
    continue;
   }
   stamp(row.allLegsFillModel,scope,at,'joint structural execution');
   const mass=band(row.allLegsFillProbability,'all-leg fill probability');
   if(!nonneg(row.maxPartialExecutionLossUsd)||!nonneg(row.carryUsd??0))
    throw new TypeError('finite worst partial-fill loss and carry required');
   // A partial execution may occur in ANY non-all-filled state.
   // If all legs fill, profit >= G. Otherwise profit >= -M.
   // The sharp worst-case bound under these two assumptions is attained
   // at f=mass.low when G,M>=0.
   const low=mass.low*row.allLegsGuaranteedPnlUsd-
     (1-mass.low)*row.maxPartialExecutionLossUsd-row.carryUsd;
   rows.push({id,kind:'structural-hedge',scope,side:null,
    observedAt:at,sourceModelId:settlementEvidence.id,
    executionModelId:row.allLegsFillModel.id,
    expectedPnlUsdPerAttempt:{low,high:null},
    conditionalGuaranteedAllFilledUsd:row.allLegsGuaranteedPnlUsd,
    maxPartialExecutionLossUsd:row.maxPartialExecutionLossUsd,
    allLegsFillProbability:mass,
    limits:['all-leg payoff guarantee is valid only if every hedge leg settles according to named rules',
      'unmodeled changed books, partial-execution losses or settlement disagreements invalidate this lower bound'],
    ...nontrade()});
  }catch(e){keepGap(id,'structural',e.message);}
 }
 // Every candidate is a conditional research case. Abstention is always
 // available, dominates a non-positive pessimistic P&L, and costs zero.
 const ranked=[...rows].sort((a,b)=>
  b.expectedPnlUsdPerAttempt.low-a.expectedPnlUsdPerAttempt.low||
  a.id.localeCompare(b.id));
 const top=ranked[0];
 return {kind:'binary-prediction-market-participation-menu-v1',
  at,scope,settlementEvidenceId:settlementEvidence.id,
  decision:top&&top.expectedPnlUsdPerAttempt.low>0?
    {action:'conditional-candidate',id:top.id,kind:top.kind,
      lowerExpectedUsdPerAttempt:top.expectedPnlUsdPerAttempt.low}:
    {action:'abstain',id:'abstain',kind:'abstain',lowerExpectedUsdPerAttempt:0},
  candidates:ranked,gaps,abstainExpectedUsdPerAttempt:0,
  limits:['positive lower P&L is conditional on evidence bands and fills, not an admission to live trading',
   'joint multi-order maker inventory risk remains outside one-lot comparisons',
   'source-received time, quote age, fee, future settlement and opponent adaptation remain distinct'],
  ...nontrade()};
}
