import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const INDEX_HTML_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../index.html');

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => errors.push(e));

const dom = new JSDOM(readFileSync(INDEX_HTML_PATH, 'utf8'), {
  url: 'file://' + INDEX_HTML_PATH,
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.Element.prototype.scrollIntoView = window.Element.prototype.scrollIntoView || function () {};
    // jsdom returns null from getContext('2d') without the native canvas
    // package -- this mock records every drawing call instead of
    // rendering real pixels, letting tests verify the actual sequence of
    // operations (right text, right shapes, right positions) without a
    // heavy native dependency.
    window.HTMLCanvasElement.prototype.getContext = function (type) {
      if (type !== '2d') return null;
      if (!this.__mockCtx) {
        const calls = [];
        this.__mockCalls = calls;
        const props = { font: '10px sans-serif' };
        this.__mockCtx = new Proxy({}, {
          get(target, prop) {
            if (prop === 'measureText') {
              // Deterministic, font-size-based width estimate -- close
              // enough for tests that exercise text-fitting/truncation
              // logic (shrink-to-fit, ellipsis) without needing a real
              // font-rendering engine.
              return (text) => {
                const sizeMatch = /([\d.]+)px/.exec(props.font || '');
                const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 10;
                calls.push({ method: 'measureText', args: [text] });
                return { width: String(text).length * fontSize * 0.6 };
              };
            }
            if (prop in props) return props[prop];
            return (...args) => { calls.push({ method: prop, args }); };
          },
          set(target, prop, value) { props[prop] = value; calls.push({ set: prop, value }); return true; },
        });
      }
      return this.__mockCtx;
    };
    // jsdom refuses real localStorage for file:// URLs (treated as an
    // opaque origin), which silently no-ops every save/load path in the
    // app (progressions, the saved bin, etc) -- same class of gap as the
    // AudioContext mock originally was. A simple in-memory version lets
    // this tool actually exercise that code instead of it quietly failing.
    const __localStorageStore = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (k) => (k in __localStorageStore ? __localStorageStore[k] : null),
        setItem: (k, v) => { __localStorageStore[k] = String(v); },
        removeItem: (k) => { delete __localStorageStore[k]; },
      },
      configurable: true,
    });
    window.matchMedia = window.matchMedia || function () {
      return { matches: false, addListener() {}, removeListener() {} };
    };
    // A real AudioParam supports all of these; earlier versions of this
    // mock only provided some of them on some node types, which silently
    // meant this tool could never catch a bug in any code path that
    // actually plays a sound (window.__getMasterBus alone touches
    // filter.Q and a compressor's five params, none of which existed
    // here before) -- it could only validate page-load initialization.
    class FakeAudioParam {
      constructor(value) { this.value = value || 0; }
      setValueAtTime(v) { this.value = v; return this; }
      linearRampToValueAtTime(v) { this.value = v; return this; }
      exponentialRampToValueAtTime(v) { this.value = v; return this; }
      setTargetAtTime(v) { this.value = v; return this; }
      cancelScheduledValues() { return this; }
      cancelAndHoldAtTime() { return this; }
    }
    class FakeAudioNode {
      connect() { return this; }
      disconnect() {}
    }
    class FakeGainNode extends FakeAudioNode {
      constructor() { super(); this.gain = new FakeAudioParam(1); }
    }
    class FakeOscillatorNode extends FakeAudioNode {
      constructor() { super(); this.frequency = new FakeAudioParam(440); this.detune = new FakeAudioParam(0); this.type = 'sine'; }
      start() {} stop() {}
    }
    class FakeBiquadFilterNode extends FakeAudioNode {
      constructor() { super(); this.frequency = new FakeAudioParam(350); this.Q = new FakeAudioParam(1); this.gain = new FakeAudioParam(0); this.type = 'lowpass'; }
    }
    class FakeDynamicsCompressorNode extends FakeAudioNode {
      constructor() {
        super();
        this.threshold = new FakeAudioParam(-24); this.knee = new FakeAudioParam(30);
        this.ratio = new FakeAudioParam(12); this.attack = new FakeAudioParam(0.003); this.release = new FakeAudioParam(0.25);
      }
    }
    function addAudioNodeMethods(Cls) {
      Cls.prototype.createGain = function () { return new FakeGainNode(); };
      Cls.prototype.createOscillator = function () { return new FakeOscillatorNode(); };
      Cls.prototype.createBiquadFilter = function () { return new FakeBiquadFilterNode(); };
      Cls.prototype.createDynamicsCompressor = function () { return new FakeDynamicsCompressorNode(); };
      Cls.prototype.createWaveShaper = function () { return Object.assign(new FakeAudioNode(), { curve: null, oversample: 'none' }); };
      Cls.prototype.createBufferSource = function () { return Object.assign(new FakeAudioNode(), { start() {}, stop() {}, buffer: null, playbackRate: new FakeAudioParam(1) }); };
      Cls.prototype.createBuffer = function () { return { getChannelData: () => new Float32Array(0) }; };
      Cls.prototype.createAnalyser = function () { return Object.assign(new FakeAudioNode(), { fftSize: 2048, getFloatTimeDomainData() {} }); };
      Cls.prototype.decodeAudioData = function () { return Promise.resolve({}); };
    }
    class FakeAudioContext {
      constructor() { this.currentTime = 0; this.sampleRate = 44100; this.destination = new FakeAudioNode(); }
      resume() { return Promise.resolve(); }
    }
    addAudioNodeMethods(FakeAudioContext);
    window.AudioContext = FakeAudioContext;

    // OfflineAudioContext needed for WAV export -- startRendering returns
    // a plausibly-shaped (silent) buffer, sufficient to verify the export
    // pipeline's duration math and wiring without simulating real audio
    // synthesis, which nothing in this test suite needs.
    class FakeOfflineAudioContext {
      constructor(numberOfChannels, length, sampleRate) {
        this.currentTime = 0;
        this.numberOfChannels = numberOfChannels;
        this.length = length;
        this.sampleRate = sampleRate;
        this.destination = new FakeAudioNode();
      }
      startRendering() {
        return Promise.resolve({
          numberOfChannels: this.numberOfChannels,
          sampleRate: this.sampleRate,
          length: this.length,
          getChannelData: () => new Float32Array(this.length),
        });
      }
    }
    addAudioNodeMethods(FakeOfflineAudioContext);
    window.OfflineAudioContext = FakeOfflineAudioContext;

    window.fetch = window.fetch || (() => Promise.resolve({ ok: false, json: () => Promise.resolve({}), text: () => Promise.resolve(''), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }));
  },
});

