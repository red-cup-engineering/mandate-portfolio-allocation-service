#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { readPublicObservation } from '../src/public-observations.mjs';
import { fitScenarioStudy } from '../src/scenario-study.mjs';
const args=process.argv.slice(2);
const opt=(key,fallback)=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1];};
const output=opt('output');if(!output)throw new TypeError('--output file is required');
const ticker=opt('market','KXFED-26OCT-T4.25');
if(!/^KXFED-\d{2}[A-Z]{3}-T\d+(?:\.\d+)?$/.test(ticker))throw new TypeError('bounded Fed threshold ticker required');
const cost=Number(opt('round-trip-cost','0.005'));if(!(cost>=0 && cost<1))throw new RangeError('explicit round-trip cost fraction required');
const end=Math.floor(Date.now()/86400000)*86400,start=end-90*86400;
const kalshiUrl=`https://api.elections.kalshi.com/trade-api/v2/series/KXFED/markets/${ticker}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=1440`;
const coinbaseUrl=`https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400&start=${new Date(start*1000).toISOString()}&end=${new Date(end*1000).toISOString()}`;
const acquired=await Promise.allSettled([readPublicObservation({source:kalshiUrl,externalId:ticker+'-history',retainResponse:true}),readPublicObservation({source:coinbaseUrl,externalId:'ETH-USD-history',retainResponse:true})]);
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
const study=fitScenarioStudy({rows,source,path:['signals',ticker,'midpoint'],bins:[{lower:0,upper:0.25},{lower:0.25,upper:0.5},{lower:0.5,upper:0.75},{lower:0.75,upper:1.000001}],scenarios:['up','down'],roundTripCostFraction:cost,observedAt:new Date().toISOString()});
const artifact={kind:'prediction-market-financial-strategy-study/v1',design:{signal:ticker,asset:'ETH-USD',windowDays:90,trainFraction:0.6,maximumSpread:0.1,minimumDailyVolume:0,maximumSignalAgeSeconds:86400,historicalAvailabilityAssumption:'Kalshi completed candle plus five minutes; actual historical delivery latency is unobserved',executionAssumption:'Coinbase daily first and last trade prices; venue fills, spread and Base gas are not observed; cost is an assumption',exploratory:true,causalClaim:false,reference:'https://www.federalreserve.gov/econres/feds/files/2026010pap.pdf'},sources:[kalshi,eth],rows,study};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,rows:rows.length,...study.scores,eligibleForLiveUse:study.eligibleForLiveUse}));
