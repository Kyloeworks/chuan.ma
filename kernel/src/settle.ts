/**
 * 分数结算（血战到底）——从「番种」走到「谁给谁多少分」
 *
 * 上一版只算番数，不算分：`settleRound` 里的查大叫/查花猪/退税都是空实现，
 * 结果「赢了也没感觉」。这一层把整局的资金流做成可审计的流水（PayEntry），
 * 每条都能翻译成一句人话，便于教学与复盘。
 *
 * 设计要点
 * - 结算 = 4 类流水之和：胡牌分 / 杠分 / 流局赔付（查大叫·查花猪）/ 退税
 * - 杠分**实时**记账（每次杠立刻 push 到 g.kongEntries），终局只做汇总与退税
 * - 所有可变量进 ScoringConfig（各地差异极大），不写死
 * - 本模块**不运行时依赖 flow.ts**（只用 type import），避免循环依赖
 */

import { TILE_KINDS, RANKS, type TileId, type Counts, suitCount, tileLabel, totalOf } from './tiles.ts';
import { winningTiles } from './ukeire.ts';
import { shanten } from './shanten.ts';
import { scoringFor, type WinContext } from './scoring.ts';
import type { GameState, PlayerState, Seat } from './flow.ts';

export type PayKind = 'fan' | 'kong' | 'ready' | 'flowerPig' | 'refund';

/** 一笔分：from 付给 to 多少 */
export interface PayEntry {
  kind: PayKind;
  from: Seat;
  to: Seat;
  amount: number;
  note: string;
}

/** 单家结算明细（分项便于 UI 分组显示与双语标签） */
export interface SeatSettlement {
  seat: Seat;
  won: boolean;
  fans: number; // 番数
  fanPoints: number; // 胡牌收分
  kongIn: number; // 杠分收入
  kongOut: number; // 杠分支出
  readyIn: number; // 查大叫收
  readyOut: number; // 查大叫赔
  flowerPigIn: number; // 查花猪收
  flowerPigOut: number; // 查花猪赔
  refundIn: number; // 退税收回
  refundOut: number; // 退税退给
  net: number; // 净分（唯一排名依据）
  isReady: boolean;
  isFlowerPig: boolean;
}

export interface RoundSettlement {
  reason: 'threeWins' | 'wallEmpty';
  entries: PayEntry[];
  seats: SeatSettlement[];
}

/* ---------------- 基础工具 ---------------- */

function blankSeat(seat: Seat): SeatSettlement {
  return {
    seat, won: false, fans: 0, fanPoints: 0,
    kongIn: 0, kongOut: 0, readyIn: 0, readyOut: 0,
    flowerPigIn: 0, flowerPigOut: 0, refundIn: 0, refundOut: 0, net: 0,
    isReady: false, isFlowerPig: false,
  };
}

/** 番 → 分：分 = 番数 × 底分（底分可配，默认 1） */
export function fanToPoints(fan: number, basePoints: number): number {
  return Math.max(0, Math.round(fan * basePoints));
}

/** 已打缺（不再持有缺门牌） */
export function hasClearedMissing(p: PlayerState): boolean {
  if (p.missing < 0) return true;
  return suitCount(p.hand, p.missing) === 0;
}

/** 花猪：未打缺（手上仍有缺门牌） */
export function isFlowerPig(p: PlayerState): boolean {
  return p.missing >= 0 && suitCount(p.hand, p.missing) > 0;
}

/**
 * 听牌（下叫）判定 —— **张数归一化**版本，查叫与 UI 显示共用这一个。
 *
 * 为什么必须归一化：手牌有两种合法形态 ——
 *   ① 标准张数 13 - 3*melds（回合之间的静止态）
 *   ② 多一张 14 - 3*melds（刚摸完牌、尚未打出的瞬间；流局恰好落在这一刻时就是它）
 * 旧实现直接对 `hand + 1` 调 `canWin`，只要手牌是 14 张就恒为「不成和」（14+1≠14），
 * 于是**任何以 14 张进入终局的家都会被判未下叫**。改为用向听数判定后两种形态都正确。
 */
