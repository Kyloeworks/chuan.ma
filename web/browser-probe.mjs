/** 用真实 Chrome（CDP）验证 Pixi 2.5D 牌桌：
 *  初始化 + 布局不变量（不越界/不重叠）+ 手牌「摸牌分离」+ 动效确实执行 + 交互全链路 + 截图。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.resolve(here, 'dist/play.html');
const shot = process.argv[3] || '';
const geomPath = process.argv[4] || '';
const url = 'file:///' + target.replace(/\\/g, '/');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333 + Math.floor(Math.random() * 300);
const ud = mkdtempSync(path.join(tmpdir(), 'cmc-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${ud}`, url,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function pageTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const j = await r.json();
      const t = j.find((x) => x.type === 'page' && x.url.startsWith('file'));
      if (t && t.webSocketDebuggerUrl) return t;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('no page target');
}

let ws, seq = 0;
const pending = new Map();
function cmd(method, params) {
  return new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expression) {
  const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
  const rr = r.result && r.result.result;
  return rr ? rr.value : undefined;
}

/** 页面内执行的布局体检 */
const AUDIT = `(function(){
  var D = window.__PIXI_TABLE__ || {};
  var L = D.layout; if (!L) return { err: 'no layout' };
  var out = { W: L.W, H: L.H, overflow: L.overflow, overlaps: [], boxes: {} };
  var bx = {};
  L.boxes.forEach(function(b){ bx[b.name] = b; out.boxes[b.name] = [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)]; });
  var names = Object.keys(bx);
  function hit(a,b){ return !(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5); }
  for (var i=0;i<names.length;i++) for (var j=i+1;j<names.length;j++){
    var a = bx[names[i]], b = bx[names[j]];
    if (hit(a,b)) out.overlaps.push(names[i] + ' x ' + names[j]);
  }
  out.rows = L.rows; out.handTiles = L.handTiles;
  out.rots = L.rots; out.sepAtEnd = L.sepAtEnd;
  out.rivers = L.rivers; out.draws = L.draws; out.phase = L.phase;
  out.teach = L.teach; out.diff = L.diff; out.netBySeat = L.netBySeat;
  out.idle = !!L.idle; out.dealer = L.dealer; out.turn = L.turn;
  out.firstDraw = L.firstDraw; out.actions = L.actions; out.winReady = L.winReady;
  out.handH = L.handH; out.riverH = L.riverH;
  return out;
})()`;

let pass = false, detail = '', checks = [], shotTrace = '';
const ck = (name, ok, extra) => checks.push(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);

