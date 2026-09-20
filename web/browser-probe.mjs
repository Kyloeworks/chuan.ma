/** 用真实 Chrome（CDP）验证 Pixi 2.5D 牌桌：
 *  初始化 + 布局不变量（不越界/不重叠）+ 手牌「摸牌分离」+ 动效确实执行 + 交互全链路 + 截图。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// ⚠️ 必须 resolve：命令行传相对路径（README 里的 `npm run probe` 就是相对路径）时，
// 直接用 'file:///' + 相对路径 会拼出 file:///web/dist/play.html 这种缺盘符的非法 URL，
// Chrome 只会停在 chrome-error:// 错误页 —— 探针全程在错误页上求值，看起来「全挂」。
const target = path.resolve(process.argv[2] || path.join(here, 'dist', 'play.html'));
const shot = process.argv[3] ? path.resolve(process.argv[3]) : '';
const geomPath = process.argv[4] ? path.resolve(process.argv[4]) : '';
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

/** 求值并把结果当 JSON 解 —— 页面报错/未就绪时返回 null，而不是让 JSON.parse 抛 "[object Object]" */
async function evJSON(expression) {
  const r = await ev(expression);
  if (typeof r !== 'string') return null;
  try { return JSON.parse(r); } catch { return null; }
}

/** 在真实页面上点一下（CDP 合成鼠标事件 → Pixi 的 pointerdown 会收到） */
async function click(x, y) {
  const base = { x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' };
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: base.x, y: base.y, pointerType: 'mouse' });
  await cmd('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, base));
  await cmd('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, base, { buttons: 0 }));
}

/** 页面上「第一张可打出的手牌」的浏览器视口坐标（由 testhook 给出画布坐标后按 canvas 缩放映射）
 *  ⚠️ 纵向取牌中心**偏上 0.3 牌高**处，而不是正中心：牌在 hover（-12px）和「已提起待确认」
 *  （-1/3 牌高）状态下都会上移，只有偏上的点在这三种姿态下都稳稳落在牌面上。 */
const HAND_POINT = `(function(){
  var H = window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.handPoint ? window.__CM_TESTHOOK__.handPoint() : null;
  if (!H) return null;
  var c = document.querySelector('#stage canvas');
  var r = c.getBoundingClientRect();
  var kx = r.width / H.W, ky = r.height / H.H;
  var hh = window.__PIXI_TABLE__.layout.handH || 80;
  return JSON.stringify({ x: r.left + H.x * kx, y: r.top + (H.y - hh * 0.3) * ky, tile: H.tile, slot: H.slot });
})()`;

/** 手牌张数（主体 + 单独排开的那张） */
const HAND_N = `(function(){ var t = window.__PIXI_TABLE__.layout.handTiles[0]; return t.main + t.sep; })()`;

/** 打开设置面板 —— 顶栏现在只有「品牌 + 设置」，难度/教学/演示/新开局/语言都在面板里 */
const OPEN_SET = `(function(){
  var ov = document.getElementById('overlay');
  if (ov && ov.className.indexOf('show') >= 0 && ov.querySelector('.pill')) return true;  // 已经开着
  var b = document.getElementById('setBtn'); if (!b) return false; b.click(); return true;
})()`;
/** 收起设置面板（#setBtn 是 toggle，再点一次即可） */
const CLOSE_SET = `(function(){
  var ov = document.getElementById('overlay');
  if (ov && ov.className.indexOf('show') >= 0 && ov.querySelector('.pill')) {
    var b = document.getElementById('setBtn'); if (b) b.click();
  }
})()`;
/** 在设置面板里点某个选项（diff / lang / teach / dealer） */
const pickPill = (k, v) => `(function(){
  var b = document.querySelector('#overlay .pill[data-k="${k}"][data-v="${v}"]');
  if (!b) return false; b.click(); return true;
})()`;
/** 顶栏按钮 id 列表（用于断言「只剩品牌 + 设置」） */
const HEAD_IDS = `JSON.stringify(Array.from(document.querySelectorAll('header a,header button')).map(function(e){return e.id||'';}))`;

const BLANK_POINT = `(function(){
  var L = window.__PIXI_TABLE__.layout;
  var c = document.querySelector('#stage canvas');
  var r = c.getBoundingClientRect();
  var cands = [[0.5,0.05],[0.05,0.5],[0.95,0.5],[0.5,0.45],[0.06,0.06],[0.94,0.06]];
  for (var i=0;i<cands.length;i++){
    var lx = L.W*cands[i][0], ly = L.H*cands[i][1], hit=false;
    for (var j=0;j<L.boxes.length;j++){
      var b=L.boxes[j];
      if (lx>=b.x-4 && lx<=b.x+b.w+4 && ly>=b.y-4 && ly<=b.y+b.h+4) { hit=true; break; }
    }
    if (!hit) return JSON.stringify({ x: r.left + lx*(r.width/L.W), y: r.top + ly*(r.height/L.H) });
  }
  return null;
})()`;

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
    if (hit(a,b)) out.overlaps.push(names[i] + ' x ' + names[j] + ' A=' + [a.x,a.y,a.w,a.h].map(Math.round).join(',') + ' B=' + [b.x,b.y,b.w,b.h].map(Math.round).join(','));
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

  // ── 首屏资产加载进度：先注入采样器再重载，否则连上 CDP 时页面早已加载完 ──
  //    （采样器在页面脚本之前运行，靠 16ms 轮询抓 __PIXI_TABLE__.boot 的变化）
  await cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__bootTrace = [];
(function(){
  var n = 0;
  var h = setInterval(function(){
    var b = window.__PIXI_TABLE__ && window.__PIXI_TABLE__.boot;
    if (b) {
      var last = window.__bootTrace[window.__bootTrace.length - 1];
      if (!last || last[0] !== b.pct || last[1] !== b.done) window.__bootTrace.push([b.pct, b.done, b.label || '']);
      if (b.done) clearInterval(h);
    }
    if (++n > 1200) clearInterval(h);
  }, 16);
})();`,
  });
  await cmd('Page.reload', { ignoreCache: true });

  let st = '';
  // ⚠️ Page.reload 是异步的：旧 document 会在一小段时间里仍然可读，此时读到的是**上一轮**的
  //    ready=true（于是「画布已创建」之类的后续断言全挂）。必须等新 document 出现 ——
  //    上面注入的脚本会建 window.__bootTrace，旧 document 没有这个字段。
  let freshDoc = false;
  for (let i = 0; i < 150; i++) {
    st = await ev("window.__PIXI_TABLE__ ? JSON.stringify(window.__PIXI_TABLE__) : 'pending'");
    freshDoc = (await ev('!!window.__bootTrace')) === true;
    if (freshDoc && st && (st.indexOf('"ready":true') >= 0 || st.indexOf('"error"') >= 0)) break;
    await sleep(200);
  }
  const ready = st.indexOf('"ready":true') >= 0;
  const diag0 = await ev("document.getElementById('diag').textContent");
  const canvas = await ev("(function(){var c=document.querySelector('#stage canvas');return c?(c.width+'x'+c.height):'no-canvas';})()");

  ck('Pixi 初始化 ready', ready, st ? st.slice(0, 120) : '');
  ck('画布已创建', canvas !== 'no-canvas', canvas);
  ck('纹理全部生成（28）', /28 /.test(diag0 || ''), diag0);

  // ── 首屏资产加载进度：加载期间要有可见进度，加载完才能进开局界面 ──
  {
    // ⚠️ 先等进度条自己收尾再读采样：真机上靠 rAF 平滑走完最后的收尾段，
    //   但无头环境/后台标签的 rAF 会被节流甚至停跑 —— 那时由 bootFinish 里的 900ms
    //   兜底定时器把进度落定到 100%。读早了只能看到 90% 出头的那一笔。
    let fin = null;
    for (let i = 0; i < 16; i++) {
      fin = await evJSON(`(function(){
        var b = window.__PIXI_TABLE__ && window.__PIXI_TABLE__.boot;
        return JSON.stringify(b ? [b.pct, b.done, b.label || ''] : null);
      })()`);
      if (fin && fin[1] === true) break;
      await sleep(150);
    }
    const trace = (await evJSON('JSON.stringify(window.__bootTrace || [])')) || [];
    const pcts = trace.map((x) => x[0]);
    const mono = pcts.every((v, i) => i === 0 || v >= pcts[i - 1]);
    ck('首屏加载进度可见（采样到 0 与 100 之间的中间态）',
      pcts.length > 0 && pcts.some((p) => p > 0 && p < 100), JSON.stringify(trace.slice(0, 6)));
    ck('进度不是「一开始就 0、最后一下满」（采样到 ≥8 级台阶）',
      pcts.length >= 8, `台阶数=${pcts.length} ${JSON.stringify(pcts)}`);
    ck('进度单调不减（并行完成的纹理不会让进度条回退）', mono, JSON.stringify(pcts));
    ck('逐张牌面素材计入进度（出现 x/28 的阶段文案）',
      trace.some((x) => /(^|\D)\d+\/28/.test(x[2] || '')), JSON.stringify(trace.map((x) => x[2]).filter(Boolean).slice(0, 4)));
    const last = trace[trace.length - 1] || [];
    ck('加载完成到 100% 且标记 done', fin && fin[0] === 100 && fin[1] === true,
      'trace末笔=' + JSON.stringify(last) + ' 终态=' + JSON.stringify(fin));
    // 加载层有「最短展示时长」（否则 ~400ms 的加载会让进度条一闪而过），所以要轮询等它淡出
    let BS = null;
    for (let i = 0; i < 14; i++) {
      BS = await evJSON(`(function(){
        var b = document.getElementById('boot'); if (!b) return null;
        var s = getComputedStyle(b);
        return JSON.stringify({ gone: b.className.indexOf('gone') >= 0, op: s.opacity, pe: s.pointerEvents });
      })()`);
      if (BS && BS.gone === true) break;
      await sleep(150);
    }
    ck('加载完整后才进入开玩界面（加载层已淡出、不再挡点击）',
      BS && BS.gone === true && BS.pe === 'none',
      JSON.stringify(BS));
  }

  // ── ★ 开局流程：打开后绝不自动发牌，必须先过「开局设置」 ──
  const idle = await ev(AUDIT);
  ck('打开后停在「开局设置」，未自动发牌', idle && idle.idle === true, 'idle=' + (idle && idle.idle));
  const setupShown = await ev("(function(){var o=document.getElementById('overlay');return o.className.indexOf('show')>=0 && !!document.getElementById('startGameBtn');})()");
  ck('开局设置弹层可见（含「开始对局」按钮）', setupShown === true);
  const fxIdle = await ev("JSON.stringify(window.__PIXI_TABLE__.fx)");
  ck('开局前零发牌动作（deals=0）', JSON.parse(fxIdle || '{}').deals === 0, fxIdle);
  // 顶栏只剩「品牌 + 设置」，其余控件全在设置面板里
  const headIds = await ev(HEAD_IDS);
  ck('顶栏只有「品牌 + 设置」两个入口',
    /homeBtn/.test(headIds) && /setBtn/.test(headIds) && !/demoBtn|helpBtn|newBtn|langBtn|ttl|hstat|diffs/.test(headIds),
    headIds);
  const brandTxt = await ev("(document.querySelector('header .brand')||{}).textContent||''");
  ck('品牌显示为 Chuan.Ma - 川麻', /Chuan/.test(brandTxt) && /川麻/.test(brandTxt), JSON.stringify(brandTxt));
  const drawerGone = await ev("!document.getElementById('drawer') && !document.getElementById('logBtn') && !document.getElementById('log')");
  ck('对局记录抽屉已移除', drawerGone === true);

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
  await ev(OPEN_SET);
  await ev("(function(){var n=document.getElementById('newBtn2');if(n)n.click();})()");
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

  // —— 视口分档：满屏无滚动条 + 牌与字体随档放大（4K 不再显得小）——
  const baseView = JSON.parse((await ev("JSON.stringify({width:window.innerWidth,height:window.innerHeight,deviceScaleFactor:1,mobile:false})")) || '{}');
  const VIEWS = [
    { w: 1280, h: 720, name: '1280×720' },
    { w: 1920, h: 1080, name: '1920×1080' },
    { w: 2560, h: 1440, name: '2560×1440' },
    { w: 3840, h: 2160, name: '3840×2160(4K)' },
  ];
  const tierRows = [];
  for (const v of VIEWS) {
    await cmd('Emulation.setDeviceMetricsOverride', { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: false });
    await sleep(450);
    const s = JSON.parse((await ev(`(function(){
      var de=document.documentElement, b=document.body, L=window.__PIXI_TABLE__.layout||{};
      var el=document.querySelector('header .brand');   // 顶栏唯一常驻文字，用它代表 DOM 字号
      var c=document.querySelector('#stage canvas');
      return JSON.stringify({
        iw: window.innerWidth, ih: window.innerHeight,
        sw: de.scrollWidth, sh: de.scrollHeight, bsw: b.scrollWidth, bsh: b.scrollHeight,
        tier: L.tier, k: L.uiK, handH: L.handH, overflow: L.overflow, boxes: (L.boxes||[]).length,
        fs: el ? Math.round(parseFloat(getComputedStyle(el).fontSize)*100)/100 : 0,
        stageH: document.getElementById('stage').clientHeight,
        canvas: c ? [c.clientWidth, c.clientHeight] : null
      });
    })()`)) || '{}');
    tierRows.push(Object.assign({ name: v.name }, s));
    ck(`${v.name}：满屏无页面滚动条`, s.sw <= s.iw + 1 && s.sh <= s.ih + 1 && s.bsw <= s.iw + 1 && s.bsh <= s.ih + 1,
      `doc=${s.sw}×${s.sh} body=${s.bsw}×${s.bsh} 视口=${s.iw}×${s.ih}`);
  }
  const ks = tierRows.map((r) => r.k), hhs = tierRows.map((r) => r.handH), fss = tierRows.map((r) => r.fs);
  ck('视口越大档位越高（k 随视口单调递增）', ks.every((x, i) => i === 0 || x > ks[i - 1]), `k=${ks.join(' / ')}`);
  ck('手牌随档放大（4K 至少是 720p 的 1.8 倍）',
    hhs.every((x, i) => i === 0 || x > hhs[i - 1]) && hhs[hhs.length - 1] >= 1.8 * hhs[0],
    `handH=${hhs.join(' / ')}`);
  ck('DOM 字号同步放大（牌与字一起变大，不是只放大画布）',
    fss.every((x, i) => i === 0 || x > fss[i - 1]), `fontSize=${fss.join(' / ')}`);
  ck('各档布局均不越界（放大后仍全在屏内）', tierRows.every((r) => r.overflow === 0),
    JSON.stringify(tierRows.map((r) => r.overflow)));
  ck('各档画布均跟随舞台尺寸重算', tierRows.every((r) => r.canvas && r.canvas[1] > 0 && Math.abs(r.canvas[1] - r.stageH) <= 2),
    JSON.stringify(tierRows.map((r) => r.canvas)));
  shotTrace += `\n  分档实测: ` + JSON.stringify(tierRows.map((r) => ({ v: r.name, tier: r.tier, k: r.k, handH: r.handH, fs: r.fs })));
  // 还原到运行前的视口（不要用 clearDeviceMetricsOverride：headless 下会回落到默认小窗口，
  // 导致后续所有断言都在最小档跑，截图与像素体检也跟着失真）
  await cmd('Emulation.setDeviceMetricsOverride', baseView);
  await sleep(520);

  // —— 手机竖屏 375×812：牌桌不能越界、手牌要可辨认、顶栏要够矮、设置入口要够大 ——
  {
    await cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await sleep(800);
    const p = await evJSON(`(function(){
      var L = window.__PIXI_TABLE__.layout || {}, de = document.documentElement;
      var b = document.getElementById('setBtn'), r = b ? b.getBoundingClientRect() : null;
      var c = document.querySelector('#stage canvas'), st = document.getElementById('stage');
      var hd = document.querySelector('header');
      return JSON.stringify({
        w: window.innerWidth, h: window.innerHeight,
        sw: de.scrollWidth, sh: de.scrollHeight,
        overflow: L.overflow, nboxes: (L.boxes || []).length, handH: L.handH, tier: L.tier,
        canvas: c ? [c.clientWidth, c.clientHeight] : null,
        stageH: st ? st.clientHeight : 0,
        setBtn: r ? [Math.round(r.width), Math.round(r.height)] : null,
        headH: hd ? Math.round(hd.getBoundingClientRect().height) : 0,
        bad: (L.boxes || []).filter(function (b) {
          return b.x < -1 || b.y < -1 || b.x + b.w > (L.W || 0) + 1 || b.y + b.h > (L.H || 0) + 1;
        }).map(function (b) {
          return b.name + '@' + [b.x, b.y, b.w, b.h].map(Math.round).join(',');
        })
      });
    })()`);
    shotTrace += `\n  竖屏实测: ` + JSON.stringify(p);
    ck('竖屏 375×812：无页面滚动条',
      p && p.sw <= p.w + 1 && p.sh <= p.h + 1, JSON.stringify(p));
    ck('竖屏：牌桌元素全部在屏内', p && p.overflow === 0, 'overflow=' + (p && p.overflow) + ' bad=' + JSON.stringify(p && p.bad));
    ck('竖屏：手牌仍可辨认（牌高 ≥ 24px）', p && p.handH >= 24, 'handH=' + (p && p.handH));
    ck('竖屏：画布跟随舞台重算', p && p.canvas && Math.abs(p.canvas[1] - p.stageH) <= 2,
      JSON.stringify(p && p.canvas) + ' stageH=' + (p && p.stageH));
    ck('竖屏：设置入口可点（≥40×40）',
      p && p.setBtn && p.setBtn[0] >= 40 && p.setBtn[1] >= 40, JSON.stringify(p && p.setBtn));
    ck('竖屏：顶栏够矮（≤64px，把高度留给牌桌）', p && p.headH > 0 && p.headH <= 64, 'headH=' + (p && p.headH));
    await cmd('Emulation.setDeviceMetricsOverride', baseView);
    await sleep(520);
  }

  // —— 设置面板：顶栏唯一的入口，开合正常且不挡住牌桌交互 ——
  const ST = JSON.parse((await ev(`(function(){
    var ov = document.getElementById('overlay');
    document.getElementById('setBtn').click();
    var opened = ov.className.indexOf('show') >= 0 && !!document.getElementById('closeSet');
    var pills = ov.querySelectorAll('.pill[data-k="lang"]').length;
    var startBtn = !!document.getElementById('startGameBtn');
    document.getElementById('closeSet').click();
    var closed = ov.className.indexOf('show') < 0;
    return JSON.stringify({ opened: opened, closed: closed, pills: pills, startBtnInLive: startBtn });
  })()`)) || '{}');
  ck('设置面板可开合（对局中点设置不重开牌局）',
    ST.opened === true && ST.closed === true, JSON.stringify(ST));
  ck('设置面板内含语言切换（贯穿全站语言入口）', ST.pills >= 1, JSON.stringify(ST));
  ck('对局中的设置面板不再出现「开始对局」', ST.startBtnInLive === false, JSON.stringify(ST));

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
  await ev(OPEN_SET);
  await ev(pickPill('diff', 'easy'));
  await ev(CLOSE_SET);
  await sleep(400);
  const dAfter = await ev("JSON.stringify(window.__PIXI_TABLE__.layout.diff)");
  ck('难度切换到「新手」生效', dAfter === '"easy"', `${dBefore} → ${dAfter}`);
  await ev(OPEN_SET);
  await ev(pickPill('diff', 'normal'));
  await ev(CLOSE_SET);
  await sleep(300);

  // 确定性推进 ~40 个循环步（≈十几手）→ 人类已打完缺门，教学条应给出推荐与理由
  await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.advance(40)");
  await sleep(300);
  const auditT = await ev(AUDIT);
  if (auditT && !auditT.err) {
    const tt = auditT.teach;
    // ⚠ 这里原本是「advance(40) 之后 mustMiss 必须为 false」的单次断言 —— 它会随机失败。
    //   牌局的随机数是固定种子的 LCG，但**动画/定时器也会消耗随机数**，于是同样的
    //   advance(40) 在不同时序下停在不同阶段（实测复跑 4 次挂 1 次：need=10、手牌已 10 张，
    //   说明缺门还差一手没打完）。单次断言测的是「恰好在这一帧成立」，不是「应该发生的事」。
    //   改成有界收敛：最多再补推进 8×5 步，必须达成「缺门已打完」。这是规则保证必然发生的结果。
    let cleared = !!(auditT.teach && auditT.teach.mustMiss === false);
    let used = 40;
    for (let i = 0; !cleared && i < 8; i++) {
      await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.advance(5)");
      await sleep(120);
      const a = await ev(AUDIT);
      cleared = !!(a && !a.err && a.teach && a.teach.mustMiss === false);
      used += 5;
    }
    ck('推进十几手后：缺门已打完（进入向听 / 下叫阶段）', cleared,
      `共推进 ${used} 步；末次状态 ${JSON.stringify(tt)}`);
    ck('教学状态自洽（向听数 / 已听牌+所听之牌 / 缺门 三选一）',
      tt && (tt.shEff > 0 || (tt.waitingKinds > 0 && tt.waitLeft > 0) || tt.mustMiss || tt.deadWait), JSON.stringify(tt));
    // 「死叫」是合法状态：手牌确实已听牌（向听 0），但所听之牌一张不剩（全被打完/全在缺门）
    ck('教学状态不与「向听 0」自相矛盾', tt && !(tt.sh <= 0 && !tt.mustMiss && tt.waitingKinds === 0 && !tt.deadWait),
      JSON.stringify(tt));
  }

  // ── 出牌二次确认：第一次点只「提起」待确认，第二次点同一张才真正打出 ──
  {
    const atTurn = await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.stepToHumanTurn()");
    ck('可推进到「轮到人类出牌」的时刻（供点击测试）', atTurn === true, 'got=' + atTurn);
    if (atTurn === true) {
      const hp = await ev(HAND_POINT);
      const n0 = await ev(HAND_N);
      const r0 = await ev("window.__PIXI_TABLE__.layout.rivers[0]");
      const p0 = hp ? JSON.parse(hp) : null;
      ck('取到第一张可打手牌的屏幕坐标', !!p0, hp || 'null');
      if (p0) {
        // ① 第一次点击：只提起待确认，手牌数量不变
        await click(p0.x, p0.y);
        await sleep(300);
        const s1 = JSON.parse((await ev("JSON.stringify({sel:window.__PIXI_TABLE__.layout.selTile})")) || '{}');
        const n1 = await ev(HAND_N);
        ck('第一次点牌：只「提起」待确认，没有打出', s1.sel >= 0 && n1 === n0, `sel=${s1.sel} 手牌 ${n0}→${n1}`);

        // ② 点桌面空白：取消待确认，仍不打出
        const bp = await ev(BLANK_POINT);
        if (bp) {
          const b = JSON.parse(bp);
          await click(b.x, b.y);
          await sleep(300);
          const s2 = JSON.parse((await ev("JSON.stringify({sel:window.__PIXI_TABLE__.layout.selTile})")) || '{}');
          const n2 = await ev(HAND_N);
          ck('点桌面空白：取消待确认（不打出）', s2.sel === -1 && n2 === n0, `sel=${s2.sel} 手牌=${n2}`);
        }

        // ③ 重新选中 → 第二次点同一张 → 真正打出
        await click(p0.x, p0.y);
        await sleep(280);
        const s3 = JSON.parse((await ev("JSON.stringify({sel:window.__PIXI_TABLE__.layout.selTile})")) || '{}');
        ck('可重复选中同一张（取消后能再确认）', s3.sel >= 0, `sel=${s3.sel}`);
        await click(p0.x, p0.y);
        await sleep(360);
        const s4 = JSON.parse((await ev("JSON.stringify({sel:window.__PIXI_TABLE__.layout.selTile})")) || '{}');
        const r4 = await ev("window.__PIXI_TABLE__.layout.rivers[0]");
        // ⚠️ 出牌后 pump 会自动推进到「我下一轮摸完牌」才停下，所以手牌数会回到原值 ——
        //    要断言「确实打出去了」得看**牌河**（人类牌河 +1），不是手牌数。
        ck('第二次点同一张：真正打出（人类牌河 +1、选中态清空）',
          r4 === r0 + 1 && s4.sel === -1, `牌河 ${r0}→${r4} sel=${s4.sel}（手牌 ${n0}→${await ev(HAND_N)}）`);
      }
    }
  }

  // 演示模式：动作级节奏自动推进，期间应产生飞行牌轨迹 / 碰杠高光
  // （日志抽屉已移除，推进指标改用「出牌飞行动画计数」——fx 字段恒定存在，不依赖布局对象）
  const fxBefore = JSON.parse((await ev('JSON.stringify(window.__PIXI_TABLE__.fx)')) || '{}');
  await ev(OPEN_SET);
  await ev("(function(){var b=document.getElementById('demoBtn2');if(b)b.click();})()");
  await sleep(9000);
  const fx1 = await ev("JSON.stringify(window.__PIXI_TABLE__.fx)");
  const audit2 = await ev(AUDIT);
  await ev(OPEN_SET);
  await ev("(function(){var b=document.getElementById('demoBtn2');if(b)b.click();})()");
  await sleep(800);

  const F = JSON.parse(fx1 || '{}');
  ck('对局推进（出牌飞行数增长）', (F.flights || 0) > (fxBefore.flights || 0),
    `${fxBefore.flights} → ${F.flights}`);
  ck('出牌轨迹动画已执行（flights 增长）', F.flights > 52, 'flights=' + F.flights);
  ck('碰/杠高光已触发', (F.rings || 0) > 0, 'rings=' + F.rings);
  if (audit2 && !audit2.err) {
    ck('対局中布局仍无越界', audit2.overflow === 0, 'overflow=' + audit2.overflow);
    ck('对局中牌河仍 ≤2 排', audit2.rows.every((r) => r <= 2), JSON.stringify(audit2.rows));
    const tt = audit2.teach;
    ck('对局推进后教学条仍自洽', !tt || tt.shEff > 0 || tt.waitingKinds > 0 || tt.mustMiss || tt.deadWait, JSON.stringify(tt));
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
  // 同时累计「终局手牌形态」违规数 —— 若某家带着刚摸到的那张（标准张数+1）进入查叫结算，
  // 他必被判「未下叫」，也就是玩家报的「我最后听牌了，查叫却说我没叫牌」。
  const GAMES = 30;
  let humanWins = 0, seatWins = [0, 0, 0, 0], totWin = 0, humanFinalSh = [];
  let shapeViolations = 0, shapeSamples = 0, shapeDiag = '';
  for (let i = 0; i < GAMES; i++) {
    // 结算弹层若已关闭（overlay='none'）就没有 againBtn，退回顶栏「新开一局 → 开始对局」
    await ev("(function(){var b=document.getElementById('againBtn');if(b){b.click();return;}})()");
    // 结算弹层已关闭时退回「设置 → 新开一局」
    await ev(OPEN_SET);
    await ev("(function(){var n=document.getElementById('newBtn2');if(n)n.click();})()");
    await sleep(90);
    await ev("(function(){var b=document.getElementById('startGameBtn');if(b)b.click();})()");
    await sleep(110);
    await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.runToEnd()");
    await sleep(120);
    const o = JSON.parse((await ev("JSON.stringify(window.__PIXI_TABLE__.layout)")) || '{}');
    const w = o.won || [];
    if (o.humanWon) humanWins++;
    for (let s = 0; s < 4; s++) if (w[s]) seatWins[s]++;
    totWin += w.filter(Boolean).length;
    if (o.phase === 'finished' && Array.isArray(o.rawHands) && Array.isArray(o.expectHands)) {
      shapeSamples++;
      for (let s = 0; s < 4; s++) {
        // 合法范围：标准张数 … 标准张数 + 1（刚摸的那张没打出）+ 杠数（每个杠可留一张补牌在手）。
        // 下界是重点：低于标准张数就是「没摸牌就出牌」的抽干（会永久少牌、再也胡不了）。
        const lo = o.expectHands[s];
        const hi = lo + 1 + ((o.kongsOf && o.kongsOf[s]) || 0);
        if (!(o.rawHands[s] >= lo && o.rawHands[s] <= hi)) {
          shapeViolations++;
          if (!shapeDiag) {
            shapeDiag = `raw=${JSON.stringify(o.rawHands)} expect=${JSON.stringify(o.expectHands)}` +
              ` won=${JSON.stringify(w)} self=${JSON.stringify(o.winSelf || null)} melds=${JSON.stringify(o.meldsOf || null)}` +
              ` kongs=${JSON.stringify(o.kongsOf || null)} ready=${JSON.stringify(o.readyAtEnd || null)}` +
              ` draws=${o.draws} rivers=${JSON.stringify(o.rivers)}`;
          }
        }
      }
    }
  }
  ck(`终局手牌张数合法（${shapeSamples} 局：每家 ∈ {标准张数, 标准张数+1}）`,
    shapeSamples === GAMES && shapeViolations === 0,
    `samples=${shapeSamples} violations=${shapeViolations}${shapeDiag ? ' | ' + shapeDiag : ''}`);
  const pct = (humanWins / GAMES * 100).toFixed(0);
  const seatPct = seatWins.map((x) => (x / GAMES * 100).toFixed(0) + '%').join(' / ');
  ck(`真实 UI 里人类能赢（${GAMES} 局赢 ${humanWins} 局）`, humanWins >= 3,
    `人类胜率≈${pct}%  各座 ${seatPct}  平均赢家/局=${(totWin / GAMES).toFixed(2)}`);
  ck('真实 UI 座位无明显偏向（人类不超过 3 倍优势）', seatWins[0] <= 3 * Math.max(1, (seatWins[1] + seatWins[2] + seatWins[3]) / 3),
    `seatWins=${JSON.stringify(seatWins)}`);

  // —— 胡牌必须由玩家点按钮，不能自动替玩家胡 ——
  await ev(OPEN_SET);
  await ev(pickPill('diff', 'normal'));
  await ev(CLOSE_SET);
  await sleep(150);
  let gotWin = false;
  for (let k = 0; k < 12 && !gotWin; k++) {
    // 每次都从「新的一局」开始：先把上一局收尾（若有），再开新局并定缺
    await ev("window.__CM_TESTHOOK__ && window.__CM_TESTHOOK__.runToEnd()");
    await sleep(160);
    await ev("(function(){var b=document.getElementById('againBtn');if(b){b.click();return;}})()");
    // 结算弹层已关闭时退回「设置 → 新开一局」
    await ev(OPEN_SET);
    await ev("(function(){var n=document.getElementById('newBtn2');if(n)n.click();})()");
    await sleep(200);
    await ev("(function(){var b=document.getElementById('startGameBtn');if(b)b.click();})()");
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
      var L=window.__PIXI_TABLE__.layout||{};
      return JSON.stringify({ txt:b.textContent, huFs:parseFloat(getComputedStyle(b).fontSize),
        huH:Math.round(b.getBoundingClientRect().height), btnCount:bs.length,
        bodyFs: parseFloat(getComputedStyle(document.body).fontSize),
        vw: window.innerWidth, vh: window.innerHeight, k: L.uiK, tier: L.tier,
        minFs: bs.length?Math.min.apply(null, bs.map(function(x){return parseFloat(getComputedStyle(x).fontSize)})):0,
        minH: bs.length?Math.min.apply(null, bs.map(function(x){return Math.round(x.getBoundingClientRect().height)})):0 });
    })()`)) || '{}');
    ck('「胡」按钮已渲染在牌桌上', !!BJ.txt && BJ.txt !== 'undefined' && BJ.btnCount >= 1, JSON.stringify(BJ));
    ck('碰/杠/胡等动作按钮足够醒目（≥1.4 倍正文字号、高度≥40px，随档同比例放大）',
      BJ.minFs >= 1.4 * BJ.bodyFs && BJ.minH >= 40,
      `minFontSize=${BJ.minFs} bodyFontSize=${BJ.bodyFs} minHeight=${BJ.minH} huFontSize=${BJ.huFs}` +
      ` viewport=${BJ.vw}×${BJ.vh} tier=${BJ.tier} k=${BJ.k}`);
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
    await ev("(function(){var b=document.getElementById('againBtn');if(b){b.click();return;}})()");
    // 结算弹层已关闭时退回「设置 → 新开一局」
    await ev(OPEN_SET);
    await ev("(function(){var n=document.getElementById('newBtn2');if(n)n.click();})()");
    await sleep(200);
    await ev("(function(){var b=document.getElementById('startGameBtn');if(b)b.click();})()");
    await sleep(2100);
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
    ck('牌形不变量：人类「手牌 + 3×副露 + 杠」恒为 13/14（连杠时可到 15）',
      shapeLog.length >= 25 && minShape >= 13 && maxShape <= 15,
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
        // 档位与缩放系数必须一起导出：牌桌的一切尺寸都随 k 缩放，
        // 排查「牌变小了」这类问题时，没有 tier/k 就只能靠猜舞台尺寸（踩过）。
        tier: L.tier, uiK: L.uiK, handH: L.handH, riverH: L.riverH,
        stage: { w: document.getElementById('stage').clientWidth, h: document.getElementById('stage').clientHeight },
        win: { w: window.innerWidth, h: window.innerHeight },
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
  // 顶栏状态栏已移除，这里改报「设置面板 / 顶栏」的结构事实
  const headInfo = await ev("(function(){var h=document.querySelector('header');return (h?h.textContent.replace(/\\s+/g,' ').trim():'')+' | pills='+(document.querySelectorAll('#overlay .pill').length);})()");
  detail = checks.join('\n  ') + `\n  顶栏/设置: ${headInfo}` +
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
