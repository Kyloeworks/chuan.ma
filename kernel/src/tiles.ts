/**
 * 川麻（血战到底）牌模型
 *
 * 牌组：万 / 条 / 筒 各 1-9 各 4 张 = 108 张。无风牌、无箭牌、无花牌。
 * 编码：tileId = suit * 9 + (rank - 1)，范围 0..26
 */

export const SUITS = 3;
export const RANKS = 9;
export const TILE_KINDS = 27;
export const COPIES = 4;
export const WALL_SIZE = TILE_KINDS * COPIES; // 108

export const WAN = 0;
export const TIAO = 1;
export const TONG = 2;

export const SUIT_NAMES = ['wan', 'tiao', 'tong'] as const;
export const SUIT_LABELS = ['万', '条', '筒'] as const;

export type TileId = number;

/** 手牌 counts 表示：长度 27，每项 0..4 */
export type Counts = number[];

export function tileId(suit: number, rank: number): TileId {
  return suit * RANKS + (rank - 1);
}

export function suitOf(id: TileId): number {
  return Math.floor(id / RANKS);
}

export function rankOf(id: TileId): number {
  return (id % RANKS) + 1;
}

/** 中文牌名，如 "3万" */
export function tileLabel(id: TileId): string {
  return `${rankOf(id)}${SUIT_LABELS[suitOf(id)]}`;
}

/** 英文牌名，如 "3 wan" — 双语前端用 */
export function tileLabelEn(id: TileId): string {
  return `${rankOf(id)} ${SUIT_NAMES[suitOf(id)]}`;
}

export function createWall(): TileId[] {
  const wall: TileId[] = new Array(WALL_SIZE);
  let k = 0;
  for (let i = 0; i < TILE_KINDS; i++) {
    for (let n = 0; n < COPIES; n++) wall[k++] = i;
  }
  return wall;
}

/** 原地洗牌，rnd 可注入以便测试复现 */
export function shuffleInPlace(a: TileId[], rnd: () => number = Math.random): TileId[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** 可复现的伪随机数生成器（mulberry32），测试用 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Counts 工具 ---------- */

export function emptyCounts(): Counts {
  return new Array(TILE_KINDS).fill(0);
}

export function countsFrom(ids: TileId[]): Counts {
  const c = emptyCounts();
  for (const id of ids) c[id]++;
  return c;
}

export function toTiles(c: Counts): TileId[] {
  const out: TileId[] = [];
  for (let i = 0; i < TILE_KINDS; i++) {
    for (let n = 0; n < c[i]; n++) out.push(i);
  }
  return out;
}

export function totalOf(c: Counts): number {
  let s = 0;
  for (let i = 0; i < TILE_KINDS; i++) s += c[i];
  return s;
}

export function cloneCounts(c: Counts): Counts {
  return c.slice();
}

export function addTile(c: Counts, id: TileId): void {
  c[id]++;
}

/** 返回 false 表示该牌不存在 */
export function removeTile(c: Counts, id: TileId): boolean {
  if (c[id] <= 0) return false;
  c[id]--;
  return true;
}

/** 该门牌的张数 */
export function suitCount(c: Counts, suit: number): number {
  let s = 0;
  const base = suit * RANKS;
  for (let i = 0; i < RANKS; i++) s += c[base + i];
  return s;
}

/** 手牌中出现的花色集合 */
export function suitsPresent(c: Counts): number[] {
  const out: number[] = [];
  for (let s = 0; s < SUITS; s++) {
    if (suitCount(c, s) > 0) out.push(s);
  }
  return out;
}
