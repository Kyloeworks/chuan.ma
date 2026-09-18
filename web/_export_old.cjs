/** 从 git HEAD 导出升级前的 tiles-ui.js 到临时文件（二进制安全：用 Buffer 落盘，
 *  绝不让 PowerShell 转手 —— 它会把 UTF-8 当 GBK 解码，中文注释全毁）。 */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const here = __dirname;
const out = path.join(here, '.old-tiles-ui.js');
const buf = execFileSync('git', ['show', 'HEAD:web/tiles-ui.js'], {
  cwd: path.join(here, '..'), maxBuffer: 1 << 28,
});
fs.writeFileSync(out, buf);
const txt = buf.toString('utf8');
const log = [
  'wrote ' + out + '  bytes=' + buf.length,
  'head-4-lines:',
  txt.split('\n').slice(0, 4).join('\n'),
  'has MJTiles: ' + txt.includes('window.MJTiles'),
];
fs.writeFileSync(path.join(here, '_old_out.txt'), log.join('\n'), 'utf8');
