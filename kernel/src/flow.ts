/**
 * 血战到底 —— 规则引擎（流程层）
 *
 * 设计原则：
 *   1) 可解释优先 —— 每一步都暴露「现在该谁、能做什么、为什么」给教学层。
 *   2) 规则参数化 —— 番数、杠分、封顶等存在差异的地方全部走 Rules，不在流程里写死。
 *   3) 纯数据 + 事件 —— GameEngine 不依赖 DOM / 网络，便于单测与无头模拟。
 *
 * 川麻（血战到底）与通用麻将的关键差异（开源项目普遍漏掉的）：
 *   - 定缺 (declareMissing)：开局每人必须选定一门「缺门」，手牌必须打缺该门，
 *     且最终胡牌手牌中不得含缺门任何一张。这是川麻的灵魂。
 *   - 缺一门硬约束：持有缺门牌时，必须打出缺门牌（不能打其他门）。
 *   - 血战：一家胡牌后本局继续，直到 3 家胡牌或牌墙摸完。
 *   - 无吃 (chow)：只有碰 (pong) 与杠 (kong)。
 */

import {
  TILE_KINDS,
  WAN,
  TIAO,
  TONG,
  SUITS,
  type TileId,
  type Counts,
  createWall,
  shuffleInPlace,
  countsFrom,
  totalOf,
  cloneCounts,
  suitCount,
} from './tiles.ts';
import { canWin } from './win.ts';
import { shanten } from './shanten.ts';
import {
  scoringFor,
  type ScoringConfig,
  type WinContext,
  defaultScoring,
} from './scoring.ts';
import { recordKong, settleRoundImpl, isReadyCounts, type PayEntry, type RoundSettlement } from './settle.ts';

export type Seat = 0 | 1 | 2 | 3;
export const SEATS: Seat[] = [0, 1, 2, 3];

export type MeldType = 'pong' | 'kong';
export interface Meld {
  type: MeldType;
  tile: TileId;
  concealed: boolean; // 暗杠 = true；明杠/碰 = false
  added: boolean; // 补杠（在碰的基础上加第 4 张）= true
  from: Seat | -1; // 杠/碰来源（-1 = 暗杠/补杠，源于自己）
}

export interface WinRecord {
  tile: TileId; // 和的牌
  selfDraw: boolean; // 自摸 / 点炮
  by: Seat; // 点炮者（自摸为 -1）
  kind: 'standard' | 'sevenPairs';
  fans: FanResult; // 番种明细
  score: number; // 该玩家本局总得分（含杠分、查叫等）
}

export interface PlayerState {
  seat: Seat;
  hand: Counts; // 手牌（含刚摸到的牌）
  melds: Meld[];
  missing: number; // 缺门花色 0/1/2；-1 = 未定缺
  river: TileId[]; // 弃牌河
  won: boolean;
  winInfo?: WinRecord;
  lastDrawn: TileId | -1; // UI / 提示用
  isHuman: boolean;
}

export type Phase = 'declareMissing' | 'playing' | 'finished';

export interface ClaimState {
  discardSeat: Seat;
  tile: TileId;
  // 在该弃牌上，各家可做的操作（已结算出合法集合）
  ron: Seat[]; // 可点炮胡
  pong: Seat[]; // 可碰
  kong: Seat[]; // 可明杠
  resolved: boolean;
}

export interface GameState {
  wall: TileId[]; // 牌墙（抽牌从尾部 pop）
  wallPointer: number; // 已摸张数（用于「还剩多少」提示）
  players: PlayerState[];
  dealer: Seat; // 庄家
  turn: Seat; // 当前行动者
  phase: Phase;
  lastDiscard: { seat: Seat; tile: TileId } | null;
  claim: ClaimState | null;
  pendingDraw: boolean; // 当前 turn 是否已摸牌待打
  winCount: number; // 已胡人数
  config: ScoringConfig;
  history: GameEvent[]; // 决策回放（教学/复盘用）
  // 结算缓存
  kongScores: number[]; // 各玩家累计杠分（退税用）
  kongEntries: PayEntry[]; // 杠分流水（实时记账，终局汇总/退税）
  settlement: RoundSettlement | null; // 终局结算结果
  readyAtEnd: boolean[]; // 流局时各家是否听牌
  // 杠上花/杠上炮/海底 判定用的瞬时状态
  lastKongSeat: Seat | -1; // 最近一次杠的座位
  replacementPending: boolean; // 当前是否处于「杠后补牌」阶段
}

