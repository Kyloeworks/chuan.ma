/**
 * 番种结算（血战到底）
 *
 * 川麻番数各地差异极大（清一色是 2 番还是 4 番？刮风下雨当场结还是终局结？）。
 * 这里把所有可变量的番值与杠分放进 ScoringConfig，做成「地区预设 + 自由切换」。
 * 在没人定义权威的英文世界，把规则说清楚、可切换，本身就是产品壁垒。
 *
 * 本预设口径（成都/血战到底主流，2026-09 重整）：
 *
 *   ① 主型档（互斥，取最高命中一档）
 *      清龙七对 32 · 清七对 16 · 清金钩钓 8 · 清对 8 · 龙七对 8
 *      · 十八罗汉 16 · 金钩钓 2 · 七对 4 · 大对子 2 · 平胡 1
 *      「清×」档是打包价（形态番 × 清一色），命中后不再另加平胡/清一色。
 *   ② 叠加档：清一色 +4（主型未含清时）· 带幺九 +2 · 断幺九（默认 0 = 关闭）
 *      · 根 +1/根 · 情境番（自摸/杠上花/杠上炮/抢杠胡/海底）各 +1
 *   ③ 总番超过 cap（默认 32）按封顶计。
 *
 * ⚠️ 术语说明：川麻标准番种表**不含**「断幺九」（那是国标麻将与日麻的概念，
 * 川麻对应的幺九番种是「带幺九」）。此处把断幺九做成可配番种，默认关闭，
 * 供教学对照，不改变本预设的川麻口径。
 */

import { TILE_KINDS, RANKS, type TileId, type Counts } from './tiles.ts';
import { canWinSevenPairs } from './win.ts';
import type { PlayerState, Seat, Rules, Meld } from './flow.ts';

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
  isGoldenHook: boolean;
  isEighteenArhats: boolean;
  roots: number;
  fanKeys: string[];
  /** 命中的主型档键（互斥档里最高的那一个） */
  tier: string;
}

export interface KongScoreConfig {
  exposedFromDiscarder: number; // 明杠（点杠）：点杠者给
  concealedEach: number; // 暗杠：每家给
  addedEach: number; // 补杠：每家给
}

/**
 * 番种表。
 *
 * ⚠️ 口径：**主型档的值 = 该档的最终形态番（平胡底已含在内）**，档间互斥取最高。
 * 例：大对子 = 3 = 平胡 1 + 对子增量 2；七对 = 4（替代平胡，不叠加）。
 * 叠加项（清一色 / 带幺九 / 断幺九 / 根 / 情境番）另加在档位番之上。
 */
export interface FanConfig {
  /* --- 主型档（互斥取最高，值已含平胡底） --- */
  pinghu: number; // 平胡：基础和牌型
  pengpeng: number; // 大对子（通用名「碰碰胡」）= 平胡 1 + 对子增量 2
  jingou: number; // 金钩钓：四副全副露 + 单钓将
  qidui: number; // 七对（门清 7 对）
  longqidui: number; // 龙七对：七对含 4 张相同（含根，不重复计根）
  shibaluohan: number; // 十八罗汉：四副副露全为杠（18 张全杠牌型）
  qingdui: number; // 清对：清一色 + 大对子（打包）
  qingjingou: number; // 清金钩钓：清一色 + 金钩钓（打包）
  qingqidui: number; // 清七对：清一色 + 七对（打包）
  qinglongqidui: number; // 清龙七对：清一色 + 龙七对（打包）

  /* --- 叠加项 --- */
  qingyise: number; // 清一色（主型未含清时叠加）
  daiyaojiu: number; // 带幺九：每副面子与将牌都含 1 或 9
  duanyao: number; // 断幺九：全中张（2-8）。川麻标准不认，默认 0 = 关闭
  gen: number; // 每根（4 张相同）
  zimo: number; // 自摸
  gangshanghua: number; // 杠上花
  gangshangpao: number; // 杠上炮
  qianggang: number; // 抢杠胡
  haidi: number; // 海底捞月 / 海底炮
}

export interface ScoringConfig {
  rules: Rules;
  /** 底分：最终分 = 番数 × basePoints */
  basePoints: number;
  /** 自摸时谁付分：'unwon' 只由尚未胡牌者付（血战通行）；'all' 三家都付 */
  payFrom: 'unwon' | 'all';
  /** 查花猪赔付额（未打缺者赔给每个已打缺者；0 = 关闭） */
  flowerPigPay: number;
  fan: FanConfig;
  kong: KongScoreConfig;
}

