import test from 'node:test';
import assert from 'node:assert/strict';
import { marketSideKey, assertFleetBookCapacity, apportionFleetBookDemand } from '../src/fleet-liquidity-border.mjs';

const quote=(id,availableUnits=10,askSize=5)=>({
  id,venue:'evm',chainId:42161,protocol:'gmx',
  instrument:'WETH',carrier:'collateral',side:'long',
  availableUnits,book:{askSize},
});
const order=(id,units)=>({
  id,venue:'evm',chainId:42161,protocol:'gmx',
  instrument:'WETH',carrier:'collateral',side:'long',units,
});
const decision=(principal,orders)=>({principal,orders});

test('independent principal cash cannot overclaim one market-side ask',()=>{
 const quotes={one:quote('one',9,5)};
 assert.equal(assertFleetBookCapacity(quotes,[
  decision('group',[order('one',2)]),
  decision('person',[order('one',3)]),
 ]),true);
 assert.throws(()=>assertFleetBookCapacity(quotes,[
  decision('group',[order('one',3)]),
  decision('person',[order('one',3)]),
 ]),/overclaim shared displayed/);
});
test('different quote IDs and snapshots never double the common market liquidity',()=>{
 const quotes={old:quote('old',20,4),new:quote('new',20,7)};
 assert.throws(()=>assertFleetBookCapacity(quotes,[
  decision('group',[order('old',3)]),
  decision('person',[order('new',3)]),
 ]),/overclaim shared displayed/);
});
test('different EVM chain/protocol books have different executable capacity',()=>{
 const a=quote('a',4,4),b={...quote('b',4,4),chainId:8453};
 assert.notEqual(marketSideKey(a),marketSideKey(b));
 const oa=order('a',4),ob={...order('b',4),chainId:8453};
 assert.equal(assertFleetBookCapacity({a,b},[
  decision('group',[oa]),decision('person',[ob]),
 ]),true);
});
test('quoted order identity and principal identity must survive fleet composition',()=>{
 const q={one:quote('one',4,4)};
 assert.throws(()=>assertFleetBookCapacity(q,[
  decision('group',[{...order('one',1),chainId:8453}]),
 ]),/differs from its common market-side quote/);
 assert.throws(()=>assertFleetBookCapacity(q,[
  decision('group',[order('one',1)]),decision('group',[order('one',1)]),
 ]),/one decision per named principal/);
 assert.throws(()=>assertFleetBookCapacity(q,[
  decision('group',[order('nonexistent',1)]),
 ]),/no common quote/);
});


