import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './extract.mjs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

// ---- Direct unit tests for the guard fix (fast, no DOM needed) ----

const chordDbDeps = `
  const ROOT_TO_DB_KEY = ['C','Csharp','D','Eb','E','F','Fsharp','G','Ab','A','Bb','B'];
  const SUFFIX_TO_DB = { '': 'major', 'm': 'minor' };
`;

test('getVoicingCount: chordsDbData missing .chords entirely returns 0 instead of throwing (regression guard -- this is exactly what crashed chord card rendering)', () => {
  const getVoicingCount = extractFunction('getVoicingCount', {
    dependencies: chordDbDeps + '\nconst chordsDbData = {};', // present but malformed -- the actual trigger found
  });
  assert.equal(getVoicingCount(0, ''), 0);
});

test('lookupChordShape: chordsDbData missing .chords entirely returns null instead of throwing -- the more severe case, since this is what determines which shape actually plays', () => {
  const lookupChordShape = extractFunction('lookupChordShape', {
    dependencies: chordDbDeps + '\nconst chordsDbData = {};',
  });
  assert.equal(lookupChordShape(0, '', 0), null);
});

test('getVoicingCount and lookupChordShape still work correctly with well-formed data', () => {
  const wellFormedDb = `const chordsDbData = { chords: { C: [{ suffix: 'major', positions: [{ frets: [-1,3,2,0,1,0] }] }] } };`;
  const getVoicingCount = extractFunction('getVoicingCount', { dependencies: chordDbDeps + '\n' + wellFormedDb });
  const lookupChordShape = extractFunction('lookupChordShape', { dependencies: chordDbDeps + '\n' + wellFormedDb });
  assert.equal(getVoicingCount(0, ''), 1);
  assert.deepEqual(lookupChordShape(0, '', 0), { frets: [-1,3,2,0,1,0] });
});

// ---- End-to-end: the actual reported bug ----

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
      window.fetch = (url) => {
        if (String(url).includes('chords-db')) {
          const roots = ['C','Csharp','D','Eb','E','F','Fsharp','G','Ab','A','Bb','B'];
          const chords = {};
          roots.forEach(r => {
            chords[r] = [
              { suffix: 'major', positions: [{ frets: [-1,3,2,0,1,0], fingers: [0,3,2,0,1,0], baseFret: 1, barres: [] }] },
              { suffix: 'minor', positions: [{ frets: [-1,3,5,5,4,3], fingers: [0,1,3,4,2,1], baseFret: 1, barres: [3] }] },
            ];
          });
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ chords }), text: () => Promise.resolve(''), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
        }
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}), text: () => Promise.resolve(''), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
      };
      class FakeAudioContext {
        constructor(){ this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
        createGain(){ return { gain: { value: 1, setValueAtTime(){return this;}, linearRampToValueAtTime(){return this;} }, connect(){return this;} }; }
        createBiquadFilter(){ return { frequency: {value:0,setValueAtTime(){return this;}}, Q:{value:0}, gain:{value:0}, type:'lowpass', connect(){return this;} }; }
        createDynamicsCompressor(){ return { threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0}, connect(){return this;} }; }
        createOscillator(){ return { frequency:{value:0,setValueAtTime(){return this;}}, detune:{value:0}, type:'sine', connect(){return this;}, start(){}, stop(){} }; }
        createBufferSource(){ return { start(){}, stop(){}, buffer:null, playbackRate:{value:1,setValueAtTime(){return this;}}, connect(){return this;} }; }
        createBuffer(){ return { getChannelData: () => new Float32Array(0) }; }
        decodeAudioData(){ return Promise.resolve({ getChannelData: () => new Float32Array(10) }); }
        resume(){ return Promise.resolve(); }
      }
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

