/**
 * Existing SignCell + SignChain realization of CONDITIONAL settlement proofs.
 *
 * Numerical interval proof search is the shared settlement-modal operator.
 * Evidence is the existing SignCell support/refutation carrier and is joined
 * by SignChain KNOWLEDGE join, never a private FOUR implementation.
 * The output is a SignCell, its canonical address, conditional deduction,
 * and source premise references. A consuming SignCraft journal can link
 * these by its existing causes field; no new SignGraph store or signer.
 *
 * Two contrary proofs can coexist; neither may explode into a trade.
 */
import {cell,address,evidence,sidesOf} from '@red-cup-engineering/signcell/cell';
import {knowledgeJoin} from '@red-cup-engineering/signchain/bilattice';
import {deduceSettlementInterval} from './settlement-modal.mjs';
import {conditionMarketForecastOnSignal} from './market-information-value.mjs';
import {evaluateJointScenarioAmbiguity} from './joint-scenario-ambiguity.mjs';
import {readMarketOutcomeEvidence,classifyMarketOutcome} from './outcome-evidence-border.mjs';
import {isAbsoluteSeavtClock,compareAbsoluteSeavtClocks} from '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';

const identity=s=>typeof s==='string'&&s.trim().length>0;
const available=t=>typeof t==='string'&&Number.isFinite(Date.parse(t));
const CHANNELS=Object.freeze([
  'source-conditional','proxy-counterfactual','rate-counterfactual',
  'other-conditional-research',
]);
const witnessId=w=>w.premises.join('|')+':'+w.rule+':'+w.scope;
const ordered=xs=>xs.slice().sort((a,b)=>witnessId(a).localeCompare(witnessId(b)));

/**
 * Context binds source, rule identity, event date and exact assumptions.
 * Source authenticity is NOT conferred by a string qualification.
 * Original premises retain their own receipt/availability clocks.
 */
export function projectConditionalSettlementSign({
  subject,predicate='settles-yes',context,channel,
  payout,premises=[],at,
}={}){
 if(!identity(subject)||!identity(predicate)||!context||
   typeof context!=='object'||Array.isArray(context)||
   !identity(context.rules)||!identity(context.source)||
   !identity(context.assumption)||
   !/^\d{4}-\d{2}-\d{2}$/.test(context.targetDate??'')||
   !Number.isFinite(Date.parse(context.targetDate+'T00:00:00Z'))||
   new Date(context.targetDate+'T00:00:00Z').toISOString().slice(0,10)!==context.targetDate||
   !CHANNELS.includes(channel)||!available(at))
  throw new TypeError('source- and rule-bound SignCell context, channel and time required');
 const deduction=deduceSettlementInterval({payout,premises,at});
 const positive=ordered(deduction.support.for);
 const negative=ordered(deduction.support.against);
 const tellings=[
   ...positive.map(w=>evidence({for:[w],against:[]})),
   ...negative.map(w=>evidence({for:[],against:[w]})),
 ];
 const joined=tellings.reduce((a,b)=>knowledgeJoin(a,b),evidence({for:[],against:[]}));
 // Source and counterfactual contexts MUST have distinct addresses even
 // when their subject/predicate and witnesses happen to coincide.
 const details={...context,condition:channel,availableAt:at,
   inference:'conditional-interval-subset-or-disjoint'};
 const sign=cell(subject,predicate,details,joined);
 const flags=sidesOf(joined);
 return {
   kind:'conditional-settlement-sign-projection-v1',
   channel,at,context:details,cell:sign,address:address(sign),
   deduction,
   premiseIds:[...deduction.qualifiedPremises],
   withheld:[...deduction.withheld],
   sourceRelations:[...positive.map(w=>({side:'for',premises:[...w.premises],rule:w.rule})),
     ...negative.map(w=>({side:'against',premises:[...w.premises],rule:w.rule}))],
   supportsYes:flags[0],supportsNo:flags[1],contradictory:flags[0]&&flags[1],
   tradeEligible:false,orderEffect:false,
   caveat:'conditional premise evidence, not authenticated venue settlement or trade permission',
 };
}


