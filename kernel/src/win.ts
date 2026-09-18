/**
 * 胡牌判定
 *
 * 川麻（血战到底）两种和牌型：
 *   1. standard   —— 4 副面子 + 1 对将（面子 = 顺子或刻子）
 *   2. sevenPairs —— 暗七对，门清，7 个对子
 *
 * 注意：川麻胡牌还有「必须缺一门」的硬约束，但那是流程层规则
 * （由 forbiddenSuit 决定），判定层保持纯净 —— 缺门校验放在 rules 层。
 */

import { TILE_KINDS, RANKS, type Counts, type TileId } from './tiles.ts';

export type WinKind = 'standard' | 'sevenPairs' | null;

/** 剩余牌能否全部拆成 need 副面子 */
function allMelds(c: Counts, need: number): boolean {
  if (need === 0) {
    for (let i = 0; i < TILE_KINDS; i++) if (c[i] !== 0) return false;
    return true;
  }

  let i = 0;
  while (i < TILE_KINDS && c[i] === 0) i++;
  if (i >= TILE_KINDS) return false;

  // 刻子
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = allMelds(c, need - 1);
    c[i] += 3;
    if (ok) return true;
  }

  // 顺子（不能跨花色：i % 9 <= 6 保证 i, i+1, i+2 同门且 <= 9）
  if (i % RANKS <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--;
    c[i + 1]--;
    c[i + 2]--;
    const ok = allMelds(c, need - 1);
    c[i]++;
    c[i + 1]++;
    c[i + 2]++;
    if (ok) return true;
  }

  return false;
}

/**
 * 标准型和牌：melds 为已副露面子数（碰/杠都算 1 副）
 * 手牌张数必须恰好 = (4 - melds) * 3 + 2
 */
export function canWinStandard(c: Counts, melds = 0): boolean {
  const need = 4 - melds;
  if (need < 0) return false;

  let total = 0;
  for (let i = 0; i < TILE_KINDS; i++) total += c[i];
  if (total !== need * 3 + 2) return false;

  for (let i = 0; i < TILE_KINDS; i++) {
    if (c[i] >= 2) {
      c[i] -= 2;
      const ok = allMelds(c, need);
      c[i] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/**
 * 暗七对：7 个对子，门清（melds 必须为 0）。
 * 川麻允许「龙七对」—— 同一张牌 4 张算 2 对，这在番种层另行加番。
 */
export function canWinSevenPairs(c: Counts, melds = 0): boolean {
  if (melds > 0) return false;

  let total = 0;
  for (let i = 0; i < TILE_KINDS; i++) total += c[i];
  if (total !== 14) return false;

  let pairs = 0;
  for (let i = 0; i < TILE_KINDS; i++) {
    const n = c[i];
    if (n === 0) continue;
    if (n === 2) pairs += 1;
    else if (n === 4) pairs += 2; // 龙七对
    else return false;
  }
  return pairs === 7;
}

/** 综合判定，返回和牌型；不和返回 null */
export function canWin(c: Counts, melds = 0): WinKind {
  if (canWinStandard(c, melds)) return 'standard';
  if (canWinSevenPairs(c, melds)) return 'sevenPairs';
  return null;
}

/** 和牌时返回所有可能的将牌（用于番种/教学提示） */
export function findPairs(c: Counts): TileId[] {
  const out: TileId[] = [];
  for (let i = 0; i < TILE_KINDS; i++) {
    if (c[i] >= 2) out.push(i);
  }
  return out;
}
