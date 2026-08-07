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

const THREE_CHORDS_TWO_WITH_LEAD = `
  setProgression([
    { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'lead-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano' }] },
    { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block' },
    { rootIndex: 7, suffix: '', label: 'V', modeName: 'Ionian', chordName: 'G', beats: 4, strumPattern: 'block',
      leadGrids: [{ id: 'lead-2', slots: [{stringIdx:2,fret:5}], keyIndex: 7, modeName: 'Ionian', toneType: 'piano' }] },
  ]);
`;

// ---- Chord chip controls ----

test('chord chip Mute: normal click only affects the one chord clicked', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  const btn = w.document.querySelectorAll('.progression-chip-mute')[0];
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: false }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].muted'), true);
  assert.notEqual(evalInPage(w, 'progression[1].muted'), true);
  assert.notEqual(evalInPage(w, 'progression[2].muted'), true);
});

test('chord chip Mute: Shift+click applies to every chord', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  const btn = w.document.querySelectorAll('.progression-chip-mute')[1];
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression.every(e => e.muted === true)'), true);
});

test('chord chip Solo: Shift+click applies to every chord', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  w.document.querySelectorAll('.progression-chip-solo')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression.every(e => e.solo === true)'), true);
});

test('chord chip Tremolo: Shift+click applies to every chord', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  w.document.querySelectorAll('.progression-chip-tremolo')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression.every(e => e.tremolo === true)'), true);
});

test('chord chip Env Filter: Shift+click applies to every chord', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  w.document.querySelectorAll('.progression-chip-envfilter')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression.every(e => e.envelopeFilter === true)'), true);
});

test('chord chip strum pattern: Shift+change applies to every chord; without Shift, only the one chip changes', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  runScript(w, `window.__shiftHeld = true;`);
  const select = w.document.querySelectorAll('.progression-chip-pattern-select')[1];
  select.value = 'arpUp';
  select.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  runScript(w, `window.__shiftHeld = false;`);
  assert.deepEqual(Array.from(evalInPage(w, 'progression.map(e => e.strumPattern)')), ['arpUp', 'arpUp', 'arpUp']);

  runScript(w, `setProgression(progression.map(e => ({...e, strumPattern: 'block'})));`);
  await new Promise(r => setTimeout(r, 30));
  const select2 = w.document.querySelectorAll('.progression-chip-pattern-select')[0];
  select2.value = 'strumDown';
  select2.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].strumPattern'), 'strumDown');
  assert.equal(evalInPage(w, 'progression[1].strumPattern'), 'block');
});

test('chord chip delay preset: Shift+change applies to every chord', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  runScript(w, `window.__shiftHeld = true;`);
  const select = w.document.querySelectorAll('.progression-chip-delay')[0];
  select.value = 'dottedEighth';
  select.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  runScript(w, `window.__shiftHeld = false;`);
  assert.equal(evalInPage(w, `progression.every(e => e.delayPreset === 'dottedEighth')`), true);
});

test('chord chip volume: Shift-held drag-release applies the exact final value to every chord', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block', volume: 50 },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block', volume: 80 },
      { rootIndex: 7, suffix: '', label: 'V', modeName: 'Ionian', chordName: 'G', beats: 4, strumPattern: 'block', volume: 20 },
    ]);
  `);
  runScript(w, `
    const knob = document.querySelectorAll('.volume-knob')[1];
    knob.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 100 }));
    window.__shiftHeld = true;
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 90 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    window.__shiftHeld = false;
  `);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(Array.from(evalInPage(w, 'progression.map(e => e.volume)')), [90, 90, 90]);
});

// ---- Lead chip controls ----

test('lead chip controls: Shift+click applies across every lead layer on every chord, skipping chords with no lead layer at all', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  const muteBtns = w.document.querySelectorAll('.grid-lead-chip-mute');
  assert.equal(muteBtns.length, 2, 'only the 2 chords with a lead layer should have a lead mute button');
  muteBtns[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].muted'), true);
  assert.equal(evalInPage(w, 'progression[2].leadGrids[0].muted'), true, 'the sync should reach the OTHER chord\'s lead layer too, not just the one clicked');
  assert.equal(evalInPage(w, 'progression[1].leadGrids'), undefined, 'a chord with no lead layer must not gain one');
});

test('lead chip Solo: Shift+click applies to every lead layer', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  w.document.querySelectorAll('.grid-lead-chip-solo')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].solo'), true);
  assert.equal(evalInPage(w, 'progression[2].leadGrids[0].solo'), true);
});

test('lead chip Tremolo: Shift+click applies to every lead layer', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  w.document.querySelectorAll('.grid-lead-chip-tremolo')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].tremolo'), true);
  assert.equal(evalInPage(w, 'progression[2].leadGrids[0].tremolo'), true);
});

test('lead chip Env Filter: Shift+click applies to every lead layer', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  w.document.querySelectorAll('.grid-lead-chip-envfilter')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].envelopeFilter'), true);
  assert.equal(evalInPage(w, 'progression[2].leadGrids[0].envelopeFilter'), true);
});

test('lead chip delay preset: Shift+change applies to every lead layer', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  runScript(w, `window.__shiftHeld = true;`);
  const select = w.document.querySelectorAll('.grid-lead-chip-delay')[0];
  select.value = 'quarter';
  select.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  runScript(w, `window.__shiftHeld = false;`);
  assert.equal(evalInPage(w, `progression[0].leadGrids[0].delayPreset`), 'quarter');
  assert.equal(evalInPage(w, `progression[2].leadGrids[0].delayPreset`), 'quarter');
});

test('lead chip instrument: without Shift, only the one lead layer changes -- the other chord\'s lead stays untouched', async () => {
  const w = await withPage(THREE_CHORDS_TWO_WITH_LEAD);
  const select = w.document.querySelectorAll('.grid-lead-chip-tone-select')[0];
  select.value = 'rhodes';
  select.dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  assert.equal(evalInPage(w, 'progression[0].leadGrids[0].toneType'), 'rhodes');
  assert.equal(evalInPage(w, 'progression[2].leadGrids[0].toneType'), 'piano');
});

test('lead chip volume: Shift-held drag-release applies to every lead layer', async () => {
  const w = await withPage(`
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'lead-1', slots: [{stringIdx:1,fret:3}], keyIndex: 0, modeName: 'Ionian', toneType: 'piano', volume: 50 }] },
      { rootIndex: 7, suffix: '', label: 'V', modeName: 'Ionian', chordName: 'G', beats: 4, strumPattern: 'block',
        leadGrids: [{ id: 'lead-2', slots: [{stringIdx:2,fret:5}], keyIndex: 7, modeName: 'Ionian', toneType: 'piano', volume: 80 }] },
    ]);
  `);
  runScript(w, `
    const knob = document.querySelectorAll('.grid-lead-chip .volume-knob')[0];
    knob.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 100 }));
    window.__shiftHeld = true;
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 80 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    window.__shiftHeld = false;
  `);
  await new Promise(r => setTimeout(r, 50));
  const v0 = evalInPage(w, 'progression[0].leadGrids[0].volume');
  const v1 = evalInPage(w, 'progression[1].leadGrids[0].volume');
  assert.equal(v0, v1, 'both lead layers should end up at the same, synced volume');
});
