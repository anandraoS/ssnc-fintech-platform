// Tiny static server for the production Angular build with an /api reverse proxy (so the browser talks to ONE origin,
// exactly like the nginx image does). Zero dependencies; local development and UI end-to-end tests only.
// Usage: node scripts/serve-frontend.mjs [--port 4280] [--api http://localhost:18480] [--dir frontend/dist/investment-ops-ui/browser]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const PORT = Number(opt('--port', '4280'));
const API = new URL(opt('--api', 'http://localhost:18480'));
const DIR = path.resolve(root, opt('--dir', 'frontend/dist/investment-ops-ui/browser'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/actuator/')) {
    // The Host header is passed through unchanged (like nginx's "proxy_set_header Host $host"), so a browser request from this
    // origin is same-origin for the API and needs no CORS allow-list entry; rewriting Host would make it look cross-origin.
    const proxy = http.request({ host: API.hostname, port: API.port, path: req.url, method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end('upstream unavailable'); });
    req.pipe(proxy);
    return;
  }
  // static files; anything unknown falls back to index.html (Angular router). Path traversal is blocked.
  let file = path.join(DIR, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIR, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`UI on http://localhost:${PORT}  (api proxy -> ${API.origin}, dir ${DIR})`));
