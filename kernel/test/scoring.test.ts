/**
 * 番种结算 + 定缺 定向单测
 * 用法：node --experimental-strip-types test/scoring.test.ts
 */
import { TILE_KINDS, tileId, type Counts } from '../src/tiles.ts';
import { defaultScoring, scoringFor, countRoots, isFlush } from '../src/scoring.ts';
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

function mkPlayer(handTiles: number[], melds: Meld[] = []): PlayerState {
  const hand: Counts = new Array(TILE_KINDS).fill(0);
  for (const t of handTiles) hand[t]++;
  return { seat: 0 as Seat, hand, melds, missing: -1, river: [], won: false, lastDrawn: -1, isHuman: false };
}
const W = (r: number) => tileId(0, r); // 万 1-9
const T = (r: number) => tileId(1, r); // 条 1-9
const B = (r: number) => tileId(2, r); // 筒 1-9
const ctx = (selfDraw: boolean, lastTile = false): any => ({ selfDraw, by: -1, tile: 0, kongReplacement: false, afterKongDiscard: false, lastTile });
const base = { config: defaultScoring };

console.log('--- 番种判定 ---');
// 1. 平胡：123 456 789 万 + 123 条 + 55 条（14 张，含顺子，两门）
check('平胡', scoringFor(base, mkPlayer([W(1), W(2), W(3), W(4), W(5), W(6), W(7), W(8), W(9), T(1), T(2), T(3), T(5), T(5)]), ctx(false)).total, defaultScoring.fan.pinghu);

// 2. 碰碰胡：111 222 333 万 + 444 筒 + 55 筒
check('碰碰胡', scoringFor(base, mkPlayer([W(1), W(1), W(1), W(2), W(2), W(2), W(3), W(3), W(3), B(4), B(4), B(4), B(5), B(5)]), ctx(false)).total, defaultScoring.fan.pinghu + defaultScoring.fan.pengpeng);

// 3. 清一色：123 456 789 123 万 + 99 万（全万，纯顺子，非七对）
check('清一色', scoringFor(base, mkPlayer([W(1), W(2), W(3), W(4), W(5), W(6), W(7), W(8), W(9), W(1), W(2), W(3), W(9), W(9)]), ctx(false)).total, defaultScoring.fan.pinghu + defaultScoring.fan.qingyise);

// 4. 七对：7 个对子（多门）
check('七对', scoringFor(base, mkPlayer([W(1), W(1), W(2), W(2), W(3), W(3), T(4), T(4), T(5), T(5), B(6), B(6), B(7), B(7)]), ctx(false)).total, defaultScoring.fan.qidui);

// 5. 龙七对：含 4 张相同（龙七对本身含根 → qidui+longqidui+gen）
check('龙七对', scoringFor(base, mkPlayer([W(1), W(1), W(1), W(1), W(2), W(2), T(3), T(3), T(4), T(4), B(5), B(5), B(6), B(6)]), ctx(false)).total, defaultScoring.fan.qidui + defaultScoring.fan.longqidui + defaultScoring.fan.gen);

// 6. 自摸 +1（清一色手牌含 W1×4，即根，故 +清一色+根+自摸）
check('清一色+自摸', scoringFor(base, mkPlayer([W(1), W(2), W(3), W(4), W(5), W(6), W(7), W(8), W(9), W(1), W(1), W(1), W(2), W(2)]), ctx(true)).total, defaultScoring.fan.pinghu + defaultScoring.fan.qingyise + defaultScoring.fan.gen + defaultScoring.fan.zimo);

// 7. 根：手牌含 4 张相同（万1×4）+ 碰碰胡其余
{
  const p = mkPlayer([W(1), W(1), W(1), W(1), W(2), W(2), W(2), W(3), W(3), W(3), B(5), B(5), B(5), B(6), B(6)]);
  // 注：该手牌 15 张（4+3+3+3+2=15）不成标准 14，这里只验根数
  const r = countRoots({ ...p, hand: (() => { const c = p.hand.slice(); c[W(1)] = 4; c[W(2)] = 3; c[W(3)] = 3; c[B(5)] = 3; c[B(6)] = 2; return c; })() });
  check('根数(1个4张)', r, 1);
}

// 8. 清一色 + 碰碰胡 + 根（4张万1）组合（构造合法 14 张）
{
  // 1111 万(根) 222 万 333 万 + 444 万 + 55 万 —— 全万，4 副 + 将
  const hand = [W(1), W(1), W(1), W(1), W(2), W(2), W(2), W(3), W(3), W(3), W(4), W(4), W(4), W(5), W(5)];
  // 15 张，去掉一个 5 变 14：用 1111 222 333 444 万 + 55 万 = 4+3+3+3+2=15 仍多1
  // 改为 111 222 333 444 万 + 11 万（将）= 3+3+3+3+2 = 14，但无 4 张。为测根换 kong meld。
  const p = mkPlayer([W(2), W(2), W(2), W(3), W(3), W(3), W(4), W(4), W(4), W(5), W(5)], [
    { type: 'kong', tile: W(1), concealed: true, added: false, from: -1 as Seat },
  ]);
  const res = scoringFor(base, p, ctx(false));
  // 期望：清一色(4) + 碰碰胡(2) + 根(1) + 平胡(1) = 8
  check('清一色+碰碰胡+根', res.total, defaultScoring.fan.pinghu + defaultScoring.fan.pengpeng + defaultScoring.fan.qingyise + defaultScoring.fan.gen);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
