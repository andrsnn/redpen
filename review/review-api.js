// Shared review API: comments, replies, status, dictation, and live-change events for one deck.
// Used by the editor server (editor/editor-server.js) and by the standalone review page.
//   const api = require('../review/review-api.js').create({ deck: '/path/to/projects/name', port: 8137 });
//   if (api.handle(req, res, pathname)) return;      // inside an http request handler
// Comments go to <deck>/review/comments.jsonl (append only). Status and replies go to <deck>/review/state.json.
'use strict';
const fs = require('fs'), path = require('path');

exports.create = function create({ deck, port }) {
  const slidesDir = path.join(deck, 'slides');
  const revDir = path.join(deck, 'review');
  const inbox = path.join(revDir, 'comments.jsonl');
  const stateFile = path.join(revDir, 'state.json');
  fs.mkdirSync(revDir, { recursive: true });

  const rd = (f, d) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return d; } };
  const sig = f => { try { return fs.statSync(f).mtimeMs; } catch (e) { return 0; } };
  const list = () => (fs.existsSync(slidesDir) ? fs.readdirSync(slidesDir) : []).filter(f => /^[\w-]+\.html$/.test(f)).sort();
  const readState = () => { try { return JSON.parse(rd(stateFile, '{}')); } catch (e) { return {}; } };
  const writeState = st => fs.writeFileSync(stateFile, JSON.stringify(st, null, 1));
  const readComments = () => {
    const st = readState();
    return rd(inbox, '').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(c => c && c.type !== 'reply')
      .map(c => ({ status: 'open', thread: [], ...c, ...(st[c.id] || {}) }));
  };

  // dictation: the key is read from a local env file at request time and never sent to the page
  const KEY_FILE = process.env.REVIEW_OPENAI_ENV || path.join(__dirname, '..', '.env.local');
  const openaiKey = () => { const m = rd(KEY_FILE, '').match(/^(?:export\s+)?OPENAI_API_KEY=(.+)$/m); return m ? m[1].trim().replace(/^["']|["']$/g, '') : (process.env.OPENAI_API_KEY || ''); };

  // EDITOR_ALLOWED_HOSTS=name.ts.net (comma list) lets a tailnet / reverse-proxy host post too.
  const extra = (process.env.EDITOR_ALLOWED_HOSTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const hostOk = h => { h = (h || '').toLowerCase(); return new RegExp('^(localhost|127\.0\.0\.1):' + port + '$').test(h) || extra.some(x => h === x || h === x + ':' + port); };
  const okOrigin = q => {
    if (!hostOk(q.headers.host)) return false;
    const o = q.headers.origin;
    if (!o) return true;
    try { return hostOk(new URL(o).host); } catch (e) { return false; }
  };
  const body = (q, max = 24 * 1024 * 1024) => new Promise((res, rej) => {
    const a = []; let n = 0;
    q.on('data', c => { n += c.length; if (n > max) { rej(new Error('too big')); q.destroy(); } else a.push(c); });
    q.on('end', () => res(Buffer.concat(a))); q.on('error', rej);
  });
  // canvas comments point at elements: { ids: [element ids], } (at most 10 short strings)
  const cleanAnchor = a => {
    const ids = a && Array.isArray(a.ids) ? a.ids.filter(x => typeof x === 'string' && /^[\w-]{1,80}$/.test(x)).slice(0, 10) : [];
    return ids.length ? { anchor: { ids } } : {};
  };
  const json = (r, code, obj) => { r.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); r.end(JSON.stringify(obj)); };

  // live events: slide files changed, comments changed
  const clients = new Set();
  const push = msg => clients.forEach(r => r.write('data: ' + msg + '\n\n'));
  const optDir = path.join(deck, 'options');
  const optList = () => { try { return fs.readdirSync(optDir).filter(f => f.endsWith('.html')).sort().join('|'); } catch (e) { return ''; } };
  let lastOpts = optList();
  let last = { slides: {}, c: sig(inbox) + sig(stateFile) };
  list().forEach(f => last.slides[f] = sig(path.join(slidesDir, f)));
  setInterval(() => {
    const cur = {}; list().forEach(f => cur[f] = sig(path.join(slidesDir, f)));
    const changed = Object.keys(cur).filter(f => cur[f] !== last.slides[f]);
    const removed = Object.keys(last.slides).filter(f => !(f in cur));
    if (changed.length || removed.length) {
      const structure = removed.length > 0 || changed.some(f => !(f in last.slides));
      last.slides = cur; push('slides:' + JSON.stringify({ changed, structure }));
    }
    const o = optList();
    if (o !== lastOpts) { lastOpts = o; push('slides:' + JSON.stringify({ changed: [], structure: true })); }
    const c = sig(inbox) + sig(stateFile);
    if (c !== last.c) { last.c = c; push('comments'); }
  }, 400).unref();

  function handle(q, r, u) {
    const routes = ['/comment', '/reply', '/status', '/transcribe', '/comments', '/events'];
    if (!routes.includes(u)) return false;
    (async () => {
      try {
        if (q.method === 'POST' && !okOrigin(q)) { r.writeHead(403); r.end('forbidden'); return; }
        if (q.method === 'POST' && u === '/comment') {
          const { id, slide, quote, comment, at, anchor } = JSON.parse((await body(q, 200000)).toString());
          if (!String(comment || '').trim()) throw new Error('empty');
          fs.appendFileSync(inbox, JSON.stringify({ id: id || 'comment-' + Date.now(), slide: String(slide || '').slice(0, 80), quote: String(quote || '').slice(0, 500), comment: String(comment).trim().slice(0, 40000), at: at || new Date().toISOString(), ...cleanAnchor(anchor) }) + '\n');
          r.writeHead(200); r.end('ok'); return;
        }
        if (q.method === 'POST' && u === '/reply') {
          const { id, text, at } = JSON.parse((await body(q, 20000)).toString());
          const parent = readComments().find(c => c.id === id);
          const t = String(text || '').trim();
          if (!parent || !t) throw new Error('bad');
          fs.appendFileSync(inbox, JSON.stringify({ type: 'reply', id: 'reply-' + Date.now(), parent: id, slide: parent.slide, quote: parent.quote || '', comment: '[REPLY in thread ' + id + '] ' + t, at: at || new Date().toISOString() }) + '\n');
          const st = readState(), cur = st[id] || {};
          st[id] = { ...cur, status: 'open', thread: [...(cur.thread || []), { from: 'you', text: t, at: at || new Date().toISOString() }] };
          delete st[id].doneAt; writeState(st);
          r.writeHead(200); r.end('ok'); return;
        }
        if (q.method === 'POST' && u === '/status') {
          const { id, status } = JSON.parse((await body(q, 2000)).toString());
          if (!['open', 'changed', 'addressed', 'archived'].includes(status)) throw new Error('bad');
          const st = readState(); st[id] = { ...(st[id] || {}), status };
          if (status === 'addressed') st[id].doneAt = new Date().toISOString(); else delete st[id].doneAt;
          writeState(st); r.writeHead(200); r.end('ok'); return;
        }
        if (q.method === 'POST' && u === '/transcribe') {
          const key = openaiKey(); if (!key) throw new Error('no key');
          const buf = await body(q);
          if (buf.length < 500) return json(r, 200, { text: '' });
          const type = (q.headers['content-type'] || 'audio/webm').split(';')[0];
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
          const fd = new FormData(); fd.append('file', new Blob([buf], { type }), 'speech.' + ext); fd.append('model', 'gpt-4o-transcribe');
          const up = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
          const j = await up.json(); if (!up.ok) throw new Error((j.error && j.error.message) || 'openai ' + up.status);
          return json(r, 200, { text: j.text || '' });
        }
        if (u === '/comments') return json(r, 200, readComments());
        if (u === '/events') {
          r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          r.write('retry: 1000\n\n'); clients.add(r); q.on('close', () => clients.delete(r)); return;
        }
        r.writeHead(405); r.end();
      } catch (e) {
        if (u === '/transcribe') { console.log('transcribe error:', e.message); return json(r, 502, { error: 'transcription failed' }); }
        r.writeHead(400); r.end('bad');
      }
    })();
    return true;
  }
  return { handle, list, readComments };
};
