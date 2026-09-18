/** 极简静态服务器：把 web/dist 作为站点根目录。用法：node serve.mjs [port] */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, 'dist');
const PORT = Number(process.argv[2] ?? 8791);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/' || p === '') p = '/index.html';
    // 防目录穿越
    const filePath = path.normalize(path.join(ROOT, p));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    const st = await stat(filePath).catch(() => null);
    const target = st && st.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const buf = await readFile(target);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}/`);
});
