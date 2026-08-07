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
        createGain(){ return { gain: { value: 1, setValueAtTime(){return this;}, linearRampToValueAtTime(){return this;}, exponentialRampToValueAtTime(){return this;} }, connect(){return this;} }; }
        createBiquadFilter(){ return { frequency: {value:0,setValueAtTime(){return this;},exponentialRampToValueAtTime(){return this;},linearRampToValueAtTime(){return this;}}, Q:{value:0}, gain:{value:0}, type:'lowpass', connect(){return this;} }; }
        createDynamicsCompressor(){ return { threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0}, connect(){return this;} }; }
        createOscillator(){ return { frequency:{value:0,setValueAtTime(){return this;},exponentialRampToValueAtTime(){return this;}}, detune:{value:0,setValueAtTime(){return this;}}, type:'sine', connect(){return this;}, start(){}, stop(){} }; }
        createBufferSource(){ return { start(){}, stop(){}, buffer:null, playbackRate:{value:1,setValueAtTime(){return this;}}, connect(){return this;} }; }
        createBuffer(numChannels, length){ return { getChannelData: () => new Float32Array(length || 0) }; }
        createDelay(maxDelayTime){ return { delayTime: { value: 0, setValueAtTime(){return this;} }, connect(){return this;} }; }
        decodeAudioData(){ return Promise.resolve({ getChannelData: () => new Float32Array(10) }); }
        resume(){ return Promise.resolve(); }
      }
      window.AudioContext = FakeAudioContext;
      window.OfflineAudioContext = class extends FakeAudioContext {
        constructor(ch, len, rate){ super(); this.length = len; }
        startRendering(){ return Promise.resolve({ getChannelData: () => new Float32Array(this.length) }); }
      };
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
function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const key = '__t_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${key} = ${expr};`;
  w.document.body.appendChild(script);
  return w[key];
}

// ---- The 5 new instruments ----

const NEW_INSTRUMENTS = ['electricguitar', 'acousticguitar', 'nylonguitar', 'jazzorgan', 'vibraphone'];

test('all 5 new instruments are registered in isInstrument()', async () => {
  const w = await withPage(null);
  for (const inst of NEW_INSTRUMENTS) {
    assert.equal(evalInPage(w, `window.__toneEngine.isInstrument('${inst}')`), true, inst + ' should be recognized as an instrument');
  }
});

test('all 5 new instruments appear as options in the shared tone selector', async () => {
  const w = await withPage(null);
  const values = Array.from(evalInPage(w, `Array.from(document.getElementById('toneTypeSelect').options).map(o => o.value)`));
  for (const inst of NEW_INSTRUMENTS) {
    assert.ok(values.includes(inst), inst + ' should be an available tone option');
  }
});

test('all 5 new instruments schedule without throwing across a realistic guitar frequency range', async () => {
  const w = await withPage(null);
  const freqs = [41, 82.4, 110, 196, 329.6, 440, 880, 1174.6, 2000];
  runScript(w, `
    window.__playErrors = [];
    const ctx = new AudioContext();
    ${JSON.stringify(NEW_INSTRUMENTS)}.forEach(inst => {
      ${JSON.stringify(freqs)}.forEach(freq => {
        try { window.__toneEngine.playNote(ctx, inst, freq, 0.01, 0.5, 0.6); }
        catch (e) { window.__playErrors.push(inst + ' @ ' + freq + ': ' + e.message); }
      });
    });
  `);
  const errors = Array.from(evalInPage(w, 'window.__playErrors'));
  assert.deepEqual(errors, []);
});

// ---- Tremolo effect ----

test('main chord chip: the Tremolo button exists and toggling it flips entry.tremolo', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' }]);
  `);
  const btn = w.document.querySelector('.progression-chip-tremolo');
  assert.ok(btn, 'the Tremolo button should exist on the chord chip');
  btn.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].tremolo'), true);
  const btn2 = w.document.querySelector('.progression-chip-tremolo'); // re-query, chip DOM was rebuilt
  btn2.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].tremolo'), false);
});

test('lead chip: the Tremolo button exists and toggling it flips the lead layer\'s tremolo field', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'lead-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] }]);
  `);
  const btn = w.document.querySelector('.grid-lead-chip-tremolo');
  assert.ok(btn, 'the Tremolo button should exist on the lead chip');
  btn.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].tremolo'), true);
});

test('__playWithTremolo temporarily redirects the master bus during its callback, then restores it', async () => {
  const w = await withPage(null);
  runScript(w, `
    const ctx = new AudioContext();
    const realBus = window.__getMasterBus(ctx);
    window.__redirectedDuringCall = null;
    window.__playWithTremolo(ctx, 0, 1, () => {
      window.__redirectedDuringCall = (ctx.__masterBusInput !== realBus);
    });
    window.__restoredAfter = (ctx.__masterBusInput === realBus);
  `);
  assert.equal(evalInPage(w, 'window.__redirectedDuringCall'), true, 'inside the callback, the master bus should be the tremolo bus, not the real one');
  assert.equal(evalInPage(w, 'window.__restoredAfter'), true, 'after the callback returns, the real master bus must be restored');
});

