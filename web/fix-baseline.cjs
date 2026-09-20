/** 把历史版本的牌面资产从 git 固化到 web/baseline/，作为对照与回归的稳定参照物。
 *
 *  为什么不能靠 git HEAD：仓库有自动化在自动提交，HEAD 会前进到下一版，
 *  临时文件也会被自动清理 —— 于是「升级前基准」随时会变成「升级后」，
 *  对照图会自己跟自己比（实测踩到：两版 detail 完全一致 0.0%，白忙一轮）。
 *  固化进 baseline/ 后，参照物稳定、可复现、可入库。
 *
 *  用法：node web/fix-baseline.cjs <commit> <v1|v2|v3>
 *    v1 = 质感升级前（纯扁平矢量，<text> 系统字体）
 *    v2 = 质感升级后（渐变倒角，仍用 <text> 系统字体）
 *    v3 = 字形路径化 + 统一光源
 *  不带参数时打印现有快照状态。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repo = path.join(__dirname, '..');
const REF = process.argv[2];
const LABEL = process.argv[3];

// 每个版本的识别特征 —— 防止「取到的 commit 其实装的是另一版」这类静默错配。
// 版本号带小档（3.1 / 3.2 …）时按同样规则在此登记一条，别只更新 SIGNATURE 的键名而
// 忘了写 has —— 特征写不出来的快照，下一轮就分不清它到底是哪一版。
const SIGNATURE = {
  v1: { has: ['MJTiles'], lacks: ['nid(', 'glyphPath'] },
  v2: { has: ['nid(', "version: '2."], lacks: ['glyphPath'] },
  v3: { has: ['glyphPath', "version: '3.0"], lacks: [] },
  'v3.1': { has: ['glyphPath', "version: '3.1", 'RED_STICKS'], lacks: [] },
};

const dir = path.join(__dirname, 'baseline');

if (!REF || !LABEL) {
  const found = fs.readdirSync(dir).filter((f) => /^tiles-ui-v\d+\.js$/.test(f)).sort();
  console.log('已有牌面快照：');
  for (const f of found) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = txt.match(/version: '([\d.]+)'/);
    const src = (txt.match(/git ([0-9a-f]+):/) || [, '?'])[1];
    const chars = (txt.match(/<text/) || []).length;
    console.log(`  ${f.padEnd(18)} ${String(txt.length).padStart(6)} 字符  version=${(m ? m[1] : '?').padEnd(5)} 来源=${src.padEnd(8)} <text>×${chars}`);
  }
  console.log('\n生成/更新快照：node web/fix-baseline.cjs <commit> <' +
    found.map((f) => f.replace(/^tiles-ui-|\.js$/g, '')).join('|') + '>');
  process.exit(0);
}

const sig = SIGNATURE[LABEL];
if (!sig) {
  console.error('未知版本标签：' + LABEL + '（可选 ' + Object.keys(SIGNATURE).join(' / ') + '）');
  process.exit(2);
}

let txt;
try {
  txt = execFileSync('git', ['show', REF + ':web/tiles-ui.js'], { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8');
} catch (e) {
  console.error(`git show ${REF}:web/tiles-ui.js 失败：${e.message}`);
  process.exit(1);
}

const bad = [];
for (const s of sig.has) if (!txt.includes(s)) bad.push('缺少特征 "' + s + '"');
for (const s of sig.lacks) if (txt.includes(s)) bad.push('不该含特征 "' + s + '"');
if (bad.length) {
  console.error(`REFUSED：${REF} 的内容不像 ${LABEL} —— ${bad.join('；')}\n` +
    '请先确认该 commit 里的牌面版本，再更新本脚本的 SIGNATURE。');
  process.exit(1);
}

const out = path.join(dir, `tiles-ui-${LABEL}.js`);
fs.mkdirSync(dir, { recursive: true });
const banner = [
  `/* 牌面资产 ${LABEL} —— 归档快照，仅用于对照与回归，**不是运行时代码**。`,
  ` * 来源：git ${REF}:web/tiles-ui.js`,
  ' * 由 web/fix-baseline.cjs 导出。运行时代码是 web/tiles-ui.js。',
  ' */',
  '',
].join('\n');
fs.writeFileSync(out, banner + txt);
console.log(`wrote ${path.relative(repo, out)}  (${txt.length} 字符, 来源 ${REF})`);
