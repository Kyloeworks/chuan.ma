/**
 * 把 web/dist/ 的构建产物同步到站点根（仓库根目录），供 GitHub Pages 直接发布。
 *
 * 只同步网页文件；源码（kernel/、web/）、脚本、配置一律不进站点根。
 * 运行：node web/publish.mjs   （等价于 npm run publish = build + publish）
 */
import { readdirSync, copyFileSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, 'dist');
const siteRoot = path.resolve(here, '..');

if (!existsSync(dist)) {
  console.error('dist/ 不存在，请先运行：node web/build.mjs');
  process.exit(1);
}

const isPage = (f) => f.endsWith('.html') || f.endsWith('.css') || f.endsWith('.js');
const files = readdirSync(dist).filter((f) => statSync(path.join(dist, f)).isFile() && isPage(f));
if (!files.some((f) => f.endsWith('.html'))) {
  console.error('dist/ 里没有 .html，先构建。');
  process.exit(1);
}

for (const f of files) {
  const src = path.join(dist, f);
  copyFileSync(src, path.join(siteRoot, f));
  console.log(`publish -> ${f}  (${(readFileSync(src).length / 1024).toFixed(1)} KB)`);
}

// GitHub Pages: 关掉 Jekyll，避免下划线开头的文件被吞
const nojekyll = path.join(siteRoot, '.nojekyll');
if (!existsSync(nojekyll)) {
  writeFileSync(nojekyll, '');
  console.log('publish -> .nojekyll');
}
console.log(`\n共 ${files.length} 个页面已同步到站点根：${siteRoot}`);
