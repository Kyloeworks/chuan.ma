/**
 * 临时复现脚本：UI（pixi-table.js pump）在「摸到牌墙最后一张」后就立即结算，
 * 该家于是以 14 张手牌进入查叫判定 —— 而所有听牌判定都假设标准张数 13-3*melds。
 * 用法：node --experimental-strip-types kernel/test/_repro_ready.ts [局数]
 */
import { TILE_KINDS, type Counts } from '../src/tiles.ts';
import {
  SEATS, type Seat, type GameState, type PlayerState,
  createGame, declareMissing, draw, discard, settleRound, isGameOver,
  applyPong, applyKong, applyConcealedKong, applyAddedKong,
  applySelfWin, applyRon, passClaim, canSelfWin, defaultRules,
} from '../src/flow.ts';
import { defaultScoring } from '../src/scoring.ts';
import {
  botMissingSuit, botDiscardTile, botShouldPong, botConcealedKongTile, botAddedKongTile,
} from '../src/bot.ts';
import { shanten } from '../src/shanten.ts';

const N = Number(process.argv[2] ?? 300);
const VERBOSE = process.argv[3] === 'v';

function makeRng(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function handTotal(c: Counts) { let n = 0; for (let i = 0; i < TILE_KINDS; i++) n += c[i]; return n; }

/** 真值：该家此刻是否下叫（对手牌张数归一化） */
function trulyReady(p: PlayerState, expected: number): boolean {
  const total = handTotal(p.hand);
  if (total === expected) return shanten(p.hand, p.melds.length) === 0;
  if (total === expected + 1) return shanten(p.hand, p.melds.length) <= 0; // 14 张：打一张即可听/已和
  return false;
}

function botActAfterDraw(g: GameState, seat: Seat) {
  const p = g.players[seat];
  if (canSelfWin(p, p.melds.length)) { applySelfWin(g, seat); return; }
  const ck = botConcealedKongTile(g, seat); if (ck >= 0) { applyConcealedKong(g, seat, ck); return; }
  const ak = botAddedKongTile(g, seat); if (ak >= 0) { applyAddedKong(g, seat, ak); return; }
  discard(g, seat, botDiscardTile(g, seat));
}

/** 完全按 UI punch 逻辑推进；earlySettle=true 时模拟当前 UI（摸牌后立刻判 isGameOver） */
function runUiStyle(seed: number, earlySettle: boolean): GameState {
  const g = createGame(0, defaultRules, defaultScoring, makeRng(seed));
  while (g.phase === 'declareMissing') {
    for (const s of SEATS) if (g.players[s].missing === -1) declareMissing(g, s, botMissingSuit(g, s));
  }
  let guard = 0;
  while (guard++ < 200000) {
    if (g.phase === 'finished') return g;
    if (g.claim) {
      const c = g.claim;
      if (c.ron.length) { applyRon(g, c.ron[0]); continue; }
      if (c.kong.length) { applyKong(g, c.kong[0]); continue; }
      if (c.pong.length && botShouldPong(g, c.pong[0])) { applyPong(g, c.pong[0]); continue; }
      passClaim(g); continue;
    }
    const seat = g.turn as Seat;
    const p = g.players[seat];
    if (g.pendingDraw) {
      if (!draw(g, seat)) { settleRound(g); return g; }
      if (earlySettle && isGameOver(g)) { settleRound(g); return g; }  // ← UI 行为
      botActAfterDraw(g, seat);
      continue;
    }
    if (canSelfWin(p, p.melds.length)) { applySelfWin(g, seat); continue; }
    discard(g, seat, botDiscardTile(g, seat));
  }
  return g;
}

function audit(label: string, earlySettle: boolean) {
  let wallEmpty = 0, stray14 = 0, misjudged = 0, payoutWrong = 0;
  let sample = 0;
  for (let i = 0; i < N; i++) {
    const seed = 1000 + i;
    const g = runUiStyle(seed, earlySettle);
    if (g.settlement?.reason === 'wallEmpty') wallEmpty++;
    for (const s of SEATS) {
      const p = g.players[s];
      if (p.won) continue;
      const expected = 13 - 3 * p.melds.length;
      if (handTotal(p.hand) !== expected + 1) continue;
      stray14++;
      const truth = trulyReady(p, expected);
      const rep = g.readyAtEnd[s];
      const pay = g.settlement?.seats[s].isReady ?? false;
      if (truth && !rep) misjudged++;
      if (truth && !pay) payoutWrong++;
      if (VERBOSE && truth && sample++ < 6) {
        console.log(`  seed ${seed} seat ${s}: 结算手握 ${handTotal(p.hand)} 张（标准 ${expected}）· 真值听牌 ${truth} · readyAtEnd ${rep} · 结算表 ${pay}`);
      }
    }
  }
  console.log(`\n=== ${label}（${N} 局）===`);
  console.log(`流局（牌墙摸完）:                ${wallEmpty}`);
  console.log(`结算时手握「标准张数+1」的家数:  ${stray14}`);
  console.log(`  ├ 真值听牌/已和却判「未下叫」: ${misjudged}`);
  console.log(`  └ 结算席位表同样判错:          ${payoutWrong}`);
  return { wallEmpty, stray14, misjudged, payoutWrong };
}

const before = audit('当前 UI 逻辑（摸牌后立刻 isGameOver → 结算）', true);
const after = audit('去掉摸牌后的提前结算（仅摸不到牌才结束）', false);

console.log(`\n结论：修复前每局约有 ${(before.stray14 / N).toFixed(2)} 家被误判为未下叫；修复后为 ${(after.stray14 / N).toFixed(2)}`);
