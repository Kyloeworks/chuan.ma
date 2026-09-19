/**
 * chuan.ma 构建脚本
 *
 * 1) esbuild 把 kernel（TS）打成浏览器 IIFE（全局 ChuanMa）
 * 2) esbuild 把 pixi.js 打成浏览器 IIFE（全局 PIXI）
 * 3) 把 [tiles-ui.js, 页面脚本] 内联进各自模板，产出单文件页面到 web/dist/
 * 4) 学习内容页（web/content/*.html + site.css）为纯静态，原样复制到 web/dist/
 *
 * 只有一个牌桌：play.html（GPU / PixiJS）。经典 DOM 牌桌已弃用。
 *
 * 依赖：esbuild 与 pixi.js。在项目根目录执行 `npm install` 即可；
 *       也可用环境变量 CHUANMA_DEPS 指向一个含这两个包的 node_modules 目录。
 *
 * 用法：node web/build.mjs
 *       node web/publish.mjs   # 再把 web/dist/ 同步到仓库根（GitHub Pages 站点根）
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ---------------- 依赖解析 ---------------- */
const base = process.env.CHUANMA_DEPS
  ? path.join(process.env.CHUANMA_DEPS.replace(/[\\/]+$/, ''), 'noop.js')
  : path.join(here, '..', 'noop.js');          // 从项目根开始向上查找 node_modules
const req = createRequire(base);

let esbuild;
try {
  esbuild = req('esbuild');
} catch {
  console.error(
    '\n未找到 esbuild。\n' +
    '  请在项目根目录执行：  npm install\n' +
    '  或设置 CHUANMA_DEPS 指向含 esbuild / pixi.js 的 node_modules 目录。\n'
  );
  process.exit(1);
}
try {
  req.resolve('pixi.js');
} catch {
  console.error('\n未找到 pixi.js。请在项目根目录执行：npm install\n');
  process.exit(1);
}

/** 找到某个包所属的 node_modules 目录（esbuild 的 resolveDir 需要它） */
function nodeModulesDirOf(id) {
  let d = path.dirname(req.resolve(id));
  while (path.basename(d) !== 'node_modules' && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}
const depsDir = nodeModulesDirOf('pixi.js');

/* ---------------- 输出目录 ---------------- */
const distDir = path.resolve(here, 'dist');
mkdirSync(distDir, { recursive: true });

// --- kernel -> global ChuanMa ---
const tmpKernel = path.resolve(here, '.tmp-kernel.js');
await esbuild.build({
  entryPoints: [path.resolve(here, '../kernel/src/index.ts')],
  bundle: true, format: 'iife', globalName: 'ChuanMa',
  platform: 'browser', target: ['es2020'], outfile: tmpKernel,
  legalComments: 'none', charset: 'utf8',
});
const kernel = readFileSync(tmpKernel, 'utf8');

// --- pixi.js -> global PIXI ---
// 只具名导入需要的部分，才能 tree-shaking（export * 会让单文件从 ~1.7MB 涨到 ~2.6MB）
const tmpPixi = path.resolve(here, '.tmp-pixi.js');
await esbuild.build({
  stdin: {
    contents: "import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';\n" +
      "export { Application, Container, Graphics, Sprite, Text, Texture };",
    resolveDir: depsDir, sourcefile: 'pixi-entry.js',
  },
  bundle: true, format: 'iife', globalName: 'PIXI',
  platform: 'browser', target: ['es2020'], outfile: tmpPixi,
  legalComments: 'none', charset: 'utf8',
  absWorkingDir: depsDir,   // 让产物中的来源注释保持相对路径，不泄漏本机绝对路径
  define: { 'process.env.NODE_ENV': '"production"' },
});
const pixi = readFileSync(tmpPixi, 'utf8');

const read = (f) => readFileSync(path.resolve(here, f), 'utf8');

// --- 设计令牌：色板/质感参数的唯一来源 ---
// tokens.js 是浏览器 IIFE（挂 window.CMTokens）。这里用 new Function 取同一份值，
// 把 :root{...} 注入模板与 site.css，使样式表与绘制代码不可能各自漂移。
const tokensSrc = read('tokens.js');
const tokensCss = new Function('window', tokensSrc + '\n;return window.CMTokens.css();')({});
const injectTokens = (text) =>
  text.indexOf('/*__TOKENS_CSS__*/') >= 0 ? text.replace('/*__TOKENS_CSS__*/', () => tokensCss) : text;

// 脚本链顺序有语义：tokens (色板) → glyphs (汉字轮廓) → tiles-ui (牌面) → 页面逻辑。
// tiles-ui.js 在加载时读取 window.CMTokens / window.CMGlyphs，顺序错了会静默退化
// （色走兜底、万子无字），构建期无法察觉 —— 由 tiles.smoke.mjs 断言兜住。
const SCRIPT_CHAIN = ['tokens.js', 'glyphs.js', 'tiles-ui.js'];
const face = SCRIPT_CHAIN.concat(['app.js']);
const gallery = SCRIPT_CHAIN.concat(['gallery.js']);
const table = SCRIPT_CHAIN.concat(['pixi-table.js']);

const targets = [
  { template: 'template.html', scripts: face, out: 'calculator.html', kernel: true },
  { template: 'tiles.template.html', scripts: gallery, out: 'tiles.html', kernel: false },
  { template: 'pixi-table.template.html', scripts: table, out: 'play.html', kernel: true, pixi: true },
];

for (const tg of targets) {
  for (const f of tg.scripts) {
    if (!existsSync(path.resolve(here, f))) {
      console.error(`ERROR 构建链缺少 web/${f} —— 万子牌面会退化成空白（跑 npm run glyphs 可再生成 glyphs.js）`);
      process.exit(1);
    }
  }
}

for (const tg of targets) {
  const app = tg.scripts.map(read).join('\n;\n');
  let html = read(tg.template);
  // 用函数替换，避免代码里的 $ 被当作替换模式
  if (html.indexOf('/*__KERNEL__*/') >= 0) html = html.replace('/*__KERNEL__*/', () => (tg.kernel ? kernel : ''));
  if (html.indexOf('/*__PIXI__*/') >= 0) html = html.replace('/*__PIXI__*/', () => (tg.pixi ? pixi : ''));
  html = injectTokens(html);
  html = html.replace('/*__APP__*/', () => app);
  writeFileSync(path.resolve(distDir, tg.out), html);
  console.log(`built  -> ${tg.out}  (${(html.length / 1024).toFixed(1)} KB)`);
}

// 学习内容页：纯静态，无脚本打包，原样复制（含共享样式表 site.css）
// site.css 顶部的 /*__TOKENS_CSS__*/ 在此展开，使 dist 里的样式表自带变量定义。
const statics = [
  'learn-rules.html', 'learn-tiles.html', 'learn-scoring.html',
  'learn-culture.html', 'glossary.html', 'site.css',
];
for (const f of statics) {
  const src = path.resolve(here, 'content', f);
  if (!existsSync(src)) { console.warn(`skip   -> content/${f} (缺失)`); continue; }
  writeFileSync(path.resolve(distDir, f), injectTokens(readFileSync(src, 'utf8')));
  console.log(`copied -> ${f}`);
}

// 站点首页（入口）
writeFileSync(path.resolve(distDir, 'index.html'), read('landing.html'));
console.log('built  -> index.html  (landing)');
