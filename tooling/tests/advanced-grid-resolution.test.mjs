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
function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const key = '__t_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${key} = ${expr};`;
  w.document.body.appendChild(script);
  return w[key];
}

test('Lead: default resolution is 4 slots per beat, not Advanced', async () => {
  const w = await withPage(null);
  assert.equal(evalInPage(w, 'LEAD_GRID_SLOTS_PER_BEAT'), 4);
  assert.equal(evalInPage(w, `document.getElementById('leadAdvancedGridBtn').classList.contains('active')`), false);
});

test('Lead: toggling Advanced doubles the resolution and grid dimensions', async () => {
  const w = await withPage(null);
  w.document.getElementById('leadAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'LEAD_GRID_SLOTS_PER_BEAT'), 8);
  assert.equal(evalInPage(w, 'LEAD_GRID_TOTAL_SLOTS'), 64);
  assert.equal(evalInPage(w, `document.getElementById('leadAdvancedGridBtn').classList.contains('active')`), true);
});

test('Lead: the rendered grid produces exactly the right number of DOM cells at Advanced resolution', async () => {
  const w = await withPage(null);
  w.document.getElementById('leadAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(w.document.querySelectorAll('.lead-grid-slot').length, 64);
});

test('Lead: saving bakes the current resolution into the payload', async () => {
  const w = await withPage(null);
  w.document.getElementById('leadAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  const payload = evalInPage(w, 'buildLeadGridPayload()');
  assert.equal(payload.slotsPerBeat, 8);
});

test('Lead: loading a layer restores THAT layer\'s own resolution, independent of whatever the editor was on before', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'adv-1', slots: Array(64).fill(null), keyIndex: 0, modeName: 'Ionian', toneType: 'piano', slotsPerBeat: 8 }] }]);
  `);
  runScript(w, `loadLeadGridFromEntry(0, 'adv-1');`);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'LEAD_GRID_SLOTS_PER_BEAT'), 8);
  assert.equal(evalInPage(w, 'leadGridSlots.length'), 64);
});

test('Lead: an old-format saved layer with no slotsPerBeat field defaults to 4', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'old-1', slots: Array(32).fill(null), keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] }]);
    LEAD_GRID_SLOTS_PER_BEAT = 8; // simulate Advanced still being on from a prior edit
  `);
  runScript(w, `loadLeadGridFromEntry(0, 'old-1');`);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'LEAD_GRID_SLOTS_PER_BEAT'), 4, 'should correctly revert to the default, not keep whatever the editor happened to be on');
});

