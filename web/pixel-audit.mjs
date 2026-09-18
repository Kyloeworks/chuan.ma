/** 对 2.5D 截图做像素级体检（用探针导出的画布几何做精确坐标映射）：
 *  ① 四家手牌区都真的画出了牌（有墨）
 *  ② 左右两家的「单张牌」横向跨度 ≈ 牌长轴 → 证明侧位旋转真的生效
 *  ③ 底部手牌是竖着的（单牌纵向跨度 ≈ 牌长轴）
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 依赖解析：项目本地 node_modules 优先；CHUANMA_DEPS 可指定含依赖的目录
const require = createRequire(
  process.env.CHUANMA_DEPS
    ? path.join(process.env.CHUANMA_DEPS.replace(/[\\/]+$/, ''), 'noop.js')
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'noop.js')
);
const { PNG } = require('pngjs');

const pngFile = process.argv[2];
const geomFile = process.argv[3];
const G = JSON.parse(readFileSync(geomFile, 'utf8'));
const png = PNG.sync.read(readFileSync(pngFile));
const SW = png.width, SH = png.height, D = png.data;

// 布局坐标 → 截图像素坐标（截图是整页，画布有 x/y 偏移）
const kx = G.rect.w / G.W, ky = G.rect.h / G.H;
const ox = G.rect.x, oy = G.rect.y;
const toPx = (lx, ly) => [Math.round(ox + lx * kx), Math.round(oy + ly * ky)];

// 亮像素占比（自检：截图里到底有没有内容）
{
  let bright = 0;
  for (let i = 0; i < D.length; i += 4) if (D[i] + D[i + 1] + D[i + 2] > 420) bright++;
  console.log(`  整图亮像素占比 ${(bright / (SW * SH) * 100).toFixed(2)}%（画面是否有内容）`);
}

function isTile(x, y) {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return false;
  const i = (y * SW + x) * 4;
  const r = D[i], g = D[i + 1], b = D[i + 2];
  if (r > 150 && g > 140 && b > 118) return true;
  if (b > r + 45 && b > 120) return true;
  return false;
}
function bbox(x0, y0, x1, y1) {
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!isTile(x, y)) continue;
    n++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return { n: 0, w: 0, h: 0 };
  return { n, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
function maxRunH(x0, y0, x1, y1) {
  let best = 0, at = 0;
  for (let y = y0; y < y1; y++) {
    let run = 0;
    for (let x = x0; x < x1; x++) {
      if (isTile(x, y)) { run++; if (run > best) { best = run; at = y; } } else run = 0;
    }
  }
  return { len: best, at };
}
function maxRunV(x0, y0, x1, y1) {
  let best = 0, at = 0;
  for (let x = x0; x < x1; x++) {
    let run = 0;
    for (let y = y0; y < y1; y++) {
      if (isTile(x, y)) { run++; if (run > best) { best = run; at = x; } } else run = 0;
    }
  }
  return { len: best, at };
}

const M = 12;
const handH = Math.min(G.H * 0.125, G.W / 17), handW = handH * 0.714;
const oppH = handH * 0.62, oppW = oppH * 0.714;
console.log(`=== 2.5D 截图像素体检 ===  截图 ${SW}x${SH}  画布 @${ox},${oy} ${G.rect.w}x${G.rect.h}  逻辑 ${G.W}x${G.H}`);
console.log(`  尺规: handH=${handH.toFixed(1)} handW=${handW.toFixed(1)} oppH=${oppH.toFixed(1)} oppW=${oppW.toFixed(1)}`);

// 用布局盒裁区域（更准）
const bx = {}; (G.boxes || []).forEach((b) => { bx[b.name] = b; });
function regionFrom(name, pad) {
  const b = bx[name]; if (!b) return null;
  const [x0, y0] = toPx(b.x - pad, b.y - pad);
  const [x1, y1] = toPx(b.x + b.w + pad, b.y + b.h + pad);
  return [x0, y0, x1, y1];
}
const regions = {
  bottom: regionFrom('hand0', 4),
  top: regionFrom('hand2', 4),
  left: regionFrom('hand3', 4),
  right: regionFrom('hand1', 4),
};

const checks = [];
const ck = (name, ok, extra) => checks.push(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${extra}`);
const R = {};
for (const [k, r] of Object.entries(regions)) {
  if (!r) { console.log(`  ${k}: 无区域（缺布局盒）`); continue; }
  const b = bbox(...r), mh = maxRunH(...r), mv = maxRunV(...r);
  R[k] = { b, mh, mv };
  console.log(`  ${k.padEnd(7)} 区域=${r.join(',')}  牌像素=${b.n}  bbox=${b.w}x${b.h}  最大横段=${mh.len}  最大竖段=${mv.len}`);
}

for (const k of Object.keys(R)) ck(`${k} 手牌区画出牌`, R[k].b.n > 400, `pixels=${R[k].b.n}`);
for (const k of ['left', 'right']) {
  if (!R[k]) continue;
  const w = R[k].mh.len;
  ck(`${k} 单牌横向跨度≈牌长轴（牌横过来）`, w >= oppH * 0.72 && w <= oppH * 1.45,
    `maxRunH=${w} 期望≈${oppH.toFixed(0)}（未旋转会是≈${oppW.toFixed(0)}）`);
  ck(`${k} 牌列竖排（bbox 高/宽>3）`, R[k].b.h / Math.max(1, R[k].b.w) > 3, `bbox=${R[k].b.w}x${R[k].b.h}`);
}
if (R.bottom) {
  ck('bottom 单牌横向跨度≈牌宽（竖摆）', R.bottom.mh.len >= handW * 0.75 && R.bottom.mh.len <= handW * 1.5,
    `maxRunH=${R.bottom.mh.len} 期望≈${handW.toFixed(0)}`);
  ck('bottom 单牌纵向>横向（竖向牌）', R.bottom.mv.len > R.bottom.mh.len * 1.15,
    `maxRunV=${R.bottom.mv.len} vs maxRunH=${R.bottom.mh.len}`);
}
if (R.top) ck('top 手牌为横向长带', R.top.b.w / Math.max(1, R.top.b.h) > 3, `bbox=${R.top.b.w}x${R.top.b.h}`);

// 牌河区：四家门前都应有牌（说明「门前两排」真的画出来了）
for (const s of [0, 1, 2, 3]) {
  const r = regionFrom('river' + s, 2);
  if (!r) continue;
  const b = bbox(...r);
  ck(`river${s} 牌河区画出牌`, b.n > 200, `pixels=${b.n} bbox=${b.w}x${b.h}`);
}

const fails = checks.filter((c) => c.startsWith('FAIL')).length;
console.log('\n' + checks.join('\n'));
console.log(fails ? `\nX 像素体检未通过：${fails} 项` : '\nOK 像素体检全部通过');
if (fails) process.exitCode = 1;
