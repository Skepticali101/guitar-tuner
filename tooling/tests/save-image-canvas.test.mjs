import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

async function withPage(setupScript){
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(readFileSync(INDEX_HTML_PATH, 'utf8'), {
    url: 'file://' + INDEX_HTML_PATH,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.Element.prototype.scrollIntoView = window.Element.prototype.scrollIntoView || function () {};
      window.HTMLCanvasElement.prototype.getContext = function (type) {
        if (type !== '2d') return null;
        if (!this.__mockCtx) {
          const calls = [];
          this.__mockCalls = calls;
          const props = { font: '10px sans-serif' };
          this.__mockCtx = new Proxy({}, {
            get(target, prop) {
              if (prop === 'measureText') {
                return (text) => {
                  const sizeMatch = /([\d.]+)px/.exec(props.font || '');
                  const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 10;
                  calls.push({ method: 'measureText', args: [text] });
                  return { width: String(text).length * fontSize * 0.6 };
                };
              }
              if (prop in props) return props[prop]; return (...args) => { calls.push({ method: prop, args }); };
            },
            set(target, prop, value) { props[prop] = value; calls.push({ set: prop, value }); return true; },
          });
        }
        return this.__mockCtx;
      };
      window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
      window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}), text: () => Promise.resolve(''), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
      const store = {};
      Object.defineProperty(window, 'localStorage', {
        value: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        configurable: true,
      });
    },
  });
  await new Promise((resolve) => { dom.window.addEventListener('load', resolve); setTimeout(resolve, 3000); });
  const w = dom.window;
  const setup = w.document.createElement('script');
  setup.textContent = setupScript;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 30));
  const realErrors = errors.filter(e => !/fonts\.googleapis|AudioContext/.test(e.message || ''));
  return { w, realErrors };
}

test('generateProgressionCanvas runs without error and produces a nonzero-sized canvas', async () => {
  const { w, realErrors } = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block' },
    ]);
    window.__testCanvas = generateProgressionCanvas();
  `);
  assert.equal(realErrors.length, 0, 'no unexpected errors: ' + realErrors.map(e => e.message).join('; '));
  assert.ok(w.__testCanvas.width > 0 && w.__testCanvas.height > 0);
});

test('generateProgressionCanvas draws the correct chord names and labels for each chord', async () => {
  const { w } = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block' },
    ]);
    window.__testCanvas = generateProgressionCanvas();
  `);
  const texts = w.__testCanvas.__mockCalls.filter(c => c.method === 'fillText').map(c => c.args[0]);
  assert.ok(texts.includes('1. C'), 'first chord card should show its number and name');
  assert.ok(texts.includes('IV \u00b7 Ionian'), 'second chord card should show its roman numeral and mode');
});

test('drawChordDiagramOnCanvas draws exactly the right shapes for a real chord: fretted dots, open-string circles, muted-string marker, and finger numbers', async () => {
  const { w } = await withPage(`
    const realCanvas = document.createElement('canvas');
    const realCtx = realCanvas.getContext('2d');
    drawChordDiagramOnCanvas(realCtx, 10, 10, { frets: [-1,3,2,0,1,0], baseFret: 1, fingers: [0,3,2,0,1,0] });
    window.__diagramCalls = realCanvas.__mockCalls;
  `);
  const calls = w.__diagramCalls;
  const arcCalls = calls.filter(c => c.method === 'arc');
  assert.equal(arcCalls.length, 5, '3 fretted-note dots (strings 1,2,4) + 2 open-string circles (strings 3,5) -- the muted string (0) draws as text, not an arc');
  const texts = calls.filter(c => c.method === 'fillText').map(c => c.args[0]);
  assert.deepEqual(texts.sort(), ['1', '2', '3', 'x'].sort(), 'muted-string marker plus the three nonzero finger numbers, in any draw order');
});

test('a chord with no available shape is skipped gracefully -- no diagram drawn, no crash', async () => {
  const { w, realErrors } = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' },
    ]);
    window.__testCanvas = generateProgressionCanvas();
  `);
  assert.equal(realErrors.length, 0);
  assert.ok(w.__testCanvas.width > 0, 'should still produce a valid canvas even though chords-db never loaded in this test (no shape available)');
});

test('the exported canvas has a white background, not the app\'s dark theme -- print-friendly redesign', async () => {
  const { w } = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' }]);
    window.__testCanvas = generateProgressionCanvas();
  `);
  const calls = w.__testCanvas.__mockCalls;
  const bgFillRect = calls.find(c => c.method === 'fillRect');
  assert.ok(bgFillRect, 'the background should still be painted with fillRect');
  // the fillStyle in effect at the time of that fillRect call
  const fillStyleSets = calls.slice(0, calls.indexOf(bgFillRect)).filter(c => c.set === 'fillStyle');
  const bgColor = fillStyleSets[fillStyleSets.length - 1].value;
  assert.equal(bgColor, '#ffffff');
});

test('each chord cell uses a border (strokeRect) instead of a filled background -- the reported "least ink" request', async () => {
  const { w } = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' }]);
    window.__testCanvas = generateProgressionCanvas();
  `);
  const calls = w.__testCanvas.__mockCalls;
  assert.ok(calls.some(c => c.method === 'strokeRect'), 'should draw a bordered rectangle for the chord cell');
  // Only the one, large, page-background fillRect should remain -- no
  // per-chord-cell fillRect painting a colored/tinted box anymore.
  const fillRectCalls = calls.filter(c => c.method === 'fillRect');
  assert.equal(fillRectCalls.length, 1, 'the only fillRect left should be the single page-background fill, not a per-chord cell fill');
});

test('a chord name too long to fit the cell gets shrunk or truncated instead of overflowing -- the reported bug', async () => {
  const { w } = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'This Is An Extremely Long Roman Numeral Label', modeName: 'Lydian Dominant Extended Mode Name', chordName: 'F#maj13#11(no5)add9', beats: 4, strumPattern: 'block' }]);
    window.__testCanvas = generateProgressionCanvas();
  `);
  const calls = w.__testCanvas.__mockCalls;
  const texts = calls.filter(c => c.method === 'fillText').map(c => c.args[0]);
  const titleText = texts.find(t => t.startsWith('1.'));
  const subtitleText = texts.find(t => t.includes('Lydian') || t.includes('Extremely'));
  assert.ok(titleText, 'the chord title should still have been drawn (just possibly shortened)');
  // fitTextToWidth caps text at well under the full, untruncated string
  // once it can't shrink the font any further -- confirms the overflow
  // guard actually engaged rather than drawing the raw, oversized text.
  assert.ok(titleText.length < ('1. F#maj13#11(no5)add9').length || titleText.endsWith('\u2026'), 'the title should be shortened or ellipsis-truncated, not drawn at full length unchecked');
  assert.ok(subtitleText, 'the subtitle should still have been drawn (just possibly shortened)');
});

test('fitTextToWidth: shrinks font size before resorting to truncation', async () => {
  const { w } = await withPage(`
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    window.__short = fitTextToWidth(ctx, 'Cmaj7', 1000, 'bold', 26, 14, 'monospace');
    window.__medium = fitTextToWidth(ctx, 'a very long piece of text indeed', 80, 'bold', 26, 14, 'monospace');
  `);
  assert.equal(w.__short.fontSize, 26, 'plenty of room -- should stay at the max font size, no shrinking needed');
  assert.equal(w.__short.text, 'Cmaj7', 'text that fits should be returned unchanged');
  assert.ok(w.__medium.fontSize <= 26 && w.__medium.fontSize >= 14, 'a tight fit should shrink within the allowed range');
});
