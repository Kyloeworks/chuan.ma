/**
 * 番种结算 + 主型档判定单测
 * 用法：node --experimental-strip-types test/scoring.test.ts
 *
 * 重点回归：**带副露（碰/杠）的大对子**。
 * 旧实现用手牌张数 == (4 - 杠数) * 3 + 2 校验，只要玩家有「碰」就必然判负，
 * 大对子算不出来、只剩平胡 1 番 —— 这是玩家报的「大对子为什么还是一番」。
 */
import { TILE_KINDS, tileId, type Counts } from '../src/tiles.ts';
import {
  defaultScoring,
  scoringFor,
  countRoots,
  isAllTriplets,
  isFlush,
  meldedHandSize,
  type ScoringConfig,
} from '../src/scoring.ts';
import type { PlayerState, Meld, Seat } from '../src/flow.ts';

let pass = 0;
let fail = 0;
function check(name: string, got: number, want: number) {
  if (got === want) {
    pass++;
    console.log(`  PASS  ${name} = ${got}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}: got ${got}, want ${want}`);
  }
}
function checkBool(name: string, got: boolean, want: boolean) {
  if (got === want) {
    pass++;
    console.log(`  PASS  ${name} = ${got}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}: got ${got}, want ${want}`);
  }
}

function mkPlayer(handTiles: number[], melds: Meld[] = []): PlayerState {
  const hand: Counts = new Array(TILE_KINDS).fill(0);
  for (const t of handTiles) hand[t]++;
  return { seat: 0 as Seat, hand, melds, missing: -1, river: [], won: false, lastDrawn: -1, isHuman: false };
}
const W = (r: number) => tileId(0, r); // 万 1-9
const T = (r: number) => tileId(1, r); // 条 1-9
const B = (r: number) => tileId(2, r); // 筒 1-9

const ctx = (selfDraw: boolean, opts: Partial<{ lastTile: boolean; robbingKong: boolean }> = {}): any => ({
  selfDraw,
  by: -1,
  tile: 0,
  kongReplacement: false,
  afterKongDiscard: false,
  robbingKong: opts.robbingKong ?? false,
  lastTile: opts.lastTile ?? false,
});
const base = { config: defaultScoring };
const withDuanYao = { config: { ...defaultScoring, fan: { ...defaultScoring.fan, duanyao: 1 } } as ScoringConfig };

const pong = (t: number): Meld => ({ type: 'pong', tile: t, concealed: false, added: false, from: 1 as Seat });
const kong = (t: number): Meld => ({ type: 'kong', tile: t, concealed: true, added: false, from: -1 as Seat });
const F = defaultScoring.fan;

console.log('--- ① 基础型 ---');
check('平胡', scoringFor(base, mkPlayer([W(1), W(2), W(3), W(4), W(5), W(6), W(7), W(8), W(9), T(1), T(2), T(3), T(5), T(5)]), ctx(false)).total, F.pinghu);
check('大对子（无副露）', scoringFor(base, mkPlayer([W(1), W(1), W(1), W(2), W(2), W(2), W(3), W(3), W(3), B(4), B(4), B(4), B(5), B(5)]), ctx(false)).total, F.pengpeng);

console.log('--- ② 回归：带副露的大对子（旧实现恒判负） ---');
// 1 个碰（W5）+ 手牌 11 张：W2×3 W3×3 W4×3 B5×2
{
  const p = mkPlayer([W(2), W(2), W(2), W(3), W(3), W(3), W(4), W(4), W(4), B(5), B(5)], [pong(W(5))]);
  const r = scoringFor(base, p, ctx(false));
  check('大对子（1 碰）', r.total, F.pengpeng);
  checkBool('  └ isAllTriplets', r.isAllTriplets, true);
}
// 2 个碰 + 手牌 8 张：W2×3 W3×3 B5×2
{
  const p = mkPlayer([W(2), W(2), W(2), W(3), W(3), W(3), B(5), B(5)], [pong(W(5)), pong(W(6))]);
  check('大对子（2 碰）', scoringFor(base, p, ctx(false)).total, F.pengpeng);
}
// 3 个碰 + 手牌 5 张：W2×3 B5×2
check('大对子（3 碰）',
  scoringFor(base, mkPlayer([W(2), W(2), W(2), B(5), B(5)], [pong(W(4)), pong(W(5)), pong(W(6))]), ctx(false)).total,
  F.pengpeng);
