/** 全站版式体检（静态 + 真机两段）。
 *
 *  为什么需要它：「避免错位、重叠，行高/边距/字号/边框层次统一」这类要求，
 *  靠肉眼看几页是查不全的 —— 9 个页面 × 4 档视口 = 36 个组合，
 *  而绝大多数问题只在某一档才出现（窄屏换行、顶栏 sticky 压内容、长单词撑破列）。
 *  这里把要求变成可测判据，改完能自动验证「真的没有重叠、没有越界」。
 *
 *  静态段（不需要浏览器）：
 *    - HTML 里用到但 CSS 里没有定义的类名（表现为「这一块完全没样式」）
 *    - CSS 里定义了但没人用的类名（死样式）
 *    - 字号 / 间距 / 圆角 是否落在统一尺度上（错位感最常见的来源）
 *
 *  真机段（headless Chrome + CDP，复用 browser-probe 的方式）：
 *    每页 × 375 / 768 / 1280 / 1920 四档视口，检测
 *    - 横向溢出（页面出现横向滚动条 = 最典型的「错位」）
 *    - 元素越出视口；子元素越出父容器内容盒
 *    - **同级元素矩形相交**（重叠）
 *    - 文字被裁（scrollWidth > clientWidth 且不可换行）
 *    - 行高过紧（line-height / font-size < 1.15）
 *    - 移动端点击目标 < 40px
 *    - 字号 / 间距 / 圆角 / 边框宽 的实际取值清单（用于判断尺度是否统一）
 *
 *  用法：node web/ui-audit.mjs                 → 全部页面 × 全部视口，报告写 web/_ui-audit.txt
 *        node web/ui-audit.mjs index.html      → 只查指定页面（逗号分隔）
 *        node web/ui-audit.mjs --static        → 只跑静态段
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, 'dist');
const ARGV = process.argv.slice(2);
const STATIC_ONLY = ARGV.includes('--static');
const PICK = (ARGV.find((a) => !a.startsWith('--')) || '').split(',').filter(Boolean);

const PAGES = PICK.length ? PICK : [
  'index.html', 'learn-rules.html', 'learn-tiles.html', 'learn-scoring.html',
  'learn-culture.html', 'glossary.html', 'calculator.html', 'tiles.html', 'play.html',
];
// 牌桌是整屏 canvas 应用，版式判据不适用，只查横向溢出
const CANVAS_APP = new Set(['play.html']);
const VIEWPORTS = [
  { tag: 'mobile 375', w: 375, h: 812, mobile: true },
  { tag: 'tablet 768', w: 768, h: 1024, mobile: true },
  { tag: 'laptop 1280', w: 1280, h: 800, mobile: false },
  { tag: 'desktop 1920', w: 1920, h: 1080, mobile: false },
];

const out = [];
const say = (s) => out.push(s);

/* ══════════════════════ 一、静态段 ══════════════════════ */
const STYLE_SOURCES = [
  { file: 'web/content/site.css', label: 'site.css（学习内容页共享）' },
  { file: 'web/template.html', label: 'calculator 内联' },
  { file: 'web/tiles.template.html', label: 'tiles 内联' },
  { file: 'web/pixi-table.template.html', label: 'play 内联' },
];
const repo = path.resolve(here, '..');
const pageDir = dist;
const contentDir = path.resolve(here, 'content');

function readMaybe(p) { return existsSync(p) ? readFileSync(p, 'utf8') : ''; }
function styleBlock(html) {
  const m = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  return m ? m[1] : '';
}

const cssText = STYLE_SOURCES.map((s) => {
  const raw = readMaybe(path.resolve(repo, s.file));
  return /\.template\.html$/.test(s.file) ? styleBlock(raw) : raw;
}).join('\n');
const cssNoComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');

/** 定义过的类名。分成两套：
 *   - allDefined：全部样式源（含工具页内联），用于尺度清单统计
 *   - sharedDefined：只含 site.css —— 「用到但没定义」与「定义了没人用」只在
 *     静态 HTML 页面（走 site.css 的那批）之间判断才成立。
 *     工具页的 DOM 主要由 JS 生成，按 HTML 源扫类名会把大量在用类误报成「死样式」。 */
