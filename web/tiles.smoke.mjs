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

console.log(`\n=== 资产页冒烟：${pass} passed, ${fail} failed ===`);
if (fail) process.exitCode = 1;
