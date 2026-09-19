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

console.log(`\n=== 资产页冒烟：${pass} passed, ${fail} failed ===`);
if (fail) process.exitCode = 1;
