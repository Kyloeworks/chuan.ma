/**
 * 番种结算（血战到底）
 *
 * 川麻番数各地差异极大（清一色是 2 番还是 4 番？刮风下雨当场结还是终局结？）。
 * 这里把所有可变量的番值与杠分放进 ScoringConfig，做成「地区预设 + 自由切换」。
 * 在没人定义权威的英文世界，把规则说清楚、可切换，本身就是产品壁垒。
 */

import { TILE_KINDS, type TileId, type Counts } from './tiles.ts';
import { canWinSevenPairs } from './win.ts';
import type { PlayerState, Seat, Rules } from './flow.ts';

export interface FanItem {
  key: string;
  name: string;
  fans: number;
}

export interface FanResult {
  items: FanItem[];
  total: number;
  isFlush: boolean;
  isSevenPairs: boolean;
  isAllTriplets: boolean;
  roots: number;
  fanKeys: string[];
}

export interface KongScoreConfig {
  exposedFromDiscarder: number; // 明杠（点杠）：点杠者给
  concealedEach: number; // 暗杠：每家给
  addedEach: number; // 补杠：每家给
}

export interface ScoringConfig {
  rules: Rules;
  /** 底分：最终分 = 番数 × basePoints */
  basePoints: number;
  /** 自摸时谁付分：'unwon' 只由尚未胡牌者付（血战通行）；'all' 三家都付 */
  payFrom: 'unwon' | 'all';
  /** 查花猪赔付额（未打缺者赔给每个已打缺者；0 = 关闭） */
  flowerPigPay: number;
  fan: {
    pinghu: number; // 平胡基础番
    pengpeng: number; // 大对子（全刻子；通用名「碰碰胡」。键名沿用历史拼写）
    qingyise: number; // 清一色
    qidui: number; // 七对基础番
    longqidui: number; // 龙七对额外
    gen: number; // 每根（4 张相同）
    zimo: number; // 自摸
    gangshanghua: number; // 杠上花
    gangshangpao: number; // 杠上炮
    haidi: number; // 海底捞月 / 海底炮
    jingoudiao: number; // 十八罗汉（4 副副露全为杠；键名沿用历史拼写）
  };
  kong: KongScoreConfig;
}

export const defaultScoring: ScoringConfig = {
  rules: {
    allowKong: true,
    allowAddedKong: true,
    checkReadyHand: true,
    checkFlowerPig: true,
    taxRefund: true,
    cap: 0,
  },
  basePoints: 1,
  payFrom: 'unwon',
  flowerPigPay: 16,
  fan: {
    pinghu: 1,
    pengpeng: 2,
    qingyise: 4,
    qidui: 2,
    longqidui: 2,
    gen: 1,
    zimo: 1,
    gangshanghua: 1,
    gangshangpao: 1,
    haidi: 1,
    jingoudiao: 2,
  },
  kong: {
    exposedFromDiscarder: 2,
    concealedEach: 2,
    addedEach: 1,
  },
};

/** 胡牌上下文（杠上花/杠上炮/海底等附加番的判断来源） */
export interface WinContext {
  selfDraw: boolean;
  by: Seat;
  tile: TileId;
  kongReplacement: boolean; // 杠上花：杠后补牌自摸
  afterKongDiscard: boolean; // 杠上炮：刚杠完被迫打出的牌被点炮
  lastTile: boolean; // 海底捞月 / 海底炮
}

/* ---------------- 形态判定 ---------------- */

/** 副露 + 手牌里出现的所有花色 */
function gatherSuits(p: PlayerState): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < TILE_KINDS; i++) {
    if (p.hand[i] > 0) s.add(Math.floor(i / 9));
  }
  for (const m of p.melds) s.add(Math.floor(m.tile / 9));
  return s;
}

/** 是否清一色（仅一门花色） */
export function isFlush(p: PlayerState): boolean {
  return gatherSuits(p).size === 1;
}

