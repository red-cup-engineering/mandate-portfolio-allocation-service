/** Bounded streaming replay shared by strategy and newsroom consumers. */
import { createReadStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRulePlayer } from '@red-cup-engineering/gaming/running/rules';
import { marketGame } from './market-game.mjs';
export async function readMarketPlay(path) {
  const meta = statSync(path); if (!meta.isFile() || meta.size > 32 * 1048576) throw new RangeError('play must be a regular file <= 32 MiB');
  const player = createRulePlayer(marketGame); let rows = 0;
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (++rows > 20000 || Buffer.byteLength(line) > 1048576) throw new RangeError('play row limit');
    player.replayEntry(JSON.parse(line));
  }
  return { state: player.position, seq: player.moves - 1, rows };
}