// 2 个暗杠 + 手牌 8 张：W2×3 W3×3 B5×2 → 大对子 + 2 根
check('大对子（2 杠）+ 根×2',
  scoringFor(base, mkPlayer([W(2), W(2), W(2), W(3), W(3), W(3), B(5), B(5)], [kong(W(1)), kong(W(4))]), ctx(false)).total,
  F.pengpeng + F.gen * 2);
// 张数不符时不得误判
checkBool('大对子不误判（1 碰但手牌 14 张）',
  isAllTriplets(mkPlayer([...Array(14).keys()].map((i) => W((i % 9) + 1))).hand, 1), false);
check('meldedHandSize(0/1/4)', meldedHandSize(0) + meldedHandSize(1) + meldedHandSize(4), 14 + 11 + 2);

console.log('--- ③ 金钩钓 / 十八罗汉（键名分开） ---');
// 4 个碰 + 手牌 2 张（单钓将）
{
  const r = scoringFor(base, mkPlayer([B(5), B(5)], [pong(W(4)), pong(W(5)), pong(W(6)), pong(W(7))]), ctx(false));
  check('金钩钓（4 碰 + 单钓将）', r.total, F.jingou);
  checkBool('  └ isGoldenHook', r.isGoldenHook, true);
  checkBool('  └ 非十八罗汉', r.isEighteenArhats, false);
}
// 4 个杠 + 手牌 2 张 → 十八罗汉 + 根×4
{
  const r = scoringFor(base, mkPlayer([B(5), B(5)], [kong(W(1)), kong(W(2)), kong(W(3)), kong(W(4))]), ctx(false));
  check('十八罗汉（4 杠）+ 根×4', r.total, F.shibaluohan + F.gen * 4);
  checkBool('  └ isEighteenArhats', r.isEighteenArhats, true);
  checkBool('  └ 十八罗汉同时构成金钩钓形态（取高档）', r.isGoldenHook, true);
}

console.log('--- ④ 七对家族 ---');
check('七对', scoringFor(base, mkPlayer([W(1), W(1), W(2), W(2), W(3), W(3), T(4), T(4), T(5), T(5), B(6), B(6), B(7), B(7)]), ctx(false)).total, F.qidui);
check('龙七对（含根不重复计）', scoringFor(base, mkPlayer([W(1), W(1), W(1), W(1), W(2), W(2), T(3), T(3), T(4), T(4), B(5), B(5), B(6), B(6)]), ctx(false)).total, F.longqidui);
check('清七对', scoringFor(base, mkPlayer([W(1), W(1), W(2), W(2), W(3), W(3), W(4), W(4), W(5), W(5), W(6), W(6), W(7), W(7)]), ctx(false)).total, F.qingqidui);
check('清龙七对（触顶）', scoringFor(base, mkPlayer([W(1), W(1), W(1), W(1), W(2), W(2), W(3), W(3), W(4), W(4), W(5), W(5), W(6), W(6)]), ctx(false)).total, F.qinglongqidui);

