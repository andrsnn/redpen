// Standalone review page (read-only slides + comments). The editor already includes all of this:
//   node editor/editor-server.js projects/<name>      (edit AND review in one page)
// Kept for viewing a deck without the editor:  node review/review-server.js projects/<name> [port]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const deck = path.resolve(process.argv[2] || '.');
const PORT = +(process.argv[3] || 8767);
const slidesDir = path.join(deck, 'slides');
if (!fs.existsSync(slidesDir)) { console.error('no slides folder in ' + deck); process.exit(1); }
const api = require('./review-api.js').create({ deck, port: PORT });
const rd = (f, d) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return d; } };
const title = (() => { const m = rd(path.join(deck, 'OUTLINE.md'), '').match(/^# (.+)$/m); return m ? m[1] : path.basename(deck); })();
http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (api.handle(q, r, u)) return;
  if (u === '/list') { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ title, files: api.list() })); return; }
  const m = u.match(/^\/slides\/([\w-]+\.html)$/);
  if (m) { const s = rd(path.join(slidesDir, m[1]), null); if (s === null) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); r.end(s); return; }
  if (u === '/') { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); r.end(rd(path.join(__dirname, 'review.html'), '').replace(/__TITLE__/g, title.replace(/[<>&]/g, ''))); return; }
  r.writeHead(404); r.end();
}).listen(PORT, '127.0.0.1', () => console.log('Review ' + title + ' at http://localhost:' + PORT + '/'));
