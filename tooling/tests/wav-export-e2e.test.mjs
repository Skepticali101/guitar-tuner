import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html');

async function withPage(setupScript){
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(readFileSync(INDEX_HTML_PATH, 'utf8'), {
    url: 'file://' + INDEX_HTML_PATH,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
      class FakeAudioParam { constructor(v){this.value=v||0;} setValueAtTime(v){this.value=v;return this;} linearRampToValueAtTime(v){this.value=v;return this;} exponentialRampToValueAtTime(v){this.value=v;return this;} setTargetAtTime(v){this.value=v;return this;} cancelScheduledValues(){return this;} cancelAndHoldAtTime(){return this;} }
      class FakeAudioNode { connect(){return this;} disconnect(){} }
      class FakeGainNode extends FakeAudioNode { constructor(){super();this.gain=new FakeAudioParam(1);} }
      class FakeOscillatorNode extends FakeAudioNode { constructor(){super();this.frequency=new FakeAudioParam(440);this.detune=new FakeAudioParam(0);this.type='sine';} start(){} stop(){} }
      class FakeBiquadFilterNode extends FakeAudioNode { constructor(){super();this.frequency=new FakeAudioParam(350);this.Q=new FakeAudioParam(1);this.gain=new FakeAudioParam(0);this.type='lowpass';} }
      class FakeDynamicsCompressorNode extends FakeAudioNode { constructor(){super();this.threshold=new FakeAudioParam(-24);this.knee=new FakeAudioParam(30);this.ratio=new FakeAudioParam(12);this.attack=new FakeAudioParam(0.003);this.release=new FakeAudioParam(0.25);} }
      function addAudioNodeMethods(Cls) {
        Cls.prototype.createGain = function(){ return new FakeGainNode(); };
        Cls.prototype.createOscillator = function(){ return new FakeOscillatorNode(); };
        Cls.prototype.createBiquadFilter = function(){ return new FakeBiquadFilterNode(); };
        Cls.prototype.createDynamicsCompressor = function(){ return new FakeDynamicsCompressorNode(); };
        Cls.prototype.createWaveShaper = function(){ return Object.assign(new FakeAudioNode(), { curve: null, oversample: 'none' }); };
        Cls.prototype.createBufferSource = function(){ return Object.assign(new FakeAudioNode(), { start(){}, stop(){}, buffer: null, playbackRate: new FakeAudioParam(1) }); };
        Cls.prototype.createBuffer = function(){ return { getChannelData: () => new Float32Array(0) }; };
        Cls.prototype.createAnalyser = function(){ return Object.assign(new FakeAudioNode(), { fftSize: 2048, getFloatTimeDomainData(){} }); };
        Cls.prototype.decodeAudioData = function(){ return Promise.resolve({}); };
      }
      class FakeAudioContext { constructor(){ this.currentTime = 0; this.sampleRate = 44100; this.destination = new FakeAudioNode(); } resume(){ return Promise.resolve(); } }
      addAudioNodeMethods(FakeAudioContext);
      window.AudioContext = FakeAudioContext;

      class FakeOfflineAudioContext {
        constructor(numberOfChannels, length, sampleRate) {
          this.currentTime = 0; this.numberOfChannels = numberOfChannels; this.length = length; this.sampleRate = sampleRate;
          this.destination = new FakeAudioNode();
        }
        startRendering() {
          return Promise.resolve({
            numberOfChannels: this.numberOfChannels, sampleRate: this.sampleRate, length: this.length,
            getChannelData: () => new Float32Array(this.length),
          });
        }
      }
      addAudioNodeMethods(FakeOfflineAudioContext);
      window.OfflineAudioContext = FakeOfflineAudioContext;

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
  return { w, errors };
}

function evalInPage(w, expr){
  const script = w.document.createElement('script');
  const key = '__t_' + Math.random().toString(36).slice(2);
  script.textContent = `window.${key} = ${expr};`;
  w.document.body.appendChild(script);
  return w[key];
}

test('Export WAV on an empty progression alerts instead of crashing', async () => {
  const { w } = await withPage(null);
  let alertMsg = null;
  w.window.alert = (msg) => { alertMsg = msg; };
  w.document.getElementById('exportWavBtn').dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 30));
  assert.match(alertMsg, /empty/i);
});

