#!/usr/bin/env node
/** Finite, streaming market-game runs. Never schedules or places an order. */
import { statSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, existsSync } from 'node:fs';
import { marketGame, planMarket } from '../src/market-game.mjs';
import {readMarketOutcomeEvidence} from '../src/outcome-evidence-border.mjs';
import {projectMarketOutcomeEvidenceSigns} from '../src/settlement-sign-evidence.mjs';
import {marketGameSeavt} from '../src/scenario-sign-history.mjs';
import { readPublicObservation, readNewsObservations, alpacaNewsObservation, newswireObservation, evmLogObservation, kalshiMacroObservation } from '../src/public-observations.mjs';
import { hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { readMarketPlay as fold, appendMarketMove, migrateLegacyMarketPlay } from '../src/play.mjs';
import { createResearchPublication, researchObservationMoves } from '../src/research-publication.mjs';

const args = process.argv.slice(2); const command = args.shift();
const opt = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const boundedJson = (path) => { const s = statSync(path); if (!s.isFile() || s.size > 1048576) throw new RangeError('JSON input must be a regular file <= 1 MiB'); return JSON.parse(readFileSync(path, 'utf8')); };
async function main() {
  if (command === 'migrate') return migrateLegacyMarketPlay(opt('record'));
  if (command === 'news') {
    const feeds = boundedJson(opt('feeds')); const cursor = opt('cursor') && existsSync(opt('cursor')) ? boundedJson(opt('cursor')) : { version: 2, feeds: {} };
    const { state, seq: last } = await fold(opt('record')); let seq = last, at = state;
    const result = await readNewsObservations({ feeds, cursor });
    for (const intent of result.moves) { const next = marketGame.extend(at, intent).state; appendMarketMove(opt('record'), at, ++seq, intent); at = next; }
    if (opt('cursor')) writeFileSync(opt('cursor'), JSON.stringify(result.cursor) + '\n');
    return { admitted: seq - last, obstructions: result.obstructions };
  }
  if (command === 'collect') {
    const config = boundedJson(opt('sources')); if (!Array.isArray(config) || config.length > 20) throw new RangeError('at most 20 public sources per pass');
    const failures = []; const { state, seq: last } = await fold(opt('record')); let seq = last, position = state;
    for (const source of config) {
      try { const intent = await readPublicObservation(source); const next = marketGame.extend(position, intent).state;
        appendMarketMove(opt('record'), position, seq + 1, intent); seq += 1; position = next; }
      catch (error) { failures.push({ source: source.source, reason: error.message }); }
    }
    return { admitted: seq - last, failures };
  }
  if (command === 'ingest') {
    const { state, seq: last } = await fold(opt('record')); const at = opt('at') ?? new Date().toISOString();
    const input = boundedJson(opt('input')); const format = opt('format');
    if (format === 'koios-research') {
      const moves = researchObservationMoves(input, at); let next = state;
      const admitted = [];
      for (const move of moves) { const before = next; next = marketGame.extend(next, move).state; admitted.push({ before, move }); }
      for (let i = 0; i < admitted.length; i++) appendMarketMove(opt('record'), admitted[i].before, last + i + 1, admitted[i].move);
      return { admitted: moves.length };
    }
    const intent = format === 'alpaca-news' ? alpacaNewsObservation(input, at) : format === 'newswire' ? newswireObservation(input, at) : format === 'evm-log' ? evmLogObservation(input, at) : format === 'kalshi-macro' ? kalshiMacroObservation(input, at) : input;
    // Admit and persist the same canonical witnessed SEAVT carrier.
    appendMarketMove(opt('record'), state, last + 1, intent);
    return { admitted: intent.kind };
  }
  const { state, seq, rows } = await fold(opt('record'));
  if (command === 'research') {
    const research = createResearchPublication(state, boundedJson(opt('assignment')), opt('at') ?? new Date().toISOString());
    if (opt('output')) { writeFileSync(opt('output'), JSON.stringify(research, null, 2) + '\n', { flag: 'wx' }); return { packetId: research.id, facts: research.facts.length, sources: research.observations.length, output: opt('output') }; }
    return research;
  }
  if(command==='seavt'){
    // Native SignCell/SCA/SEN/SEAVT presentation of the SAME replayed
    // Kalshi/Alpaca/GMX game, no sidecar, extra log, or new trade.
    return marketGameSeavt(state,opt('at')??new Date().toISOString());
  }
  if (command === 'evidence') {
    // An ephemeral read of existing market moves, not another journal or
    // a new financial fact. Nothing is appended and no trade is eligible.
    const at=opt('at')??new Date().toISOString();
    const view=readMarketOutcomeEvidence(state,at);
    const blocked=[...new Map(view.riskBlockingDisputes.map(x=>[
      JSON.stringify([x.principal,x.strategy]),
      {principal:x.principal,strategy:x.strategy,reason:'source-linked-outcome-disagreement'},
    ])).values()];
    const report={
      kind:'market-game-outcome-knowledge-reading-v1',
      at,position:hashPosition(state),
      economicEvents:view.events.length,
      contradictoryEvents:view.disputes.length,
      sourceLinkedDisputes:view.riskBlockingDisputes.length,
      blockedStrategies:blocked,
      ambiguousStrategyNames:view.ambiguousStrategyNames,
      conditionalPerformanceByPrincipal:view.performanceByPrincipal,
      acceptedMeasuredOutcomes:0,
      // A consumer must separately obtain independently received settlement
      // and accounting facts; a positive source-link is not authenticated.
      sourceAuthenticated:false,independentlyReconciled:false,
      effect:'read-only',
    };
    if(args.includes('--signs')){
      const signs=projectMarketOutcomeEvidenceSigns({state,at});
      report.conflictSigns=signs.claims.filter(x=>x.opposesClaim)
        .map(x=>({address:x.address,proposition:x.proposition,
          supportsClaim:x.supportsClaim,opposesClaim:x.opposesClaim}));
    }
    return report;
  }
  if (command === 'replay') return { valid: true, rows, position: hashPosition(state), decisions: Object.keys(state.decisions).length, outcomes: Object.keys(state.outcomes).length };
  if (command === 'plan') {
    const policy = boundedJson(opt('policy')); const at = opt('at') ?? new Date().toISOString();
    const decision = planMarket(state, policy, at);
    if (args.includes('--append')) appendMarketMove(opt('record'), state, seq + 1, { kind: 'decide', expectedPosition: hashPosition(state), policy, at });
    return decision;
  }
  throw new Error('usage: market-game migrate|replay|seavt|evidence|plan|collect|news|research|ingest --record native-seavt-play.jsonl [--policy policy.json --at ISO --append | --sources sources.json | --feeds feeds.json --cursor cursor.json | --assignment assignment.json --output research.json | --input move.json --format alpaca-news|newswire|evm-log|koios-research]');
}
let lock;
try {
  if (['collect', 'news', 'ingest', 'migrate'].includes(command) || args.includes('--append')) {
    const path = opt('record'); if (!path) throw new TypeError('--record required');
    const owned = `${path}.lock`; const fd = openSync(owned, 'wx', 0o600); lock = owned; closeSync(fd);
  }
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (lock) { try { unlinkSync(lock); } catch {} } }
