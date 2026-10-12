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
