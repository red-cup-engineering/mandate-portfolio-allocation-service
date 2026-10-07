#!/usr/bin/env node
/** Executable synthetic example, never a forecast or a trade recommendation.
 * All prices, calibration rows and scenario likelihoods here are fabricated
 * to demonstrate the carrier. Actual operation requires measured records.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { marketGame, planMarket, allocationFor, strategyPerformance } from '../src/market-game.mjs';
import { hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { formAggressivePortfolioIntent } from '../../alpha-portfolio-order-intent-service/src/aggressive-intent.mjs';
import { createGmxAdapter, GMX_CHAINS, usdToE30 } from '../../pluggable-venue-adapter-service/src/gmx-adapter.mjs';
import { venueOrderForIntent } from '../../brokerage-execution-transport-service/src/execute-intent.mjs';

const at = '2026-10-06T15:00:00.000Z', later = '2026-10-06T15:00:01.000Z', horizon = '2026-10-07T15:00:00.000Z';
const market = '0x1111111111111111111111111111111111111111';
const calibration = { sampleSize: 100, brier: .1, baselineBrier: .2, windowEnd: '2026-10-05T15:00:00.000Z', record: 'example:calibration', confidenceLowerBound: .01, netReturnConfidenceLowerBound: .01, liveUseLimitations: [] };
const policy = { maxObservationAgeMs: 60000, minCalibrationSamples: 30, minCashCentsByVenue: { kalshi: 10000, alpaca: 10000, evm: 10000 }, maxDeployFraction: .5, maxInstrumentFraction: .15, maxScenarioLossFraction: .25, factorCaps: { technology: .45, crypto: .3 }, kellyMultiple: .5 };
const record = [];
let position = marketGame.initialPosition();
const play = (intent, stamp = at) => {
  const result = marketGame.extend(position, intent);
  record.push({ seq: record.length, intent, ts: Date.parse(stamp) });
  position = result.state; return result;
};
const observe = (id, source, value, stamp = at) => play({ kind: 'observe', observation: { id, source, value, availableAt: stamp, observedAt: stamp } }, stamp);
observe('example:calibration', 'urn:synthetic:scored-forecasts', { kind: 'calibration', ...calibration });
observe('example:technology', 'urn:synthetic:issuer-release', { demand: 'growth', kind: 'news' });
for (const venue of ['kalshi', 'alpaca', 'evm']) play({ kind: 'account', account: { venue, observedAt: at, equityCents: 100000, freeCashCents: 100000, factorExposureCents: {} } });
const quotes = [
  { id: 'example:kalshi', venue: 'kalshi', instrument: 'EXAMPLE-TECH-YES', carrier: 'binary', side: 'yes', entryPrice: .25, availableUnits: 10000, unitStep: 1, factors: { technology: 1 } },
  { id: 'example:alpaca', venue: 'alpaca', instrument: 'EXAMPLE', carrier: 'asset', assetClass: 'us_equity', side: 'long', entryPrice: 100, availableUnits: 1000, unitStep: .001, factors: { technology: 1 } },
  { id: 'example:evm', venue: 'evm', instrument: market, carrier: 'collateral', side: 'long', entryPrice: 1, availableUnits: 10000, unitStep: .01, chainId: 42161, blockHash: `0x${'1'.repeat(64)}`, finalized: true, protocol: 'gmx', leverage: 1, collateralToken: GMX_CHAINS[42161].usdc, factors: { technology: 1, crypto: 1 } },
];
for (const quote of quotes) {
  play({ kind: 'quote', quote: { ...quote, observedAt: at, horizon, transitionCostFraction: .001, carryCostFraction: .001 } });
  play({ kind: 'strategy', strategy: { id: `strategy:${quote.venue}`, observedAt: at, quoteIds: [quote.id], evidenceIds: ['example:technology'], thesis: 'Synthetic technology/crypto scenario exposure', falsifier: 'Measured scenario model fails its baseline' } });
}
play({ kind: 'forecast', forecast: { id: 'example:forecast', observedAt: at, horizon, evidenceIds: ['example:calibration', 'example:technology'], calibration, scenarios: [
  { id: 'growth', probability: .4, values: { 'example:kalshi': 1, 'example:alpaca': 140, 'example:evm': 1.5 }, heldPnlCentsByVenue: { kalshi: 0, alpaca: 0, evm: 0 } },
  { id: 'tech-down', probability: .35, values: { 'example:kalshi': 0, 'example:alpaca': 80, 'example:evm': 1.2 }, heldPnlCentsByVenue: { kalshi: 0, alpaca: 0, evm: 0 } },
  { id: 'crypto-down', probability: .25, values: { 'example:kalshi': 0, 'example:alpaca': 110, 'example:evm': .4 }, heldPnlCentsByVenue: { kalshi: 0, alpaca: 0, evm: 0 } },
] } });
const before = planMarket(position, policy, at);
if (new Set(before.orders.map((o) => o.venue)).size !== 3) throw new Error('example did not fund all three venue carriers');
play({ kind: 'decide', at, policy, expectedPosition: hashPosition(marketGame.serialize(position)) });
const contract = { type: 'PrincipalBrokerageServiceContract', id: 'example:contract', scopes: ['orders:intent'], risk: { maximumOrderNotional: 500, maximumLossAmount: 500, concentrationLimit: 1 }, capital: { amount: 1000, currency: 'USD' } };
const alpacaOrder = before.orders.find((o) => o.venue === 'alpaca');
const intent = formAggressivePortfolioIntent({ contract, evidencePackets: [{ type: 'IssuerEvidencePacket', id: 'example:packet' }], symbol: 'EXAMPLE', notional: alpacaOrder.capitalCents / 100, maximumLoss: alpacaOrder.capitalCents / 100, thesis: 'Synthetic only', falsifier: 'Synthetic only', liquidityPremise: 'Synthetic only', executionPremise: 'Synthetic only', scenarios: [{ pnl: 10 }, { pnl: -10 }], marketDecision: before, asOf: at });
const alpacaVenueOrder = venueOrderForIntent(intent, at, 'synthetic-client-order');
const chain = GMX_CHAINS[42161];
const gmx = createGmxAdapter({ rpc: async () => `0x${'f'.repeat(64)}` });
const evmOrder = before.orders.find((o) => o.venue === 'evm');
const collateralUsd = evmOrder.capitalCents / 100;
const grant = { type: 'RevocableBrokerageAuthorityGrant', id: 'example:grant', revoked: false, adapter: 'gmx', chainId: 42161, account: market, validUntil: horizon, scopes: ['orders:build'], limits: { maxLeverage: 2, maxValuePerTransactionUsd: 1000, allowedContracts: [chain.exchangeRouter, chain.orderVault, chain.router, chain.usdc] } };
const unsigned = await gmx.buildPerpOrder({ grant, now: at, marketDecision: before, order: { market, collateralToken: chain.usdc, collateralAmount: BigInt(Math.floor(collateralUsd * 1e6)), collateralUsd, sizeDeltaUsd: usdToE30(collateralUsd), isLong: true, acceptablePriceE30: usdToE30(100), executionFeeWei: 1n } });
const specification = { source: 'urn:synthetic:kalshi-probability', path: ['probability'], calibration, bins: [
  { lower: 0, upper: .5, likelihoods: { growth: .1, 'tech-down': .7, 'crypto-down': .2 } },
  { lower: .5, upper: 1.01, likelihoods: { growth: .7, 'tech-down': .1, 'crypto-down': .2 } },
] };
observe('example:model', 'urn:synthetic:likelihood-calibration', { kind: 'scenario-likelihood-model', model: specification });
observe('example:new-price', specification.source, { probability: .3 }, later);
play({ kind: 'condition', observationId: 'example:new-price', model: { evidenceId: 'example:model', specification }, at: later }, later);
const after = planMarket(position, policy, later);
if (JSON.stringify(before.orders.map((o) => [o.venue, o.capitalCents])) === JSON.stringify(after.orders.map((o) => [o.venue, o.capitalCents]))) throw new Error('conditioning did not change cross-venue allocation');
// One observed execution receipt, rather than the shadow proposal, updates performance.
play({ kind: 'outcome', outcome: { id: 'example:outcome', decisionId: before.id, orderId: alpacaOrder.id, receipt: 'urn:synthetic:fill-and-mark', observedAt: later, pnlCents: 25 } }, later);
const replay = marketGame.replay(undefined, record.map((entry) => entry.intent));
if (!replay.valid || replay.stateHash !== hashPosition(marketGame.serialize(position))) throw new Error('replay differs from arrival');
const recordIndex = process.argv.indexOf('--record');
if (recordIndex >= 0) { const path = process.argv[recordIndex + 1]; if (existsSync(path)) throw new Error('example refuses to overwrite an existing play'); writeFileSync(path, record.map((entry) => JSON.stringify(entry)).join('\n') + '\n'); }
const summary = (decision) => decision.orders.map(({ venue, capitalCents }) => ({ venue, capitalCents }));
console.log(JSON.stringify({ synthetic: true, venueWrites: 0, before: summary(before), afterPredictionMarketObservation: summary(after), alpacaIntentBound: intent.marketDecision.id === before.id,
  alpacaEntryCeiling: alpacaVenueOrder.limit_price, alpacaFundedQuantity: alpacaVenueOrder.qty,
  evmUnsignedPlanBound: unsigned.marketDecision === before.id && unsigned.signed === false && unsigned.broadcast === false,
  replayHash: replay.stateHash, replayEqualsArrival: true, outcomes: strategyPerformance(position), kalshiCapCents: allocationFor(before, { venue: 'kalshi', instrument: 'EXAMPLE-TECH-YES', side: 'yes', at }) }, null, 2));
