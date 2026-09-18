/**
 * 启发式 bot 与整局模拟
 *
 * bot 只用内核既有的「向听 + 进张 + 孤张分」做决策，对应 MVP 蓝图里
 * 的「算法即教案」：四级排序（最小向听 → 最大进张 → 孤张优先 → 编号稳定）
 * 每一步依据都能翻译成一句人话，不需要任何 AI / 黑盒。
 *
 * simulateGame 用于：无头跑完整局，验证流程引擎不崩、结算自洽。
 */

import {
  TILE_KINDS,
  RANKS,
  SUITS,
  type TileId,
  suitCount,
  cloneCounts,
} from './tiles.ts';
import { shanten } from './shanten.ts';
import { analyzeDiscards, isolationScore } from './ukeire.ts';
import { defaultScoring } from './scoring.ts';
import {
  SEATS,
  type Seat,
  type GameState,
  type PlayerState,
  defaultRules,
  createGame,
  canSelfWin,
  holdsMissingSuit,
  isGameOver,
  settleRound,
  declareMissing,
  draw,
  discard,
  applyPong,
  applyKong,
  applyConcealedKong,
  applyAddedKong,
  applySelfWin,
  applyRon,
  passClaim,
} from './flow.ts';

/** bot 定缺：选手牌张数最少的花色（最易打缺） */
export function botMissingSuit(g: GameState, seat: Seat): number {
  const p = g.players[seat];
  let best = 0;
  let bestN = Infinity;
  for (let s = 0; s < SUITS; s++) {
    const n = suitCount(p.hand, s);
    if (n < bestN) {
      bestN = n;
      best = s;
    }
  }
  return best;
}

/* ---------------- 难度分级 ----------------
 * 用同一套「向听 + 进张」材料，按档位**少用或多用信息**，而不是做黑箱。
 * easy  : 只看向听数（并列随机）→ 打得出牌，但完全不懂进张效率
 * normal: 四级排序（最小向听 → 最大进张 → 孤张优先 → 编号稳定）
 * hard  : normal + 花色集中度（朝清一色/大对子等高分型收拢）
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

/** 打出 tile 后，剩余手牌的花色集中度（HHI，越大越集中 → 越可能清一色） */
function suitConcentration(c: Counts, tile: TileId): number {
  const n = [0, 0, 0];
  for (let i = 0; i < TILE_KINDS; i++) {
    const v = i === tile ? c[i] - 1 : c[i];
    if (v > 0) n[Math.floor(i / RANKS)] += v;
  }
  const tot = n[0] + n[1] + n[2];
  if (tot === 0) return 0;
  // 平方和归一化：单色最集中 = 1
  return (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) / (tot * tot);
}

/** bot 选弃牌 */
export function botDiscardTile(
  g: GameState, seat: Seat, diff: Difficulty = 'normal', rng: () => number = Math.random,
): TileId {
  const p = g.players[seat];
  // 持有缺门牌：必须先打缺门（三档一致，这是硬约束）
  if (holdsMissingSuit(p)) {
    let bestT = -1;
    let bestScore = -1;
    for (let t = 0; t < TILE_KINDS; t++) {
      if (p.hand[t] > 0 && Math.floor(t / RANKS) === p.missing) {
        const sc = isolationScore(p.hand, t);
        if (sc > bestScore) {
          bestScore = sc;
          bestT = t;
        }
      }
    }
    if (bestT >= 0) return bestT;
  }

  const opts = analyzeDiscards(p.hand, p.melds.length).filter((o) => p.hand[o.tile] > 0);
  if (opts.length === 0) {
    // 兜底：打第一张手牌
    for (let t = 0; t < TILE_KINDS; t++) if (p.hand[t] > 0) return t;
    throw new Error('empty hand');
  }

  if (diff === 'easy') {
    // 只看向听数：并列里随便挑一张（新手感）
    let minSh = Infinity;
    for (const o of opts) if (o.shanten < minSh) minSh = o.shanten;
    const cands = opts.filter((o) => o.shanten === minSh);
    return cands[Math.floor(rng() * cands.length)].tile;
  }

  opts.sort((a, b) => {
    if (a.shanten !== b.shanten) return a.shanten - b.shanten;
    if (a.ukeireCount !== b.ukeireCount) return b.ukeireCount - a.ukeireCount;
    if (diff === 'hard') {
      // 同向听同进张时，优先打掉「离主色更远」的牌 → 收拢清一色
      const ca = suitConcentration(p.hand, a.tile);
      const cb = suitConcentration(p.hand, b.tile);
      if (ca !== cb) return cb - ca;
    }
    const ia = isolationScore(p.hand, a.tile);
    const ib = isolationScore(p.hand, b.tile);
    if (ia !== ib) return ib - ia;
    return a.tile - b.tile;
  });
  return opts[0].tile;
}

/** bot 暗杠候选（手牌 4 张且非缺门）。easy 不会用杠，等于白送一路进攻手段 */
export function botConcealedKongTile(g: GameState, seat: Seat, diff: Difficulty = 'normal'): TileId {
  if (diff === 'easy') return -1;
  const p = g.players[seat];
  for (let t = 0; t < TILE_KINDS; t++) {
    if (p.hand[t] === 4 && (p.missing < 0 || Math.floor(t / RANKS) !== p.missing)) return t;
  }
  return -1;
}

