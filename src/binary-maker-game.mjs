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
  // Conditioning needs positive fill mass. At a zero lower bound, retain its
  // positive-mass closure; at a zero upper bound the conditional is unidentified.
  const conditionalWinLow=fill.high===0?null:fill.low===0?(win.low===1?1:0):Math.max(0,1-(1-win.low)/fill.low);
  const conditionalWinHigh=fill.high===0?null:fill.low===0?(win.high===0?0:1):Math.min(1,win.high/fill.low);
  return {
    kind:'binary-maker-frechet-placement-v1',
    side,priceUsd,makerFeeUsdPerFill,probabilityYes:yes,
    probabilityWin:win,probabilityFill:fill,
    conditionalWinProbabilityGivenFill:{low:conditionalWinLow,high:conditionalWinHigh},
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


/**
 * A sharper, OUTCOME-CONDITIONED maker model (also read-only).
 *
 * Separate observed/estimated hazards:
 *   q1 = P(fill | purchased outcome wins)
 *   q0 = P(fill | purchased outcome loses)
 *   p  = P(purchased outcome wins)
 *
 * Then P(win AND fill)=p*q1, P(lose AND fill)=(1-p)*q0.
 * This explicitly models adverse selection rather than assuming fill ⟂ win.
 * It can be computed from a properly frozen joint outcome/fill experiment,
 * but its probability intervals are only as valid as that experiment.
 *
 * Expected per placement = (1-price-fee)*p*q1
 *                          -(price+fee)*(1-p)*q0
 *                          + reward - carry.
 * This is multilinear on the closed rectangular parameter box; sharp minima
 * and maxima are attained at vertices. Evaluate all eight corners; no
 * symmetric distribution, independence, or conditional fill prior.
 *
 * If the upper-level fill study is biased, this does NOT cure the bias or
 * promote any strategy. The result is conditional research with no order effect.
 */
export function binaryMakerOutcomeConditionedBounds({
  side,priceUsd,makerFeeUsdPerFill=0,probabilityYes,
  probabilityFillGivenWin,probabilityFillGivenLoss,
  incentiveUsdPerPlacement={low:0,high:0},carryUsdPerPlacement=0,
}={}){
  if(!['yes','no'].includes(side))throw new TypeError('binary maker side must be yes/no');
  if(!isMoney(priceUsd)||priceUsd>=1||!isMoney(makerFeeUsdPerFill)||
    !isMoney(carryUsdPerPlacement))
    throw new TypeError('finite acquired contract price, filled fee and carry required');
  const yes=probabilityBand(probabilityYes,'YES probability');
  const win=side==='yes'?yes:{low:1-yes.high,high:1-yes.low};
  const q1=probabilityBand(probabilityFillGivenWin,'fill given win');
  const q0=probabilityBand(probabilityFillGivenLoss,'fill given loss');
  const reward=moneyBand(incentiveUsdPerPlacement,'reward scenario');
  const cost=priceUsd+makerFeeUsdPerFill;
  const corners=[];
  for(const p of [win.low,win.high])for(const a of [q1.low,q1.high])for(const b of [q0.low,q0.high]){
    const winFill=p*a,loseFill=(1-p)*b,fill=winFill+loseFill;
    const gross=winFill-cost*fill;
    corners.push({winProbability:p,fillGivenWin:a,fillGivenLoss:b,
      winAndFillProbability:winFill,lossAndFillProbability:loseFill,
      fillProbability:fill,netPnlUsdPerPlacement:gross});
  }
  const lower=corners.reduce((a,b)=>b.netPnlUsdPerPlacement<a.netPnlUsdPerPlacement?b:a);
  const upper=corners.reduce((a,b)=>b.netPnlUsdPerPlacement>a.netPnlUsdPerPlacement?b:a);
  const fillRange=corners.map(c=>c.fillProbability);
  return {
    kind:'binary-maker-outcome-conditioned-placement-v1',
    side,priceUsd,makerFeeUsdPerFill,probabilityYes:yes,probabilityWin:win,
    probabilityFillGivenWin:q1,probabilityFillGivenLoss:q0,
    probabilityFill:{low:Math.min(...fillRange),high:Math.max(...fillRange)},
    conditionalPnlUsdPerPlacement:{
      low:lower.netPnlUsdPerPlacement+reward.low-carryUsdPerPlacement,
      high:upper.netPnlUsdPerPlacement+reward.high-carryUsdPerPlacement,
    },
    worstCaseCoupling:lower,bestCaseCoupling:upper,
    rewardScenarioUsdPerPlacement:reward,carryUsdPerPlacement,
    conditionallyPositive:lower.netPnlUsdPerPlacement+reward.low-carryUsdPerPlacement>0,
    assumptions:[
      'conditional fill probabilities concern the exact same quote regime and holding horizon',
      'joint settlement and fill conditional rates were validly estimated on independent past events',
      'probability interval rectangle contains the true parameter vector',
      'binary $1 purchased-side payout and per-filled-order fees are accurately modeled',
      'scenario rewards are not automatically received liquidity incentives',
    ],
    tradeEligible:false,orderEffect:false,
  };
}