const allDefined = new Set();
for (const m of cssNoComments.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) allDefined.add(m[1]);
const sharedCss = readMaybe(path.resolve(repo, 'web/content/site.css')).replace(/\/\*[\s\S]*?\*\//g, '');
const sharedDefined = new Set();
for (const m of sharedCss.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) sharedDefined.add(m[1]);

/** 用到的类名（按页面归集） */
const usedByPage = new Map();
const scanPages = [
  ...PAGES.map((p) => ({ name: p, file: path.join(pageDir, p), via: 'dist' })),
  { name: 'landing.html(源)', file: path.resolve(here, 'landing.html'), via: 'src' },
  ...['learn-rules.html', 'learn-tiles.html', 'learn-scoring.html', 'learn-culture.html', 'glossary.html']
    .map((p) => ({ name: p + '(源)', file: path.join(contentDir, p), via: 'src' })),
];
for (const p of scanPages) {
  const html = readMaybe(p.file);
  if (!html) continue;
  const set = new Set();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].trim().split(/\s+/)) if (c) set.add(c);
  }
  usedByPage.set(p.name, set);
}
const usedAll = new Set();
for (const s of usedByPage.values()) for (const c of s) usedAll.add(c);

say('================ 一、静态：类名与 CSS 的一致性 ================');
// 只在「静态 HTML + site.css」这一对之间判断：工具页 DOM 由 JS 生成，按 HTML 源扫会误报
const SHARED_PAGES = ['index.html', 'learn-rules.html', 'learn-tiles.html', 'learn-scoring.html',
  'learn-culture.html', 'glossary.html', 'landing.html(源)'];
const undefinedHits = [];
for (const p of SHARED_PAGES) {
  const set = usedByPage.get(p);
  if (!set) continue;
  for (const c of set) if (!sharedDefined.has(c)) undefinedHits.push(`${p} → .${c}`);
}
if (undefinedHits.length) {
  say('⚠ HTML 用到但 site.css 无定义的类名（这些元素完全没样式）：');
  for (const h of [...new Set(undefinedHits)]) say('    ' + h);
} else say('✅ 共享样式页没有「有类名无样式」的情况');

const sharedUsed = new Set();
for (const p of SHARED_PAGES) {
  const set = usedByPage.get(p);
  if (set) for (const c of set) sharedUsed.add(c);
}
const unused = [...sharedDefined].filter((c) => !sharedUsed.has(c));
say(`\nsite.css 定义了但静态页面未使用的类名（${unused.length} 个）：`);
say('    ' + (unused.join(', ') || '(无)'));

/* ── 结构断言：这些是「肉眼看不出来、但窄屏一定出事」的问题 ── */
say('\n结构断言：');
const structBad = [];
for (const p of SHARED_PAGES) {
  const file = p.endsWith('(源)') ? path.join(contentDir, p.replace('(源)', '')) : path.join(pageDir, p);
  const html = readMaybe(file);
  if (!html) continue;
  // ① 裸表格：窄屏下会被内容撑破容器，让整页出现横向滚动条
  const tables = (html.match(/<table>/g) || []).length;
  const wraps = (html.match(/class="tbl-scroll"/g) || []).length;
  if (tables > wraps) structBad.push(`${p}：${tables} 个 <table> 只有 ${wraps} 个包在 .tbl-scroll 里（窄屏会整页横向滚动）`);
  // ② 视口 meta：缺了移动端会按 980px 布局，所有窄屏断言都失去意义
  if (!/name="viewport"/.test(html)) structBad.push(`${p}：缺 viewport meta`);
  // ③ 内容页应有返回站点的导航（避免死胡同）；首页除外
  if (p !== 'index.html' && p !== 'landing.html(源)' && !/<nav[\s>]/.test(html)) structBad.push(`${p}：缺 <nav>`);
}
say(structBad.length ? structBad.map((s) => '    ⚠ ' + s).join('\n') : '    ✅ 表格已包滚动容器 / viewport meta 齐备 / 内容页都有导航');