export const defaultScoring: ScoringConfig = {
  rules: {
    allowKong: true,
    allowAddedKong: true,
    checkReadyHand: true,
    checkFlowerPig: true,
    taxRefund: true,
    cap: 32,
  },
  basePoints: 1,
  payFrom: 'unwon',
  flowerPigPay: 16,
  fan: {
    // 主型档（互斥，取最高；值已含平胡底）
    pinghu: 1,
    pengpeng: 3,
    jingou: 3,
    qidui: 4,
    longqidui: 8,
    shibaluohan: 16,
    qingdui: 8,
    qingjingou: 8,
    qingqidui: 16,
    qinglongqidui: 32,
    // 叠加项
    qingyise: 4,
    daiyaojiu: 2,
    duanyao: 0,
    gen: 1,
    zimo: 1,
    gangshanghua: 1,
    gangshangpao: 1,
    qianggang: 1,
    haidi: 1,
  },
  kong: {
    exposedFromDiscarder: 2,
    concealedEach: 2,
    addedEach: 1,
  },
};

/** 胡牌上下文（杠上花/杠上炮/抢杠/海底等附加番的判断来源） */
export interface WinContext {
  selfDraw: boolean;
  by: Seat;
  tile: TileId;
  kongReplacement: boolean; // 杠上花：杠后补牌自摸
  afterKongDiscard: boolean; // 杠上炮：刚杠完被迫打出的牌被点炮
  robbingKong: boolean; // 抢杠胡：抢别人补杠的那张牌
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

/**
 * 手牌应有的张数：4 副面子 + 将，每副副露（碰/杠）已占 1 副。
 *
 * ⚠️ 历史坑：旧实现写成 `(4 - kongs) * 3 + 2`（只减**杠**数），
 * 于是任何带「碰」的牌都被判成张数不符 —— 大对子直接算不出来，
 * 只剩平胡 1 番。这正是玩家报的「大对子为什么还是一番」。
 * 碰与杠都占 1 副面子，且杠不会把额外的牌留在手里（被补牌替换掉），
 * 所以二者在这里等价：只数副露**总数**。
 */
export function meldedHandSize(melds: number): number {
  return (4 - melds) * 3 + 2;
}

/** 是否全为刻子/杠（川麻称「大对子」，通用名「碰碰胡」）：手牌可拆成全刻子 + 将 */
export function isAllTriplets(c: Counts, melds: number): boolean {
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
  return total === meldedHandSize(melds) && pairs === 1;
}

/**
 * 金钩钓：四副副露全部亮出（碰/杠），手牌只剩一对将单钓。
 * 这是川麻最常见的大牌形态之一（四副全副露 + 单钓将）。
 */
export function isGoldenHook(p: PlayerState): boolean {
  if (p.melds.length !== 4) return false;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < TILE_KINDS; i++) {
    if (p.hand[i] === 0) continue;
    total += p.hand[i];
    if (p.hand[i] === 2) pairs++;
  }
  return total === 2 && pairs === 1;
}

/**
 * 十八罗汉：4 副副露全为杠 —— 18 张的全杠牌型。
 *
 * ⚠️ 命名说明：川麻通行义的「金钩钓」是「四副全副露、手牌只剩一对将单钓」（见上），
 * 与本函数的条件（四杠）**不是同一件事**。二者键名已分开，避免教学页面教错术语。
 */
