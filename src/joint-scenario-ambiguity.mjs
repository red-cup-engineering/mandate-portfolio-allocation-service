/**
 * Distributionally robust evaluation on the EXISTING finite joint market-game
 * scenario law. No independent per-venue probabilities or new scenario carrier.
 *
 * A total-variation ball around the supplied joint prior represents an ASSUMED
 * calibration/model ambiguity, not a confidence guarantee obtained by code.
 * Its radius and pre-decision evidence must be supplied by the caller.
 *
 * For a fixed payoff U(a,s), minimize/maximize sum_s q(s)U(a,s) subject to
 * q being a simplex and TV(q,p) <= radius. A greedy transfer from maximal
 * payoff states to minimal ones (reversed for the maximum) is exact because
 * each transferred unit costs the same TV budget.
 *
 * Minimax regret uses max_b max_q E_q[U(b,s)-U(a,s)], with ONE q over the
 * SAME scenarios for every pair. Its adversarial comparator is a fixed
 * feasible action, not a clairvoyant choice of a separate action per state.
 * This is a mathematical conditional evaluation, NOT an admitted order.
 */

const named=x=>typeof x==='string'&&x.trim().length>0;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const instant=x=>typeof x==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&
  Number.isFinite(Date.parse(x));
const MAX_PAYOFF_USD=1e12;
const massTolerance=1e-9;

const sum=xs=>{
  let total=0,compensation=0;
  for(const x of xs){
    const corrected=x-compensation;
    const next=total+corrected;
    compensation=(next-total)-corrected;
    total=next;
  }
  return total;
};
const expected=(p,payoffs)=>sum(p.map((x,i)=>x*payoffs[i]));

/**
 * Exact finite-simplex linear optimization over a total-variation ball.
 * Transfers never introduce a new state or leave the supplied joint support.
 * A zero-probability world can receive mass: ambiguity is in the law, not
 * in an invented empirical observation.
 */
function extremize(p,payoffs,radius,minimize){
  const indices=p.map((_,i)=>i);
  const donors=[...indices].sort((a,b)=>
    (minimize?payoffs[b]-payoffs[a]:payoffs[a]-payoffs[b])||a-b);
  const recipients=[...indices].sort((a,b)=>
    (minimize?payoffs[a]-payoffs[b]:payoffs[b]-payoffs[a])||a-b);

  // DO NOT mutate q[d] and q[r] at each transfer. When a high-payoff state
  // has probability 1e-20 and the low-payoff recipient is already near 0.6,
  // q[r]+1e-20 === q[r] in binary64. The previous loop interpreted that
  // one unrepresentable addition as a reason to abandon ALL later donor
  // states, producing a severely wrong robust financial value.
  //
  // Accumulate the transfer on separate, initially-zero in/out accounts.
  // Even transfers too small to change a recipient's large base probability
  // do not prevent the next, economically meaningful donor being processed.
  // These are numerical ledgers over ONE simplex, not venue cash ledgers.
  const inflow=p.map(()=>0),outflow=p.map(()=>0);
  let di=0,ri=0,remaining=radius;
  while(remaining>0&&di<indices.length&&ri<indices.length){
    const d=donors[di],r=recipients[ri];
    if(minimize?payoffs[d]<=payoffs[r]:payoffs[d]>=payoffs[r])break;
    const available=p[d]-outflow[d];
    const capacity=(1-p[r])-inflow[r];
    if(available<=0){di++;continue;}
    if(capacity<=0){ri++;continue;}
    const amount=Math.min(remaining,available,capacity);
    if(amount<=0)break;
    outflow[d]+=amount;
    inflow[r]+=amount;
    remaining-=amount;
    if(outflow[d]>=p[d])di++;
    if(inflow[r]>=1-p[r])ri++;
  }
  const q=p.map((probability,i)=>probability+inflow[i]-outflow[i]);
  return {
    expectedUsd:expected(q,payoffs),
    probabilities:q,
    usedTotalVariation:sum(q.map((x,i)=>Math.abs(x-p[i])))/2,
  };
}

/**
 * One coherent downside-risk reading over the SAME joint worlds: upper-tail
 * expected shortfall of loss = -net payoff. Positive means a loss; negative
 * means the worst selected fraction of worlds still earns money.
 *
 * Fraction τ refers to probability MASS (not a number of scenario rows).
 * Partial inclusion of the boundary world makes the finite calculation
 * invariant under scenario refinement and permutations. There is no
 * independent Kalshi/Alpaca/GMX marginal tail law here.
 */
