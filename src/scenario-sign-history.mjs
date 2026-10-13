/**
 * Real SignCell -> SignGraph -> SignCraft realization of a received joint
 * prediction-market inference. Pure: caller owns custody and admission.
 *
 * This is NOT another journal format, event store or graph engine. It appends
 * actual SignCraft history revisions, whose parents establish the causal order,
 * and actual SignCell predecessor relationships projected by SignGraph.
 * The source receipt cells are explicitly CLAIMS until an independent
 * Operations source reader verifies original bytes and publisher authority.
 */
import {cell, address, coincides} from '@red-cup-engineering/signcell/cell';
import {
  createHistory, historyHeads, historySection, observeHistory, validateHistory,
} from '@red-cup-engineering/signcraft/history';
import {relationGraphOfCells,flowNetworkOfCells} from '@red-cup-engineering/signgraph/cell-graph';
import {evaluateJointScenarioAmbiguity} from './joint-scenario-ambiguity.mjs';
import {projectMarketOutcomeEvidenceSigns} from './settlement-sign-evidence.mjs';
import {seavtOfSignCell} from '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';
import {eavtId} from '@red-cup-engineering/eavt-services-section/row';
import {
  finiteLawExpectation,extremalTotalVariationExpectation,upperTailMeanOfFiniteLaw,
} from '@red-cup-engineering/metrologic/number/finite-law';

const named=x=>typeof x==='string'&&x.trim().length>0;
import {isAbsoluteSeavtClock as instant,compareAbsoluteSeavtClocks as compareTime} from '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';
const digest=x=>typeof x==='string'&&/^sha256:[0-9a-f]{64}$/.test(x);
const same=(a,b)=>coincides(a,b);

function requiredProjection(p){
  if(p?.kind!=='conditional-scenario-sign-projection-v1'||
     p.channel!=='source-conditional-model-derivation'||
     p.tradeEligible!==false||p.orderEffect!==false||
     p.sourceAuthenticated!==false||
     !instant(p.at)||!named(p.address)||
     !p.cell||address(p.cell)!==p.address||
     !named(p.context?.rules)||!named(p.context?.source)||
     !named(p.context?.scope)||!named(p.context?.targetDate)||
     p.cell.predicate!=='is-conditionally-derived-joint-scenario-forecast'||
     !same(p.cell.object,p.context)||
     !Array.isArray(p.cell.for)||p.cell.for.length!==1||
     !Array.isArray(p.cell.against)||p.cell.against.length!==0||
     p.cell.for[0]?.rule!=='finite-joint-scenario-bayes-conditioning'||
     !Array.isArray(p.premiseIds)||p.premiseIds.length!==3||
     new Set(p.premiseIds).size!==3||
     !p.premiseIds.every(named)||
     !Array.isArray(p.sourceRelations)||p.sourceRelations.length!==1||
     p.sourceRelations[0]?.rule!=='finite-joint-scenario-bayes-conditioning'||
     !Array.isArray(p.sourceRelations[0].premises)||
     !same([...p.sourceRelations[0].premises].sort(),[...p.premiseIds].sort())||
     !same([...p.cell.for[0].premises].sort(),[...p.premiseIds].sort())||
     !p.conditionalEvidence||!p.conditionedForecast||
     p.conditionalEvidence.priorForecastId!==p.premiseIds[0]||
     p.conditionalEvidence.signalModelId!==p.premiseIds[1]||
     p.conditionalEvidence.observationId!==p.premiseIds[2]||
     p.conditionedForecast.id!==p.cell.subject||
     !Array.isArray(p.conditionedForecast.scenarios)||
     !same(p.context.posteriorScenarioWeights,
       p.conditionedForecast.scenarios.map(s=>[s.id,s.probability]))||
     p.context.posteriorForecastId!==p.cell.subject||
     p.context.availableAt!==p.at||
     !instant(p.conditionalEvidence.priorObservedAt)||
     !instant(p.conditionalEvidence.priorAvailableAt)||
     !instant(p.conditionalEvidence.modelAvailableAt)||
     !instant(p.conditionalEvidence.observationObservedAt)||
     !instant(p.conditionalEvidence.observationAvailableAt))
    throw new TypeError('one received, addressable, causal conditional SignCell proof required');
  const e=p.conditionalEvidence;
  if(compareTime(e.priorObservedAt,e.priorAvailableAt)>0||
     compareTime(e.priorAvailableAt,e.observationObservedAt)>0||
     compareTime(e.modelAvailableAt,e.observationObservedAt)>0||
     compareTime(e.observationObservedAt,e.observationAvailableAt)>0||
     compareTime(e.observationAvailableAt,p.at)>0)
    throw new RangeError('conditional proof used a source that was not available before the observation/decision');
}

