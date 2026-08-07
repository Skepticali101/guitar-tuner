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
      class FakeAudioContext {
        constructor(){ this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
        createGain(){ return { gain: { value: 1, setValueAtTime(){return this;}, linearRampToValueAtTime(){return this;} }, connect(){return this;} }; }
        createBiquadFilter(){ return { frequency: {value:0,setValueAtTime(){return this;}}, Q:{value:0}, gain:{value:0}, type:'lowpass', connect(){return this;} }; }
        createDynamicsCompressor(){ return { threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0}, connect(){return this;} }; }
        decodeAudioData(){ return Promise.resolve({ getChannelData: () => new Float32Array(10) }); }
        resume(){ return Promise.resolve(); }
      }
      window.AudioContext = FakeAudioContext;
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

function runScript(w, code){
  const script = w.document.createElement('script');
  script.textContent = code;
  w.document.body.appendChild(script);
}

function state(w, id){
  const el = w.document.getElementById(id);
  return { dirty: el.classList.contains('save-btn-dirty'), clean: el.classList.contains('save-btn-clean') };
}

// ---- Lead tab ----

test('Lead: starts neutral (neither dirty nor clean)', async () => {
  const w = await withPage(null);
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: false, clean: false });
});

test('Lead: placing a note marks the Save button dirty (red)', async () => {
  const w = await withPage(`setLeadGridSlots([{ stringIdx: 1, fret: 3 }, ...leadGridSlots.slice(1)]);`);
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: true, clean: false });
});

test('Lead: the exact described scenario -- an edit turns the button red, and Undo back to the save point turns it back off', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'layer-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] }]);
    loadLeadGridFromEntry(0, 'layer-1'); // now clean, matches what's saved
  `);
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: false, clean: true }, 'loading an already-saved layer should read as clean');

  // "user accidentally removes a note"
  runScript(w, `setLeadGridSlots([null, ...leadGridSlots.slice(1)]);`);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: true, clean: false }, 'removing the note is an edit -- should turn red');

  // "clicks Undo"
  runScript(w, `undoLeadGrid();`);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: false, clean: true }, 'undo back to the exact save point should turn red off');
});

test('Lead: Redo after Undo re-applies dirty state correctly', async () => {
  const w = await withPage(`setLeadGridSlots([{ stringIdx: 1, fret: 3 }, ...leadGridSlots.slice(1)]);`);
  runScript(w, `undoLeadGrid();`);
  await new Promise(r => setTimeout(r, 20));
  runScript(w, `redoLeadGrid();`);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: true, clean: false });
});

test('Lead: clicking Save Lead (in-place) marks the button clean (green)', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'layer-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] }]);
    loadLeadGridFromEntry(0, 'layer-1');
    setLeadGridSlots([{ stringIdx: 2, fret: 5 }, ...leadGridSlots.slice(1)]);
  `);
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: true, clean: false });
  const btn = w.document.getElementById('leadSaveGridBtn');
  btn.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: false, clean: true });
});

test('Lead: Save to Bin also marks the tracker clean', async () => {
  const w = await withPage(`setLeadGridSlots([{ stringIdx: 1, fret: 3 }, ...leadGridSlots.slice(1)]);`);
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: true, clean: false });
  w.document.getElementById('leadSaveToBinBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(state(w, 'leadSaveGridBtn'), { dirty: false, clean: true });
});

// ---- Drums tab ----

test('Drums: placing a hit marks the Save button dirty', async () => {
  const w = await withPage(`setDrumGridSlots([[true, ...new Array(9).fill(false)], ...drumGridSlots.slice(1)]);`);
  assert.deepEqual(state(w, 'drumSaveBtn'), { dirty: true, clean: false });
});

test('Drums: the exact described scenario -- edit then Undo turns red off', async () => {
  const w = await withPage(`
    const pattern = Array(32).fill(null).map(()=>Array(10).fill(false));
    pattern[0][0] = true;
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      drumPattern: { slots: pattern, kit: 'rock', patternLengthSlots: 16 } }]);
    loadDrumPatternFromEntry(0);
  `);
  assert.deepEqual(state(w, 'drumSaveBtn'), { dirty: false, clean: true });

  runScript(w, `
    const newSlots = drumGridSlots.map(row => [...row]);
    newSlots[0][0] = false; // accidentally remove the hit
    setDrumGridSlots(newSlots);
  `);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(state(w, 'drumSaveBtn'), { dirty: true, clean: false });

  runScript(w, `undoDrumGrid();`);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(state(w, 'drumSaveBtn'), { dirty: false, clean: true });
});

test('Drums: clicking Save Pattern to Chord (in-place) marks the button clean -- regression guard, this was found broken (never called markClean) during verification', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      drumPattern: { slots: Array(32).fill(null).map(()=>Array(10).fill(false)), kit: 'rock', patternLengthSlots: 16 } }]);
    loadDrumPatternFromEntry(0);
    const newSlots = drumGridSlots.map(row => [...row]);
    newSlots[0][0] = true;
    setDrumGridSlots(newSlots);
  `);
  assert.deepEqual(state(w, 'drumSaveBtn'), { dirty: true, clean: false });
  w.document.getElementById('drumSaveBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(state(w, 'drumSaveBtn'), { dirty: false, clean: true });
});

test('Drums: Save to Bin also marks the tracker clean -- regression guard, this was also found broken during verification', async () => {
  const w = await withPage(`setDrumGridSlots([[true, ...new Array(9).fill(false)], ...drumGridSlots.slice(1)]);`);
  assert.deepEqual(state(w, 'drumSaveBtn'), { dirty: true, clean: false });
  w.document.getElementById('drumSaveToBinBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(state(w, 'drumSaveBtn'), { dirty: false, clean: true });
});
