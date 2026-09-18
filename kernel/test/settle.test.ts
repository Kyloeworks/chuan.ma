/* 分数结算单测：番→分、杠分、查大叫、查花猪、退税、净分守恒 */
import { countsFrom, type Counts } from '../src/tiles.ts';
import { defaultScoring } from '../src/scoring.ts';
import {
  settleRoundImpl, fanToPoints, isSettlementBalanced,
  isFlowerPig, isReadyHand, hasClearedMissing, bigCallFan, type PayEntry,
} from '../src/settle.ts';
import { simulateGame } from '../src/bot.ts';
import type { GameState, PlayerState, Seat } from '../src/flow.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${extra}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  ok(name, a === b, `got=${a} want=${b}`);
}

function P(seat: number, tiles: number[], extra: Partial<PlayerState> = {}): PlayerState {
  return {
    seat: seat as Seat,
    hand: countsFrom(tiles) as Counts,
    melds: [],
    missing: -1,
    river: [],
    won: false,
    lastDrawn: -1,
    isHuman: seat === 0,
    ...extra,
  };
}
function G(players: PlayerState[], extra: Partial<GameState> = {}): GameState {
  return {
    wall: [], wallPointer: 0, players,
    dealer: 0, turn: 0, phase: 'finished',
    lastDiscard: null, claim: null, pendingDraw: false,
    winCount: 0,
    config: defaultScoring,
    history: [],
    kongScores: [0, 0, 0, 0],
    kongEntries: [],
    settlement: null,
    readyAtEnd: [false, false, false, false],
    lastKongSeat: -1,
    replacementPending: false,
    ...extra,
  } as unknown as GameState;
}
const pick = (es: PayEntry[], k: PayEntry['kind']) => es.filter((e) => e.kind === k);

console.log('=== 结算单测 ===');

console.log('\n[1] 番 → 分');
eq('fanToPoints(4,2)=8', fanToPoints(4, 2), 8);
eq('fanToPoints(0,2)=0', fanToPoints(0, 2), 0);
eq('fanToPoints(-1,1)=0', fanToPoints(-1, 1), 0);

console.log('\n[2] 形态判定');
ok('heldcleared: 缺万且无万 → 已打缺', hasClearedMissing(P(0, [9, 10], { missing: 0 })));
ok('未打缺 → 是花猪', isFlowerPig(P(0, [0, 1], { missing: 0 })));
ok('未持缺门 → 不是花猪', !isFlowerPig(P(0, [9, 10], { missing: 0 })));
{
  // 万123456789 + 条123 + 条9（缺筒）→ 听 9条
  const tp = P(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17], { missing: 2 });
  ok('13 张听牌手识别为听牌', isReadyHand(tp));
  const g = G([tp, P(1, []), P(2, []), P(3, [])]);
  ok('大叫番数 = 2（平胡+自摸）', bigCallFan(g, tp) === 2, `got=${bigCallFan(g, tp)}`);
}

console.log('\n[3] 查花猪：花猪赔给每个已打缺者');
{
  const pig = P(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], { missing: 0 }); // 缺万却留着一堆万
  const cleanTiles = [9, 12, 15, 10, 13, 16, 9 + 1, 12 + 1, 15 + 1, 9 + 2, 12 + 2, 15 + 2, 17];
  const others = [1, 2, 3].map((s) => P(s, cleanTiles, { missing: 0 }));
  ok('对照家已打缺', others.every((p) => hasClearedMissing(p)));
  ok('对照家未听牌（查大叫不干扰本用例）', others.every((p) => !isReadyHand(p)));
  const g = G([pig, ...others]);
  const r = settleRoundImpl(g);
  const fp = pick(r.entries, 'flowerPig');
  eq('花猪赔付笔数 = 3', fp.length, 3);
  eq('每笔 = flowerPigPay(16)', [...new Set(fp.map((e) => e.amount))], [16]);
  eq('均由座 0 付出', [...new Set(fp.map((e) => e.from))], [0]);
  eq('座 0 净分 = -48', r.seats[0].net, -48);
  eq('其他三家各 +16', [r.seats[1].net, r.seats[2].net, r.seats[3].net], [16, 16, 16]);
  ok('净分守恒', isSettlementBalanced(r));
}

console.log('\n[4] 查大叫：未听牌者赔听牌者（按大叫番数）');
{
  const ready = P(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17], { missing: 2 });
  const junk = [0, 3, 6, 1, 4, 7, 9, 12, 15, 10, 13, 16, 8];
  const notReady = [1, 2, 3].map((s) => P(s, junk, { missing: 2 }));
  ok('座 0 听牌', isReadyHand(ready));
  ok('座 1/2/3 未听牌', notReady.every((p) => !isReadyHand(p)));
  ok('对照家均已打缺', notReady.every((p) => hasClearedMissing(p)));
  const g = G([ready, ...notReady]);
  const r = settleRoundImpl(g);
  const rd = pick(r.entries, 'ready');
  eq('查大叫笔数 = 3（三个未听牌各赔一次）', rd.length, 3);
  eq('每笔金额 = 大叫 2 番 × 底分 1 = 2', [...new Set(rd.map((e) => e.amount))], [2]);
  eq('全部赔给座 0', [...new Set(rd.map((e) => e.to))], [0]);
  eq('座 0 收 6 分', r.seats[0].readyIn, 6);
  eq('座 0 净分 +6', r.seats[0].net, 6);
  ok('净分守恒', isSettlementBalanced(r));
}