export interface GameEvent {
  type:
    | 'deal'
    | 'declareMissing'
    | 'draw'
    | 'discard'
    | 'pong'
    | 'kong'
    | 'win'
    | 'pass'
    | 'noClaim'
    | 'roundEnd';
  seat?: Seat;
  tile?: TileId;
  by?: Seat;
  note?: string;
}

/**
 * 规则参数（仅流程相关；番数在 ScoringConfig）。
 * 这些是「开源普遍漏掉 / 各地有差异」的点，集中可配。
 */
export interface Rules {
  allowKong: boolean; // 是否允许杠
  allowAddedKong: boolean; // 补杠
  checkReadyHand: boolean; // 查大叫（流局时听牌未胡者获赔）
  checkFlowerPig: boolean; // 查花猪（未打缺者赔付）
  taxRefund: boolean; // 退税（未胡者的杠分退还）
  cap: number; // 单局封顶番（0 = 不封顶）；预设 32
  mustDeclareTenpai?: boolean; // 查叫：流局时未听牌者赔付（合并到 checkReadyHand）
}

export const defaultRules: Rules = {
  allowKong: true,
  allowAddedKong: true,
  checkReadyHand: true,
  checkFlowerPig: true,
  taxRefund: true,
  cap: 32,
};

/** 新建一局（洗牌 + 发牌，未定缺） */
export function createGame(
  humanSeat: Seat = 0,
  rules: Rules = defaultRules,
  scoring: ScoringConfig = defaultScoring,
  rng: () => number = Math.random,
): GameState {
  const wall = shuffleInPlace(createWall(), rng);
  const players: PlayerState[] = SEATS.map((s) => ({
    seat: s,
    hand: new Array(TILE_KINDS).fill(0),
    melds: [],
    missing: -1,
    river: [],
    won: false,
    lastDrawn: -1,
    isHuman: s === humanSeat,
  }));

  const g: GameState = {
    wall,
    wallPointer: 0,
    players,
    dealer: 0,
    turn: 0,
    phase: 'declareMissing',
    lastDiscard: null,
    claim: null,
    pendingDraw: false,
    winCount: 0,
    config: { ...scoring, rules: { ...rules } },
    history: [],
    kongScores: [0, 0, 0, 0],
    kongEntries: [],
    settlement: null,
    readyAtEnd: [false, false, false, false],
    lastKongSeat: -1,
    replacementPending: false,
  };

  // 发牌：每家 13 张（庄家第 14 张在首摸时补）
  for (let r = 0; r < 13; r++) {
    for (const s of SEATS) {
      const t = g.wall.pop()!;
      g.players[s].hand[t]++;
    }
  }
  g.history.push({ type: 'deal', note: '13 tiles each' });
  return g;
}

/* ---------------- 定缺 ---------------- */

export function declareMissing(g: GameState, seat: Seat, suit: number): void {
  if (g.phase !== 'declareMissing') throw new Error('not in declareMissing phase');
  const p = g.players[seat];
  if (p.missing !== -1) throw new Error(`seat ${seat} already declared`);
  p.missing = suit;
  g.history.push({ type: 'declareMissing', seat, note: `missing suit ${suit}` });

  if (SEATS.every((s) => g.players[s].missing !== -1)) {
    g.phase = 'playing';
    g.turn = g.dealer;
    // 庄家首巡需先摸第 14 张（发牌阶段每人 13 张），故必须标记待摸。
    g.pendingDraw = true;
  }
}

/* ---------------- 摸牌 ---------------- */

/** 当前 turn 摸一张牌（含杠后补牌共用）。返回是否还有牌。 */
export function draw(g: GameState, seat: Seat): boolean {
  if (g.wall.length === 0) return false;
  const t = g.wall.pop()!;
  g.wallPointer++;
  g.players[seat].hand[t]++;
  g.players[seat].lastDrawn = t;
  g.history.push({ type: 'draw', seat, tile: t });
  return true;
}

/* ---------------- 缺门约束 ---------------- */

/** 是否仍持有缺门牌（持有则必须先打缺门） */
export function holdsMissingSuit(p: PlayerState): boolean {
  if (p.missing < 0) return false;
  return suitCount(p.hand, p.missing) > 0;
}

