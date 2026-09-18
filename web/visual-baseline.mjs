/**
 * chuan.ma 视觉指纹回归基线
 * ---------------------------------------------------------------------------
 * 为什么存在：程序化视觉资产（33 个 SVG 牌面 + GPU 桌面）改起来很容易「越改越丑」
 * 却毫无报警 —— 模型读不了图，人也不会每轮肉眼比对 33 张牌。
 * 本脚本把「画面对不对」降维成可断言、可比较的数字：
 *
 *   牌面（本文件主体，Node 纯计算，确定性可复现）
 *     resvg 把每张 SVG 光栅化成 132×185（与 PixiJS 纹理同尺寸）→ pngjs 取像素 → 指纹：
 *       ink     非背景像素占比            —— 防空图 / 防笔画丢失
 *       lumMean 牌身亮度均值              —— 防整体过曝 / 过暗
 *       lumStd  亮度标准差                —— 质感层次（纯平涂 ≈ 低，有渐变/阴影 ≈ 高）
 *       grad    上部牌身 − 下部牌身 亮度差 —— 垂直渐变方向（顶亮底暗应为正）
 *       chroma  高饱和红/绿/蓝占比        —— 花色配色是否还在（万红 / 条绿 / 筒蓝）
 *       detail  相邻像素亮度差均值        —— 笔画与纹理复杂度
 *
 *   桌面（--with-table，需本机 Chrome）
 *     复用 browser-probe.mjs 截图 → 在绒布区统计：
 *       feltLum / feltStd   绒布亮度与纹理能量
 *       vignette            （中央亮度 − 边缘亮度），暗角应为正
 *       greenness           绿通道主导度（绒布是不是绿）
 *       goldRing            桌边金线像素数
 *
 * 用法：
 *   node web/visual-baseline.mjs             # 与既有基线对比（无基线则建立）
 *   node web/visual-baseline.mjs --write     # 覆写基线（确认改动方向正确后才做）
 *   node web/visual-baseline.mjs --check     # 只对比，不写；有偏移则退出码 1
 *   node web/visual-baseline.mjs --with-table        # 追加桌面指标（需 Chrome）
 *   node web/visual-baseline.mjs --write --with-table
 *
 * 设计取舍：报告里的偏移叫 CHANGED 而不叫 FAIL —— 主动改视觉时「变了」是预期。
 * 它的价值是让变化**可见且可审计**：偏移量写清楚，由人或 --check 决定是否接受。
 * ---------------------------------------------------------------------------
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
const WRITE = ARGV.includes('--write');
const CHECK = ARGV.includes('--check');
const WITH_TABLE = ARGV.includes('--with-table');
// --asset <path> 指定牌面资产文件（默认 web/tiles-ui.js）。
// 用途：拿历史版本（git show HEAD:web/tiles-ui.js 落到临时文件）建立「升级前」基线。
const assetArg = ARGV.indexOf('--asset');
const tilesFile = assetArg >= 0 && ARGV[assetArg + 1]
  ? path.resolve(here, ARGV[assetArg + 1])
  : path.resolve(here, 'tiles-ui.js');

const baseDir = path.resolve(here, 'baseline');
const tilesJson = path.join(baseDir, 'tiles.json');
const tableJson = path.join(baseDir, 'table.json');
const sheetPng = path.join(baseDir, 'contact-sheet.png');

/* ---------------- 加载被测资产（与页面用同一份源码） ---------------- */
// ⚠ 关键：tokens.js 与 tiles-ui.js 必须跑在**同一个** window 对象上。
//   曾经给两者各传一个空 sandbox，结果 tiles-ui.js 读不到 window.CMTokens，
//   静默走了兜底色值 —— 于是「改 tokens 不生效」且指纹对比全是假的。
//   页面里不存在这个问题（build.mjs 把 tokens.js 内联在 tiles-ui.js 之前，同一个 window）。
const win = {};
const runIn = (file) => new Function('window', readFileSync(file, 'utf8'))(win);
runIn(path.resolve(here, 'tokens.js'));
runIn(tilesFile);
const MJ = win.MJTiles;
const TOK = win.CMTokens;
if (!MJ) { console.error('无法加载 web/tiles-ui.js（应为 IIFE 挂 window.MJTiles）'); process.exit(1); }
if (!TOK) { console.error('无法加载 web/tokens.js（应为 IIFE 挂 window.CMTokens）'); process.exit(1); }
if (!MJ.version) console.warn('提示：tiles-ui.js 未报 version，可能是旧版本');

