import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

async function withRenderedProgression(testFn){
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(readFileSync(INDEX_HTML_PATH, 'utf8'), {
    url: 'file://' + INDEX_HTML_PATH,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
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
  const setup = w.document.createElement('script');
  setup.textContent = `
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'layer-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }],
        drumPattern: { slots: Array(32).fill(null).map(()=>Array(10).fill(false)), kit: 'rock', patternLengthSlots: 16 } },
    ]);
  `;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 30));
  await testFn(w);
}

function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const resultKey = '__testResult_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${resultKey} = ${expr};`;
  w.document.body.appendChild(script);
  return w[resultKey];
}

test('grid-lead chip: Edit button is clearly labeled', async () => {
  await withRenderedProgression(async (w) => {
    const label = w.document.querySelector('.grid-lead-chip-open').textContent;
    assert.match(label, /Edit/, 'the button should clearly say Edit, not just an ambiguous icon/count');
  });
});

test('grid-lead chip: clicking the background (not a button) selects it', async () => {
  await withRenderedProgression(async (w) => {
    w.document.querySelector('.grid-lead-chip').dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    const sel = evalInPage(w, 'selectedLeadForCopy');
    assert.equal(sel.type, 'lead');
    assert.equal(sel.layerId, 'layer-1');
  });
});

test('grid-lead chip: clicking Edit navigates to the Lead tab WITHOUT also toggling selection', async () => {
  await withRenderedProgression(async (w) => {
    w.document.querySelector('.grid-lead-chip-open').dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    assert.equal(evalInPage(w, 'selectedLeadForCopy'), null, 'Edit should not also select the chip');
    assert.equal(evalInPage(w, 'currentActiveMode'), 'lead', 'Edit should navigate to the Lead tab');
  });
});

test('grid-lead chip: Mute still works correctly and does not also trigger selection', async () => {
  await withRenderedProgression(async (w) => {
    w.document.querySelector('.grid-lead-chip-mute').dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    assert.equal(evalInPage(w, 'progression[0].leadGrids[0].muted'), true);
    assert.equal(evalInPage(w, 'selectedLeadForCopy'), null, 'mute should not also select the chip');
  });
});

test('drum chip: Edit button is clearly labeled', async () => {
  await withRenderedProgression(async (w) => {
    const label = w.document.querySelector('.drum-chip-open').textContent;
    assert.match(label, /Edit/);
  });
});

test('drum chip: clicking the background (not a button) selects it', async () => {
  await withRenderedProgression(async (w) => {
    w.document.querySelector('.drum-chip').dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    const sel = evalInPage(w, 'selectedLeadForCopy');
    assert.equal(sel.type, 'drum');
  });
});

test('drum chip: clicking Edit navigates to the Drums tab WITHOUT also toggling selection', async () => {
  await withRenderedProgression(async (w) => {
    w.document.querySelector('.drum-chip-open').dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    assert.equal(evalInPage(w, 'selectedLeadForCopy'), null);
    assert.equal(evalInPage(w, 'currentActiveMode'), 'drums');
  });
});

test('clicking a chip background twice toggles selection off (deselects)', async () => {
  await withRenderedProgression(async (w) => {
    const chip = w.document.querySelector('.grid-lead-chip');
    chip.dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    assert.notEqual(evalInPage(w, 'selectedLeadForCopy'), null);
    w.document.querySelector('.grid-lead-chip').dispatchEvent(new w.Event('click', { bubbles: true })); // re-query -- chip was rebuilt
    await new Promise(r => setTimeout(r, 30));
    assert.equal(evalInPage(w, 'selectedLeadForCopy'), null, 'clicking an already-selected chip again should deselect it');
  });
});
