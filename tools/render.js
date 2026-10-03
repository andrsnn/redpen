// Render slides to PNG and flag layout problems. Look at every PNG before calling a slide done.
//   node tools/render.js <deckDir> [outDir] [file.html ...]
// No files given → every slides/*.html. outDir defaults to <deckDir>/_render (gitignored).
// Flags: elements past the slide edge, clipped text, and one-word last lines in headings.
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function findModule(name) {
  for (let d = __dirname; ; d = path.dirname(d)) {
    const p = path.join(d, 'node_modules', name);
    if (fs.existsSync(p)) return p;
    if (path.dirname(d) === d) throw new Error(name + ' not found — run `npm i ' + name + '` at the repo root');
  }
}

(async () => {
  const deck = path.resolve(process.argv[2] || '.');
  const out = path.resolve(process.argv[3] || path.join(deck, '_render'));
  let files = process.argv.slice(4);
  if (!files.length) files = fs.readdirSync(path.join(deck, 'slides')).filter((f) => f.endsWith('.html')).sort();
  fs.mkdirSync(out, { recursive: true });

  const puppeteer = require(findModule('puppeteer'));
  const b = await puppeteer.launch();
  const page = await b.newPage();
  await page.setViewport({ width: 1360, height: 800 });
  let problems = 0;
  for (const f of files) {
    const file = path.isAbsolute(f) ? f : path.join(deck, 'slides', f);
    await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const issues = await page.evaluate(() => {
      const s = document.querySelector('.slide');
      if (!s) return ['no .slide element'];
      const sr = s.getBoundingClientRect();
      const bad = [];
      const name = (e) => (e.className && (e.className.baseVal ?? e.className)) || e.tagName.toLowerCase();
      for (const e of s.querySelectorAll('*')) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.right > sr.right + 1 || r.bottom > sr.bottom + 1 || r.left < sr.left - 1) bad.push('off-slide: ' + name(e));
        const cs = getComputedStyle(e);
        if (cs.overflow !== 'visible' && (e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2)) bad.push('clipped: ' + name(e));
      }
      // orphan: a heading whose last line holds a single short word
      for (const e of s.querySelectorAll('.title,.h,.name,.q')) {
        const lh = parseFloat(getComputedStyle(e).lineHeight) || 30;
        if (e.getBoundingClientRect().height > lh * 1.5) {
          const words = e.textContent.trim().split(/\s+/);
          const range = document.createRange(); const t = e.lastChild;
          if (t && t.nodeType === 3 && words.length > 2) {
            const txt = t.textContent; const i = txt.lastIndexOf(words[words.length - 1]);
            range.setStart(t, Math.max(0, i)); range.setEnd(t, txt.length);
            const lastTop = range.getBoundingClientRect().top;
            const prev = document.createRange(); prev.setStart(t, 0); prev.setEnd(t, Math.max(0, i - 1));
            const rects = [...prev.getClientRects()];
            if (rects.length && rects[rects.length - 1].top < lastTop - 2) bad.push('orphan word in heading: "' + words[words.length - 1] + '"');
          }
        }
      }
      return [...new Set(bad)];
    });
    await (await page.$('.slide')).screenshot({ path: path.join(out, path.basename(file, '.html') + '.png') });
    problems += issues.length;
    console.log((issues.length ? '✗ ' : '✓ ') + path.basename(file) + (issues.length ? '  ' + issues.join(' | ') : ''));
  }
  await b.close();
  console.log('PNGs in ' + out + (problems ? '  — ' + problems + ' issue(s) to fix' : ''));
  process.exitCode = problems ? 1 : 0;
})();