test('Export WAV on a real progression completes the full render+encode+download flow and restores button state', async () => {
  const { w } = await withPage(`
    document.getElementById('tempoInput').value = '120';
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block' },
    ]);
  `);
  // avoid jsdom navigation errors from the real download-link click, without hiding a genuine failure elsewhere
  const origCreateElement = w.document.createElement.bind(w.document);
  w.document.createElement = function (tag) {
    const el = origCreateElement(tag);
    if (tag === 'a') el.click = function () {};
    return el;
  };
  let uncaught = null;
  w.window.addEventListener('error', (e) => { uncaught = e.error || e.message; });

  const btn = w.document.getElementById('exportWavBtn');
  btn.dispatchEvent(new w.Event('click'));
  await new Promise(r => setTimeout(r, 200));

  assert.equal(uncaught, null, 'no uncaught error during export: ' + uncaught);
  assert.equal(evalInPage(w, 'document.getElementById("exportWavBtn").textContent'), 'Export WAV', 'button label should be restored after finishing');
  assert.equal(evalInPage(w, 'document.getElementById("exportWavBtn").disabled'), false, 'button should be re-enabled after finishing');
});

test('the rendered buffer\'s duration exactly matches the progression\'s total length plus the fixed tail', async () => {
  const { w } = await withPage(`
    document.getElementById('tempoInput').value = '120';
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block' },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 8, strumPattern: 'block' },
    ]);
    window.__renderPromise = renderProgressionOffline();
  `);
  await new Promise(r => setTimeout(r, 100));
  const check = w.document.createElement('script');
  check.textContent = `window.__renderPromise.then(buf => { window.__rb = { numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate, length: buf.length }; });`;
  w.document.body.appendChild(check);
  await new Promise(r => setTimeout(r, 50));

  const rb = w.__rb;
  // 4 + 8 = 12 beats at 120bpm = 6 seconds of chords, + 2 second fixed tail = 8 seconds total
  const expectedLength = Math.ceil((12 * (60000 / 120) / 1000 + 2) * 44100);
  assert.equal(rb.numberOfChannels, 2);
  assert.equal(rb.sampleRate, 44100);
  assert.equal(rb.length, expectedLength);
});

test('renderProgressionOffline respects the section loop filter, only including the selected section\'s chords in the duration', async () => {
  const { w } = await withPage(`
    document.getElementById('tempoInput').value = '120';
    setProgression([
      { rootIndex: 0, suffix: '', label: 'I', modeName: 'Ionian', chordName: 'C', beats: 4, strumPattern: 'block', section: 'Verse' },
      { rootIndex: 5, suffix: '', label: 'IV', modeName: 'Ionian', chordName: 'F', beats: 4, strumPattern: 'block', section: 'Chorus' },
    ]);
    document.getElementById('loopSectionSelect').innerHTML = '<option value="">All</option><option value="Verse">Verse</option><option value="Chorus">Chorus</option>';
    document.getElementById('loopSectionSelect').value = 'Verse';
    window.__renderPromise = renderProgressionOffline();
  `);
  await new Promise(r => setTimeout(r, 100));
  const check = w.document.createElement('script');
  check.textContent = `window.__renderPromise.then(buf => { window.__rb2 = buf.length; });`;
  w.document.body.appendChild(check);
  await new Promise(r => setTimeout(r, 50));

  // only the Verse chord (4 beats = 2s at 120bpm) + 2s tail = 4s total, NOT both chords (6s + 2s = 8s)
  const expectedLength = Math.ceil((4 * (60000 / 120) / 1000 + 2) * 44100);
  assert.equal(w.__rb2, expectedLength, 'should only render the Verse section\'s chord, not the whole progression');
});
