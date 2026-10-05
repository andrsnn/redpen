#!/usr/bin/env node
// node tools/new-canvas.js projects/<name> "<Title>" [canvas-name]
// Adds canvas/<canvas-name>.excalidraw (default: main) to a project folder.
'use strict';
const fs = require('fs');
const path = require('path');
const [dir, title = 'Canvas', name = 'main'] = process.argv.slice(2);
if (!dir || !/^[\w-]+$/.test(name)) { console.error('usage: node tools/new-canvas.js projects/<name> "<Title>" [canvas-name]'); process.exit(1); }
const out = path.join(dir, 'canvas', name + '.excalidraw');
if (fs.existsSync(out)) { console.error(out + ' already exists'); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
const { Scene } = require('./canvas-dsl');
const s = new Scene();
s.zone('z1', { x: 0, y: 0, w: 1000, h: 500, title, color: 'blue' });
s.box('a', { x: 80, y: 200, w: 260, h: 100, text: 'First box', color: 'blue' });
s.box('b', { x: 600, y: 200, w: 260, h: 100, text: 'Second box', color: 'green' });
s.arrow('a', 'b', { label: 'edit me' });
s.save(out);
console.log('Open it: node editor/editor-server.js ' + dir + '   then http://127.0.0.1:8137/canvas');
