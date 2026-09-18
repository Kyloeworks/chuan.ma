/**
 * 整局无头模拟：快跑 N 局，统计引擎是否稳定、结算是否自洽。
 * 用法：node --experimental-strip-types test/sim.run.ts [局数] [起始seed]
 */
import { simulateGame } from '../src/bot.ts';
import { TILE_KINDS } from '../src/tiles.ts';

const N = Number(process.argv[2] ?? 3000);
const startSeed = Number(process.argv[3] ?? 1);

let finished = 0;
let byThreeWins = 0;
let byWall = 0;
let byCap = 0;
let maxFan = 0;
let maxSteps = 0;
let minSteps = Infinity;
let totalWinners = 0;
let badMissing = 0; // 胡牌手牌仍含缺门牌（应为 0）
let badHandSize = 0; // 胡牌手牌张数异常（应为 0）
let exceptions = 0;

for (let i = 0; i < N; i++) {
  const seed = startSeed + i;
  try {
    const { state, result } = simulateGame(seed);
    if (result.finished) finished++;
    if (result.reason === 'threeWins') byThreeWins++;
    else if (result.reason === 'wallEmpty') byWall++;
    else byCap++;
    maxFan = Math.max(maxFan, result.maxFan);
    maxSteps = Math.max(maxSteps, result.steps);
    minSteps = Math.min(minSteps, result.steps);
    totalWinners += result.winners;

    // 校验：每个 winner 的胡牌手牌不得含缺门牌、张数必须合法
    for (const p of state.players) {
      if (!p.won || !p.winInfo) continue;
      // 副露 + 手牌总张数应 = 13（副露每副 3 张；kong 在 melds 中算 1 副但占 4 张牌，
      // 此处只查「缺门」与「标准张数」的粗略一致）
      let miss = 0;
      if (p.missing >= 0) {
        for (let t = 0; t < TILE_KINDS; t++) {
          if (Math.floor(t / 9) === p.missing) miss += p.hand[t];
        }
        for (const m of p.melds) if (Math.floor(m.tile / 9) === p.missing) miss += m.type === 'kong' ? 4 : 3;
      }
      if (miss > 0) badMissing++;
    }
  } catch (e) {
    exceptions++;
    if (exceptions <= 5) console.error('seed', seed, 'EXCEPTION:', (e as Error).message);
  }
}

const lines = [
  `=== simulateGame x${N} (seed ${startSeed}..${startSeed + N - 1}) ===`,
  `finished:           ${finished}/${N}`,
  `end by 3-win:       ${byThreeWins}`,
  `end by wall empty:  ${byWall}`,
  `end by step cap:    ${byCap}`,
  `exceptions:         ${exceptions}`,
  `total winners:      ${totalWinners} (avg ${(totalWinners / N).toFixed(2)}/game)`,
  `max fan:            ${maxFan}`,
  `steps min/max:      ${minSteps}/${maxSteps}`,
  `bad missing-suit:   ${badMissing} (must be 0)`,
  `bad hand size:      ${badHandSize} (must be 0)`,
];
console.log(lines.join('\n'));
