import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './extract.mjs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

const isAnyPartOfStackSoloedDeps = `
  function getEntryLeadGrids(entry){
    if (entry.leadGrids) return entry.leadGrids;
    if (entry.leadGrid) return [entry.leadGrid];
    return [];
  }
`;
const isAnyPartOfStackSoloed = extractFunction('isAnyPartOfStackSoloed', { dependencies: isAnyPartOfStackSoloedDeps });

test('isAnyPartOfStackSoloed: the chord itself being soloed counts', () => {
  assert.equal(isAnyPartOfStackSoloed({ solo: true }), true);
});

test('isAnyPartOfStackSoloed: nothing soloed anywhere in the stack returns false', () => {
  assert.equal(isAnyPartOfStackSoloed({ solo: false, leadGrids: [{ solo: false }], drumPattern: { solo: false } }), false);
});

test('isAnyPartOfStackSoloed: a soloed lead/bass layer counts, even among several non-soloed ones', () => {
  assert.equal(isAnyPartOfStackSoloed({ solo: false, leadGrids: [{ solo: false }, { solo: true }] }), true);
});

test('isAnyPartOfStackSoloed: a soloed drum pattern counts', () => {
  assert.equal(isAnyPartOfStackSoloed({ solo: false, drumPattern: { solo: true } }), true);
});

test('isAnyPartOfStackSoloed: a soloed arp-style lead pattern counts', () => {
  assert.equal(isAnyPartOfStackSoloed({ solo: false, leadPatternSolo: true }), true);
});

test('isAnyPartOfStackSoloed: a chord with no lead/drum content and no solo returns false, not a crash', () => {
  assert.equal(isAnyPartOfStackSoloed({}), false);
});

// ---- End-to-end through the real WAV export pipeline ----

async function withPage(){
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
      class FakeAudioNode { connect(){return this;} disconnect(){} }
      class FakeAudioParam { constructor(v){this.value=v||0;} setValueAtTime(v){this.value=v;return this;} linearRampToValueAtTime(v){this.value=v;return this;} exponentialRampToValueAtTime(v){this.value=v;return this;} setTargetAtTime(v){this.value=v;return this;} cancelScheduledValues(){return this;} cancelAndHoldAtTime(){return this;} }
      function addAudioNodeMethods(Cls) {
        Cls.prototype.createGain = function(){ return Object.assign(new FakeAudioNode(), { gain: new FakeAudioParam(1) }); };
        Cls.prototype.createOscillator = function(){ return Object.assign(new FakeAudioNode(), { frequency: new FakeAudioParam(440), detune: new FakeAudioParam(0), type: 'sine', start(){}, stop(){} }); };
        Cls.prototype.createBiquadFilter = function(){ return Object.assign(new FakeAudioNode(), { frequency: new FakeAudioParam(350), Q: new FakeAudioParam(1), gain: new FakeAudioParam(0), type: 'lowpass' }); };
        Cls.prototype.createDynamicsCompressor = function(){ return Object.assign(new FakeAudioNode(), { threshold: new FakeAudioParam(-24), knee: new FakeAudioParam(30), ratio: new FakeAudioParam(12), attack: new FakeAudioParam(0.003), release: new FakeAudioParam(0.25) }); };
        Cls.prototype.createWaveShaper = function(){ return Object.assign(new FakeAudioNode(), { curve: null, oversample: 'none' }); };
        Cls.prototype.createBufferSource = function(){ return Object.assign(new FakeAudioNode(), { start(){}, stop(){}, buffer: null, playbackRate: new FakeAudioParam(1) }); };
        Cls.prototype.createBuffer = function(){ return { getChannelData: () => new Float32Array(0) }; };
        Cls.prototype.createAnalyser = function(){ return Object.assign(new FakeAudioNode(), { fftSize: 2048, getFloatTimeDomainData(){} }); };
        Cls.prototype.decodeAudioData = function(){ return Promise.resolve({}); };
      }
      class FakeOfflineAudioContext {
        constructor(numberOfChannels, length, sampleRate) { this.currentTime = 0; this.numberOfChannels = numberOfChannels; this.length = length; this.sampleRate = sampleRate; this.destination = new FakeAudioNode(); }
        startRendering() { return Promise.resolve({ numberOfChannels: this.numberOfChannels, sampleRate: this.sampleRate, length: this.length, getChannelData: () => new Float32Array(this.length) }); }
      }
      addAudioNodeMethods(FakeOfflineAudioContext);
      window.OfflineAudioContext = FakeOfflineAudioContext;
      class FakeAudioContext extends FakeOfflineAudioContext { constructor(){ super(2, 44100, 44100); } resume(){ return Promise.resolve(); } }
      window.AudioContext = FakeAudioContext;
    },
  });
  await new Promise((resolve) => { dom.window.addEventListener('load', resolve); setTimeout(resolve, 3000); });
  return dom.window;
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

