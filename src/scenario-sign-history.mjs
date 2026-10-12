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
import {relationGraphOfCells} from '@red-cup-engineering/signgraph/cell-graph';

const named=x=>typeof x==='string'&&x.trim().length>0;
const instant=x=>typeof x==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&
  Number.isFinite(Date.parse(x));
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
  if(Date.parse(e.priorObservedAt)>Date.parse(e.priorAvailableAt)||
     Date.parse(e.priorAvailableAt)>Date.parse(e.observationObservedAt)||
     Date.parse(e.modelAvailableAt)>Date.parse(e.observationObservedAt)||
     Date.parse(e.observationObservedAt)>Date.parse(e.observationAvailableAt)||
     Date.parse(e.observationAvailableAt)>Date.parse(p.at))
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
       Date.parse(r.observedAt)>Date.parse(r.availableAt)||
       Date.parse(r.availableAt)>Date.parse(projection.at))
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
       Date.parse(r.observedAt)!==Date.parse(want.observedAt))
      throw new TypeError('source observation clock disagrees with its conditional proof');
    if(Date.parse(r.availableAt)!==Date.parse(want.availableAt))
      throw new TypeError('source availability clock disagrees with its conditional proof');
  }
  return Object.freeze([...byId.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
    .map(r=>cell(r.id,'prediction-market-source-receipt',{
      kind:'prediction-market-source-receipt-v1',sourceRef:r.sourceRef,
      issuer:r.issuer,sha256:r.sha256,
      observedAt:r.observedAt,availableAt:r.availableAt,
    },{for:[{kind:'source-custody-claim-v1',id:r.id,sha256:r.sha256}]})));
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
  let next=history;
  const priorHeads=historyHeads(next);
  const missing=receipts.filter(c=>!originalCellAt(next,c,{functional:true}));
  const existingProof=originalCellAt(next,projection.cell,{functional:true});
  const missingLinks=links.filter(c=>!originalCellAt(next,c));
  if(existingProof&&(missing.length||missingLinks.length))
    throw new RangeError('existing inference has missing source custody or causal predecessor links');
  if(existingProof)return {
    kind:'conditional-scenario-sign-history-v1',status:'already-recorded',
    history:next,sourceCells:receipts,linkCells:links,graph,
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
    history:next,sourceCells:receipts,linkCells:links,graph,
    proofAddress:projection.address,sourceRevisionId,
    proofRevisionId,priorHeads,heads:historyHeads(next),
    tradeEligible:false,orderEffect:false,
  });
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
  if(!named(source)||projection?.kind!=='conditional-robust-action-sign-projection-v1'||
    projection.sourceAuthenticated!==false||
    projection.radiusEmpiricallyVerified!==false||
    projection.tradeEligible!==false||projection.orderEffect!==false||
    !instant(projection.at)||!named(projection.address)||
    !projection.cell||address(projection.cell)!==projection.address||
    projection.cell.predicate!==
      'has-conditionally-derived-joint-scenario-robust-action-evaluation'||
    !same(projection.cell.object,projection.context)||
    projection.cell.subject!==projection.evaluation?.forecastId||
    projection.evaluation?.kind!=='joint-scenario-conditional-ambiguity-evaluation-v1'||
    projection.evaluation.at!==projection.at||
    !Array.isArray(projection.premiseIds)||projection.premiseIds.length<2||
    new Set(projection.premiseIds).size!==projection.premiseIds.length||
    !projection.premiseIds.every(named)||
    !Array.isArray(projection.cell.for)||projection.cell.for.length!==1||
    !Array.isArray(projection.cell.against)||projection.cell.against.length!==0||
    projection.cell.for[0]?.rule!=='finite-joint-total-variation-action-evaluation'||
    !same([...projection.cell.for[0].premises].sort(),
      [...projection.premiseIds].sort())||
    !Array.isArray(projection.sourceRelations)||
    projection.sourceRelations.length!==1||
    projection.sourceRelations[0]?.side!=='for'||
    projection.sourceRelations[0]?.rule!==projection.cell.for[0].rule||
    !same([...projection.sourceRelations[0].premises].sort(),
      [...projection.premiseIds].sort()))
    throw new TypeError('complete received native conditional robust SignCell proof required');
  const details=projection.context;
  if(details.forecastId!==projection.cell.subject||
    details.availableAt!==projection.at||
    !instant(details.forecastAvailableAt)||
    !instant(details.ambiguityObservedAt)||
    !instant(details.ambiguityAvailableAt)||
    Date.parse(details.forecastAvailableAt)>Date.parse(projection.at)||
    Date.parse(details.ambiguityObservedAt)>Date.parse(details.ambiguityAvailableAt)||
    Date.parse(details.ambiguityAvailableAt)>Date.parse(projection.at)||
    details.assumedTotalVariationRadius!==
      projection.evaluation.assumedTotalVariationRadius||
    details.maximinAction!==projection.evaluation.maximinExpectedPayoffAction||
    details.minimaxRegretAction!==projection.evaluation.minimaxRegretAction||
    !same(details.robustValues,
      [...projection.evaluation.actionEvaluations]
        .sort((a,b)=>a.id.localeCompare(b.id))
        .map(a=>[a.id,a.nominalExpectedUsd,a.worstCaseExpectedUsd,
          a.bestCaseExpectedUsd,a.worstCaseRegretUsd])))
    throw new TypeError('proof scope, evaluated joint values and source clocks disagree');

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
      Date.parse(o.observedAt)>Date.parse(o.availableAt)||
      Date.parse(o.availableAt)>Date.parse(projection.at)||
      !digest(o.sha256))
      throw new TypeError('preexisting source receipt is incomplete or later than inference');
    return c;
  });
  const links=Object.freeze([...projection.premiseIds].sort()
    .map(id=>cell(id,'is-premise-of-conditional-robust-action-evaluation',
      projection.cell.subject,{
        for:[{kind:'conditional-inference-causal-reference-v1',
          rule:'finite-joint-total-variation-action-evaluation',
          proofAddress:projection.address,premiseId:id}],
      })));
  const graph=relationGraphOfCells(links);
  const priorHeads=historyHeads(history);
  const already=originalCellAt(history,projection.cell);
  const missingLinks=links.filter(c=>!originalCellAt(history,c));
  if(already&&missingLinks.length)
    throw new RangeError('existing conditional evaluation has missing causal predecessor links');
  if(already)return Object.freeze({
    kind:'conditional-robust-action-sign-history-v1',status:'already-recorded',
    history,sourceCells:sources,linkCells:links,graph,
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
    history:next,sourceCells:sources,linkCells:links,graph,
    proofAddress:projection.address,proofRevisionId,
    priorHeads,heads:historyHeads(next),
    tradeEligible:false,orderEffect:false,
  });
}
