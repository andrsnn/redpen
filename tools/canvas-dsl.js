'use strict';
// Build an Excalidraw scene (.excalidraw JSON) from a few calls.
//
//   const { Scene } = require('./canvas-dsl');
//   const s = new Scene();            // or new Scene({ clean: true }) for straight lines and a plain font
//   s.zone('z1', { x: 0, y: 0, w: 1200, h: 700, title: '1 · Overview', color: 'blue' });
//   s.box('a', { x: 60, y: 120, w: 240, h: 90, text: 'Client', color: 'blue' });
//   s.box('b', { x: 500, y: 120, w: 240, h: 90, text: 'Server', color: 'green' });
//   s.arrow('a', 'b', { label: 'request' });
//   s.note(60, 300, 300, 120, 'Sticky note text');
//   s.save('projects/x/canvas/main.excalidraw');   // prints layout problems, if any
//
// Boxes carry their label as bound text and arrows are bound to boxes, so dragging a box in the
// editor moves its label and its arrows. Zones are locked backgrounds that group a region.

const fs = require('fs');
const path = require('path');

const COLORS = {
  blue:   ['#1971c2', '#a5d8ff'],
  green:  ['#2f9e44', '#b2f2bb'],
  violet: ['#6741d9', '#d0bfff'],
  orange: ['#e8590c', '#ffd8a8'],
  red:    ['#e03131', '#ffc9c9'],
  yellow: ['#f08c00', '#ffec99'],
  gray:   ['#495057', '#e9ecef'],
  white:  ['#1e1e1e', '#ffffff'],
};
const FONT = 1;            // Virgil (hand-drawn)
const CHAR_W = 0.62;       // width of an average character, in font sizes (conservative)
const LINE_H = 1.25;

let seedCounter = 1000;
const nextSeed = () => (seedCounter += 7919);

function wrap(text, maxChars) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (line && (line + ' ' + word).length > maxChars) { out.push(line); line = word; }
      else line = line ? line + ' ' + word : word;
    }
    out.push(line);
  }
  return out.join('\n');
}
const measure = (text, fs_) => {
  const lines = text.split('\n');
  return { w: Math.ceil(Math.max(...lines.map((l) => l.length)) * fs_ * CHAR_W), h: Math.ceil(lines.length * fs_ * LINE_H) };
};

class Scene {
  constructor(opts = {}) { this.els = []; this.byId = {}; this.problems = []; this.boxes = []; this.rough = opts.clean ? 0 : 1; this.font = opts.clean ? 2 : FONT; }

  _base(type, id, x, y, w, h, o = {}) {
    const [stroke, bg] = COLORS[o.color || 'white'] || COLORS.white;
    const el = {
      id, type, x, y, width: w, height: h, angle: 0,
      strokeColor: o.stroke || stroke,
      backgroundColor: o.fill === false ? 'transparent' : (o.fill || bg),
      fillStyle: 'solid', strokeWidth: o.strokeWidth || 2, strokeStyle: o.dashed ? 'dashed' : 'solid',
      roughness: o.roughness == null ? this.rough : o.roughness, opacity: 100,
      groupIds: [], frameId: null, roundness: o.round === false ? null : { type: 3 },
      seed: nextSeed(), version: 1, versionNonce: nextSeed(), isDeleted: false,
      boundElements: [], updated: 1, link: null, locked: !!o.locked,
    };
    this.els.push(el); this.byId[id] = el; return el;
  }

  _text(id, x, y, text, o = {}) {
    const fs_ = o.fs || 20, m = measure(text, fs_);
    const el = this._base('text', id, x, y, o.w || m.w, o.h || m.h, { color: o.color || 'white', fill: false, round: false, locked: o.locked });
    Object.assign(el, {
      strokeColor: o.stroke || (COLORS[o.color || 'white'] || COLORS.white)[0],
      text, originalText: text, fontSize: fs_, fontFamily: this.font, textAlign: o.align || 'left',
      verticalAlign: o.valign || 'top', containerId: o.containerId || null, lineHeight: LINE_H,
      baseline: Math.round(fs_ * 0.9), roundness: null,
    });
    return el;
  }

  // Free text. w makes it wrap to that width.
  text(id, x, y, text, o = {}) {
    const fs_ = o.fs || 20;
    const t = o.w ? wrap(text, Math.floor(o.w / (fs_ * CHAR_W))) : text;
    const el = this._text(id, x, y, t, { ...o, fs: fs_ });
    this.boxes.push({ id, x, y, w: el.width, h: el.height, kind: 'text' });
    return el;
  }

  // Locked background region with a title.
  zone(id, { x, y, w, h, title, color = 'gray', fs = 40 }) {
    this._base('rectangle', id, x, y, w, h, { color, fill: false, dashed: true, locked: true, strokeWidth: 3, roughness: 0 });
    this._text(id + '-title', x + 30, y + 24, title, { fs, color, locked: true });
    this.zones = (this.zones || []).concat({ id, x, y, w, h });
  }