test('e2e: soloing a lead/bass layer silences the chord audio and drum pattern in the SAME stack, but does not touch a different chord elsewhere', async () => {
  const w = await withPage();
  runScript(w, `
    document.getElementById('tempoInput').value = '120';
    lookupEntryShape = function(){ return { frets: [-1,3,2,0,1,0], baseFret: 1 }; };
    window.__chordCalls = 0; window.__leadCalls = 0; window.__drumCalls = 0;
    const origChord = playChordShape;
    playChordShape = function(...args) { window.__chordCalls++; return origChord.apply(this, args); };
    const origLead = playMelodyNoteTone;
    playMelodyNoteTone = function(...args) { window.__leadCalls++; return origLead.apply(this, args); };
    const origFade = playNoteWithCustomFade;
    playNoteWithCustomFade = function(...args) { window.__leadCalls++; return origFade.apply(this, args); };
    const origDrum = playDrumSound;
    playDrumSound = function(...args) { window.__drumCalls++; return origDrum.apply(this, args); };

    const drumHit = Array(32).fill(null).map(() => Array(10).fill(false));
    drumHit[0][0] = true;
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'bass-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'subbass', solo: true }],
        drumPattern: { slots: drumHit, kit: 'rock', patternLengthSlots: 16 } },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block',
        drumPattern: { slots: drumHit, kit: 'rock', patternLengthSlots: 16 } },
    ]);
    window.__renderPromise = renderProgressionOffline();
  `);
  await new Promise(r => setTimeout(r, 150));

  assert.equal(evalInPage(w, 'window.__chordCalls'), 1, 'only F\u2019s chord audio should play -- C\u2019s is silenced by the soloed bass layer in its own stack');
  assert.ok(evalInPage(w, 'window.__leadCalls') >= 1, 'the soloed bass layer itself should still play');
  assert.equal(evalInPage(w, 'window.__drumCalls'), 1, 'only F\u2019s drum pattern should play -- C\u2019s is silenced by the solo in C\u2019s own stack');
});

test('e2e: soloing a chord with nothing else in its stack does not silence a different chord elsewhere in the progression', async () => {
  const w = await withPage();
  runScript(w, `
    document.getElementById('tempoInput').value = '120';
    lookupEntryShape = function(){ return { frets: [-1,3,2,0,1,0], baseFret: 1 }; };
    window.__chordCalls = 0;
    const origChord = playChordShape;
    playChordShape = function(...args) { window.__chordCalls++; return origChord.apply(this, args); };

    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block', solo: true },
      { rootIndex: 7, suffix: '', label: 'V', modeName: 'Ionian', chordName: 'G', beats: 4, strumPattern: 'block' },
    ]);
    window.__renderPromise = renderProgressionOffline();
  `);
  await new Promise(r => setTimeout(r, 150));

  assert.equal(evalInPage(w, 'window.__chordCalls'), 3, 'all 3 chords should still play -- F\u2019s solo only reaches inside F\u2019s own (otherwise-empty) stack, not C or G');
});