/**
 * A receipt identifies byte custody but does not prove publication or issuer
 * authenticity. Coesite's independent source-reader must receive these bytes.
 */
export function scenarioSourceReceiptCells(projection,sourceReceipts){
  requiredProjection(projection);
  if(!Array.isArray(sourceReceipts)||
     sourceReceipts.length!==projection.premiseIds.length)
    throw new TypeError('one original receipt for every source, model and observation required');
  const ids=new Set(),byId=new Map();
  for(const r of sourceReceipts){
    if(!named(r?.id)||ids.has(r.id)||!named(r.sourceRef)||
       !named(r.issuer)||!digest(r.sha256)||
       !instant(r.observedAt)||!instant(r.availableAt)||
       compareTime(r.observedAt,r.availableAt)>0||
       compareTime(r.availableAt,projection.at)>0)
      throw new TypeError('unique source ID, named issuer, exact digest and bounded receipt times required');
    ids.add(r.id);byId.set(r.id,r);
  }
  if(projection.premiseIds.some(id=>!ids.has(id)))
    throw new TypeError('inference predecessor is missing its independent original-source receipt');
  const e=projection.conditionalEvidence;
  const expected=[
    {id:e.priorForecastId,observedAt:e.priorObservedAt,availableAt:e.priorAvailableAt},
    {id:e.signalModelId,availableAt:e.modelAvailableAt},
    {id:e.observationId,observedAt:e.observationObservedAt,availableAt:e.observationAvailableAt},
  ];
  for(const want of expected){
    const r=byId.get(want.id);
    if(want.observedAt!==undefined &&
       compareTime(r.observedAt,want.observedAt)!==0)
      throw new TypeError('source observation clock disagrees with its conditional proof');
    if(compareTime(r.availableAt,want.availableAt)!==0)
      throw new TypeError('source availability clock disagrees with its conditional proof');
  }
  return sourceReceiptCellsOf([...byId.values()]);
}

function originalCellAt(h,proposal,{functional=false}={}){
  const existing=historySection(h,proposal.subject,proposal.predicate);
  // Source identities and completed posterior IDs are immutable, whereas
  // one source may be a nonfunctional predecessor of MANY joint forecasts.
  // A matching member cannot mask a contradictory one in a source identity.
  if(functional&&existing.some(value=>!same(value,proposal)))
    throw new RangeError('existing SignCraft source/proof identity conflicts with new evidence');
  return existing.some(value=>same(value,proposal));
}

/**
 * Produce source-receipt revision (only for missing sources), THEN an actual
 * causal inference revision containing the projected proof and SignGraph link
 * cells. Returns the NEW native SignCraft history for its owning store to
 * commit atomically and independently read back. No local files are opened.
 *
 * Repeated identical inference returns the same history, not another revision.
 */
export function composeConditionalScenarioHistory({
  history=createHistory(),projection,sourceReceipts,
  source='prediction-market-conditioned-scenarios',
}={}){
  validateHistory(history);
  if(!named(source))throw new TypeError('named SignCraft history source required');
  const receipts=scenarioSourceReceiptCells(projection,sourceReceipts);
  const predecessor=projection.cell.subject;
  const links=Object.freeze([...projection.premiseIds].sort()
    .map(id=>cell(id,'is-premise-of-conditional-forecast',predecessor,{
      for:[{
        kind:'conditional-inference-causal-reference-v1',
        rule:'finite-joint-scenario-bayes-conditioning',
        proofAddress:projection.address,premiseId:id,
      }],
    })));
  const graph=relationGraphOfCells(links);
  // The symmetric relation graph measures topology. SignGraph's existing
  // oriented 1-chain preserves the premise -> derived-result causal boundary.
  const flow=flowNetworkOfCells(links);
  let next=history;
  const priorHeads=historyHeads(next);
  const missing=receipts.filter(c=>!originalCellAt(next,c,{functional:true}));
  const existingProof=originalCellAt(next,projection.cell,{functional:true});
  const missingLinks=links.filter(c=>!originalCellAt(next,c));
  if(existingProof&&(missing.length||missingLinks.length))
    throw new RangeError('existing inference has missing source custody or causal predecessor links');
  if(existingProof)return {
    kind:'conditional-scenario-sign-history-v1',status:'already-recorded',
    history:next,sourceCells:receipts,linkCells:links,graph,flow,
    proofAddress:projection.address,sourceRevisionId:null,
    proofRevisionId:null,priorHeads,heads:priorHeads,
    tradeEligible:false,orderEffect:false,
  };
  let sourceRevisionId=null;
  if(missing.length){
    next=observeHistory(next,missing,{source:source+':source-receipts'});
    sourceRevisionId=next.revisions.at(-1).id;
  }
  next=observeHistory(next,[...missingLinks,projection.cell],{
    source:source+':conditional-inference',
  });
  const proofRevisionId=next.revisions.at(-1).id;
  if(!same(next.revisions.at(-1).parents,
     sourceRevisionId?[sourceRevisionId]:priorHeads))
    throw new Error('SignCraft inference revision lost its original causal predecessor');
  for(const c of [...receipts,...links,projection.cell])
    if(!originalCellAt(next,c))
      throw new Error('new SignCraft history did not retain a required SignCell');
  return Object.freeze({
    kind:'conditional-scenario-sign-history-v1',status:'composed',
    history:next,sourceCells:receipts,linkCells:links,graph,flow,
    proofAddress:projection.address,sourceRevisionId,
    proofRevisionId,priorHeads,heads:historyHeads(next),
    tradeEligible:false,orderEffect:false,
  });
}