/* ── CSS 变量闭环检查 ──────────────────────────────────────────────────────
   为什么必须有这条：CSS 变量未定义时，**整条声明被丢弃，不报错、控制台也不提示**。
   实测踩过：tokens.js 的键名写成 x3l（生成 --sp-x3l），样式表里引用 var(--sp-3xl)，
   于是所有 min-height / padding / margin 静默失效 —— 页面上唯一的表现是
   「导航链接还是 22px 高」，没有任何报错。这类错靠肉眼几乎不可能发现。 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}
const tokensSrcForVars = readMaybe(path.resolve(repo, 'web/tokens.js'));
let tokenCssOut = '';
try {
  tokenCssOut = new Function('window', tokensSrcForVars + '\n;return window.CMTokens.css();')({});
} catch (e) {
  tokenCssOut = '';
  say('    ⚠ 无法执行 tokens.js 产出变量表：' + e.message);
}
const definedVars = new Set();
for (const m of (tokenCssOut + '\n' + cssNoComments).matchAll(/(--[\w-]+)\s*:/g)) definedVars.add(m[1]);
// JS 也会在运行期设变量（如牌桌的 --k）
const refSources = [
  { label: 'site.css', text: sharedCss },
  ...STYLE_SOURCES.filter((s) => s.file !== 'web/content/site.css')
    .map((s) => ({ label: s.label, text: readMaybe(path.resolve(repo, s.file)) })),
  ...['app.js', 'pixi-table.js', 'gallery.js'].map((f) => ({ label: f, text: readMaybe(path.resolve(repo, 'web/' + f)) })),
  ...PAGES.map((p) => ({ label: p, text: readMaybe(path.join(pageDir, p)) })),
];
const varRefs = new Map();     // var 名 → 出现处
for (const src of refSources) {
  for (const m of stripComments(src.text).matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!varRefs.has(m[1])) varRefs.set(m[1], new Set());
    varRefs.get(m[1]).add(src.label);
  }
}
const undefVars = [...varRefs.keys()].filter((v) => !definedVars.has(v));
say(`\nCSS 变量闭环：引用 ${varRefs.size} 个，其中未定义的 ${undefVars.length} 个`);
if (undefVars.length) {
  for (const v of undefVars) say(`    ⚠ ${v}  ← ${[...varRefs.get(v)].slice(0, 3).join(', ')}（未定义 → 整条声明静默失效）`);
} else say('    ✅ 所有 var(--*) 都有对应的 :root 定义');

/* ── 尺度统一性：字号 / 间距 / 圆角 / 边框宽 ── */
say('\n================ 二、静态：尺度是否统一 ================');
function inventory(re, label, unit = 'px') {
  const vals = [];
  for (const m of cssNoComments.matchAll(re)) vals.push(parseFloat(m[1]));
  const uniq = [...new Set(vals)].sort((a, b) => a - b);
  say(`${label}（${uniq.length} 个不同取值${unit === 'em' ? '' : ''}）：${uniq.join(', ')}`);
  return uniq;
}
const fontSizes = inventory(/font-size:\s*([\d.]+)px/g, 'font-size');
const gaps = inventory(/(?:margin|padding|gap):[^;}]*?([\d.]+)px/g, 'margin/padding/gap 里出现的 px');
const radii = inventory(/border-radius:\s*([\d.]+)px/g, 'border-radius');
const borders = inventory(/border(?:-top|-bottom|-left|-right)?(?:-width)?:\s*([\d.]+)px/g, 'border/border-width');

// 尺度体检：字号是否落在 4px 步长以外的碎值；间距是否过多碎片
const fontOffScale = fontSizes.filter((v) => !Number.isInteger(v * 2));   // 允许 .5
say(`\n字号：${fontSizes.length} 个不同值，其中 ${(fontSizes.length - fontSizes.filter((v) => [11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32].includes(v)).length)} 个不在 11/12/13/14/15/16/18/20/22/24/28/32 这套阶梯上（阶梯外的值是最常见的「层次发虚」来源）`);
if (fontOffScale.length) say('    阶梯外的字号：' + fontOffScale.join(', '));
say(`圆角：${radii.length} 个不同值 → 建议收敛到 3 档（小控件 / 卡片 / 大面板）`);
say(`边框宽：${borders.length} 个不同值（${borders.join(', ')}）→ 建议收敛到 2 档（1px 描边 / 大左侧色条）`);

