import test from 'node:test';
import assert from 'node:assert/strict';
import {deduceSettlementInterval,boundRatePathExtremum} from '../src/settlement-modal.mjs';
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


// All path certificates are conditional assumptions about *every instant*;
// endpoint samples or an empirical rate percentile are insufficient.
const RATE_AT='2026-10-11T18:00:00Z',RATE_END='2026-10-11T20:00:00Z';
const rate=(id,lower,upper,until=RATE_END,availableAt='2026-10-11T17:50:00Z')=>({
  id,rateLowerPerHour:lower,rateUpperPerHour:upper,until,
  observedAt:'2026-10-11T17:00:00Z',availableAt,
});
const path=(kind,temperature,achievedExtreme,segments,other={})=>
  boundRatePathExtremum({kind,at:RATE_AT,endAt:RATE_END,temperature,achievedExtreme,segments,...other});

test('rate bounds constrain every instant, so persistent cooling leaves the prior high intact',()=>{
 const r=path('high',{lower:80,upper:80},{lower:88,upper:88},[rate('certified-cooling',-5,-1)]);
 assert.equal(r.status,'conditional-rate-bounded-reachability');
 assert.deepEqual(r.finalExtreme,{lower:88,upper:88});
 assert.deepEqual(r.terminalTemperature,{lower:70,upper:78});
 assert.equal(r.tradeEligible,false);
 const verdict=deduceSettlementInterval({payout:{lower:91,upper:Infinity},
   premises:[{id:'derived-rate',...r.finalExtreme,observedAt:RATE_AT,availableAt:RATE_AT}],at:RATE_AT});
 assert.equal(verdict.support.against.length,1);
});

test('a sound continuing warming floor makes crossing necessary, subject to the rate premise',()=>{
 const r=path('high',{lower:80,upper:80},{lower:88,upper:88},[rate('persistent-warming',6,8)]);
 assert.deepEqual(r.finalExtreme,{lower:92,upper:96});
 assert.equal(r.assumptions.some(s=>s.includes('every instant')),true);
});

test('endpoint cooling observations alone cannot exclude an unobserved transient spike',()=>{
 const r=path('high',{lower:80,upper:80},{lower:88,upper:88},[rate('loose-rate',-20,20)]);
 assert.equal(r.finalExtreme.lower,88);
 assert.equal(r.finalExtreme.upper,120);
 assert.equal(r.status,'conditional-rate-bounded-reachability');
});

test('ordered separately attested segments compose without manufacturing an unobserved gap',()=>{
 const r=path('high',{lower:80,upper:80},{lower:82,upper:82},[
   rate('hour-one',2,4,'2026-10-11T19:00:00Z'),
   rate('hour-two',-3,-2,RATE_END),
 ]);
 assert.deepEqual(r.terminalTemperature,{lower:79,upper:82});
 assert.deepEqual(r.finalExtreme,{lower:82,upper:84});
 assert.deepEqual(r.certificates.map(x=>x.id),['hour-one','hour-two']);
});

test('no future segment or partial future horizon is a gap, not a determination',()=>{
 assert.equal(path('high',{lower:80,upper:80},{lower:80,upper:80},[]).status,'incomplete-rate-horizon');
 const r=path('high',{lower:80,upper:80},{lower:80,upper:80},
   [rate('only-first-hour',-1,1,'2026-10-11T19:00:00Z')]);
 assert.equal(r.status,'incomplete-rate-horizon');
 assert.equal(r.finalExtreme,null);
});

test('a rate observation published after issuance cannot be retroactively used',()=>{
 const r=path('high',{lower:80,upper:80},{lower:88,upper:88},
   [rate('delayed',-5,-1,RATE_END,'2026-10-11T18:20:00Z')]);
 assert.equal(r.status,'rate-bound-not-yet-available');
 assert.equal(r.finalExtreme,null);
});

test('inconsistent starting maximum is not permission to infer arbitrary propositions',()=>{
 const r=path('high',{lower:95,upper:95},{lower:88,upper:88},[rate('cooling',-5,-1)]);
 assert.equal(r.status,'inconsistent-initial-extreme');
 assert.equal(r.finalExtreme,null);
});

test('rate lower may be negative and upper positive; min and max remain logical duals',()=>{
 for(let start=-2;start<=2;start++)for(let low=-2;low<=1;low++)for(let high=low;high<=2;high++){
  const temp={lower:start,upper:start},achHigh={lower:start+1,upper:start+1};
  const x=path('high',temp,achHigh,[rate('path',low,high)]);
  const y=path('low',{lower:-start,upper:-start},{lower:-start-1,upper:-start-1},
    [rate('path',-high,-low)]);
  assert.ok(Math.abs(y.finalExtreme.lower+x.finalExtreme.upper)<1e-10);
  assert.ok(Math.abs(y.finalExtreme.upper+x.finalExtreme.lower)<1e-10);
 }
});

test('malformed, nonmonotone, duplicate or outside-window rates fail closed',()=>{
 const base={lower:80,upper:80};
 assert.throws(()=>path('high',base,base,[rate('bad',4,-4)]),TypeError);
 assert.throws(()=>path('high',base,base,[rate('outside',0,1,'2026-10-11T21:00:00Z')]),RangeError);
 assert.throws(()=>path('high',base,base,[rate('first',1,2,'2026-10-11T19:00:00Z'),rate('first',1,2)]),TypeError);
 assert.throws(()=>path('high',base,base,[rate('bad-time',1,2,'garbage')]),TypeError);
});

test('an ended observation window does not allow any future rate segment',()=>{
 const r=boundRatePathExtremum({kind:'high',at:RATE_END,endAt:RATE_END,
   temperature:{lower:80,upper:80},achievedExtreme:{lower:88,upper:88},segments:[]});
 assert.deepEqual(r.finalExtreme,{lower:88,upper:88});
 assert.throws(()=>boundRatePathExtremum({kind:'high',at:RATE_END,endAt:RATE_END,
   temperature:{lower:80,upper:80},achievedExtreme:{lower:88,upper:88},
   segments:[rate('old',-1,1)]}),RangeError);
});