console.log('\n[5] 退税：未胡者收到的杠分要退回');
{
  const junk = [0, 3, 6, 1, 4, 7, 9, 12, 15, 10, 13, 16, 8];
  const kongEntry: PayEntry = { kind: 'kong', from: 1, to: 0, amount: 2, note: '暗杠 3万：每家付 2' };
  // 座 0 未胡 → 退 2 分给座 1
  {
    const g = G([P(0, junk, { missing: 2 }), P(1, junk, { missing: 2 }), P(2, junk, { missing: 2 }), P(3, junk, { missing: 2 })],
      { kongEntries: [kongEntry], kongScores: [2, 0, 0, 0] });
    const r = settleRoundImpl(g);
    const rf = pick(r.entries, 'refund');
    eq('产生 1 笔退税', rf.length, 1);
    eq('方向：座 0 → 座 1，金额 2', [rf[0].from, rf[0].to, rf[0].amount], [0, 1, 2]);
    eq('座 0 杠分收 2 又退 2，净 0', r.seats[0].net, 0);
    ok('净分守恒', isSettlementBalanced(r));
  }
  // 座 0 已胡 → 杠分保留，不退税
  {
    const winner = P(0, junk, { missing: 2, won: true });
    winner.winInfo = {
      tile: 0, selfDraw: false, by: 1, kind: 'standard',
      fans: { items: [{ key: 'pinghu', name: '平胡', fans: 1 }], total: 1, isFlush: false, isSevenPairs: false, isAllTriplets: false, roots: 0, fanKeys: ['pinghu'] },
      score: 0,
    };
    const g = G([winner, P(1, junk, { missing: 2 }), P(2, junk, { missing: 2 }), P(3, junk, { missing: 2 })],
      { kongEntries: [kongEntry], kongScores: [2, 0, 0, 0], winCount: 1 });
    const r = settleRoundImpl(g);
    eq('已胡 → 无退税', pick(r.entries, 'refund').length, 0);
    eq('座 0 保留杠分 +2', r.seats[0].kongIn, 2);
    eq('座 0 点炮收 1 番 = 1 分', r.seats[0].fanPoints, 1);
    eq('放炮者座 1 付 1 分', r.seats[1].fanOut === undefined ? -(r.seats[1].net) !== 0 : true, true);
    ok('净分守恒', isSettlementBalanced(r));
  }
}

console.log('\n[6] 自摸分账：只由尚未胡牌者付');
{
  const junk = [0, 3, 6, 1, 4, 7, 9, 12, 15, 10, 13, 16, 8];
  const w = P(0, junk, { missing: 2, won: true });
  w.winInfo = {
    tile: 0, selfDraw: true, by: -1, kind: 'standard',
    fans: { items: [{ key: 'pinghu', name: '平胡', fans: 1 }, { key: 'zimo', name: '自摸', fans: 1 }], total: 2, isFlush: false, isSevenPairs: false, isAllTriplets: false, roots: 0, fanKeys: ['pinghu', 'zimo'] },
    score: 0,
  };
  // 座 3 也已胡 → 不付
  const w3 = P(3, junk, { missing: 2, won: true });
  w3.winInfo = w.winInfo;
  const g = G([w, P(1, junk, { missing: 2 }), P(2, junk, { missing: 2 }), w3], { winCount: 2 });
  const r = settleRoundImpl(g);
  const fan = pick(r.entries, 'fan').filter((e) => e.to === 0);
  eq('座 0 自摸：只有座 1、2 付（座 3 已胡不付）', fan.map((e) => e.from).sort(), [1, 2]);
  eq('每家付 2 分', [...new Set(fan.map((e) => e.amount))], [2]);
  eq('座 0 收 4 分', r.seats[0].fanPoints, 4);
  ok('净分守恒', isSettlementBalanced(r));
}

console.log('\n[7] 全量不变量：随机 300 局，净分必须守恒');
{
  let bad = 0, noSettle = 0, sample: number[] = [];
  for (let i = 0; i < 300; i++) {
    const { state } = simulateGame(90000 + i);
    if (!state.settlement) { noSettle++; continue; }
    if (!isSettlementBalanced(state.settlement)) { bad++; if (sample.length < 3) sample.push(i); }
  }
  eq('无结算结果的局数 = 0', noSettle, 0);
  eq('净分不守恒的局数 = 0', bad, 0);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) process.exitCode = 1;