function expectedShortfallOfLoss(probabilities,payoffs,tailFraction){
  const weighted=payoffs.map((payoff,i)=>({
    probability:probabilities[i],loss:-payoff,i,
  })).sort((a,b)=>b.loss-a.loss||a.i-b.i);
  const total=sum(probabilities),target=tailFraction*total;
  if(!(total>0)||!(target>0))throw new RangeError('tail-risk probability mass not positive');
  let remaining=target;
  const terms=[];
  for(const w of weighted){
    if(remaining<=0)break;
    const taken=Math.min(remaining,w.probability);
    terms.push(taken*w.loss);
    remaining-=taken;
  }
  if(remaining>1e-12)throw new RangeError('incomplete joint probability mass for downside tail');
  return sum(terms)/target;
}

/**
 * actions reuse the same fixed menu as market-information-value:
 * [{id, payoffsUsdByScenario:{scenarioId:finiteUsd}}].
 *
 * ambiguity = {conditionedOnForecastId, observedAt, availableAt,
 *              evidenceIds:[...], totalVariationRadius:[0,1],
 *              tailFraction?:[1e-6,1]}.
 * Independent receiving must establish that this radius is empirically
 * warranted; the operator only proves what follows if it is.
 */
export function evaluateJointScenarioAmbiguity({forecast,actions,ambiguity,at}={}){
  if(!instant(at)||!named(forecast?.id)||!instant(forecast?.observedAt)||
    (forecast.availableAt!==undefined&&!instant(forecast.availableAt))||
    !instant(forecast.horizon)||
    Date.parse(forecast.observedAt)>Date.parse(forecast.availableAt??forecast.observedAt)||
    Date.parse(forecast.availableAt??forecast.observedAt)>Date.parse(at)||
    Date.parse(at)>=Date.parse(forecast.horizon)||
    !Array.isArray(forecast.evidenceIds)||!forecast.evidenceIds.length||
    forecast.evidenceIds.some(id=>!named(id))||
    !Array.isArray(forecast.scenarios)||
    forecast.scenarios.length<2||forecast.scenarios.length>512)
    throw new TypeError('received, bounded, point-in-time joint forecast required');
  if(!ambiguity||ambiguity.conditionedOnForecastId!==forecast.id||
    !instant(ambiguity.observedAt)||!instant(ambiguity.availableAt)||
    Date.parse(ambiguity.observedAt)>Date.parse(ambiguity.availableAt)||
    Date.parse(ambiguity.availableAt)>Date.parse(at)||
    !Array.isArray(ambiguity.evidenceIds)||!ambiguity.evidenceIds.length||
    ambiguity.evidenceIds.some(id=>!named(id))||
    new Set(ambiguity.evidenceIds).size!==ambiguity.evidenceIds.length||
    !finite(ambiguity.totalVariationRadius)||
    ambiguity.totalVariationRadius<0||ambiguity.totalVariationRadius>1||
    (ambiguity.tailFraction!==undefined&&
      (!finite(ambiguity.tailFraction)||
        ambiguity.tailFraction<1e-6||ambiguity.tailFraction>1)))
    throw new TypeError('pre-decision, source-linked TV radius and bounded optional downside tail fraction required');
  if(!Array.isArray(actions)||actions.length<1||actions.length>64)
    throw new TypeError('bounded, fixed candidate action menu required');

  const scenarioIds=new Set(),scenarios=[];
  for(const s of forecast.scenarios){
    if(!named(s?.id)||scenarioIds.has(s.id)||!finite(s.probability)||
      s.probability<0||s.probability>1)
      throw new TypeError('unique finite joint scenario probabilities required');
    scenarioIds.add(s.id);scenarios.push(s);
  }
  const p=scenarios.map(s=>s.probability);
  if(Math.abs(sum(p)-1)>massTolerance)
    throw new RangeError('scenario probability mass must equal one');
  const ids=[...scenarioIds];
  const actionIds=new Set(),menu=[];
  for(const a of actions){
    if(!named(a?.id)||actionIds.has(a.id)||
      !a.payoffsUsdByScenario||
      typeof a.payoffsUsdByScenario!=='object'||
      Array.isArray(a.payoffsUsdByScenario)||
      Object.keys(a.payoffsUsdByScenario).length!==scenarios.length||
      !ids.every(id=>Object.hasOwn(a.payoffsUsdByScenario,id) &&
        finite(a.payoffsUsdByScenario[id]) &&
        Math.abs(a.payoffsUsdByScenario[id])<=MAX_PAYOFF_USD))
      throw new TypeError('complete bounded action payoffs over exactly the joint scenario IDs required');
    actionIds.add(a.id);
    menu.push({id:a.id,payoffs:ids.map(id=>a.payoffsUsdByScenario[id])});
  }
  const abstain=menu.find(a=>a.id==='abstain');
  if(!abstain||abstain.payoffs.some(x=>x!==0))
    throw new TypeError('exact zero-payoff abstention must be a real feasible action');

  const radius=ambiguity.totalVariationRadius;
  const hasTail=ambiguity.tailFraction!==undefined;
  const tailFraction=ambiguity.tailFraction;
  const rows=menu.map(a=>{
    const low=extremize(p,a.payoffs,radius,true);
    const high=extremize(p,a.payoffs,radius,false);
    const regret=Math.max(0,...menu.map(b=>
      extremize(p,b.payoffs.map((v,i)=>v-a.payoffs[i]),radius,false).expectedUsd));
    return {
      id:a.id,
      nominalExpectedUsd:expected(p,a.payoffs),
      worstCaseExpectedUsd:low.expectedUsd,
      bestCaseExpectedUsd:high.expectedUsd,
      worstCaseRegretUsd:regret,
      ...(hasTail?{
        nominalExpectedShortfallUsd:expectedShortfallOfLoss(p,a.payoffs,tailFraction),
        // The lower-payoff TV transport is the same globally worst LOSS
        // distribution for every increasing loss transform. Consequently
        // it also maximizes the tail loss under this fixed ambiguity ball.
        worstCaseExpectedShortfallUsd:expectedShortfallOfLoss(
          low.probabilities,a.payoffs,tailFraction),
      }:{}),
      // An independently receiving agent can check that the optimizer
      // respected this EXACT joint law and the declared ambiguity radius.
      worstCaseScenarioProbabilities:ids.map((id,i)=>[id,low.probabilities[i]]),
      bestCaseScenarioProbabilities:ids.map((id,i)=>[id,high.probabilities[i]]),
      worstCaseUsedTotalVariation:low.usedTotalVariation,
      bestCaseUsedTotalVariation:high.usedTotalVariation,
    };
  });
  const byWorst=[...rows].sort((a,b)=>b.worstCaseExpectedUsd-a.worstCaseExpectedUsd||
    a.id.localeCompare(b.id));
  const byRegret=[...rows].sort((a,b)=>a.worstCaseRegretUsd-b.worstCaseRegretUsd||
    b.worstCaseExpectedUsd-a.worstCaseExpectedUsd||a.id.localeCompare(b.id));
  const byTail=hasTail?[...rows].sort((a,b)=>
    a.worstCaseExpectedShortfallUsd-b.worstCaseExpectedShortfallUsd||
    b.worstCaseExpectedUsd-a.worstCaseExpectedUsd||a.id.localeCompare(b.id)):null;
  return Object.freeze({
    kind:'joint-scenario-conditional-ambiguity-evaluation-v1',
    forecastId:forecast.id,at,
    forecastEvidenceIds:[...forecast.evidenceIds],
    ambiguityEvidenceIds:[...ambiguity.evidenceIds],
    assumedTotalVariationRadius:radius,
    nominalScenarioProbabilities:ids.map((id,i)=>[id,p[i]]),
    actionEvaluations:rows,
    maximinExpectedPayoffAction:byWorst[0].id,
    minimaxRegretAction:byRegret[0].id,
    ...(hasTail?{
      tailFraction,
      minWorstExpectedShortfallAction:byTail[0].id,
      tailRiskInterpretation:'upper-tail expected loss over the same finite joint law and assumed TV ball; preference is conditional, not calibrated',
    }:{}),
    interpretation:'conditional total-variation robustness over the original finite joint scenarios',
    radiusEmpiricallyVerified:false,
    sourceAuthenticated:false,
    tradeEligible:false,orderEffect:false,
  });
}
