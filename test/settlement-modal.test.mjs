import test from 'node:test';
import assert from 'node:assert/strict';
import {deduceSettlementInterval} from '../src/settlement-modal.mjs';
const at='2026-10-11T20:00:00Z';
const certificate=(id,lower,upper,availableAt='2026-10-11T19:00:00Z')=>({
  id,lower,upper,observedAt:'2026-10-11T18:00:00Z',availableAt,
});
const run=(payout,premises,options={})=>deduceSettlementInterval({payout,premises,at,...options});

test('empty evidence is neither proof nor a guessed physical possibility',()=>{
 const v=run({lower:91,upper:Infinity},[]);
 assert.deepEqual(v.support,{for:[],against:[]});
 assert.equal(v.admissibleWorlds,null);
 assert.equal(v.orderEffect,false);
});

test('monotone observed high can prove a strict-above result, conditionally on a sound bound',()=>{
 const v=run({lower:91,upper:Infinity},[certificate('confirmed-91',91,Infinity)]);
 assert.equal(v.support.for.length,1);
 assert.equal(v.support.against.length,0);
 assert.deepEqual(v.admissibleWorlds,{yes:true,no:false});
 assert.equal(v.support.for[0].rule,'interval-subset');
 assert.equal(v.support.for[0].interval.upper,'Infinity');
 assert.ok(!JSON.stringify(v).includes('"upper":null'),'JSON cannot turn infinity into null');
});

test('the same observation excludes already-invalidated low brackets',()=>{
 const v=run({lower:86,upper:87},[certificate('confirmed-91',91,Infinity)]);
 assert.equal(v.support.against.length,1);
 assert.equal(v.support.for.length,0);
 assert.deepEqual(v.admissibleWorlds,{yes:false,no:true});
});

test('a cooling snapshot supplies no valid future ceiling unless its premise says so',()=>{
 const v=run({lower:91,upper:Infinity},[]);
 assert.equal(v.support.against.length,0);
 assert.equal(v.remainingDomain,null);
});

test('two independent compatible bounds prove only their common restriction',()=>{
 const certs=[certificate('max-at-least-85',85,Infinity),certificate('max-at-most-88',-Infinity,88)];
 const a=run({lower:85,upper:88},certs),b=run({lower:85,upper:88},certs.slice().reverse());
 assert.deepEqual(a,b,'evidence order is not logical order');
 assert.equal(a.support.for.length,1);
 assert.deepEqual(a.support.for[0].premises,['max-at-least-85','max-at-most-88']);
 assert.deepEqual(a.remainingDomain,{lower:85,upper:88});
});

test('independent contradiction is retained and cannot prove every proposition',()=>{
 const a=run({lower:90,upper:Infinity},[
  certificate('supports',91,Infinity),certificate('opposes',-Infinity,88),
 ]);
 assert.equal(a.inconsistentPremises,true);
 assert.equal(a.remainingDomain,null);
 assert.equal(a.support.for.length,1);
 assert.equal(a.support.against.length,1);
 assert.ok(a.support.for.every(w=>w.premises.length===1));
 assert.ok(a.support.against.every(w=>w.premises.length===1));
 assert.equal(a.admissibleWorlds,null);
});

test('future reports are not retroactively permitted into the issuance information set',()=>{
 const v=run({lower:91,upper:Infinity},[certificate('tomorrow',95,Infinity,'2026-10-12T01:00:00Z')]);
 assert.deepEqual(v.qualifiedPremises,[]);
 assert.deepEqual(v.withheld,[{id:'tomorrow',reason:'not available at issuance'}]);
 assert.deepEqual(v.support,{for:[],against:[]});
});

test('same identity cannot be replayed as two different witnesses',()=>{
 assert.throws(()=>run({lower:0,upper:1},[certificate('x',0,0),certificate('x',1,1)]),/duplicate/);
 assert.throws(()=>run({lower:0,upper:1},[certificate('x',Infinity,-Infinity)]),/valid bounds/);
});

test('finite small-world exhaustive soundness and consistent knowledge monotonicity',()=>{
 const payouts=[];for(let l=-2;l<=2;l++)for(let u=l;u<=2;u++)payouts.push({lower:l,upper:u});
 let count=0;
 for(const p of payouts)for(const source of payouts) {
  const result=run(p,[certificate('bounds',source.lower,source.upper)]);
  const values=Array.from({length:source.upper-source.lower+1},(_,i)=>source.lower+i);
  const hits=values.map(v=>v>=p.lower&&v<=p.upper);
  assert.equal(result.support.for.length>0,hits.every(Boolean));
  assert.equal(result.support.against.length>0,hits.every(v=>!v));
  // More compatible knowledge may prove something new, never retract a prior proof.
  for(let split=source.lower;split<=source.upper;split++) {
   const refined=run(p,[certificate('bounds',source.lower,source.upper),certificate('new',split,source.upper)]);
   if(result.support.for.length)assert.ok(refined.support.for.length);
   if(result.support.against.length)assert.ok(refined.support.against.length);
   assert.equal(refined.inconsistentPremises,false);
   count++;
  }
 }
 assert.ok(count>=100);
});