/** 是否全为刻子/杠（川麻称「大对子」，通用名「碰碰胡」）：副露全是杠/碰，且手牌可拆成全刻子 + 将 */
export function isAllTriplets(c: Counts, kongs: number): boolean {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < TILE_KINDS; i++) {
    const n = c[i];
    total += n;
    if (n === 0) continue;
    if (n % 3 === 2 && pairs === 0) {
      pairs++;
      continue;
    }
    if (n % 3 !== 0) return false;
  }
  // 手牌张数应为 (4 - kongs) * 3 + 2
  return total === (4 - kongs) * 3 + 2 && pairs === 1;
}

/** 根数：某张牌总数达到 4 张（含暗杠/补杠贡献） */
export function countRoots(p: PlayerState): number {
  const cnt: Counts = p.hand.slice() as Counts;
  for (const m of p.melds) {
    if (m.type === 'kong') cnt[m.tile] += 4;
    else cnt[m.tile] += 3;
  }
  let roots = 0;
  for (let i = 0; i < TILE_KINDS; i++) if (cnt[i] >= 4) roots++;
  return roots;
}

/**
 * 十八罗汉（通用旧名「金钩钓」，键名沿用）：4 副副露全为杠 —— 18 张的全杠牌型。
 *
 * ⚠️ 命名说明：川麻通行义的「金钩钓」是「四副全副露、手牌只剩一对将单钓」，
 * 与本函数的条件（四杠）**不是同一件事**。这里按实际条件如实命名为「十八罗汉」，
 * 避免在教学页面教错术语。
 */
export function isJinGouDiao(p: PlayerState): boolean {
  if (p.melds.length < 4) return false;
  return p.melds.every((m) => m.type === 'kong');
}

/* ---------------- 主结算 ---------------- */

export function scoringFor(g: GameStateLike, p: PlayerState, ctx: WinContext): FanResult {
  const cfg = g.config;
  const items: FanItem[] = [];
  const add = (key: string, name: string, fans: number) => {
    if (fans > 0) items.push({ key, name, fans });
  };

  const kongs = p.melds.filter((m) => m.type === 'kong').length;
  const seven = canWinSevenPairs(p.hand, p.melds.length) && p.melds.length === 0;
  const flush = isFlush(p);
  const roots = countRoots(p);
  const allTriplets = !seven && isAllTriplets(p.hand, kongs);

  if (seven) {
    add('qidui', '七对', cfg.fan.qidui);
    // 龙七对：含 4 张相同
    const hasQuad = p.hand.some((n) => n === 4);
    if (hasQuad) add('longqidui', '龙七对', cfg.fan.longqidui);
    if (flush) add('qingyise', '清一色', cfg.fan.qingyise);
    if (flush && hasQuad) add('qingqidui', '清龙七对', 0); // 已含清一色
  } else {
    add('pinghu', '平胡', cfg.fan.pinghu);
    if (allTriplets) add('pengpeng', '大对子', cfg.fan.pengpeng);
    if (flush) add('qingyise', '清一色', cfg.fan.qingyise);
    if (isJinGouDiao(p)) add('jingoudiao', '十八罗汉', cfg.fan.jingoudiao);
  }

  if (roots > 0) add('gen', `根×${roots}`, cfg.fan.gen * roots);
  if (ctx.selfDraw) add('zimo', '自摸', cfg.fan.zimo);
  if (ctx.kongReplacement && ctx.selfDraw) add('gangshanghua', '杠上花', cfg.fan.gangshanghua);
  if (ctx.afterKongDiscard && !ctx.selfDraw) add('gangshangpao', '杠上炮', cfg.fan.gangshangpao);
  if (ctx.lastTile) add('haidi', '海底', cfg.fan.haidi);

  let total = items.reduce((s, it) => s + it.fans, 0);
  const cap = cfg.rules.cap;
  if (cap > 0 && total > cap) total = cap;

  return {
    items,
    total,
    isFlush: flush,
    isSevenPairs: seven,
    isAllTriplets: allTriplets,
    roots,
    fanKeys: items.map((i) => i.key),
  };
}

/** 仅类型占位，避免循环依赖（实际由 flow 传入完整 GameState） */
export interface GameStateLike {
  config: ScoringConfig;
}
