import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const isDist = process.argv.includes('--dist');
const root = path.resolve(isDist ? 'dist' : '.');
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
const allowed = /^\/(?:$|index\.html$|src\/|images\/|fonts\/|favicon\.svg$|site-config\.json$)/;
const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  const asset = !isDist && /^\/(?:images\/|fonts\/|favicon\.svg$|site-config\.json$)/.test(pathname);
  const file = path.resolve(root, asset ? `public${pathname}` : `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!allowed.test(pathname) || !file.startsWith(`${root}${path.sep}`)) { res.writeHead(404).end('Not found'); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(port, '0.0.0.0', () => console.log(`Local: http://127.0.0.1:${port}/`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
