/**
 * chuan.ma 牌面「升级前后」对照工具
 * ---------------------------------------------------------------------------
 * 两个用途：
 *  1) 出一张 before / after 并排联系表 PNG（交人目视终审 —— 模型读不了图，
 *     所以像素指纹负责「拦退化」，人眼负责「判好不好看」，两者分工）。
 *  2) 报三档尺寸的可辨识度（大 132×185 / 中 64×90 / 小 33×46）。
 *     这是质感的**真实风险点**：加了渐变、纹理、高光之后，牌在牌河里只有 33×46，
 *     很容易糊成一团花色分不出的色块。所以必须量「小尺寸下 detail 还剩多少」。
 *
 * 用法：
 *   node web/visual-compare.mjs                      # 旧版取 git HEAD，新版取工作区
 *   node web/visual-compare.mjs --old <file>          # 指定旧版资产文件
 * 产出：web/baseline/compare-before-after.png
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  process.env.CHUANMA_DEPS
    ? path.join(process.env.CHUANMA_DEPS.replace(/[\\/]+$/, ''), 'noop.js')
    : path.join(here, '..', 'noop.js')
);
const { Resvg } = require('@resvg/resvg-js');
const { PNG } = require('pngjs');

const ARGV = process.argv.slice(2);
const oldArg = ARGV.indexOf('--old');
// before 基准取**仓库内固化快照**，不取 git HEAD ——
// 仓库有自动化会推进 HEAD 并清理临时文件，靠 HEAD/临时文件取旧版会取到新版，
// 对照图会变成「自己跟自己比」（实测两版 detail 完全一致 0.0%，白忙一轮）。
//
// 默认取「**序号最大的快照**」＝ 上一版已接受的资产，也就是这一轮改动的增量。
// 别写死 -v2 / -v1：每加一轮就要改代码，而且很容易忘了改，于是静默地拿两轮前的
// 资产当基准（本轮实际踩到：v3 已入库，但默认仍指向 v2，对照的是两轮前的画法）。
const dir = path.resolve(here, 'baseline');
const snapshots = existsSync(dir)
  // 快照名允许带小档（tiles-ui-v3.1.js）—— 版本一旦有 3.1 / 3.2，只认 \d+ 会让新快照
  // 被静默忽略，对照基准又退回上一档，diff 里混进两轮改动。
  ? readdirSync(dir).filter((f) => /^tiles-ui-v[\d.]+\.js$/.test(f))
    .sort((a, b) => parseFloat(a.match(/([\d.]+)\.js/)[1]) - parseFloat(b.match(/([\d.]+)\.js/)[1]))
  : [];
let oldFile;
if (oldArg >= 0 && ARGV[oldArg + 1]) oldFile = path.resolve(here, ARGV[oldArg + 1]);
else if (snapshots.length) oldFile = path.join(dir, snapshots[snapshots.length - 1]);
else {
  console.error('缺少 before 基准（web/baseline/tiles-ui-v*.js）\n' +
    '请先运行 node web/fix-baseline.cjs <commit> <v1|v2|v3> 从 git 固化快照。');
  process.exit(1);
}
if (!existsSync(oldFile)) { console.error('before 资产不存在：' + oldFile); process.exit(1); }
console.log('对照基准：' + path.relative(here, oldFile));

const tokensSrc = readFileSync(path.resolve(here, 'tokens.js'), 'utf8');
const glyphsSrc = readFileSync(path.resolve(here, 'glyphs.js'), 'utf8');
function loadMJ(file) {
  const win = {};
  new Function('window', tokensSrc)(win);
  new Function('window', glyphsSrc)(win);
  new Function('window', readFileSync(file, 'utf8'))(win);
  if (!win.MJTiles) throw new Error('未挂载 MJTiles: ' + file);
  return win.MJTiles;
}
const MJold = loadMJ(oldFile);
const MJnew = loadMJ(path.resolve(here, 'tiles-ui.js'));

const TW = 132, TH = 185;
const ids = [];
for (let i = 0; i < 27; i++) ids.push(i);
const cases = ids.map((i) => ({ key: 'face' + i, id: i }));
cases.push({ key: 'back', id: -1 });
const svgOf = (MJ, id) => (id === -1 ? MJ.back() : MJ.face(id));

/* ⚠ before/after 必须用**不同的字体开关**，这不是同口径光栅化，是刻意的：
 *   before（v2 及更早）用 <text>+系统楷体 → 必须开 loadSystemFonts，否则字是空的；
 *   after（v3）用内嵌矢量路径 → 关掉 loadSystemFonts，与本机字体彻底无关。
 *
 *   这里踩过一个大坑：调用点漏传第四个参数时 sysFonts=undefined，
 *   before 侧就静默变成「没开字体」—— v2 的数字字形整批不渲染，
 *   小尺寸表格凭空报出「+113%~217%」的假提升（实测被误导了一轮）。
 *   所以这里不设默认值，传错类型直接抛错。 */