export function isEighteenArhats(p: PlayerState): boolean {
  if (p.melds.length < 4) return false;
  return p.melds.every((m) => m.type === 'kong');
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

/** 幺九牌（rank = 1 或 9） */
function isTerminal(id: TileId): boolean {
  const r = id % RANKS;
  return r === 0 || r === RANKS - 1;
}

/** 断幺九：手牌与副露全部为中张 2-8，无任何 1/9 */
export function isAllSimples(p: PlayerState): boolean {
  for (let i = 0; i < TILE_KINDS; i++) {
    if (p.hand[i] > 0 && isTerminal(i)) return false;
  }
  for (const m of p.melds) if (isTerminal(m.tile)) return false;
  return true;
}

/** 剩余牌能否全部拆成 need 副「含幺或九」的面子（只允许 123 / 789 顺子与 1、9 刻子） */
function terminalMelds(c: Counts, need: number): boolean {
  if (need === 0) {
    for (let i = 0; i < TILE_KINDS; i++) if (c[i] !== 0) return false;
    return true;
  }
  let i = 0;
  while (i < TILE_KINDS && c[i] === 0) i++;
  if (i >= TILE_KINDS) return false;

  if (c[i] >= 3 && isTerminal(i)) {
    c[i] -= 3;
    const ok = terminalMelds(c, need - 1);
    c[i] += 3;
    if (ok) return true;
  }
  const r = i % RANKS;
  if ((r === 0 || r === RANKS - 3) && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--;
    c[i + 1]--;
    c[i + 2]--;
    const ok = terminalMelds(c, need - 1);
    c[i]++;
    c[i + 1]++;
    c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** 带幺九（全带幺）：每副面子（含副露）都含 1 或 9，且将牌也是 1 或 9 */
export function isAllWithTerminals(p: PlayerState, melds: Meld[] = p.melds): boolean {
  for (const m of melds) if (!isTerminal(m.tile)) return false;
  const need = 4 - melds.length;
  if (need < 0) return false;
  const h = p.hand.slice() as Counts;
  for (let i = 0; i < TILE_KINDS; i++) {
    if (!isTerminal(i) || h[i] < 2) continue;
    h[i] -= 2;
    const ok = terminalMelds(h, need);
    h[i] += 2;
    if (ok) return true;
  }
  return false;
}

/* ---------------- 主结算 ---------------- */

export function scoringFor(g: GameStateLike, p: PlayerState, ctx: WinContext): FanResult {
  const cfg = g.config;
  const items: FanItem[] = [];
  const add = (key: string, name: string, fans: number) => {
    if (fans > 0) items.push({ key, name, fans });
  };

  const meldCount = p.melds.length;
  const seven = canWinSevenPairs(p.hand, meldCount) && meldCount === 0;
  const flush = isFlush(p);
  const roots = countRoots(p);
  const triplets = !seven && isAllTriplets(p.hand, meldCount);
  const goldenHook = !seven && isGoldenHook(p);
  const arhats = !seven && isEighteenArhats(p);
  const dragonSeven = seven && p.hand.some((n) => n === 4);

  /* ---- 主型档：互斥，取最高命中一档 ---- */
  let key: string;
  let name: string;
  let fans: number;
  if (seven && dragonSeven && flush) {
    key = 'qinglongqidui'; name = '清龙七对'; fans = cfg.fan.qinglongqidui;
  } else if (seven && flush) {
    key = 'qingqidui'; name = '清七对'; fans = cfg.fan.qingqidui;
  } else if (seven && dragonSeven) {
    key = 'longqidui'; name = '龙七对'; fans = cfg.fan.longqidui;
  } else if (seven) {
    key = 'qidui'; name = '七对'; fans = cfg.fan.qidui;
  } else if (arhats && flush) {
    key = 'qingshibaluohan'; name = '清十八罗汉'; fans = cfg.fan.shibaluohan + cfg.fan.qingyise;
  } else if (arhats) {
    key = 'shibaluohan'; name = '十八罗汉'; fans = cfg.fan.shibaluohan;
  } else if (goldenHook && flush) {
    key = 'qingjingou'; name = '清金钩钓'; fans = cfg.fan.qingjingou;
  } else if (goldenHook) {
    key = 'jingou'; name = '金钩钓'; fans = cfg.fan.jingou;
  } else if (triplets && flush) {
    key = 'qingdui'; name = '清对'; fans = cfg.fan.qingdui;
  } else if (triplets) {
    key = 'pengpeng'; name = '大对子'; fans = cfg.fan.pengpeng;
  } else {
    key = 'pinghu'; name = '平胡'; fans = cfg.fan.pinghu;
  }
  add(key, name, fans);

  /* ---- 清一色：主型若是「清×」打包档则已含，不再叠加 ---- */
  if (flush && !key.startsWith('qing')) add('qingyise', '清一色', cfg.fan.qingyise);

  /* ---- 幺九类（七对型不适用） ---- */
  if (!seven) {
    if (isAllWithTerminals(p, p.melds)) add('daiyaojiu', '带幺九', cfg.fan.daiyaojiu);
    else if (isAllSimples(p)) add('duanyao', '断幺九', cfg.fan.duanyao);
  }

  /* ---- 根：七对型的 4 张已在龙七对里体现，不重复计 ---- */
  if (roots > 0 && !seven) add('gen', `根×${roots}`, cfg.fan.gen * roots);

  /* ---- 情境番 ---- */
  if (ctx.selfDraw) add('zimo', '自摸', cfg.fan.zimo);
  if (ctx.kongReplacement && ctx.selfDraw) add('gangshanghua', '杠上花', cfg.fan.gangshanghua);
  if (ctx.afterKongDiscard && !ctx.selfDraw) add('gangshangpao', '杠上炮', cfg.fan.gangshangpao);
  if (ctx.robbingKong && !ctx.selfDraw) add('qianggang', '抢杠胡', cfg.fan.qianggang);
  if (ctx.lastTile) add('haidi', '海底', cfg.fan.haidi);

  let total = items.reduce((s, it) => s + it.fans, 0);
  const cap = cfg.rules.cap;
  if (cap > 0 && total > cap) total = cap;

  return {
    items,
    total,
    isFlush: flush,
    isSevenPairs: seven,
    isAllTriplets: triplets,
    isGoldenHook: goldenHook,
    isEighteenArhats: arhats,
    roots,
    fanKeys: items.map((i) => i.key),
    tier: key,
  };
}

/** 仅类型占位，避免循环依赖（实际由 flow 传入完整 GameState） */
export interface GameStateLike {
  config: ScoringConfig;
}
