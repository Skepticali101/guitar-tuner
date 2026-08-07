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
  const setup = w.document.createElement('script');
  setup.textContent = setupScript;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 30));
  return w;
}

function runScript(w, code){
  const script = w.document.createElement('script');
  script.textContent = code;
  w.document.body.appendChild(script);
}
function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const key = '__t_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${key} = ${expr};`;
  w.document.body.appendChild(script);
  return w[key];
}

test('leadEditingEntryIndex correctly re-locates after an earlier chord is removed, and Save Lead writes to the right chord', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'A', beats: 4, strumPattern: 'block' },
      { rootIndex: 2, suffix: '', label: 'II', modeName: 'Ionian', chordName: 'B', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'eb-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'electricbass' }] },
      { rootIndex: 4, suffix: '', label: 'III', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' },
    ]);
    loadLeadGridFromEntry(1, 'eb-1');
  `);
  assert.equal(evalInPage(w, 'leadEditingEntryIndex'), 1);

  runScript(w, `setProgression(progression.filter((_, i) => i !== 0));`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'leadEditingEntryIndex'), 0, 'B shifted down to index 0, the tracker must follow it');
  assert.equal(evalInPage(w, 'leadEditingLayerId'), 'eb-1');

  runScript(w, `
    leadGridSlots[2] = { stringIdx: 2, fret: 7 };
    updateLeadInPlace();
  `);
  await new Promise(r => setTimeout(r, 20));
  const bNote = evalInPage(w, `JSON.stringify(progression.find(e => e.chordName === 'B').leadGrids[0].slots[2])`);
  assert.equal(bNote, JSON.stringify({ stringIdx: 2, fret: 7 }), 'the edit must land on B, the chord actually being edited');
  assert.equal(evalInPage(w, `progression.find(e => e.chordName === 'C').leadGrids`), undefined, 'C must be completely untouched');
});

test('drumEditingEntryIndex correctly re-locates after an earlier chord is removed, and Save Pattern writes to the right chord', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'A', beats: 4, strumPattern: 'block' },
      { rootIndex: 2, suffix: '', label: 'II', modeName: 'Ionian', chordName: 'B', beats: 4, strumPattern: 'block',
        drumPattern: { id: 'dp-1', slots: Array(32).fill(null).map(()=>Array(10).fill(false)), kit: 'rock', patternLengthSlots: 16 } },
      { rootIndex: 4, suffix: '', label: 'III', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' },
    ]);
    loadDrumPatternFromEntry(1);
  `);
  assert.equal(evalInPage(w, 'drumEditingEntryIndex'), 1);

  runScript(w, `setProgression(progression.filter((_, i) => i !== 0));`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'drumEditingEntryIndex'), 0, 'B shifted down to index 0, the tracker must follow it');

  runScript(w, `
    const newSlots = drumGridSlots.map(row => [...row]);
    newSlots[0][0] = true;
    setDrumGridSlots(newSlots);
    saveDrumPatternToEntry(drumEditingEntryIndex);
  `);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, `progression.find(e => e.chordName === 'B').drumPattern.slots[0][0]`), true);
  assert.equal(evalInPage(w, `progression.find(e => e.chordName === 'C').drumPattern`), undefined, 'C must be completely untouched');
});

test('selectedLeadForCopy re-locates entryIdx and refreshes chordName after an earlier chord is removed', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'A', beats: 4, strumPattern: 'block' },
      { rootIndex: 2, suffix: '', label: 'II', modeName: 'Ionian', chordName: 'B', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'lead-b', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] },
    ]);
    selectedLeadForCopy = { type: 'lead', entryIdx: 1, layerId: 'lead-b', chordName: 'B' };
  `);
  runScript(w, `setProgression(progression.filter((_, i) => i !== 0));`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'selectedLeadForCopy.entryIdx'), 0);
  assert.equal(evalInPage(w, 'selectedLeadForCopy.chordName'), 'B');
});

test('selectedLeadForCopy for a drum pattern re-locates by its own stable id, not a coincidental drumPattern existing at the old index', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'A', beats: 4, strumPattern: 'block',
        drumPattern: { id: 'dp-A', slots: Array(32).fill(null).map(()=>Array(10).fill(false)), kit: 'jazz', patternLengthSlots: 16 } },
      { rootIndex: 2, suffix: '', label: 'II', modeName: 'Ionian', chordName: 'B', beats: 4, strumPattern: 'block',
        drumPattern: { id: 'dp-B', slots: Array(32).fill(null).map(()=>Array(10).fill(false)), kit: 'rock', patternLengthSlots: 16 } },
    ]);
    selectedLeadForCopy = { type: 'drum', entryIdx: 0, chordName: 'A', drumPatternId: 'dp-A' };
  `);
  runScript(w, `setProgression(progression.filter((_, i) => i !== 0));`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'selectedLeadForCopy'), null, 'dp-A no longer exists anywhere -- must clear, not silently attach to dp-B');
});

test('if the selected/edited layer is itself removed, the tracker clears to null instead of dangling', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'A', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'lead-a', slots: [], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] },
    ]);
    selectedLeadForCopy = { type: 'lead', entryIdx: 0, layerId: 'lead-a', chordName: 'A' };
  `);
  runScript(w, `setProgression([]);`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'selectedLeadForCopy'), null);
});

test('fretboardActiveEntryIndex clears on any progression change, since it has no stable id to re-locate by', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'A', beats: 4, strumPattern: 'block' }]);
    fretboardActiveEntryIndex = 0;
  `);
  assert.equal(evalInPage(w, 'fretboardActiveEntryIndex'), 0);
  runScript(w, `setProgression([...progression, { rootIndex: 2, suffix: '', label: 'II', modeName: 'Ionian', chordName: 'B', beats: 4, strumPattern: 'block' }]);`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'fretboardActiveEntryIndex'), null);
});

test('unrelated additions (not removals) do not disturb a correctly-tracked editing index', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'A', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'lead-a', slots: [], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] },
    ]);
    loadLeadGridFromEntry(0, 'lead-a');
  `);
  runScript(w, `setProgression([...progression, { rootIndex: 2, suffix: '', label: 'II', modeName: 'Ionian', chordName: 'B', beats: 4, strumPattern: 'block' }]);`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(evalInPage(w, 'leadEditingEntryIndex'), 0, 'A is still at index 0, adding a new chord after it should not move anything');
});
