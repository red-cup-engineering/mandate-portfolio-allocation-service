/**
 * Expected value of sample information (EVSI), reusing the finite JOINT
 * scenario law already owned by the shared market-game.
 *
 * This is a decision/observation-kernel operation, not a forecast learner,
 * bookmaker, new scenario type, agent scheduler or venue order executor.
 * Given the SAME available actions before and after a signal:
 *
 * EVSI = sum_z max_a sum_s P(s) P(z|s) U(a,s)
 *        - max_a sum_s P(s) U(a,s).
 *
 * The posterior denominators cancel when valuing a signal before buying it.
 * The observation kernel must have been learned and available BEFORE the
 * decision; otherwise the 'signal' is hindsight and must be withheld.
 *
 * A fixed action menu is essential to Blackwell monotonicity. An adaptive
 * opponent may reprice before our order can land; pass its conservative
 * loss estimate as a cost or treat this as an upper bound, not traded alpha.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clock=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const identity=x=>typeof x==='string'&&x.trim().length>0;
const simplex=x=>finite(x)&&x>=0&&x<=1;
const average=(rows)=>rows.reduce((s,x)=>s+x,0);
const tol=1e-9;

/**
 * @param {object} forecast the existing market-game forecast:
 *   {id, observedAt, scenarios:[{id,probability,...}], evidenceIds}
 * @param {object[]} actions [{id, payoffsUsdByScenario:{scenarioId:number}}]
 *   same feasible candidate action menu before/after observation.
 * @param {object} signalModel {id,availableAt,sourceEvidenceIds,signals:
 *   [{id, likelihoodByScenario:{scenarioId:p}}]}
 * @param {string} at decision issuance timestamp
 * @param {number} computeCostUsd actual economic value of cost per acquired signal
 * @param {number} repricingCostBoundUsd conservative opponent/latency penalty
 *
 * No signal observation is performed and no order is issued.
 */
