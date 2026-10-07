/** Bounded streaming replay shared by strategy and newsroom consumers. */
import { createReadStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { validatePlayRecord } from '@red-cup-engineering/gaming/running/play-record';
import { marketGame } from './market-game.mjs';
export async function readMarketPlay(path) {
  const meta = statSync(path); if (!meta.isFile() || meta.size > 32 * 1048576) throw new RangeError('play must be a regular file <= 32 MiB');
  let state = marketGame.initialPosition(), seq = -1, rows = 0;
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (++rows > 20000 || Buffer.byteLength(line) > 1048576) throw new RangeError('play row limit');
    const entry = JSON.parse(line), check = validatePlayRecord([entry]);
    if (!check.valid) throw new TypeError(check.errors.join('; '));
    if (entry.seq !== seq + 1) throw new RangeError(`record sequence ${entry.seq} does not follow ${seq}`);
    if (marketGame.isTerminal?.(state)) throw new RangeError('play is already terminal');
    state = marketGame.extend(state, entry.intent).state; seq = entry.seq;
  }
  return { state, seq, rows };
}