test('scarce integer lots are proportionally cleared with deterministic remainder',()=>{
 const quotes={one:{...quote('one',3,3),unitStep:1}};
 const wishes=[decision('bravo',[{...order('one',3),unitStep:1}]),
               decision('alpha',[{...order('one',3),unitStep:1}])];
 const a=apportionFleetBookDemand(quotes,wishes);
 const b=apportionFleetBookDemand(quotes,[...wishes].reverse());
 const key=marketSideKey(quotes.one);
 assert.equal(a.oversubscribed,true);
 assert.equal(a.quotasByPrincipal.alpha[key],2);
 assert.equal(a.quotasByPrincipal.bravo[key],1);
 assert.deepEqual(a,b);
 assert.equal(a.effect,'planning-constraint-only');
});
test('fractional EVM lots remain on one executable lattice',()=>{
 const quotes={one:{...quote('one',.03,.03),unitStep:.01}};
 const wishes=[decision('alpha',[{...order('one',.03),unitStep:.01}]),
               decision('bravo',[{...order('one',.03),unitStep:.01}])];
 const result=apportionFleetBookDemand(quotes,wishes);
 const key=marketSideKey(quotes.one);
 assert.equal(result.quotasByPrincipal.alpha[key],.02);
 assert.equal(result.quotasByPrincipal.bravo[key],.01);
 assert.ok(result.quotasByPrincipal.alpha[key]+result.quotasByPrincipal.bravo[key]<=.03+1e-12);
});
test('one principal cannot multiply scarce size via aliases and different aliases cannot add ask sizes',()=>{
 const quotes={a:{...quote('a',5,4),unitStep:1},
               b:{...quote('b',5,3),unitStep:1}};
 const wishes=[decision('group',[{...order('a',2),unitStep:1},{...order('b',2),unitStep:1}])];
 const a=apportionFleetBookDemand(quotes,wishes);
 assert.equal(a.oversubscribed,true);
 assert.equal(a.quotasByPrincipal.group[marketSideKey(quotes.a)],3);
});
test('available supply is not needlessly rationed and distinct chains have separate allocations',()=>{
 const qa={...quote('one',10,10),unitStep:1},qb={...quote('two',10,10),unitStep:1,chainId:8453};
 const wishes=[decision('group',[{...order('one',2),unitStep:1}]),
               decision('personal',[{...order('two',3),unitStep:1,chainId:8453}])];
 const a=apportionFleetBookDemand({one:qa,two:qb},wishes);
 assert.equal(a.oversubscribed,false);
 assert.equal(a.quotasByPrincipal.group[marketSideKey(qa)],2);
 assert.equal(a.quotasByPrincipal.personal[marketSideKey(qb)],3);
});
test('unreconciled lot units or source lot steps cannot masquerade as pooled liquidity',()=>{
 const qa={...quote('one',1,1),unitStep:.1};
 const wish=decision('group',[{...order('one',.15),unitStep:.1}]);
 assert.throws(()=>apportionFleetBookDemand({one:qa},[wish]),/exact market-side lot multiple/);
 assert.throws(()=>apportionFleetBookDemand({
   one:qa,two:{...quote('two',1,1),unitStep:.2},
 },[decision('group',[])]),/aliases disagree/);
 assert.throws(()=>apportionFleetBookDemand({one:qa},[
   decision('group',[{...order('one',.1),unitStep:.2}]),
 ]),/lot step differs/);
});


test('decimal-lot capacity does not discard a whole lot through binary64 division',()=>{
 const q={...quote('one',.3,.3),unitStep:.1};
 const wish=[decision('alpha',[{...order('one',.3),unitStep:.1}]),
             decision('beta',[{...order('one',.3),unitStep:.1}])];
 const result=apportionFleetBookDemand({one:q},wish);
 const key=marketSideKey(q);
 assert.equal(result.oversubscribed,true);
 assert.equal(Math.round(result.quotasByPrincipal.alpha[key]/.1),2);
 assert.equal(Math.round(result.quotasByPrincipal.beta[key]/.1),1);
});


test('finite three-principal exhaustive property: conserve scarce lots without crossing a principal border',()=>{
 const q={...quote('one',0,0),unitStep:1},key=marketSideKey(q);
 for(let capacity=0;capacity<=8;capacity++) {
  q.availableUnits=capacity;q.book.askSize=capacity;
  for(let a=0;a<=7;a++)for(let b=0;b<=7;b++)for(let c=0;c<=7;c++){
   const demands=[a,b,c], names=['a','b','c'];
   const wishes=names.map((principal,i)=>decision(principal,
    demands[i]?[{...order('one',demands[i]),unitStep:1}]:[]));
   const result=apportionFleetBookDemand({one:q},wishes);
   const shares=names.map(p=>result.quotasByPrincipal[p][key]);
   const demand=demands.reduce((n,x)=>n+x,0);
   assert.equal(shares.reduce((n,x)=>n+x,0),Math.min(capacity,demand));
   for(let i=0;i<3;i++) {
     assert.ok(Number.isSafeInteger(shares[i]));
     assert.ok(shares[i]>=0&&shares[i]<=demands[i]);
   }
   assert.equal(result.oversubscribed,demand>capacity);
  }
 }
});
