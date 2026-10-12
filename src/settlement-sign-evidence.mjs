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

const identity=s=>typeof s==='string'&&s.trim().length>0;
const available=t=>typeof t==='string'&&Number.isFinite(Date.parse(t));
const CHANNELS=Object.freeze([
  'source-conditional','proxy-counterfactual','rate-counterfactual',
  'other-conditional-research',
]);
const witnessId=w=>w.premises.join('|')+':'+w.rule+':'+w.scope;
const ordered=xs=>xs.slice().sort((a,b)=>witnessId(a).localeCompare(witnessId(b));

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
   channel,at,cell:sign,address:address(sign),
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
