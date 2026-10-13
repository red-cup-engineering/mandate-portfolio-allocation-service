import test from 'node:test';
import assert from 'node:assert/strict';
import {address,told} from '@red-cup-engineering/signcell/cell';
import {
 seavtOfSignCell,signCellOfSeavt,
} from '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';
import {marketGameSeavt} from '../src/scenario-sign-history.mjs';

const instant=(h,m)=>`2026-10-12T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`;
const state=()=>{
 const source={
  id:'original-1',source:'urn:synthetic:venue-source',
  observedAt:instant(21,25),availableAt:instant(21,24),
  value:{kind:'venue-realized-pnl-v1',
   decisionId:'decision-1',orderId:'order-1',
   principal:'P',venue:'kalshi',instrument:'WX',
   receipt:'one-economic-event',currency:'USD',pnlCents:25,
   sourceDigest:'sha256:'+'a'.repeat(64)},
 };
 return {
  observations:{
   'original-1':source,
   future:{id:'future',source:'future-only',
    observedAt:instant(22,10),availableAt:instant(22,9),
    value:{claimed:'not available'}},
  },
  accounts:{
   'P/alpaca':{principal:'P',venue:'alpaca',
    observedAt:instant(21,2),equityCents:100000,freeCashCents:20000},
   'P/kalshi':{principal:'P',venue:'kalshi',
    observedAt:instant(21,3),equityCents:5000,freeCashCents:1000},
   'P/evm:42161':{principal:'P',venue:'evm',chainId:42161,
    observedAt:instant(21,4),equityCents:8000,freeCashCents:3000,
    originalAtomicMicroUsd:'1000001'},
  },
  quotes:{
   'stock':{id:'stock',venue:'alpaca',instrument:'ACME',
    observedAt:instant(21,5),entryPrice:40},
   'binary':{id:'binary',venue:'kalshi',instrument:'WX',
    observedAt:instant(21,6),entryPrice:0.3},
   'perp':{id:'perp',venue:'evm',protocol:'GMX',instrument:'ETH',
    observedAt:instant(21,7),entryPrice:4000},
  },
  strategies:{
   multi:{id:'multi',observedAt:instant(21,8),
    quoteIds:['stock','binary','perp'],evidenceIds:['original-1'],
    thesis:'joint conditional hypothesis'},
  },
  forecast:{id:'joint',observedAt:instant(21,20),
   evidenceIds:['original-1'],
   scenarios:[{id:'up',probability:0.5},{id:'down',probability:0.5}]},
  decisions:{
   'decision-1':{id:'decision-1',principal:'P',at:instant(21,10),
    orders:[{id:'order-1',strategy:'multi',venue:'kalshi',instrument:'WX'}]},
  },
  outcomes:{
   'claim-1':{id:'claim-1',decisionId:'decision-1',orderId:'order-1',
    receipt:'one-economic-event',sourceObservationId:'original-1',
    observedAt:instant(21,30),pnlCents:25},
   'opposed':{id:'opposed',decisionId:'decision-1',orderId:'order-1',
    receipt:'one-economic-event',observedAt:instant(21,40),pnlCents:-10},
  },
 };
};
const cells=rows=>rows.map(row=>signCellOfSeavt(row));