if (STATIC_ONLY) {
  const txt = out.join('\n');
  writeFileSync(path.resolve(here, '_ui-audit.txt'), txt + '\n', 'utf8');
  console.log('RESULT ui-audit static done');
  process.exit(0);
}

/* ══════════════════════ 三、真机段 ══════════════════════ */
/** 页面内执行的版式体检（返回结构化数据，判定放在 Node 侧，便于调阈值）
 *
 *  ⚠ 口径教训（第一版报出 18 万处「重叠」，全是假阳性，报告直接不可用）：
 *   1. **SVG 内部元素不算版式** —— `<rect>`/`<g>`/`<path>`/`<line>` 在同一个 `<svg>` 里
 *      本来就是一层层叠着画的，相交是设计而非 bug。一张牌面 SVG 内部就能刷出上万个「重叠」。
 *      凡 `ownerSVGElement` 非空的元素，一律排除。
 *   2. **行内元素要用「行片段」比较，不能用 getBoundingClientRect** ——
 *      一个跨行的 `<b>` 的包围盒会横跨两行，把它后面行上的 `<span>` 整个包进去，
 *      于是每个跨行加粗都报一次「75% 相交」。改用 getClientRects() 的逐行片段比较。
 *   3. **定位元素之间的交叠是刻意的** —— 抽屉、遮罩、sticky 顶栏本来就压在内容上。
 *      参与比较的双方只要有一个是 absolute/fixed，就跳过。
 */
