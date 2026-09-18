/**
 * 查叫（听牌判定）回归测试
 *
 * 背景：玩家反馈「最后明明听牌了，查叫却说我没叫牌」。
 * 根因：查叫判定直接对 `hand + 1` 调 canWin，隐含假设手牌是标准张数
 * （13 - 3*melds）。而「摸到牌墙最后一张、还没来得及打出」这一瞬间手牌是
 * 标准张数 + 1，于是加一张后张数不匹配、恒不成和 → 必然被判「未下叫」。
 *
 * 本测试同时钉死：
 *   1) 张数归一化的 isReadyCounts（13 张 / 14 张两种形态都正确）
 *   2) flow.settleRound 落盘的 readyAtEnd 与结算席位表一致且正确
 *   3) 缺门未打清者不算听牌（花猪）
 *
 * 用法：node --experimental-strip-types kernel/test/ready.test.ts
 */
import { TILE_KINDS, tileId, type Counts } from '../src/tiles.ts';
import {
  createGame, settleRound, defaultRules, declareMissing,
  type Seat,
} from '../src/flow.ts';
import { isReadyCounts, isReadyHand, isSettlementBalanced, hasClearedMissing, isFlowerPig } from '../src/settle.ts';
import { defaultScoring } from '../src/scoring.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`); }
}

const W = (r: number) => tileId(0, r);
const T = (r: number) => tileId(1, r);
const D = (r: number) => tileId(2, r);

function hand(counts: Array<[number, number]>): Counts {
  const c = new Array(TILE_KINDS).fill(0) as Counts;
  for (const [id, n] of counts) c[id] += n;
  return c;
}
const total = (c: Counts) => c.reduce((a, b) => a + b, 0);

/* ---------------- 1) isReadyCounts：两种手牌形态 ---------------- */

// 13 张听牌：万123456789 + 条111 + 条2 单张 → 听 条2（凑将）
const TENPAI13 = hand([
  [W(1), 1], [W(2), 1], [W(3), 1], [W(4), 1], [W(5), 1], [W(6), 1], [W(7), 1], [W(8), 1], [W(9), 1],
  [T(1), 3], [T(2), 1],
]);
// 14 张（同一副牌多摸一张 条5，尚未打出）
const TENPAI14 = hand([
  [W(1), 1], [W(2), 1], [W(3), 1], [W(4), 1], [W(5), 1], [W(6), 1], [W(7), 1], [W(8), 1], [W(9), 1],
  [T(1), 3], [T(2), 1], [T(5), 1],
]);
// 13 张散牌（远未听牌）
const SCATTER13 = hand([
  [W(1), 1], [W(4), 1], [W(7), 1], [T(2), 1], [T(5), 1], [T(8), 1],
  [D(3), 1], [D(6), 1], [D(9), 1], [W(2), 1], [T(3), 1], [D(5), 1], [W(9), 1],
]);
const SCATTER14 = hand([
  [W(1), 1], [W(4), 1], [W(7), 1], [T(2), 1], [T(5), 1], [T(8), 1],
  [D(3), 1], [D(6), 1], [D(9), 1], [W(2), 1], [T(3), 1], [D(5), 1], [W(9), 1], [T(7), 1],
]);
// 14 张已成和：万123456789 + 条111 + 条22
const WIN14 = hand([
  [W(1), 1], [W(2), 1], [W(3), 1], [W(4), 1], [W(5), 1], [W(6), 1], [W(7), 1], [W(8), 1], [W(9), 1],
  [T(1), 3], [T(2), 2],
]);

ok('13 张标准听牌 → 下叫', isReadyCounts(TENPAI13) === true);
ok('14 张（多一张未打）听牌 → 下叫（修复点）', isReadyCounts(TENPAI14) === true);
ok('13 张散牌 → 未下叫', isReadyCounts(SCATTER13) === false);
ok('14 张散牌 → 未下叫', isReadyCounts(SCATTER14) === false);
ok('14 张已成和 → 算下叫（向听 -1）', isReadyCounts(WIN14) === true);

/* ---------------- 2) 有副露 / 杠后的张数 ---------------- */

// melds = 1（已碰一门）→ 手牌标准 10 张；万123 456 789 + 条1 单张 → 单钓 条1
const MELD10 = hand([
  [W(1), 1], [W(2), 1], [W(3), 1], [W(4), 1], [W(5), 1], [W(6), 1], [W(7), 1], [W(8), 1], [W(9), 1],
  [T(1), 1],
]);
const MELD11 = hand([
  [W(1), 1], [W(2), 1], [W(3), 1], [W(4), 1], [W(5), 1], [W(6), 1], [W(7), 1], [W(8), 1], [W(9), 1],
  [T(1), 2],
]);
ok('melds=1 的 10 张标准听牌 → 下叫', isReadyCounts(MELD10, 1) === true);
ok('melds=1 的 11 张（多一张）听牌/已和 → 下叫', isReadyCounts(MELD11, 1) === true);

/* ---------------- 3) flow.settleRound：终局听牌与赔付 ---------------- */

{
  const g = createGame(0, defaultRules, defaultScoring);
  for (const s of [0, 1, 2, 3] as Seat[]) declareMissing(g, s, 0); // 缺万
  // seat0：14 张听牌（万是缺门 → 换成筒的同类形状）：
  //   筒123456789 + 条111 + 条2 + 条5 → 打 条5 后听 条2
  g.players[0].hand = hand([
    [D(1), 1], [D(2), 1], [D(3), 1], [D(4), 1], [D(5), 1], [D(6), 1], [D(7), 1], [D(8), 1], [D(9), 1],
    [T(1), 3], [T(2), 1], [T(5), 1],
  ]);
  // seat1：13 张散牌（未下叫）
  g.players[1].hand = hand([
    [D(1), 1], [D(4), 1], [D(7), 1], [T(2), 1], [T(5), 1], [T(8), 1],
    [W(1), 1], [W(4), 1], [W(7), 1], [D(2), 1], [T(3), 1], [W(3), 1], [W(6), 1],
  ]);
  g.players[2].hand = hand([]);
  g.players[3].hand = hand([]);
  g.wall = [];              // 牌墙摸完 → 流局
  g.phase = 'playing';

  ok('seat0 手牌 14 张（模拟「摸到牌墙最后一张」）', total(g.players[0].hand) === 14);
  ok('settleRound 前 seat0 已打缺（缺万、手上无万）', hasClearedMissing(g.players[0]) === true);
  ok('seat1 未打缺 → 花猪', isFlowerPig(g.players[1]) === true);

  settleRound(g);

  const S = g.settlement!;
  ok('结算成立且分账守恒', isSettlementBalanced(S));
  ok('结算原因 = 牌墙摸完', S.reason === 'wallEmpty');
  ok('flow.readyAtEnd[0] = true（旧实现恒为 false）', g.readyAtEnd[0] === true, g.readyAtEnd);
  ok('结算席位表 seats[0].isReady = true', S.seats[0].isReady === true);
  ok('花猪 seats[1].isFlowerPig = true', S.seats[1].isFlowerPig === true);
  ok('花猪不算听牌', S.seats[1].isReady === false);
  ok('听牌家拿到查叫收入（readyIn > 0）', S.seats[0].readyIn > 0, S.seats[0].readyIn);
  ok('花猪付出花猪赔付（flowerPigOut > 0）', S.seats[1].flowerPigOut > 0, S.seats[1].flowerPigOut);
  ok('听牌家没有反过来赔查叫（readyOut = 0）', S.seats[0].readyOut === 0);
}

console.log(`\n=== 查叫回归：${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
