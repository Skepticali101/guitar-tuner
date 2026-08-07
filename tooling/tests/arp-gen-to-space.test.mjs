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
    },
  });
  await new Promise((resolve) => { dom.window.addEventListener('load', resolve); setTimeout(resolve, 3000); });
  const w = dom.window;
  const setup = w.document.createElement('script');
  setup.textContent = setupScript;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 30));
  return w;
}

function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const key = '__t_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${key} = ${expr};`;
  w.document.body.appendChild(script);
  return w[key];
}

const OPEN_C_SETUP = `
  arpCurrentShape = { frets: [-1,3,2,0,1,0], baseFret: 1 };
  arpSelectedNotes = new Set([1,2,3,4,5]);
  arpPatternSelect.value = 'asPlayed';
  leadGridSlots = new Array(LEAD_GRID_TOTAL_SLOTS).fill(null);
`;

test('places exactly one note on each of the 4 downbeats, leaving the rest of the grid empty', async () => {
  const w = await withPage(OPEN_C_SETUP);
  w.document.getElementById('arpGenerateSpaceBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  const first16 = Array.from(evalInPage(w, 'leadGridSlots.slice(0, 16)'));
  const filledIndices = first16.map((n, i) => n ? i : null).filter(i => i !== null);
  assert.deepEqual(filledIndices, [0, 4, 8, 12], 'notes should land exactly on the downbeat of each beat');
});

test('alerts and does nothing when no chord/notes are selected, same guard as Generate Into Grid', async () => {
  const w = await withPage('arpCurrentShape = null; arpSelectedNotes = new Set();');
  let alertMsg = null;
  w.window.alert = (msg) => { alertMsg = msg; };
  w.document.getElementById('arpGenerateSpaceBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.match(alertMsg, /Pick a chord/);
});

test('explicitly clears the gap slots rather than leaving whatever was already there', async () => {
  const w = await withPage(OPEN_C_SETUP + `
    leadGridSlots[1] = { stringIdx: 5, fret: 12 }; // stale note that will end up in a gap after generating
  `);
  w.document.getElementById('arpGenerateSpaceBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'leadGridSlots[1]'), null);
});

test('with fewer than 4 notes selected, wraps/repeats the same note(s) across all 4 downbeats', async () => {
  const w = await withPage(`
    arpCurrentShape = { frets: [-1,3,2,0,1,0], baseFret: 1 };
    arpSelectedNotes = new Set([1]); // only one note
    leadGridSlots = new Array(LEAD_GRID_TOTAL_SLOTS).fill(null);
  `);
  w.document.getElementById('arpGenerateSpaceBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  const downbeats = evalInPage(w, 'JSON.stringify([leadGridSlots[0], leadGridSlots[4], leadGridSlots[8], leadGridSlots[12]])');
  const parsed = JSON.parse(downbeats);
  parsed.forEach(note => assert.deepEqual(note, { stringIdx: 1, fret: 3 }));
});

test('does not touch slots beyond the first 16 (second half of the grid stays untouched)', async () => {
  const w = await withPage(OPEN_C_SETUP + `
    leadGridSlots[20] = { stringIdx: 0, fret: 5 }; // something already in the second half
  `);
  w.document.getElementById('arpGenerateSpaceBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  const slot20 = JSON.parse(evalInPage(w, 'JSON.stringify(leadGridSlots[20])'));
  assert.deepEqual(slot20, { stringIdx: 0, fret: 5 });
});
