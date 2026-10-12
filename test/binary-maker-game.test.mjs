import test from 'node:test';
import assert from 'node:assert/strict';
import {binaryMakerPlacementBounds,rankBinaryMakerPlacements} from '../src/binary-maker-game.mjs';

const band=(x,y=x)=>({low:x,high:y});
const maker=(overrides={})=>({
  side:'yes',priceUsd:.96,makerFeeUsdPerFill:.002,
  probabilityYes:band(.95),probabilityFill:band(.1),...overrides,
});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10, 'Expected '+a+' ≈ '+b);

test('free fill/outcome coupling creates sharply different maker P&L bounds',()=>{
 const r=binaryMakerPlacementBounds(maker());
 near(r.worstCaseCoupling.winAndFillProbability,.05);
 near(r.bestCaseCoupling.winAndFillProbability,.1);
 near(r.conditionalPnlUsdPerPlacement.low,.05-.1*.962);
 near(r.conditionalPnlUsdPerPlacement.high,.1-.1*.962);
 assert.equal(r.conditionallyPositive,false);
 assert.equal(r.tradeEligible,false);
 assert.equal(r.orderEffect,false);
});

test('NO quote is a purchased NO claim, not a YES cash-flow formula',()=>{
 const r=binaryMakerPlacementBounds(maker({
  side:'no',priceUsd:.04,makerFeeUsdPerFill:.002,
 }));
 near(r.probabilityWin.low,.05);
 near(r.conditionalPnlUsdPerPlacement.low,-.1*.042);
 near(r.conditionalPnlUsdPerPlacement.high,.05-.1*.042);
});

test('settled-certain purchased outcome proves a conditional profitable maker, not an executable order',()=>{
 const r=binaryMakerPlacementBounds(maker({
  side:'yes',probabilityYes:band(1),probabilityFill:band(.4),
  priceUsd:.95,makerFeeUsdPerFill:.01,
 }));
 near(r.conditionalPnlUsdPerPlacement.low,.4*.04);
 near(r.conditionalPnlUsdPerPlacement.high,.4*.04);
 assert.equal(r.conditionallyPositive,true);
 assert.equal(r.tradeEligible,false);
});

test('zero fill makes zero gain absent independent credited reward',()=>{
 const a=binaryMakerPlacementBounds(maker({probabilityFill:band(0)}));
 near(a.conditionalPnlUsdPerPlacement.low,0);
 near(a.conditionalPnlUsdPerPlacement.high,0);
 assert.equal(a.worstCaseCoupling.fillProbability,0);
});

test('an advertised incentive pool never enters maker profit unless supplied as explicit bounded scenario',()=>{
 const a=binaryMakerPlacementBounds(maker({probabilityYes:band(.95),probabilityFill:band(.1)}));
 assert.deepEqual(a.rewardScenarioUsdPerPlacement,band(0));
 const b=binaryMakerPlacementBounds(maker({incentiveUsdPerPlacement:band(.01,.02)}));
 near(b.conditionalPnlUsdPerPlacement.low-a.conditionalPnlUsdPerPlacement.low,.01);
 near(b.conditionalPnlUsdPerPlacement.high-a.conditionalPnlUsdPerPlacement.high,.02);
 assert.equal(b.tradeEligible,false);
});

test('fee and opportunity cost penalize the lower and upper bounds',()=>{
 const before=binaryMakerPlacementBounds(maker({makerFeeUsdPerFill:0}));
 const after=binaryMakerPlacementBounds(maker({makerFeeUsdPerFill:.01,carryUsdPerPlacement:.002}));
 assert.ok(after.conditionalPnlUsdPerPlacement.low<=before.conditionalPnlUsdPerPlacement.low-.002);
 assert.ok(after.conditionalPnlUsdPerPlacement.high<=before.conditionalPnlUsdPerPlacement.high-.002);
});

test('unknown market probability or queue-fill band cannot manufacture research rank',()=>{
 assert.throws(()=>binaryMakerPlacementBounds(maker({probabilityYes:null})),TypeError);
 assert.throws(()=>binaryMakerPlacementBounds(maker({probabilityFill:{low:0,high:1.1}})),TypeError);
 assert.throws(()=>binaryMakerPlacementBounds(maker({probabilityYes:{low:.6,high:.5}})),TypeError);
 assert.throws(()=>binaryMakerPlacementBounds(maker({makerFeeUsdPerFill:-.01})),TypeError);
 assert.throws(()=>binaryMakerPlacementBounds(maker({priceUsd:1})),TypeError);
 assert.throws(()=>rankBinaryMakerPlacements([{id:'unknown',priceUsd:.95,side:'yes',probabilityYes:band(.95)}]),TypeError);
});

test('abstain competes with every quoted scenario and wins when no worst-case edge survives',()=>{
 const a=rankBinaryMakerPlacements([{id:'bad',...maker()}]);
 assert.equal(a.action,'abstain');assert.equal(a.bestCandidate,null);
 const b=rankBinaryMakerPlacements([
  {id:'bad',...maker()},
  {id:'certain',...maker({probabilityYes:band(1),probabilityFill:band(.4),priceUsd:.95,makerFeeUsdPerFill:.01})},
 ]);
 assert.equal(b.action,'conditional-candidate');
 assert.equal(b.bestCandidate,'certain');
 assert.equal(b.tradeEligible,false);
});

test('complete two-by-two joint probability enumeration respects both Fréchet envelopes',()=>{
 const grid=[0,.25,.5,.75,1],prices=[.1,.5,.9],fee=.001;
 let checked=0;
 for(const pL of grid)for(const pU of grid.filter(x=>x>=pL))
 for(const fL of grid)for(const fU of grid.filter(x=>x>=fL))
 for(const side of ['yes','no'])for(const priceUsd of prices){
  const r=binaryMakerPlacementBounds({
   side,priceUsd,makerFeeUsdPerFill:fee,
   probabilityYes:band(pL,pU),probabilityFill:band(fL,fU),
  });
  const winL=side==='yes'?pL:1-pU,winU=side==='yes'?pU:1-pL;
  for(const w of grid.filter(x=>x>=winL&&x<=winU))
  for(const f of grid.filter(x=>x>=fL&&x<=fU)){
   const lo=Math.max(0,w+f-1),hi=Math.min(w,f);
   for(const joint of [lo,hi,(lo+hi)/2]){
    const ev=joint-(priceUsd+fee)*f;
    assert.ok(ev>=r.conditionalPnlUsdPerPlacement.low-1e-10);
    assert.ok(ev<=r.conditionalPnlUsdPerPlacement.high+1e-10);
    checked++;
   }
  }
 }
 assert.ok(checked>4000);
});

test('narrowing a valid interval cannot widen sharp payoff bounds',()=>{
 const broad=binaryMakerPlacementBounds(maker({probabilityYes:band(.8,1),probabilityFill:band(.01,.9)}));
 const narrow=binaryMakerPlacementBounds(maker({probabilityYes:band(.9,.95),probabilityFill:band(.15,.3)}));
 assert.ok(narrow.conditionalPnlUsdPerPlacement.low>=broad.conditionalPnlUsdPerPlacement.low-1e-10);
 assert.ok(narrow.conditionalPnlUsdPerPlacement.high<=broad.conditionalPnlUsdPerPlacement.high+1e-10);
});
