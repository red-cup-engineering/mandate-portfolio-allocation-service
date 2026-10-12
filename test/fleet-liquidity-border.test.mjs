import test from 'node:test';
import assert from 'node:assert/strict';
import { marketSideKey, assertFleetBookCapacity } from '../src/fleet-liquidity-border.mjs';

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