try {
  const t = await pageTarget();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text);
    if (m.method === 'Runtime.exceptionThrown') errors.push('exc: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description));
  };
  await cmd('Runtime.enable', {});
  await cmd('Log.enable', {});
  await cmd('Page.enable', {});
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false });

  let st = '';
  for (let i = 0; i < 120; i++) {
    st = await ev("window.__PIXI_TABLE__ ? JSON.stringify(window.__PIXI_TABLE__) : 'pending'");
    if (st && (st.indexOf('"ready":true') >= 0 || st.indexOf('error') >= 0)) break;
    await sleep(200);
  }
  const ready = st.indexOf('"ready":true') >= 0;
  const diag0 = await ev("document.getElementById('diag').textContent");
  const canvas = await ev("(function(){var c=document.querySelector('#stage canvas');return c?(c.width+'x'+c.height):'no-canvas';})()");

  ck('Pixi 初始化 ready', ready, st ? st.slice(0, 120) : '');
  ck('画布已创建', canvas !== 'no-canvas', canvas);
  ck('纹理全部生成（28）', /28 /.test(diag0 || ''), diag0);

  // ── ★ 开局流程：打开后绝不自动发牌，必须先过「开局设置」 ──
  const idle = await ev(AUDIT);
  ck('打开后停在「开局设置」，未自动发牌', idle && idle.idle === true, 'idle=' + (idle && idle.idle));
  const setupShown = await ev("(function(){var o=document.getElementById('overlay');return o.className.indexOf('show')>=0 && !!document.getElementById('startGameBtn');})()");
  ck('开局设置弹层可见（含「开始对局」按钮）', setupShown === true);
  const fxIdle = await ev("JSON.stringify(window.__PIXI_TABLE__.fx)");
  ck('开局前零发牌动作（deals=0）', JSON.parse(fxIdle || '{}').deals === 0, fxIdle);
  const idleHstat = await ev("document.getElementById('hstat').textContent.trim()");
  ck('未开局时顶栏不显示牌局数据', idleHstat === '', 'hstat="' + idleHstat + '"');

  // 三个设置项都可点选并高亮
  await ev("(function(){var b=document.querySelector('#overlay .pill[data-k=\"diff\"][data-v=\"hard\"]');if(b)b.click();})()");
  await ev("(function(){var b=document.querySelector('#overlay .pill[data-k=\"dealer\"][data-v=\"2\"]');if(b)b.click();})()");
  await ev("(function(){var b=document.querySelector('#overlay .pill[data-k=\"teach\"][data-v=\"1\"]');if(b)b.click();})()");
  await sleep(260);
  const chosen = await ev("JSON.stringify(Array.from(document.querySelectorAll('#overlay .pill.on')).map(function(e){return e.dataset.k+'='+e.dataset.v;}))");
  ck('难度 / 起手位 / 教学提示可选且高亮', /diff=hard/.test(chosen) && /dealer=2/.test(chosen) && /teach=1/.test(chosen), chosen);

  // 点「开始对局」之后才发牌
  await ev("(function(){document.getElementById('startGameBtn').click();})()");
  await sleep(360);
  const fx0 = await ev("JSON.stringify(window.__PIXI_TABLE__.fx)");
  ck('点「开始对局」后才触发发牌（deals>=1, flights>=52）',
    /"deals":\d/.test(fx0) && JSON.parse(fx0).deals >= 1 && JSON.parse(fx0).flights >= 52, fx0);
  await sleep(2000);

  // 定缺（第一次：验证「谁先起手」真的生效）
  await ev("(function(){var m=document.querySelectorAll('.mp');var r=document.querySelector('.mp.recommend')||m[0];if(r)r.click();})()");
  await sleep(900);
  const aDealer = await ev(AUDIT);
  ck('起手位选择已生效（庄 = 下家 / 座 2）', aDealer && aDealer.dealer === 2, 'dealer=' + (aDealer && aDealer.dealer));
  ck('起手位生效：第一张被摸走的牌属于所选庄家（座 2 先摸）',
    aDealer && aDealer.firstDraw === 2, 'firstDraw=' + (aDealer && aDealer.firstDraw) + ' wallPointer=' + (aDealer && aDealer.draws) + '（你先起手时 firstDraw=0）');

  // 回开局设置，改回「你」先起手，供后续 14 张布局断言使用
  await ev("(function(){document.getElementById('newBtn').click();})()");
  await sleep(300);
  const backSetup = await ev("(function(){return !!(document.getElementById('startGameBtn') && document.getElementById('overlay').className.indexOf('show')>=0);})()");
  ck('「新开一局」回到开局设置（不直接发牌）', backSetup === true);
  await ev("(function(){var b=document.querySelector('#overlay .pill[data-k=\"dealer\"][data-v=\"0\"]');if(b)b.click();})()");
  await ev("(function(){document.getElementById('startGameBtn').click();})()");
  await sleep(2500);
  await ev("(function(){var m=document.querySelectorAll('.mp');var r=document.querySelector('.mp.recommend')||m[0];if(r)r.click();})()");
  await sleep(1000);
  const inTable = await ev("!!document.querySelector('#stage canvas') && document.getElementById('overlay').className.indexOf('show')<0");
  ck('定缺后进入牌桌', !!inTable);

  // 布局体检
  const audit = await ev(AUDIT);
  ck('布局体检可读', audit && !audit.err, audit && audit.err ? audit.err : '');
  if (audit && !audit.err) {
    ck('所有元素在屏内（overflow=0）', audit.overflow === 0, 'overflow=' + audit.overflow);
    ck('关键区域无重叠', audit.overlaps.length === 0, audit.overlaps.join(' / ') || 'none');
    const handMe = audit.handTiles[0];
    ck('你方手牌：13 张主体 + 1 张单独排开（刚摸的牌）', handMe.main === 13 && handMe.sep === 1, JSON.stringify(handMe));
    ck('刚摸的牌排在「右手边」', audit.sepAtEnd[0] === true, 'sepAtEnd=' + JSON.stringify(audit.sepAtEnd));
    ck('四家朝向 = 下0° / 右-90° / 上180° / 左90°', JSON.stringify(audit.rots) === '[0,-90,180,90]', JSON.stringify(audit.rots));
    const opp = audit.handTiles.slice(1);
    ck('三家对手手牌均为 13 张', opp.every((h) => h.main + h.sep === 13), JSON.stringify(opp));
    ck('牌河行数 ≤ 2', audit.rows.every((r) => r <= 2), JSON.stringify(audit.rows));
    ck('底部教学条已绘制', !!audit.boxes.strip, JSON.stringify(audit.boxes.strip));
    ck('教学条给出向听进度', audit.teach && typeof audit.teach.sh === 'number',
      JSON.stringify(audit.teach));
    ck('持缺门牌时提示「必须先打完」（而不是乱给推荐）', audit.teach && audit.teach.mustMiss === true && audit.teach.recTile === -1,
      JSON.stringify(audit.teach));
  }

  // 难度切换（B）：切到新手档，设置必须真正生效
  const dBefore = await ev("JSON.stringify(window.__PIXI_TABLE__.layout.diff)");
  await ev("(function(){var b=document.querySelector('#diffs .dbtn[data-d=\"easy\"]');if(b)b.click();})()");
  await sleep(400);
  const dAfter = await ev("JSON.stringify(window.__PIXI_TABLE__.layout.diff)");
  ck('难度切换到「新手」生效', dAfter === '"easy"', `${dBefore} → ${dAfter}`);
  await ev("(function(){var b=document.querySelector('#diffs .dbtn[data-d=\"normal\"]');if(b)b.click();})()");
  await sleep(300);

  // 确定性推进 ~40 个循环步（≈十几手）→ 人类已打完缺门，教学条应给出推荐与理由
  await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.advance(40)");
  await sleep(300);
  const auditT = await ev(AUDIT);
  if (auditT && !auditT.err) {
    const tt = auditT.teach;
    // 注意：advance(40) 可能正好切在「轮到我、但这一摸尚未执行」的回合边界（那一帧只有 13 张），
    // 所以此处只断言「已打完缺门 + 教学状态自洽」；「给出推荐牌 + 进张数」放在能稳定停在
    // 人类决策点的 stepToHumanWin 段（见下）里断言。
    ck('推进十几手后：缺门已打完（进入向听 / 下叫阶段）', tt && tt.mustMiss === false, JSON.stringify(tt));
    ck('教学状态自洽（向听数 / 已听牌+所听之牌 / 缺门 三选一）',
      tt && (tt.shEff > 0 || (tt.waitingKinds > 0 && tt.waitLeft > 0) || tt.mustMiss), JSON.stringify(tt));
    ck('教学状态不与「向听 0」自相矛盾', tt && !(tt.sh <= 0 && !tt.mustMiss && tt.waitingKinds === 0),
      JSON.stringify(tt));
  }

  // 演示模式：动作级节奏自动推进，期间应产生飞行牌轨迹 / 碰杠高光
  const logLen0 = await ev("document.getElementById('log').textContent.length");
  await ev("document.getElementById('demoBtn').click()");
  await sleep(9000);
  const mid = await ev("document.getElementById('hstat').textContent");
  const logLen1 = await ev("document.getElementById('log').textContent.length");
  const fx1 = await ev("JSON.stringify(window.__PIXI_TABLE__.fx)");
  const audit2 = await ev(AUDIT);
  await ev("document.getElementById('demoBtn').click()");
  await sleep(800);

  const F = JSON.parse(fx1 || '{}');
  ck('对局推进（日志增长）', logLen1 > logLen0, `${logLen0} → ${logLen1}`);
  ck('出牌轨迹动画已执行（flights 增长）', F.flights > 52, 'flights=' + F.flights);
  ck('碰/杠高光已触发', (F.rings || 0) > 0, 'rings=' + F.rings);
  if (audit2 && !audit2.err) {
    ck('対局中布局仍无越界', audit2.overflow === 0, 'overflow=' + audit2.overflow);
    ck('对局中牌河仍 ≤2 排', audit2.rows.every((r) => r <= 2), JSON.stringify(audit2.rows));
    const tt = audit2.teach;
    ck('对局推进后教学条仍自洽', !tt || tt.shEff > 0 || tt.waitingKinds > 0 || tt.mustMiss, JSON.stringify(tt));
  }

  // 走完整局 → 必出胡牌粒子 + 终局亮牌 + 结算弹层
  await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.runToEnd()");
  await sleep(3200);
  const fxWin = await ev("JSON.stringify(window.__PIXI_TABLE__.fx)");
  const FW = JSON.parse(fxWin || '{}');
  ck('整局跑完后出现胡牌粒子爆发（bursts>0）', (FW.bursts || 0) > 0, fxWin);
  const over = await ev("document.getElementById('overlay').className.indexOf('show')>=0");
  ck('终局结算弹层出现', over === true);
  const auditEnd = await ev(AUDIT);
  if (auditEnd && !auditEnd.err) {
    ck('终局亮牌后仍无越界', auditEnd.overflow === 0, 'overflow=' + auditEnd.overflow);
    ck('终局牌河仍 ≤2 排', auditEnd.rows.every((r) => r <= 2),
      `rows=${JSON.stringify(auditEnd.rows)} rivers=${JSON.stringify(auditEnd.rivers)} draws=${auditEnd.draws} phase=${auditEnd.phase}`);
    const net = auditEnd.netBySeat || [];
    ck('终局给出每家净分（分数结算已生效）', net.length === 4, JSON.stringify(net));
    ck('净分守恒（四家之和 = 0）', net.length === 4 && net.reduce((a, b) => a + b, 0) === 0, JSON.stringify(net));
  }
  await ev("(function(){var b=document.getElementById('closeRes');if(b)b.click();})()");
  await sleep(400);

  // 关键一问：在「真实 UI」里连打 N 局，人类到底能不能赢？（排除"内核能赢但界面不让赢"）
  const GAMES = 30;
  let humanWins = 0, seatWins = [0, 0, 0, 0], totWin = 0, humanFinalSh = [];
  for (let i = 0; i < GAMES; i++) {
    await ev("(function(){var b=document.getElementById('againBtn');if(b)b.click();})()");
    await sleep(90);
    await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.runToEnd()");
    await sleep(110);
    const o = JSON.parse((await ev("JSON.stringify(window.__PIXI_TABLE__.layout)")) || '{}');
    const w = o.won || [];
    if (o.humanWon) humanWins++;
    for (let s = 0; s < 4; s++) if (w[s]) seatWins[s]++;
    totWin += w.filter(Boolean).length;
  }
  const pct = (humanWins / GAMES * 100).toFixed(0);
  const seatPct = seatWins.map((x) => (x / GAMES * 100).toFixed(0) + '%').join(' / ');
  ck(`真实 UI 里人类能赢（${GAMES} 局赢 ${humanWins} 局）`, humanWins >= 3,
    `人类胜率≈${pct}%  各座 ${seatPct}  平均赢家/局=${(totWin / GAMES).toFixed(2)}`);
  ck('真实 UI 座位无明显偏向（人类不超过 3 倍优势）', seatWins[0] <= 3 * Math.max(1, (seatWins[1] + seatWins[2] + seatWins[3]) / 3),
    `seatWins=${JSON.stringify(seatWins)}`);

  // —— 胡牌必须由玩家点按钮，不能自动替玩家胡 ——
  await ev("(function(){var b=document.querySelector('#diffs .dbtn[data-d=\"normal\"]');if(b)b.click();})()");
  await sleep(150);
  let gotWin = false;
  for (let k = 0; k < 12 && !gotWin; k++) {
    // 每次都从「新的一局」开始：先把上一局收尾（若有），再开新局并定缺
    await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.runToEnd()");
    await sleep(160);
    await ev("(function(){var b=document.getElementById('againBtn');if(b)b.click();})()");
    await sleep(260);
    await ev("(function(){var r=document.querySelector('.mp.recommend')||document.querySelector('.mp');if(r)r.click();})()");
    await sleep(220);
    gotWin = (await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.stepToHumanWin()")) === true;
  }
  ck('能推进到「人类可以胡」的时点', gotWin === true, 'gotWin=' + gotWin);
  if (gotWin) {
    const Lw = JSON.parse((await ev("JSON.stringify(window.__PIXI_TABLE__.layout)")) || '{}');
    ck('到了可以胡的时点：牌局停住、没有自动替玩家胡',
      Lw.winReady === true && Lw.humanWon === false, `winReady=${Lw.winReady} humanWon=${Lw.humanWon}`);
    ck('牌桌给出了「胡」动作按钮', !!(Lw.actions && Lw.actions.win === true), JSON.stringify(Lw.actions || null));
    // 停下的位置有两种合法形态：①自摸可胡（轮到我、已摸牌）②别人点炮可胡（鸣牌待决）
    //  ①应给出「推荐打哪张 + 进张数」；②正确行为是不给弃牌推荐（此刻该决定的是胡不胡）
    if (Lw.teach && Lw.teach.myTurn) {
      ck('轮到我做决定时：教学条给出推荐牌 + 进张数（可解释的理由）',
        Lw.teach.recTile >= 0 && Lw.teach.recImprove > 0, JSON.stringify(Lw.teach));
    } else {
      ck('点炮可胡时不给弃牌推荐，而是给出「胡 / 过」待决按钮',
        !!(Lw.actions && Lw.actions.pass === true),
        `actions=${JSON.stringify(Lw.actions)} teach=${JSON.stringify(Lw.teach)}`);
    }
    await sleep(700);   // 静置，确认不会自己往前走
    const Lw2 = JSON.parse((await ev("JSON.stringify(window.__PIXI_TABLE__.layout)")) || '{}');
    ck('静置期间状态冻结（不会自动胡 / 自动出牌）',
      Lw2.humanWon === false && Lw2.winReady === true, `humanWon=${Lw2.humanWon} winReady=${Lw2.winReady}`);
    const BJ = JSON.parse((await ev(`(function(){
      var b=document.getElementById('aWin'); if(!b) return '{}';
      var ab=document.getElementById('actions');
      var bs=ab?[].slice.call(ab.querySelectorAll('button')):[];
      return JSON.stringify({ txt:b.textContent, huFs:parseFloat(getComputedStyle(b).fontSize),
        huH:Math.round(b.getBoundingClientRect().height), btnCount:bs.length,
        minFs: bs.length?Math.min.apply(null, bs.map(function(x){return parseFloat(getComputedStyle(x).fontSize)})):0,
        minH: bs.length?Math.min.apply(null, bs.map(function(x){return Math.round(x.getBoundingClientRect().height)})):0 });
    })()`)) || '{}');
    ck('「胡」按钮已渲染在牌桌上', !!BJ.txt && BJ.txt !== 'undefined' && BJ.btnCount >= 1, JSON.stringify(BJ));
    ck('碰/杠/胡等动作按钮已放大（字号≥18px、高度≥40px）',
      BJ.minFs >= 18 && BJ.minH >= 40, `minFontSize=${BJ.minFs} minHeight=${BJ.minH} huFontSize=${BJ.huFs}`);
    await ev("document.getElementById('aWin').click()");
    await sleep(500);
    const Lw3 = JSON.parse((await ev("JSON.stringify(window.__PIXI_TABLE__.layout)")) || '{}');
    ck('点了「胡」按钮才真的胡', Lw3.humanWon === true, `humanWon=${Lw3.humanWon} winCount=${Lw3.winCount}`);
    await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.runToEnd()");   // 收尾：把本局打完，恢复既有截图前置状态
    await sleep(300);
  }
  ck('全程零脚本错误', errors.length === 0, errors.slice(0, 3).join(' | ') || '无');

  if (shot && ready) {
    // 截一张「对局中」的图：新开一局 → 定缺 → 确定性推进十几步（牌河有牌、无结算遮罩、
    // 且手牌仍未被副露拆空 —— 让像素体检能稳定量到底部手牌）
    await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.dbgOn()");
    await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.runToEnd()");
    await sleep(200);
    await ev("(function(){var b=document.getElementById('againBtn');if(b)b.click();})()");
    await sleep(2300);
    await ev("(function(){var r=document.querySelector('.mp.recommend')||document.querySelector('.mp');if(r)r.click();})()");
    await sleep(900);
    // 逐帧采样牌形不变量（手牌 + 3×副露 + 杠 恒为 13/14）—— 抓「没摸牌就出牌」的抽干
    let minShape = 99, maxShape = 0, shapeLog = [];
    for (let i = 0; i < 30; i++) {
      await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.advance(1)");
      await sleep(35);
      const Ls = JSON.parse((await ev("JSON.stringify(window.__PIXI_TABLE__.layout)")) || '{}');
      if (typeof Ls.shape === 'number') {
        minShape = Math.min(minShape, Ls.shape); maxShape = Math.max(maxShape, Ls.shape);
        shapeLog.push(Ls.shape);
      }
    }
    ck('牌形不变量：人类「手牌 + 3×副露 + 杠」恒为 13/14（没摸牌就出牌的抽干会立刻暴露）',
      shapeLog.length >= 25 && minShape >= 13 && maxShape <= 14,
      `samples=${shapeLog.length} min=${minShape} max=${maxShape} log=${shapeLog.join(',')}`);
    await sleep(900);   // 等飞行牌/粒子这类补间收尾，避免截图抓到半空中的牌
    // 采样牌形不变量（诊断用；真正的一局跑在 dbg 里逐动作记录）
    const LA = JSON.parse((await ev("JSON.stringify(window.__PIXI_TABLE__.layout)")) || '{}');
    shotTrace = `\n  牌形: human=${LA.shape} all=${JSON.stringify(LA.shapes)}` +
      `\n  代打轨迹[ptr,待摸,鸣牌,牌形,turn,余牌,lastDrawn]:\n    ` +
      (Array.isArray(LA.dbg) ? LA.dbg.map((r) => JSON.stringify(r)).join('\n    ') : 'null');

    // 导出画布几何 + 布局盒，供像素体检脚本做精确坐标映射
    const geom = await ev(`(function(){
      var c = document.querySelector('#stage canvas'); if (!c) return '{}';
      var r = c.getBoundingClientRect(); var L = window.__PIXI_TABLE__.layout || {};
      return JSON.stringify({ dpr: window.devicePixelRatio, rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        W: L.W, H: L.H, boxes: L.boxes, rivers: L.rivers, rows: L.rows,
        hand: L.handTiles, humanWon: L.humanWon, phase: L.phase });
    })()`);
    const gObj = JSON.parse(geom || '{}');
    if (geomPath) writeFileSync(geomPath, geom + '\n');
    ck('截图前无结算遮罩', (await ev("document.getElementById('overlay').className.indexOf('show')<0")) === true);
    const Ls = JSON.parse((await ev("JSON.stringify(window.__PIXI_TABLE__.layout)")) || '{}');
    const hs0 = (Ls.handTiles && Ls.handTiles[0]) || {};
    ck('截图帧：人类手牌仍完整（≥6 张，像素体检才量得到底部）',
      (hs0.main || 0) + (hs0.sep || 0) >= 6,
      `hand=${JSON.stringify(hs0)} phase=${Ls.phase} humanWon=${Ls.humanWon} rivers=${JSON.stringify(Ls.rivers)}`);

    const cap = await cmd('Page.captureScreenshot', { format: 'png' });
    const data = cap.result && cap.result.data;
    if (data) writeFileSync(shot, Buffer.from(data, 'base64'));
    detail += `\n  截图牌河: rivers=${JSON.stringify(gObj.rivers)} rows=${JSON.stringify(gObj.rows)}`;
  }

  const fails = checks.filter((c) => c.indexOf('❌') === 0).length;
  pass = ready && fails === 0;
  // 报告由 Node 自己以 UTF-8 写盘（不要经 PowerShell 转手，否则中文/emoji 会被二次编码）
  detail = checks.join('\n  ') + `\n  顶部状态: ${mid}` +
    (audit && !audit.err ? `\n  关键盒: ${JSON.stringify(audit.boxes.center)} center / hand0 ${JSON.stringify(audit.boxes.hand0)} / river0 ${JSON.stringify(audit.boxes.river0)}` : '') +
    shotTrace +
    (shot ? `\n  截图: ${shot}` : '');
} catch (e) {
  detail = 'PROBE ERROR: ' + (e && e.message);
  pass = false;
} finally {
  try { ws && ws.close(); } catch { /* ignore */ }
  chrome.kill();
}

console.log('=== Pixi 2.5D 牌桌 · 真机验证 ===');
console.log('  ' + detail);
console.log(pass ? '\n✅ 全部通过' : '\n❌ 未通过');
const reportPath = process.argv[5];
if (reportPath) {
  const head = `=== Pixi 2.5D 牌桌 · 真机验证 ===\nRESULT pass=${checks.filter((c) => c.indexOf('✅') === 0).length} fail=${checks.filter((c) => c.indexOf('❌') === 0).length} verdict=${pass ? 'PASS' : 'FAIL'}\n\n`;
  try { writeFileSync(reportPath, head + '  ' + detail + '\n', 'utf8'); } catch { /* ignore */ }
}
console.log(`RESULT pass=${checks.filter((c) => c.indexOf('✅') === 0).length} fail=${checks.filter((c) => c.indexOf('❌') === 0).length} verdict=${pass ? 'PASS' : 'FAIL'}`);
if (!pass) process.exitCode = 1;
