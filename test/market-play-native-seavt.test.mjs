import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {marketGame} from '../src/market-game.mjs';
import {hashPosition} from '@red-cup-engineering/gaming/running/rules';
import {cell} from '@red-cup-engineering/signcell/cell';
import {logOfSeavtRows} from '@red-cup-engineering/signchain/log';
import {seavtOfSignCell,signCellOfSeavt,compareAbsoluteSeavtClocks} from
  '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';
import {
 readMarketPlay,appendMarketMove,seavtOfMarketMove,
 migrateLegacyMarketPlay,marketMoveObservedAt,
} from '../src/play.mjs';

const at='2026-10-12T14:00:00.000000001Z';
const later='2026-10-12T14:00:00.000000002Z';
const received='2026-10-12T14:00:01Z';
const receivedLater='2026-10-12T14:00:02Z';
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
  const row0=appendMarketMove(fx.path,start,0,first,received);
  const next=marketGame.extend(start,first).state;
  const row1=appendMarketMove(fx.path,next,1,second,receivedLater,received);
  assert.equal(row0.t,received);
  assert.equal(row1.t,receivedLater);
  assert.equal(signCellOfSeavt(row0).for[0].sourceObservedAt,at);
  assert.equal(signCellOfSeavt(row1).for[0].sourceObservedAt,later);
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
  assert.equal(replay.lastReceivedAt,receivedLater);
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
  const rows=[seavtOfMarketMove(start,0,first,received),
    seavtOfMarketMove(state1,1,second,receivedLater)];
  for(const altered of [
   r=>{r[0].e=r[0].a;},
   r=>{r[1].v=r[0].v;},
   r=>{r[1].t=received;},
   r=>{r[1].v=r[0].v;r[1].e=r[0].e;},
  ]){
   const copy=structuredClone(rows);altered(copy);
   writeFileSync(fx.path,copy.map(x=>JSON.stringify(x)).join('\n')+'\n');
   await assert.rejects(readMarketPlay(fx.path));
  }
  writeFileSync(fx.path,'');
  appendMarketMove(fx.path,start,0,first,received);
  // The second writer was handed the wrong predecessor. It cannot
  // impersonate the correct source position by choosing sequence 1.
  appendMarketMove(fx.path,start,1,second,receivedLater,received);
  await assert.rejects(readMarketPlay(fx.path),/causal chain/);
 }finally{fx.close();}
});

test('one-time migration reads legacy only under its explicit command and verifies original state',async()=>{
 const fx=fixture();
 try{
  const legacyTimes=['2026-10-12T14:00:00Z','2026-10-12T14:00:00.001Z'];
  const moves=legacyTimes.map((clock,i)=>obs(i===0?'one':'two',clock));
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
  assert.equal(replay.state.observations.two.observedAt,legacyTimes[1]);
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

test('self-addressed fabricated evidence cannot authorize a market-game move',async()=>{
 const fx=fixture();
 try{
  const initial=marketGame.initialPosition();
  const canonical=seavtOfMarketMove(initial,0,obs('one',at),received);
  const original=signCellOfSeavt(canonical);
  const forged=cell(original.subject,original.predicate,original.object,{
   for:[{...original.for[0],grant:'orders:live',independentSourceAccepted:true}],
  });
  const selfAddressed=seavtOfSignCell(forged,canonical.t);
  // Both rows pass native SEN admission and individually match their OWN SCA
  // addresses. Only the canonical writer's full evidence identity refuses it.
  assert.deepEqual(signCellOfSeavt(selfAddressed),forged);
  writeFileSync(fx.path,JSON.stringify(selfAddressed)+'\n');
  await assert.rejects(readMarketPlay(fx.path),/causal chain/);
 }finally{fx.close();}
});

test('late older source data follows actual receipt order, not source timestamp order',async()=>{
 const fx=fixture();
 try{
  const start=marketGame.initialPosition(),recent=obs('recent',later),
    historic=obs('historic',at);
  writeFileSync(fx.path,'');
  const first=appendMarketMove(fx.path,start,0,recent,received);
  const after=marketGame.extend(start,recent).state;
  const second=appendMarketMove(fx.path,after,1,historic,receivedLater,received);
  assert.equal(signCellOfSeavt(first).for[0].sourceObservedAt,later);
  assert.equal(signCellOfSeavt(second).for[0].sourceObservedAt,at);
  assert.equal(compareAbsoluteSeavtClocks(first.t,second.t),-1);
  const replay=await readMarketPlay(fx.path);
  assert.equal(replay.rows,2);
  assert.equal(replay.lastReceivedAt,receivedLater);
  const rows=readFileSync(fx.path,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(logOfSeavtRows(rows,{asOf:received}).size,1,
    'older source cannot become knowable before later receipt');
  assert.equal(logOfSeavtRows(rows,{asOf:receivedLater}).size,2);
  assert.throws(()=>appendMarketMove(fx.path,replay.state,2,
   obs('future','2026-10-12T14:00:03Z'),receivedLater,receivedLater),
   /not before its source/);
  assert.throws(()=>appendMarketMove(fx.path,replay.state,2,
   obs('older',at),received,receivedLater),/monotone/);
 }finally{fx.close();}
});

test('nonmonotone legacy clocks refuse one-time migration without manufacturing receipt time',async()=>{
 const fx=fixture();
 try{
  const original=[
   {seq:0,intent:obs('newer','2026-10-12T14:00:00Z'),
     ts:Date.parse('2026-10-12T14:00:00Z')},
   {seq:1,intent:obs('older','2026-10-12T13:59:59Z'),
     ts:Date.parse('2026-10-12T13:59:59Z')},
  ].map(JSON.stringify).join('\n')+'\n';
  writeFileSync(fx.path,original);
  await assert.rejects(migrateLegacyMarketPlay(fx.path),/non-monotone/);
  assert.equal(readFileSync(fx.path,'utf8'),original);
 }finally{fx.close();}
});

test('unterminated last line is never an admitted or extendable SEAVT event',async()=>{
 const fx=fixture();
 try{
  const start=marketGame.initialPosition(),intent=obs('one',at);
  const first=seavtOfMarketMove(start,0,intent,received);
  const interrupted=JSON.stringify(first); // The final append lacks its LF.
  writeFileSync(fx.path,interrupted);
  await assert.rejects(readMarketPlay(fx.path),/unterminated final SEAVT line/);
  assert.throws(()=>appendMarketMove(fx.path,start,0,intent,received),
    /unterminated final SEAVT line/);
  assert.equal(readFileSync(fx.path,'utf8'),interrupted,
    'an interrupted append cannot be concealed by appending a new line');
 }finally{fx.close();}
});

test('market play cannot use a symlink as source, destination or migration target',async()=>{
 const fx=fixture();
 try{
  const real=fx.path+'.original';
  writeFileSync(real,'');
  symlinkSync(real,fx.path);
  const start=marketGame.initialPosition(),intent=obs('one',at);
  await assert.rejects(readMarketPlay(fx.path),/regular file/);
  assert.throws(()=>appendMarketMove(fx.path,start,0,intent,received),/regular file/);
  await assert.rejects(migrateLegacyMarketPlay(fx.path),/regular file/);
  assert.equal(readFileSync(real,'utf8'),'');
 }finally{fx.close();}
});
