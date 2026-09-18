const fs = require('fs'), path = require('path');
const here = path.join(__dirname);
const win = {};
new Function('window', fs.readFileSync(path.join(here, 'tokens.js'), 'utf8'))(win);
new Function('window', fs.readFileSync(path.join(here, 'tiles-ui.js'), 'utf8'))(win);
const MJ = win.MJTiles;

const creq = require('module').createRequire(
  process.env.CHUANMA_DEPS ? path.join(process.env.CHUANMA_DEPS, 'noop.js') : path.join(here, '..', 'noop.js'));
const { Resvg } = creq('@resvg/resvg-js');
const { PNG } = creq('pngjs');

const TW = 132, TH = 185;
function raster(svg) {
  const sized = svg.replace('width="100%" height="100%"', `width="${TW}" height="${TH}"`);
  const r = new Resvg(sized, { fitTo: { mode: 'width', value: TW }, font: { loadSystemFonts: true }, background: '#14503a' });
  return PNG.sync.read(Buffer.from(r.render().asPng()));
}
const L = [];
function stats(png, tag) {
  const { width: W, height: H, data: D } = png;
  let red = 0, green = 0, blue = 0, ink = 0;
  for (let i = 0; i < D.length; i += 4) {
    const r = D[i], g = D[i + 1], b = D[i + 2];
    const isBright = r > 150 && g > 139.5 && b > 117;
    const isBlue = b > r + 45 && b > 110;
    if (isBright || isBlue) ink++;
    if (r > g + 40 && r > b + 40 && r > 120) red++;
    if (g > r + 25 && g > b + 25 && g > 90) green++;
    if (b > r + 30 && b > g + 20 && b > 110) blue++;
  }
  const T = W * H;
  L.push(`${tag}  ink=${(ink / T).toFixed(3)} red=${(red / T).toFixed(4)} green=${(green / T).toFixed(4)} blue=${(blue / T).toFixed(4)}`);
  return { W, H, D };
}

const png14 = raster(MJ.face(14));
const { W, H, D } = stats(png14, 'face14');
// 第一根竹子中心：SVG(19.2,24) → 像素
const cx = Math.round(19.2 * W / 60), cy = Math.round(24 * H / 84);
L.push(`竹子中心像素坐标 (${cx},${cy})；横向扫 x=${cx - 8}..${cx + 8} @y=${cy}：`);
let row = '';
for (let x = cx - 8; x <= cx + 8; x++) {
  const i = (cy * W + x) * 4;
  row += `[${x}]${D[i]},${D[i + 1]},${D[i + 2]}  `;
}
L.push(row);
// 纵向扫：确认这根竹子几条像素高
L.push('纵向扫 @x=' + cx + '：');
let col = '';
for (let y = cy - 16; y <= cy + 16; y += 2) {
  const i = (y * W + cx) * 4;
  col += `[${y}]${D[i]},${D[i + 1]},${D[i + 2]}  `;
}
L.push(col);
// 对照：旧版纯色竹子的 green 应在多少 —— 直接看 21 张里面最大的那张
const g20 = stats(raster(MJ.face(20)), 'face20(4筒)');
L.push('');
[9, 10, 11, 12, 13, 14, 15, 16, 17].forEach((id) => stats(raster(MJ.face(id)), 'face' + id));
fs.writeFileSync(path.join(here, '_dbg_out.txt'), L.join('\n'), 'utf8');
