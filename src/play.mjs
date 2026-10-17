/**
 * The market game's one durable play: an append-only native SEAVT SignChain.
 * Each original admitted move is one SCA-addressed SignCell encoded in SEN;
 * there is no parallel {seq,intent,ts} operational journal.
 *
 * The only legacy reader is the explicit, one-time migration below. The
 * normal reader refuses legacy rows, preventing perpetual dual formats.
 */
import {
  createReadStream,lstatSync,openSync,closeSync,writeSync,readSync,
  fstatSync,fsyncSync,renameSync,linkSync,unlinkSync,constants,
} from 'node:fs';
import {createInterface} from 'node:readline';
import {dirname} from 'node:path';
import {validatePlayRecord} from '@red-cup-engineering/gaming/running/play-record';
import {hashPosition} from '@red-cup-engineering/gaming/running/rules';
import {cell,coincides,measured} from '@red-cup-engineering/signcell/cell';
import {seavtOfSignCell,signCellOfSeavt,
  isAbsoluteSeavtClock,compareAbsoluteSeavtClocks} from
  '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';
import {marketGame} from './market-game.mjs';
import {historySection} from '@red-cup-engineering/signcraft/history';
import {projectAgentPredictionFillSourceSigns} from './scenario-sign-history.mjs';

const PLAY_BYTES_MAX=128*1048576;
const LINE_BYTES_MAX=4*1048576;
const ROW_LIMIT=20000;
const predicate='market-game:admitted-move';

export function marketMoveObservedAt(intent){
  const source={
    observe:intent?.observation,account:intent?.account,
    quote:intent?.quote,strategy:intent?.strategy,
    forecast:intent?.forecast,outcome:intent?.outcome,
  }[intent?.kind];
  const at=source?.observedAt ??
    (['condition','decide','decide-fleet'].includes(intent?.kind)
      ? intent.at:undefined);
  if(!isAbsoluteSeavtClock(at))
    throw new TypeError('market move requires its original absolute observation/decision clock');
  return at;
}

/** Admit one already-defined move and bind it to its actual predecessor.
 * The producer makes no assertion that publisher bytes are authenticated. */
export function seavtOfMarketMove(state,seq,intent,receivedAt){
  if(!Number.isSafeInteger(seq)||seq<0)
    throw new TypeError('market move sequence must be a nonnegative safe integer');
  marketGame.extend(state,intent); // Validate before serializing or writing.
  const sourceObservedAt=marketMoveObservedAt(intent);
  if(!isAbsoluteSeavtClock(receivedAt)||
     compareAbsoluteSeavtClocks(sourceObservedAt,receivedAt)>0)
    throw new TypeError('market move requires an absolute receiving clock not before its source');
  return seavtOfSignCell(cell(hashPosition(state),predicate,{seq,intent},{
    for:[{kind:'market-game-original-move',sourceObservedAt,receivedAt,
      sourceAuthenticated:false,independentlyReconciled:false,
      orderEffect:false}],
  }),receivedAt);
}

/** Only actual regular play files are admitted; a symlink can redirect an
 * authorized finance write to unrelated data. The source file is never
 * automatically created or truncated by the existing writer. */
const boundedFile=(path,maxBytes=PLAY_BYTES_MAX)=>{
  const stats=lstatSync(path);
  if(!stats.isFile()||stats.size>maxBytes)
    throw new RangeError('market play must be a bounded regular file, not a symlink');
  return stats;
};
const nativeFlags=write=>{
  if(!Number.isInteger(constants.O_NOFOLLOW))
    throw new Error('native play requires a no-follow filesystem');
  return (write?constants.O_RDWR|constants.O_APPEND:constants.O_RDONLY)|
    constants.O_NOFOLLOW;
};
const openChecked=(path,write=false)=>{
  const fd=openSync(path,nativeFlags(write));
  if(!fstatSync(fd).isFile()){
    closeSync(fd);throw new TypeError('market play must be an actual regular file');
  }
  return fd;
};
const completeLines=(fd,size)=>{
  if(size===0)return;
  const last=Buffer.allocUnsafe(1);
  if(readSync(fd,last,0,1,size-1)!==1||last[0]!==10)
    throw new TypeError('market play has an unterminated final SEAVT line');
};
const syncParentDirectory=path=>{
  const fd=openSync(dirname(path),constants.O_RDONLY);
  try{fsyncSync(fd);}finally{closeSync(fd);}
};
const writeFull=(fd,content)=>{
  const bytes=Buffer.from(content,'utf8');
  let n=0;
  while(n<bytes.length){
    const written=writeSync(fd,bytes,n,bytes.length-n);
    if(written<=0)throw new Error('market play short write');
    n+=written;
  }
};
const serialized=row=>{
  const line=JSON.stringify(row)+'\n';
  if(Buffer.byteLength(line)>LINE_BYTES_MAX)
    throw new RangeError('native SEAVT play row exceeds 4 MiB');
  return line;
};

