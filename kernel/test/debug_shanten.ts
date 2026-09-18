/**
 * 调试：扫描 13 张手牌，找 shanten 与「摸一张最多进 1」不变量冲突的牌型并打印。
 */
import { createWall, shuffleInPlace, makeRng, countsFrom, TILE_KINDS, COPIES, type Counts } from '../src/tiles.ts';
import { canWin } from '../src/win.ts';
import { shanten, debugShapes } from '../src/shanten.ts';
import { winningTiles } from '../src/ukeire.ts';

const rnd = makeRng(20260917);
let found = 0;
for (let iter = 0; iter < 200000 && found < 8; iter++) {
  const wall = createWall();
  shuffleInPlace(wall, rnd);
  const ids: number[] = [];
  for (let i = 0; i < 13; i++) ids.push(wall[i]);
  const hand = countsFrom(ids);
  const sh = shanten(hand, 0);

  // 对每个可行的摸牌，算 14 张后的向听（走 shanten 内部：先判和，再 min discard）
  let minAfter = 99;
  let worstT = -1;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (hand[t] >= COPIES) continue;
    hand[t]++;
    const s2 = shanten(hand, 0); // 14 张
    hand[t]--;
    if (s2 < minAfter) {
      minAfter = s2;
      worstT = t;
    }
  }
  // 违反 B：摸一张进 >=2
  if (minAfter < sh - 1) {
    found++;
    console.log(`VIOLATION B  sh=${sh} minAfter=${minAfter} draw=${worstT}`);
    console.log(`  hand13=${hand.join('')}`);
    hand[worstT]++;
    console.log(`  hand14=${hand.join('')}  shanten14=${shanten(hand, 0)}`);
    // 逐张打出，找哪个 13 张子集给出 minAfter
    for (let x = 0; x < TILE_KINDS; x++) {
      if (hand[x] === 0) continue;
      hand[x]--;
      const s2 = shanten(hand, 0);
      if (s2 === minAfter) {
        const dbg = debugShapes(hand, 0);
        console.log(`    discard ${x} -> sh=${s2}`);
        console.log(`      per0=${JSON.stringify(dbg.per[0])}`);
        console.log(`      per1=${JSON.stringify(dbg.per[1])}`);
        console.log(`      per2=${JSON.stringify(dbg.per[2])}`);
        console.log(`      best=${dbg.best} shape=${JSON.stringify(dbg.bestShape)}`);
      }
      hand[x]++;
    }
    hand[worstT]--;
  }
}
if (found === 0) console.log('no violation found');