/**
 * One source-cell construction for the existing Bayesian and robust-action
 * proof families. These cells assert byte-custody CLAIMS, not verification.
 * The actual Operations reader must compare every declared SHA-256 to the
 * separately fetched original byte stream and verify the issuer's authority.
 */
function sourceReceiptCellsOf(receipts){
  return Object.freeze([...receipts].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
    .map(r=>cell(r.id,'prediction-market-source-receipt',{
      kind:'prediction-market-source-receipt-v1',sourceRef:r.sourceRef,
      issuer:r.issuer,sha256:r.sha256,
      observedAt:r.observedAt,availableAt:r.availableAt,
    },{for:[{kind:'source-custody-claim-v1',id:r.id,sha256:r.sha256}]})));
}
/**
 * Reuse the SAME native SignCell original-byte custody cells for market
 * outcome claims, joint Bayes proofs and robust joint-scenario derivations.
 *
 * This checks only claim shape and time. Operations must independently READ
 * original bytes, verify SHA-256 and publisher authority before any of these
 * cells can be committed. Nothing here authenticates a venue fill or a P&L.
 */
export function outcomeSourceReceiptCells({
  sourceObservationIds,sourceReceipts,at,
}={}) {
  if(!instant(at)||!Array.isArray(sourceObservationIds)||
     sourceObservationIds.length<1||sourceObservationIds.length>2048||
     sourceObservationIds.some(id=>!named(id))||
     new Set(sourceObservationIds).size!==sourceObservationIds.length)
    throw new TypeError('distinct, bounded market outcome source IDs and receiver clock required');
  const byId=checkedSourceReceipts(sourceObservationIds,at,sourceReceipts);
  return sourceReceiptCellsOf([...byId.values()]);
}

function checkedSourceReceipts(premiseIds,at,receipts){
  if(!Array.isArray(receipts)||receipts.length!==premiseIds.length)
    throw new TypeError('exactly one original-byte receipt per conditional premise required');
  const byId=new Map(),allowed=new Set(premiseIds);
  for(const r of receipts){
    if(!named(r?.id)||!allowed.has(r.id)||byId.has(r.id)||
      !named(r.sourceRef)||!named(r.issuer)||!digest(r.sha256)||
      !instant(r.observedAt)||!instant(r.availableAt)||
      compareTime(r.observedAt,r.availableAt)>0||
      compareTime(r.availableAt,at)>0)
      throw new TypeError('unique named premise receipt, authenticable digest and bounded absolute clocks required');
    byId.set(r.id,r);
  }
  if(premiseIds.some(id=>!byId.has(id)))
    throw new TypeError('source receipt omitted an inference predecessor');
  return byId;
}

/**
 * The bridge must replay the numerical argument, not merely accept a
 * self-reported evaluation whose numbers resemble those in a SignCell.
 * Reconstruct the SAME shared market-game scenario and fixed payoff menu
 * from the complete inputs committed by the canonical SignCell address.
 *
 * This verifies conditional arithmetic and provenance integrity; it does
 * not verify the empirical size of the assumed TV uncertainty ball.
 */
