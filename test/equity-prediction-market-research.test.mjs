import test from 'node:test';import assert from 'node:assert/strict';
import {equityResearchSource,researchPredictionMarketEquities} from '../src/equity-prediction-market-research.mjs';
function source(){
 const data={bars:{SPY:[{t:'2026-07-09T04:00:00Z',o:100,c:101,h:102,l:99,v:1000}]},next_page_token:null};
 const structuredContent={data};
 return {kind:'alpaca-stock-bars-connector-evidence/v1',receivedAt:'2026-10-08T04:00:00Z',gatewayTool:'mcp__codex_apps__alpaca_live_get_stock_bars',directHttpResponseObserved:false,eligibleForLiveUse:false,request:{symbols:'SPY',timeframe:'1Day',feed:'iex',adjustment:'raw',currency:'USD',start:'2026-07-09T00:00:00Z',end:'2026-10-08T00:00:00Z'},response:{isError:false,structuredContent,content:[{type:'text',text:JSON.stringify(structuredContent)}]}};
}
function reseal(s){s.response.content[0].text=JSON.stringify(s.response.structuredContent);return s;}
test('equity research retains connector identity without pretending it is directly observed HTTP or fills',()=>{
 const s=source();const result=equityResearchSource(s);assert.deepEqual(result.symbols,['SPY']);
 const changed=structuredClone(s);changed.response.structuredContent.data.bars.SPY[0].o=99;assert.throws(()=>equityResearchSource(changed),/payload-mismatch/);
});
test('incomplete pages, omitted symbols and non-midnight or duplicate bars cannot become a complete daily source',()=>{
 for(const mutate of [s=>{s.response.structuredContent.data.next_page_token='next';},s=>{s.request.symbols='SPY,QQQ';},s=>{s.response.structuredContent.data.bars.SPY[0].t='2026-07-09T13:30:00Z';},s=>{s.response.structuredContent.data.bars.SPY.push({...s.response.structuredContent.data.bars.SPY[0]});}]){
  const s=source();mutate(s);assert.throws(()=>equityResearchSource(reseal(s)),/page|required/);
 }
});
test('a source received after the declared research clock cannot supply available evidence',async()=>{
 await assert.rejects(researchPredictionMarketEquities({equitySource:source(),now:Date.parse('2026-10-07T00:00:00Z'),fetchImpl:()=>{throw Error('must not fetch');}}),/declared-equity/);
});