test('e2e: the actual reported bug -- changing the global Pattern dropdown to an arp type and clicking a chord card now plays that pattern, not the hardcoded default', async () => {
  const w = await withPage();
  runScript(w, `
    window.__spyPatterns = [];
    const origPlay = playChordShape;
    playChordShape = function(shape, cardEl, pattern, ...rest) { window.__spyPatterns.push(pattern); return origPlay.apply(this, [shape, cardEl, pattern, ...rest]); };
    document.getElementById('strumPatternSelect').value = 'arpUp';
    document.getElementById('strumPatternSelect').dispatchEvent(new Event('change'));
    window.showChartMode();
    activeModes = ['Ionian'];
    window.__ready = false;
    ensureChordsDbLoaded().then(() => { renderChartGroups(); window.__ready = true; });
  `);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(evalInPage(w, 'window.__ready'), true);
  assert.equal(evalInPage(w, 'window.__strumPattern'), 'arpUp');

  const card = w.document.querySelector('.chart-card');
  assert.ok(card, 'a chord card should have rendered');
  card.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 50));

  const patterns = evalInPage(w, 'window.__spyPatterns');
  assert.equal(patterns[patterns.length - 1], 'arpUp', 'clicking the card should use the newly-selected global pattern, not a hardcoded default');
});

test('e2e: a per-card pattern override (via that card\'s own arrows) persists correctly even after a later, unrelated global dropdown change', async () => {
  const w = await withPage();
  runScript(w, `
    document.getElementById('strumPatternSelect').value = 'arpUp';
    document.getElementById('strumPatternSelect').dispatchEvent(new Event('change'));
    window.showChartMode();
    activeModes = ['Ionian'];
    window.__ready = false;
    ensureChordsDbLoaded().then(() => { renderChartGroups(); window.__ready = true; });
  `);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(evalInPage(w, 'window.__ready'), true);

  const card = w.document.querySelector('.chart-card');
  const nextBtn = w.document.querySelector('.chart-card-voicing-nav[aria-label="Next strum pattern"]');
  assert.ok(nextBtn, 'the per-card pattern-cycling arrow should exist');
  nextBtn.dispatchEvent(new w.Event('click')); // explicitly override this specific card

  runScript(w, `
    window.__spyPatterns = [];
    const origPlay = playChordShape;
    playChordShape = function(shape, cardEl, pattern, ...rest) { window.__spyPatterns.push(pattern); return origPlay.apply(this, [shape, cardEl, pattern, ...rest]); };
    document.getElementById('strumPatternSelect').value = 'strumDown';
    document.getElementById('strumPatternSelect').dispatchEvent(new Event('change'));
  `);
  await new Promise(r => setTimeout(r, 30));
  card.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));

  const patterns = evalInPage(w, 'window.__spyPatterns');
  assert.notEqual(patterns[patterns.length - 1], 'strumDown', 'the explicit per-card override must not be silently clobbered by a later global dropdown change');
});

test('e2e: a card that has NOT been individually overridden continues to live-follow the global dropdown across multiple changes', async () => {
  const w = await withPage();
  runScript(w, `
    window.showChartMode();
    activeModes = ['Ionian'];
    window.__ready = false;
    ensureChordsDbLoaded().then(() => { renderChartGroups(); window.__ready = true; });
  `);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(evalInPage(w, 'window.__ready'), true);

  runScript(w, `
    window.__spyPatterns = [];
    const origPlay = playChordShape;
    playChordShape = function(shape, cardEl, pattern, ...rest) { window.__spyPatterns.push(pattern); return origPlay.apply(this, [shape, cardEl, pattern, ...rest]); };
  `);
  const card = w.document.querySelector('.chart-card');

  for (const pattern of ['strumUp', 'arpDown', 'altBass']) {
    runScript(w, `
      document.getElementById('strumPatternSelect').value = '${pattern}';
      document.getElementById('strumPatternSelect').dispatchEvent(new Event('change'));
    `);
    await new Promise(r => setTimeout(r, 20));
    card.dispatchEvent(new w.Event('click'));
    await new Promise(r => setTimeout(r, 20));
  }

  const patterns = Array.from(evalInPage(w, 'window.__spyPatterns'));
  assert.deepEqual(patterns, ['strumUp', 'arpDown', 'altBass'], 'every click should reflect whatever the global dropdown is currently set to');
});
