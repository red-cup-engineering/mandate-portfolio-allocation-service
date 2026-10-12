/**
 * Finite joint-scenario Bayes conditioning used by BOTH the market game's
 * existing numerical/bin feature observation and EVSI's categorical receipt.
 *
 * This is the shared mathematical kernel, not a second forecast or evidence
 * carrier. Callers qualify real observed bytes, model/source/calibration
 * lineage and issuance time. Weights are updated together across ALL outcomes.
 * Log-sum-exp handles rare observations without spurious floating underflow.
 */
export function conditionJointScenarioWeights({scenarios, likelihoodByScenario}={}) {
  if (!Array.isArray(scenarios) || scenarios.length < 2 ||
      scenarios.length > 512 || !likelihoodByScenario ||
      typeof likelihoodByScenario !== 'object' ||
      Array.isArray(likelihoodByScenario))
    throw new TypeError('bounded joint scenario prior and likelihood required');
  const ids=new Set();
  let total=0;
  for(const s of scenarios){
    if(typeof s?.id !== 'string' || !s.id || ids.has(s.id) ||
       typeof s.probability !== 'number' || !Number.isFinite(s.probability) ||
       s.probability < 0 || s.probability > 1)
      throw new TypeError('unique normalized scenarios required');
    ids.add(s.id); total+=s.probability;
  }
  if(Math.abs(total-1)>1e-9)
    throw new RangeError('scenario mass must equal one');
  if(Object.keys(likelihoodByScenario).length!==ids.size ||
     Object.keys(likelihoodByScenario).some(id=>!ids.has(id)))
    throw new TypeError('likelihood must bind exactly the predeclared scenario set');
  const logs=scenarios.map(s=>{
    const l=likelihoodByScenario[s.id];
    if(typeof l!=='number' || !Number.isFinite(l) || l<0 || l>1)
      throw new TypeError('conditional emission probability must be in [0,1]');
    return s.probability>0 && l>0 ?
      Math.log(s.probability)+Math.log(l) : -Infinity;
  });
  const peak=Math.max(...logs);
  if(peak===-Infinity) return {
    status:'observation-impossible-under-model',
    probabilities:null,logObservationLikelihood:-Infinity,
    observationProbability:0,divergenceNats:null,
  };
  const scaled=logs.map(x=>x===-Infinity?0:Math.exp(x-peak));
  const normalizer=scaled.reduce((sum,x)=>sum+x,0);
  const probabilities=scaled.map(x=>x/normalizer);
  const logObservationLikelihood=peak+Math.log(normalizer);
  const divergenceNats=probabilities.reduce((sum,q,i)=>
    q===0?sum:sum+q*(Math.log(q)-Math.log(scenarios[i].probability)),0);
  return {
    status:'conditioned',
    probabilities,logObservationLikelihood,
    observationProbability:Math.exp(logObservationLikelihood),
    divergenceNats:Math.max(0,divergenceNats),
  };
}
