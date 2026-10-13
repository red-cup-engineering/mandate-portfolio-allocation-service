import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {marketGame} from '../src/market-game.mjs';
import {hashPosition} from '@red-cup-engineering/gaming/running/rules';
import {signCellOfSeavt,compareAbsoluteSeavtClocks} from
  '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';
import {
 readMarketPlay,appendMarketMove,seavtOfMarketMove,
 migrateLegacyMarketPlay,marketMoveObservedAt,
} from '../src/play.mjs';

const at='2026-10-12T14:00:00.000000001Z';
const later='2026-10-12T14:00:00.000000002Z';
const obs=(id,observedAt)=>({kind:'observe',observation:{
 id,source:'urn:synthetic:kalshi-feed',observedAt,availableAt:observedAt,
 value:{market:'WX',costAtomic:'1234567',unitDecimals:6},
}});
const fixture=()=>{const dir=mkdtempSync(join(tmpdir(),'market-play-seavt-'));return{
 path:join(dir,'play.jsonl'),close:()=>rmSync(dir,{recursive:true,force:true}),
};};

test('two original moves persist as exact SCA/SEN/SEAVT rows in one causal chain',async()=>{
 const fx=fixture();
 try{
  writeFileSync(fx.path,'');
  const first=obs('one',at),second=obs('two',later);
  const start=marketGame.initialPosition();
  const row0=appendMarketMove(fx.path,start,0,first);
  const next=marketGame.extend(start,first).state;
  const row1=appendMarketMove(fx.path,next,1,second);
  assert.equal(row0.t,at);
  assert.equal(row1.t,later);
  assert.equal(compareAbsoluteSeavtClocks(row0.t,row1.t),-1);
  const firstCell=signCellOfSeavt(row0),secondCell=signCellOfSeavt(row1);
  assert.equal(firstCell.subject,hashPosition(start));
  assert.equal(secondCell.subject,hashPosition(next));
  assert.equal(firstCell.predicate,'market-game:admitted-move');
  assert.equal(firstCell.object.seq,0);
  assert.equal(secondCell.object.seq,1);
  assert.equal(firstCell.object.intent.observation.value.costAtomic,'1234567');
  assert.deepEqual(firstCell.against,[]);
  assert.equal(firstCell.for[0].sourceAuthenticated,false);
  const rows=readFileSync(fx.path,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows,[row0,row1]);
  assert.equal(Object.hasOwn(rows[0],'ts'),false);
  assert.equal(Object.hasOwn(rows[0],'intent'),false);
  const replay=await readMarketPlay(fx.path);
  assert.equal(replay.seq,1);
  assert.equal(replay.rows,2);
  assert.equal(hashPosition(replay.state),
   hashPosition(marketGame.extend(next,second).state));
  assert.deepEqual(Object.keys(replay.state.observations).sort(),['one','two']);
 }finally{fx.close();}
});

test('tampering with SCA, predecessor, sequence, or observation time is refused',async()=>{
 const fx=fixture();
 try{
  const first=obs('one',at),second=obs('two',later);
  const start=marketGame.initialPosition();
  const state1=marketGame.extend(start,first).state;
  const rows=[seavtOfMarketMove(start,0,first),
    seavtOfMarketMove(state1,1,second)];
  for(const altered of [
   r=>{r[0].e=r[0].a;},
   r=>{r[1].v=r[0].v;},
   r=>{r[1].t=at;},
   r=>{r[1].v=r[0].v;r[1].e=r[0].e;},
  ]){
   const copy=structuredClone(rows);altered(copy);
   writeFileSync(fx.path,copy.map(x=>JSON.stringify(x)).join('\n')+'\n');
   await assert.rejects(readMarketPlay(fx.path));
  }
  writeFileSync(fx.path,'');
  appendMarketMove(fx.path,start,0,first);
  // The second writer was handed the wrong predecessor. It cannot
  // impersonate the correct source position by choosing sequence 1.
  appendMarketMove(fx.path,start,1,second);
  await assert.rejects(readMarketPlay(fx.path),/causal chain/);
 }finally{fx.close();}
});

test('one-time migration reads legacy only under its explicit command and verifies original state',async()=>{
 const fx=fixture();
 try{
  const moves=[obs('one',at),obs('two',later)];
  const legacy=moves.map((intent,seq)=>({
   seq,intent,ts:Date.parse(marketMoveObservedAt(intent)),
  })).map(JSON.stringify).join('\n')+'\n';
  writeFileSync(fx.path,legacy);
  await assert.rejects(readMarketPlay(fx.path));
  const migrated=await migrateLegacyMarketPlay(fx.path);
  assert.equal(migrated.rows,2);
  assert.equal(readFileSync(fx.path+'.legacy-original','utf8'),legacy);
  const replay=await readMarketPlay(fx.path);
  assert.equal(migrated.position,hashPosition(replay.state));
  assert.equal(replay.rows,2);
  assert.equal(replay.state.observations.two.observedAt,later);
  await assert.rejects(migrateLegacyMarketPlay(fx.path),/already migrated/);
 }finally{fx.close();}
});

test('failed one-time migration leaves original evidence unchanged',async()=>{
 const fx=fixture();
 try{
  const broken=JSON.stringify({seq:0,intent:obs('bad','yesterday'),
    ts:Date.parse(at)})+'\n';
  writeFileSync(fx.path,broken);
  await assert.rejects(migrateLegacyMarketPlay(fx.path));
  assert.equal(readFileSync(fx.path,'utf8'),broken);
  await assert.rejects(readMarketPlay(fx.path));
 }finally{fx.close();}
});
