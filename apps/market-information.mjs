#!/usr/bin/env node
/**
 * One read-only, source-provided joint-scenario research entrypoint.
 *
 * No venue calls, remote inference purchases, signatures or order effects.
 * Modes share exactly the existing market-game forecast and EVSI operators.
 *
 * Usage:
 *   market-information assess packet.json     # signal acquisition EVSI
 *   market-information compare packet.json    # alternative research purchases
 *   market-information condition packet.json  # update on actual signal receipt
 *   market-information robust packet.json     # joint-law TV robustness and regret
 *   market-information book packet.json       # decide if an observed bid/ask is usable
 */
import {readFile} from 'node:fs/promises';
import {
  evaluateMarketInformationValue,
  compareMarketResearchAcquisitions,
  conditionMarketForecastOnSignal,
} from '../src/market-information-value.mjs';
import {evaluateJointScenarioAmbiguity} from '../src/joint-scenario-ambiguity.mjs';
import {assessExecutableBook} from '../src/executable-book.mjs';

const [mode, path, ...rest] = process.argv.slice(2);
if (!['assess','compare','condition','robust','book'].includes(mode) || !path || rest.length)
  throw new TypeError('usage: market-information assess|compare|condition|robust|book INPUT.json');
const source = await readFile(path);
if (source.length > 16_000_000)
  throw new RangeError('joint scenario research packet exceeds 16 MB');
const input = JSON.parse(source.toString('utf8'));
const operations = {
  assess: evaluateMarketInformationValue,
  compare: compareMarketResearchAcquisitions,
  condition: conditionMarketForecastOnSignal,
  robust: evaluateJointScenarioAmbiguity,
  book: assessExecutableBook,
};
const report = operations[mode](input);
process.stdout.write(JSON.stringify({
  mode, inputBytes: source.length, report,
}, null, 2) + '\n');
