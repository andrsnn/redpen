// Slide editor server for any deck folder (Chrome).
//   node editor/editor-server.js <deckDir>          → http://127.0.0.1:8137/
//   node editor/editor-server.js <deckDir> 8200     → custom port
// <deckDir> holds slides/*.html (and optional options/*.html) and/or canvas/*.excalidraw.
// A canvas is one big Excalidraw board: open http://127.0.0.1:8137/canvas (it is the home page when there are no slides).
// Serves the deck + editor.html and writes edited slides back in place.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || '.'); // the deck folder
const PORT = Number(process.argv[3]) || 8137;
const EDITOR_HTML = path.join(__dirname, 'editor.html');
const CANVAS_HTML = path.join(__dirname, 'canvas.html');
const HAS_SLIDES = fs.existsSync(path.join(ROOT, 'slides'));
if (!HAS_SLIDES && !fs.existsSync(path.join(ROOT, 'canvas'))) { console.error('No slides/ or canvas/ folder in ' + ROOT); process.exit(1); }
const HOST = '127.0.0.1';
const review = require('../review/review-api.js').create({ deck: ROOT, port: PORT });
// EDITOR_ALLOWED_HOSTS=name.ts.net (comma list) lets a tailnet / reverse-proxy host post too.
const EXTRA_HOSTS = (process.env.EDITOR_ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const hostOk = (h) => { h = (h || '').toLowerCase(); if (new RegExp('^(localhost|127\.0\.0\.1):' + PORT + '$').test(h)) return true; return EXTRA_HOSTS.some((x) => h === x || h === x + ':' + PORT); };
const okPostOrigin = (req) => { if (!hostOk(req.headers.host)) return false; const o = req.headers.origin; if (!o) return true; try { return hostOk(new URL(o).host); } catch (e) { return false; } };

// ---- export (PNG / PDF) via the repo-root puppeteer + pdf-lib ----
// puppeteer + pdf-lib: nearest node_modules walking up from this file
function findModules() {
  for (let d = __dirname; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'node_modules', 'puppeteer'))) return path.join(d, 'node_modules');
    if (path.dirname(d) === d) return path.join(__dirname, 'node_modules');
  }
}
const REPO_MODULES = findModules();
let browserP = null;
function browser() {
  if (!browserP) {
    const puppeteer = require(path.join(REPO_MODULES, 'puppeteer'));
    browserP = puppeteer.launch().catch((e) => { browserP = null; throw e; });
  }
  return browserP;
}
async function shootSlides(rel) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: 1360, height: 1000, deviceScaleFactor: 2 });
    await page.goto('http://' + HOST + ':' + PORT + '/' + rel, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const els = await page.$$('.slide');
    const shots = [];
    for (const el of els) shots.push(await el.screenshot({ type: 'png' }));
    return shots;
  } finally { await page.close(); }
}
// Text-based PDF: Chrome prints each slide (real, selectable text), pdf-lib merges the files.
const PRINT_CSS = '@page{size:1280px 720px;margin:0}' +
  'html,body{background:none!important;padding:0!important;margin:0!important;display:block!important}' +
  '.slide{box-shadow:none!important;margin:0!important;break-after:page;page-break-after:always}' +
  '.slide:last-of-type{break-after:auto;page-break-after:auto}';