test('e2e: __playWithTremolo is invoked exactly once during a real render when only one of two chords has tremolo enabled', async () => {
  const w = await withPage(`
    lookupEntryShape = function(){ return { frets: [-1,3,2,0,1,0], baseFret: 1 }; };
    document.getElementById('tempoInput').value = '120';
    window.__tremoloCalls = 0;
    const origWrap = window.__playWithTremolo;
    window.__playWithTremolo = function(...args) { window.__tremoloCalls++; return origWrap.apply(this, args); };
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block', tremolo: true },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block', tremolo: false },
    ]);
    window.__renderDone = false;
    renderProgressionOffline().then(() => { window.__renderDone = true; });
  `);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(evalInPage(w, 'window.__renderDone'), true);
  assert.equal(evalInPage(w, 'window.__tremoloCalls'), 1, 'only the one chord with tremolo:true should invoke the tremolo wrapper');
});

test('saving a lead in place preserves its tremolo flag, the same way muted/solo are already preserved', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'lead-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano', tremolo: true }] }]);
    loadLeadGridFromEntry(0, 'lead-1');
  `);
  runScript(w, `
    leadGridSlots[4] = { stringIdx: 2, fret: 5 };
    updateLeadInPlace();
  `);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].tremolo'), true, 'tremolo must survive a Save Lead, not silently reset to falsy');
});

// ---- Delay effect ----

test('delayPresetToSeconds: exact tempo-sync math at 120 BPM (500ms per beat)', async () => {
  const w = await withPage(`document.getElementById('tempoInput').value = '120';`);
  assert.equal(evalInPage(w, `delayPresetToSeconds('off')`), null);
  assert.equal(evalInPage(w, `delayPresetToSeconds('eighth')`), 0.25);
  assert.equal(evalInPage(w, `delayPresetToSeconds('dottedEighth')`), 0.375);
  assert.equal(evalInPage(w, `delayPresetToSeconds('quarter')`), 0.5);
  assert.ok(Math.abs(evalInPage(w, `delayPresetToSeconds('quarterTriplet')`) - 0.3333) < 0.001);
});

test('delayPresetToSeconds: doubling the tempo exactly halves every preset\'s delay time -- confirms it tracks the LIVE tempo, not a frozen value', async () => {
  const w = await withPage(`document.getElementById('tempoInput').value = '60';`);
  assert.equal(evalInPage(w, `delayPresetToSeconds('quarter')`), 1.0);
  assert.equal(evalInPage(w, `delayPresetToSeconds('eighth')`), 0.5);
});

test('an unrecognized or missing preset name returns null (no delay), same as "off"', async () => {
  const w = await withPage(`document.getElementById('tempoInput').value = '120';`);
  assert.equal(evalInPage(w, `delayPresetToSeconds(undefined)`), null);
  assert.equal(evalInPage(w, `delayPresetToSeconds('not-a-real-preset')`), null);
});

test('main chord chip: the Delay dropdown exists, offers all 5 presets, and changing it updates entry.delayPreset', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' }]);
  `);
  const select = w.document.querySelector('.progression-chip-delay');
  assert.ok(select, 'the Delay dropdown should exist on the chord chip');
  const values = Array.from(select.options).map(o => o.value);
  assert.deepEqual(values.sort(), ['dottedEighth', 'eighth', 'off', 'quarter', 'quarterTriplet'].sort());
  select.value = 'dottedEighth';
  select.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].delayPreset'), 'dottedEighth');
});