export function evaluateMarketInformationValue({
 forecast,actions=[],signalModel,at,computeCostUsd=0,
 repricingCostBoundUsd=0,
}={}){
 if(!forecast||!identity(forecast.id)||!clock(forecast.observedAt)||
    !Array.isArray(forecast.scenarios)||forecast.scenarios.length<2||
    forecast.scenarios.length>512||!Array.isArray(forecast.evidenceIds)||
    !forecast.evidenceIds.length||!clock(at)||
    Date.parse(forecast.observedAt)>Date.parse(at))
   throw new TypeError('point-in-time shared joint scenario forecast required');
 if(!Array.isArray(actions)||actions.length<1||actions.length>128||
    !signalModel||!identity(signalModel.id)||!clock(signalModel.availableAt)||
    Date.parse(signalModel.availableAt)>Date.parse(at)||
    !Array.isArray(signalModel.sourceEvidenceIds)||!signalModel.sourceEvidenceIds.length||
    !Array.isArray(signalModel.signals)||signalModel.signals.length<2||
    signalModel.signals.length>128||
    !finite(computeCostUsd)||computeCostUsd<0||
    !finite(repricingCostBoundUsd)||repricingCostBoundUsd<0)
   throw new TypeError('preissued signal kernel, bounded actions and measured nonnegative costs required');
 const scenarioIds=new Set(),scenarioRows=[];
 let total=0;
 for(const s of forecast.scenarios){
  if(!identity(s?.id)||scenarioIds.has(s.id)||!simplex(s.probability))
   throw new TypeError('unique normalized shared scenarios required');
  scenarioIds.add(s.id);total+=s.probability;scenarioRows.push(s);
 }
 if(Math.abs(total-1)>tol)throw new RangeError('scenario probability mass must equal one');
 const actionsSeen=new Set(),readyActions=[];
 for(const a of actions){
  if(!identity(a?.id)||actionsSeen.has(a.id)||!a.payoffsUsdByScenario||
     Object.keys(a.payoffsUsdByScenario).length!==scenarioRows.length||
     !scenarioRows.every(s=>finite(a.payoffsUsdByScenario[s.id])))
   throw new TypeError('each distinct action needs a bounded complete payoff vector');
  actionsSeen.add(a.id);readyActions.push(a);
 }
 // "abstain" is a real available action and cannot be smuggled in as an
 // assumed free action unless the payoff is precisely zero in all states.
 if(!actionsSeen.has('abstain'))
   throw new TypeError('the exact zero-payoff abstention action must be present');
 if(scenarioRows.some(s=>actions.find(a=>a.id==='abstain').payoffsUsdByScenario[s.id]!==0))
   throw new TypeError('abstain must have zero payoff in every scenario');
 const sigSeen=new Set(),probRows=[];
 for(const z of signalModel.signals){
  if(!identity(z?.id)||sigSeen.has(z.id)||!z.likelihoodByScenario||
     Object.keys(z.likelihoodByScenario).length!==scenarioRows.length||
     !scenarioRows.every(s=>simplex(z.likelihoodByScenario[s.id])))
   throw new TypeError('each signal needs a bounded complete conditional probability row');
  sigSeen.add(z.id);probRows.push(z);
 }
 for(const s of scenarioRows){
  const norm=average(probRows.map(z=>z.likelihoodByScenario[s.id]));
  if(Math.abs(norm-1)>tol)
   throw new RangeError('signal emission probabilities must normalize separately in every world');
 }
 const priorPayoffs=readyActions.map(a=>({
  id:a.id,expectedUsd:average(scenarioRows.map(s=>s.probability*a.payoffsUsdByScenario[s.id])),
 }));
 const priorBest=[...priorPayoffs].sort((a,b)=>b.expectedUsd-a.expectedUsd||a.id.localeCompare(b.id))[0];
 const signals=probRows.map(z=>{
  const mass=average(scenarioRows.map(s=>s.probability*z.likelihoodByScenario[s.id]));
  const candidates=readyActions.map(a=>({
   id:a.id,probabilityWeightedPayoffUsd:average(scenarioRows.map(
     s=>s.probability*z.likelihoodByScenario[s.id]*a.payoffsUsdByScenario[s.id])),
  }));
  const best=[...candidates].sort((a,b)=>
    b.probabilityWeightedPayoffUsd-a.probabilityWeightedPayoffUsd||a.id.localeCompare(b.id))[0];
  return {signal:z.id,probability:mass,
    bestAction:mass>tol?best.id:null,
    probabilityWeightedPayoffUsd:mass>tol?best.probabilityWeightedPayoffUsd:0,
    conditionalExpectedUsd:mass>tol?best.probabilityWeightedPayoffUsd/mass:null};
 });
 const gross=average(signals.map(z=>z.probabilityWeightedPayoffUsd))-priorBest.expectedUsd;
 // Floating cancellation on an exactly uninformative kernel is not
 // a scientific negative EVSI result; clamp only within numeric tolerance.
 if(gross<-tol)throw Error('information value violated nonnegativity');
 const grossEvsiUsd=Math.max(0,gross),cost=computeCostUsd+repricingCostBoundUsd;
 return {
  kind:'joint-market-scenario-sample-information-value-v1',
  forecastId:forecast.id,signalModelId:signalModel.id,at,
  baseBestAction:priorBest.id,baseExpectedUsd:priorBest.expectedUsd,
  candidateBasePayoffs:priorPayoffs,
  signals,
  expectedAfterSignalUsd:priorBest.expectedUsd+grossEvsiUsd,
  grossEvsiUsd,computeCostUsd,repricingCostBoundUsd,
  netEvsiUsd:grossEvsiUsd-cost,
  shouldAcquireConditional:grossEvsiUsd>cost,
  limitations:[
   'valid only for the predeclared frozen shared scenarios, signal likelihood and feasible fixed action menu',
   'does not prove signal forecast quality or that the opponent will leave the execution book unchanged',
   'opponent repricing, fees and capital risk must be in action payoffs or conservative cost',
   'no independently observed prices, source rights, queue fills or realized profit are established here',
  ],
  tradeEligible:false,orderEffect:false,
 };
}
