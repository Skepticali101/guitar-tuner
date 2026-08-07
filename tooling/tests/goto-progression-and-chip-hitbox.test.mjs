import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

async function withPage(setupScript, testFn){
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
  if (setupScript) {
    const setup = w.document.createElement('script');
    setup.textContent = setupScript;
    w.document.body.appendChild(setup);
    await new Promise(r => setTimeout(r, 30));
  }
  await testFn(w, errors);
}

function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const resultKey = '__testResult_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${resultKey} = ${expr};`;
  w.document.body.appendChild(script);
  return w[resultKey];
}

test('Go to Progression (from Lead) switches to Chart mode without error', async () => {
  await withPage('showLeadMode();', async (w, errors) => {
    w.document.getElementById('leadGoToProgressionBtn').dispatchEvent(new w.Event('click'));
    await new Promise(r => setTimeout(r, 30));
    assert.equal(evalInPage(w, 'currentActiveMode'), 'chart');
    const realErrors = errors.filter(e => !/fonts\.googleapis|AudioContext/.test(e.message || ''));
    assert.equal(realErrors.length, 0, 'no unexpected errors during navigation: ' + realErrors.map(e => e.message).join('; '));
  });
});

test('Go to Progression (from Drums) switches to Chart mode without error', async () => {
  await withPage('showDrumsMode();', async (w, errors) => {
    w.document.getElementById('drumGoToProgressionBtn').dispatchEvent(new w.Event('click'));
    await new Promise(r => setTimeout(r, 30));
    assert.equal(evalInPage(w, 'currentActiveMode'), 'chart');
    const realErrors = errors.filter(e => !/fonts\.googleapis|AudioContext/.test(e.message || ''));
    assert.equal(realErrors.length, 0, 'no unexpected errors during navigation: ' + realErrors.map(e => e.message).join('; '));
  });
});

const CHIP_SETUP = `
  setProgression([
    { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'layer-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] },
  ]);
`;

test('grid-lead chip Edit button no longer expands to fill the whole row (regression guard for the flex:1 hitbox bug)', async () => {
  await withPage(CHIP_SETUP, async (w) => {
    const btn = w.document.querySelector('.grid-lead-chip-open');
    const flexValue = w.getComputedStyle(btn).flexGrow;
    assert.equal(flexValue, '0', 'flex-grow should be 0 -- the button must only take the width its own text needs, not expand to swallow the chip\'s remaining space');
  });
});

test('drum chip Edit button no longer expands to fill the whole row', async () => {
  await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        drumPattern: { slots: Array(32).fill(null).map(()=>Array(10).fill(false)), kit: 'rock', patternLengthSlots: 16 } },
    ]);
  `, async (w) => {
    const btn = w.document.querySelector('.drum-chip-open');
    const flexValue = w.getComputedStyle(btn).flexGrow;
    assert.equal(flexValue, '0');
  });
});