/* ---------------- 光栅化 ---------------- */
const TW = 132, TH = 185;   // 与 pixi-table.js 的 buildTextures() 同尺寸
function raster(svg, w, h) {
  const sized = svg.includes('width="100%" height="100%"')
    ? svg.replace('width="100%" height="100%"', `width="${w}" height="${h}"`)
    : svg.replace('<svg ', `<svg width="${w}" height="${h}" `);
  const r = new Resvg(sized, {
    fitTo: { mode: 'width', value: w },
    font: { loadSystemFonts: true },   // 必须开，否则万/条里的汉字渲不出来
    background: '#14503a',             // 绒布底色：牌身象牙白在桌面上才好判背景
  });
  return PNG.sync.read(Buffer.from(r.render().asPng()));
}

/* ---------------- 指纹 ---------------- */
const BG_FLOOR = 150;          // 牌身/面板远亮于此；低于它算绒布底
// ⚠ 口径教训：isTile 只能靠「明亮（象牙白牌身）或偏蓝（牌背）」来判牌面，
//   因为竹绿 #1c7d4d 和绒布绿 #14503a 在 RGB 上几乎分不开，不能靠「是绿色」来切背景。
//   于是 chroma 必须**按整图统计**，绝不能挂在 isTile 之后 —— 否则竹绿/靶心朱红/靛黑字
//   全被当成背景跳过，green 只剩边缘混色（实测差 14 倍，且"变暗"反而更不计入，方向是反的）。
function fingerprint(png) {
  const { width: W, height: H, data: D } = png;
  let ink = 0, nBg = 0, sumBg = 0, sumBg2 = 0;
  let topS = 0, topN = 0, botS = 0, botN = 0;
  let red = 0, green = 0, blue = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = D[i], g = D[i + 1], b = D[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const isBright = r > BG_FLOOR && g > BG_FLOOR * 0.93 && b > BG_FLOOR * 0.78;
      const isBlue = b > r + 45 && b > 110;
      if (isBright || isBlue) ink++;
      if (isBright) {
        nBg++; sumBg += lum; sumBg2 += lum * lum;
        if (y < H * 0.25) { topS += lum; topN++; }
        if (y > H * 0.75) { botS += lum; botN++; }
      }
      // 配色统计：整图口径（分母 = 全部像素），与 ink 无关
      if (r > g + 40 && r > b + 40 && r > 120) red++;
      if (g > r + 25 && g > b + 25 && g > 90) green++;
      if (b > r + 30 && b > g + 20 && b > 110) blue++;
    }
  }
  // detail：相邻像素亮度差（笔画/纹理能量）
  let dSum = 0, dN = 0;
  for (let y = 1; y < H; y++) {
    for (let x = 1; x < W; x++) {
      const i = (y * W + x) * 4, j = (y * W + x - 1) * 4, k = ((y - 1) * W + x) * 4;
      const l = 0.299 * D[i] + 0.587 * D[i + 1] + 0.114 * D[i + 2];
      const ll = 0.299 * D[j] + 0.587 * D[j + 1] + 0.114 * D[j + 2];
      const lu = 0.299 * D[k] + 0.587 * D[k + 1] + 0.114 * D[k + 2];
      dSum += Math.abs(l - ll) + Math.abs(l - lu); dN += 2;
    }
  }
  const mean = nBg ? sumBg / nBg : 0;
  const variance = nBg ? Math.max(0, sumBg2 / nBg - mean * mean) : 0;
  const total = W * H;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    ink: r3(ink / total),
    lumMean: r3(mean),
    lumStd: r3(Math.sqrt(variance)),
    grad: r3((topN ? topS / topN : 0) - (botN ? botS / botN : 0)),
    chroma: { red: r3(red / total), green: r3(green / total), blue: r3(blue / total) },
    detail: r3(dSum / Math.max(1, dN)),
  };
}

/* ---------------- 33 张牌面 ---------------- */
const ids = [];
for (let i = 0; i < 27; i++) ids.push(i);
const CASES = ids.map((id) => ({ key: 'face' + id, svg: MJ.face(id) }));
CASES.push({ key: 'back', svg: MJ.back() });

