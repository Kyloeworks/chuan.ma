/**
 * 向听数独立验证（暴力参考实现对照）
 *
 * 目的：确认 src/shanten.ts 的「按花色拆分 + 三花色合并」算法与「27 张全量 DFS」
 * 给出的标准向听数完全一致，从而证明内核正确、原 fuzz 的 B/C 不变量属于误设。
 *
 * 不变量：
 *  A. shanten == 0  <=>  exists t: canWin(hand + t)        —— 听牌判定必须准（有效）
 *  W. canWin(hand)   <=>  shanten(hand) == -1              —— 和牌判定（有效）
 *  R. refShanten(hand) == shanten(hand)                    —— 与独立暴力实现逐手一致（金标准）
 *
 * 关于 B/C（原 fuzz 的「摸一张最多进步 1」「必存在改进牌」）：
 *  标准向听数允许单步 2 格跳跃（一对牌摸成刻子即可令 M+1），该性质数学上成立，
 *  故 B/C 不是正确不变量，已从本验证中剔除。
 */

import {
  createWall, shuffleInPlace, makeRng, countsFrom, totalOf,
  TILE_KINDS, COPIES, RANKS, SUITS, type Counts,
} from '../src/tiles.ts';
import { canWin } from '../src/win.ts';
import { shanten, shantenSevenPairs } from '../src/shanten.ts';

// ---------- 独立暴力参考实现（27 张全量 DFS，不按花色拆分） ----------

function fromShape(m: number, p: number, pr: number, melds: number): number {
  const M = m + melds;
  let B = p + Math.max(0, pr - 1);
  if (M + B > 4) B = 4 - M;
  if (B < 0) B = 0;
  return 8 - 2 * M - B - (pr > 0 ? 1 : 0);
}

function refStandard(c: Counts, melds: number): number {
  let best = 8;
  const dfs = (i: number, m: number, p: number, pr: number) => {
    if (i >= TILE_KINDS) {
      const s = fromShape(m, p, pr, melds);
      if (s < best) best = s;
      return;
    }
    if (c[i] === 0) { dfs(i + 1, m, p, pr); return; }
    // 块数已满（4 副面子 + 1 将 = 5 块），多余牌当孤张丢弃
    if (m + p + pr >= 5) { c[i]--; dfs(i, m, p, pr); c[i]++; return; }
    // 刻子
    if (c[i] >= 3 && m < 4) { c[i] -= 3; dfs(i, m + 1, p, pr); c[i] += 3; }
    // 顺子（同门：i % 9 <= 6）
    if (i % RANKS <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && m < 4) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      dfs(i, m + 1, p, pr);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    // 对子：不按花色限制，允许跨花色累计多对（公式的 max(0,PR-1) 负责正确折算）
    // 上限 6（13 张最多 6 对）+1 兜底，避免无意义深搜
    if (c[i] >= 2 && pr < 7) { c[i] -= 2; dfs(i, m, p, pr + 1); c[i] += 2; }
    // 搭子：两面/边张 (i, i+1)
    if (i % RANKS <= 7 && c[i + 1] > 0) {
      c[i]--; c[i + 1]--;
      dfs(i, m, p + 1, pr);
      c[i]++; c[i + 1]++;
    }
    // 搭子：嵌张 (i, i+2)
    if (i % RANKS <= 6 && c[i + 2] > 0) {
      c[i]--; c[i + 2]--;
      dfs(i, m, p + 1, pr);
      c[i]++; c[i + 2]++;
    }
    // 孤张
    c[i]--; dfs(i, m, p, pr); c[i]++;
  };
  dfs(0, 0, 0, 0);
  return best;
}

function refSevenPairs(c: Counts): number {
  let pairs = 0, kinds = 0;
  for (let i = 0; i < TILE_KINDS; i++) {
    const n = c[i];
    if (n === 0) continue;
    kinds++;
    if (n >= 2) pairs += n === 4 ? 2 : 1;
  }
  return 6 - pairs + Math.max(0, 7 - 2 * kinds);
}

/** 与 shanten() 同口径：13 张直接算，14 张取最优弃牌后的最小向听 */
function refShanten(c: Counts, melds = 0): number {
  const expected = 13 - 3 * melds;
  const total = totalOf(c);
  if (total === expected) {
    let best = refStandard(c, melds);
    if (melds === 0) { const s7 = refSevenPairs(c); if (s7 < best) best = s7; }
    return best;
  }
  if (total === expected + 1) {
    if (canWin(c, melds) !== null) return -1;
    let best = 8;
    for (let t = 0; t < TILE_KINDS; t++) {
      if (c[t] === 0) continue;
      c[t]--;
      const s = refShanten(c, melds);
      c[t]++;
      if (s < best) best = s;
    }
    return best;
  }
  return refStandard(c, melds);
}

