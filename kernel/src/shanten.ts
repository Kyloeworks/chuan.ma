/**
 * 向听数（shanten）
 *
 * 定义：shanten = 0 表示听牌（再摸 1 张就和）；-1 表示已和；k 表示还需摸 k 次。
 *
 * 标准型公式（经推导与穷举校验）：
 *   B = partials + max(0, pairs - 1)        // 超出将牌的对子可当搭子用
 *   if (M + B > 4) B = 4 - M                // 最多 4 副面子，多余的搭子无效
 *   shanten = 8 - 2*M - B - (pairs > 0 ? 1 : 0)
 *
 * 其中 M = 面子数（含副露），partials = 搭子数（两面/边张/嵌张），pairs = 对子数。
 *
 * 实现：按花色分别枚举所有可行的 (面子, 搭子, 对子) 分解，再做三花色合并取最优。
 * 相比直接对 27 位 DFS，按花色分解把复杂度从指数级降到常数级。
 */

import { RANKS, SUITS, TILE_KINDS, totalOf, type Counts } from './tiles.ts';
import { canWin } from './win.ts';

export type Shape = { m: number; p: number; pr: number };

const MAX_M = 4;
const MAX_BLOCK = 5;

/** 单花色（9 位 counts）所有可行的分解，去重后返回 */
function enumerateSuit(c9: number[]): Shape[] {
  const seen = new Set<number>();
  const out: Shape[] = [];

  const record = (m: number, p: number, pr: number) => {
    const key = m * 36 + p * 6 + pr;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ m, p, pr });
  };

  const dfs = (i: number, m: number, p: number, pr: number) => {
    if (i >= RANKS) {
      record(m, p, pr);
      return;
    }
    if (c9[i] === 0) {
      dfs(i + 1, m, p, pr);
      return;
    }

    // 剪枝：面子已满、对子已够、整手 block 已超上限
    if (m + p + pr >= MAX_BLOCK) {
      // 仍然要继续走完，但不再产生新的 block —— 直接把剩余牌当孤张丢弃
      c9[i]--;
      dfs(i, m, p, pr);
      c9[i]++;
      return;
    }

    // 刻子
    if (c9[i] >= 3 && m < MAX_M) {
      c9[i] -= 3;
      dfs(i, m + 1, p, pr);
      c9[i] += 3;
    }
    // 顺子
    if (i <= 6 && c9[i + 1] > 0 && c9[i + 2] > 0 && m < MAX_M) {
      c9[i]--; c9[i + 1]--; c9[i + 2]--;
      dfs(i, m + 1, p, pr);
      c9[i]++; c9[i + 1]++; c9[i + 2]++;
    }
    // 对子：单花色可含多个对子（如 11/44/99），全部可用（1 将 + 其余成刻为搭子）。
    // 上限 6：单花色最多约 5 个对子；公式的 max(0,PR-1) 会正确折算多余对子。
    if (c9[i] >= 2 && pr < 6) {
      c9[i] -= 2;
      dfs(i, m, p, pr + 1);
      c9[i] += 2;
    }
    // 搭子：两面 / 边张 (i, i+1)
    if (i <= 7 && c9[i + 1] > 0) {
      c9[i]--; c9[i + 1]--;
      dfs(i, m, p + 1, pr);
      c9[i]++; c9[i + 1]++;
    }
    // 搭子：嵌张 (i, i+2)
    if (i <= 6 && c9[i + 2] > 0) {
      c9[i]--; c9[i + 2]--;
      dfs(i, m, p + 1, pr);
      c9[i]++; c9[i + 2]++;
    }
    // 当孤张丢弃
    c9[i]--;
    dfs(i, m, p, pr);
    c9[i]++;
  };

  dfs(0, 0, 0, 0);
  return out;
}

function shantenFromShape(M: number, P: number, PR: number): number {
  let B = P + Math.max(0, PR - 1);
  if (M + B > 4) B = 4 - M;
  if (B < 0) B = 0;
  return 8 - 2 * M - B - (PR > 0 ? 1 : 0);
}

/**
 * 标准型向听。melds = 已副露面子数（碰/杠各算 1 副）。
 * 手牌张数通常 = 13 - melds*3（川麻杠后不减张，由流程层保证）。
 */
export function shantenStandard(c: Counts, melds = 0): number {
  const per: Shape[][] = [];
  for (let s = 0; s < SUITS; s++) {
    const base = s * RANKS;
    const c9 = new Array(RANKS);
    for (let i = 0; i < RANKS; i++) c9[i] = c[base + i];
    per.push(enumerateSuit(c9));
  }

  let best = 8;
  for (const a of per[0]) {
    for (const b of per[1]) {
      const m0 = a.m + b.m;
      if (m0 > MAX_M + 1) continue;
      for (const d of per[2]) {
        const M = m0 + d.m + melds;
        if (M > 4) continue;
        const sh = shantenFromShape(M, a.p + b.p + d.p, a.pr + b.pr + d.pr);
        if (sh < best) best = sh;
      }
    }
  }
  return best;
}

/**
 * 暗七对向听：6 - 对子数 + 种类不足惩罚。
 *
 * 川麻允许「龙七对」—— 同一张牌 4 张算 2 对。因此每种牌的「对子名额」上限为 2，
 * 种类约束应为 max(0, 7 - 2*kinds)，而非日麻的 max(0, 7 - kinds)。
 * 对合法 13 张手牌而言至少 4 种（2*4=8>=7），该约束恒为 0，但保留以求完备。
 */
export function shantenSevenPairs(c: Counts): number {
  let pairs = 0;
  let kinds = 0;
  for (let i = 0; i < TILE_KINDS; i++) {
    const n = c[i];
    if (n === 0) continue;
    kinds++;
    if (n >= 2) pairs += n === 4 ? 2 : 1; // 龙七对：4 张算 2 对
  }
  const lack = Math.max(0, 7 - 2 * kinds);
  return 6 - pairs + lack;
}

/**
 * 综合向听：取标准型与七对型的较小值。
 * 七对必须门清，副露后只走标准型。
 *
 * 张数归一化（关键）：公式针对「标准手牌张数 = 13 - 3*melds」推导。
 * 若传入 14 张（刚摸完待打），必须打掉一张后再求最小向听 —— 否则单张摸牌
 * 会算出错误的「向听 -2」，违反「一次摸牌最多进 1」的硬性质。
 */
export function shanten(c: Counts, melds = 0): number {
  const expected = 13 - 3 * melds;
  const total = totalOf(c);
  if (total === expected) return shantenCore(c, melds);
  if (total === expected + 1) {
    // 14 张：本身可能已成和（胡牌手牌），优先判和
    if (canWin(c, melds) !== null) return -1;
    let best = 8;
    for (let t = 0; t < TILE_KINDS; t++) {
      if (c[t] === 0) continue;
      c[t]--;
      const s = shantenCore(c, melds);
      c[t]++;
      if (s < best) best = s;
    }
    return best;
  }
  // 异常张数（少于标准）：回退到核心算法
  return shantenCore(c, melds);
}

function shantenCore(c: Counts, melds: number): number {
  let best = shantenStandard(c, melds);
  if (melds === 0) {
    const s7 = shantenSevenPairs(c);
    if (s7 < best) best = s7;
  }
  return best;
}

/** 已和牌返回 -1 */
export function isTenpai(c: Counts, melds = 0): boolean {
  return shanten(c, melds) === 0;
}
