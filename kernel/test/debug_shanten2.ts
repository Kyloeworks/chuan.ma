/**
 * 调试2：对首个违规，打印可读牌面 + 每门 enumerateSuit 结果。
 */
import { createWall, shuffleInPlace, makeRng, countsFrom, TILE_KINDS, COPIES, type Counts, tileLabel } from '../src/tiles.ts';
import { shanten, debugShapes } from '../src/shanten.ts';

const rnd = makeRng(20260917);
for (let iter = 0; iter < 200000; iter++) {
  const wall = createWall();
  shuffleInPlace(wall, rnd);
  const ids: number[] = [];
  for (let i = 0; i < 13; i++) ids.push(wall[i]);
  const hand = countsFrom(ids);
  const sh = shanten(hand, 0);

  let minAfter = 99;
  let worstT = -1;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (hand[t] >= COPIES) continue;
    hand[t]++;
    const s2 = shanten(hand, 0);
    hand[t]--;
    if (s2 < minAfter) { minAfter = s2; worstT = t; }
  }
  if (minAfter < sh - 1) {
    const labels = (c: Counts) => c.map((n, i) => n > 0 ? `${tileLabel(i)}x${n}` : '').filter(Boolean).join(' ');
    console.log(`VIOLATION  sh13=${sh}  afterDraw(${tileLabel(worstT)})=${minAfter}`);
    console.log(`  hand13: ${labels(hand)}`);
    hand[worstT]++;
    console.log(`  hand14(+${tileLabel(worstT)}): ${labels(hand)}`);
    for (let x = 0; x < TILE_KINDS; x++) {
      if (hand[x] === 0) continue;
      hand[x]--;
      const s2 = shanten(hand, 0);
      if (s2 === minAfter) {
        const dbg = debugShapes(hand, 0);
        const tiles = labels(hand);
        const wan = hand.slice(0, 9);
        const tiao = hand.slice(9, 18);
        const tong = hand.slice(18, 27);
        console.log(`    discard ${tileLabel(x)} -> sh=${s2}`);
        console.log(`      ALL: ${tiles}`);
        console.log(`      万: ${wan.join('')}  条: ${tiao.join('')}  筒: ${tong.join('')}`);
        console.log(`      per0(万)=${JSON.stringify(dbg.per[0])}`);
        console.log(`      per1(条)=${JSON.stringify(dbg.per[1])}`);
        console.log(`      per2(筒)=${JSON.stringify(dbg.per[2])}`);
      }
      hand[x]++;
    }
    hand[worstT]--;
    process.exit(0);
  }
}
console.log('no violation');
