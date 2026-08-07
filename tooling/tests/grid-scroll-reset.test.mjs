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

test('Lead: scrolling the grid then toggling Advanced resets the view back to the beginning (the actual reported bug)', async () => {
  const w = await withPage(null);
  const leadGridWrap = w.document.getElementById('leadGridWrap');
  leadGridWrap.scrollLeft = 250; // simulate having scrolled while viewing the normal grid
  w.document.getElementById('leadAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(leadGridWrap.scrollLeft, 0, 'the grid should show its beginning immediately after switching resolution, not wherever it happened to be scrolled to before');
});

test('Lead: scrolling then loading a different layer also resets scroll to the beginning', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'layer-1', slots: [], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] }]);
  `);
  const leadGridWrap = w.document.getElementById('leadGridWrap');
  leadGridWrap.scrollLeft = 200;
  const script = w.document.createElement('script');
  script.textContent = `loadLeadGridFromEntry(0, 'layer-1');`;
  w.document.body.appendChild(script);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(leadGridWrap.scrollLeft, 0);
});

test('Lead: scrolling then clicking Clear Grid resets scroll to the beginning', async () => {
  const w = await withPage(null);
  const leadGridWrap = w.document.getElementById('leadGridWrap');
  leadGridWrap.scrollLeft = 150;
  w.document.getElementById('leadClearGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(leadGridWrap.scrollLeft, 0);
});

test('Drums: scrolling the grid then toggling Advanced resets the view back to the beginning', async () => {
  const w = await withPage(null);
  const drumGridWrap = w.document.getElementById('drumGridWrap');
  drumGridWrap.scrollLeft = 300;
  w.document.getElementById('drumAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(drumGridWrap.scrollLeft, 0);
});

test('Drums: scrolling then loading a different pattern also resets scroll to the beginning', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      drumPattern: { id: 'dp-1', slots: Array(32).fill(null).map(()=>Array(10).fill(false)), kit: 'rock', patternLengthSlots: 16 } }]);
  `);
  const drumGridWrap = w.document.getElementById('drumGridWrap');
  drumGridWrap.scrollLeft = 180;
  const script = w.document.createElement('script');
  script.textContent = `loadDrumPatternFromEntry(0);`;
  w.document.body.appendChild(script);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(drumGridWrap.scrollLeft, 0);
});

test('Drums: scrolling then clicking Clear Grid resets scroll to the beginning', async () => {
  const w = await withPage(null);
  const drumGridWrap = w.document.getElementById('drumGridWrap');
  drumGridWrap.scrollLeft = 120;
  w.document.getElementById('drumClearGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(drumGridWrap.scrollLeft, 0);
});
