#!/usr/bin/env node
// A slide that holds a live diagram you can pan and zoom while presenting.
//   node tools/new-canvas-slide.js projects/<name> <NN-slug> "<Slide title>" [canvas-name]
// Creates slides/<NN-slug>.html with the diagram embedded, and canvas/<canvas-name>.excalidraw
// if it does not exist yet. Edit the diagram at http://127.0.0.1:8137/canvas?file=<canvas-name>
// (or from the editor, double-click the diagram). The slide shows the same file, so edits appear.
'use strict';
const fs = require('fs');
const path = require('path');
const [dir, slug, title = 'Diagram', name = 'main'] = process.argv.slice(2);
if (!dir || !/^\d\d-[\w-]+$/.test(slug || '') || !/^[\w-]+$/.test(name)) {
  console.error('usage: node tools/new-canvas-slide.js projects/<name> <NN-slug> "<Slide title>" [canvas-name]');
  process.exit(1);
}
const out = path.join(dir, 'slides', slug + '.html');
if (fs.existsSync(out)) { console.error(out + ' already exists'); process.exit(1); }
const num = slug.slice(0, 2);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const tpl = fs.readFileSync(path.join(__dirname, '..', 'template', 'slide.html'), 'utf8');
const css = '  .dia{left:64px;top:152px;width:1152px;height:500px;border:1px solid #e2e5ea;border-radius:16px;overflow:hidden;background:#fff}\n  .dia iframe{width:100%;height:100%;border:0;display:block}\n';
const body =
  '  <div class="abs eyebrow">Diagram</div>\n' +
  '  <div class="abs title">' + esc(title) + '</div>\n' +
  '  <div class="abs dia"><iframe src="/canvas?file=' + name + '&embed=1" title="' + esc(title) + '"></iframe></div>\n' +
  '  <div class="abs flow">' + num + ' · Diagram</div>\n' +
  '  <div class="abs pageno">' + num + '</div>';
const html = tpl
  .replace(/<title>[\s\S]*?<\/title>/, '<title>' + num + ' — ' + esc(title) + '</title>')
  .replace('</style>', css + '</style>')
  .replace(/  <div class="abs eyebrow">[\s\S]*?  <div class="abs pageno">NN<\/div>/, body);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
const cv = path.join(dir, 'canvas', name + '.excalidraw');
if (!fs.existsSync(cv)) {
  const { Scene } = require('./canvas-dsl');
  const s = new Scene();
  s.box('a', { x: 80, y: 160, w: 260, h: 100, text: 'First box', color: 'blue' });
  s.box('b', { x: 520, y: 160, w: 260, h: 100, text: 'Second box', color: 'green' });
  s.arrow('a', 'b', { label: 'edit me' });
  fs.mkdirSync(path.dirname(cv), { recursive: true });
  s.save(cv);
}
console.log('Created ' + out);
console.log('Edit the diagram: http://127.0.0.1:8137/canvas?file=' + name);