/** bot 补杠候选（已有碰，手里有第 4 张） */
export function botAddedKongTile(g: GameState, seat: Seat, diff: Difficulty = 'normal'): TileId {
  if (diff === 'easy') return -1;
  const p = g.players[seat];
  for (const m of p.melds) {
    if (m.type === 'pong' && p.hand[m.tile] >= 1) {
      if (p.missing < 0 || Math.floor(m.tile / RANKS) !== p.missing) return m.tile;
    }
  }
  return -1;
}

/** bot 是否应该碰：碰后向听不升（easy 要求必须严格下降，故更保守） */
export function botShouldPong(g: GameState, seat: Seat, diff: Difficulty = 'normal'): boolean {
  const p = g.players[seat];
  const c = g.claim;
  if (!c) return false;
  const before = shanten(p.hand, p.melds.length);
  const tmp = cloneCounts(p.hand);
  tmp[c.tile] -= 2;
  const after = shanten(tmp, p.melds.length + 1);
  return diff === 'easy' ? after < before : after <= before;
}

/* ---------------- 整局模拟 ---------------- */

export interface SimResult {
  steps: number;
  finished: boolean;
  winners: number;
  maxFan: number;
  historyLen: number;
  reason: 'threeWins' | 'wallEmpty' | 'stepCap';
  scoreBySeat: number[];
  netBySeat: number[];
}

export interface SimOptions {
  seed?: number;
  /** 逐座位难度；省略则该座位用 normal */
  diffs?: Difficulty[];
}

/**
 * 全 bot 无头跑一整局。humanSeat 传 0（仅影响 isHuman 标记，不影响逻辑）。
 * 支持逐座位难度，用于实测难度档位强度。
 */
export function simulateGameOpts(opts: SimOptions = {}): { state: GameState; result: SimResult } {
  const seed = opts.seed;
  // 洗牌 RNG 与「策略 RNG」必须分开：否则策略里的一次随机（easy 档并列随机 / 杠的取舍）
  // 会推进洗牌流，导致各难度档位拿到的牌不同 —— 配对比较直接失效。
  const dealRng = seed !== undefined ? makeRngLocal(seed) : Math.random;
  const polRng = seed !== undefined ? makeRngLocal((seed ^ 0x9e3779b9) >>> 0) : Math.random;
  const diffs = opts.diffs ?? [];
  const dOf = (s: number): Difficulty => diffs[s] ?? 'normal';
  const g = createGame(0, defaultRules, defaultScoring, dealRng);
  let steps = 0;
  const MAX = 8000;
  let reason: SimResult['reason'] = 'stepCap';

  while (g.phase !== 'finished' && steps < MAX) {
    steps++;
    if (g.phase === 'declareMissing') {
      for (const s of SEATS) if (g.players[s].missing === -1) declareMissing(g, s, botMissingSuit(g, s));
      continue;
    }
    if (g.claim) {
      const c = g.claim;
      if (c.ron.length > 0) {
        applyRon(g, c.ron[0]); // 一炮多响简化为取首位（模拟用）
      } else if (c.kong.length > 0 && dOf(c.kong[0]) !== 'easy') {
        applyKong(g, c.kong[0]);
      } else if (c.pong.length > 0 && botShouldPong(g, c.pong[0], dOf(c.pong[0]))) {
        applyPong(g, c.pong[0]);
      } else {
        passClaim(g);
      }
      continue;
    }
    const seat = g.turn;
    const p = g.players[seat];
    if (g.pendingDraw) {
      if (!draw(g, seat)) {
        const three = g.winCount >= 3;
        settleRound(g);
        reason = three ? 'threeWins' : 'wallEmpty';
        break;
      }
    }
    if (canSelfWin(p, p.melds.length)) {
      applySelfWin(g, seat);
      if (isGameOver(g)) {
        settleRound(g);
        reason = 'threeWins';
        break;
      }
      continue;
    }
    const ck = botConcealedKongTile(g, seat, dOf(seat));
    if (ck >= 0 && polRng() < 0.5) {
      applyConcealedKong(g, seat, ck);
      continue;
    }
    const ak = botAddedKongTile(g, seat, dOf(seat));
    if (ak >= 0 && polRng() < 0.5) {
      applyAddedKong(g, seat, ak);
      continue;
    }
    discard(g, seat, botDiscardTile(g, seat, dOf(seat), polRng));
  }

  if (g.phase !== 'finished') settleRound(g);

  const maxFan = Math.max(0, ...g.players.map((p) => p.winInfo?.fans.total ?? 0));
  const scoreBySeat = g.players.map((p) => p.winInfo?.score ?? 0);
  const netBySeat = g.settlement ? g.settlement.seats.map((x) => x.net) : [0, 0, 0, 0];
  return {
    state: g,
    result: {
      steps,
      finished: g.phase === 'finished',
      winners: g.winCount,
      maxFan,
      historyLen: g.history.length,
      reason,
      scoreBySeat,
      netBySeat,
    },
  };
}

/** 兼容旧签名：全桌同一难度 */
export function simulateGame(seed?: number, diff: Difficulty = 'normal'): { state: GameState; result: SimResult } {
  return simulateGameOpts({ seed, diffs: [diff, diff, diff, diff] });
}

/** 本地 mulberry32（与 tiles.makeRng 同源，避免重复 import） */
function makeRngLocal(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
