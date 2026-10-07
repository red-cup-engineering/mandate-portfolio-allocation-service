import {hashPosition} from '@red-cup-engineering/gaming/running/rules';
import {readPublicObservation} from './public-observations.mjs';
import {fitScenarioStudy} from './scenario-study.mjs';

/** One declared exploratory prediction-market/ETH study; no credentials, trading or publication. */
export async function researchPredictionMarketStrategy({market='KXFED-26OCT-T4.25',roundTripCostFraction=0.005,now=Date.now(),fetchImpl=fetch}={}) {
 if(!Number.isFinite(now)||typeof fetchImpl!=='function')throw new TypeError('research-clock-and-public-fetch-required');
const ticker=market;
if(!/^KXFED-\d{2}[A-Z]{3}-T\d+(?:\.\d+)?$/.test(ticker))throw new TypeError('bounded Fed threshold ticker required');
const cost=roundTripCostFraction;if(!(cost>=0 && cost<1))throw new RangeError('explicit round-trip cost fraction required');
const end=Math.floor(now/86400000)*86400,start=end-90*86400;
const kalshiUrl=`https://api.elections.kalshi.com/trade-api/v2/series/KXFED/markets/${ticker}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=1440`;
const coinbaseUrl=`https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400&start=${new Date(start*1000).toISOString()}&end=${new Date(end*1000).toISOString()}`;
const acquired=await Promise.allSettled([readPublicObservation({source:kalshiUrl,externalId:ticker+'-history',retainResponse:true},{fetchImpl,now:new Date(now).toISOString()}),readPublicObservation({source:coinbaseUrl,externalId:'ETH-USD-history',retainResponse:true},{fetchImpl,now:new Date(now).toISOString()})]);
for(const r of acquired)if(r.status==='rejected')throw r.reason;
const [kalshi,eth]=acquired.map(r=>r.value);
if(!Array.isArray(kalshi.observation.value.candlesticks)||!Array.isArray(eth.observation.value))throw new TypeError('documented candle carriers required');
const quotes=kalshi.observation.value.candlesticks.map(c=>({at:c.end_period_ts,bid:Number(c.yes_bid?.close_dollars),ask:Number(c.yes_ask?.close_dollars),volume:Number(c.volume_fp)})).filter(q=>Number.isSafeInteger(q.at)&&q.bid>=0&&q.ask<=1&&q.bid<=q.ask&&q.ask-q.bid<=0.1&&q.volume>0).sort((a,b)=>a.at-b.at);
const rows=[];
for(const candle of [...eth.observation.value].sort((a,b)=>a[0]-b[0])){
 const [at,,,open,close]=candle;
 if(!Number.isSafeInteger(at)||at<start||at+86400>end||!(open>0)||!(close>0))continue;
 // Only a completed, recently traded Kalshi candle available BEFORE entry.
 const q=quotes.findLast(q=>q.at+300<at);if(!q || at-q.at>86400)continue;
 const body={availableAt:new Date((q.at+300)*1000).toISOString(),featureAt:new Date((q.at+300)*1000).toISOString(),entryAt:new Date(at*1000).toISOString(),outcomeAt:new Date((at+86400)*1000).toISOString(),value:(q.bid+q.ask)/2,returnFraction:close/open-1,scenario:close>open?'up':'down',evidenceIds:[kalshi.observation.id,eth.observation.id]};
 rows.push({id:hashPosition(body),...body});
}
const source=`https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=${ticker.split('-').slice(0,2).join('-')}&status=open&limit=100`;
const study=fitScenarioStudy({rows,source,path:['signals',ticker,'rawMidpoint'],bins:[{lower:0,upper:0.25},{lower:0.25,upper:0.5},{lower:0.5,upper:0.75},{lower:0.75,upper:1.000001}],scenarios:['up','down'],roundTripCostFraction:cost,observedAt:new Date(Math.max(now,...[kalshi,eth].map(row=>Date.parse(row.observation.observedAt)))).toISOString(),liveUseLimitations:['historical delivery latency was not observed','venue fills, spread and Base gas were not observed; cost is an assumption']});
return {kind:'prediction-market-financial-strategy-study/v1',design:{signal:ticker,signalFeature:'unadjusted contract best-bid/ask midpoint',asset:'ETH-USD',windowDays:90,trainFraction:0.6,maximumSpread:0.1,minimumDailyVolume:0,maximumSignalAgeSeconds:86400,historicalAvailabilityAssumption:'Kalshi completed candle plus five minutes; actual historical delivery latency is unobserved',executionAssumption:'Coinbase daily first and last trade prices; venue fills, spread and Base gas are not observed; cost is an assumption',exploratory:true,causalClaim:false,reference:'https://www.federalreserve.gov/econres/feds/files/2026010pap.pdf'},sources:[kalshi,eth],rows,study};

}

