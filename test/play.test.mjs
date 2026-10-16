import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readMarketPlay,seavtOfMarketMove} from '../src/play.mjs';
import {marketGame} from '../src/market-game.mjs';
const intent={kind:'observe',observation:{id:'test-only',source:'synthetic-test',observedAt:'2026-10-07T00:00:00Z',availableAt:'2026-10-07T00:00:00Z',value:1}};
test('streamed replay preserves the rules position and refuses missing or repeated moves',async()=>{
 const root=await mkdtemp(join(tmpdir(),'market-replay-')),path=join(root,'play.jsonl');
 try{
  // Moves are native SEAVT rows, written as the play log writes them; a legacy {seq, intent} record is refused.
  const at='2026-10-07T00:00:01Z',start=marketGame.initialPosition(),first=seavtOfMarketMove(start,0,intent,at);
  await writeFile(path,JSON.stringify(first)+'\n');
  const result=await readMarketPlay(path);assert.deepEqual(result.state,marketGame.extend(start,intent).state);assert.equal(result.seq,0);assert.equal(result.rows,1);
  for(const entries of [[seavtOfMarketMove(start,1,intent,at)],[first,first],[{seq:0,intent}]]){
   await writeFile(path,entries.map(x=>JSON.stringify(x)).join('\n')+'\n');await assert.rejects(readMarketPlay(path));
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
