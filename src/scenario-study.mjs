import { hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { observation } from './public-observations.mjs';
const instant = value => {const n=Date.parse(value);if(!Number.isFinite(n))throw new TypeError('study-time-required');return n;};
const mean = values => values.reduce((a,b)=>a+b,0)/values.length;

/** Fit a fixed binned likelihood on early resolved observations, then score
 * later observations exactly once. No tuning on the evaluation window. */
export function fitScenarioStudy({ rows, source, path, bins, scenarios, trainFraction=0.6, evaluationWindow, blockSize=7, roundTripCostFraction, observedAt, producer='urn:red-cup-engineering:mandate-portfolio-allocation-service:scenario-study', liveUseLimitations=[] }) {
  if (!Array.isArray(rows) || rows.length<20 || rows.length>20000 || !Array.isArray(bins) || bins.length<1 || bins.length>128 || !Array.isArray(scenarios) || scenarios.length!==2 || new Set(scenarios).size!==2) throw new TypeError('bounded-binary-scenario-study-required');
  if (!(trainFraction>=0.3 && trainFraction<=0.8) || !Number.isSafeInteger(blockSize) || blockSize<2 || !Number.isFinite(roundTripCostFraction) || roundTripCostFraction<0) throw new RangeError('fixed-study-design-required');
  if (bins.some((b,i)=>![b.lower,b.upper].every(Number.isFinite)||b.lower>=b.upper||(i && b.lower!==bins[i-1].upper))) throw new TypeError('ordered-contiguous-study-bins-required');
  if(!Array.isArray(liveUseLimitations)||liveUseLimitations.length>16||liveUseLimitations.some(x=>typeof x!=='string'||!x.length||x.length>200))throw new TypeError('bounded-study-limitations-required');
  const bucket = value => bins.findIndex(b=>value>=b.lower && value<b.upper);
  const ordered=[...rows].sort((a,b)=>instant(a.featureAt)-instant(b.featureAt));
  const ids=new Set();
  for(const row of ordered){
    if(!row.id || ids.has(row.id) || !Array.isArray(row.evidenceIds) || !row.evidenceIds.length || !Number.isFinite(row.value) || !Number.isFinite(row.returnFraction) || !scenarios.includes(row.scenario) || bucket(row.value)<0) throw new TypeError('unique-sourced-resolved-study-row-required');
    ids.add(row.id);
    if(instant(row.availableAt)>instant(row.featureAt) || instant(row.featureAt)>=instant(row.entryAt) || instant(row.entryAt)>=instant(row.outcomeAt) || instant(row.outcomeAt)>instant(observedAt))throw new RangeError('study-lookahead-refused');
  }
  const chronological=[...ordered].sort((a,b)=>instant(a.entryAt)-instant(b.entryAt));
  for(let i=1;i<chronological.length;i++)if(instant(chronological[i].entryAt)<instant(chronological[i-1].outcomeAt))throw new RangeError('overlapping-asset-return-observations-refused');
  if(evaluationWindow && (!(instant(evaluationWindow.start)<instant(evaluationWindow.end))||instant(evaluationWindow.end)>instant(observedAt)))throw new RangeError('completed-fixed-evaluation-window-required');
  const split=Math.floor(ordered.length*trainFraction);
  const evaluation=evaluationWindow?ordered.filter(row=>instant(row.featureAt)>=instant(evaluationWindow.start)&&instant(row.outcomeAt)<=instant(evaluationWindow.end)):ordered.slice(split);
  const training=evaluationWindow?ordered.filter(row=>instant(row.outcomeAt)<instant(evaluationWindow.start)):ordered.slice(0,split).filter(row=>instant(row.outcomeAt)<instant(evaluation[0].featureAt));
  if(training.length<10 || evaluation.length<10)throw new RangeError('resolved-training-and-evaluation-required');
  const counts=Object.fromEntries(scenarios.map(s=>[s,Array(bins.length).fill(1)]));
  for(const row of training)counts[row.scenario][bucket(row.value)]++;
  const totals=Object.fromEntries(scenarios.map(s=>[s,counts[s].reduce((a,b)=>a+b,0)]));
  const total=scenarios.reduce((a,s)=>a+totals[s],0);
  const prior=Object.fromEntries(scenarios.map(s=>[s,totals[s]/total]));
  const fittedBins=bins.map((b,i)=>({...b,likelihoods:Object.fromEntries(scenarios.map(s=>[s,counts[s][i]/totals[s]]))}));
  const trainingReturns=bins.map((_,i)=>training.filter(row=>bucket(row.value)===i).map(row=>row.returnFraction));
  const expectedReturns=trainingReturns.map(values=>({trainingSamples:values.length,gross:values.length?mean(values):null}));
  const predictions=evaluation.map(row=>{
    const weights=scenarios.map(s=>prior[s]*fittedBins[bucket(row.value)].likelihoods[s]);
    const p=weights[0]/(weights[0]+weights[1]), y=Number(row.scenario===scenarios[0]);
    const expectedGrossReturn=expectedReturns[bucket(row.value)].gross;
    const expectedNetReturn=expectedGrossReturn===null?null:expectedGrossReturn-roundTripCostFraction;
    const selected=expectedNetReturn!==null&&expectedNetReturn>0;
    return {rowId:row.id,featureAt:row.featureAt,outcomeAt:row.outcomeAt,prediction:p,outcome:y,brier:(p-y)**2,baselineBrier:(prior[scenarios[0]]-y)**2,
      expectedGrossReturn,expectedNetReturn,selected,strategyReturn:selected?row.returnFraction-roundTripCostFraction:0,baselineDailyReturn:row.returnFraction-roundTripCostFraction};
  });
  // Fixed calendar blocks keep dense or repeated looks from manufacturing weekly trials.
  const blockMillis=blockSize*86400000,blocks=new Map();
  const firstEntry=Math.min(...evaluation.map(row=>instant(row.entryAt)));
  const lastOutcome=Math.max(...evaluation.map(row=>instant(row.outcomeAt)));
  for(let i=0;i<evaluation.length;i++){
    const row=evaluation[i],key=Math.floor(instant(row.entryAt)/blockMillis),start=key*blockMillis,end=start+blockMillis;
    if(start<firstEntry||end>lastOutcome||instant(row.outcomeAt)>end)continue;
    if(!blocks.has(key))blocks.set(key,[]);blocks.get(key).push(predictions[i]);
  }
  const blockRows=[...blocks.entries()].sort(([a],[b])=>a-b).map(([,rows])=>rows);
  const blockMeans=blockRows.map(rows=>mean(rows.map(p=>p.baselineBrier-p.brier)));
  const m=blockMeans.length, variance=m>1?blockMeans.reduce((sum,x)=>sum+(x-mean(blockMeans))**2,0)/(m-1):null;
  // Conservative Student-t 97.5% critical value for the available block count.
  const critical=[Infinity,Infinity,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,2.120,2.110,2.101,2.093][Math.min(m,20)];
  const confidenceLowerBound=m>=3?mean(blockMeans)-critical*Math.sqrt(variance/m):null;
  const returnBlocks=blockRows.map(rows=>mean(rows.map(p=>p.strategyReturn)));
  const returnVariance=m>1?returnBlocks.reduce((sum,x)=>sum+(x-mean(returnBlocks))**2,0)/(m-1):null;
  const netReturnConfidenceLowerBound=m>=3?mean(returnBlocks)-critical*Math.sqrt(returnVariance/m):null;
  const scores={kind:'calibration',...(evaluationWindow?{evaluationWindow:{...evaluationWindow}}:{}),liveUseLimitations:[...new Set(liveUseLimitations)].sort(),sampleSize:predictions.length,brier:mean(predictions.map(p=>p.brier)),baselineBrier:mean(predictions.map(p=>p.baselineBrier)),windowEnd:predictions.at(-1).outcomeAt,
    confidenceLowerBound,netReturnConfidenceLowerBound,blockCount:m,blockSize,method:'fixed-binned-likelihood-and-return-temporal-holdout/v3',blockUnit:'complete fixed UTC calendar blocks; non-overlapping asset returns',trainingSamples:training.length,
    sourceObservationIds:[...new Set(rows.flatMap(row=>row.evidenceIds))].sort(),rowDigest:hashPosition(ordered),
    grossSelectionRule:'daily round trip when the bin mean asset return estimated from training exceeds the declared round-trip cost; otherwise cash',roundTripCostFraction,
    strategyMeanNetReturn:mean(predictions.map(p=>p.strategyReturn)),baselineDailyRoundTripMeanNetReturn:mean(predictions.map(p=>p.baselineDailyReturn)),
    scope:'exploratory single signal and asset; calendar-block approximation, no causal or cross-asset claim'};
  const scored=observation({source:producer,externalId:hashPosition(scores),availableAt:observedAt,observedAt,value:scores});
  const calibration={sampleSize:scores.sampleSize,brier:scores.brier,baselineBrier:scores.baselineBrier,windowEnd:scores.windowEnd,record:scored.observation.id,confidenceLowerBound,netReturnConfidenceLowerBound,liveUseLimitations:scores.liveUseLimitations};
  const specification={source,path,prior,bins:fittedBins,expectedReturns,calibration};
  const model=observation({source:producer,externalId:hashPosition(specification),availableAt:observedAt,observedAt,value:{kind:'scenario-likelihood-model',model:specification}});
  return {id:hashPosition({scores,specification}),scores,predictions,prior,model:{evidenceId:model.observation.id,specification},observations:[scored,model],
    eligibleForLiveUse:liveUseLimitations.length===0 && confidenceLowerBound!==null && confidenceLowerBound>0 && scores.brier<scores.baselineBrier && netReturnConfidenceLowerBound!==null && netReturnConfidenceLowerBound>0};
}