const print = [];
const cur = {};
for (const c of CASES) {
  const png = raster(c.svg, TW, TH);
  cur[c.key] = fingerprint(png);
  print.push({ key: c.key, png });
}

/* ---------------- 联系表（33 张拼一张，供目视终审） ---------------- */
function contactSheet() {
  const cols = 9, gap = 12, pad = 22, label = 16;
  const rows = Math.ceil(print.length / cols);
  const W = pad * 2 + cols * TW + (cols - 1) * gap;
  const H = pad * 2 + rows * (TH + label) + (rows - 1) * gap;
  let inner = '';
  print.forEach((it, i) => {
    const cx = pad + (i % cols) * (TW + gap);
    const cy = pad + Math.floor(i / cols) * (TH + label + gap);
    // 把源 <svg> 直接嵌套进大图：viewBox 保留，width/height 换成位置尺寸。
    // 注意每张牌的 defs id 必须唯一（tiles-ui.js 用自增 uid 保证），否则 33 张同框会互相抢渐变。
    const src = CASES[i].svg.replace('width="100%" height="100%"',
      `x="${cx}" y="${cy}" width="${TW}" height="${TH}"`);
    inner += src;
    inner += `<text x="${cx + TW / 2}" y="${cy + TH + 12}" text-anchor="middle" `
      + `font-size="11" font-family="monospace" fill="#bcd8c8">${it.key}</text>`;
  });
  const big = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#14503a"/>${inner}</svg>`;
  const r = new Resvg(big, {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true },
  });
  return Buffer.from(r.render().asPng());
}

mkdirSync(baseDir, { recursive: true });
writeFileSync(sheetPng, contactSheet());

/* ---------------- 与基线对比 ---------------- */
const TOL = {
  ink: 0.030,      // 3pp
  lumMean: 6.0,
  lumStd: 1.2,
  grad: 1.5,
  detail: 0.05,
  chromaAbs: 0.012,
};
function diffOne(prev, now) {
  const out = [];
  for (const k of ['ink', 'lumMean', 'lumStd', 'grad', 'detail']) {
    const d = now[k] - prev[k];
    if (Math.abs(d) > TOL[k]) out.push(`${k} ${prev[k].toFixed(3)}→${now[k].toFixed(3)} (${d > 0 ? '+' : ''}${d.toFixed(3)})`);
  }
  for (const c of ['red', 'green', 'blue']) {
    const d = now.chroma[c] - prev.chroma[c];
    if (Math.abs(d) > TOL.chromaAbs) out.push(`chroma.${c} ${prev.chroma[c].toFixed(3)}→${now.chroma[c].toFixed(3)} (${d > 0 ? '+' : ''}${d.toFixed(3)})`);
  }
  return out;
}

let changed = 0;
if (existsSync(tilesJson)) {
  const prev = JSON.parse(readFileSync(tilesJson, 'utf8'));
  console.log(`=== 牌面视觉指纹对比（基线 ${prev.__meta.builtAt}） ===`);
  for (const c of CASES) {
    const p = prev.tiles[c.key];
    if (!p) { console.log(`  NEW    | ${c.key} | 基线中不存在`); changed++; continue; }
    const d = diffOne(p, cur[c.key]);
    if (d.length) { console.log(`  CHANGED| ${c.key} | ${d.join('  ')}`); changed++; }
  }
  console.log(changed ? `\n${changed}/${CASES.length} 张牌面指纹发生偏移` : '\n牌面指纹与基线一致');
} else {
  console.log('=== 未发现既有基线，本次建立 ===');
}

const out = {
  __meta: {
    builtAt: new Date().toISOString(),
    tiles: CASES.length,
    raster: `${TW}x${TH}`,
    tokensVersion: TOK.version,
    note: '指纹由 web/visual-baseline.mjs 生成；--write 覆写基线，--check 有偏移则退出码 1',
  },
  tiles: cur,
};

if (WRITE || !existsSync(tilesJson)) {
  writeFileSync(tilesJson, JSON.stringify(out, null, 2));
  console.log(`已写入基线 -> web/baseline/tiles.json`);
}
console.log(`联系表 -> web/baseline/contact-sheet.png`);