await new Promise((resolve) => {
  dom.window.addEventListener('load', resolve);
  setTimeout(resolve, 5000);
});

console.log('Errors captured:', errors.length);
for (const e of errors) {
  console.log('---');
  console.log(e.message || e);
  if (e.detail && e.detail.stack) console.log(e.detail.stack.split('\n').slice(0, 8).join('\n'));
}

console.log();
console.log('=== Sanity check: did the app actually initialize, not just avoid throwing? ===');
const w = dom.window;

// const/let don't become window properties even at global scope (normal JS
// behavior) -- so verify them by running a script in the SAME lexical
// scope, which explicitly attaches results to window for us to read.
const checkScript = w.document.createElement('script');
checkScript.textContent = `
  window.__check_progression = Array.isArray(progression);
  window.__check_noteNames = typeof NOTE_NAMES !== 'undefined' && NOTE_NAMES.length === 12;
  window.__check_modesTable = typeof MODES_TABLE !== 'undefined' && Object.keys(MODES_TABLE).length === 9;
  window.__check_drumSounds = typeof DRUM_SOUNDS !== 'undefined' && DRUM_SOUNDS.length === 10;
`;
w.document.body.appendChild(checkScript);

console.log('progression is an array:', w.__check_progression);
console.log('NOTE_NAMES has 12 entries:', w.__check_noteNames);
console.log('MODES_TABLE has all 9 modes:', w.__check_modesTable);
console.log('DRUM_SOUNDS has 10 entries:', w.__check_drumSounds);
console.log('updateLeadCopyToolbar is defined (the function that was broken):', typeof w.updateLeadCopyToolbar === 'function');
console.log('chart mode pills actually rendered into the DOM:', w.document.querySelectorAll('.mode-picker button, .mode-pill').length > 0 || w.document.getElementById('modePicker') !== null);
console.log('shortcuts help content actually rendered:', w.document.getElementById('shortcutsBody') && w.document.getElementById('shortcutsBody').children.length > 0);

console.log();
console.log('=== Sanity check: does actually playing a sound work, not just page load? ===');
console.log('(this is the check that would have caught the incomplete mock this tool had before -- window.__getMasterBus is used by every sound-playing function in the app, so this exercises real audio-graph code, not just initialization)');
const audioCtx = new w.AudioContext();
const toneTypesToCheck = ['triangle', 'sine', 'sawtooth', 'square', 'piano', 'brightpiano', 'toypiano', 'rhodes', 'wurly', 'dxep', 'organ', 'rockorgan', 'synthpad', 'synthbass', 'subbass', 'fmbass', 'electricbass', 'doublebass'];
for (const type of toneTypesToCheck) {
  try {
    if (w.__toneEngine.isInstrument(type)) {
      w.__toneEngine.playNote(audioCtx, type, 220, 0, 0.5, 1.0);
    } else {
      const osc = audioCtx.createOscillator();
      osc.type = type;
      osc.connect(w.__getMasterBus(audioCtx));
      osc.start(0);
    }
    console.log(`  ${type}: OK`);
  } catch (e) {
    console.log(`  ${type}: THREW -- ${e.message}`);
    errors.push(e);
  }
}
