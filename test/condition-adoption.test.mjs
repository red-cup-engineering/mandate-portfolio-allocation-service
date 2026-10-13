import test from 'node:test';
import assert from 'node:assert/strict';
import { marketGame } from '../src/market-game.mjs';

// A forecast and its conditioning played at the same instant: the conditioned forecast must be adopted every time,
// never lose an equal-time hash tie to the base it was derived from.
function play(at) {
  const horizon = new Date(Date.parse(at) + 86_400_000).toISOString();
  const calibration = { sampleSize: 100, brier: .1, baselineBrier: .2, windowEnd: at, record: 'cal', confidenceLowerBound: .01, netReturnConfidenceLowerBound: .01, liveUseLimitations: [] };
  const spec = { source: 'urn:test:mid', path: ['mid'], calibration, bins: [{ lower: 0, upper: 0.5, likelihoods: { yes: 0.2, no: 0.6 } }, { lower: 0.5, upper: 1, likelihoods: { yes: 0.8, no: 0.4 } }], expectedReturns: [{ trainingSamples: 40, gross: 0.02 }, { trainingSamples: 40, gross: 0.02 }] };
  let s = marketGame.initialPosition();
  const step = (intent) => { const r = marketGame.extend(s, intent); s = r.state; return r; };
  const observe = (id, value, source = 'urn:test') => step({ kind: 'observe', observation: { id, source, value, availableAt: at, observedAt: at } });
  observe('cal', { kind: 'calibration', ...calibration });
  observe('model', { kind: 'scenario-likelihood-model', model: spec });
  observe('mid', { mid: 0.3 }, 'urn:test:mid');
  step({ kind: 'forecast', forecast: { id: 'base', observedAt: at, horizon, evidenceIds: ['cal'], calibration, scenarios: [
    { id: 'yes', probability: 0.5, values: {}, heldPnlCentsByVenue: {} }, { id: 'no', probability: 0.5, values: {}, heldPnlCentsByVenue: {} }] } });
  const result = step({ kind: 'condition', observationId: 'mid', model: { evidenceId: 'model', specification: spec }, at });
  return { s, result };
}

test('a conditioned forecast played at its base\'s instant is adopted on every timestamp', () => {
  const t0 = Date.parse('2026-10-10T07:00:00.000Z');
  for (let i = 0; i < 200; i += 1) {
    const { s, result } = play(new Date(t0 + i * 7919).toISOString());
    assert.ok(s.forecast.conditioning, `run ${i}: the base forecast was kept`);
    assert.equal(s.forecast.conditioning.bin, 0);
    // posterior P(yes) = 0.5 x 0.2 / (0.5 x 0.2 + 0.5 x 0.6) = 0.25
    assert.ok(Math.abs(s.forecast.scenarios.find((x) => x.id === 'yes').probability - 0.25) < 1e-12);
    assert.deepEqual(result.events, [{ kind: 'forecast', polarity: 'P' }]);
  }
});

test('a conditioning dated before its base is refused', () => {
  const at = '2026-10-10T07:00:00.000Z';
  const { s } = play(at);
  const later = { ...s, forecast: { ...s.forecast, conditioning: undefined, observedAt: '2026-10-10T08:00:00.000Z' } };
  assert.throws(() => marketGame.extend(later, { kind: 'condition', observationId: 'mid', model: { evidenceId: 'model', specification: s.observations.model.value.model }, at }), /cannot precede/u);
});


test('shared market-game observes exact nanosecond causality rather than rounded Date milliseconds', () => {
 const earlier='2026-10-12T14:00:00.000000001Z';
 const later='2026-10-12T14:00:00.000000002Z';
 let s=marketGame.initialPosition();
 const row={id:'evidence',source:'urn:venue',observedAt:earlier,availableAt:later,value:{quote:1}};
 assert.throws(()=>marketGame.extend(s,{kind:'observe',observation:row}),/observation precedes public availability/);
 const admitted=marketGame.extend(s,{kind:'observe',observation:{...row,availableAt:earlier}});
 s=admitted.state;
 assert.equal(s.observations.evidence.observedAt,earlier);
 const sample=id=>({id,observedAt:earlier,horizon:'2026-10-13T14:00:00Z',
  evidenceIds:['evidence'],scenarios:[
  {id:'up',probability:0.5,values:{},heldPnlCentsByVenue:{}},
  {id:'down',probability:0.5,values:{},heldPnlCentsByVenue:{}},
 ]});
 s=marketGame.extend(s,{kind:'forecast',forecast:sample('first')}).state;
 s=marketGame.extend(s,{kind:'forecast',forecast:{...sample('second'),observedAt:later}}).state;
 assert.equal(s.forecast.id,'second','later source must win regardless of content hash');
 s=marketGame.extend(s,{kind:'forecast',forecast:{...sample('stale'),observedAt:earlier}}).state;
 assert.equal(s.forecast.id,'second','older source cannot displace later observation');
});
