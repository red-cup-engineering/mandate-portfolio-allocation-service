import {hashPosition} from '@red-cup-engineering/gaming/running/rules';
import {readPublicObservation} from './public-observations.mjs';
import {fitScenarioStudy} from './scenario-study.mjs';
const documentation='https://docs.alpaca.markets/us/reference/stockbars';
const limitations=['historical delivery latency was not observed','IEX aggregates do not establish executable Alpaca prices, fills or total-market liquidity','bar first/last trade times are unobserved; daily window bounds are conservative proxies','round-trip cost is assumed; no independent acceptance or multiple-comparison certification'];

/** A connector response is preserved as that carrier, never relabeled as a
 * directly observed HTTP response or brokerage execution evidence. */
export function equityResearchSource(source){
 const request=source?.request,received=Date.parse(source?.receivedAt),response=source?.response;
 const symbols=typeof request?.symbols==='string'?request.symbols.split(','):[];
 if(source?.kind!=='alpaca-stock-bars-connector-evidence/v1'||source.gatewayTool!=='mcp__codex_apps__alpaca_live_get_stock_bars'||source.directHttpResponseObserved!==false||source.eligibleForLiveUse!==false||!Number.isFinite(received)||!symbols.length||symbols.length>8||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^[A-Z][A-Z0-9.]{0,9}$/.test(s))||request.timeframe!=='1Day'||request.feed!=='iex'||request.adjustment!=='raw'||request.currency!=='USD'||!Number.isFinite(Date.parse(request.start))||!Number.isFinite(Date.parse(request.end))||Date.parse(request.start)>=Date.parse(request.end)||Date.parse(request.end)>received||Date.parse(request.end)-Date.parse(request.start)>120*86400000||response?.isError!==false)throw new TypeError('bounded-declared-equity-connector-source-required');
 const data=response.structuredContent?.data;
 if(!data?.bars||typeof data.bars!=='object'||Array.isArray(data.bars)||data.next_page_token!==null||Object.keys(data.bars).some(s=>!symbols.includes(s)))throw new TypeError('complete-declared-equity-page-required');
 const retained=response.content?.filter(c=>c.type==='text');
 if(retained?.length!==1||hashPosition(JSON.parse(retained[0].text))!==hashPosition(response.structuredContent))throw new TypeError('retained-equity-connector-payload-mismatch');
 const midnight=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(const symbol of symbols){
  const bars=data.bars[symbol];if(!Array.isArray(bars)||!bars.length||bars.length>1000)throw new TypeError('bounded-complete-symbol-bars-required');
  const times=new Set();
  for(const bar of bars){const time=Date.parse(bar.t);
   if(!Number.isFinite(time)||time<Date.parse(request.start)||time>Date.parse(request.end)||times.has(time)||midnight.format(time)!=='00:00:00'||![bar.o,bar.c,bar.h,bar.l,bar.v].every(Number.isFinite)||bar.o<=0||bar.c<=0||bar.l<=0||bar.h<Math.max(bar.o,bar.c)||bar.l>Math.min(bar.o,bar.c)||bar.v<=0)throw new TypeError('unique-positive-equity-day-bars-required');
   times.add(time);
  }
 }
 return {id:hashPosition(source),symbols,bars:data.bars,receivedAt:new Date(received).toISOString(),documentation};
}

/** The declared family is evaluated separately with identical fixed rules.
 * Results are exploratory: no winner promotion, capital or fill claims. */
export async function researchPredictionMarketEquities({equitySource,market='KXFED-26OCT-T4.25',roundTripCostFraction=0.005,now=Date.now(),fetchImpl=fetch}={}){
 const equity=equityResearchSource(equitySource);
 if(!/^KXFED-\d{2}[A-Z]{3}-T\d+(?:\.\d+)?$/.test(market)||!Number.isFinite(now)||Date.parse(equity.receivedAt)>now||!Number.isFinite(roundTripCostFraction)||roundTripCostFraction<0||roundTripCostFraction>=1)throw new TypeError('declared-equity-prediction-study-required');
 const start=Math.floor(Date.parse(equitySource.request.start)/1000),end=Math.floor(Date.parse(equitySource.request.end)/1000);
 const source=`https://api.elections.kalshi.com/trade-api/v2/series/KXFED/markets/${market}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=1440`;
 const signal=await readPublicObservation({source,externalId:market+'-equity-history',retainResponse:true},{fetchImpl,now:new Date(now).toISOString()});
 const candles=signal.observation.value?.candlesticks;if(!Array.isArray(candles))throw new TypeError('documented-prediction-candle-carrier-required');
 const quotes=candles.map(c=>({at:c.end_period_ts,bid:Number(c.yes_bid?.close_dollars),ask:Number(c.yes_ask?.close_dollars),volume:Number(c.volume_fp)})).filter(q=>Number.isSafeInteger(q.at)&&Number.isFinite(q.bid)&&Number.isFinite(q.ask)&&q.bid>=0&&q.ask<=1&&q.bid<=q.ask&&q.ask-q.bid<=0.1&&q.volume>0).sort((a,b)=>a.at-b.at);
 const studies=[];
 for(const symbol of equity.symbols){
  const rows=[];
  for(const bar of [...equity.bars[symbol]].sort((a,b)=>Date.parse(a.t)-Date.parse(b.t))){
   const entry=Date.parse(bar.t),outcome=entry+86400000;
   if(outcome>Math.min(now,Date.parse(equitySource.request.end)))continue;
   const quote=quotes.findLast(q=>q.at*1000+300000<entry);if(!quote||entry-quote.at*1000>86400000)continue;
   const body={availableAt:new Date(quote.at*1000+300000).toISOString(),featureAt:new Date(quote.at*1000+300000).toISOString(),entryAt:bar.t,outcomeAt:new Date(outcome).toISOString(),value:(quote.bid+quote.ask)/2,returnFraction:bar.c/bar.o-1,scenario:bar.c>bar.o?'up':'down',evidenceIds:[signal.observation.id,equity.id]};
   rows.push({id:hashPosition(body),...body});
  }
  try{
   const study=fitScenarioStudy({rows,source:`https://api.elections.kalshi.com/trade-api/v2/markets/${market}`,path:['signals',market,'rawMidpoint'],bins:[{lower:0,upper:0.25},{lower:0.25,upper:0.5},{lower:0.5,upper:0.75},{lower:0.75,upper:1.000001}],scenarios:['up','down'],roundTripCostFraction,observedAt:signal.observation.observedAt,liveUseLimitations:limitations});
   studies.push({symbol,rows,status:'studied',study,eligibleForLiveUse:false});
  }catch(error){studies.push({symbol,rows,status:'insufficient-or-invalid-study',reason:error.message,eligibleForLiveUse:false});}
 }
 const body={kind:'prediction-market-equity-family-study/v1',observedAt:signal.observation.observedAt,design:{signal:market,assets:equity.symbols,feed:'iex',adjustment:'raw',currency:'USD',roundTripCostFraction,selectionRule:'the same training-bin long/cash rule for each declared symbol',timeRule:'signal candle end plus assumed five-minute availability precedes New York midnight; next midnight conservatively bounds the asset day',familySize:equity.symbols.length,winnerSelection:false,causalClaim:false,independentlyAccepted:false},sources:{signal,equities:equitySource},studies,eligibleForLiveUse:false};
 return {id:hashPosition(body),...body};
}