/**
 * Project a RECEIVED joint-scenario Bayesian update through the existing
 * SignCell + SignChain knowledge carrier, without turning probability into
 * FOUR truth or an authenticated settlement result.
 *
 * The predicate is about the numerical derivation: "this version of the
 * joint forecast follows from these model-conditional premises". It is NOT
 * a proof that any particular Kalshi contract settles YES.
 *
 * Downstream SignGraph/SignCraft consumers use the existing sourceRelations
 * and cause-event edges. Actual source-byte, canonical-address and journal
 * custody must still be independently received by Operations.
 */
export function projectObservedScenarioConditioningSign({
  forecast,signalModel,observation,at,context,
}={}){
 if(!context||!identity(context.source)||!identity(context.rules)||
    !identity(context.scope)||!identity(context.assumption)||
    !identity(context.targetDate)||
    !forecast||forecast.targetSource!==context.source||
    forecast.targetScope!==context.scope||
    forecast.targetDate!==context.targetDate)
  throw new TypeError('source/target/rules-bound conditional forecast SignCell required');
 const conditioned=conditionMarketForecastOnSignal({
  forecast,signalModel,observation,at,
 });
 if(conditioned.status!=='conditional-research-posterior')
  throw new RangeError('impossible signal cannot be asserted as a completed Bayes derivation');
 const premises=[forecast.id,signalModel.id,observation.id];
 if(new Set(premises).size!==premises.length)
  throw new TypeError('prior, likelihood model and source receipt identities must remain distinct');
 const proof={
  premises:[...premises],
  rule:'finite-joint-scenario-bayes-conditioning',
  scope:'conditional-on-preissued-empirically-unverified-signal-likelihood',
 };
 const joined=knowledgeJoin(
  evidence({for:[proof],against:[]}),
  evidence({for:[],against:[]}),
 );
 const details={
  ...context,
  condition:'source-conditional-model-derivation',
  inference:'finite-joint-scenario-bayes-conditioning',
  availableAt:at,
  priorForecastId:forecast.id,
  signalModelId:signalModel.id,
  observationId:observation.id,
  observationAvailableAt:observation.availableAt,
  posteriorForecastId:conditioned.forecast.id,
  // The canonical content address commits all actual joint weights. Simply
  // reusing a result ID with different numbers cannot borrow the old proof.
  posteriorScenarioWeights:conditioned.forecast.scenarios.map(s=>[s.id,s.probability]),
 };
 const sign=cell(conditioned.forecast.id,
  'is-conditionally-derived-joint-scenario-forecast',details,joined);
 return {
  kind:'conditional-scenario-sign-projection-v1',
  at,channel:'source-conditional-model-derivation',context:details,
  cell:sign,address:address(sign),
  premiseIds:premises,sourceRelations:[{
   side:'for',rule:proof.rule,premises:[...premises],
  }],
  conditionedForecast:conditioned.forecast,
  conditionalEvidence:{
   observationId:observation.id,signalId:observation.signalId,
   priorForecastId:forecast.id,signalModelId:signalModel.id,
   priorObservedAt:forecast.observedAt,
   priorAvailableAt:forecast.availableAt??forecast.observedAt,
   modelAvailableAt:signalModel.availableAt,
   observationObservedAt:observation.observedAt,
   observationAvailableAt:observation.availableAt,
  },
  // SignCell knows a conditional mathematical *telling*, not its empirical
  // reliability, source publisher or actual exchange settlement.
  sourceAuthenticated:false,tradeEligible:false,orderEffect:false,
 };
}


/**
 * A conditional distributionally robust ACTION evaluation in the existing
 * SignCell/SignChain knowledge carrier. The sign asserts that the finite
 * mathematical derivation follows from the explicitly named assumptions;
 * it does not assert that a calibration radius is empirically correct.
 *
 * Numerical input and output are committed in the canonical cell address so
 * a reused forecast ID or action ID cannot borrow an earlier calculation.
 * Downstream SignGraph/SignCraft use the standard premise relations, not a
 * bespoke proof graph, journal, signing method or executable order intent.
 */