/** Append a native SignCell/SEAVT event; caller holds the play's lock. */
export function appendMarketMove(path,state,seq,intent,receivedAt,precedingReceivedAt=null){
  if(seq>0&&(precedingReceivedAt===null||
       !isAbsoluteSeavtClock(precedingReceivedAt)||
       compareAbsoluteSeavtClocks(receivedAt,precedingReceivedAt)<0))
    throw new RangeError('market play receiving clocks must be monotone');
  const row=seavtOfMarketMove(state,seq,intent,receivedAt);
  const text=serialized(row);
  boundedFile(path);
  const fd=openChecked(path,true);
  try{
    const size=fstatSync(fd).size;
    completeLines(fd,size);
    if(size+Buffer.byteLength(text)>PLAY_BYTES_MAX)
      throw new RangeError('bounded native SEAVT play exceeds 128 MiB');
    writeFull(fd,text);fsyncSync(fd);
  }finally{closeSync(fd);}
  return row;
}

async function* linesOf(path,maxBytes){
  const stats=boundedFile(path,maxBytes);
  const fd=openChecked(path);
  try{completeLines(fd,fstatSync(fd).size);}finally{closeSync(fd);}
  const rl=createInterface({input:createReadStream(path,{flags:nativeFlags(false)}),crlfDelay:Infinity});
  let lines=0;
  try{
    for await(const line of rl){
      if(!line.trim())continue;
      if(++lines>ROW_LIMIT||Buffer.byteLength(line)>LINE_BYTES_MAX)
        throw new RangeError('market play row count or size exceeds its bound');
      yield line;
    }
  }finally{rl.close();}
}

/** Read ONLY admitted native SEAVT moves. No legacy fallback, even for a
 * visually similar JSON record. Verify SCA address, measured evidence,
 * contiguous sequence, exact original clock and predecessor identity. */
export async function readMarketPlay(path){
  let state=marketGame.initialPosition(),seq=-1,rows=0,lastReceivedAt=null;
  for await(const line of linesOf(path,PLAY_BYTES_MAX)){
    const row=JSON.parse(line);
    const sign=signCellOfSeavt(row);
    const move=sign.object?.intent,expected=seq+1;
    if(sign.predicate!==predicate||sign.subject!==hashPosition(state)||
      sign.object?.seq!==expected||sign.for?.length!==1||
      sign.against?.length!==0||!measured(sign)||
      sign.for[0]?.kind!=='market-game-original-move'||
      sign.for[0]?.sourceAuthenticated!==false||
      sign.for[0]?.orderEffect!==false||!move||
      (lastReceivedAt!==null&&
       compareAbsoluteSeavtClocks(row.t,lastReceivedAt)<0)||
      // Re-admit the exact write as well as the source SCA address. Merely
      // recomputing the address of attacker-supplied evidence is insufficient:
      // a forged, self-addressed new witness must not become a play event.
      !coincides(row,seavtOfMarketMove(state,expected,move,row.t)))
      throw new TypeError('market play row violates its native SignCell causal chain');
    state=marketGame.extend(state,move).state;
    seq=expected;rows++;lastReceivedAt=row.t;
  }
  return {state,seq,rows,lastReceivedAt};
}

/**
 * One-time migration of the former play journal into its authoritative
 * SignCell/SEN/SEAVT representation. The original file is retained once as
 * <record>.legacy-original, outside normal reads; no dual writing or shim.
 * Verify both play folds BEFORE replacing the operational path.
 */
