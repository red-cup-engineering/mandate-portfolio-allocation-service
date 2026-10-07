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