function requiredRobustProjection(p){
  if(p?.kind!=='conditional-robust-action-sign-projection-v1'||
    p.sourceAuthenticated!==false||p.radiusEmpiricallyVerified!==false||
    p.tradeEligible!==false||p.orderEffect!==false||
    !instant(p.at)||!named(p.address)||!p.cell||
    address(p.cell)!==p.address||
    p.cell.predicate!=='has-conditionally-derived-joint-scenario-robust-action-evaluation'||
    !same(p.cell.object,p.context)||
    !named(p.context?.source)||!named(p.context?.rules)||
    !named(p.context?.scope)||!named(p.context?.assumption)||
    p.context.condition!=='model-conditional-ambiguity-evaluation'||
    p.context.inference!=='finite-joint-total-variation-action-evaluation'||
    p.context.availableAt!==p.at||
    !Array.isArray(p.cell.for)||p.cell.for.length!==1||
    !Array.isArray(p.cell.against)||p.cell.against.length!==0||
    p.cell.for[0]?.rule!=='finite-joint-total-variation-action-evaluation'||
    p.cell.for[0]?.scope!=='conditional-on-unverified-predecision-calibration-radius'||
    !Array.isArray(p.premiseIds)||p.premiseIds.length<2||
    new Set(p.premiseIds).size!==p.premiseIds.length||
    !p.premiseIds.every(named)||
    !Array.isArray(p.sourceRelations)||p.sourceRelations.length!==1||
    p.sourceRelations[0]?.side!=='for'||
    p.sourceRelations[0]?.rule!==p.cell.for[0].rule||
    !Array.isArray(p.sourceRelations[0]?.premises)||
    !same([...p.sourceRelations[0].premises].sort(),[...p.premiseIds].sort())||
    !same([...p.cell.for[0].premises].sort(),[...p.premiseIds].sort())||
    p.evaluation?.kind!=='joint-scenario-conditional-ambiguity-evaluation-v1'||
    p.evaluation.tradeEligible!==false||p.evaluation.orderEffect!==false||
    p.evaluation.sourceAuthenticated!==false||
    p.evaluation.radiusEmpiricallyVerified!==false)
    throw new TypeError('complete native conditional robust SignCell, lineage and non-execution evidence required');
  const c=p.context;
  if(!named(c.forecastId)||c.forecastId!==p.cell.subject||
    c.ambiguityConditionedOnForecastId!==c.forecastId||
    !Array.isArray(c.forecastEvidenceIds)||
    !c.forecastEvidenceIds.length||
    c.forecastEvidenceIds.some(id=>!named(id))||
    new Set(c.forecastEvidenceIds).size!==c.forecastEvidenceIds.length||
    !Array.isArray(c.ambiguityEvidenceIds)||
    !c.ambiguityEvidenceIds.length||
    c.ambiguityEvidenceIds.some(id=>!named(id))||
    new Set(c.ambiguityEvidenceIds).size!==c.ambiguityEvidenceIds.length||
    !same([...c.forecastEvidenceIds].sort(),c.forecastEvidenceIds)||
    !same([...c.ambiguityEvidenceIds].sort(),c.ambiguityEvidenceIds)||
    !Array.isArray(c.priorScenarioWeights)||
    !Array.isArray(c.actionPayoffVectors)||
    !same([...new Set([c.forecastId,...c.forecastEvidenceIds,...c.ambiguityEvidenceIds])].sort(),
      [...p.premiseIds].sort()))
    throw new TypeError('complete source-linked joint prior and ambiguity identity required');
  const forecast={
    id:c.forecastId,observedAt:c.forecastObservedAt,
    availableAt:c.forecastAvailableAt,horizon:c.forecastHorizon,
    evidenceIds:c.forecastEvidenceIds,
    scenarios:c.priorScenarioWeights.map(row=>({
      id:row?.[0],probability:row?.[1],
    })),
  };
  const ambiguity={
    conditionedOnForecastId:c.ambiguityConditionedOnForecastId,
    observedAt:c.ambiguityObservedAt,availableAt:c.ambiguityAvailableAt,
    evidenceIds:c.ambiguityEvidenceIds,
    totalVariationRadius:c.assumedTotalVariationRadius,
    ...(Object.hasOwn(c,'assumedTailFraction')?{
      tailFraction:c.assumedTailFraction,
    }:{}),
  };
  const actions=c.actionPayoffVectors.map(row=>({
    id:row?.[0],
    payoffsUsdByScenario:Object.fromEntries(row?.[1]??[]),
  }));
  const exact=evaluateJointScenarioAmbiguity({
    forecast,actions,ambiguity,at:p.at,
  });
  const compact=(r)=>[...r.actionEvaluations]
    .sort((a,b)=>a.id.localeCompare(b.id))
    .map(a=>[a.id,a.nominalExpectedUsd,a.worstCaseExpectedUsd,
      a.bestCaseExpectedUsd,a.worstCaseRegretUsd,
      ...(r.tailFraction!==undefined?[
        a.nominalExpectedShortfallUsd,a.worstCaseExpectedShortfallUsd,
      ]:[])]);
  if(p.evaluation.forecastId!==c.forecastId||
    p.evaluation.at!==p.at||
    !same([...p.evaluation.forecastEvidenceIds].sort(),c.forecastEvidenceIds)||
    !same([...p.evaluation.ambiguityEvidenceIds].sort(),c.ambiguityEvidenceIds)||
    !same([...p.evaluation.nominalScenarioProbabilities].sort((a,b)=>a[0].localeCompare(b[0])),
      [...c.priorScenarioWeights].sort((a,b)=>a[0].localeCompare(b[0])))||
    !same(compact(exact),compact(p.evaluation))||
    !same(compact(exact),c.robustValues)||
    exact.maximinExpectedPayoffAction!==p.evaluation.maximinExpectedPayoffAction||
    exact.minimaxRegretAction!==p.evaluation.minimaxRegretAction||
    exact.maximinExpectedPayoffAction!==c.maximinAction||
    exact.minimaxRegretAction!==c.minimaxRegretAction||
    exact.tailFraction!==p.evaluation.tailFraction||
    exact.minWorstExpectedShortfallAction!==p.evaluation.minWorstExpectedShortfallAction||
    exact.minWorstExpectedShortfallAction!==c.minWorstExpectedShortfallAction)
    throw new TypeError('independent receiving replay disagrees with conditional joint ambiguity proof');

  // Independent mathematical RECEIVING from the owning Metrologic numerical
  // layer, NOT another financial forecast or separate portfolio optimizer.
  // The existing financial game makes the proposed decision. Metrologic
  // checks its finite-law arithmetic over the SAME original joint worlds.
  const probabilityVector=forecast.scenarios.map(world=>world.probability);
  const worldIds=forecast.scenarios.map(world=>world.id);
  const within=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&
    Math.abs(x-y)<=1e-10+2e-12*Math.max(Math.abs(x),Math.abs(y));
  const candidates=new Map(exact.actionEvaluations.map(row=>[row.id,row]));
  const presented=new Map(p.evaluation.actionEvaluations.map(row=>[row.id,row]));
  const witness=(rows,values,expectedValue,reportedTV)=>{
    if(!Array.isArray(rows)||rows.length!==worldIds.length||
      new Set(rows.map(row=>row?.[0])).size!==worldIds.length||
      rows.some(row=>!Array.isArray(row)||row.length!==2||
        !worldIds.includes(row[0])||!Number.isFinite(row[1])||
        row[1]<0||row[1]>1))return false;
    const byId=new Map(rows),q=worldIds.map(id=>byId.get(id));
    const mass=q.reduce((acc,value)=>acc+value,0);
    const tv=q.reduce((acc,value,i)=>
      acc+Math.abs(value-probabilityVector[i]),0)/2;
    return Math.abs(mass-1)<=1e-9 &&
      tv<=ambiguity.totalVariationRadius+1e-9 &&
      within(reportedTV,tv)&&
      within(finiteLawExpectation({probabilities:q,values}),expectedValue);
  };
  for(const action of actions){
    const values=worldIds.map(id=>action.payoffsUsdByScenario[id]);
    const row=candidates.get(action.id),given=presented.get(action.id);
    if(!row||!given)
      throw new TypeError('Metrologic independent receiving lacks a bounded complete action row');
    const nominal=finiteLawExpectation({
      probabilities:probabilityVector,values,
    });
    const low=extremalTotalVariationExpectation({
      probabilities:probabilityVector,values,
      radius:ambiguity.totalVariationRadius,direction:'min',
    });
    const high=extremalTotalVariationExpectation({
      probabilities:probabilityVector,values,
      radius:ambiguity.totalVariationRadius,direction:'max',
    });
    const regret=Math.max(0,...actions.map(competing=>
      extremalTotalVariationExpectation({
        probabilities:probabilityVector,
        values:worldIds.map(id=>competing.payoffsUsdByScenario[id]-
          action.payoffsUsdByScenario[id]),
        radius:ambiguity.totalVariationRadius,direction:'max',
      }).value));
    if(!within(nominal,row.nominalExpectedUsd)||
       !within(low.value,row.worstCaseExpectedUsd)||
       !within(high.value,row.bestCaseExpectedUsd)||
       !within(regret,row.worstCaseRegretUsd)||
       !witness(given.worstCaseScenarioProbabilities,values,
         row.worstCaseExpectedUsd,given.worstCaseUsedTotalVariation)||
       !witness(given.bestCaseScenarioProbabilities,values,
         row.bestCaseExpectedUsd,given.bestCaseUsedTotalVariation))
      throw new TypeError('Metrologic finite-law receiving disagrees with original conditional probability proof or extremal witnesses');
    if(ambiguity.tailFraction!==undefined){
      const losses=values.map(value=>-value);
      const normal=upperTailMeanOfFiniteLaw({
        probabilities:probabilityVector,values:losses,
        tailFraction:ambiguity.tailFraction,
      });
      const adverse=upperTailMeanOfFiniteLaw({
        probabilities:low.probabilities,values:losses,
        tailFraction:ambiguity.tailFraction,
      });
      if(!within(normal,row.nominalExpectedShortfallUsd)||
         !within(adverse,row.worstCaseExpectedShortfallUsd))
        throw new TypeError('Metrologic probability-mass tail risk disagrees with the address-bound conditional proof');
    }
  }
  return {forecast,ambiguity,actions,replayed:exact};
}