/* ---------------- 桌面（可选，需 Chrome） ---------------- */
if (WITH_TABLE) {
  const { spawnSync } = await import('node:child_process');
  const playHtml = path.resolve(here, 'dist', 'play.html');
  const shot = path.join(baseDir, '.table-shot.png');
  const geom = path.join(baseDir, '.table-geom.json');
  const rep = path.join(baseDir, '.table-probe.txt');
  if (!existsSync(playHtml)) {
    console.log('\n[桌面] 跳过：web/dist/play.html 不存在（先跑 node web/build.mjs）');
  } else {
    const r = spawnSync(process.execPath, [path.resolve(here, 'browser-probe.mjs'), playHtml, shot, geom, rep],
      { encoding: 'utf8', stdio: 'pipe' });
    if (!existsSync(shot)) {
      console.log('\n[桌面] 跳过：截图未生成（本机 Chrome 不可用？）');
      console.log((r.stdout || '') + (r.stderr || ''));
    } else {
      const G = JSON.parse(readFileSync(geom, 'utf8'));
      const png = PNG.sync.read(readFileSync(shot));
      const { width: SW, height: SH, data: D } = png;
      const kx = G.rect.w / G.W, ky = G.rect.h / G.H;
      const px = (lx, ly) => [Math.round(G.rect.x + lx * kx), Math.round(G.rect.y + ly * ky)];
      const lumAt = (x, y) => { const i = (y * SW + x) * 4; return 0.299 * D[i] + 0.587 * D[i + 1] + 0.114 * D[i + 2]; };
      // 中央绒布区（避开四家牌带）：取逻辑坐标中心 30% 见方
      const [cx0, cy0] = px(G.W * 0.35, G.H * 0.35), [cx1, cy1] = px(G.W * 0.65, G.H * 0.65);
      // 边缘环带（靠桌边但避开桌框）：取四边内 8% 处条带
      const [ex0, ey0] = px(G.W * 0.06, G.H * 0.06), [ex1, ey1] = px(G.W * 0.94, G.H * 0.94);
      let cS = 0, cN = 0, cS2 = 0, eS = 0, eN = 0, gold = 0, gTot = 0, gsum = 0;
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) { const l = lumAt(x, y); cS += l; cS2 += l * l; cN++; }
      for (let y = ey0; y < ey1; y++) for (let x = ex0; x < ex1; x++) {
        const edge = (x < cx0 || x >= cx1) && (y < cy0 || y >= cy1);
        if (!edge) continue;
        const i = (y * SW + x) * 4, r2 = D[i], g2 = D[i + 1], b2 = D[i + 2];
        eS += 0.299 * r2 + 0.587 * g2 + 0.114 * b2; eN++;
        gTot++; gsum += g2 - (r2 + b2) / 2;
        if (r2 > 175 && g2 > 140 && b2 < 140) gold++;
      }
      const cMean = cN ? cS / cN : 0;
      const tableCur = {
        feltLum: Math.round(cMean * 100) / 100,
        feltStd: Math.round(Math.sqrt(Math.max(0, (cN ? cS2 / cN : 0) - cMean * cMean))) * 100 / 100,
        vignette: Math.round(((cMean - (eN ? eS / eN : 0))) * 100) / 100,
        greenness: Math.round((gsum / Math.max(1, gTot)) * 100) / 100,
        goldRing: gold,
        samplePx: { center: cN, edge: eN },
      };
      console.log('\n=== 桌面指纹 ===');
      console.log('  ' + JSON.stringify(tableCur));
      if (existsSync(tableJson)) {
        const prev = JSON.parse(readFileSync(tableJson, 'utf8')).table;
        const d = [];
        for (const k of Object.keys(tableCur)) {
          if (typeof tableCur[k] !== 'number' || typeof prev[k] !== 'number') continue;
          const dv = tableCur[k] - prev[k];
          if (Math.abs(dv) > (k === 'goldRing' ? Math.max(50, prev[k] * 0.25) : (k === 'feltLum' ? 4 : (k === 'greenness' ? 2 : 0.6)))) {
            d.push(`${k} ${prev[k]}→${tableCur[k]}`);
          }
        }
        console.log(d.length ? '  CHANGED| ' + d.join('  ') : '  桌面指纹与基线一致');
      }
      if (WRITE || !existsSync(tableJson)) {
        writeFileSync(tableJson, JSON.stringify({ __meta: out.__meta, table: tableCur }, null, 2));
        console.log('  已写入基线 -> web/baseline/table.json');
      }
    }
  }
}

if (CHECK && changed) process.exitCode = 1;