const PROBE = `(function(){
  var de = document.documentElement;
  var W = de.clientWidth, H = de.clientHeight;
  var r = { W: W, H: H, scrollW: de.scrollWidth, bodyScrollW: document.body.scrollWidth,
            overflowX: [], clipped: [], tightLH: [], smallTap: [], tapSoft: [], childOut: [], overlap: [],
            fonts: {}, spacings: {}, radii: {}, borders: {}, zeroH: [], navCover: null };

  function cs(e){ return getComputedStyle(e); }
  function inSvg(e){ return !!(e.ownerSVGElement) || e.tagName.toLowerCase() === 'svg'; }
  function isPositioned(e){ var p = cs(e).position; return p === 'absolute' || p === 'fixed'; }
  function vis(e){
    var c = cs(e);
    if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false;
    var b = e.getBoundingClientRect();
    return b.width > 0.5 && b.height > 0.5;
  }
  function name(e){
    var s = e.tagName.toLowerCase();
    if (e.id) s += '#' + e.id;
    else if (e.className && typeof e.className === 'string') s += '.' + e.className.trim().split(/\\s+/).slice(0,2).join('.');
    return s;
  }
  /** 逐行片段：行内元素跨行时必须按片段比，否则包围盒会假性横跨多行 */
  function frags(e){
    var out = [], list = e.getClientRects();
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.width > 0.5 && b.height > 0.5) out.push({ l: b.left, t: b.top, r: b.right, bo: b.bottom });
    }
    return out;
  }
  function fragHit(a, b){
    for (var i = 0; i < a.length; i++) for (var j = 0; j < b.length; j++) {
      var ox = Math.min(a[i].r, b[j].r) - Math.max(a[i].l, b[j].l);
      var oy = Math.min(a[i].bo, b[j].bo) - Math.max(a[i].t, b[j].t);
      if (ox > 1.5 && oy > 1.5) return ox * oy;
    }
    return 0;
  }

  var all = document.querySelectorAll('body *');
  var VIS = [];
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    if (inSvg(e)) continue;                 // ① SVG 内部不参与版式判定
    if (vis(e)) VIS.push(e);
  }

  // ① 越出视口（横向）。可横向滚动的祖先内部不算越界。
  function inScroller(e){
    var p = e.parentElement;
    while (p && p !== document.body) {
      var ox = cs(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  }
  for (var i = 0; i < VIS.length; i++) {
    var e = VIS[i], c = cs(e);
    if (c.position === 'fixed' || c.position === 'sticky') continue;
    var rr = frags(e); if (!rr.length) continue;
    var minL = Infinity, maxR = -Infinity;
    for (var k = 0; k < rr.length; k++) { if (rr[k].l < minL) minL = rr[k].l; if (rr[k].r > maxR) maxR = rr[k].r; }
    if ((maxR > W + 1 || minL < -1) && !inScroller(e)) {
      r.overflowX.push(name(e) + ' [' + Math.round(minL) + '..' + Math.round(maxR) + '] vs 视口 0..' + W
        + '（越出 ' + Math.round(Math.max(maxR - W, -minL)) + 'px）');
    }
  }

  // ② 子元素越出父容器内容盒（父容器不可滚动时才算）
  for (var i = 0; i < VIS.length; i++) {
    var e = VIS[i], p = e.parentElement;
    if (!p || p === document.body || p === document.documentElement || inSvg(p)) continue;
    var pc = cs(p);
    if (pc.overflow !== 'visible') continue;
    if (isPositioned(e) || isPositioned(p)) continue;
    var pb = p.getBoundingClientRect(), eb = e.getBoundingClientRect();
    if (eb.width <= 0.5 || pb.width <= 0.5 || eb.width > pb.width + 1) continue;
    if (eb.right > pb.right + 1.5) r.childOut.push(name(e) + ' 越出父 ' + name(p) + ' 右侧 ' + Math.round(eb.right - pb.right) + 'px');
    if (eb.left < pb.left - 1.5) r.childOut.push(name(e) + ' 越出父 ' + name(p) + ' 左侧 ' + Math.round(pb.left - eb.left) + 'px');
  }

  // ③ 同级元素相交（重叠）—— 按行片段比，跳过定位元素
  var byParent = new Map();
  for (var i = 0; i < VIS.length; i++) {
    var p = VIS[i].parentElement; if (!p || inSvg(p)) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(VIS[i]);
  }
  byParent.forEach(function(list){
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var a = list[i], b = list[j];
      if (isPositioned(a) || isPositioned(b)) continue;      // 刻意的图层叠加
      var fa = frags(a), fb = frags(b);
      if (!fa.length || !fb.length) continue;
      var area = fragHit(fa, fb);
      if (!area) continue;
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var small = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (small > 0 && area / small > 0.06) {
        r.overlap.push(name(a) + ' × ' + name(b) + ' 相交 ' + Math.round(area) + 'px²（占较小者 ' + Math.round(area / small * 100) + '%）');
      }
    }
  });

  // ④ 文字被裁：叶子元素横向溢出（排除刻意省略号）
  for (var i = 0; i < VIS.length; i++) {
    var e = VIS[i];
    if (e.children.length || inSvg(e)) continue;
    var t = (e.textContent || '').trim();
    if (t.length < 2) continue;
    var c = cs(e);
    if (c.whiteSpace.indexOf('nowrap') >= 0 && c.textOverflow !== 'clip') continue;
    if (e.scrollWidth > e.clientWidth + 1.5 && e.clientWidth > 0) {
      r.clipped.push(name(e) + ' scrollW=' + e.scrollWidth + ' clientW=' + e.clientWidth + ' :: ' + t.slice(0, 34));
    }
  }

  // ⑤ 行高过紧：文字多的叶子，行高/字号 < 1.15
  var TEXTY = 'p,li,td,th,dd,dt,blockquote,div,span,a,h1,h2,h3,h4,h5';
  for (var i = 0; i < VIS.length; i++) {
    var e = VIS[i];
    if (TEXTY.indexOf(e.tagName.toLowerCase()) < 0 || e.children.length || inSvg(e)) continue;
    var t = (e.textContent || '').trim();
    if (t.length < 28) continue;
    var c = cs(e);
    var fs = parseFloat(c.fontSize), lh = c.lineHeight === 'normal' ? fs * 1.18 : parseFloat(c.lineHeight);
    if (!fs || !lh) continue;
    var ratio = lh / fs;
    if (ratio < 1.15) r.tightLH.push(name(e) + ' 行高/字号=' + ratio.toFixed(2) + '（' + fs + '/' + lh.toFixed(1) + '）');
  }

  // ⑥ 点击目标。
  //    阈值（显式写在这里，避免"把门槛调到全绿"这种自欺）：
  //      <24px  → 违规（WCAG 2.5.8 AA 的最小目标尺寸是 24×24 CSS px）
  //      24~31px → 建议（舒适目标通常取 32px+；本站的按钮/导航统一按下限 32px 实现）
  //    **豁免**：正文句子里的行内链接（display:inline）。WCAG 2.5.8 对
  //    「句子或文本块内联的链接」有明确例外 —— 它们的"尺寸"就是文字本身，
  //    强行加 padding 会破坏行距与换行。行内块（inline-block/flex）不豁免。
  var tap = document.querySelectorAll('a,button,input,select,summary');
  for (var i = 0; i < tap.length; i++) {
    var e = tap[i];
    if (!vis(e) || inSvg(e)) continue;
    var disp = cs(e).display;
    if (disp === 'inline' && e.tagName.toLowerCase() === 'a') continue;   // 正文内联链接
    var b = e.getBoundingClientRect();
    var rec = name(e) + ' ' + Math.round(b.width) + '×' + Math.round(b.height) + ' “' + (e.textContent || '').trim().slice(0, 18) + '”';
    if (b.height < 24) r.smallTap.push(rec);
    else if (b.height < 32) r.tapSoft.push(rec);
  }

  // ⑦ 尺度清单：实际用到的字号 / 间距 / 圆角 / 边框宽
  for (var i = 0; i < VIS.length; i++) {
    var c = cs(VIS[i]);
    r.fonts[c.fontSize] = (r.fonts[c.fontSize] || 0) + 1;
    r.radii[c.borderTopLeftRadius] = (r.radii[c.borderTopLeftRadius] || 0) + 1;
    r.borders[c.borderTopWidth + ' ' + c.borderBottomWidth] = (r.borders[c.borderTopWidth + ' ' + c.borderBottomWidth] || 0) + 1;
    var keys = ['marginTop','marginBottom','marginLeft','marginRight','paddingTop','paddingBottom','paddingLeft','paddingRight'];
    for (var k = 0; k < keys.length; k++) {
      var v = c[keys[k]];
      if (v === '0px') continue;
      r.spacings[v] = (r.spacings[v] || 0) + 1;
    }
  }

  // ⑧ 有内容但高度塌成 0
  for (var i = 0; i < VIS.length; i++) {
    var e = VIS[i];
    var t = (e.textContent || '').trim();
    if (!t || inSvg(e)) continue;
    if (e.getBoundingClientRect().height < 1) r.zeroH.push(name(e) + ' :: ' + t.slice(0, 24));
  }

  // ⑨ sticky 导航是否压住首屏内容
  var nav = document.querySelector('nav');
  if (nav) {
    var nb = nav.getBoundingClientRect();
    var hd = document.querySelector('.wrap > header, .wrap > h2');
    if (hd) {
      var hb = hd.getBoundingClientRect();
      r.navCover = { navH: Math.round(nb.height), gap: Math.round(hb.top - nb.bottom) };
    }
  }
  return r;
})()`;

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 200);
const ud = mkdtempSync(path.join(tmpdir(), 'cmui-'));
const first = 'file:///' + path.join(dist, PAGES[0]).replace(/\\/g, '/');
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${ud}`, first,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pageTarget() {
  for (let i = 0; i < 90; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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

const target = await pageTarget();
// Node 22 起 WebSocket 是全局对象（undici 实现），不必额外依赖
ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((res) => ws.addEventListener('open', res));
await cmd('Runtime.enable');
await cmd('Page.enable');

say('\n================ 三、真机：错位 / 重叠 / 越界 / 字号行高 ================');
const findings = { overflow: 0, overlap: 0, clipped: 0, tightLH: 0, childOut: 0, smallTap: 0 };
const fontAgg = {}, spaceAgg = {}, radiusAgg = {}, borderAgg = {};

for (const page of PAGES) {
  const file = path.join(dist, page);
  if (!existsSync(file)) { say(`\n— ${page}：dist 里不存在（先 npm run build）`); continue; }
  await cmd('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  await sleep(page === 'play.html' ? 2600 : 420);
  for (const vp of VIEWPORTS) {
    await cmd('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
    });
    await sleep(page === 'play.html' ? 700 : 220);
    const r = await ev(PROBE);
    if (!r || r.__err) { say(`\n— ${page} @ ${vp.tag}：探针失败 ${r && r.__err}`); continue; }
    const issues = [];
    if (r.scrollW > r.W + 1) issues.push(`页面横向溢出：scrollW=${r.scrollW} > ${r.W}（会出现横向滚动条）`);
    if (r.overflowX.length) { issues.push(`元素越出视口 ${r.overflowX.length} 处`); findings.overflow += r.overflowX.length; }
    if (r.childOut.length) { issues.push(`子元素越出父容器 ${r.childOut.length} 处`); findings.childOut += r.childOut.length; }
    if (r.overlap.length) { issues.push(`同级元素相交 ${r.overlap.length} 处`); findings.overlap += r.overlap.length; }
    if (r.clipped.length) { issues.push(`文字被裁 ${r.clipped.length} 处`); findings.clipped += r.clipped.length; }
    if (r.tightLH.length) { issues.push(`行高过紧 ${r.tightLH.length} 处`); findings.tightLH += r.tightLH.length; }
    if (vp.mobile && r.smallTap.length) { issues.push(`点击目标 <24px ${r.smallTap.length} 处`); findings.smallTap += r.smallTap.length; }
    if (vp.mobile && r.tapSoft.length) { issues.push(`点击目标 24~31px ${r.tapSoft.length} 处（建议，本站下限取 32px）`); findings.tapSoft = (findings.tapSoft || 0) + r.tapSoft.length; }
    say(`\n— ${page} @ ${vp.tag}  视口 ${r.W}×${r.H}  ${issues.length ? '⚠ ' + issues.join('；') : '✅ 无问题'}`);
    const dump = (arr, cap = 6) => arr.slice(0, cap).forEach((x) => say('      · ' + x));
    dump(r.overflowX); dump(r.childOut); dump(r.overlap); dump(r.clipped); dump(r.tightLH);
    if (vp.mobile) { dump(r.smallTap); dump(r.tapSoft); }
    for (const k in r.fonts) fontAgg[k] = (fontAgg[k] || 0) + r.fonts[k];
    for (const k in r.radii) if (k !== '0px') radiusAgg[k] = (radiusAgg[k] || 0) + r.radii[k];
    for (const k in r.borders) borderAgg[k] = (borderAgg[k] || 0) + r.borders[k];
    for (const k in r.spacings) spaceAgg[k] = (spaceAgg[k] || 0) + r.spacings[k];
    if (r.navCover && r.navCover.gap < 0) say(`      · ⚠ sticky 导航压住首屏内容：gap=${r.navCover.gap}px`);
  }
}

say('\n================ 四、真机实测的尺度清单（全站汇总） ================');
const sorted = (o) => Object.entries(o).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
say('\n实际渲染用到的 font-size：');
say('    ' + sorted(fontAgg).map(([k, v]) => `${k}(×${v})`).join('  '));
say('\n实际渲染用到的 margin/padding（非 0）：');
say('    ' + sorted(spaceAgg).map(([k, v]) => `${k}(×${v})`).join('  '));
say('\n实际渲染用到的 border-radius（非 0）：');
say('    ' + sorted(radiusAgg).map(([k, v]) => `${k}(×${v})`).join('  '));
say('\n实际渲染用到的 border-top/bottom-width：');
say('    ' + sorted(borderAgg).map(([k, v]) => `"${k}"(×${v})`).join('  '));

say('\n================ 五、汇总 ================');
say('判定口径：<24px 违规（WCAG 2.5.8 AA）｜24~31px 建议（本站下限 32px）｜正文内联链接按 WCAG 例外豁免');
say(`越出视口 ${findings.overflow} · 越出父容器 ${findings.childOut} · 同级相交 ${findings.overlap} · 文字被裁 ${findings.clipped} · 行高过紧 ${findings.tightLH} · 点击目标 <24px ${findings.smallTap} · 24~31px(建议) ${findings.tapSoft || 0}`);
const hard = findings.overflow + findings.childOut + findings.overlap + findings.clipped + findings.tightLH + findings.smallTap;
say(hard === 0 ? '✅ 未发现错位 / 重叠 / 越界 / 裁切 / 行高 / 点击目标问题' : `⚠ 硬问题 ${hard} 处待修`);

const txt = out.join('\n');
writeFileSync(path.resolve(here, '_ui-audit.txt'), txt + '\n', 'utf8');
console.log('RESULT ui-audit done');
ws.close();
chrome.kill();
process.exit(0);