/** Acquire the signal BEFORE the asset mark. These are prospective public
 * observations, never retrospective entry prices, fills or confidence. */
export async function observePredictionMarketStrategy({market='KXFED-26OCT-T4.25',now=Date.now(),fetchImpl=fetch}={}) {
 if(!/^KXFED-\d{2}[A-Z]{3}-T\d+(?:\.\d+)?$/.test(market)||!Number.isFinite(now))throw new TypeError('declared-market-and-observation-clock-required');
 const signal=await readPublicObservation({source:`https://api.elections.kalshi.com/trade-api/v2/markets/${market}`,externalId:market,retainResponse:true},{fetchImpl,now:new Date(now).toISOString()});
 const m=signal.observation.value.market;
 const bid=Number(m?.yes_bid_dollars),ask=Number(m?.yes_ask_dollars);
 if(m?.ticker!==market||m.status!=='active'||m.yes_bid_dollars==null||m.yes_ask_dollars==null||!Number.isFinite(bid)||!Number.isFinite(ask)||bid<0||ask>1||bid>ask||ask-bid>0.1||!(Date.parse(m.close_time)>Date.parse(signal.observation.observedAt)))throw new TypeError('active-bounded-signal-price-required');
 const asset=await readPublicObservation({source:'https://api.exchange.coinbase.com/products/ETH-USD/ticker',externalId:'ETH-USD',retainResponse:true},{fetchImpl,now:signal.observation.observedAt});
 const ticker=asset.observation.value,assetBid=Number(ticker.bid),assetAsk=Number(ticker.ask);
 if(ticker.bid==null||ticker.ask==null||!Number.isFinite(assetBid)||!Number.isFinite(assetAsk)||!(assetBid>0)||assetAsk<assetBid)throw new TypeError('positive-uncrossed-asset-price-required');
 const body={kind:'prediction-market-prospective-observation/v1',market,asset:'ETH-USD',featureAt:signal.observation.observedAt,observedAt:asset.observation.observedAt,rawMidpoint:(bid+ask)/2,signalBid:bid,signalAsk:ask,assetBid,assetAsk,sources:[signal,asset],interpretation:'observed signal followed by indicative public asset quotes; no fills or outcome',eligibleForLiveUse:false};
 return {id:hashPosition(body),...body};
}

/** Resolve chronological daily intervals from acquired quotes. Extra looks
 * cannot become extra trials, and a missing endpoint is never backfilled. */
