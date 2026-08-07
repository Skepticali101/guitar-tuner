import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

async function withFreshPage(){
  const virtualConsole = new VirtualConsole();
  const fetchCalls = [];
  const dom = new JSDOM(readFileSync(INDEX_HTML_PATH, 'utf8'), {
    url: 'file://' + INDEX_HTML_PATH,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
      window.fetch = (url) => {
        fetchCalls.push(String(url));
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) });
      };
      class FakeAudioContext {
        constructor(){ this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
        createGain(){ return { gain: { value: 1, setValueAtTime(){return this;}, linearRampToValueAtTime(){return this;} }, connect(){return this;} }; }
        createBiquadFilter(){ return { frequency: {value:0,setValueAtTime(){return this;}}, Q:{value:0}, gain:{value:0}, type:'lowpass', connect(){return this;} }; }
        createDynamicsCompressor(){ return { threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0}, connect(){return this;} }; }
        decodeAudioData(){ return Promise.resolve({ getChannelData: () => new Float32Array(10), duration: 1, sampleRate: 44100, numberOfChannels: 1 }); }
        resume(){ return Promise.resolve(); }
      }
      window.AudioContext = FakeAudioContext;
    },
  });
  await new Promise((resolve) => { dom.window.addEventListener('load', resolve); setTimeout(resolve, 3000); });
  return { w: dom.window, fetchCalls };
}

test('selecting Electric Bass in the Lead tone selector actually fetches its sample (regression: this used to silently do nothing)', async () => {
  const { w, fetchCalls } = await withFreshPage();
  const leadToneSelect = w.document.getElementById('leadToneSelect');
  leadToneSelect.value = 'electricbass';
  leadToneSelect.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 50));
  assert.ok(fetchCalls.some(u => u.includes('electricBass')), 'should have fetched electricBass.wav');
});

test('selecting Double Bass in the Lead tone selector actually fetches its sample', async () => {
  const { w, fetchCalls } = await withFreshPage();
  const leadToneSelect = w.document.getElementById('leadToneSelect');
  leadToneSelect.value = 'doublebass';
  leadToneSelect.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 50));
  assert.ok(fetchCalls.some(u => u.includes('doubleBass')), 'should have fetched doubleBass.wav');
});

test('selecting Electric Bass on the main Chart-tab tone selector also fetches its sample', async () => {
  const { w, fetchCalls } = await withFreshPage();
  const toneTypeSelect = w.document.getElementById('toneTypeSelect');
  toneTypeSelect.value = 'electricbass';
  toneTypeSelect.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 50));
  assert.ok(fetchCalls.some(u => u.includes('electricBass')));
});

test('loading an existing lead layer that already uses Electric Bass also fetches the sample (a second, separate path to the same bug -- setting .value directly does not fire change)', async () => {
  const { w, fetchCalls } = await withFreshPage();
  const script = w.document.createElement('script');
  script.textContent = `
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'eb-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'electricbass' }] },
    ]);
    loadLeadGridFromEntry(0, 'eb-1');
  `;
  w.document.body.appendChild(script);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(fetchCalls.some(u => u.includes('electricBass')), 'should have fetched electricBass.wav when loading the layer for editing');
});

test('selecting a synthesized bass type (Sub Bass) never triggers a sample fetch -- it never needed one', async () => {
  const { w, fetchCalls } = await withFreshPage();
  const leadToneSelect = w.document.getElementById('leadToneSelect');
  leadToneSelect.value = 'subbass';
  leadToneSelect.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 50));
  assert.equal(fetchCalls.filter(u => u.includes('.wav')).length, 0);
});

test('changing a lead layer\'s instrument directly via the progression chip\'s own tone selector (not the Lead tab) fetches the sample -- this was the actual reported bug', async () => {
  const { w, fetchCalls } = await withFreshPage();
  const setup = w.document.createElement('script');
  setup.textContent = `
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'layer-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] },
    ]);
  `;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 30));
  fetchCalls.length = 0;

  const chipToneSelect = w.document.querySelector('.grid-lead-chip-tone-select');
  chipToneSelect.value = 'doublebass';
  chipToneSelect.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 50));

  assert.ok(fetchCalls.some(u => u.includes('doubleBass')), 'should have fetched doubleBass.wav from the chip\'s own selector, without needing to open Lead tab and re-save');
});

test('cycling instruments with the T keyboard shortcut also pre-loads the newly-selected sample', async () => {
  const { w, fetchCalls } = await withFreshPage();
  const script = w.document.createElement('script');
  script.textContent = `
    const toneTypeSelect = document.getElementById('toneTypeSelect');
    for (let i = 0; i < toneTypeSelect.options.length; i++) {
      if (toneTypeSelect.options[i].value === 'doublebass') { toneTypeSelect.selectedIndex = i - 1; break; }
    }
    window.__cycleToneType();
  `;
  w.document.body.appendChild(script);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(fetchCalls.some(u => u.includes('doubleBass')), 'cycling onto Double Bass via the T shortcut should pre-load its sample');
});