export async function migrateLegacyMarketPlay(path){
  const backup=path+'.legacy-original',temp=path+'.seavt-migration';
  const {existsSync}=await import('node:fs');
  if(existsSync(backup)||existsSync(temp))
    throw new Error('market play already migrated or an earlier migration requires recovery');
  let state=marketGame.initialPosition(),seq=-1,rows=0,fd,previousReceivedAt=null;
  try{
    fd=openSync(temp,'wx',0o600);
    let written=0;
    for await(const line of linesOf(path,32*1048576)){
      const entry=JSON.parse(line);
      const checked=validatePlayRecord([entry]);
      if(!checked.valid||entry.seq!==seq+1)
        throw new TypeError('invalid or noncontiguous original market play');
      // The old timestamp was a declared record clock, not an independently
      // authenticated publisher/receipt time. Never invent precision or
      // reorder it to disguise a late-arriving earlier source.
      if(!Number.isSafeInteger(entry.ts))
        throw new TypeError('historical market record lacks an integral original clock');
      const receivedAt=new Date(entry.ts).toISOString();
      if(previousReceivedAt!==null&&
         compareAbsoluteSeavtClocks(receivedAt,previousReceivedAt)<0)
        throw new RangeError('historical market records have non-monotone clocks: independent receiving required');
      const row=seavtOfMarketMove(state,entry.seq,entry.intent,receivedAt);
      const serializedRow=serialized(row),size=Buffer.byteLength(serializedRow);
      if(written+size>PLAY_BYTES_MAX)
        throw new RangeError('migration exceeds bounded native SEAVT play capacity');
      writeFull(fd,serializedRow);written+=size;
      state=marketGame.extend(state,entry.intent).state;
      seq=entry.seq;rows++;previousReceivedAt=receivedAt;
    }
    fsyncSync(fd);closeSync(fd);fd=undefined;
    const received=await readMarketPlay(temp);
    if(received.seq!==seq||received.rows!==rows||
      hashPosition(received.state)!==hashPosition(state))
      throw new Error('native SEAVT replay differs from the admitted historical play');
    // A hard link preserves the original byte-for-byte in the SAME directory,
    // without opening any gap in the active play path. The subsequent rename
    // replaces the active name atomically. Both directory transitions are
    // fsynced so an interrupted migration never silently loses the archive.
    const initial=boundedFile(path,32*1048576);
    linkSync(path,backup);
    syncParentDirectory(path);
    const unchanged=boundedFile(path,32*1048576);
    if(initial.size!==unchanged.size||initial.mtimeMs!==unchanged.mtimeMs)
      throw new Error('original financial play changed during migration');
    renameSync(temp,path);
    syncParentDirectory(path);
    return {rows,position:hashPosition(state)};
  }catch(error){
    if(fd!==undefined)closeSync(fd);
    try{unlinkSync(temp);}catch{}
    throw error;
  }
}


/**
 * Consume a source-read on-chain fill through the EXISTING native SignCraft
 * original-event history, then as an observation in the EXISTING market game.
 * This is a buyer's contingent inventory event, NOT a realized P&L, account
 * cash snapshot, customer acceptance, or automatically authorized new trade.
 *
 * The caller holds the native market-play file lock. The independent EVM
 * reader and Coesite's SignCraft receiving were already selected upstream.
 */
export function marketObservationOfReceivedAgentPredictionFill({store,receipt,at}={}) {
  if(!store||typeof store.load!=='function'||!isAbsoluteSeavtClock(at))
    throw new TypeError('source-received SignCraft store and actual game reading time required');
  const projection=projectAgentPredictionFillSourceSigns({receipt,at});
  const readback=store.load();
  if(!readback||typeof readback.then==='function'||!readback.history)
    throw new TypeError('replayable native SignCraft received-history readback required');
  const required=[projection.sourceCell,projection.positionCell,projection.feeCell,
    ...projection.linkCells];
  if(required.some(sourceCell=>!historySection(readback.history,
      sourceCell.subject,sourceCell.predicate).some(c=>coincides(c,sourceCell))))
    throw new RangeError('economic market move lacks its exact prior SignCraft source and position/fee history');
  const event=projection.sourceCell.subject;
  const position=projection.positionCell.object;
  const consideration=projection.feeCell.object.consideration;
  const observation=Object.freeze({
    id:projection.sourceAddress,
    // Exact source EVM contract; it is NOT a principal identifier.
    source:event.chain+':'+event.emitter,
    // Conservative clock: the market game first knew the result no earlier
    // than this admission, regardless of the original inclusion time.
    observedAt:at,availableAt:at,
    value:Object.freeze({
      kind:'evm-market-atomic-contingent-position-observation',
      originalEvent:event,sourceAddress:projection.sourceAddress,
      positionId:position.positionId,buyer:projection.positionCell.subject.buyer,
      market:receipt.market,asset:receipt.asset,
      lots:position.lots,consideration,
      sourceAuthenticated:false,customerAccepted:false,realizedProfitAccepted:false,
      grantsTradingAuthority:false,
    }),
  });
  return Object.freeze({kind:'observe',observation});
}

/** Same native appendMarketMove producer, not a second play log. Already
 * admitted source identities never create another economic move on replay.
 */
export function appendReceivedAgentPredictionMarketFill({
  path,state,seq,receipt,store,receivedAt,precedingReceivedAt=null,
}={}) {
  const move=marketObservationOfReceivedAgentPredictionFill({store,receipt,at:receivedAt});
  const existing=state?.observations?.[move.observation.id];
  if(existing){
    if(!coincides(existing.value,move.observation.value))
      throw new RangeError('market game already records a different economy under the same original EVM source');
    return Object.freeze({
      status:'already-in-market-game',move,
      appended:false,row:null,
    });
  }
  const row=appendMarketMove(path,state,seq,move,receivedAt,precedingReceivedAt);
  return Object.freeze({status:'appended',move,appended:true,row});
}
