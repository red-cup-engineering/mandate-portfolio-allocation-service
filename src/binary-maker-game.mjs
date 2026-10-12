/**
 * Adversarial fill-selection calculus for passive binary prediction-market orders.
 *
 * The mathematical object is a joint distribution of two Bernoulli events:
 * W := "the purchased YES/NO claim wins" and F := "our passive order fills".
 * It is NOT legal to replace P(W | F) by P(W) without supporting evidence.
 *
 * For p=P(W), f=P(F), the Fréchet bounds are sharp:
 *      max(0, p + f - 1) <= P(W and F) <= min(p, f).
 *
 * For a bought contract costing c = price + fee if and ONLY if it fills,
 * E[P&L per placement] = P(W and F) - c P(F) + reward - carry.
 * The extrema over rectangular marginal uncertainty bands occur at their
 * interval endpoints or the two Fréchet kinks. No numerical optimization
 * library, probability-model duplication or exchange side effects.
 *
 * These bounds are conditional on the input uncertainty intervals actually
 * enclosing the true probabilities, on a single binary $1 payoff and on fees
 * being specified per filled contract. Any LIP incentive reward is zero by
 * DEFAULT: a program's advertised pool is not our expected or guaranteed
 * reward. Research inputs cannot create an executable quote.
 */
const isProbability=(x)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
const isMoney=(x)=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const probabilityBand=(band,label)=>{
  if(!band||!isProbability(band.low)||!isProbability(band.high)||band.low>band.high)
    throw new TypeError(label+' must be a probability interval inside [0,1]');
  return {low:band.low,high:band.high};
};
const moneyBand=(band,label)=>{
  if(!band||!isMoney(band.low)||!isMoney(band.high)||band.low>band.high)
    throw new TypeError(label+' must be a nonnegative USD interval');
  return {low:band.low,high:band.high};
};
const clamp=(x,lo,hi)=>Math.min(hi,Math.max(lo,x));

/**
 * Sharp placement P&L bounds without independence assumptions.
 *
 * side: 'yes' buys YES, 'no' buys NO (both via a resting limit order).
 * priceUsd: actual PURCHASED-side limit price, not the YES bid when side=no.
 * makerFeeUsdPerFill: actual model fee per filled contract, INCLUDING rounding,
 * supplied by the venue fee adapter (not a universal assumed Kalshi fee).
 * probabilityYes: calibrated probability interval, from a named model/source.
 * probabilityFill: empirically justified unconditional fill probability band.
 *
 * incentiveUsdPerPlacement: an explicit counterfactual scenario ONLY, not
 * silently derived from a headline incentive pool. Without a credited reward
 * witness the default range is [0,0]. Does not express marginal reward
 * eligibility, queue position or execution safety.
 */
export function binaryMakerPlacementBounds({
  side,priceUsd,makerFeeUsdPerFill=0,probabilityYes,probabilityFill,
  incentiveUsdPerPlacement={low:0,high:0},carryUsdPerPlacement=0,
}={}){
  if(!['yes','no'].includes(side))throw new TypeError('binary maker side must be yes/no');
  if(!isMoney(priceUsd)||!(priceUsd<1)||!isMoney(makerFeeUsdPerFill)||
     !isMoney(carryUsdPerPlacement))
    throw new TypeError('finite binary quote price, filled fee and carry cost required');
  const yes=probabilityBand(probabilityYes,'YES probability');
  const fill=probabilityBand(probabilityFill,'fill probability');
  const reward=moneyBand(incentiveUsdPerPlacement,'incentive scenario');
  const win=side==='yes'?yes:{low:1-yes.high,high:1-yes.low};
  const c=priceUsd+makerFeeUsdPerFill;
  const breakLower=clamp(1-win.low,fill.low,fill.high);
  const breakUpper=clamp(win.high,fill.low,fill.high);
  const candidateLower=[fill.low,fill.high,breakLower];
  const candidateUpper=[fill.low,fill.high,breakUpper];
  const pessimistic=f=>({fill:f,
    winAndFill:Math.max(0,win.low+f-1),
    pnl:Math.max(0,win.low+f-1)-c*f});
  const optimistic=f=>({fill:f,
    winAndFill:Math.min(win.high,f),
    pnl:Math.min(win.high,f)-c*f});
  const lower=candidateLower.map(pessimistic).reduce((a,b)=>b.pnl<a.pnl?b:a);
  const upper=candidateUpper.map(optimistic).reduce((a,b)=>b.pnl>a.pnl?b:a);
  return {
    kind:'binary-maker-frechet-placement-v1',
    side,priceUsd,makerFeeUsdPerFill,probabilityYes:yes,
    probabilityWin:win,probabilityFill:fill,
    conditionalPnlUsdPerPlacement:{
      low:lower.pnl+reward.low-carryUsdPerPlacement,
      high:upper.pnl+reward.high-carryUsdPerPlacement,
    },
    worstCaseCoupling:{fillProbability:lower.fill,winAndFillProbability:lower.winAndFill},
    bestCaseCoupling:{fillProbability:upper.fill,winAndFillProbability:upper.winAndFill},
    rewardScenarioUsdPerPlacement:reward,
    carryUsdPerPlacement,
    // A positive lower bound is a conditional mathematical property only;
    // inputs can be stale/unmeasured and no execution permission follows.
    conditionallyPositive:lower.pnl+reward.low-carryUsdPerPlacement>0,
    assumptions:[
      'binary payout is $1 for the purchased outcome and $0 otherwise',
      'YES and fill marginal probability intervals are valid for the same quote, window and market',
      'fill and settlement dependence is unrestricted; no conditional-independence assumption',
      'filled fee is paid only on fills and other non-reward costs are included in carry',
      'reward interval is a scenario, not implied by a program headline',
    ],
    tradeEligible:false,orderEffect:false,
  };
}

/** Compare only explicitly modeled research actions and the do-nothing policy.
 * Unknown fill probability or unsourced settlement p must NOT become a quote.
 * The minimax comparator does not issue orders, size exposure or claim alpha.
 */
export function rankBinaryMakerPlacements(candidates){
  if(!Array.isArray(candidates)||candidates.length>512)throw new TypeError('bounded research candidate set required');
  const rows=candidates.map((c,i)=>{
    if(!c||typeof c.id!=='string'||!c.id.trim())throw new TypeError('candidate identity required');
    return {id:c.id,index:i,quote:binaryMakerPlacementBounds(c),source:c.source??null};
  }).sort((a,b)=>b.quote.conditionalPnlUsdPerPlacement.low-a.quote.conditionalPnlUsdPerPlacement.low||
                     a.id.localeCompare(b.id)||a.index-b.index);
  const best=rows[0];
  return {
    kind:'minimax-binary-maker-research-v1',
    action:best&&best.quote.conditionalPnlUsdPerPlacement.low>0?'conditional-candidate':'abstain',
    bestCandidate:best?.quote.conditionalPnlUsdPerPlacement.low>0?best.id:null,
    candidates:rows,
    note:'uncalibrated or unmeasured bounds cannot grant executable authority; do not infer profit from a potential best case',
    tradeEligible:false,orderEffect:false,
  };
}
