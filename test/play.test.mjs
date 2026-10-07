import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readMarketPlay} from '../src/play.mjs';
import {marketGame} from '../src/market-game.mjs';
const intent={kind:'observe',observation:{id:'test-only',source:'synthetic-test',observedAt:'2026-10-07T00:00:00Z',availableAt:'2026-10-07T00:00:00Z',value:1}};
test('streamed replay preserves the rules position and refuses missing or repeated moves',async()=>{
 const root=await mkdtemp(join(tmpdir(),'market-replay-')),path=join(root,'play.jsonl');
 try{
  await writeFile(path,JSON.stringify({seq:0,intent})+'\n');
  const result=await readMarketPlay(path);assert.deepEqual(result.state,marketGame.extend(marketGame.initialPosition(),intent).state);assert.equal(result.seq,0);assert.equal(result.rows,1);
  for(const entries of [[{seq:1,intent}],[{seq:0,intent},{seq:0,intent}],[{seq:0,intent,ts:'invalid'}]]){
   await writeFile(path,entries.map(x=>JSON.stringify(x)).join('\n')+'\n');await assert.rejects(readMarketPlay(path));
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
