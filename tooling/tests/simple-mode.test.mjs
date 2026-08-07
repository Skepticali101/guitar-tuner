import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

async function withPage(setupScript){
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(readFileSync(INDEX_HTML_PATH, 'utf8'), {
    url: 'file://' + INDEX_HTML_PATH,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
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
  return w;
}

function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const key = '__t_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${key} = ${expr};`;
  w.document.body.appendChild(script);
  return w[key];
}

async function toggleSimpleMode(w, on){
  const toggle = w.document.getElementById('simpleModeToggle');
  toggle.checked = on;
  toggle.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
}

test('Simple Mode defaults to off', async () => {
  const w = await withPage(null);
  assert.equal(w.document.body.classList.contains('simple-mode'), false);
  assert.equal(w.document.getElementById('simpleModeToggle').checked, false);
});

test('enabling Simple Mode adds the body class and persists to localStorage', async () => {
  const w = await withPage(null);
  await toggleSimpleMode(w, true);
  assert.equal(w.document.body.classList.contains('simple-mode'), true);
  assert.equal(evalInPage(w, `localStorage.getItem('ftr-simple-mode-v1')`), '1');
});

test('the mode picker limits to Ionian/Aeolian, but an exotic mode already selected before the toggle stays visible', async () => {
  const w = await withPage(`activeModes = ['Dorian']; renderModePicker();`);
  await toggleSimpleMode(w, true);
  const pillNames = [...w.document.querySelectorAll('.mode-pill')].map(p => p.textContent);
  assert.deepEqual(pillNames.sort(), ['Aeolian', 'Dorian', 'Ionian'].sort(), 'Ionian/Aeolian always offered, Dorian stays because it was already active, everything else (e.g. Locrian) is hidden');
});

test('turning Simple Mode back off restores all 9 modes', async () => {
  const w = await withPage(null);
  await toggleSimpleMode(w, true);
  await toggleSimpleMode(w, false);
  const pillNames = [...w.document.querySelectorAll('.mode-pill')].map(p => p.textContent);
  assert.equal(pillNames.length, 9);
});

test('advanced-only elements (Secondary Dominants, Borrowed Chords, Find Modulation) are hidden in Simple Mode', async () => {
  const w = await withPage(null);
  await toggleSimpleMode(w, true);
  const secDom = w.document.getElementById('secondaryDominantsToggle').closest('label');
  const borrowed = w.document.getElementById('borrowedChordsToggle').closest('label');
  const findMod = w.document.getElementById('findModulationBtn');
  assert.equal(w.getComputedStyle(secDom).display, 'none');
  assert.equal(w.getComputedStyle(borrowed).display, 'none');
  assert.equal(w.getComputedStyle(findMod).display, 'none');
});

test('Relative Minor/Major buttons stay visible in Simple Mode -- they are foundational, not advanced', async () => {
  const w = await withPage(null);
  await toggleSimpleMode(w, true);
  assert.notEqual(w.getComputedStyle(w.document.getElementById('relativeMinorBtn')).display, 'none');
  assert.notEqual(w.getComputedStyle(w.document.getElementById('relativeMajorBtn')).display, 'none');
});

test('advanced-only elements become visible again when Simple Mode is turned back off', async () => {
  const w = await withPage(null);
  await toggleSimpleMode(w, true);
  await toggleSimpleMode(w, false);
  const findMod = w.document.getElementById('findModulationBtn');
  assert.notEqual(w.getComputedStyle(findMod).display, 'none');
});

test('the chord card mod dropdown shows only the simple chord types in Simple Mode', async () => {
  const w = await withPage(null);
  await toggleSimpleMode(w, true);
  const setup = w.document.createElement('script');
  setup.textContent = `
    const testCard = createChartCard({ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian' });
    document.body.appendChild(testCard);
    window.__testModSelect = testCard.querySelector('.chart-card-mod');
  `;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 20));
  const values = Array.from(evalInPage(w, `[...window.__testModSelect.options].map(o => o.value)`));
  assert.deepEqual(values.sort(), ['', '7', 'maj7', 'sus4'].sort(), 'only the 4 simple major-quality options, not the full 19');
});

test('a progression chip with an advanced suffix already selected keeps that option available and selected, even though Simple Mode is on', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '7#9', label: 'I', modeName: 'Ionian', chordName: 'C7#9', beats: 4, strumPattern: 'block' }]);
  `);
  await toggleSimpleMode(w, true);
  const chipModSelect = w.document.querySelector('.progression-chip-mod');
  const values = [...chipModSelect.options].map(o => o.value);
  assert.ok(values.includes('7#9'), 'the already-selected advanced suffix must not disappear from the dropdown');
  assert.equal(chipModSelect.value, '7#9', 'the selection itself must not silently change to something else');
  assert.equal(values.length, 5, 'simple list (4 options) plus the one preserved advanced option');
  assert.ok(!values.includes('alt'), 'other unrelated advanced options should still be excluded');
});

test('turning Simple Mode off restores the full mod option list', async () => {
  const w = await withPage(null);
  await toggleSimpleMode(w, true);
  await toggleSimpleMode(w, false);
  const setup = w.document.createElement('script');
  setup.textContent = `
    const testCard = createChartCard({ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian' });
    document.body.appendChild(testCard);
    window.__testModSelect2 = testCard.querySelector('.chart-card-mod');
  `;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 20));
  const values = evalInPage(w, `[...window.__testModSelect2.options].map(o => o.value)`);
  assert.equal(values.length, 19, 'the full major-quality option list should be back');
});

test('the Lead tab\'s Map to Key/Mode button (advanced-only) is hidden in Simple Mode', async () => {
  const w = await withPage(null);
  await toggleSimpleMode(w, true);
  const btn = w.document.getElementById('leadMapToKeyModeBtn');
  assert.equal(w.getComputedStyle(btn).display, 'none');
});