test('lead chip: the Delay dropdown exists and changing it updates the lead layer\'s delayPreset field', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'lead-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] }]);
  `);
  const select = w.document.querySelector('.grid-lead-chip-delay');
  assert.ok(select, 'the Delay dropdown should exist on the lead chip');
  select.value = 'quarter';
  select.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].delayPreset'), 'quarter');
});

test('__playWithDelay temporarily redirects the master bus during its callback, then restores it', async () => {
  const w = await withPage(null);
  runScript(w, `
    const ctx = new AudioContext();
    const realBus = window.__getMasterBus(ctx);
    window.__redirectedDuringCall = null;
    window.__playWithDelay(ctx, 0, 1, 0.3, () => {
      window.__redirectedDuringCall = (ctx.__masterBusInput !== realBus);
    });
    window.__restoredAfter = (ctx.__masterBusInput === realBus);
  `);
  assert.equal(evalInPage(w, 'window.__redirectedDuringCall'), true);
  assert.equal(evalInPage(w, 'window.__restoredAfter'), true);
});

test('e2e: Delay applies only to chords with a real preset (not "off"), and correctly chains with Tremolo when a chord has both', async () => {
  const w = await withPage(`
    lookupEntryShape = function(){ return { frets: [-1,3,2,0,1,0], baseFret: 1 }; };
    document.getElementById('tempoInput').value = '120';
    window.__delayCalls = 0; window.__tremoloCalls = 0;
    const origDelay = window.__playWithDelay;
    window.__playWithDelay = function(...args) { window.__delayCalls++; return origDelay.apply(this, args); };
    const origTremolo = window.__playWithTremolo;
    window.__playWithTremolo = function(...args) { window.__tremoloCalls++; return origTremolo.apply(this, args); };
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block', delayPreset: 'quarter' },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block', tremolo: true, delayPreset: 'eighth' },
      { rootIndex: 7, suffix: '', label: 'V', modeName: 'Ionian', chordName: 'G', beats: 4, strumPattern: 'block', delayPreset: 'off' },
    ]);
    window.__renderDone = false;
    renderProgressionOffline().then(() => { window.__renderDone = true; });
  `);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(evalInPage(w, 'window.__renderDone'), true);
  assert.equal(evalInPage(w, 'window.__delayCalls'), 2, 'chords 1 and 2 have a real delay preset; chord 3 is explicitly off');
  assert.equal(evalInPage(w, 'window.__tremoloCalls'), 1, 'only chord 2 has tremolo enabled');
});

test('saving a lead in place preserves its delayPreset, the same way tremolo/muted/solo are already preserved', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'lead-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano', delayPreset: 'dottedEighth' }] }]);
    loadLeadGridFromEntry(0, 'lead-1');
  `);
  runScript(w, `
    leadGridSlots[4] = { stringIdx: 2, fret: 5 };
    updateLeadInPlace();
  `);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].delayPreset'), 'dottedEighth');
});

// ---- Envelope Filter (auto-wah) effect ----

test('main chord chip: the Env Filter button exists and toggling it flips entry.envelopeFilter', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' }]);
  `);
  const btn = w.document.querySelector('.progression-chip-envfilter');
  assert.ok(btn, 'the Env Filter button should exist on the chord chip');
  btn.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].envelopeFilter'), true);
});

test('lead chip: the Env Filter button exists and toggling it flips the lead layer\'s envelopeFilter field', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'lead-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] }]);
  `);
  const btn = w.document.querySelector('.grid-lead-chip-envfilter');
  assert.ok(btn, 'the Env Filter button should exist on the lead chip');
  btn.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].envelopeFilter'), true);
});

test('__playWithEnvelopeFilter temporarily redirects the master bus during its callback, then restores it', async () => {
  const w = await withPage(null);
  runScript(w, `
    const ctx = new AudioContext();
    const realBus = window.__getMasterBus(ctx);
    window.__redirectedDuringCall = null;
    window.__playWithEnvelopeFilter(ctx, 0, 1, () => {
      window.__redirectedDuringCall = (ctx.__masterBusInput !== realBus);
    });
    window.__restoredAfter = (ctx.__masterBusInput === realBus);
  `);
  assert.equal(evalInPage(w, 'window.__redirectedDuringCall'), true);
  assert.equal(evalInPage(w, 'window.__restoredAfter'), true);
});

test('e2e: Envelope Filter, Tremolo, and Delay all correctly chain together on one chord, while a chord with only Env Filter skips the other two', async () => {
  const w = await withPage(`
    lookupEntryShape = function(){ return { frets: [-1,3,2,0,1,0], baseFret: 1 }; };
    document.getElementById('tempoInput').value = '120';
    window.__envCalls = 0; window.__tremoloCalls = 0; window.__delayCalls = 0;
    const origEnv = window.__playWithEnvelopeFilter;
    window.__playWithEnvelopeFilter = function(...args) { window.__envCalls++; return origEnv.apply(this, args); };
    const origTremolo = window.__playWithTremolo;
    window.__playWithTremolo = function(...args) { window.__tremoloCalls++; return origTremolo.apply(this, args); };
    const origDelay = window.__playWithDelay;
    window.__playWithDelay = function(...args) { window.__delayCalls++; return origDelay.apply(this, args); };
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block', envelopeFilter: true, tremolo: true, delayPreset: 'eighth' },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block', envelopeFilter: true },
      { rootIndex: 7, suffix: '', label: 'V', modeName: 'Ionian', chordName: 'G', beats: 4, strumPattern: 'block' },
    ]);
    window.__renderDone = false;
    renderProgressionOffline().then(() => { window.__renderDone = true; });
  `);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(evalInPage(w, 'window.__renderDone'), true);
  assert.equal(evalInPage(w, 'window.__envCalls'), 2, 'chords 1 and 2 both have envelopeFilter enabled');
  assert.equal(evalInPage(w, 'window.__tremoloCalls'), 1, 'only chord 1 has tremolo');
  assert.equal(evalInPage(w, 'window.__delayCalls'), 1, 'only chord 1 has a real delay preset');
});

test('saving a lead in place preserves its envelopeFilter flag, the same way the other effects already are', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'lead-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano', envelopeFilter: true }] }]);
    loadLeadGridFromEntry(0, 'lead-1');
  `);
  runScript(w, `
    leadGridSlots[4] = { stringIdx: 2, fret: 5 };
    updateLeadInPlace();
  `);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].envelopeFilter'), true);
});