  // A labelled shape. shape: rectangle | ellipse | diamond.
  box(id, { x, y, w, h, text = '', color = 'blue', fs = 20, shape = 'rectangle', dashed = false, align = 'center', fill }) {
    const box = this._base(shape, id, x, y, w, h, { color, dashed, fill });
    if (text) {
      const inset = shape === 'rectangle' ? 24 : 0.45 * w;
      const maxChars = Math.floor((w - inset) / (fs * CHAR_W));
      const t = wrap(text, maxChars), m = measure(t, fs);
      const room = shape === 'rectangle' ? h - 12 : h * 0.6;
      if (m.h > room) this.problems.push(`box "${id}": text needs ${m.h}px, has ${Math.round(room)}px`);
      const tid = id + '-label';
      const textW = w - (shape === 'rectangle' ? 20 : 0.4 * w);
      const tx = align === 'left' ? x + 12 : x + (w - textW) / 2;
      this._text(tid, tx, y + (h - m.h) / 2, t, { fs, color, containerId: id, align, valign: 'middle', w: textW, h: m.h });
      box.boundElements.push({ type: 'text', id: tid });
    }
    this.boxes.push({ id, x, y, w, h, kind: 'box' });
    return box;
  }

  // Sticky note (yellow by default, left-aligned text).
  note(x, y, w, h, text, { color = 'yellow', fs = 18, id } = {}) {
    id = id || 'note-' + this.els.length;
    return this.box(id, { x, y, w, h, text, color, fs, align: 'left', fill: undefined });
  }

  _side(b, side) {
    switch (side) {
      case 'right': return [b.x + b.width, b.y + b.height / 2];
      case 'left': return [b.x, b.y + b.height / 2];
      case 'top': return [b.x + b.width / 2, b.y];
      default: return [b.x + b.width / 2, b.y + b.height];
    }
  }

  // Arrow between two boxes. opts: from/to side, via [[x,y]...] waypoints, label, dashed, color, both (two heads).
  arrow(fromId, toId, o = {}) {
    const a = this.byId[fromId], b = this.byId[toId];
    if (!a || !b) { this.problems.push(`arrow ${fromId} → ${toId}: unknown box`); return; }
    const dx = b.x + b.width / 2 - (a.x + a.width / 2), dy = b.y + b.height / 2 - (a.y + a.height / 2);
    const horiz = Math.abs(dx) * 0.6 > Math.abs(dy);
    const fromSide = o.from || (horiz ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top'));
    const toSide = o.to || (horiz ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'top' : 'bottom'));
    const p0 = this._side(a, fromSide), p1 = this._side(b, toSide);
    const pts = [p0, ...(o.via || []), p1];
    const id = o.id || `arr-${fromId}-${toId}-${this.els.length}`;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const el = this._base('arrow', id, p0[0], p0[1], Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys),
      { color: o.color || 'gray', fill: false, dashed: o.dashed, round: false });
    Object.assign(el, {
      strokeColor: (COLORS[o.color || 'gray'] || COLORS.gray)[0], roundness: { type: 2 },
      points: pts.map((p) => [p[0] - p0[0], p[1] - p0[1]]), lastCommittedPoint: null,
      startBinding: { elementId: fromId, focus: 0, gap: 4 }, endBinding: { elementId: toId, focus: 0, gap: 4 },
      startArrowhead: o.both ? 'arrow' : null, endArrowhead: 'arrow',
    });
    a.boundElements.push({ type: 'arrow', id }); b.boundElements.push({ type: 'arrow', id });
    if (o.label) {
      const fs_ = o.fs || 16, t = o.labelW ? wrap(o.label, Math.floor(o.labelW / (fs_ * CHAR_W))) : o.label, m = measure(t, fs_);
      const mid = pts[Math.floor((pts.length - 1) / 2)], nxt = pts[Math.floor((pts.length - 1) / 2) + 1];
      const mx = (mid[0] + nxt[0]) / 2, my = (mid[1] + nxt[1]) / 2;
      this._text(id + '-label', mx - m.w / 2 + (o.dx || 0), my - m.h - 6 + (o.dy || 0), t, { fs: fs_, color: o.color || 'gray', align: 'center' });
    }
    return el;
  }

  // Report boxes that overlap each other (zones and arrows are ignored).
  check() {
    const bs = this.boxes;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) this.problems.push(`overlap: ${a.id} and ${b.id}`);
    }
    for (const b of bs) for (const z of this.zones || []) {
      const inside = b.x >= z.x && b.y >= z.y && b.x + b.w <= z.x + z.w && b.y + b.h <= z.y + z.h;
      const touches = b.x < z.x + z.w && z.x < b.x + b.w && b.y < z.y + z.h && z.y < b.y + b.h;
      if (touches && !inside) this.problems.push(`${b.id} crosses the edge of zone ${z.id}`);
    }
    return this.problems;
  }

  toJSON() {
    return { type: 'excalidraw', version: 2, source: 'redpen', elements: this.els, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} };
  }

  save(file) {
    const probs = this.check();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(this.toJSON(), null, 1));
    console.log(`wrote ${file}: ${this.els.length} elements` + (probs.length ? `, ${probs.length} problem(s):\n  ` + probs.join('\n  ') : ', no layout problems'));
    return probs;
  }
}

module.exports = { Scene, COLORS };
