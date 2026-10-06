#!/usr/bin/env node
/** Finite, streaming market-game runs. Never schedules or places an order. */
import { statSync, appendFileSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, existsSync } from 'node:fs';
import { marketGame, planMarket } from '../src/market-game.mjs';
import { readPublicObservation, readNewsObservations, alpacaNewsObservation, newswireObservation, evmLogObservation, kalshiMacroObservation } from '../src/public-observations.mjs';
import { hashPosition } from '@red-cup-engineering/gaming/running/rules';
import { readMarketPlay as fold } from '../src/play.mjs';
import { createResearchPublication, researchObservationMoves } from '../src/research-publication.mjs';

const args = process.argv.slice(2); const command = args.shift();
const opt = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const boundedJson = (path) => { const s = statSync(path); if (!s.isFile() || s.size > 1048576) throw new RangeError('JSON input must be a regular file <= 1 MiB'); return JSON.parse(readFileSync(path, 'utf8')); };
const appendEntry = (path, entry) => {
  const line = JSON.stringify(entry) + '\n';
  if (Buffer.byteLength(line) > 1048576 || statSync(path).size + Buffer.byteLength(line) > 32 * 1048576) throw new RangeError('play storage limit; retain the completed play and start a new bounded run');
  appendFileSync(path, line);
};
async function main() {
  if (command === 'news') {
    const feeds = boundedJson(opt('feeds')); const cursor = opt('cursor') && existsSync(opt('cursor')) ? boundedJson(opt('cursor')) : { version: 2, feeds: {} };
    const { state, seq: last } = await fold(opt('record')); let seq = last, at = state;
    const result = await readNewsObservations({ feeds, cursor });
    for (const intent of result.moves) { at = marketGame.extend(at, intent).state; appendEntry(opt('record'), { seq: ++seq, intent, ts: Date.parse(intent.observation.observedAt) }); }
    if (opt('cursor')) writeFileSync(opt('cursor'), JSON.stringify(result.cursor) + '\n');
    return { admitted: seq - last, obstructions: result.obstructions };
  }
  if (command === 'collect') {
    const config = boundedJson(opt('sources')); if (!Array.isArray(config) || config.length > 20) throw new RangeError('at most 20 public sources per pass');
    const failures = []; const { state, seq: last } = await fold(opt('record')); let seq = last, position = state;
    for (const source of config) {
      try { const intent = await readPublicObservation(source); const next = marketGame.extend(position, intent).state;
        appendEntry(opt('record'), { seq: seq + 1, intent, ts: Date.parse(intent.observation.observedAt) }); seq += 1; position = next; }
      catch (error) { failures.push({ source: source.source, reason: error.message }); }
    }
    return { admitted: seq - last, failures };
  }
  if (command === 'ingest') {
    const { state, seq: last } = await fold(opt('record')); const at = opt('at') ?? new Date().toISOString();
    const input = boundedJson(opt('input')); const format = opt('format');
    if (format === 'koios-research') {
      const moves = researchObservationMoves(input, at); let next = state;
      for (const move of moves) next = marketGame.extend(next, move).state;
      for (let i = 0; i < moves.length; i++) appendEntry(opt('record'), { seq: last + i + 1, intent: moves[i], ts: Date.parse(at) });
      return { admitted: moves.length };
    }
    const intent = format === 'alpaca-news' ? alpacaNewsObservation(input, at) : format === 'newswire' ? newswireObservation(input, at) : format === 'evm-log' ? evmLogObservation(input, at) : format === 'kalshi-macro' ? kalshiMacroObservation(input, at) : input;
    // Validate the extension before appending to the only persisted carrier.
    marketGame.extend(state, intent);
    appendEntry(opt('record'), { seq: last + 1, intent, ts: Date.parse(at) });
    return { admitted: intent.kind };
  }
  const { state, seq, rows } = await fold(opt('record'));
  if (command === 'research') {
    const research = createResearchPublication(state, boundedJson(opt('assignment')), opt('at') ?? new Date().toISOString());
    if (opt('output')) { writeFileSync(opt('output'), JSON.stringify(research, null, 2) + '\n', { flag: 'wx' }); return { packetId: research.id, facts: research.facts.length, sources: research.observations.length, output: opt('output') }; }
    return research;
  }
  if (command === 'replay') return { valid: true, rows, position: hashPosition(state), decisions: Object.keys(state.decisions).length, outcomes: Object.keys(state.outcomes).length };
  if (command === 'plan') {
    const policy = boundedJson(opt('policy')); const at = opt('at') ?? new Date().toISOString();
    const decision = planMarket(state, policy, at);
    if (args.includes('--append')) appendEntry(opt('record'), { seq: seq + 1, intent: { kind: 'decide', expectedPosition: hashPosition(state), policy, at }, ts: Date.parse(at) });
    return decision;
  }
  throw new Error('usage: market-game replay|plan|collect|news|research|ingest --record play.jsonl [--policy policy.json --at ISO --append | --sources sources.json | --feeds feeds.json --cursor cursor.json | --assignment assignment.json --output research.json | --input move.json --format alpaca-news|newswire|evm-log|koios-research]');
}
let lock;
try {
  if (['collect', 'news', 'ingest'].includes(command) || args.includes('--append')) {
    const path = opt('record'); if (!path) throw new TypeError('--record required');
    const owned = `${path}.lock`; const fd = openSync(owned, 'wx', 0o600); lock = owned; closeSync(fd);
  }
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (lock) { try { unlinkSync(lock); } catch {} } }