/**
 * Reuse the existing prediction-market source SignCell representation for
 * robust model-evidence premises. Every receipt is only a CLAIM here; its
 * original bytes, issuer, scope and clock must be independently received by
 * Operations before it can become a SignCraft predecessor.
 */
export function robustActionSourceReceiptCells(projection,sourceReceipts){
  const {forecast,ambiguity}=requiredRobustProjection(projection);
  const byId=checkedSourceReceipts(projection.premiseIds,projection.at,sourceReceipts);
  const first=byId.get(forecast.id);
  if(compareTime(first.observedAt,forecast.observedAt)!==0||
    compareTime(first.availableAt,forecast.availableAt)!==0)
    throw new TypeError('original forecast receipt must match exact forecast observation and first-availability clocks');
  for(const id of forecast.evidenceIds)
    if(compareTime(byId.get(id).availableAt,forecast.observedAt)>0)
      throw new RangeError('forecast used evidence first available after model observation');
  for(const id of ambiguity.evidenceIds)
    if(compareTime(byId.get(id).availableAt,ambiguity.observedAt)>0)
      throw new RangeError('radius model used evidence first available after its observation');
  return sourceReceiptCellsOf([...byId.values()]);
}

/**
 * Native SignCraft/SignGraph receiving bridge for the conditional joint
 * ambiguity proof. Reuses the existing source-receipt SignCell predicate.
 *
 * Unlike the observed-signal composer, this expects all original-source and
 * model-receipt cells ALREADY in the supplied SignCraft history. A numerical
 * forecast ID and a radius claim must not conjure authenticated source bytes
 * or create an unsupported alternate receipt format.
 *
 * Different ambiguity assumptions are allowed as nonfunctional propositions;
 * they are not contradictory assertions of an authenticated market outcome.
 */
