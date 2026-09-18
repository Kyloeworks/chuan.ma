/**
 * 向听数交叉验证（暴力对照）
 *
 * 验证三条硬性质：
 *  A. shanten == 0  <=>  exists t: canWin(hand + t)      —— 听牌判定必须准
 *  B. 对任意 t: shanten(hand + t) >= shanten(hand) - 1   —— 摸一张最多进步 1
 *  C. exists t: shanten(hand + t) == shanten(hand) - 1   —— 一定存在能进步的牌
 */

import { createWall, shuffleInPlace, makeRng, countsFrom, TILE_KINDS, COPIES, type Counts } from '../src/tiles.ts';
import { canWin } from '../src/win.ts';
import { shanten } from '../src/shanten.ts';
import { winningTiles } from '../src/ukeire.ts';

const N = Number(process.argv[2] ?? 20000);
const rnd = makeRng(20260917);

function drawHand(wall: number[], n: number): Counts {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(wall[i]);
  return countsFrom(ids);
}

let failA = 0, failB = 0, failC = 0;
const examples: string[] = [];

const t0 = Date.now();
for (let iter = 0; iter < N; iter++) {
  const wall = createWall();
  shuffleInPlace(wall, rnd);
  const hand = drawHand(wall, 13);

  const sh = shanten(hand, 0);
  const wins = winningTiles(hand, 0);

  // A
  if ((sh === 0) !== (wins.length > 0)) {
    failA++;
    if (examples.length < 5) examples.push(`A: sh=${sh} wins=${wins.length} hand=${hand.join('')}`);
  }

  // 摸一张后的向听
  let minAfter = 99;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (hand[t] >= COPIES) continue;
    hand[t]++;
    const s2 = shanten(hand, 0);
    hand[t]--;
    if (s2 < minAfter) minAfter = s2;
    // B
    if (s2 < sh - 1) {
      failB++;
      if (examples.length < 5) examples.push(`B: sh=${sh} after=${s2} t=${t}`);
    }
  }

  // C
  if (minAfter !== sh - 1) {
    failC++;
    if (examples.length < 5) examples.push(`C: sh=${sh} minAfter=${minAfter} hand=${hand.join('')}`);
  }
}
const ms = Date.now() - t0;

console.log(`样本 ${N} 手，耗时 ${ms}ms（${(ms / N).toFixed(2)} ms/手）`);
console.log(`A 听牌等价性失败: ${failA}`);
console.log(`B 单步下降上限失败: ${failB}`);
console.log(`C 存在改进牌失败: ${failC}`);
if (examples.length) {
  console.log('样例:');
  for (const e of examples) console.log('  ' + e);
}
if (failA + failB + failC === 0) console.log('全部通过');
else process.exitCode = 1;
