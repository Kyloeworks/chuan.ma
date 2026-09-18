/**
 * 进张（ukeire）与出牌分析
 *
 * 这两项是教学层与 bot 决策的共同底座：
 *   - 教学层用它生成「打这张，你离听牌只差 N 张」这类提示
 *   - bot 用它做「最小向听 → 最大进张」的排序
 */

import { TILE_KINDS, COPIES, type Counts, type TileId } from './tiles.ts';
import { canWin } from './win.ts';
import { shanten } from './shanten.ts';

/** 当前听牌时能和的牌（手牌应为 13 - melds*3 张） */
export function winningTiles(c: Counts, melds = 0): TileId[] {
  const out: TileId[] = [];
  for (let t = 0; t < TILE_KINDS; t++) {
    if (c[t] >= COPIES) continue; // 已 4 张在手，不可能再摸到
    c[t]++;
    const ok = canWin(c, melds) !== null;
    c[t]--;
    if (ok) out.push(t);
  }
  return out;
}

/** 该牌在牌山中的剩余张数（visible 应含自己手牌 + 全部弃牌 + 全部副露） */
export function remainingOf(visible: Counts, t: TileId): number {
  const r = COPIES - visible[t];
  return r > 0 ? r : 0;
}

/**
 * 给定 13 张（或 13 - melds*3 张）手牌，计算进张。
 * 返回能进的牌种、各自剩余张数与总张数。
 */
export function ukeire(c: Counts, melds = 0, visible?: Counts): {
  tiles: TileId[];
  kinds: number;
  count: number;
} {
  const wins = winningTiles(c, melds);
  let count = 0;
  if (visible) {
    for (const t of wins) count += remainingOf(visible, t);
  } else {
    for (const t of wins) count += COPIES - c[t];
  }
  return { tiles: wins, kinds: wins.length, count };
}

/**
 * 能让向听前进的牌（对当前手牌 c 而言）。
 * c 应为 13 - melds*3 张。教学层用「还差 N 张、能进这些牌」。
 * 注意：与 analyzeDiscards 中的「未听牌」分支同源。
 */
export function improvingTiles(c: Counts, melds = 0): TileId[] {
  const sh = shanten(c, melds);
  const out: TileId[] = [];
  for (let d = 0; d < TILE_KINDS; d++) {
    if (c[d] >= COPIES) continue;
    c[d]++;
    const advanced = shanten(c, melds) < sh;
    c[d]--;
    if (advanced) out.push(d);
  }
  return out;
}

export type DiscardOption = {
  tile: TileId;
  shanten: number;
  ukeireTiles: TileId[];
  ukeireKinds: number;
  ukeireCount: number;
};

/**
 * 出牌分析：枚举手牌中每种可打的牌，返回打完后的向听与进张。
 * hand 应为 14 张（刚摸完待打）或 13+melds*3。
 * visible 用于扣除已见牌；不传则只按自己手牌估算。
 *
 * 调用方（bot / 教学层）据此排序：
 *   1) shanten 升序   2) ukeireCount 降序   3) 孤张优先   4) 危险度升序
 */
export function analyzeDiscards(c: Counts, melds = 0, visible?: Counts): DiscardOption[] {
  const out: DiscardOption[] = [];
  const seen = new Set<TileId>();

  for (let t = 0; t < TILE_KINDS; t++) {
    if (c[t] === 0 || seen.has(t)) continue;
    seen.add(t);

    const vis = visible ? visible.slice() : c.slice();
    vis[t]--; // 打出去的这张不再计入可见（它进了牌河，但对摸牌而言仍是「已见」，
              // 这里减掉是因为调用方传入的 visible 通常不含待打牌的重复计数差异；
              // 若调用方已正确处理，可传入 visible 的副本自行调整）

    c[t]--;
    const sh = shanten(c, melds);
    if (sh === 0) {
      // 听牌：进张 = 能和的牌
      const u = ukeire(c, melds, vis);
      out.push({
        tile: t,
        shanten: sh,
        ukeireTiles: u.tiles,
        ukeireKinds: u.kinds,
        ukeireCount: u.count,
      });
    } else {
      // 未听牌：进张 = 能让向听前进的牌
      const tiles = improvingTiles(c, melds);
      let count = 0;
      for (const d of tiles) count += visible ? remainingOf(vis, d) : COPIES - c[d];
      out.push({
        tile: t,
        shanten: sh,
        ukeireTiles: tiles,
        ukeireKinds: tiles.length,
        ukeireCount: count,
      });
    }
    c[t]++;
  }

  return out;
}

/**
 * 推荐出牌：四级排序（最小向听 → 最大进张 → 孤张优先 → 编号稳定）
 * 危险度由调用方在外层叠加，内核不引入对局状态。
 */
export function recommendDiscard(c: Counts, melds = 0, visible?: Counts): DiscardOption | null {
  const opts = analyzeDiscards(c, melds, visible);
  if (opts.length === 0) return null;

  opts.sort((a, b) => {
    if (a.shanten !== b.shanten) return a.shanten - b.shanten;
    if (a.ukeireCount !== b.ukeireCount) return b.ukeireCount - a.ukeireCount;
    if (a.ukeireKinds !== b.ukeireKinds) return b.ukeireKinds - a.ukeireKinds;
    return a.tile - b.tile;
  });
  return opts[0];
}

/** 孤张分：越大越该打。用于排序第三级（相邻张越少、越边缘，分越高） */
export function isolationScore(c: Counts, t: TileId): number {
  const rank = t % 9;
  const base = Math.floor(t / 9) * 9;
  let neighbors = 0;
  if (rank >= 2 && c[base + rank - 2] > 0) neighbors++;
  if (rank >= 1 && c[base + rank - 1] > 0) neighbors++;
  if (rank <= 8 && c[base + rank] > 0) neighbors++;
  if (rank <= 7 && c[base + rank + 1] > 0) neighbors++;

  let score = 4 - neighbors;
  if (rank === 1 || rank === 9) score += 1; // 幺九边张更容易成为死张
  return score;
}