export function composeConditionalRobustActionHistory({
  history=createHistory(),projection,
  source='prediction-market-joint-ambiguity-research',
}={}){
  validateHistory(history);
  if(!named(source))throw new TypeError('named SignCraft source required');
  requiredRobustProjection(projection);

  // The source/derived-model receipts are not signed by this library.
  // Reject missing or ambiguous custody instead of laundering assumed
  // evidence into a newly created SignCraft source revision.
  const sources=projection.premiseIds.map(id=>{
    const existing=historySection(history,id,'prediction-market-source-receipt');
    if(existing.length!==1)
      throw new RangeError('one pre-received source or model receipt required for every conditional premise');
    const c=existing[0],o=c.object;
    if(o?.kind!=='prediction-market-source-receipt-v1'||
      !instant(o.observedAt)||!instant(o.availableAt)||
      compareTime(o.observedAt,o.availableAt)>0||
      compareTime(o.availableAt,projection.at)>0||
      !digest(o.sha256))
      throw new TypeError('preexisting source receipt is incomplete or later than inference');
    return c;
  });
  // A source-receipt cell with the right subject/object but invented support
  // does not count as received original custody. Reconstruct and validate
  // the exact cells using the SAME upstream source evidence carrier.
  const verifiedShape=robustActionSourceReceiptCells(projection,
    sources.map(c=>({id:c.subject,...c.object})));
  if(!same(verifiedShape,sources))
    throw new TypeError('existing source custody SignCells differ from the declared original-byte receipt shape');
  // The SignCell names the original forecast as its subject; causal edges
  // must target the NEW proof address, not form a self-loop on the forecast.
  const links=Object.freeze([...projection.premiseIds].sort()
    .map(id=>cell(id,'is-premise-of-conditional-robust-action-evaluation',
      projection.address,{
        for:[{kind:'conditional-inference-causal-reference-v1',
          rule:'finite-joint-total-variation-action-evaluation',
          proofAddress:projection.address,premiseId:id}],
      })));
  const graph=relationGraphOfCells(links);
  // The symmetric relation graph measures topology. SignGraph's existing
  // oriented 1-chain preserves the premise -> derived-result causal boundary.
  const flow=flowNetworkOfCells(links);
  const priorHeads=historyHeads(history);
  const already=originalCellAt(history,projection.cell);
  const missingLinks=links.filter(c=>!originalCellAt(history,c));
  if(already&&missingLinks.length)
    throw new RangeError('existing conditional evaluation has missing causal predecessor links');
  if(already)return Object.freeze({
    kind:'conditional-robust-action-sign-history-v1',status:'already-recorded',
    history,sourceCells:sources,linkCells:links,graph,flow,
    proofAddress:projection.address,proofRevisionId:null,
    priorHeads,heads:priorHeads,tradeEligible:false,orderEffect:false,
  });
  const next=observeHistory(history,[...missingLinks,projection.cell],{
    source:source+':conditional-inference',
  });
  const proofRevisionId=next.revisions.at(-1).id;
  if(!same(next.revisions.at(-1).parents,priorHeads))
    throw new Error('native SignCraft inference revision lost its source-receipt frontier');
  for(const c of [...sources,...links,projection.cell])
    if(!originalCellAt(next,c))
      throw new Error('native SignCraft history lost a required proof or causal source');
  return Object.freeze({
    kind:'conditional-robust-action-sign-history-v1',status:'composed',
    history:next,sourceCells:sources,linkCells:links,graph,flow,
    proofAddress:projection.address,proofRevisionId,
    priorHeads,heads:historyHeads(next),
    tradeEligible:false,orderEffect:false,
  });
}