function raster(svg, w, h, sysFonts) {
  if (typeof sysFonts !== 'boolean') {
    throw new Error('raster: 第 4 个参数 sysFonts 必须是布尔值（漏传会让 before 侧静默不渲染字形）');
  }
  const sized = svg.replace('width="100%" height="100%"', `width="${w}" height="${h}"`);
  const r = new Resvg(sized, {
    fitTo: { mode: 'width', value: w }, font: { loadSystemFonts: sysFonts }, background: '#14503a',
  });
  return PNG.sync.read(Buffer.from(r.render().asPng()));
}
// 版本与其渲染口径绑定在一起 —— 调用点拿不到「忘记配对」的机会
const VERSIONS = [
  { tag: 'before', MJ: MJold, sysFonts: true },
  { tag: 'after', MJ: MJnew, sysFonts: false },
];
const renderOne = (v, id, w, h) => raster(svgOf(v.MJ, id), w, h, v.sysFonts);

/* ---------------- ① 三档尺寸的可辨识度 ---------------- */
const SIZES = [{ tag: '大 132x185', w: 132, h: 185 }, { tag: '中 64x90', w: 64, h: 90 }, { tag: '小 33x46', w: 33, h: 46 }];
function detailOf(png) {
  const { width: W, height: H, data: D } = png;
  let dSum = 0, dN = 0, ink = 0;
  for (let y = 1; y < H; y++) {
    for (let x = 1; x < W; x++) {
      const i = (y * W + x) * 4, j = (y * W + x - 1) * 4, k = ((y - 1) * W + x) * 4;
      const l = 0.299 * D[i] + 0.587 * D[i + 1] + 0.114 * D[i + 2];
      const ll = 0.299 * D[j] + 0.587 * D[j + 1] + 0.114 * D[j + 2];
      const lu = 0.299 * D[k] + 0.587 * D[k + 1] + 0.114 * D[k + 2];
      dSum += Math.abs(l - ll) + Math.abs(l - lu); dN += 2;
    }
  }
  for (let i = 0; i < D.length; i += 4) {
    const r = D[i], g = D[i + 1], b = D[i + 2];
    if ((r > 150 && g > 139 && b > 117) || (b > r + 45 && b > 110)) ink++;
  }
  return { detail: dSum / Math.max(1, dN), ink: ink / (W * H) };
}