test('Lead: switching resolution with an empty grid requires no confirmation', async () => {
  const w = await withPage(null);
  let confirmCalled = false;
  w.window.confirm = () => { confirmCalled = true; return true; };
  w.document.getElementById('leadAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(confirmCalled, false);
  assert.equal(evalInPage(w, 'LEAD_GRID_SLOTS_PER_BEAT'), 8);
});

test('Lead: doubling resolution (Advanced on) preserves existing notes at their correct musical position, with no confirmation needed -- this is always lossless', async () => {
  const w = await withPage(`leadGridSlots[4] = { stringIdx: 1, fret: 3 };`); // slot 4 at 4/beat = beat 1.0
  let confirmCalled = false;
  w.window.confirm = () => { confirmCalled = true; return true; };
  w.document.getElementById('leadAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(confirmCalled, false, 'doubling never loses information, so it should never need to ask');
  assert.equal(evalInPage(w, 'LEAD_GRID_SLOTS_PER_BEAT'), 8);
  // beat 1.0 at 8 slots/beat = slot 8
  assert.deepEqual(evalInPage(w, 'JSON.stringify(leadGridSlots[8])'), JSON.stringify({ stringIdx: 1, fret: 3 }));
  assert.equal(evalInPage(w, 'leadGridSlots[4]'), null, 'the OLD slot 4 should be empty now -- the note only exists at its correctly-remapped new position');
});

test('Lead: halving resolution (Advanced off) that does NOT cause a collision preserves notes with no confirmation', async () => {
  const w = await withPage(`
    LEAD_GRID_SLOTS_PER_BEAT = 8;
    LEAD_GRID_TOTAL_SLOTS = LEAD_GRID_BEATS * 8;
    leadGridSlots = new Array(LEAD_GRID_TOTAL_SLOTS).fill(null);
    leadGridSlots[8] = { stringIdx: 2, fret: 5 }; // beat 1.0 at 8/beat
  `);
  let confirmCalled = false;
  w.window.confirm = () => { confirmCalled = true; return true; };
  w.document.getElementById('leadAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(confirmCalled, false, 'a note that already falls on a valid coarser-grid line should not trigger a collision warning');
  assert.equal(evalInPage(w, 'LEAD_GRID_SLOTS_PER_BEAT'), 4);
  // beat 1.0 at 4 slots/beat = slot 4
  assert.deepEqual(evalInPage(w, 'JSON.stringify(leadGridSlots[4])'), JSON.stringify({ stringIdx: 2, fret: 5 }));
});

test('Lead: halving resolution that WOULD collapse two close notes onto the same slot requires confirmation, and cancelling changes nothing', async () => {
  const w = await withPage(`
    LEAD_GRID_SLOTS_PER_BEAT = 8;
    LEAD_GRID_TOTAL_SLOTS = LEAD_GRID_BEATS * 8;
    leadGridSlots = new Array(LEAD_GRID_TOTAL_SLOTS).fill(null);
    leadGridSlots[9] = { stringIdx: 1, fret: 1 };
    leadGridSlots[10] = { stringIdx: 2, fret: 2 }; // both round to slot 5 at 4/beat -- a genuine collision
  `);
  w.window.confirm = () => false;
  w.document.getElementById('leadAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'LEAD_GRID_SLOTS_PER_BEAT'), 8, 'cancelling must leave the resolution unchanged');
  assert.notEqual(evalInPage(w, 'leadGridSlots[9]'), null, 'cancelling must leave the existing notes untouched');
});

test('Lead: confirming a collision-causing halve proceeds, keeping one note at the merged slot', async () => {
  const w = await withPage(`
    LEAD_GRID_SLOTS_PER_BEAT = 8;
    LEAD_GRID_TOTAL_SLOTS = LEAD_GRID_BEATS * 8;
    leadGridSlots = new Array(LEAD_GRID_TOTAL_SLOTS).fill(null);
    leadGridSlots[9] = { stringIdx: 1, fret: 1 };
    leadGridSlots[10] = { stringIdx: 2, fret: 2 };
  `);
  w.window.confirm = () => true;
  w.document.getElementById('leadAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'LEAD_GRID_SLOTS_PER_BEAT'), 4);
  assert.notEqual(evalInPage(w, 'leadGridSlots[5]'), null, 'the merged slot should have exactly one of the two notes');
});

test('Drums: doubling resolution preserves existing hits at their correct musical position', async () => {
  const w = await withPage(null);
  const script = w.document.createElement('script');
  script.textContent = `drumGridSlots[4][0] = true;`; // kick at slot 4 (4/beat) = beat 1.0
  w.document.body.appendChild(script);
  await new Promise(r => setTimeout(r, 20));
  w.document.getElementById('drumAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'DRUM_GRID_SLOTS_PER_BEAT'), 8);
  // beat 1.0 at 8/beat = slot 8
  assert.equal(evalInPage(w, 'drumGridSlots[8][0]'), true);
  assert.equal(evalInPage(w, 'drumGridSlots[4][0]'), false, 'the old slot should be empty -- the hit only exists at its remapped position');
});

test('Drums: halving resolution that collides OR-merges hits from both source slots rather than dropping one silently', async () => {
  const w = await withPage(`
    DRUM_GRID_SLOTS_PER_BEAT = 8;
    DRUM_GRID_TOTAL_SLOTS = DRUM_GRID_BEATS * 8;
    drumGridSlots = Array(DRUM_GRID_TOTAL_SLOTS).fill(null).map(() => Array(DRUM_SOUNDS.length).fill(false));
    drumGridSlots[9][0] = true;  // kick
    drumGridSlots[10][1] = true; // snare -- both round to slot 5 at 4/beat
  `);
  w.window.confirm = () => true;
  w.document.getElementById('drumAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'DRUM_GRID_SLOTS_PER_BEAT'), 4);
  assert.equal(evalInPage(w, 'drumGridSlots[5][0]'), true, 'the kick hit should survive the merge');
  assert.equal(evalInPage(w, 'drumGridSlots[5][1]'), true, 'the snare hit should also survive the merge -- both are OR-ed together, neither silently dropped');
});

test('Drums: loading a template at the DEFAULT resolution places hits at their documented step positions', async () => {
  const w = await withPage(`document.getElementById('drumTemplateSelect').value = 'rock';`);
  w.document.getElementById('drumLoadTemplateBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  // rock template: kick at steps [0, 8] (16th-note authoring resolution)
  assert.equal(evalInPage(w, 'drumGridSlots[0][0]'), true);
  assert.equal(evalInPage(w, 'drumGridSlots[8][0]'), true);
});

test('Drums: loading a template while in Advanced mode scales each step to the current resolution, spanning the same musical duration instead of squeezing into the first half-beat', async () => {
  const w = await withPage(null);
  w.document.getElementById('drumAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'DRUM_GRID_SLOTS_PER_BEAT'), 8);

  const script = w.document.createElement('script');
  script.textContent = `document.getElementById('drumTemplateSelect').value = 'rock';`;
  w.document.body.appendChild(script);
  w.document.getElementById('drumLoadTemplateBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));

  // rock template's kick steps [0, 8] were authored at 4 slots/beat (steps 0 and 8 = beats 0 and 2).
  // At 8 slots/beat, those same beats are slots 0 and 16 -- NOT still 0 and 8, which would
  // squeeze the whole pattern into the first half of the bar.
  assert.equal(evalInPage(w, 'drumGridSlots[0][0]'), true, 'beat 0 should still have the kick');
  assert.equal(evalInPage(w, 'drumGridSlots[16][0]'), true, 'beat 2 should have the kick, correctly scaled to slot 16 at this resolution');
  assert.equal(evalInPage(w, 'drumGridSlots[8][0]'), false, 'slot 8 is now beat 1, not beat 2 -- the template must not leave a stray hit at the old, unscaled position');
});

test('Drums: a template applied in Advanced mode spans a FULL bar (32 slots at 8/beat), not just 16 slots', async () => {
  const w = await withPage(null);
  w.document.getElementById('drumAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  const script = w.document.createElement('script');
  script.textContent = `document.getElementById('drumTemplateSelect').value = 'disco';`; // four-on-the-floor: kick at every beat [0,4,8,12]
  w.document.body.appendChild(script);
  w.document.getElementById('drumLoadTemplateBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  // beats 0,1,2,3 at 8 slots/beat = slots 0, 8, 16, 24
  assert.deepEqual(
    evalInPage(w, 'JSON.stringify([drumGridSlots[0][0], drumGridSlots[8][0], drumGridSlots[16][0], drumGridSlots[24][0]])'),
    JSON.stringify([true, true, true, true])
  );
});

test('Drums: toggling Advanced doubles the resolution, and saving bakes it into the payload', async () => {
  const w = await withPage(null);
  w.document.getElementById('drumAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'DRUM_GRID_SLOTS_PER_BEAT'), 8);
  assert.equal(evalInPage(w, 'DRUM_GRID_TOTAL_SLOTS'), 64);
  const payload = evalInPage(w, 'buildDrumPatternPayload()');
  assert.equal(payload.slotsPerBeat, 8);
});

test('Drums: the rendered grid produces exactly the right number of DOM cells at Advanced resolution', async () => {
  const w = await withPage(null);
  w.document.getElementById('drumAdvancedGridBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  const soundCount = evalInPage(w, 'DRUM_SOUNDS.length');
  assert.equal(w.document.querySelectorAll('.drum-grid-cell').length, 64 * soundCount);
});

test('Drums: loading a pattern restores its own resolution, and old-format patterns default to 4', async () => {
  const w = await withPage(`
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      drumPattern: { id: 'dp-adv', slots: Array(64).fill(null).map(()=>Array(10).fill(false)), kit: 'rock', patternLengthSlots: 64, slotsPerBeat: 8 } }]);
  `);
  runScript(w, `loadDrumPatternFromEntry(0);`);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'DRUM_GRID_SLOTS_PER_BEAT'), 8);

  runScript(w, `
    setProgression([{ rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      drumPattern: { id: 'dp-old', slots: Array(32).fill(null).map(()=>Array(10).fill(false)), kit: 'rock', patternLengthSlots: 16 } }]);
    loadDrumPatternFromEntry(0);
  `);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'DRUM_GRID_SLOTS_PER_BEAT'), 4, 'should correctly revert, not keep the prior Advanced state');
});

// ---- The critical case: mixed resolutions across different chords in the SAME progression must schedule correctly ----

async function withOfflineRenderPage(setupScript){
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
  const w = dom.window;
  const setup = w.document.createElement('script');
  setup.textContent = setupScript;
  w.document.body.appendChild(setup);
  await new Promise(r => setTimeout(r, 200));
  return w;
}

test('mixed resolution: an 8-per-beat lead on one chord and a 4-per-beat lead on another chord both schedule at the exact correct times, independent of each other', async () => {
  const w = await withOfflineRenderPage(`
    document.getElementById('tempoInput').value = '120'; // 500ms per beat
    window.__spyNoteStarts = [];
    const origMelody = playMelodyNoteTone;
    playMelodyNoteTone = function(ctx, note, startAt, ...rest) { window.__spyNoteStarts.push(startAt); return origMelody.apply(this, [ctx, note, startAt, ...rest]); };

    const advSlots = Array(64).fill(null);
    advSlots[4] = { stringIdx: 1, fret: 3 };  // 8-per-beat: slot 4 = beat 0.5 = 0.25s
    advSlots[8] = { stringIdx: 1, fret: 5 };  // slot 8 = beat 1.0 = 0.5s

    const normalSlots = Array(32).fill(null);
    normalSlots[1] = { stringIdx: 2, fret: 5 }; // 4-per-beat: slot 1 = beat 0.25 = 0.125s relative to its own chord's start
    normalSlots[2] = { stringIdx: 2, fret: 7 };

    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'adv-lead', slots: advSlots, keyIndex: 0, modeName: 'Ionian', toneType: 'piano', slotsPerBeat: 8, patternLengthSlots: 64 }] },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'norm-lead', slots: normalSlots, keyIndex: 5, modeName: 'Ionian', toneType: 'piano', slotsPerBeat: 4, patternLengthSlots: 32 }] },
    ]);
    window.__renderPromise = renderProgressionOffline();
  `);
  await new Promise(r => setTimeout(r, 100));

  const starts = Array.from(evalInPage(w, 'window.__spyNoteStarts'));
  assert.equal(starts.length, 4);
  // Chord C (8-per-beat), starts at t=0
  assert.ok(Math.abs(starts[0] - 0.25) < 0.001, `C slot 4 should start at 0.25s, got ${starts[0]}`);
  assert.ok(Math.abs(starts[1] - 0.5) < 0.001, `C slot 8 should start at 0.5s, got ${starts[1]}`);
  // Chord F (4-per-beat), starts after C's 4 beats = 2.0s
  assert.ok(Math.abs(starts[2] - 2.125) < 0.001, `F slot 1 should start at 2.125s, got ${starts[2]}`);
  assert.ok(Math.abs(starts[3] - 2.25) < 0.001, `F slot 2 should start at 2.25s, got ${starts[3]}`);
});
