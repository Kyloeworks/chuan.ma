/**
 * 静态链接体检 —— 零依赖，直接扫站点根目录的 HTML。
 *
 * 检查三件事：
 *   1) 页面里所有站内链接（href）与资源引用（src）都指向真实存在的文件
 *   2) 站点根目录里没有被任何页面链接到的「孤岛页面」
 *   3) 除首页外，每个页面至少有一条站内出路（不是死胡同）
 *
 * 只关心离线可判定的事实（文件是否存在 / 是否被引用），不发起网络请求。
 * 用法：node web/linkcheck.mjs
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = readdirSync(root).filter(
  (f) => f.endsWith('.html') && statSync(path.join(root, f)).isFile(),
);
if (pages.length === 0) {
  console.error('站点根目录没有 .html —— 先运行 npm run build && npm run publish');
  process.exit(1);
}

const EXTERNAL = /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i;
let pass = 0, fail = 0;
const problems = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; problems.push(name + (extra ? '  → ' + extra : '')); console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

/** 抽出 href/src 的值（去重） */
function refsOf(html) {
  const out = new Set();
  const re = /\b(?:href|src)\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = re.exec(html))) out.add(m[1].trim());
  return [...out];
}

const pageSet = new Set(pages);
const linkedTo = new Set();
const brokenByPage = new Map();

for (const page of pages) {
  const html = readFileSync(path.join(root, page), 'utf8');
  const broken = [];
  for (const ref of refsOf(html)) {
    if (!ref || ref.startsWith('#') || EXTERNAL.test(ref)) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = path.resolve(root, clean);
    if (!existsSync(target)) broken.push(ref);
    else if (pageSet.has(clean)) linkedTo.add(clean);
  }
  if (broken.length) brokenByPage.set(page, broken);
  check(`${page}：站内链接 / 资源全部存在`, broken.length === 0, broken.join(' '));
}

// 孤岛页面：站点根下存在，但没有任何页面链接它
const orphans = pages.filter((p) => p !== 'index.html' && !linkedTo.has(p));
check('没有孤立页面（每个页面都可达）', orphans.length === 0, orphans.join(' '));

// 死胡同：非首页页面至少要有一条指向站内其它页面的链接
for (const page of pages) {
  if (page === 'index.html') continue;
  const html = readFileSync(path.join(root, page), 'utf8');
  const outbound = refsOf(html).filter((ref) => {
    if (!ref || ref.startsWith('#') || EXTERNAL.test(ref)) return false;
    const clean = ref.split('#')[0].split('?')[0];
    return pageSet.has(clean) && clean !== page;
  });
  check(`${page}：有返回站点的导航（非死胡同）`, outbound.length > 0, '该页没有任何指向其它页面的链接');
}

console.log(`\n=== 链接体检：${pass} passed, ${fail} failed ===`);
if (problems.length) {
  console.log('\n待修：');
  for (const p of problems) console.log('  · ' + p);
}
if (fail) process.exitCode = 1;