const report = [];
report.push('=== 三档尺寸可辨识度（detail = 相邻像素亮度差均值；越高越「看得出结构」） ===');
report.push('尺寸          牌      before   after    变化');
let worst = { key: '', drop: 0 };
for (const sz of SIZES) {
  let sa = 0, sb = 0;
  for (const c of cases) {
    const a = detailOf(renderOne(VERSIONS[0], c.id, sz.w, sz.h));
    const b = detailOf(renderOne(VERSIONS[1], c.id, sz.w, sz.h));
    sa += a.detail; sb += b.detail;
    const ratio = a.detail ? (b.detail - a.detail) / a.detail : 0;
    // 只详列「小尺寸 + 变化最大」的牌，避免刷屏
    if (sz.w === 33 && Math.abs(ratio) > 0.08) {
      report.push(`${sz.tag.padEnd(12)} ${c.key.padEnd(7)} ${a.detail.toFixed(2).padStart(6)}  ${b.detail.toFixed(2).padStart(6)}  ${(ratio * 100).toFixed(1).padStart(6)}%`);
    }
    if (sz.w === 33 && ratio < worst.drop) worst = { key: c.key, drop: ratio };
  }
  report.push(`  ${sz.tag.padEnd(12)} 均值   ${(sa / cases.length).toFixed(2).padStart(6)}  ${(sb / cases.length).toFixed(2).padStart(6)}  ${(((sb - sa) / sa) * 100).toFixed(1).padStart(6)}%`);
}
report.push('');
report.push(worst.key ? `小尺寸下 detail 降幅最大：${worst.key} ${(worst.drop * 100).toFixed(1)}%` : '小尺寸下无显著退化');

/* ---------------- ② before / after 并排联系表 ---------------- */
function sheetBlock(MJ, ox, oy, cols, gap, pad, label) {
  const rows = Math.ceil(cases.length / cols);
  let inner = '';
  cases.forEach((c, i) => {
    const cx = ox + pad + (i % cols) * (TW + gap);
    const cy = oy + pad + Math.floor(i / cols) * (TH + label + gap);
    inner += svgOf(MJ, c.id).replace('width="100%" height="100%"',
      `x="${cx}" y="${cy}" width="${TW}" height="${TH}"`);
    inner += `<text x="${cx + TW / 2}" y="${cy + TH + 13}" text-anchor="middle" font-size="11" `
      + `font-family="monospace" fill="#9fd8b8">${c.key}</text>`;
  });
  return inner;
}

const cols = 9, gap = 12, pad = 22, label = 16, headH = 46;
const blockW = pad * 2 + cols * TW + (cols - 1) * gap;
const blockH = pad * 2 + Math.ceil(cases.length / cols) * (TH + label) + (Math.ceil(cases.length / cols) - 1) * gap;
const W = blockW, H = headH + blockH + 18 + headH + blockH;
const titleOld = `before \u00b7 升级前（v1 \u7eaf\u5e73\u6d82\uff1a\u5355\u8272\u724c\u8eab + 1px \u63cf\u8fb9\uff09`;
const titleNew = `after \u00b7 \u5347\u7ea7\u540e\uff08v2\uff1a\u724c\u8eab\u51f8\u8d77\u6e10\u53d8 + \u9762\u677f\u51f9\u9677 + \u5b57\u9762\u523b\u75d5 + \u7af9\u8282\u5706\u67f1 + \u724c\u80cc\u7ec7\u7eb9\uff09`;
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  + `<rect width="${W}" height="${H}" fill="#0d2a1e"/>`
  + `<text x="${pad}" y="30" font-size="19" font-family="sans-serif" font-weight="700" fill="#e9f5ee">${titleOld}</text>`
  + sheetBlock(MJold, 0, headH, cols, gap, pad, label)
  + `<line x1="0" y1="${headH + blockH + 9}" x2="${W}" y2="${headH + blockH + 9}" stroke="#2f6b4f" stroke-width="2"/>`
  + `<text x="${pad}" y="${headH + blockH + 18 + 30}" font-size="19" font-family="sans-serif" font-weight="700" fill="#e9f5ee">${titleNew}</text>`
  + sheetBlock(MJnew, 0, headH + blockH + 18 + headH, cols, gap, pad, label)
  + `</svg>`;

const outDir = path.resolve(here, 'baseline');
mkdirSync(outDir, { recursive: true });
const outPng = path.join(outDir, 'compare-before-after.png');
const r = new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: true } });
writeFileSync(outPng, Buffer.from(r.render().asPng()));

report.push('');
report.push('对照图 -> web/baseline/compare-before-after.png  (' + W + 'x' + H + ')');
writeFileSync(path.join(here, '_compare_out.txt'), report.join('\n'), 'utf8');
process.stdout.write('RESULT compare done\n');
