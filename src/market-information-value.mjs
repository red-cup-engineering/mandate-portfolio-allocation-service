import {conditionJointScenarioWeights} from './joint-scenario-condition.mjs';
import {assertBlackwellGarbling,inferBinaryBlackwellGarbling} from './blackwell-garbling.mjs';
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
const clock=x=>typeof x==='string'&&
 /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&
 Number.isFinite(Date.parse(x));
const identity=x=>typeof x==='string'&&x.trim().length>0;
const simplex=x=>finite(x)&&x>=0&&x<=1;
const average=(rows)=>rows.reduce((s,x)=>s+x,0);
const tol=1e-9;
const payoffBound=1e12;
const lexical=(a,b)=>a<b?-1:a>b?1:0;

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
    (forecast.availableAt!==undefined&&!clock(forecast.availableAt))||
    Date.parse(forecast.observedAt)>Date.parse(forecast.availableAt??forecast.observedAt)||
    Date.parse(forecast.availableAt??forecast.observedAt)>Date.parse(at)||
    !clock(forecast.horizon)||Date.parse(forecast.horizon)<=Date.parse(at)||
    !Array.isArray(forecast.scenarios)||forecast.scenarios.length<2||
    forecast.scenarios.length>512||!Array.isArray(forecast.evidenceIds)||
    !forecast.evidenceIds.length||!clock(at)||
    Date.parse(forecast.observedAt)>Date.parse(at))
   throw new TypeError('point-in-time shared joint scenario forecast required');
 if(!Array.isArray(actions)||actions.length<1||actions.length>128||
    !signalModel||!identity(signalModel.id)||!clock(signalModel.availableAt)||
    Date.parse(signalModel.availableAt)>Date.parse(at)||
    signalModel.conditionedOnForecastId!==forecast.id||
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
     !scenarioRows.every(s=>Object.hasOwn(a.payoffsUsdByScenario,s.id)&&
       finite(a.payoffsUsdByScenario[s.id])&&
       Math.abs(a.payoffsUsdByScenario[s.id])<=payoffBound))
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
     !scenarioRows.every(s=>Object.hasOwn(z.likelihoodByScenario,s.id)&&
       simplex(z.likelihoodByScenario[s.id])))
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
 const priorBest=[...priorPayoffs].sort((a,b)=>b.expectedUsd-a.expectedUsd||lexical(a.id,b.id))[0];
 const signals=probRows.map(z=>{
  const mass=average(scenarioRows.map(s=>s.probability*z.likelihoodByScenario[s.id]));
  const candidates=readyActions.map(a=>({
   id:a.id,probabilityWeightedPayoffUsd:average(scenarioRows.map(
     s=>s.probability*z.likelihoodByScenario[s.id]*a.payoffsUsdByScenario[s.id])),
  }));
  const best=[...candidates].sort((a,b)=>
    b.probabilityWeightedPayoffUsd-a.probabilityWeightedPayoffUsd||lexical(a.id,b.id))[0];
  // A nonzero rare observation can have material dollar EVSI; the simplex
  // normalization tolerance is NOT permission to erase that signal.
  return {signal:z.id,probability:mass,
    bestAction:mass>0?best.id:null,
    probabilityWeightedPayoffUsd:mass>0?best.probabilityWeightedPayoffUsd:0,
    conditionalExpectedUsd:mass>0?best.probabilityWeightedPayoffUsd/mass:null};
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

/**
 * Compare bounded research purchases on the SAME joint market game.
 *
 * This is a menu over the existing EVSI operator, not a second forecast
 * family. Candidate signals can be SEC disclosure interpretation, Koios
 * provenance analysis, options implied distributions, order-flow observations,
 * or another learned information source. Each must supply its own pre-decision
 * joint scenario likelihood; vague sentiment labels are not calibrated
 * signal models. Correlated offers are evaluated ALTERNATIVELY, never added.
 *
 * A missing or inadmissible kernel is an explicit research-evidence gap rather
 * than a zero-valued signal. No inference job or brokerage operation runs.
 */
export function compareMarketResearchAcquisitions({
  forecast, actions, at, candidates = [], garblings = [], autoGarbling = true,
} = {}) {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 64)
    throw new TypeError('bounded-research-acquisition-candidates-required');
  if (!Array.isArray(garblings) || garblings.length > 128 ||
      typeof autoGarbling !== 'boolean')
    throw new TypeError('bounded-Blackwell-garbling-comparisons-required');
  const names = new Set(), byId = new Map(), scored = [], gaps = [];
  for (const candidate of candidates) {
    if (!identity(candidate?.id) || names.has(candidate.id))
      throw new TypeError('unique-research-acquisition-identity-required');
    names.add(candidate.id);
    byId.set(candidate.id,candidate);
  }
  const costOf = candidate => {
    const compute = candidate.computeCostUsd ?? 0;
    const repricing = candidate.repricingCostBoundUsd ?? 0;
    if (!finite(compute) || compute < 0 || !finite(repricing) ||
        repricing < 0 || !finite(compute+repricing))
      throw new TypeError('finite nonnegative research and repricing cost required');
    return compute+repricing;
  };
  // The mathematical witness is verified over the WHOLE scenario family.
  // Higher information at a HIGHER cost cannot eliminate the cheaper option.
  // Equal-cost equivalent experiments break ties by code-point identity,
  // ruling out mutual-elimination cycles.
  const excluded = new Map();
  const prefer = (finer,coarser) => {
    const finerCost = costOf(finer),coarserCost = costOf(coarser);
    if (finerCost < coarserCost ||
        (finerCost === coarserCost && lexical(finer.id,coarser.id)<0)) {
      const previous = excluded.get(coarser.id);
      if (!previous || finerCost < previous.cost ||
          (finerCost === previous.cost && lexical(finer.id,previous.id)<0))
        excluded.set(coarser.id,{id:finer.id,cost:finerCost});
    }
  };
  for (const claim of garblings) {
    const finer = byId.get(claim?.finerId), coarser = byId.get(claim?.coarserId);
    if (!finer || !coarser || claim.finerId === claim.coarserId)
      throw new TypeError('garbling must relate two different offered research candidates');
    assertBlackwellGarbling({
      forecast, at, finerModel:finer.signalModel,
      coarserModel:coarser.signalModel, garbling:claim.kernel,
    });
    prefer(finer,coarser);
  }
  // Binary experiments are small enough that the house can derive its own
  // stochastic factorization, rather than wait for an agent to volunteer a
  // certificate. This is a conservative discovery method: non-binary or
  // ill-conditioned candidates remain scored instead of being guessed away.
  if (autoGarbling) {
    const alternatives=[...byId.values()];
    for(let i=0;i<alternatives.length;i++)
      for(let j=0;j<alternatives.length;j++) {
        if(i===j)continue;
        const finer=alternatives[i],coarser=alternatives[j];
        let cheaper;
        try {cheaper=costOf(finer)<=costOf(coarser);}
        catch{continue;}
        if(!cheaper)continue;
        const kernel=inferBinaryBlackwellGarbling({
          forecast,at,finerModel:finer.signalModel,
          coarserModel:coarser.signalModel,
        });
        if(kernel)prefer(finer,coarser);
      }
  }
  for (const candidate of candidates) {
    if (excluded.has(candidate.id)) continue;
    try {
      const assessment = evaluateMarketInformationValue({
        forecast, actions, at, signalModel: candidate.signalModel,
        computeCostUsd: candidate.computeCostUsd ?? 0,
        repricingCostBoundUsd: candidate.repricingCostBoundUsd ?? 0,
      });
      scored.push({
        id: candidate.id,
        signalModelId: assessment.signalModelId,
        grossEvsiUsd: assessment.grossEvsiUsd,
        netEvsiUsd: assessment.netEvsiUsd,
        computeCostUsd: assessment.computeCostUsd,
        repricingCostBoundUsd: assessment.repricingCostBoundUsd,
        baseBestAction: assessment.baseBestAction,
        shouldAcquireConditional: assessment.shouldAcquireConditional,
        // A conditional positive EVSI is not evidence of live profitability.
        tradeEligible: false,
      });
    } catch (error) {
      gaps.push({
        id: candidate.id,
        disposition: 'unranked-without-admissible-signal-model',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  scored.sort((a, b) => b.netEvsiUsd - a.netEvsiUsd || lexical(a.id,b.id));
  const selected = scored.find(row => row.shouldAcquireConditional) ?? null;
  return Object.freeze({
    kind: 'joint-market-alternative-research-acquisition-menu-v1',
    at, forecastId: forecast?.id ?? null,
    selectedResearchId: selected?.id ?? null,
    selectedConditionalNetEvsiUsd: selected?.netEvsiUsd ?? null,
    rankedAlternatives: Object.freeze(scored.map(row => Object.freeze(row))),
    // These were pruned by verified stochastic-kernel factoring, not by
    // sentiment, source status, or an agent's unsupported ranking assertion.
    mathematicallyDominatedAlternatives: Object.freeze([...excluded]
      .sort(([a],[b])=>lexical(a,b))
      .map(([id,w])=>Object.freeze({id,dominatedBy:w.id}))),
    evidenceGaps: Object.freeze(gaps.map(row => Object.freeze(row))),
    noResearchPurchased: true, tradeEligible: false, orderEffect: false,
    limitations: Object.freeze([
      'each signal likelihood and action payoff remains an evidence-dependent, unverified model unless independently validated',
      'alternative EVSI values are NOT additive; combined or sequential signals require a jointly calibrated kernel',
       'binary Blackwell comparisons are discovered and verified before valuing redundant research; no signal was purchased or observed',
      'signal search, inference payment, opponent repricing, venue order and realized alpha are not performed',
    ]),
  });
}

/**
 * Actually condition an EXISTING joint scenario law on one newly received
 * observation, after the EVSI research/acquisition decision.
 *
 * This closes the loop that EVSI alone cannot: a signal has arrived, so each
 * scenario's weight must now be updated via Bayes, and ALL contracts consuming
 * that scenario law must update together. It is not valid to edit an isolated
 * market's YES probability independently of the others.
 *
 * The signal kernel must be expressly conditional on this exact prior
 * forecast ID. Reusing an old unconditional likelihood after previous evidence
 * has already been included would silently count correlated information twice.
 *
 * A prior and a received likelihood form a research posterior, NOT source
 * authentication, a SignCell proof of settlement, or authority to order.
 */
export function conditionMarketForecastOnSignal({
  forecast, signalModel, observation, at, actions = null,
} = {}) {
  const absolute = s => typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s) &&
    Number.isFinite(Date.parse(s));
  if (!absolute(at) || !observation || !identity(observation.id) ||
      !identity(observation.signalId) || !absolute(observation.observedAt) ||
      !absolute(observation.availableAt) ||
      !Array.isArray(observation.evidenceIds) ||
      !observation.evidenceIds.length ||
      observation.evidenceIds.some(id => !identity(id)) ||
      !forecast || !signalModel ||
      signalModel.conditionedOnForecastId !== forecast.id ||
      !absolute(forecast.observedAt) ||
      (forecast.availableAt !== undefined && !absolute(forecast.availableAt)) ||
      !absolute(signalModel.availableAt) ||
      !absolute(forecast.horizon) ||
      Date.parse(signalModel.availableAt) > Date.parse(observation.observedAt) ||
      Date.parse(forecast.availableAt ?? forecast.observedAt) > Date.parse(observation.observedAt) ||
      Date.parse(forecast.observedAt) > Date.parse(observation.observedAt) ||
      Date.parse(observation.observedAt) > Date.parse(observation.availableAt) ||
      Date.parse(observation.availableAt) > Date.parse(at) ||
      Date.parse(at) >= Date.parse(forecast.horizon))
    throw new TypeError('precommitted conditional signal, ordered actual receipt and live forecast horizon required');

  const receiptIds = [...observation.evidenceIds];
  if (new Set(receiptIds).size !== receiptIds.length)
    throw new TypeError('duplicate observation evidence ID');
  const selected = signalModel.signals?.find(s => s.id === observation.signalId);
  if (!selected)
    throw new TypeError('observed signal must belong to the frozen emission model');

  // Reuse the established joint scenario, emission, action and abstention
  // validators. The action menu is optional; absent a menu we supply only
  // zero-payoff abstention for admission, not a simulated financial strategy.
  const admittedActions = actions ?? [{
    id: 'abstain',
    payoffsUsdByScenario: Object.fromEntries(
      (forecast.scenarios ?? []).map(s => [s.id, 0])),
  }];
  const assessment = evaluateMarketInformationValue({
    forecast, actions: admittedActions, signalModel, at,
  });

  // The SAME finite Bayes kernel serves the existing stateful market game
  // and this received-signal research path. Neither has its own optimizer.
  const conditioned = conditionJointScenarioWeights({
    scenarios:forecast.scenarios,
    likelihoodByScenario:selected.likelihoodByScenario,
  });
  if(conditioned.status!=='conditioned')return {
    kind:'joint-market-scenario-signal-conditioning-v1',
    status:'observation-impossible-under-frozen-model',
    at,priorForecastId:forecast.id,signalModelId:signalModel.id,
    observationId:observation.id,signalId:observation.signalId,
    forecast:null,conditionalAction:null,sourceAuthenticated:false,
    tradeEligible:false,orderEffect:false,
  };
  const posterior = {
    ...forecast,
    // This JSON tuple is a collision-free lineage label among distinct ID
    // tuples, not a SignCell address or verified digest of original source.
    id: JSON.stringify(['conditioned-joint-forecast',
      forecast.id, signalModel.id, observation.id, observation.signalId]),
    observedAt: observation.observedAt,
    availableAt: observation.availableAt,
    evidenceIds: [...new Set([
      ...forecast.evidenceIds, ...signalModel.sourceEvidenceIds,
      ...observation.evidenceIds,
    ])].sort(),
    scenarios: forecast.scenarios.map((s, i) => ({
      ...s, probability: conditioned.probabilities[i],
    })),
  };
  // Rank the SAME validated payoff menu under the RECEIVED posterior.
  // Never infer a post-signal action using the pre-signal EVSI value, nor
  // suppress an admissible rare observation through a coarse mass cutoff.
  const rankedActions = actions === null ? null :
    admittedActions.map(action => ({
      id: action.id,
      expectedUsd: posterior.scenarios.reduce((sum, s) =>
        sum + s.probability * action.payoffsUsdByScenario[s.id], 0),
    })).sort((a, b) => b.expectedUsd - a.expectedUsd || lexical(a.id,b.id));
  return {
    kind: 'joint-market-scenario-signal-conditioning-v1',
    status: 'conditional-research-posterior',
    at, priorForecastId: forecast.id, signalModelId: signalModel.id,
    observationId: observation.id, signalId: observation.signalId,
    logObservationLikelihood: conditioned.logObservationLikelihood,
    observationProbability: conditioned.observationProbability,
    realizedSurprisalBits: -conditioned.logObservationLikelihood / Math.LN2,
    posteriorPriorDivergenceNats: conditioned.divergenceNats,
    forecast: posterior,
    conditionalAction: rankedActions === null ? null : {
      priorBestAction: assessment.baseBestAction,
      posteriorBestAction: rankedActions[0].id,
      posteriorExpectedUsd: rankedActions[0].expectedUsd,
      rankedActions,
      actionMenuFixed: true,
    },
    limitations: [
      'Bayes assumes the frozen signal likelihood is calibrated conditional on the specified prior forecast',
      'the observed receipt and model are supplied, not independently authenticated by this mathematical operator',
      'joint scenario probabilities are updated together; the result is not a fresh market book, fee or fill forecast',
    ],
    sourceAuthenticated: false, tradeEligible: false, orderEffect: false,
  };
}