/** 当前手牌（含副露）是否完全打缺（不含缺门牌）——胡牌前置条件 */
export function hasNoMissing(p: PlayerState): boolean {
  if (p.missing < 0) return true; // 未定缺阶段不算
  return suitCount(p.hand, p.missing) === 0;
}

/* ---------------- 胡牌判定（带缺门） ---------------- */

export function canSelfWin(p: PlayerState, melds = 0): boolean {
  if (!hasNoMissing(p)) return false;
  return canWin(p.hand, melds) !== null;
}

/** 点炮胡：把弃牌暂加入手牌后判定 */
export function canRon(p: PlayerState, tile: TileId, melds = 0): boolean {
  if (!hasNoMissing(p)) return false;
  if (p.missing >= 0 && Math.floor(tile / 9) === p.missing) return false;
  p.hand[tile]++;
  const ok = canWin(p.hand, melds) !== null;
  p.hand[tile]--;
  return ok;
}

/* ---------------- 出牌 ---------------- */

/**
 * 当前 turn 打出一张牌。校验缺门约束。
 * 打出后计算 claim（碰/杠/点炮），但不立即结算。
 */
export function discard(g: GameState, seat: Seat, tile: TileId): void {
  const p = g.players[seat];
  if (p.hand[tile] <= 0) throw new Error(`seat ${seat} has no tile ${tile}`);
  // 缺门约束：持有缺门牌时不得打其他门
  if (holdsMissingSuit(p) && Math.floor(tile / 9) !== p.missing) {
    throw new Error(`seat ${seat} must discard missing suit tile`);
  }
  p.hand[tile]--;
  p.lastDrawn = -1;
  p.river.push(tile);
  g.lastDiscard = { seat, tile };
  g.history.push({ type: 'discard', seat, tile });
  g.pendingDraw = false;

  // 计算 claim
  const ron: Seat[] = [];
  const pong: Seat[] = [];
  const kong: Seat[] = [];
  const tileSuit = Math.floor(tile / 9);
  for (const s of SEATS) {
    if (s === seat) continue;
    const q = g.players[s];
    if (q.won) continue;
    if (canRon(q, tile, q.melds.length)) ron.push(s);
    // 缺门牌不可碰/杠（川麻硬约束）
    if (q.missing >= 0 && tileSuit === q.missing) continue;
    if (q.hand[tile] >= 2) pong.push(s);
    // 杠必须能补牌：牌墙已空时杠无从补牌，按流局处理，不给这个选项
    if (g.config.rules.allowKong && q.hand[tile] >= 3 && g.wall.length > 0) kong.push(s);
  }
  g.claim = { discardSeat: seat, tile, ron, pong, kong, resolved: false };
}

/* ---------------- 碰 ---------------- */

/** 指定 seat 碰 discardSeat 刚打出的 tile */
export function applyPong(g: GameState, seat: Seat): void {
  const c = g.claim;
  if (!c || c.resolved) throw new Error('no unresolved claim');
  if (!c.pong.includes(seat)) throw new Error(`seat ${seat} cannot pong`);
  const p = g.players[seat];
  p.hand[c.tile] -= 2;
  p.melds.push({ type: 'pong', tile: c.tile, concealed: false, added: false, from: c.discardSeat });
  g.history.push({ type: 'pong', seat, tile: c.tile, by: c.discardSeat });
  // 碰后该 seat 成为 turn，需打出一张（不摸牌）
  g.turn = seat;
  g.claim = null;
  g.pendingDraw = false;
}

/* ---------------- 杠 ---------------- */

/** 明杠：用刚打出的 tile 杠（手里有 3 张），杠后立即补牌 */
export function applyKong(g: GameState, seat: Seat): void {
  const c = g.claim;
  if (!c || c.resolved) throw new Error('no unresolved claim');
  if (!c.kong.includes(seat)) throw new Error(`seat ${seat} cannot kong`);
  const p = g.players[seat];
  p.hand[c.tile] -= 3;
  p.melds.push({ type: 'kong', tile: c.tile, concealed: false, added: false, from: c.discardSeat });
  g.history.push({ type: 'kong', seat, tile: c.tile, by: c.discardSeat, note: 'exposed' });
  g.claim = null;
  g.turn = seat;
  g.lastKongSeat = seat;
  g.replacementPending = true;
  g.pendingDraw = false;
  recordKong(g, seat, 'exposed', c.tile, c.discardSeat); // 直杠：放杠者付
  draw(g, seat); // 杠后补牌
}

