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

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