export function resolveProspectiveStrategyRows({observations,observedAt}) {
 if(!Array.isArray(observations)||observations.length>20000||!Number.isFinite(Date.parse(observedAt)))throw new TypeError('bounded-prospective-history-required');
 const unique=new Map();
 for(const observation of observations){
  const {id,...body}=observation;
  if(id!==hashPosition(body)||body.kind!=='prediction-market-prospective-observation/v1'||body.asset!=='ETH-USD'||!Number.isFinite(body.assetBid)||!Number.isFinite(body.assetAsk)||!(body.assetBid>0)||!(body.assetAsk>=body.assetBid)||!Number.isFinite(body.rawMidpoint)||body.rawMidpoint<0||body.rawMidpoint>1||!Number.isFinite(Date.parse(body.featureAt))||!Number.isFinite(Date.parse(body.observedAt))||Date.parse(body.featureAt)>=Date.parse(body.observedAt)||Date.parse(body.observedAt)>Date.parse(observedAt)||body.sources?.length!==2)throw new TypeError('identified-causal-prospective-observation-required');
  if(body.sources[0]?.observation?.observedAt!==body.featureAt||body.sources[1]?.observation?.observedAt!==body.observedAt)throw new TypeError('prospective-source-clock-mismatch');
  unique.set(id,observation);
 }
 const ordered=[...unique.values()].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.id.localeCompare(b.id));
 if(new Set(ordered.map(row=>row.market)).size>1)throw new TypeError('one-declared-prospective-market-required');
 const rows=[];let entry=ordered[0],missedEndpoints=0;
 for(const exit of ordered.slice(1)){
  const elapsed=Date.parse(exit.observedAt)-Date.parse(entry.observedAt);
  if(elapsed<86400000)continue;
  if(elapsed>87600000){missedEndpoints++;entry=exit;continue;}
  const body={availableAt:entry.featureAt,featureAt:entry.featureAt,entryAt:entry.observedAt,outcomeAt:exit.observedAt,value:entry.rawMidpoint,returnFraction:exit.assetBid/entry.assetAsk-1,scenario:(exit.assetBid+exit.assetAsk)>(entry.assetBid+entry.assetAsk)?'up':'down',evidenceIds:[entry.sources[0].observation.id,entry.sources[1].observation.id,exit.sources[1].observation.id],prospectiveObservationIds:[entry.id,exit.id]};
  rows.push({id:hashPosition(body),...body});entry=exit;
 }
 return {rows,observations:ordered.length,missedEndpoints,pendingEntry:entry?.id??null,design:{horizonSeconds:86400,maximumEndpointDelaySeconds:1200,entryRule:'earliest acquired observation, then each accepted endpoint; missed endpoint resets without a return',returnRule:'observed exit bid / observed entry ask - 1',scenarioRule:'public quote midpoint direction',fillsObserved:false,gasObserved:false}};
}

/** Prospective acquired quotes replace historical availability assumptions, but
 * cannot attest fills, gas, independent review or a frozen evaluation protocol. */
export function studyProspectiveStrategy({observations,observedAt,roundTripCostFraction=0.005}) {
 const resolved=resolveProspectiveStrategyRows({observations,observedAt});
 if(!Number.isFinite(roundTripCostFraction)||roundTripCostFraction<0||roundTripCostFraction>=1)throw new TypeError('bounded-explicit-research-cost-required');
 const split=Math.floor(resolved.rows.length*0.6);
 const evaluation=resolved.rows.slice(split);
 const training=evaluation.length?resolved.rows.slice(0,split).filter(row=>Date.parse(row.outcomeAt)<Date.parse(evaluation[0].featureAt)):[];
 if(training.length<10||evaluation.length<10)return {status:'awaiting-resolved-outcomes',completedIntervals:resolved.rows.length,trainingSamples:training.length,evaluationSamples:evaluation.length,eligibleForLiveUse:false};
 const market=observations[0].market;
 const study=fitScenarioStudy({rows:resolved.rows,source:`https://api.elections.kalshi.com/trade-api/v2/markets/${market}`,path:['signals',market,'rawMidpoint'],bins:[{lower:0,upper:0.25},{lower:0.25,upper:0.5},{lower:0.5,upper:0.75},{lower:0.75,upper:1.000001}],scenarios:['up','down'],roundTripCostFraction,observedAt,liveUseLimitations:['public indicative quotes do not attest venue fills or Base gas; additional cost is assumed','repeated exploratory temporal holdouts are not a frozen independently reviewed prospective test']});
 return {status:'studied',market,completedIntervals:resolved.rows.length,study,eligibleForLiveUse:study.eligibleForLiveUse};
}