/** 暗杠：手里有 4 张同牌，杠后立即补牌 */
export function applyConcealedKong(g: GameState, seat: Seat, tile: TileId): void {
  const p = g.players[seat];
  if (!g.config.rules.allowKong) throw new Error('kong disabled');
  if (p.hand[tile] < 4) throw new Error(`seat ${seat} has <4 of ${tile}`);
  p.hand[tile] -= 4;
  p.melds.push({ type: 'kong', tile, concealed: true, added: false, from: -1 });
  g.history.push({ type: 'kong', seat, tile, note: 'concealed' });
  g.lastKongSeat = seat;
  g.replacementPending = true;
  g.pendingDraw = false;
  if (g.turn !== seat) g.turn = seat;
  recordKong(g, seat, 'concealed', tile); // 暗杠：每家付
  draw(g, seat); // 杠后补牌
}

/**
 * 补杠前的抢杠候选：其他未胡家能否和这张牌。
 * 抢杠胡不计杠分 —— 杠没成立，牌被抢走。
 */
export function robbableSeats(g: GameState, seat: Seat, tile: TileId): Seat[] {
  const out: Seat[] = [];
  for (const s of SEATS) {
    if (s === seat) continue;
    const q = g.players[s];
    if (q.won) continue;
    if (canRon(q, tile, q.melds.length)) out.push(s);
  }
  return out;
}

/**
 * 补杠：在自己碰的基础上加第 4 张（自己摸到或手里有），杠后立即补牌。
 *
 * 抢杠优先：若这张牌能被其他未胡家和，则**杠不成立**，改为按点炮结算
 * （番种里 +1「抢杠胡」）。血战到底支持一炮多响，多家可同时胡。
 */
export function applyAddedKong(g: GameState, seat: Seat, tile: TileId): void {
  const p = g.players[seat];
  if (!g.config.rules.allowAddedKong) throw new Error('added kong disabled');
  const m = p.melds.find((x) => x.type === 'pong' && x.tile === tile);
  if (!m) throw new Error('no pong to add kong');
  if (p.hand[tile] < 1) throw new Error('no tile to add');

  const robbers = robbableSeats(g, seat, tile);
  if (robbers.length > 0) {
    p.hand[tile] -= 1; // 第 4 张被抢走；副露保持「碰」，不转杠，不计杠分
    g.history.push({ type: 'kong', seat, tile, note: 'added robbed (抢杠胡)' });
    g.lastKongSeat = -1;
    g.replacementPending = false;
    g.pendingDraw = false;
    g.claim = null;
    for (const r of robbers) {
      const q = g.players[r];
      q.hand[tile]++;
      finalizeWin(g, r, tile, false, seat, true);
      q.hand[tile]--;
    }
    g.turn = nextActiveSeat(g, seat);
    g.pendingDraw = true;
    return;
  }

  p.hand[tile] -= 1;
  m.type = 'kong';
  m.added = true;
  m.concealed = false;
  g.history.push({ type: 'kong', seat, tile, note: 'added' });
  g.lastKongSeat = seat;
  g.replacementPending = true;
  g.pendingDraw = false;
  if (g.turn !== seat) g.turn = seat;
  recordKong(g, seat, 'added', tile); // 补杠：每家付
  draw(g, seat); // 杠后补牌
}

/* ---------------- 胡牌 ---------------- */

/** 当前 turn 自摸胡 */
export function applySelfWin(g: GameState, seat: Seat): WinRecord {
  const p = g.players[seat];
  if (!canSelfWin(p, p.melds.length)) throw new Error(`seat ${seat} cannot self-win`);
  const rec = finalizeWin(g, seat, p.lastDrawn, true, -1);
  // 血战：胡牌后轮到下一未胡家继续
  g.turn = nextActiveSeat(g, seat);
  g.pendingDraw = true;
  return rec;
}

/** 指定 seat 点炮胡刚打出的 tile */
export function applyRon(g: GameState, seat: Seat): WinRecord {
  const c = g.claim;
  if (!c || !c.ron.includes(seat)) throw new Error(`seat ${seat} cannot ron`);
  const p = g.players[seat];
  const t = c.tile;
  p.hand[t]++; // 暂加入判定
  const rec = finalizeWin(g, seat, t, false, c.discardSeat);
  p.hand[t]--; // 复位（结算用 winInfo 记录）
  g.claim = null;
  // 血战：点炮后轮到弃牌者下家继续
  g.turn = nextActiveSeat(g, c.discardSeat);
  g.pendingDraw = true;
  return rec;
}

