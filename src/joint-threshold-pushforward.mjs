/**
 * Push one existing finite JOINT market-game scenario distribution through
 * multiple nested threshold predicates. Venue-neutral: official settlement
 * source, comparison/rounding transform and contract semantics are qualified
 * by each consuming venue adapter, never guessed here.
 *
 * One underlying random variable X yields nested events (X > k_i), etc.
 * Every threshold is priced from the SAME joint model, and pairwise
 * covariance is derived from their exact joint event masses. Independent
 * per-rung Bernoulli forecasts would erase this structure.
 */
const named=x=>typeof x==='string'&&x.trim().length>0;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const instant=x=>typeof x==='string'&&
 /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&
 Number.isFinite(Date.parse(x));
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const laws=Object.freeze({
 '>':(x,k)=>x>k,
 '>=':(x,k)=>x>=k,
 '<':(x,k)=>x<k,
 '<=':(x,k)=>x<=k,
});
const increasing=comparator=>comparator==='<'||comparator==='<=';

/**
 * forecast is the SAME shared market-game carrier used by the portfolio
 * engine and market-information-value. thresholds are a list of named binary
 * propositions over one declared scalar scenario value.
 *
 * The exact-rule reporter/publisher, target variables, units, local-date
 * cutoffs, strict comparator, and reporting transformation belong to the
 * venue-specific caller. This pure operator does not grade any settlement.
 */
export function projectJointThresholdScenarios({
 forecast,outcomeValueKey,thresholds,comparator='>',at,
}={}){
 if(!forecast||!named(forecast.id)||!named(outcomeValueKey)||
    !instant(at)||!instant(forecast.observedAt)||
    (forecast.availableAt!==undefined&&!instant(forecast.availableAt))||
    !instant(forecast.horizon)||
    Date.parse(forecast.observedAt)>Date.parse(at)||
    Date.parse(forecast.availableAt??forecast.observedAt)>Date.parse(at)||
    Date.parse(forecast.horizon)<=Date.parse(at)||
    !Array.isArray(forecast.evidenceIds)||!forecast.evidenceIds.length||
    !Object.hasOwn(laws,comparator)||
    !Array.isArray(thresholds)||thresholds.length<1||thresholds.length>128||
    !Array.isArray(forecast.scenarios)||forecast.scenarios.length<2||
    forecast.scenarios.length>512)
  throw new TypeError('bounded time-qualified shared scalar scenarios and threshold family required');
 const seen=new Set(),scenarios=[],thresholdIds=new Set();
 let total=0;
 for(const s of forecast.scenarios){
  if(!named(s?.id)||seen.has(s.id)||!finite(s.probability)||
     s.probability<0||s.probability>1||
     !finite(s.values?.[outcomeValueKey]))
   throw new TypeError('unique weighted scenarios with one finite shared underlying target required');
  seen.add(s.id);total+=s.probability;
  scenarios.push({value:s.values[outcomeValueKey],probability:s.probability});
 }
 if(Math.abs(total-1)>1e-9)
  throw new RangeError('shared scenario probability mass must equal one');
 for(const t of thresholds){
  if(!named(t?.id)||thresholdIds.has(t.id)||!finite(t.threshold))
   throw new TypeError('distinct binary question IDs with numeric thresholds required');
  thresholdIds.add(t.id);
 }
 const ordered=[...thresholds].sort((a,b)=>a.threshold-b.threshold||cmp(a.id,b.id));
 if(new Set(ordered.map(t=>t.threshold)).size!==ordered.length)
  throw new TypeError('one binary question per threshold in a nested family');
 const predicate=laws[comparator];
 const probabilities=ordered.map(t=>({
  id:t.id,threshold:t.threshold,
  probabilityYes:scenarios.reduce((sum,s)=>
   sum+(predicate(s.value,t.threshold)?s.probability:0),0),
 }));
 const increasingOrder=increasing(comparator);
 for(let i=1;i<probabilities.length;i++){
  if(increasingOrder
    ? probabilities[i].probabilityYes+1e-12<probabilities[i-1].probabilityYes
    : probabilities[i].probabilityYes>probabilities[i-1].probabilityYes+1e-12)
   throw new Error('joint scenario pushforward violated nested event monotonicity');
 }
 const nestedPairs=[];
 for(let i=0;i<probabilities.length;i++)
  for(let j=i;j<probabilities.length;j++){
   const a=probabilities[i],b=probabilities[j];
   const joint=increasingOrder?a.probabilityYes:b.probabilityYes;
   nestedPairs.push({
    first:a.id,second:b.id,
    jointYesProbability:joint,
    yesCovariance:joint-a.probabilityYes*b.probabilityYes,
   });
  }
 return {
  kind:'joint-scenario-nested-threshold-pushforward-v1',
  forecastId:forecast.id,at,outcomeValueKey,comparator,
  marketProbabilities:probabilities,nestedPairs,
  evidenceIds:[...forecast.evidenceIds],
  interpretation:'one conditional joint model projected to all nested binary events, not separate forecasts',
  statisticalSkill:'not independently graded by this mathematical operation',
  tradeEligible:false,orderEffect:false,
 };
}
