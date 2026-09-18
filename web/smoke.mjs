/** 无头冒烟测试：用 jsdom 加载单文件计算器，验证脚本无报错 + 交互渲染正确。 */
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
const file = path.resolve(here, 'dist/calculator.html');
const html = readFileSync(file, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e && e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc });
const doc = dom.window.document;
const txt = (sel) => (doc.querySelector(sel) || {}).textContent || '';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

// 0) 脚本无报错
check('页面脚本无运行时错误', errors.length === 0, errors.join(' | '));

// 1) 27 个牌按钮
const btns = doc.querySelectorAll('#picker .tb');
check('渲染 27 个牌按钮', btns.length === 27, 'got ' + btns.length);

// 2) 初始空手牌 → 提示还需 13 张
check('空手牌提示正确', /还需 13 张|13 more tile/.test(txt('#result')), txt('#result').slice(0, 60));

// 3) 点击示例1（听牌例）→ 向听 0 且显示听牌张（3筒）
const exs = doc.querySelectorAll('#examples button[data-ex]');
check('存在 3 个示例按钮', exs.length === 3, 'got ' + exs.length);
exs[0].click();
const r1 = txt('#result');
check('示例1 向听数为 0', />\s*0\s*</.test(doc.querySelector('#result').innerHTML) || /bignum z/.test(doc.querySelector('#result').innerHTML), r1.slice(0, 80));
check('示例1 显示听牌张 含 3筒', /3筒|3 tong/.test(r1), r1.slice(0, 120));

// 4) 示例2（14张待打）→ 表格 + 推荐打 9筒
exs[1].click();
const r2 = txt('#result');
check('示例2 出现弃牌表格', doc.querySelectorAll('#result table tbody tr').length > 0);
check('示例2 推荐打 9筒', /推荐打：9筒|Best discard: 9 tong/.test(r2), r2.slice(0, 120));
check('示例2 表格首行为 best', !!doc.querySelector('#result table tbody tr.best'));

// 5) 示例3（散牌）→ 向听数 4
exs[2].click();
const r3 = txt('#result');
check('示例3 向听数 4', /bignum[^>]*>\s*4\s*</.test(doc.querySelector('#result').innerHTML), r3.slice(0, 80));

// 6) 手动点击加牌（每次点击后重查询：渲染会重建按钮）
doc.getElementById('clearBtn').click();
for (let i = 0; i < 3; i++) doc.querySelector('#picker .tb[data-id="0"]').click();
const b2 = doc.querySelector('#picker .tb[data-id="0"]');
const badge = b2.querySelector('.n');
check('点击 3 次 1万 → 角标显示 3', !!badge && badge.textContent === '3', b2.textContent);

// 7) 语言切换
doc.getElementById('langBtn').click();
check('切换到英文标题', /Calculator/.test(txt('#ttl')), txt('#ttl'));
doc.getElementById('langBtn').click();
check('切回中文标题', /算牌器/.test(txt('#ttl')), txt('#ttl'));

// 8) 无报错（交互后）
check('交互后仍无脚本错误', errors.length === 0, errors.join(' | '));

console.log(`\n=== jsdom 冒烟：${pass} passed, ${fail} failed ===`);
if (fail) process.exitCode = 1;
