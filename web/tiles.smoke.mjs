/** 资产总览页冒烟：jsdom 加载 tiles.html，断言 27 张牌面 + 牌背 + 无脚本错误。 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 依赖解析：项目本地 node_modules 优先；CHUANMA_DEPS 可指定含依赖的目录
const require = createRequire(
  process.env.CHUANMA_DEPS
    ? path.join(process.env.CHUANMA_DEPS.replace(/[\\/]+$/, ''), 'noop.js')
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'noop.js')
);
const { JSDOM, VirtualConsole } = require('jsdom');

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.resolve(here, 'dist/tiles.html'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + ((e && (e.stack || e.message)) || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', virtualConsole: vc,
  beforeParse(w) { w.addEventListener('error', (ev) => errors.push('onerror: ' + (ev.error ? ev.error.stack : ev.message))); },
});
const doc = dom.window.document;

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  → ' + x : '')); } };
const qa = (s) => Array.from(doc.querySelectorAll(s));

check('脚本无运行时错误', errors.length === 0, errors.join(' | '));
check('万/条/筒各 9 张 = 27 个牌面单元', qa('#gWan .cell').length === 9 && qa('#gTiao .cell').length === 9 && qa('#gTong .cell').length === 9,
  `${qa('#gWan .cell').length}/${qa('#gTiao .cell').length}/${qa('#gTong .cell').length}`);
check('牌面用 SVG 渲染', qa('#gWan svg').length === 9 && qa('#gTong svg').length === 9);
check('牌背区有 SVG', qa('#gBack svg').length >= 1);
check('实战尺寸预览有手牌', qa('#fHand .tile svg').length === 14, 'got ' + qa('#fHand svg').length);
check('对手牌背 13 张', qa('#fBack .tile svg').length === 13, 'got ' + qa('#fBack svg').length);
check('全页 SVG 总数 >= 60', qa('svg').length >= 60, 'got ' + qa('svg').length);

/* ---------------- v3：字形与版式的结构性断言 ----------------
   这几条对应「改坏了也不会报错、只会静默变丑/变空」的风险点。 */
const MJ = dom.window.MJTiles;
check('字形轮廓已就位（glyphs.js 在构建链里）', !!(MJ && MJ.glyphsReady && MJ.glyphsReady()),
  '万子会退化成空白面板，且页面不会报任何错');
check('牌面报 v3 版本', !!MJ && /^3\./.test(MJ.version), MJ && MJ.version);

// 字形数据的结构完整性。
// cmds 这一条特别值：抽取脚本与 fitPath 的命令集必须同步，换字体可能带来新命令
// （实测 Noto Serif TC 产出 CHLMVZ、霞鹜文楷 TC 产出 HLMQVZ）。不同步就是成片 NaN。
const G0 = dom.window.CMGlyphs;
const SUPPORTED_CMDS = 'MLHVCQZ';
const unknownCmd = G0 && G0.cmds ? [...new Set(G0.cmds.split(''))].filter((c) => SUPPORTED_CMDS.indexOf(c) < 0) : ['(无 cmds 元数据)'];
check('字形命令集在 fitPath 支持范围内', unknownCmd.length === 0,
  '含不支持的命令 ' + unknownCmd.join('') + ' → 会产出 NaN 坐标、整字消失');
check('十个字形齐全（一二三四五六七八九萬）', !!G0 && Object.keys(G0.glyphs).length === 10,
  G0 ? Object.keys(G0.glyphs).length + ' 个' : 'glyphs 缺失');
check('字形元数据记录了来源字体与 em', !!G0 && !!G0.font && !!G0.upem,
  'font=' + (G0 && G0.font) + ' upem=' + (G0 && G0.upem));

// 字体依赖：v2 用 <text font-family="KaiTi,SimSun">，在没装楷体的设备上字形会变。
let fontDep = 0;
for (let i = 0; i < 27; i++) if (/<text|font-family/.test(MJ.face(i))) fontDep++;
if (/<text|font-family/.test(MJ.back())) fontDep++;
check('33 个牌面零字体依赖（无 <text / font-family）', fontDep === 0, fontDep + ' 张仍在用字体');