export function projectConditionalRobustActionSign({
  forecast,actions,ambiguity,at,context,
}={}){
  if(!context||typeof context!=='object'||Array.isArray(context)||
    !identity(context.source)||!identity(context.rules)||
    !identity(context.scope)||!identity(context.assumption))
    throw new TypeError('named source, rule, scope and assumption context required');
  const result=evaluateJointScenarioAmbiguity({forecast,actions,ambiguity,at});
  const scenarioIds=[...forecast.scenarios.map(s=>s.id)].sort();
  const premiseIds=[...new Set([
    forecast.id,...forecast.evidenceIds,...ambiguity.evidenceIds,
  ])].sort();
  const proof={
    premises:premiseIds,
    rule:'finite-joint-total-variation-action-evaluation',
    scope:'conditional-on-unverified-predecision-calibration-radius',
  };
  const joined=knowledgeJoin(
    evidence({for:[proof],against:[]}),
    evidence({for:[],against:[]}),
  );
  const details={
    ...context,
    condition:'model-conditional-ambiguity-evaluation',
    inference:proof.rule,
    availableAt:at,
    forecastId:forecast.id,
    forecastObservedAt:forecast.observedAt,
    forecastAvailableAt:forecast.availableAt??forecast.observedAt,
    forecastHorizon:forecast.horizon,
    forecastEvidenceIds:[...forecast.evidenceIds].sort(),
    ambiguityConditionedOnForecastId:ambiguity.conditionedOnForecastId,
    ambiguityObservedAt:ambiguity.observedAt,
    ambiguityAvailableAt:ambiguity.availableAt,
    ambiguityEvidenceIds:[...ambiguity.evidenceIds].sort(),
    assumedTotalVariationRadius:result.assumedTotalVariationRadius,
    ...(result.tailFraction!==undefined?{
      assumedTailFraction:result.tailFraction,
      minWorstExpectedShortfallAction:result.minWorstExpectedShortfallAction,
    }:{}),
    // All actual scenario weights and action payoffs belong to the address.
    priorScenarioWeights:scenarioIds.map(id=>[
      id,forecast.scenarios.find(s=>s.id===id).probability,
    ]),
    actionPayoffVectors:[...actions].sort((a,b)=>a.id.localeCompare(b.id))
      .map(a=>[a.id,scenarioIds.map(id=>[id,a.payoffsUsdByScenario[id]])]),
    robustValues:[...result.actionEvaluations]
      .sort((a,b)=>a.id.localeCompare(b.id))
      .map(a=>[a.id,a.nominalExpectedUsd,a.worstCaseExpectedUsd,
        a.bestCaseExpectedUsd,a.worstCaseRegretUsd,
        ...(result.tailFraction!==undefined?[
          a.nominalExpectedShortfallUsd,a.worstCaseExpectedShortfallUsd,
        ]:[])]),
    maximinAction:result.maximinExpectedPayoffAction,
    minimaxRegretAction:result.minimaxRegretAction,
  };
  const sign=cell(forecast.id,
    'has-conditionally-derived-joint-scenario-robust-action-evaluation',
    details,joined);
  return Object.freeze({
    kind:'conditional-robust-action-sign-projection-v1',
    at,context:details,cell:sign,address:address(sign),
    evaluation:result,premiseIds,
    sourceRelations:[{side:'for',rule:proof.rule,premises:premiseIds}],
    sourceAuthenticated:false,radiusEmpiricallyVerified:false,
    tradeEligible:false,orderEffect:false,
  });
}