export function isReadyCounts(hand: Counts, melds = 0): boolean {
  const expected = 13 - 3 * melds;
  const total = totalOf(hand);
  if (total === expected) return shanten(hand, melds) === 0;
  // 多一张：打掉某张后能听即可；本身已成和（向听 -1）同样算下叫
  return shanten(hand, melds) <= 0;
}

/** 听牌（已打缺 且 手牌形态可和） */
export function isReadyHand(p: PlayerState): boolean {
  if (!hasClearedMissing(p)) return false;
  return isReadyCounts(p.hand, p.melds.length);
}

/** 该听牌手牌中，某张和牌能拿到的番数 */
function fanOfWinTile(p: PlayerState, tile: TileId, g: GameState): number {
  if (p.hand[tile] >= 4) return 0;
  p.hand[tile]++;
  const ctx: WinContext = {
    selfDraw: true,
    by: -1,
    tile,
    kongReplacement: false,
    afterKongDiscard: false,
    robbingKong: false,
    lastTile: false,
  };
  const r = scoringFor(g, p, ctx);
  p.hand[tile]--;
  return r.total;
}

/**
 * 「大叫」番数：听牌手牌里，所有可和牌中能拿到的**最大番数**。
 * 查大叫按这个值赔——这是川麻通行做法（听得好的人赔得多）。
 */
export function bigCallFan(g: GameState, p: PlayerState): number {
  if (!hasClearedMissing(p)) return 0;
  const tiles = winningTiles(p.hand, p.melds.length);
  let best = 0;
  for (const t of tiles) {
    if (p.missing >= 0 && Math.floor(t / RANKS) === p.missing) continue;
    const f = fanOfWinTile(p, t, g);
    if (f > best) best = f;
  }
  return best;
}

/* ---------------- 杠分记账（实时调用） ---------------- */

/**
 * 记一次杠分。三种杠的付法不同（各地有差异，全部可配）：
 * - 暗杠：每家各付 concealedEach
 * - 补杠：每家各付 addedEach
 * - 直杠（明杠）：放杠者单独付 exposedFromDiscarder
 * 返回本次产生的流水。
 */
export function recordKong(
  g: GameState, seat: Seat, kind: 'concealed' | 'added' | 'exposed', tile: TileId, fromSeat = -1,
): PayEntry[] {
  const cfg = g.config;
  const k = cfg.kong;
  const out: PayEntry[] = [];
  const label = kind === 'concealed' ? '暗杠' : kind === 'added' ? '补杠' : '直杠';
  const tileName = tileLabel(tile);
  if (kind === 'exposed') {
    if (fromSeat >= 0 && fromSeat !== seat && k.exposedFromDiscarder > 0) {
      out.push({
        kind: 'kong', from: fromSeat, to: seat, amount: k.exposedFromDiscarder,
        note: `${label} ${tileName}：放杠者付 ${k.exposedFromDiscarder}`,
      });
    }
  } else {
    const each = kind === 'concealed' ? k.concealedEach : k.addedEach;
    if (each > 0) {
      for (const s of [0, 1, 2, 3] as Seat[]) {
        if (s === seat) continue;
        out.push({
          kind: 'kong', from: s, to: seat, amount: each,
          note: `${label} ${tileName}：每家付 ${each}`,
        });
      }
    }
  }
  for (const e of out) g.kongEntries.push(e);
  g.kongScores[seat] += out.reduce((s, e) => s + e.amount, 0);
  return out;
}

/* ---------------- 终局结算 ---------------- */

function emptySeats(): SeatSettlement[] {
  return [blankSeat(0), blankSeat(1), blankSeat(2), blankSeat(3)];
}

/**
 * 计算整局结算。**纯计算**，不改游戏状态（flow.settleRound 负责标记 phase）。
 * 顺序：胡牌分 → 流局赔付（花猪 / 大叫）→ 退税 → 汇总净分。
 */