// 万子版式：字符墨迹必须落在内凹面板内，且两块不重叠。
// 版式参数与字号一改就可能越界 —— 越界后字会被裁掉一角，肉眼很容易忽略。
const L = MJ.WAN_LAYOUT, G = dom.window.CMGlyphs;
let overflow = [], overlap = 0;
if (G && L) {
  const ext = (ch, size) => {
    const b = G.glyphs[ch].b, s = size / G.upem;
    return { w: (b[2] - b[0]) * s, h: (b[3] - b[1]) * s };
  };
  let numBottom = -Infinity, charTop = Infinity;
  for (const ch of '一二三四五六七八九') {
    const e = ext(ch, L.numSize);
    numBottom = Math.max(numBottom, L.numY + e.h / 2);
    if (L.cx - e.w / 2 < 5 || L.cx + e.w / 2 > 55) overflow.push(ch + ' 横向越界');
    if (L.numY - e.h / 2 < 5 || L.numY + e.h / 2 > 79) overflow.push(ch + ' 纵向越界');
  }
  const ew = ext('萬', L.charSize);
  charTop = L.charY - ew.h / 2;
  if (L.cx - ew.w / 2 < 5 || L.cx + ew.w / 2 > 55) overflow.push('萬 横向越界');
  if (charTop < 5 || L.charY + ew.h / 2 > 79) overflow.push('萬 纵向越界');
  if (numBottom > charTop) overlap = 1;
}
check('万子墨迹不越出面板（5..55 / 5..79）', overflow.length === 0, overflow.join(', '));
check('万子数字与「萬」不重叠', overlap === 0);

// 路径拟合的坐标必须是有效数字。
// 踩过的坑：fitPath 一开始漏了 H / V 两个单坐标命令（CJK 轮廓里横竖笔画大量使用），
// 坐标整体错位后产出一串 NaN —— 字形整块消失，而浏览器与 resvg 都不报任何错。
let nan = [];
for (let i = 0; i < 27; i++) if (/NaN|undefined|Infinity/.test(MJ.face(i))) nan.push('face' + i);
if (/NaN|undefined|Infinity/.test(MJ.back())) nan.push('back');
check('牌面路径坐标无 NaN（拟合命令集完整）', nan.length === 0, nan.join(', '));

/* ==========================================================================
   v3.1：条子的红色定位节 + 8 条锯齿版式
   这几条对应「改坏了也不会报错、只会静默变样」的风险点 —— 比如红色挪了一根、
   8 条的旋转方向反了（M 变 W），肉眼要盯着 9 张条子逐张比对才能发现。
   ========================================================================== */
console.log('\n--- v3.1 条子：红色定位节 ---');

/* 取某个牌面里「红竹节」的矩形中心。红节的渐变 id 以 -tiaored 结尾（见 tiles-ui.js
   的 PAL_TIAO_RED.role），绿色竹节则是 -tiao —— 所以这是精确匹配，不会误伤绿节。
   ⚠ 必须用**全局**匹配：同一张牌上的多根红节共用同一个渐变（Defs 按参数去重），
   若只取第一处匹配，9 条的三根红节会被算成同一根（x 全等，均布断言假通过/假失败）。 */