console.log('--- ⑤ 清一色 / 清对 / 根 ---');
check('清一色（顺子型）', scoringFor(base, mkPlayer([W(1), W(2), W(3), W(4), W(5), W(6), W(7), W(8), W(9), W(1), W(2), W(3), W(9), W(9)]), ctx(false)).total, F.pinghu + F.qingyise);
check('清对（清一色 + 大对子，打包）', scoringFor(base, mkPlayer([W(1), W(1), W(1), W(2), W(2), W(2), W(3), W(3), W(3), W(4), W(4), W(4), W(5), W(5)]), ctx(false)).total, F.qingdui);
check('清对（1 暗杠）+ 根',
  scoringFor(base, mkPlayer([W(2), W(2), W(2), W(3), W(3), W(3), W(4), W(4), W(4), W(5), W(5)], [kong(W(1))]), ctx(false)).total,
  F.qingdui + F.gen);
check('清一色 + 自摸 + 根',
  scoringFor(base, mkPlayer([W(1), W(2), W(3), W(4), W(5), W(6), W(7), W(8), W(9), W(1), W(1), W(1), W(2), W(2)]), ctx(true)).total,
  F.pinghu + F.qingyise + F.gen + F.zimo);

console.log('--- ⑥ 幺九：带幺九 / 断幺九 ---');
{
  // 123万 789万 111条 999筒 + 11筒（每副面子与将牌都含 1 或 9）
  const p = mkPlayer([W(1), W(2), W(3), W(7), W(8), W(9), T(1), T(1), T(1), B(9), B(9), B(9), B(1), B(1)]);
  check('带幺九', scoringFor(base, p, ctx(false)).total, F.pinghu + F.daiyaojiu);
  checkBool('  └ 默认不计断幺九', scoringFor(base, p, ctx(false)).fanKeys.indexOf('duanyao') < 0, true);
}
{
  // 2 碰 + 全中张（无 1/9）
  const p = mkPlayer([T(2), T(2), T(2), B(3), B(3), B(3), B(8), B(8)], [pong(W(5)), pong(W(6))]);
  check('断幺九默认关闭（仅大对子档）', scoringFor(base, p, ctx(false)).total, F.pengpeng);
  check('断幺九开启后 +1', scoringFor(withDuanYao, p, ctx(false)).total, F.pengpeng + 1);
}

console.log('--- ⑦ 情境番 ---');
check('自摸 +1', scoringFor(base, mkPlayer([W(1), W(2), W(3), W(4), W(5), W(6), W(7), W(8), W(9), T(1), T(2), T(3), T(5), T(5)]), ctx(true)).total, F.pinghu + F.zimo);
check('抢杠胡 +1', scoringFor(base, mkPlayer([W(1), W(2), W(3), W(4), W(5), W(6), W(7), W(8), W(9), T(1), T(2), T(3), T(5), T(5)]), ctx(false, { robbingKong: true })).total, F.pinghu + F.qianggang);
check('海底 +1', scoringFor(base, mkPlayer([W(1), W(2), W(3), W(4), W(5), W(6), W(7), W(8), W(9), T(1), T(2), T(3), T(5), T(5)]), ctx(false, { lastTile: true })).total, F.pinghu + F.haidi);

console.log('--- ⑧ 根 / 封顶 ---');
{
  const p = mkPlayer([W(1), W(1), W(1), W(1), W(2), W(2), W(2), W(3), W(3), W(3), B(5), B(5), B(5), B(6), B(6)]);
  const c = p.hand.slice() as Counts;
  c[W(1)] = 4; c[W(2)] = 3; c[W(3)] = 3; c[B(5)] = 3; c[B(6)] = 2;
  check('根数（1 个 4 张）', countRoots({ ...p, hand: c }), 1);
}
{
  const capped: ScoringConfig = { ...defaultScoring, rules: { ...defaultScoring.rules, cap: 8 } };
  const r = scoringFor({ config: capped }, mkPlayer([W(1), W(1), W(1), W(1), W(2), W(2), W(3), W(3), W(4), W(4), W(5), W(5), W(6), W(6)]), ctx(false));
  check('封顶（清龙七对 32 → cap 8）', r.total, 8);
}
checkBool('isFlush 判清一色', isFlush(mkPlayer([W(1), W(2), W(3)])), true);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