/**
 * Existing SignCraft history is the carrier for opposing outcome tellings.
 *
 * No new "market receipt" or parallel event log: original market-game moves
 * remain the source and SignCraft stores only native SignCell consequences.
 * Claim IDs point to the resulting conditional proof addresses through real
 * SignGraph 1-chain edges. Historical contradictory versions are retained;
 * rerunning the same position is idempotent. The caller owns persistence.
 */
export function composeMarketOutcomeEvidenceHistory({
  history=createHistory(),state,at,source='market-game-outcome-evidence',
}={}) {
  validateHistory(history);
  if(!named(source))
    throw new TypeError('outcome evidence history requires a named source');
  const projection=projectMarketOutcomeEvidenceSigns({state,at});
  const links=projection.claims.flatMap(projected=>
    projected.claimIds.map(id=>cell(id,
      'is-causal-premise-of-market-outcome-sign',projected.address,{
        for:[{
          rule:'financial-outcome-evidential-projection',
          claimId:id,proofAddress:projected.address,
          sourceAuthenticated:false,
        }],
      })));
  const cells=[...projection.claims.map(x=>x.cell),...links];
  const existingHeads=historyHeads(history);
  const missing=cells.filter(c=>!originalCellAt(history,c));
  if(!missing.length)return Object.freeze({
    kind:'market-outcome-signcraft-reading-v1',status:'already-observed',
    history,projection,linkCells:links,graph:links.length?relationGraphOfCells(links):null,
    flow:links.length?flowNetworkOfCells(links):null,
    oldHeads:existingHeads,heads:existingHeads,
    tradeEligible:false,orderEffect:false,
  });
  const next=observeHistory(history,missing,{source});
  for(const c of cells)
    if(!originalCellAt(next,c))
      throw new Error('financial outcome claim or causal premise absent after SignCraft composition');
  return Object.freeze({
    kind:'market-outcome-signcraft-reading-v1',status:'composed',
    history:next,projection,linkCells:links,
    graph:links.length?relationGraphOfCells(links):null,
    flow:links.length?flowNetworkOfCells(links):null,
    oldHeads:existingHeads,heads:historyHeads(next),
    tradeEligible:false,orderEffect:false,
  });
}


/**
 * ONE canonical view of the shared Alpaca/Kalshi/EVM market game as:
 *
 *   SignCell + both witness sides --SCA--> identity
 *              --SEN--> typed data --SEAVT--> observation time
 *
 * Reuses the EXISTING SignCell and SEAVT providers, not a journal, schema,
 * receipt type, or a second market game. The MarketGame itself still holds
 * the bounded computational state needed for optimization; this is its
 * semantic reading for Operations, Science and Public Services.
 *
 * Bare venue snapshots/quotes are claims about supplied inputs; planner
 * decisions and scenarios are CONDITIONAL results. This function never
 * upgrades them to authenticated fills, profits, or order effects.
 *
 * One as-of read cannot see observations received after that instant.
 * Repeat reads use the ORIGINAL observation time, not the query time; thus
 * querying an unchanged game tomorrow doesn't create another financial
 * "observation" for the same economic event.
 *
 * The outcome facet uses the existing SignChain FOUR projection, retaining
 * contrary witnesses rather than building another truth state.
 */
