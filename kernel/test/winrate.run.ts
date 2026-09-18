/* 难度与胜率体检 —— 用**真正会上线的三档 bot**（easy/normal/hard）实测
 *
 * A. 公平性：四家同档时，各座位胜率是否一致
 * B. 难度矩阵：人类档位 × 对手档位 → 人类胜率
 * C. 分数与节奏：各档的平均番 / 平均净分 / 流局率（验证 settle.ts 的分数结算）
 * D. 同档公平：各档位下四家胜率是否均衡
 *
 * 运行：node --experimental-strip-types test/winrate.run.ts [N] [fair|matrix|all]
 * 说明：逐局固定种子，各档位跑**同一副牌**（配对比较），消除牌运噪声。
 */
import { simulateGameOpts, type Difficulty } from '../src/bot.ts';
import { SEATS } from '../src/flow.ts';

const N = Number(process.argv[2] || 400);
const MODE = process.argv[3] || 'all';
const SEED0 = 100003;

interface Stat {
  label: string;
  human: number;
  seats: number[];
  avgWin: number;
  humanFan: number;
  humanNet: number;
  winRate3: number;
  maxFan: number;
}

function stats(diffs: Difficulty[], n: number, label: string): Stat {
  const wins = [0, 0, 0, 0];
  let humanWon = 0, winners = 0, rounds = 0, fanSum = 0, fanCnt = 0, netSum = 0, three = 0, maxFan = 0;
  for (let i = 0; i < n; i++) {
    const { state, result } = simulateGameOpts({ seed: SEED0 + i, diffs });
    rounds++;
    let w = 0;
    for (const s of SEATS) if (state.players[s].won) { wins[s]++; w++; }
    winners += w;
    if (state.players[0].won) humanWon++;
    const f = state.players[0].winInfo?.fans.total ?? 0;
    if (f > 0) { fanSum += f; fanCnt++; }
    if (f > maxFan) maxFan = f;
    netSum += result.netBySeat[0];
    if (result.reason === 'threeWins') three++;
  }
  return {
    label,
    human: humanWon / rounds * 100,
    seats: wins.map((x) => x / rounds * 100),
    avgWin: winners / rounds,
    humanFan: fanCnt ? fanSum / fanCnt : 0,
    humanNet: netSum / rounds,
    winRate3: three / rounds * 100,
    maxFan,
  };
}

const f1 = (x: number) => x.toFixed(1);
const NAME: Record<Difficulty, string> = { easy: '新手', normal: '标准', hard: '困难' };
const ALL: Difficulty[] = ['easy', 'normal', 'hard'];

console.log(`=== A. 座位公平性（四家同为标准档，${N} 局，同副牌配对）===`);
{
  const a = stats(['normal', 'normal', 'normal', 'normal'], N, 'all-normal');
  console.log(`  座0(你) ${f1(a.human)}%  |  各座 ${a.seats.map(f1).join(' / ')}%  |  平均赢家/局 ${a.avgWin.toFixed(2)}`);
  console.log(`  座位极差 ${f1(Math.max(...a.seats) - Math.min(...a.seats))} 个百分点（2σ≈${f1(2 * Math.sqrt(0.25 / N) * 100)}）`);
  console.log(`  3 家胡完的比例 ${f1(a.winRate3)}%（其余为流局）  |  最高番 ${a.maxFan}`);
}

if (MODE !== 'fair') {
  console.log(`\n=== B. 难度矩阵：人类胜率（每格 ${N} 局）===`);
  console.log('                     对手=新手   对手=标准   对手=困难');
  for (const h of ALL) {
    const row: string[] = [];
    for (const b of ALL) {
      const r = stats([h, b, b, b], N, `${h}-vs-${b}`);
      row.push((f1(r.human) + '%').padStart(11));
    }
    console.log(NAME[h].padEnd(20) + row.join(' '));
  }

  console.log(`\n=== C. 分数与节奏（人类档位视角，对手=标准，${N} 局）===`);
  for (const h of ALL) {
    const r = stats([h, 'normal', 'normal', 'normal'], N, h);
    console.log(`  人类=${NAME[h]}  胜率 ${f1(r.human)}%  平均番 ${r.humanFan.toFixed(2)}  平均净分 ${r.humanNet >= 0 ? '+' : ''}${r.humanNet.toFixed(1)}`);
  }

  console.log(`\n=== D. 同档公平（各档位下四家胜率）===`);
  for (const d of ALL) {
    const r = stats([d, d, d, d], N, d);
    console.log(`  全${NAME[d]}档  各座 ${r.seats.map(f1).join(' / ')}%  平均赢家/局 ${r.avgWin.toFixed(2)}  3家胡完 ${f1(r.winRate3)}%  最高番 ${r.maxFan}`);
  }
}
