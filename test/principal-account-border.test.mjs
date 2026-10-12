import test from 'node:test';
import assert from 'node:assert/strict';
import {
  principalVenueKey, assertAccountChainScope, indexPrincipalAccounts,
  sharedPrincipalVenues, scenarioHeldPnLCents,
} from '../src/principal-account-border.mjs';

const account = (principal, venue='alpaca') => ({principal,venue, equityCents:100});
const scenario = {
  heldPnlCentsByVenue:{alpaca:40,kalshi:-10},
  heldPnlCentsByPrincipalVenue:{group:{alpaca:13},person:{alpaca:-7}},
};

test('principal/venue keys cannot collapse sovereign accounts onto one venue slot',()=>{
  assert.notEqual(principalVenueKey(account('group')),principalVenueKey(account('person')));
  assert.notEqual(principalVenueKey(account('a,b')),principalVenueKey(account('a','kalshi')));
  assert.throws(()=>principalVenueKey({venue:'alpaca'}),/principal/);
  assert.throws(()=>principalVenueKey(account('group','other')),/supported venue/);
});
test('a principal decision cannot borrow another owner or double-count duplicate accounts',()=>{
  const one=account('group');
  const accounts={first:one};
  assert.equal(indexPrincipalAccounts(accounts,'group').get('alpaca'),one);
  assert.throws(()=>indexPrincipalAccounts({...accounts,second:account('person')},'group'),/declared decision principal/);
  assert.throws(()=>indexPrincipalAccounts({...accounts,second:account('group')},'group'),/double-count capital/);
});
test('shared venues are discovered across principals but distinct venues remain separate',()=>{
  const owners={a:account('group','alpaca'),b:account('person','alpaca'),c:account('group','kalshi')};
  assert.deepEqual([...sharedPrincipalVenues(owners)],['alpaca']);
  assert.deepEqual([...sharedPrincipalVenues({a:owners.a,c:owners.c})],[]);
});
test('scenario baseline uses principal-specific holdings, never another owner\'s gains',()=>{
  assert.equal(scenarioHeldPnLCents(scenario,'group','alpaca'),13);
  assert.equal(scenarioHeldPnLCents(scenario,'person','alpaca'),-7);
  assert.equal(scenarioHeldPnLCents(scenario,'group','kalshi'),-10);
  assert.throws(()=>scenarioHeldPnLCents(scenario,'stranger','alpaca',{requireScoped:true}),/principal-scoped/);
  assert.throws(()=>scenarioHeldPnLCents({heldPnlCentsByVenue:{alpaca:40}},'person','alpaca',{requireScoped:true}),/principal-scoped/);
  assert.throws(()=>scenarioHeldPnLCents({heldPnlCentsByPrincipalVenue:{group:{alpaca:0.1}}},'group','alpaca'),/integer cents/);
});

test('EVM principal observations are unusable without a concrete positive chain',()=>{
 const evm=account('group','evm');
 assert.throws(()=>assertAccountChainScope(evm),/explicit positive chainId/);
 assert.throws(()=>indexPrincipalAccounts({evm},'group'),/explicit positive chainId/);
 assert.equal(assertAccountChainScope({...evm,chainId:42161}).chainId,42161);
 for(const chainId of [0,-1,1.5,NaN,Infinity,'42161']){
  assert.throws(()=>assertAccountChainScope({...evm,chainId}),/explicit positive chainId/);
 }
});