export function settleRoundImpl(g: GameState): RoundSettlement {
  const cfg = g.config;
  const base = cfg.basePoints;
  const seats = emptySeats();
  const entries: PayEntry[] = [];
  const reason: RoundSettlement['reason'] = g.winCount >= 3 ? 'threeWins' : 'wallEmpty';
  const unwon = [0, 1, 2, 3].filter((s) => !g.players[s].won) as Seat[];

  // ① 杠分（流水已在 recordKong 实时写入，这里只汇总）
  for (const e of g.kongEntries) {
    entries.push(e);
    seats[e.to].kongIn += e.amount;
    seats[e.from].kongOut += e.amount;
  }

  // ② 胡牌分：自摸由付款方集合分摊，点炮由放炮者独付
  for (const s of [0, 1, 2, 3] as Seat[]) {
    const p = g.players[s];
    if (!p.won || !p.winInfo) continue;
    const st = seats[s];
    st.won = true;
    st.fans = p.winInfo.fans.total;
    const pts = fanToPoints(p.winInfo.fans.total, base);
    const payers = p.winInfo.selfDraw
      ? (cfg.payFrom === 'all' ? ([0, 1, 2, 3].filter((x) => x !== s) as Seat[]) : unwon.filter((x) => x !== s))
      : [p.winInfo.by];
    let collected = 0;
    for (const payer of payers) {
      if (payer === undefined || payer < 0 || payer === s) continue;
      collected += pts;
      entries.push({
        kind: 'fan', from: payer, to: s, amount: pts,
        note: p.winInfo.selfDraw
          ? `自摸 ${st.fans} 番：付 ${pts}`
          : `点炮 ${st.fans} 番：放炮者付 ${pts}`,
      });
    }
    // 回写到 winInfo（该玩家从胡牌中实收的分）
    p.winInfo.score = collected;
  }

  // ③ 流局赔付：查花猪 → 查大叫（均为「流局」时）
  if (reason === 'wallEmpty') {
    const alive = unwon;
    for (const s of alive) seats[s].isFlowerPig = isFlowerPig(g.players[s]);
    for (const s of alive) seats[s].isReady = !seats[s].isFlowerPig && isReadyHand(g.players[s]);
    const pigs = alive.filter((s) => seats[s].isFlowerPig);
    const clean = alive.filter((s) => !seats[s].isFlowerPig);

    // 花猪：赔给每个已打缺的玩家（固定额，可配；0 = 关闭）
    if (cfg.rules.checkFlowerPig && cfg.flowerPigPay > 0) {
      for (const f of pigs) {
        for (const c of clean) {
          entries.push({
            kind: 'flowerPig', from: f, to: c, amount: cfg.flowerPigPay,
            note: `花猪未打缺：赔 ${cfg.flowerPigPay}`,
          });
        }
      }
    }
    // 查大叫：未听牌者赔给每个听牌者（按听牌者的最大番数 = 大叫）
    if (cfg.rules.checkReadyHand) {
      const ready = clean.filter((s) => seats[s].isReady);
      const notReady = clean.filter((s) => !seats[s].isReady);
      for (const r of ready) {
        const fan = Math.max(1, bigCallFan(g, g.players[r]));
        const pts = fanToPoints(fan, base);
        for (const n of notReady) {
          entries.push({
            kind: 'ready', from: n, to: r, amount: pts,
            note: `未下叫赔下叫 ${fan} 番 = ${pts}`,
          });
        }
      }
    }
  }

  // ④ 退税：未胡者收到的杠分，全部退还给原付款方
  if (cfg.rules.taxRefund) {
    for (const e of g.kongEntries) {
      if (g.players[e.to].won) continue;
      entries.push({
        kind: 'refund', from: e.to, to: e.from, amount: e.amount,
        note: `未胡退税 ${e.amount}`,
      });
    }
  }

  // ⑤ 汇总（净分守恒：所有家之和必须为 0）
  for (const e of entries) {
    const a = seats[e.to], b = seats[e.from];
    a.net += e.amount;
    b.net -= e.amount;
    switch (e.kind) {
      case 'fan': a.fanPoints += e.amount; break;
      case 'ready': a.readyIn += e.amount; b.readyOut += e.amount; break;
      case 'flowerPig': a.flowerPigIn += e.amount; b.flowerPigOut += e.amount; break;
      case 'refund': a.refundIn += e.amount; b.refundOut += e.amount; break;
      default: break;
    }
  }

  return { reason, entries, seats };
}

/** 净分守恒检查（所有家净分之和必须为 0） */
export function isSettlementBalanced(s: RoundSettlement): boolean {
  return s.seats.reduce((acc, x) => acc + x.net, 0) === 0;
}