function redCanes(id) {
  const svg = MJ.face(id);
  const re = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" rx="[-\d.]+" fill="url\(#[^"]*?-tiaored\)"\/>/g;
  const out = [];
  let m;
  while ((m = re.exec(svg)) !== null) {
    out.push({ x: +m[1] + +m[3] / 2, y: +m[2] + +m[4] / 2 });
  }
  return out.sort((a, b) => a.x - b.x);
}
function greenCanes(id) {
  return (MJ.face(id).match(/fill="url\(#[^"]*?-tiao\)"/g) || []).length;
}

const TIAO = { 5: 13, 7: 15, 9: 17 };
const wants = {
  5: { n: 1, where: '正中' },
  7: { n: 1, where: '最上' },
  9: { n: 3, where: '中间一行' },
};
for (const rank of [2, 3, 4, 5, 6, 7, 8, 9]) {
  const id = 9 + rank - 1;
  const red = redCanes(id);
  const want = wants[rank];
  if (want) {
    check(`${rank} 条有 ${want.n} 根红节（${want.where}）`, red.length === want.n,
      `实际 ${red.length} 根`);
    if (rank === 5) check('5 条红节在中间（纵向居中）', Math.abs(red[0].y - 42) < 3, 'y=' + red[0].y);
    if (rank === 7) check('7 条红节在最上面', red[0].y < 26, 'y=' + red[0].y);
    if (rank === 9) {
      const ys = red.map((r) => r.y), xs = red.map((r) => r.x).sort((a, b) => a - b);
      check('9 条红节三根共处一行（纵向居中）', ys.every((y) => Math.abs(y - 42) < 3), 'y=' + ys.join(','));
      check('9 条红节三根横向均布', Math.abs(xs[0] - 17.8) < 2.5 && Math.abs(xs[1] - 30) < 2.5 && Math.abs(xs[2] - 42.2) < 2.5,
        'x=' + xs.join(','));
    }
  } else {
    check(`${rank} 条无红节（红只用在 5 / 7 / 9）`, red.length === 0, `实际 ${red.length} 根`);
  }
}
check('1 条是鸟、不是竹节（红冠用 comb 色，不计入红节）', redCanes(9).length === 0 && greenCanes(9) === 0);

console.log('\n--- v3.2 条子：8 条「两竖 + 山形」×2 ---');
{
  const svg8 = MJ.face(16);
  const n8 = (svg8.match(/fill="url\(#[^"]*?-tiao\)"/g) || []).length;
  check('8 条共 8 根竹节', n8 === 8, '实际 ' + n8);

  // 从解算结果断言「形状语义」而不是只断言数字 —— 这样「竖杆被改成斜的」「山形翻面」
  // 这类会毁掉辨识度的错，才会被抓住（它们不会让任何数值越界）。
  const segs = MJ.tiao8Segments();
  const verticals = segs.filter((s) => s.kind === 'v');
  const apex = segs.filter((s) => s.kind === 'apex');
  check('8 条 = 4 根竖杆 + 4 根山形斜杆', verticals.length === 4 && apex.length === 4,
    `竖 ${verticals.length} / 斜 ${apex.length}`);
  check('8 条的 4 根竖杆完全竖直（rot = 0）', verticals.every((s) => s.rot === 0),
    verticals.map((s) => s.rot).join(','));
  const angs = apex.map((s) => Math.abs(s.rot));
  check('8 条山形斜杆比竖直方向斜得多（35°~50°）', angs.every((a) => a > 35 && a < 50),
    angs.map((a) => a.toFixed(1) + '°').join(','));
  check('8 条山形左右镜像（±角成对）',
    Math.abs(angs[0] - angs[1]) < 1e-6 && Math.abs(angs[2] - angs[3]) < 1e-6,
    angs.map((a) => a.toFixed(2)).join(','));
  const vLen = verticals[0].len;
  check('8 条山形斜杆比竖杆短（0.6~0.9 倍）',
    apex.every((s) => s.len / vLen > 0.6 && s.len / vLen < 0.9),
    (apex[0].len / vLen).toFixed(3) + ' 倍');
  check('8 条两根竖杆撑到整幅左右两端（比常规内区更外）',
    MJ.TIAO8.uSide[0] < 0 && MJ.TIAO8.uSide[1] > 1, MJ.TIAO8.uSide.join(','));
  // 上下两组镜像：斜杆的 cy 分别落在自己的组带内，且两组方向相反（上 ∧ / 下 ∨）
  check('8 条上组是 ∧、下组是 ∨（上下镜像，中间留空）',
    apex[0].rot > 0 && apex[2].rot < 0 && apex[0].cy < apex[2].cy,
    `rot ${apex[0].rot.toFixed(1)} / ${apex[2].rot.toFixed(1)}，cy ${apex[0].cy.toFixed(1)} / ${apex[2].cy.toFixed(1)}`);

  // 独立复算：把 8 根的旋转矩形四角算出来，断言全部落在内凹面板内（5..55 / 5..79）。
  // 越界的话牌面会被面板裁掉一角 —— 这类问题在指纹里几乎看不出来（面积占比太小）。
  const outside = [];
  for (const s of segs) {
    const th = s.rot * Math.PI / 180;
    const ux = Math.sin(th), uy = Math.cos(th);      // 长度方向
    const wx = Math.cos(th), wy = -Math.sin(th);     // 宽度方向
    for (const sl of [-1, 1]) for (const sw of [-1, 1]) {
      const px = s.cx + sl * (s.len / 2) * ux + sw * (MJ.TIAO8.w / 2) * wx;
      const py = s.cy + sl * (s.len / 2) * uy + sw * (MJ.TIAO8.w / 2) * wy;
      if (px < 5 || px > 55 || py < 5 || py > 79) outside.push(`${s.kind}=${px.toFixed(1)},${py.toFixed(1)}`);
    }
  }
  check('8 条 8 根竹节全部落在面板内（不被裁角）', outside.length === 0, outside.join(' '));

  // 竖杆与斜杆必须互不重叠（叠在一起会糊成一团，M 就读不出来了）
  const vxs = verticals.map((s) => s.cx).sort((a, b) => a - b);
  const legIn = apex.map((s) => s.cx).sort((a, b) => a - b);
  check('8 条斜杆整体落在两根竖杆之间（不糊在一起）',
    legIn[0] - MJ.TIAO8.w / 2 > vxs[0] + MJ.TIAO8.w / 2 && legIn[3] + MJ.TIAO8.w / 2 < vxs[3] - MJ.TIAO8.w / 2,
    `竖杆 ${vxs.join(',')} / 斜杆 ${legIn.join(',')}`);

  check('其余条子不带旋转（输出逐字节不变）',
    [11, 12, 13, 14, 15, 17].every((i) => !/<g transform="rotate\(/.test(MJ.face(i))));
}

console.log('\n--- v3.2 条子：1 条 = 幺鸡 ---');
{
  const svg1 = MJ.face(9);
  check('1 条没有竹节（唯一不按数量表达的条子）', greenCanes(9) === 0 && redCanes(9).length === 0);
  // 简笔画（几个基本图元）与「整幅彩绘」的区别，用图元数量兜住：
  // 冠 3 根 + 喙 2 瓣 + 眼 2 + 尾羽 3 + 翅 1 + 体 1 + 头 1 + 结 3 + 足 5 + 影 1 ≈ 20+
  const shapes = (svg1.match(/<(path|ellipse|circle)\b/g) || []).length;
  check('1 条是整幅彩绘（≥ 16 个图元：冠/喙/眼/颈/翅/尾/足/结）', shapes >= 16, '实际 ' + shapes);
  // 红件数量用**令牌里的朱红**来数，不写死色值：色板改了（tokens.js 一处），断言仍成立。
  const red = (dom.window.CMTokens && dom.window.CMTokens.tiao.comb) || '#c0392b';
  const redParts = (svg1.match(new RegExp('fill="' + red + '"', 'gi')) || []).length;
  check('1 条的红贯穿头尾（三根红冠 + 尾根红结 ≥ 5 件）', redParts >= 5, '实际 ' + redParts + ' 件');
}

/* ==========================================================================
   识牌教学页（learn-tiles.html）
   它是内容页里唯一挂着牌面资产的一页：讲哪张牌就画哪张牌。这里断言
   「占位符真的被填上了」以及「两个练习真的初始化了」—— 脚本链断了的话页面
   不会报错，只会安安静静地少一半内容。
   ========================================================================== */
console.log('\n--- 识牌教学页（learn-tiles.html） ---');
const errors2 = [];
const vc2 = new VirtualConsole();
vc2.on('jsdomError', (e) => errors2.push('jsdomError: ' + ((e && (e.stack || e.message)) || e)));
vc2.on('error', (...a) => errors2.push('console.error: ' + a.join(' ')));
const dom2 = new JSDOM(readFileSync(path.resolve(here, 'dist/learn-tiles.html'), 'utf8'), {
  runScripts: 'dangerously', virtualConsole: vc2,
  beforeParse(w) { w.addEventListener('error', (ev) => errors2.push('onerror: ' + (ev.error ? ev.error.stack : ev.message))); },
});
const doc2 = dom2.window.document;
const q2 = (s) => Array.from(doc2.querySelectorAll(s));

check('识牌页脚本无运行时错误', errors2.length === 0, errors2.join(' | '));
check('一副牌总览：3 行 × 9 张 = 27 个牌面',
  q2('.suitrow').length === 3 && q2('#deck .cell').length === 27,
  `${q2('.suitrow').length} 行 / ${q2('#deck .cell').length} 张`);
check('总览每张牌都画出了 SVG', q2('#deck .cell svg').length === 27, 'got ' + q2('#deck .cell svg').length);

// 正文里的 [data-face] 占位符必须全部填满：漏一个就是教学页少一张图，页面不报错。
const holders = q2('[data-face]');
const emptyHolders = holders.filter((h) => !h.querySelector('svg')).length;
check(`正文牌面占位符全部填上（${holders.length} 处）`, holders.length > 0 && emptyHolders === 0,
  emptyHolders + ' 处是空的');
const wantFaces = holders.reduce((n, h) => n + h.getAttribute('data-face').split(',').filter((t) => t.trim()).length, 0);
check('占位符总数与声明一致', q2('.face svg').length >= wantFaces,
  `声明 ${wantFaces} / 实渲染 ${q2('.face svg').length}`);
check('颜色锚点四张条子都在（5 / 7 / 8 / 9）',
  q2('.landmark .lm').length === 4 && q2('.landmark .lm .face svg').length === 4,
  `${q2('.landmark .lm').length} 张`);

check('练习 A（认牌）已初始化：一张题面 + 4 个选项',
  !!doc2.querySelector('#drillName .q svg') && doc2.querySelectorAll('#drillName .opts button[data-id]').length === 4,
  `题面 ${doc2.querySelectorAll('#drillName .q svg').length} / 选项 ${doc2.querySelectorAll('#drillName .opts button').length}`);
check('练习 B（定缺）已初始化：13 张手牌 + 3 个花色选项',
  doc2.querySelectorAll('#drillVoid .hand svg').length === 13 && doc2.querySelectorAll('#drillVoid .opts button[data-suit]').length === 3,
  `手牌 ${doc2.querySelectorAll('#drillVoid .hand svg').length} / 选项 ${doc2.querySelectorAll('#drillVoid .opts button').length}`);
check('教学页牌面零字体依赖', !/<text|font-family/.test(q2('.face svg')[0] ? q2('.face svg')[0].outerHTML : ''));

console.log(`\n=== 资产页冒烟：${pass} passed, ${fail} failed ===`);
if (fail) process.exitCode = 1;
