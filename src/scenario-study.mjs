import { hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { observation } from './public-observations.mjs';
const instant = value => {const n=Date.parse(value);if(!Number.isFinite(n))throw new TypeError('study-time-required');return n;};
const mean = values => values.reduce((a,b)=>a+b,0)/values.length;

/** Fit a fixed binned likelihood on early resolved observations, then score
 * later observations exactly once. No tuning on the evaluation window. */
export function fitScenarioStudy({ rows, source, path, bins, scenarios, trainFraction=0.6, blockSize=7, roundTripCostFraction, observedAt, producer='urn:561-group:lenticule-science' }) {
  if (!Array.isArray(rows) || rows.length<20 || rows.length>20000 || !Array.isArray(bins) || bins.length<1 || bins.length>128 || !Array.isArray(scenarios) || scenarios.length!==2 || new Set(scenarios).size!==2) throw new TypeError('bounded-binary-scenario-study-required');
  if (!(trainFraction>=0.3 && trainFraction<=0.8) || !Number.isSafeInteger(blockSize) || blockSize<2 || !Number.isFinite(roundTripCostFraction) || roundTripCostFraction<0) throw new RangeError('fixed-study-design-required');
  if (bins.some((b,i)=>![b.lower,b.upper].every(Number.isFinite)||b.lower>=b.upper||(i && b.lower!==bins[i-1].upper))) throw new TypeError('ordered-contiguous-study-bins-required');
  const bucket = value => bins.findIndex(b=>value>=b.lower && value<b.upper);
  const ordered=[...rows].sort((a,b)=>instant(a.featureAt)-instant(b.featureAt));
  const ids=new Set();
  for(const row of ordered){
    if(!row.id || ids.has(row.id) || !Array.isArray(row.evidenceIds) || !row.evidenceIds.length || !Number.isFinite(row.value) || !Number.isFinite(row.returnFraction) || !scenarios.includes(row.scenario) || bucket(row.value)<0) throw new TypeError('unique-sourced-resolved-study-row-required');
    ids.add(row.id);
    if(instant(row.availableAt)>instant(row.featureAt) || instant(row.featureAt)>=instant(row.entryAt) || instant(row.entryAt)>=instant(row.outcomeAt) || instant(row.outcomeAt)>instant(observedAt))throw new RangeError('study-lookahead-refused');
  }
  const split=Math.floor(ordered.length*trainFraction), evaluation=ordered.slice(split);
  const training=ordered.slice(0,split).filter(row=>instant(row.outcomeAt)<instant(evaluation[0].featureAt));
  if(training.length<10 || evaluation.length<10)throw new RangeError('resolved-training-and-evaluation-required');
  const counts=Object.fromEntries(scenarios.map(s=>[s,Array(bins.length).fill(1)]));
  for(const row of training)counts[row.scenario][bucket(row.value)]++;
  const totals=Object.fromEntries(scenarios.map(s=>[s,counts[s].reduce((a,b)=>a+b,0)]));
  const total=scenarios.reduce((a,s)=>a+totals[s],0);
  const prior=Object.fromEntries(scenarios.map(s=>[s,totals[s]/total]));
  const fittedBins=bins.map((b,i)=>({...b,likelihoods:Object.fromEntries(scenarios.map(s=>[s,counts[s][i]/totals[s]]))}));
  const predictions=evaluation.map(row=>{
    const weights=scenarios.map(s=>prior[s]*fittedBins[bucket(row.value)].likelihoods[s]);
    const p=weights[0]/(weights[0]+weights[1]), y=Number(row.scenario===scenarios[0]);
    return {rowId:row.id,featureAt:row.featureAt,outcomeAt:row.outcomeAt,prediction:p,outcome:y,brier:(p-y)**2,baselineBrier:(prior[scenarios[0]]-y)**2,
      strategyReturn:p>0.5?row.returnFraction-roundTripCostFraction:0,baselineDailyReturn:row.returnFraction-roundTripCostFraction};
  });
  const improvements=predictions.map(p=>p.baselineBrier-p.brier), blockMeans=[];
  for(let i=0;i+blockSize<=improvements.length;i+=blockSize)blockMeans.push(mean(improvements.slice(i,i+blockSize)));
  const m=blockMeans.length, variance=m>1?blockMeans.reduce((sum,x)=>sum+(x-mean(blockMeans))**2,0)/(m-1):null;
  // Conservative Student-t 97.5% critical value for the available block count.
  const critical=[Infinity,Infinity,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,2.120,2.110,2.101,2.093][Math.min(m,20)];
  const confidenceLowerBound=m>=3?mean(blockMeans)-critical*Math.sqrt(variance/m):null;
  const scores={kind:'calibration',sampleSize:predictions.length,brier:mean(predictions.map(p=>p.brier)),baselineBrier:mean(predictions.map(p=>p.baselineBrier)),windowEnd:predictions.at(-1).outcomeAt,
    confidenceLowerBound,blockCount:m,blockSize,method:'fixed-binned-likelihood-temporal-holdout/v1',trainingSamples:training.length,
    sourceObservationIds:[...new Set(rows.flatMap(row=>row.evidenceIds))].sort(),rowDigest:hashPosition(ordered),
    grossSelectionRule:'daily round trip when fitted positive-return probability exceeds 0.5; otherwise cash',roundTripCostFraction,
    strategyMeanNetReturn:mean(predictions.map(p=>p.strategyReturn)),baselineDailyRoundTripMeanNetReturn:mean(predictions.map(p=>p.baselineDailyReturn)),
    scope:'exploratory single signal and asset; independent weekly-block approximation, no causal or cross-asset claim'};
  const scored=observation({source:producer,externalId:hashPosition(scores),availableAt:observedAt,observedAt,value:scores});
  const calibration={sampleSize:scores.sampleSize,brier:scores.brier,baselineBrier:scores.baselineBrier,windowEnd:scores.windowEnd,record:scored.observation.id,confidenceLowerBound};
  const specification={source,path,prior,bins:fittedBins,calibration};
  const model=observation({source:producer,externalId:hashPosition(specification),availableAt:observedAt,observedAt,value:{kind:'scenario-likelihood-model',model:specification}});
  return {id:hashPosition({scores,specification}),scores,predictions,prior,model:{evidenceId:model.observation.id,specification},observations:[scored,model],
    eligibleForLiveUse:confidenceLowerBound!==null && confidenceLowerBound>0 && scores.brier<scores.baselineBrier && scores.strategyMeanNetReturn>0};
}
