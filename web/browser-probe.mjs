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
  out.handH = L.handH; out.riverH = L.riverH;
  return out;
})()`;

let pass = false, detail = '', checks = [];
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

  // 发牌动画已触发
  const fx0 = await ev("JSON.stringify(window.__PIXI_TABLE__.fx)");
  ck('发牌动画已触发（deals>=1, flights>=52）', /"deals":\d/.test(fx0) && JSON.parse(fx0).deals >= 1 && JSON.parse(fx0).flights >= 52, fx0);

  await sleep(2000); // 等发牌动画收尾

  // 定缺 → 进入牌桌
  await ev("(function(){var m=document.querySelectorAll('.mp');var r=document.querySelector('.mp.recommend')||m[0];if(r)r.click();})()");
  await sleep(1200);
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
    ck('打缺后：轮到我时给出推荐牌 + 进张数（可解释的理由）',
      tt && !tt.mustMiss && (!tt.myTurn || (tt.recTile >= 0 && tt.recImprove > 0)),
      JSON.stringify(tt));
    ck('教学状态自洽（向听数 / 已听牌+所听之牌 / 缺门 三选一）',
      tt && (tt.sh > 0 || (tt.waitingKinds > 0 && tt.waitLeft > 0) || tt.mustMiss), JSON.stringify(tt));
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
    ck('对局推进后教学条仍自洽', !tt || tt.sh > 0 || tt.waitingKinds > 0 || tt.mustMiss, JSON.stringify(tt));
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
  ck('全程零脚本错误', errors.length === 0, errors.slice(0, 3).join(' | ') || '无');

  if (shot && ready) {
    // 截一张「对局中」的图：新开一局 → 定缺 → 演示若干步（牌河有牌、无结算遮罩）
    await ev("(function(){var b=document.getElementById('againBtn');if(b)b.click();})()");
    await sleep(2200);
    await ev("(function(){var r=document.querySelector('.mp.recommend')||document.querySelector('.mp');if(r)r.click();})()");
    await sleep(900);
    await ev("document.getElementById('demoBtn').click()");
    await sleep(7000);
    await ev("document.getElementById('demoBtn').click()");
    await sleep(1200);

    // 导出画布几何 + 布局盒，供像素体检脚本做精确坐标映射
    const geom = await ev(`(function(){
      var c = document.querySelector('#stage canvas'); if (!c) return '{}';
      var r = c.getBoundingClientRect(); var L = window.__PIXI_TABLE__.layout || {};
      return JSON.stringify({ dpr: window.devicePixelRatio, rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        W: L.W, H: L.H, boxes: L.boxes, rivers: L.rivers, rows: L.rows });
    })()`);
    const gObj = JSON.parse(geom || '{}');
    if (geomPath) writeFileSync(geomPath, geom + '\n');
    ck('截图前无结算遮罩', (await ev("document.getElementById('overlay').className.indexOf('show')<0")) === true);

    const cap = await cmd('Page.captureScreenshot', { format: 'png' });
    const data = cap.result && cap.result.data;
    if (data) writeFileSync(shot, Buffer.from(data, 'base64'));
    detail += `\n  截图牌河: rivers=${JSON.stringify(gObj.rivers)} rows=${JSON.stringify(gObj.rows)}`;
  }

  const fails = checks.filter((c) => c.indexOf('❌') === 0).length;
  pass = ready && fails === 0;
  detail = checks.join('\n  ') + `\n  顶部状态: ${mid}` +
    (audit && !audit.err ? `\n  关键盒: ${JSON.stringify(audit.boxes.center)} center / hand0 ${JSON.stringify(audit.boxes.hand0)} / river0 ${JSON.stringify(audit.boxes.river0)}` : '') +
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
if (!pass) process.exitCode = 1;