/**
 * Reconcile opposed tellings into ACTUAL SignCell evidence and SignChain FOUR.
 *
 * These are claims about a claimed USD-cent result, not an accepted profit.
 * One immutable economic receipt is functional for one decision/order;
 * opposing values therefore tell AGAINST each other's claim. A contradiction
 * has both for and against witnesses, not an ex falso source of positive P&L.
 *
 * No separate receipt type, sign store, probability, or trade authority:
 * the evidence view is read directly from the existing market-game state.
 * SignGraph/SignCraft consumers can use the original claim IDs and canonical
 * SignCell addresses as causal references. Original source verification and
 * accounting reconciliation remain independent receiving obligations.
 */
export function projectMarketOutcomeEvidenceSigns({state,at}={}) {
  const reading=readMarketOutcomeEvidence(state,at);
  const claimRows=new Map();
  const visibleIds=new Set(reading.events.flatMap(event=>
    event.claims.flatMap(claim=>claim.claimIds)));
  for(const original of Object.values(state.outcomes)){
    // A future original, including malformed or conflicting future custody,
    // cannot change what was knowable at this earlier observation cut.
    if(!visibleIds.has(original?.id))continue;
    if(!isAbsoluteSeavtClock(original.observedAt)||
       compareAbsoluteSeavtClocks(original.observedAt,at)>0)continue;
    if(typeof original.id!=='string'||!original.id||claimRows.has(original.id))
      throw new TypeError('unique original economic-outcome claim ID required');
    claimRows.set(original.id,original);
  }
  // Attribution belongs to each original observation. Reusing a group-level
  // sourceLinked flag would retroactively reclassify earlier claim witnesses
  // whenever a later confirming claim acquires independent source custody.
  const originalWitness=claimId=>{
    const original=claimRows.get(claimId);
    if(!original)throw new TypeError('outcome witness lacks its original claim');
    const decision=state.decisions[original.decisionId];
    const order=decision?.orders?.find(o=>o.id===original.orderId);
    const classification=classifyMarketOutcome({
      outcome:original,decision,order,
      sourceObservation:state.observations[original.sourceObservationId],
    });
    const linked=classification.status==='source-linked-claim';
    return {
      claimId,observedAt:original.observedAt,sourceLinked:linked,
      sourceObservationIds:linked?[classification.sourceObservationId]:[],
    };
  };
  const projected=[];
  for(const event of reading.events) {
    for(const claim of event.claims) {
      const forWitnesses=claim.claimIds.map(claimId=>({
        kind:'economic-outcome-claim',receipt:event.receipt,
        ...originalWitness(claimId),
      }));
      const againstWitnesses=event.claims
        .filter(other=>other.pnlCents!==claim.pnlCents)
        .flatMap(other=>other.claimIds.map(claimId=>({
          kind:'opposing-economic-outcome-claim',
          receipt:event.receipt,claimedPnlCents:other.pnlCents,
          rule:'one-economic-event-has-one-realized-pnl-value',
          ...originalWitness(claimId),
        })));
      const joined=knowledgeJoin(
        evidence({for:forWitnesses,against:[]}),
        evidence({for:[],against:againstWitnesses}),
      );
      const proposition={
        decisionId:event.decisionId,orderId:event.orderId,
        principal:event.principal,receipt:event.receipt,
        currency:'USD',claimedPnlCents:claim.pnlCents,
        sourceAuthenticated:false,independentlyReconciled:false,
      };
      const sign=cell(event.receipt,'has-claimed-economic-pnl-cents',
        proposition,joined);
      const [supports,opposes]=sidesOf(joined);
      projected.push(Object.freeze({
        cell:sign,address:address(sign),proposition,
        supportsClaim:supports,opposesClaim:opposes,
        claimIds:[...claim.claimIds],
        sourceObservationIds:[...claim.sourceObservationIds],
        tradeEligible:false,sourceAuthenticated:false,
      }));
    }
  }
  return Object.freeze({
    kind:'market-outcome-sign-evidence-reading-v1',at,
    claims:Object.freeze(projected),
    disputedEconomicEvents:reading.disputes.length,
    // Explicitly read only: no ledger write and no empirical outcome admitted.
    acceptedOutcomeCount:0,tradeEligible:false,orderEffect:false,
  });
}