/** 结算一次胡牌（自摸/点炮/抢杠通用），写入 player.winInfo，处理杠分与血战持续推进 */
function finalizeWin(
  g: GameState,
  seat: Seat,
  tile: TileId,
  selfDraw: boolean,
  by: Seat,
  robbingKong = false,
): WinRecord {
  const p = g.players[seat];
  const kind = canWin(p.hand, p.melds.length) === 'sevenPairs' ? 'sevenPairs' : 'standard';

  const ctx: WinContext = {
    selfDraw,
    by,
    tile,
    kongReplacement: g.replacementPending && selfDraw,
    afterKongDiscard: g.replacementPending && !selfDraw && g.lastKongSeat === (g.claim?.discardSeat ?? -2),
    robbingKong,
    lastTile: g.wall.length === 0,
  };
  const fans = scoringFor(g, p, ctx);

  const rec: WinRecord = {
    tile,
    selfDraw,
    by,
    kind,
    fans,
    score: fans.total,
  };
  p.won = true;
  p.winInfo = rec;
  g.winCount++;
  g.history.push({ type: 'win', seat, tile, by, note: `${kind} fans=${fans.total}` });

  // 清杠上状态
  g.replacementPending = false;
  g.lastKongSeat = -1;
  return rec;
}

/* ---------------- 流局 / 回合结束 ---------------- */

export function isGameOver(g: GameState): boolean {
  if (g.winCount >= 3) return true;
  // 牌墙摸完：留 0 张可摸（血战通常留 0，摸到最后一张仍可作海底）
  return g.wall.length === 0 && g.phase === 'playing';
}

/**
 * 流局或 3 家胡后的结算。
 * 真正的分账交给 settle.ts（番分 / 杠分 / 查大叫 / 查花猪 / 退税），
 * 这里只负责标记终局、缓存听牌状态，并落一份结算结果到 g.settlement。
 */
export function settleRound(g: GameState): void {
  if (g.phase === 'finished') return;
  g.phase = 'finished';

  // 记录各家听牌状态（未胡者）
  for (const s of SEATS) {
    const p = g.players[s];
    if (!p.won) g.readyAtEnd[s] = isReadyAtEnd(p);
  }

  g.settlement = settleRoundImpl(g);
  g.history.push({ type: 'roundEnd', note: 'settled' });
}

/**
 * 流局听牌判定：与 settle.isReadyHand 同源（张数归一化 + 缺门必须已打清）。
 *
 * 历史坑：旧实现在这里对 `hand + 1` 直接调 canWin，隐含假设手牌是标准张数；
 * 一旦有一家以 14 张（刚摸完牌墙最后一张、还没打出）进入结算，就必然判「未下叫」，
 * 也就是玩家看到的「我明明听牌了，查叫却说我没叫」。
 */
function isReadyAtEnd(p: PlayerState): boolean {
  if (!hasNoMissing(p)) return false;
  return isReadyCounts(p.hand, p.melds.length);
}

/** 下一位未胡的 seat（用于无人鸣牌时推进） */
export function nextActiveSeat(g: GameState, from: Seat): Seat {
  for (let i = 1; i <= 4; i++) {
    const s = ((from + i) % 4) as Seat;
    if (!g.players[s].won) return s;
  }
  return from;
}

/** 跳过 claim（无人鸣牌），推进到下一 seat 摸牌 */
export function passClaim(g: GameState): void {
  const c = g.claim;
  if (!c) throw new Error('no claim to pass');
  g.history.push({ type: 'noClaim', seat: c.discardSeat, tile: c.tile });
  g.claim = null;
  g.replacementPending = false;
  g.lastKongSeat = -1;
  g.turn = nextActiveSeat(g, c.discardSeat);
  g.pendingDraw = true;
}

/* ---------------- 便捷查询 ---------------- */

export function concealedTiles(p: PlayerState): TileId[] {
  const out: TileId[] = [];
  for (let i = 0; i < TILE_KINDS; i++) for (let n = 0; n < p.hand[i]; n++) out.push(i);
  return out;
}

export function handShanten(p: PlayerState): number {
  return shanten(p.hand, p.melds.length);
}
