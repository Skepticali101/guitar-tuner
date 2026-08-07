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
      window.Element.prototype.scrollIntoView = window.Element.prototype.scrollIntoView || function () {};
      class FakeAudioParam { constructor(v){this.value=v||0;} setValueAtTime(v){this.value=v;return this;} linearRampToValueAtTime(v){this.value=v;return this;} exponentialRampToValueAtTime(v){this.value=v;return this;} setTargetAtTime(v){this.value=v;return this;} cancelScheduledValues(){return this;} cancelAndHoldAtTime(){return this;} }
      class FakeAudioNode { connect(){return this;} disconnect(){} }
      class FakeGainNode extends FakeAudioNode { constructor(){super();this.gain=new FakeAudioParam(1);} }
      class FakeOscillatorNode extends FakeAudioNode { constructor(){super();this.frequency=new FakeAudioParam(440);this.detune=new FakeAudioParam(0);this.type='sine';} start(){} stop(){} }
      class FakeBiquadFilterNode extends FakeAudioNode { constructor(){super();this.frequency=new FakeAudioParam(350);this.Q=new FakeAudioParam(1);this.gain=new FakeAudioParam(0);this.type='lowpass';} }
      class FakeDynamicsCompressorNode extends FakeAudioNode { constructor(){super();this.threshold=new FakeAudioParam(-24);this.knee=new FakeAudioParam(30);this.ratio=new FakeAudioParam(12);this.attack=new FakeAudioParam(0.003);this.release=new FakeAudioParam(0.25);} }
      class FakeAudioContext {
        constructor(){ this.currentTime = 0; this.sampleRate = 44100; this.destination = new FakeAudioNode(); }
        createGain(){ return new FakeGainNode(); }
        createOscillator(){ return new FakeOscillatorNode(); }
        createBiquadFilter(){ return new FakeBiquadFilterNode(); }
        createDynamicsCompressor(){ return new FakeDynamicsCompressorNode(); }
        createWaveShaper(){ return Object.assign(new FakeAudioNode(), { curve: null, oversample: 'none' }); }
        createBufferSource(){ return Object.assign(new FakeAudioNode(), { start(){}, stop(){}, buffer: null, playbackRate: new FakeAudioParam(1) }); }
        createBuffer(){ return { getChannelData: () => new Float32Array(0) }; }
        createAnalyser(){ return Object.assign(new FakeAudioNode(), { fftSize: 2048, getFloatTimeDomainData(){} }); }
        decodeAudioData(){ return Promise.resolve({}); }
        resume(){ return Promise.resolve(); }
      }
      window.AudioContext = FakeAudioContext;
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

function runScript(w, code){
  const script = w.document.createElement('script');
  script.textContent = code;
  w.document.body.appendChild(script);
}

const BASS_LAYER_SETUP = `
  setProgression([
    { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'bass-layer-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'subbass', isBass: true }] },
    { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block' },
  ]);
`;

test('checking Bass and saving bakes isBass:true into the layer', async () => {
  const w = await withPage(`
    leadGridSlots[0] = { stringIdx: 1, fret: 3 };
    leadIsBassToggle.checked = true;
  `);
  const payload = evalInPage(w, 'buildLeadGridPayload()');
  assert.equal(payload.isBass, true);
});

test('the grid-lead chip shows "Edit Bass" for a layer marked as bass', async () => {
  const w = await withPage(BASS_LAYER_SETUP);
  const btn = w.document.querySelector('.grid-lead-chip-open');
  assert.match(btn.textContent, /Edit Bass/);
});

test('a normal (non-bass) lead layer still shows "Edit Lead" -- no regression', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'normal-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano', isBass: false }] },
    ]);
  `);
  const btn = w.document.querySelector('.grid-lead-chip-open');
  assert.match(btn.textContent, /Edit Lead/);
});

test('the selection status text says "bass" for a selected bass layer', async () => {
  const w = await withPage(BASS_LAYER_SETUP + `
    selectedLeadForCopy = { type: 'lead', entryIdx: 0, layerId: 'bass-layer-1', chordName: 'C' };
    updateLeadCopyToolbar();
  `);
  const status = evalInPage(w, `document.getElementById('leadCopyStatus').textContent`);
  assert.match(status, /bass/);
});

test('Dup to Next Chord preserves isBass:true on the copy, and the new chip also says Edit Bass', async () => {
  const w = await withPage(BASS_LAYER_SETUP + `
    selectedLeadForCopy = { type: 'lead', entryIdx: 0, layerId: 'bass-layer-1', chordName: 'C' };
    updateLeadCopyToolbar();
  `);
  w.document.getElementById('leadDupRightBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[1].leadGrids[0].isBass'), true);
  const chips = [...w.document.querySelectorAll('.grid-lead-chip-open')];
  assert.equal(chips.length, 2);
  chips.forEach(chip => assert.match(chip.textContent, /Edit Bass/));
});

test('Save to Bin preserves the bass label, both in the entry label and its meta line', async () => {
  const w = await withPage(BASS_LAYER_SETUP + `
    selectedLeadForCopy = { type: 'lead', entryIdx: 0, layerId: 'bass-layer-1', chordName: 'C' };
  `);
  w.document.getElementById('leadSaveSelectedToBinBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  runScript(w, `renderSavedBin();`);
  await new Promise(r => setTimeout(r, 30));
  const label = w.document.querySelector('.saved-bin-row-label');
  const meta = w.document.querySelector('.saved-bin-row-meta');
  assert.match(label.textContent, /Bass/);
  assert.match(meta.textContent, /^Bass/);
});

test('loading an existing bass layer for editing restores the Bass toggle to checked', async () => {
  const w = await withPage(BASS_LAYER_SETUP + `
    leadIsBassToggle.checked = false;
  `);
  runScript(w, `loadLeadGridFromEntry(0, 'bass-layer-1');`);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'leadIsBassToggle.checked'), true);
});

test('loading a normal (non-bass) layer for editing leaves the Bass toggle unchecked', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'normal-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano', isBass: false }] },
    ]);
    leadIsBassToggle.checked = true;
  `);
  runScript(w, `loadLeadGridFromEntry(0, 'normal-1');`);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'leadIsBassToggle.checked'), false);
});

test('the octave buttons still exist and function correctly after being moved next to the tone selector', async () => {
  const w = await withPage(`
    leadGridSlots[0] = { stringIdx: 1, fret: 10 };
    leadGridSlots[1] = null;
  `);
  const btn = w.document.getElementById('leadOctaveDownBtn');
  assert.ok(btn, 'the button should still exist in the DOM');
  btn.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  const note = evalInPage(w, 'leadGridSlots[0]');
  assert.notEqual(note, null, 'the note should still exist after the shift');
});
