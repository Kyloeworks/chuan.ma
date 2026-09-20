/**
 * 流程层单测：定缺强制 + 缺门不可碰杠 + 基础胡牌链路
 * 用法：node --experimental-strip-types test/flow.test.ts
 */
import { TILE_KINDS, tileId } from '../src/tiles.ts';
import {
  createGame,
  declareMissing,
  discard,
  canSelfWin,
  holdsMissingSuit,
  hasNoMissing,
  applySelfWin,
  applyAddedKong,
  robbableSeats,
  defaultRules,
  type GameState,
} from '../src/flow.ts';
import { defaultScoring } from '../src/scoring.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}

const W = (r: number) => tileId(0, r);
const T = (r: number) => tileId(1, r);

// ---- 定缺强制 ----
{
  const g = createGame(0, defaultRules, defaultScoring);
  // 给 seat0 一手中含万(缺门)与条的手牌，定缺为万
  const p = g.players[0];
  p.hand = new Array(TILE_KINDS).fill(0);
  p.hand[W(5)] = 1; // 万 → 缺门，必须打掉
  p.hand[T(3)] = 1; // 条
  p.hand[T(4)] = 1;
  p.missing = 0; // 缺万

  ok('持有缺门牌时 holdsMissingSuit=true', holdsMissingSuit(p) === true);
  ok('hasNoMissing=false', hasNoMissing(p) === false);

  // 打条应被拒绝
  let threw = false;
  try {
    discard(g, 0, T(3));
  } catch {
    threw = true;
  }
  ok('缺门未打清时打条被拒绝', threw === true);

  // 打万（缺门）被允许
  let threw2 = false;
  try {
    discard(g, 0, W(5));
  } catch {
    threw2 = true;
  }
  ok('缺门牌可被打出', threw2 === false);
}

// ---- 定缺后胡牌必须不含缺门 ----
{
  const g = createGame(0, defaultRules, defaultScoring);
  const p = g.players[0];
  // 14 张标准胡牌（全条）：111 222 333 444 55 条
  p.hand = new Array(TILE_KINDS).fill(0);
  for (const r of [1, 2, 3, 4]) p.hand[T(r)] += 3;
  p.hand[T(5)] += 2;
  p.missing = 0; // 缺万，手牌无万 → 合法
  ok('缺门为万且手牌无万 → canSelfWin', canSelfWin(p, 0) === true);

  // 缺门改为条 → 手牌全条 → 不能胡
  p.missing = 1;
  ok('缺门为条且手牌全条 → canSelfWin=false', canSelfWin(p, 0) === false);
}

// ---- 完整短对局：发牌→定缺→自摸胡 ----
{
  const g = createGame(0, defaultRules, defaultScoring);
  // 直接构造一个已可自摸的局面
  const p = g.players[0];
  p.hand = new Array(TILE_KINDS).fill(0);
  for (const r of [1, 2, 3, 4]) p.hand[T(r)] += 3;
  p.hand[T(5)] += 2;
  p.missing = 0;
  // 让其他三家也定缺以便进入 playing
  for (const s of [1, 2, 3] as const) {
    g.players[s].hand = new Array(TILE_KINDS).fill(0);
    g.players[s].missing = 0;
  }
  // 设置 phase=playing 模拟已定缺完成
  (g as GameState & { phase: string }).phase = 'playing';
  g.turn = 0;

  ok('可自摸', canSelfWin(p, 0) === true);
  const rec = applySelfWin(g, 0);
  ok('applySelfWin 后 won=true', g.players[0].won === true);
  ok('winCount=1', g.winCount === 1);
  ok('番数>=1', rec.fans.total >= 1);
  ok('轮到下一未胡家', g.turn !== 0);
}

// ---- 定缺全部完成后：庄家进入待摸状态（首巡先摸第 14 张）----
{
  const g = createGame(0, defaultRules, defaultScoring);
  for (const s of [0, 1, 2, 3] as const) declareMissing(g, s, 0);
  ok('全部定缺后进入 playing', g.phase === 'playing');
  ok('轮到庄家', g.turn === g.dealer);
  ok('庄家首巡待摸（pendingDraw=true）', g.pendingDraw === true);
  const before = g.players[g.dealer].hand.reduce((a, b) => a + b, 0);
  ok('庄家发牌 13 张', before === 13);
}

// ---- 抢杠胡：补杠的第 4 张被抢 → 杠不成立、按点炮结算、不计杠分 ----
{
  const W = (r: number) => tileId(0, r);
  const T = (r: number) => tileId(1, r);
  const g = createGame(0, defaultRules, defaultScoring);
  for (const s of [0, 1, 2, 3] as const) g.players[s].missing = 2; // 缺筒
  (g as GameState & { phase: string }).phase = 'playing';

  g.players[1].hand = new Array(TILE_KINDS).fill(0);
  g.players[1].melds = [{ type: 'pong', tile: W(5), concealed: false, added: false, from: 2 }];
  g.players[1].hand[W(5)] = 1; // 第 4 张 → 可补杠
  g.players[1].hand[W(9)] = 1;

  g.players[2].hand = new Array(TILE_KINDS).fill(0);
  for (const t of [W(1), W(1), W(1), W(6), W(6), W(6), T(1), T(1), T(1), T(2), T(2), W(3), W(4)]) {
    g.players[2].hand[t]++;
  }
  g.players[2].melds = [];

  ok('补杠前 seat2 不在胡牌态', g.players[2].won === false);
  ok('seat2 可抢杠 W5', robbableSeats(g, 1, W(5)).includes(2));

  g.turn = 1;
  g.pendingDraw = false;
  g.wall = [W(8), W(8)];
  applyAddedKong(g, 1, W(5));

  const rec = g.players[2].winInfo;
  ok('抢杠后 seat2 胡牌', g.players[2].won === true);
  ok('  └ 记为点炮（非自摸）', rec?.selfDraw === false && rec?.by === 1);
  ok('  └ 番种含抢杠胡', rec?.fans.fanKeys.includes('qianggang') === true);
  ok('杠未成立（副露仍是碰）', g.players[1].melds[0].type === 'pong');
  ok('抢杠不计杠分', g.kongEntries.length === 0);
  ok('轮到被抢者下家', g.turn !== 1);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
