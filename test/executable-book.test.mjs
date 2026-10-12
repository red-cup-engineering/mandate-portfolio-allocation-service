import test from 'node:test';
import assert from 'node:assert/strict';
import {assessExecutableBook} from '../src/executable-book.mjs';

const at='2026-10-12T22:12:40Z';
const current={
 sourceRef:'alpaca:iex:NVDA:quote',observedAt:'2026-10-12T22:12:39Z',
 bid:217.26,ask:217.31,bidSize:100,askSize:100,
};
const evaluate=(book=current,extra={})=>assessExecutableBook({
 book,at,minUnits:1,maxQuoteAgeMs:60_000,maxRelativeSpread:.005,
 proposedEntryPrice:217.31,...extra,
});

test('actual October 12 IEX NVDA snapshot must never turn a historical edge into a funded intent',()=>{
 const stale=evaluate({
  ...current,bid:217.26,ask:240.24,
  observedAt:'2026-10-12T20:00:00.322217024Z',
 });
 assert.equal(stale.eligibleForPlanning,false);
 assert.equal(stale.reason,'executable quote stale');
 const wide=evaluate({
  ...current,bid:217.26,ask:240.24,
 });
 assert.equal(wide.eligibleForPlanning,false);
 assert.match(wide.reason,/spread/);
});

test('fresh same-side book allows only additional planning, never an exchange order',()=>{
 const x=evaluate();
 assert.equal(x.eligibleForPlanning,true);
 assert.equal(x.reason,null);
 assert.equal(x.maxDisplayedUnits,100);
 assert.equal(x.orderEffect,false);
 assert.equal(x.sourceAuthenticated,false);
 assert.ok(x.relativeSpread<.005);
});

test('a cheaper modeled entry than an available ask requires independent fill evidence',()=>{
 const x=evaluate(current,{proposedEntryPrice:217.10});
 assert.equal(x.eligibleForPlanning,false);
 assert.match(x.reason,/ask/);
});

test('missing or nonpositive bid, ask, sizes, source or absolute timestamp is not zero spread',()=>{
 for(const broken of [
  null,{...current,sourceRef:undefined},{...current,bid:undefined},
  {...current,bid:-1},{...current,ask:0},{...current,ask:210},
  {...current,bidSize:-1},{...current,askSize:undefined},
  {...current,observedAt:'2026-10-12T22:12:39'},
 ]){
  const r=evaluate(broken);
  assert.equal(r.eligibleForPlanning,false);
  assert.equal(r.orderEffect,false);
 }
});

test('future timestamps, unavailable liquidity and oversize orders fail closed',()=>{
 assert.match(evaluate({...current,observedAt:'2026-10-13T00:00:00Z'}).reason,/future/);
 assert.match(evaluate({...current,askSize:.01},{minUnits:1}).reason,/liquidity/);
 assert.match(evaluate({...current,bid:217,ask:219}).reason,/spread/);
 for(const extras of [
  {maxQuoteAgeMs:0},{maxQuoteAgeMs:Infinity},
  {maxRelativeSpread:-.01},{maxRelativeSpread:NaN},
  {minUnits:-1},{at:'2026-10-12T17:00:00'},
  {proposedEntryPrice:0},
 ]){
  assert.throws(()=>evaluate(current,extras),TypeError);
 }
});
