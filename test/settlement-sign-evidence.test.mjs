import test from 'node:test';
import assert from 'node:assert/strict';
import {projectConditionalSettlementSign} from '../src/settlement-sign-evidence.mjs';

const at='2026-10-12T18:00:00Z';
const context=()=>({source:'AAA',rules:'sha256:rules-regular-national-2026-10-13',
 targetDate:'2026-10-13',assumption:'official source report agrees with qualified bound'});
const p=(id,lower,upper,availableAt='2026-10-12T17:50:00Z')=>({
 id,lower,upper,observedAt:'2026-10-12T17:40:00Z',availableAt,
});
const run=(premises=[],opts={})=>projectConditionalSettlementSign({
 subject:'KXAAAGASD-26OCT13-4.0000',predicate:'settles-yes',
 context:context(),channel:'source-conditional',
 payout:{lower:4,upper:Infinity},premises,at,...opts,
});

test('the empty SignCell evidence carrier is neither yes nor no',()=>{
 const r=run();
 assert.deepEqual(r.cell.for,[]);
 assert.deepEqual(r.cell.against,[]);
 assert.equal(r.supportsYes,false);
 assert.equal(r.supportsNo,false);
 assert.equal(r.contradictory,false);
 assert.equal(r.deduction.admissibleWorlds,null);
 assert.equal(r.orderEffect,false);
});

test('interval-subset and disjoint deduction flow into respective real SignCell slots',()=>{
 const yes=run([p('bounds',4.01,Infinity)]);
 const no=run([p('bounds',-Infinity,3.99)]);
 assert.equal(yes.cell.for.length,1);
 assert.equal(yes.cell.against.length,0);
 assert.equal(no.cell.for.length,0);
 assert.equal(no.cell.against.length,1);
 assert.equal(yes.sourceRelations[0].side,'for');
 assert.equal(no.sourceRelations[0].side,'against');
 assert.equal(yes.tradeEligible,false);
});

test('independently contradictory premises retain BOTH sides, never imply arbitrary unrelated claims',()=>{
 const r=run([p('supports',4.01,Infinity),p('opposes',-Infinity,3.99)]);
 assert.equal(r.deduction.inconsistentPremises,true);
 assert.equal(r.cell.for.length,1);
 assert.equal(r.cell.against.length,1);
 assert.equal(r.supportsYes,true);
 assert.equal(r.supportsNo,true);
 assert.equal(r.contradictory,true);
 assert.equal(r.deduction.remainingDomain,null);
 assert.equal(r.tradeEligible,false);
});

test('knowledge join is permutation-invariant at SignCell address level',()=>{
 const ps=[p('ceiling',-Infinity,4.5),p('floor',4.01,Infinity)];
 const a=run(ps),b=run(ps.slice().reverse());
 assert.equal(a.address,b.address);
 assert.deepEqual(a.cell,b.cell);
 assert.deepEqual(a.sourceRelations,b.sourceRelations);
});

test('source proof, proxy and hypothetical rate live at different addresses',()=>{
 const bounds=[p('bound',4.01,Infinity)];
 const src=run(bounds),proxy=run(bounds,{channel:'proxy-counterfactual'}),
   rate=run(bounds,{channel:'rate-counterfactual'});
 assert.notEqual(src.address,proxy.address);
 assert.notEqual(src.address,rate.address);
 assert.notEqual(proxy.address,rate.address);
 assert.equal(src.supportsYes,proxy.supportsYes);
});

test('rule, publisher and target date change the identity and never silently combine',()=>{
 const a=run([p('test',4.01,Infinity)]);
 const b=run([p('test',4.01,Infinity)],{context:{...context(),source:'OPIS'}});
 const c=run([p('test',4.01,Infinity)],{context:{...context(),targetDate:'2026-10-14'}});
 const d=run([p('test',4.01,Infinity)],{context:{...context(),rules:'new-rule'}});
 assert.notEqual(a.address,b.address);
 assert.notEqual(a.address,c.address);
 assert.notEqual(a.address,d.address);
});

test('an observed event received after issuance is withheld, not backdated into proof',()=>{
 const r=run([p('late',4.01,Infinity,'2026-10-12T20:00:00Z')]);
 assert.equal(r.deduction.qualifiedPremises.length,0);
 assert.deepEqual(r.withheld,[{id:'late',reason:'not available at issuance'}]);
 assert.equal(r.cell.for.length,0);
 assert.equal(r.cell.against.length,0);
});

test('different independent proofs retain their distinct predecessor evidence IDs',()=>{
 const r=run([p('old-floor',4.01,Infinity),p('new-floor',4.02,Infinity)]);
 assert.equal(r.deduction.qualifiedPremises.length,2);
 assert.deepEqual(r.premiseIds,['new-floor','old-floor']);
 assert.ok(r.sourceRelations.some(w=>w.premises.includes('old-floor')));
 assert.ok(r.sourceRelations.some(w=>w.premises.includes('new-floor')));
 assert.ok(r.cell.for.length>=2);
});

test('malformed or duplicated witness IDs, clocks and contexts fail closed',()=>{
 assert.throws(()=>run([p('same',4,Infinity),p('same',4.1,Infinity)]),TypeError);
 assert.throws(()=>run([p('x',4,Infinity)],{context:{source:'AAA'}}),TypeError);
 assert.throws(()=>run([],{at:'bad'}),TypeError);
 assert.throws(()=>run([],{channel:'officially-executable'}),TypeError);
});

test('unsupported temperature intervals cannot be smuggled through as a sign',()=>{
 assert.throws(()=>run([{...p('bad',4,Infinity),lower:Infinity,upper:-Infinity}]),TypeError);
});


test('source population day and hypothesis assumption cannot be silently omitted from SignCell context',()=>{
 assert.throws(()=>run([], {context:{...context(),targetDate:undefined}}),TypeError);
 assert.throws(()=>run([], {context:{...context(),targetDate:'2026-02-30'}}),TypeError);
 assert.throws(()=>run([], {context:{...context(),assumption:undefined}}),TypeError);
 assert.throws(()=>run([], {context:{...context(),assumption:''}}),TypeError);
});

test('knowledge carrier records the exact independent premises used by every support/refutation witness',()=>{
 const r=run([p('older',4.10,Infinity),p('contradiction',-Infinity,3.9)]);
 assert.equal(r.contradictory,true);
 assert.deepEqual(r.premiseIds,['contradiction','older']);
 const ids=new Set(r.premiseIds);
 assert.ok(r.sourceRelations.length===r.cell.for.length+r.cell.against.length);
 for(const edge of r.sourceRelations){
  assert.ok(['for','against'].includes(edge.side));
  assert.ok(edge.premises.length>=1);
  assert.ok(edge.premises.every(x=>ids.has(x)));
  assert.ok(r.cell[edge.side].some(w=>w.rule===edge.rule &&
   JSON.stringify(w.premises)===JSON.stringify(edge.premises)));
 }
 assert.equal(r.tradeEligible,false);
});