async function printPdf(rel) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto('http://' + HOST + ':' + PORT + '/' + rel, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.addStyleTag({ content: PRINT_CSS });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    return await page.pdf({ width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
  } finally { await page.close(); }
}
async function buildPdf(files) {
  const { PDFDocument } = require(path.join(REPO_MODULES, 'pdf-lib'));
  const out = await PDFDocument.create();
  out.setTitle('Deck');
  for (const f of files) {
    const src = await PDFDocument.load(await printPdf(f));
    for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
  }
  return Buffer.from(await out.save({ useObjectStreams: false }));
}
// PPTX: one full-bleed 2x PNG per slide on a 16:9 (13.333 x 7.5 in) slide, so it matches the browser pixel for pixel.
async function buildPptx(files) {
  const PptxGenJS = require(path.join(REPO_MODULES, 'pptxgenjs'));
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  for (const f of files) {
    for (const png of await shootSlides(f)) {
      const slide = pres.addSlide();
      slide.addImage({ data: 'image/png;base64,' + png.toString('base64'), x: 0, y: 0, w: '100%', h: '100%' });
    }
  }
  return Buffer.from(await pres.write({ outputType: 'nodebuffer' }));
}

// Minimal store-only zip (PNGs are already compressed). Uses Node's built-in crc32.
function zipStore(entries) {
  const zlib = require('zlib');
  const parts = [], central = [];
  let off = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name), crc = zlib.crc32(data) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    parts.push(lh, n, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
function sendFile(res, buf, type, name) {
  res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': 'attachment; filename="' + name + '"', 'Content-Length': buf.length });
  res.end(buf);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.excalidraw': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

function safeJoin(rel) {
  const clean = String(rel).replace(/^\/+/, '');
  const abs = path.normalize(path.join(ROOT, clean));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null; // traversal guard
  return abs;
}

function listSlides() {
  const out = [];
  for (const sub of ['slides', 'options']) {
    const dir = path.join(ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html')).sort()) {
      out.push(sub + '/' + f);
    }
  }
  return out;
}

function listCanvases() {
  const dir = path.join(ROOT, 'canvas');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.excalidraw')).map((f) => f.slice(0, -'.excalidraw'.length)).sort();
}
// canvas names are plain words only, so a request can never leave canvas/
function canvasPath(name) {
  if (typeof name !== 'string' || !/^[\w-]+$/.test(name)) return null;
  return path.join(ROOT, 'canvas', name + '.excalidraw');
}

// ---- reorder a main-deck slide: renumber files, <title>, .pageno, flow cues, and review comments ----
function moveSlide(rel, dir) {
  const sdir = path.join(ROOT, 'slides');
  const files = fs.readdirSync(sdir).filter((f) => /^\d\d-[\w-]+\.html$/.test(f)).sort();
  const i = files.indexOf(path.basename(rel)), j = i + dir;
  if (i < 0 || j < 0 || j >= files.length) throw new Error('cannot move');
  const read = (f) => fs.readFileSync(path.join(sdir, f), 'utf8');
  // short names come from the existing flow cues ("02 · Philosophy → 04 · Guardrails")
  const names = {};
  for (const f of files) {
    const m = read(f).match(/<div class="abs flow">([^<]*)<\/div>/);
    if (m) m[1].split('→').forEach((part) => { const mm = part.trim().match(/^(\d\d) · (.+)$/); if (mm) names[mm[1]] = mm[2]; });
  }
  const nameOf = (f) => names[f.slice(0, 2)] || f.slice(3).replace(/\.html$/, '').replace(/-/g, ' ');
  const nm = {}; files.forEach((f) => { nm[f] = nameOf(f); });
  const order = files.slice(); [order[i], order[j]] = [order[j], order[i]];
  const pad = (n) => String(n).padStart(2, '0');
  const map = {}; order.forEach((f, k) => { map[f] = pad(k + 1) + '-' + f.slice(3); });
  const contents = {};
  order.forEach((f, k) => {
    const num = pad(k + 1);
    const prev = k > 0 ? pad(k) + ' · ' + nm[order[k - 1]] : 'Start of deck';
    const next = k < order.length - 1 ? pad(k + 2) + ' · ' + nm[order[k + 1]] : 'End of deck';
    contents[map[f]] = read(f)
      .replace(/<title>\d\d — /, '<title>' + num + ' — ')
      .replace(/(<div class="abs pageno">)\d\d(<\/div>)/, '$1' + num + '$2')
      .replace(/(<div class="abs flow">)[^<]*(<\/div>)/, (_, a, b) => a + prev + ' → ' + next + b);
  });
  for (const f of files) fs.renameSync(path.join(sdir, f), path.join(sdir, '__moving__' + f));
  for (const [f, html] of Object.entries(contents)) fs.writeFileSync(path.join(sdir, f), html, 'utf8');
  for (const f of files) fs.unlinkSync(path.join(sdir, '__moving__' + f));
  // keep review threads pointing at the right slides
  const inbox = path.join(ROOT, 'review', 'comments.jsonl'), stf = path.join(ROOT, 'review', 'state.json');
  if (fs.existsSync(inbox)) {
    const lines = fs.readFileSync(inbox, 'utf8').split('\n').map((l) => {
      if (!l.trim()) return l;
      try { const c = JSON.parse(l); if (c.slide && map[c.slide]) c.slide = map[c.slide]; return JSON.stringify(c); } catch (e) { return l; }
    });
    fs.writeFileSync(inbox, lines.join('\n'));
  }
  if (fs.existsSync(stf)) {
    try { const st = JSON.parse(fs.readFileSync(stf, 'utf8')); for (const k of Object.keys(st)) if (Array.isArray(st[k].slides)) st[k].slides = st[k].slides.map((f) => map[f] || f); fs.writeFileSync(stf, JSON.stringify(st, null, 1)); } catch (e) {}
  }
  return 'slides/' + map[path.basename(rel)];
}

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://' + HOST); } catch { return send(res, 400, 'bad url'); }
  const p = decodeURIComponent(url.pathname);
  if (req.method === 'POST' && !okPostOrigin(req)) { return send(res, 403, 'forbidden'); }
  if (review.handle(req, res, p)) return;   // comments, replies, status, dictation, live events

  if (req.method === 'GET' && p === '/canvas') {
    return send(res, 200, fs.readFileSync(CANVAS_HTML), MIME['.html']);
  }
  if (req.method === 'GET' && (p === '/' || p === '/index.html' || p === '/editor.html')) {
    return send(res, 200, fs.readFileSync(HAS_SLIDES ? EDITOR_HTML : CANVAS_HTML), MIME['.html']);
  }

  // ---- canvas (Excalidraw scenes in canvas/NAME.excalidraw) ----
  if (req.method === 'GET' && p === '/api/canvas/list') {
    return send(res, 200, JSON.stringify({ root: path.basename(ROOT), files: listCanvases() }), MIME['.json']);
  }
  if (req.method === 'GET' && (p === '/api/canvas/get' || p === '/api/canvas/mtime')) {
    const abs = canvasPath(url.searchParams.get('file'));
    if (!abs || !fs.existsSync(abs)) return send(res, 404, 'no such canvas');
    if (p === '/api/canvas/mtime') return send(res, 200, JSON.stringify({ mtime: fs.statSync(abs).mtimeMs }), MIME['.json']);
    return send(res, 200, fs.readFileSync(abs), MIME['.json']);
  }
  if (req.method === 'POST' && p === '/api/canvas/save') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20_000_000) req.destroy(); });
    req.on('end', () => {
      try {
        const { file, scene } = JSON.parse(body);
        const abs = canvasPath(file);
        if (!abs || !scene || scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) return send(res, 400, 'bad canvas');
        const out = JSON.stringify(scene, null, 1);
        if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') !== out) { // keep one previous copy
          fs.mkdirSync(path.join(ROOT, 'canvas', '.bak'), { recursive: true });
          fs.copyFileSync(abs, path.join(ROOT, 'canvas', '.bak', path.basename(abs)));
        }
        fs.writeFileSync(abs, out, 'utf8');
        return send(res, 200, JSON.stringify({ ok: true, elements: scene.elements.length }), MIME['.json']);
      } catch (e) { return send(res, 500, 'save failed: ' + e.message, MIME['.json']); }
    });
    return;
  }

  if (req.method === 'GET' && p === '/api/list') {
    return send(res, 200, JSON.stringify({ root: path.basename(ROOT), files: listSlides() }), MIME['.json']);
  }

  if (req.method === 'GET' && p === '/api/export/png') {
    const file = url.searchParams.get('file') || '';
    const abs = safeJoin(file);
    if (!abs || !abs.endsWith('.html') || !fs.existsSync(abs)) return send(res, 400, 'bad file');
    shootSlides(file).then((shots) => {
      if (!shots.length) return send(res, 500, 'no .slide found');
      sendFile(res, shots[0], 'image/png', path.basename(file, '.html') + '.png');
    }).catch((e) => send(res, 500, 'export failed: ' + e.message));
    return;
  }

  if (req.method === 'GET' && p === '/api/export/pngs') {
    (async () => {
      const entries = [];
      for (const f of listSlides().filter((x) => x.startsWith('slides/'))) {
        const shots = await shootSlides(f);
        if (shots[0]) entries.push({ name: path.basename(f, '.html') + '.png', data: shots[0] });
      }
      sendFile(res, zipStore(entries), 'application/zip', 'slides-png.zip');
    })().catch((e) => send(res, 500, 'export failed: ' + e.message));
    return;
  }

  if (req.method === 'GET' && p === '/api/export/pptx') {
    const files = listSlides().filter((f) => f.startsWith('slides/'));
    buildPptx(files).then((buf) => sendFile(res, buf, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'deck.pptx'))
      .catch((e) => send(res, 500, 'export failed: ' + e.message));
    return;
  }

  if (req.method === 'GET' && p === '/api/export/pdf') {
    const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'main';
    const files = listSlides().filter((f) => scope === 'all' || f.startsWith('slides/'));
    buildPdf(files).then((buf) => sendFile(res, buf, 'application/pdf', scope === 'all' ? 'deck-with-options.pdf' : 'deck.pdf'))
      .catch((e) => send(res, 500, 'export failed: ' + e.message));
    return;
  }

  if (req.method === 'POST' && p === '/api/move') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      try {
        const { file, dir } = JSON.parse(body);
        if (typeof file !== 'string' || !file.startsWith('slides/') || (dir !== 1 && dir !== -1)) return send(res, 400, 'bad request');
        return send(res, 200, JSON.stringify({ ok: true, file: moveSlide(file, dir) }), MIME['.json']);
      } catch (e) { return send(res, 400, 'move failed: ' + e.message); }
    });
    return;
  }

  // swap a variant into the main deck; the old main slide is kept as that variant, so nothing is lost
  if (req.method === 'POST' && p === '/api/promote') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      try {
        const { file } = JSON.parse(body);
        const m = /^options\/([\w-]+?)--([\w-]+)\.html$/.exec(String(file));
        if (!m) return send(res, 400, 'not a variant');
        const sdir = path.join(ROOT, 'slides');
        const mainName = fs.readdirSync(sdir).find((f) => f.replace(/^\d+-/, '') === m[1] + '.html');
        if (!mainName) return send(res, 400, 'no main slide for this variant');
        const mainP = path.join(sdir, mainName), varP = path.join(ROOT, file);
        const oldMain = fs.readFileSync(mainP, 'utf8'), varHtml = fs.readFileSync(varP, 'utf8');
        const num = mainName.slice(0, 2);
        const flow = (oldMain.match(/<div class="abs flow">[^<]*<\/div>/) || [''])[0];
        let promoted = varHtml.replace(/<title>\d\d(?: alt)? — /, '<title>' + num + ' — ').replace(/(<div class="abs pageno">)\d\d(<\/div>)/, '$1' + num + '$2');
        if (flow) promoted = promoted.replace(/<div class="abs flow">[^<]*<\/div>/, flow);
        fs.writeFileSync(mainP, promoted, 'utf8'); fs.writeFileSync(varP, oldMain, 'utf8');
        return send(res, 200, JSON.stringify({ ok: true, main: 'slides/' + mainName }), MIME['.json']);
      } catch (e) { return send(res, 400, 'promote failed: ' + e.message); }
    });
    return;
  }

  if (req.method === 'POST' && p === '/api/save') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4_000_000) { req.destroy(); } });
    req.on('end', () => {
      try {
        const { file, html } = JSON.parse(body.replace(/^\uFEFF/, '')); // tolerate BOM
        if (typeof file !== 'string' || typeof html !== 'string') return send(res, 400, 'file and html required');
        const abs = safeJoin(file);
        if (!abs || !abs.toLowerCase().endsWith('.html')) return send(res, 400, 'only .html files may be saved');
        fs.writeFileSync(abs, html, 'utf8');
        return send(res, 200, JSON.stringify({ ok: true, file, bytes: Buffer.byteLength(html) }), MIME['.json']);
      } catch (e) { return send(res, 500, 'save failed: ' + e.message, MIME['.json']); }
    });
    return;
  }

  // static file
  if (req.method === 'GET') {
    const abs = safeJoin(p);
    if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const ext = path.extname(abs).toLowerCase();
      return send(res, 200, fs.readFileSync(abs), MIME[ext] || 'application/octet-stream');
    }
  }
  return send(res, 404, 'not found', MIME['.json']);
});

server.listen(PORT, HOST, () => {
  console.log('Slide editor running:');
  console.log('  http://' + HOST + ':' + PORT + '/');
  console.log('  (Ctrl+C to stop — edits save straight back into ' + ROOT + ')');
});
