// Scaffold a new deck folder from the template.
//   node tools/new-deck.js projects/my-talk "Title of the talk"
// Creates <dir>/slides/01-title.html, <dir>/OUTLINE.md and <dir>/.gitignore.
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || '');
const title = process.argv[3] || 'Title of the talk';
if (!process.argv[2]) { console.error('usage: node tools/new-deck.js <dir> "Title"'); process.exit(1); }
if (fs.existsSync(path.join(dir, 'slides'))) { console.error(dir + '/slides already exists'); process.exit(1); }

const tpl = fs.readFileSync(path.join(__dirname, '..', 'template', 'slide.html'), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const titleSlide = tpl
  .replace('<title>NN — Title of the slide</title>', '<title>01 — ' + esc(title) + '</title>')
  .replace(/  <div class="abs eyebrow">[\s\S]*?  <div class="abs pageno">NN<\/div>/,
    '  <div class="abs eyebrow" style="top:220px">Your name</div>\n' +
    '  <div class="abs title" style="top:270px;font-size:64px;font-weight:800;letter-spacing:-.02em;white-space:normal;width:900px;line-height:1.05">' + esc(title) + '</div>\n' +
    '  <div class="abs sub" style="top:430px;width:900px">One sentence that says what the talk shows.</div>\n' +
    '  <div class="abs flow">Start of deck → 02 · Next</div>\n' +
    '  <div class="abs pageno">01</div>');

fs.mkdirSync(path.join(dir, 'slides'), { recursive: true });
fs.writeFileSync(path.join(dir, 'slides', '01-title.html'), titleSlide);
fs.writeFileSync(path.join(dir, '.gitignore'), '_render/\n');
fs.writeFileSync(path.join(dir, 'OUTLINE.md'), `# ${title}

Fill this in with the user before building slides (see NEW-DECK.md).

## Thesis
One sentence:

## Audience and length
Who, how long, what they should do or believe after:

## Arc (one line per slide: NN · short name — the claim the slide makes)
01 · Title —
02 ·

## Facts from the user (the only source of claims)
-

## Sensitive: never on a slide
-
`);
console.log('Created ' + dir);
console.log('Next: fill OUTLINE.md with the user, then build slides one at a time.');
console.log('Edit:   node editor/editor-server.js ' + path.relative(process.cwd(), dir));
console.log('Check:  node tools/render.js ' + path.relative(process.cwd(), dir));