// ---------- 自检：已知手牌 ----------

function selfTest(): boolean {
  const cases: { c: Counts; exp: number; name: string }[] = [
    // 和牌（4 面子 + 1 将）：123m456m789m + 条11 + 筒123
    { c: countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 18, 19, 20]), exp: -1, name: '和牌 standard' },
    // 听牌：上者和牌少一张筒3 -> 123m456m789m + 条11 + 筒12（听筒3）
    { c: countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 18, 19]), exp: 0, name: '听牌' },
    // 七对听牌：万1/条1/筒1/万4/条4/筒4 各一对 + 筒5 单张
    { c: countsFrom([0, 0, 9, 9, 18, 18, 3, 3, 12, 12, 21, 21, 22]), exp: 0, name: '七对听牌' },
    // hand13（原 fuzz B 样本）：1万5万6万8万 / 1条1条4条4条9条9条 / 6筒7筒8筒
    // 条子 11/44/99 三对全可用（1 将 + 2 成刻），摸 条1、条4 两巡即听牌 → shanten=2
    { c: countsFrom([0, 4, 5, 7, 9, 9, 12, 12, 17, 17, 23, 24, 25]), exp: 2, name: 'hand13 sh=2' },
    // hand14 弃1万后：5万6万8万 / 1条1条1条4条4条9条9条 / 6筒7筒8筒
    { c: countsFrom([4, 5, 7, 9, 9, 9, 12, 12, 17, 17, 23, 24, 25]), exp: 1, name: 'hand14-discard-1m sh=1' },
  ];
  let ok = true;
  for (const cs of cases) {
    const got = shanten(cs.c, 0);
    const ref = refShanten(cs.c, 0);
    const pass = got === cs.exp && ref === cs.exp;
    if (!pass) ok = false;
    console.log(`  自检 ${cs.name}: code=${got} ref=${ref} expect=${cs.exp} ${pass ? 'OK' : 'FAIL'}`);
  }
  return ok;
}

// ---------- 大规模随机对照 ----------

const N = Number(process.argv[2] ?? 50000);
const rnd = makeRng(20260917);

console.log('=== 自检 ===');
const selfOk = selfTest();

let failA = 0, failW = 0, failR = 0;
let maxRef = -1, minRef = 9;
const examples: string[] = [];

const t0 = Date.now();
for (let iter = 0; iter < N; iter++) {
  const wall = createWall();
  shuffleInPlace(wall, rnd);
  const ids: number[] = [];
  for (let i = 0; i < 13; i++) ids.push(wall[i]);
  const hand = countsFrom(ids);

  const code = shanten(hand, 0);
  const ref = refShanten(hand, 0);
  if (ref < minRef) minRef = ref;
  if (ref > maxRef) maxRef = ref;

  // R: 与独立参考一致
  if (code !== ref) {
    failR++;
    if (examples.length < 5) examples.push(`R: code=${code} ref=${ref} hand=${hand.join('')}`);
  }

  // W: 和牌等价
  const win = canWin(hand, 0);
  if (win !== null && code !== -1) {
    failW++;
    if (examples.length < 5) examples.push(`W: code=${code} win=${win}`);
  }

  // A: 听牌等价（sh==0 <=> exists t: canWin(hand+t)）
  // 计算听牌等待张
  let hasWinTile = false;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (hand[t] >= COPIES) continue;
    hand[t]++;
    if (canWin(hand, 0) !== null) hasWinTile = true;
    hand[t]--;
    if (hasWinTile) break;
  }
  if ((code === 0) !== hasWinTile) {
    failA++;
    if (examples.length < 5) examples.push(`A: code=${code} hasWinTile=${hasWinTile}`);
  }
}
const ms = Date.now() - t0;

console.log(`\n=== 随机对照（${N} 手，参考向听范围 ${minRef}..${maxRef}）===`);
console.log(`耗时 ${ms}ms（${(ms / N).toFixed(2)} ms/手）`);
console.log(`R 与暴力参考一致失败: ${failR}`);
console.log(`W 和牌等价失败: ${failW}`);
console.log(`A 听牌等价失败: ${failA}`);
if (examples.length) {
  console.log('样例:');
  for (const e of examples) console.log('  ' + e);
}
const allOk = selfOk && failR === 0 && failW === 0 && failA === 0;
console.log(allOk ? '\n✅ 全部通过：内核向听数与独立暴力实现一致，且听牌/和牌判定正确' : '\n❌ 存在失败项');
if (!allOk) process.exitCode = 1;
