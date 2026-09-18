const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const repo = path.join(__dirname, '..');
function g(args) { return execFileSync('git', args, { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8'); }
const L = [];
L.push('=== commits touching web/tiles-ui.js ===');
L.push(g(['log', '--format=%h|%ad|%s', '--date=format:%Y-%m-%d %H:%M', '--', 'web/tiles-ui.js']));
L.push('=== recent commits (all) ===');
L.push(g(['log', '--format=%h|%ad|%s', '--date=format:%Y-%m-%d %H:%M', '-8']));
L.push('=== HEAD tiles-ui head line ===');
L.push(g(['show', 'HEAD:web/tiles-ui.js']).split('\n')[0]);
L.push('=== which ref has v1 (no nid) ===');
const refs = g(['log', '--format=%h', '-30']).split('\n').filter(Boolean);
for (const ref of refs) {
  let txt = '';
  try { txt = g(['show', ref + ':web/tiles-ui.js']); } catch { continue; }
  const isV2 = txt.includes('nid(');
  L.push(`${ref}  bytes=${txt.length}  ${isV2 ? 'v2' : 'v1 <<<<<< 可作 before 基准'}`);
  if (!isV2) break;
}
fs.writeFileSync(path.join(__dirname, '_gitlog_out.txt'), L.join('\n'), 'utf8');