export function marketGameSeavt(state,asOf){
 if(!instant(asOf)||!state||typeof state!=='object'||
    !state.observations||!state.accounts||!state.quotes||
    !state.strategies||!state.decisions||!state.outcomes)
   throw new TypeError('point-in-time shared financial game with native SEAVT coordinates required');
 const cutoff=asOf;
 const rows=[];
 const scope=[
  ['observations','market-game:observed-source-claim','source-unverified'],
  ['accounts','market-game:claimed-venue-account','account-unverified'],
  ['quotes','market-game:claimed-executable-quote','book-unverified'],
  ['strategies','market-game:proposed-strategy','strategy-conditional'],
  ['decisions','market-game:conditional-decision','decision-without-execution'],
 ];
 // Bound BEFORE allocating thousands of nested SEN terms. A bounded view
 // is not a claim that a much larger state has complete source coverage.
 const population=scope.reduce((n,[table])=>n+Object.keys(state[table]).length,0)
   +Object.keys(state.outcomes).length+(state.forecast?1:0);
 if(population>10000)
   throw new RangeError('finite source projection exceeds 10000 original observations');
 let count=0;
 const put=(c,at)=>{
   if(!instant(at))throw new TypeError('each financial SignCell needs an original absolute clock');
   if(compareTime(at,cutoff)>0)return;
   if(++count>10000)
     throw new RangeError('finite source projection exceeds 10000 original observations');
   rows.push(seavtOfSignCell(c,at));
 };
 for(const [table,predicate,qualification] of scope){
   for(const [id,record] of Object.entries(state[table])){
     if(!named(id)||!record||typeof record!=='object'||Array.isArray(record))
       throw new TypeError('well-formed existing financial game identity required');
     const at=table==='decisions'?record.at:record.observedAt;
     if(!instant(at))throw new TypeError('game record lacks its original observation/decision clock');
     if(compareTime(at,cutoff)>0)continue;
     if(table==='observations'&&
        (!instant(record.availableAt)||
         compareTime(record.availableAt,at)>0))
       throw new RangeError('unpublished market evidence cannot enter a native SignCell');
     // These positive witnesses establish that the existing game ADMITTED an
     // input/proposal; they do not authenticate the issuer or cash account.
     put(cell('market-game:'+table+':'+id,predicate,record,{
       for:[{kind:'market-game-admitted-input',qualification,
         originalId:id,sourceAuthenticated:false,orderEffect:false}],
     }),at);
   }
 }
 if(state.forecast!==null&&state.forecast!==undefined){
   const f=state.forecast;
   if(!named(f.id)||!instant(f.observedAt))
     throw new TypeError('shared forecast must carry its original clock and identity');
   if(compareTime(f.observedAt,cutoff)<=0)
     put(cell('market-game:forecast:'+f.id,
       'market-game:conditional-joint-scenario-law',f,{
         for:[{kind:'market-game-model-premise',conditional:true,
           sourceAuthenticated:false,orderEffect:false}],
       }),f.observedAt);
 }
 // The market-game source is a finite, already-admitted observation history.
 // Emit each original knowledge cut instead of only the final FOUR snapshot.
 // Otherwise a later negative/positive witness erases the earlier one-sided
 // state and no SignChain consumer can replay what was knowable at that time.
 const byEvent=new Map(),ids=new Set();
 for(const original of Object.values(state.outcomes)){
   if(!instant(original?.observedAt))
     throw new TypeError('native outcome evidence lacks its original absolute clock');
   if(compareTime(original.observedAt,cutoff)>0)continue;
   if(!named(original.receipt)||!named(original.id)||ids.has(original.id))
     throw new TypeError('native outcome evidence needs distinct claim and event identities');
   ids.add(original.id);
   const history=byEvent.get(original.receipt)??[];
   history.push(original);
   byEvent.set(original.receipt,history);
 }
 // Build native SignCells from the owning FOUR projector, one historical
 // cut per distinct observation instant within each original economic event.
 // Co-timed claims enter the same cut: do not invent an ordering for them.
 for(const events of byEvent.values()){
   events.sort((a,b)=>compareTime(a.observedAt,b.observedAt)||
     a.id.localeCompare(b.id));
   const known=Object.create(null);
   for(let i=0;i<events.length;){
     const at=events[i].observedAt;
     do{
       const original=events[i++];
       known[original.id]=original;
     }while(i<events.length&&compareTime(events[i].observedAt,at)===0);
     const projected=projectMarketOutcomeEvidenceSigns({
       state:{decisions:state.decisions,observations:state.observations,outcomes:known},
       at,
     });
     // Witness-set growth changes the SEAVT value, not the SCA subject.
     for(const claim of projected.claims)put(claim.cell,at);
   }
 }
 // At equal observation instants, order by the authoritative SCA name of
 // the complete EAVT witness. JSON.stringify(key/value) is not a semantic
 // identity and depends on incidental map-key spelling and insertion order.
 rows.sort((a,b)=>compareTime(a.t,b.t)||eavtId(a).localeCompare(eavtId(b)));
 return Object.freeze(rows);
}