test('one native view carries Alpaca Kalshi EVM/GMX through the SAME SCA SEN SEAVT and SignCell providers',()=>{
 const rows=marketGameSeavt(state(),instant(21,55)),out=cells(rows);
 assert.equal(out.filter(x=>x.predicate==='market-game:claimed-venue-account').length,3);
 assert.equal(out.filter(x=>x.predicate==='market-game:claimed-executable-quote').length,3);
 assert.ok(out.some(x=>x.object.venue==='alpaca'));
 assert.ok(out.some(x=>x.object.venue==='kalshi'));
 assert.ok(out.some(x=>x.object.venue==='evm'&&x.object.protocol==='GMX'));
 for(let i=0;i<rows.length;i++){
  const c=out[i],row=rows[i];
  assert.deepEqual(seavtOfSignCell(c,row.t),row,'native SEAVT roundtrip preserves entire witnessed cell');
  assert.match(address(c),/^ni:\/\/\/sha-256;/);
 }
 assert.ok(out.filter(x=>x.predicate==='market-game:claimed-venue-account')
  .every(x=>x.for[0].sourceAuthenticated===false));
 assert.ok(out.filter(x=>x.predicate==='market-game:conditional-decision')
  .every(x=>x.for[0].orderEffect===false));
 const evm=out.find(x=>x.predicate==='market-game:claimed-venue-account'&&x.object.venue==='evm');
 assert.equal(evm.object.originalAtomicMicroUsd,'1000001','do not float/round exact atomic money');
});
test('later queries never manufacture new observations of unchanged source data',()=>{
 const inputs=state();
 const first=marketGameSeavt(inputs,instant(21,55));
 const second=marketGameSeavt(inputs,instant(22,0));
 assert.deepEqual(first,second);
 assert.ok(!cells(first).some(x=>x.subject.includes('future')));
 const future=marketGameSeavt(inputs,instant(22,15));
 assert.equal(cells(future).filter(x=>x.subject==='market-game:observations:future').length,1);
});
test('FOUR contradiction has stable SCA identity but time cannot precede its opposing witness',()=>{
 const inputs=state();
 const early=marketGameSeavt(inputs,instant(21,35));
 const late=marketGameSeavt(inputs,instant(21,55));
 const predicate='has-claimed-economic-pnl-cents';
 const original=cells(early).find(x=>x.predicate===predicate&&x.object.claimedPnlCents===25);
 const revised=cells(late).find(x=>x.predicate===predicate&&x.object.claimedPnlCents===25);
 assert.ok(original&&revised);
 assert.deepEqual(told(original),[true,false]);
 assert.deepEqual(told(revised),[true,true]);
 assert.equal(address(original),address(revised));
 const oldRow=early.find(r=>signCellOfSeavt(r).predicate===predicate);
 const newRow=late.find(r=>{
  const c=signCellOfSeavt(r);
  return c.predicate===predicate&&c.object.claimedPnlCents===25;
 });
 assert.equal(oldRow.t,instant(21,30));
 assert.equal(newRow.t,instant(21,40),
  'contrary evidence from 21:40 must not be backdated to the initial 21:30 claim');
 assert.notDeepEqual(oldRow.v,newRow.v,'SEAVT preserves knowledge growth');
});
test('unpublished observations, invalid clocks, and unbounded games refuse native witnessing',()=>{
 const invalid=state();
 invalid.observations['original-1'].availableAt=instant(21,26);
 assert.throws(()=>marketGameSeavt(invalid,instant(21,55)),/unpublished/);
 const undated=state();undated.quotes.stock.observedAt='yesterday';
 assert.throws(()=>marketGameSeavt(undated,instant(21,55)),/original observation/);
 const huge=state();
 for(let i=0;i<10100;i++)huge.quotes['more-'+i]={
  id:'more-'+i,observedAt:instant(21,8),venue:'alpaca',
  instrument:'ACME',
 };
 assert.throws(()=>marketGameSeavt(huge,instant(21,55)),/10000 original observations/);
});


test('cross-venue FOUR history does not backdate a nanosecond-later contradiction',()=>{
 const inputs=state();
 inputs.outcomes.opposed.observedAt='2026-10-12T21:30:00.000000001Z';
 const t0='2026-10-12T21:30:00Z',t1='2026-10-12T21:30:00.000000001Z';
 const earlier=marketGameSeavt(inputs,t0);
 const later=marketGameSeavt(inputs,t1);
 const earlierCells=cells(earlier).filter(c=>c.predicate==='has-claimed-economic-pnl-cents');
 const laterCells=cells(later).filter(c=>c.predicate==='has-claimed-economic-pnl-cents');
 assert.equal(earlierCells.length,1);
 assert.deepEqual(told(earlierCells[0]),[true,false]);
 assert.ok(laterCells.some(c=>c.object.claimedPnlCents===25&&told(c).every(Boolean)));
 const original=earlier.find(r=>signCellOfSeavt(r).predicate==='has-claimed-economic-pnl-cents');
 const amended=later.find(r=>signCellOfSeavt(r).predicate==='has-claimed-economic-pnl-cents'&&
   signCellOfSeavt(r).object.claimedPnlCents===25);
 assert.equal(original.t,t0);
 assert.equal(amended.t,t1);
});
test('cross-venue SEAVT never admits evidence first available a nanosecond after observation',()=>{
 const inputs=state();
 inputs.observations['original-1'].availableAt='2026-10-12T21:25:00.000000001Z';
 assert.throws(()=>marketGameSeavt(inputs,instant(21,55)),/unpublished/);
});
