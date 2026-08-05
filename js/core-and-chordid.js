
// ============================================================
// Chord ID mode -- built on Spotify's Basic Pitch (polyphonic
// pitch detection), vendored locally alongside its model files.
// Everything still runs entirely on-device.
// ============================================================

const modeTuneBtn = document.getElementById('modeTuneBtn');
const modeChordBtn = document.getElementById('modeChordBtn');
const tuneModeEl = document.getElementById('tuneMode');
const chordModeEl = document.getElementById('chordMode');
const chordCaptureBtn = document.getElementById('chordCaptureBtn');
const chordNameEl = document.getElementById('chordName');
const chordNotesEl = document.getElementById('chordNotes');
const chordStatusDot = document.getElementById('chordStatusDot');
const chordStatusText = document.getElementById('chordStatusText');
const chordEngineNote = document.getElementById('chordEngineNote');

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CAPTURE_SECONDS = 2.0;

// Chord templates as semitone intervals from a root (0-11).
// Ordered roughly common-to-rare; matching picks the best score, not the first hit.
const CHORD_TEMPLATES = [
  { suffix: '',      intervals: [0, 4, 7] },        // major
  { suffix: 'm',     intervals: [0, 3, 7] },        // minor
  { suffix: '7',     intervals: [0, 4, 7, 10] },    // dominant 7
  { suffix: 'maj7',  intervals: [0, 4, 7, 11] },    // major 7
  { suffix: 'm7',    intervals: [0, 3, 7, 10] },    // minor 7
  { suffix: 'sus2',  intervals: [0, 2, 7] },
  { suffix: 'sus4',  intervals: [0, 5, 7] },
  { suffix: 'dim',   intervals: [0, 3, 6] },
  { suffix: 'aug',   intervals: [0, 4, 8] },
  { suffix: '6',     intervals: [0, 4, 7, 9] },
  { suffix: 'm6',    intervals: [0, 3, 7, 9] },
  { suffix: 'm7b5',  intervals: [0, 3, 6, 10] },
  { suffix: 'add9',  intervals: [0, 2, 4, 7] },
  // wider coverage for richer chords -- previously anything not in this
  // list got force-matched to the closest wrong simple chord
  { suffix: '9',     intervals: [0, 2, 4, 7, 10] }, // dominant 9
  { suffix: 'maj9',  intervals: [0, 2, 4, 7, 11] },
  { suffix: 'm9',    intervals: [0, 2, 3, 7, 10] },
  { suffix: '69',    intervals: [0, 2, 4, 7, 9] },  // 6/9
  { suffix: 'dim7',  intervals: [0, 3, 6, 9] },
  { suffix: 'aug7',  intervals: [0, 4, 8, 10] },
  { suffix: '7sus4', intervals: [0, 5, 7, 10] },
  { suffix: 'add11', intervals: [0, 4, 5, 7] },
];

let basicPitchModule = null;   // { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime }
let basicPitchInstance = null; // BasicPitch instance, model loads once and is reused
let modelLoadPromise = null;

// ---- chord fretboard diagrams, via vendored @tombatossals/chords-db data ----
const chordDiagramWrap = document.getElementById('chordDiagramWrap');
let chordsDbData = null;
let chordsDbLoadPromise = null;

// chords-db spells three roots with flats rather than sharps; everything else matches our NOTE_NAMES directly
// chords-db's own metadata claims these keys are spelled 'C#'/'F#', but the
// ACTUAL data object uses 'Csharp'/'Fsharp' as the real property names --
// confirmed by inspecting the vendored file directly. Every C# and F#
// lookup was silently failing (always "no diagram", never playable) until
// this was traced down.
const ROOT_TO_DB_KEY = ['C','Csharp','D','Eb','E','F','Fsharp','G','Ab','A','Bb','B'];

// our internal chord-template suffixes -> chords-db's suffix spelling (mostly identical)
const SUFFIX_TO_DB = {
  '': 'major', 'm': 'minor', '7': '7', 'maj7': 'maj7', 'm7': 'm7',
  'sus2': 'sus2', 'sus4': 'sus4', 'dim': 'dim', 'aug': 'aug',
  '6': '6', 'm6': 'm6', 'm7b5': 'm7b5', 'add9': 'add9',
  '9': '9', 'maj9': 'maj9', 'm9': 'm9', '69': '69',
  'dim7': 'dim7', 'aug7': 'aug7', '7sus4': '7sus4', 'add11': 'add11',
  'madd9': 'madd9', '5': '5',
  // extended jazz voicings -- every one of these verified against real
  // chords-db data across 7 different roots before being added, same
  // discipline as everywhere else in this app
  '11': '11', '13': '13', 'maj11': 'maj11', 'maj13': 'maj13',
  '7b9': '7b9', '7#9': '7#9', '7b5': '7b5', 'alt': 'alt',
  'm11': 'm11', 'mmaj7': 'mmaj7', 'm69': 'm69'
};

// Per-chord "mod" dropdown options, bucketed by the diatonic chord's base
// quality -- each value is one of our own suffixes (looked up the same way
// as everywhere else), each label is what the dropdown shows.
const MOD_OPTIONS = {
  maj: [
    { value: '',     label: 'Triad' },
    { value: '7',     label: '7 (Dominant)' },
    { value: 'maj7',  label: 'Maj7' },
    { value: '6',     label: '6' },
    { value: 'add9',  label: 'Add9' },
    { value: '9',     label: '9' },
    { value: 'maj9',  label: 'Maj9' },
    { value: '11',    label: '11' },
    { value: 'maj11', label: 'Maj11' },
    { value: '13',    label: '13' },
    { value: 'maj13', label: 'Maj13' },
    { value: '7b5',   label: '7b5' },
    { value: '7b9',   label: '7b9' },
    { value: '7#9',   label: '7#9' },
    { value: 'alt',   label: 'Alt (Altered Dominant)' },
    { value: 'sus2',  label: 'Sus2' },
    { value: 'sus4',  label: 'Sus4' },
    { value: 'aug',   label: 'Augmented' },
    { value: '5',     label: '5 (Power Chord)' },
  ],
  min: [
    { value: 'm',     label: 'Triad' },
    { value: 'm7',    label: 'm7' },
    { value: 'm6',    label: 'm6' },
    { value: 'madd9', label: 'Add9' },
    { value: 'm9',    label: 'm9' },
    { value: 'm11',   label: 'm11' },
    { value: 'm69',   label: 'm6/9' },
    { value: 'mmaj7', label: 'Minor-Maj7' },
    { value: 'sus2',  label: 'Sus2' },
    { value: 'sus4',  label: 'Sus4' },
    { value: 'dim',   label: 'Diminished' },
    { value: 'm7b5',  label: 'm7b5 (Half-dim)' },
    { value: '5',     label: '5 (Power Chord)' },
  ],
  dim: [
    { value: 'dim',   label: 'Triad' },
    { value: 'dim7',  label: 'Dim7' },
    { value: 'm7b5',  label: 'm7b5 (Half-dim)' },
  ],
};

// A curated subset of MOD_OPTIONS for Simple Mode -- the handful of
// chord types someone new to music actually needs to get moving, not
// the full theory vocabulary. Whatever a chip/card's CURRENT suffix is
// always gets shown too, even if it isn't in this list (see
// rebuildModOptions) -- Simple Mode limits what's offered next, it
// never hides or silently changes something already chosen.
const MOD_OPTIONS_SIMPLE = {
  maj: [
    { value: '',    label: 'Triad' },
    { value: '7',   label: '7 (Dominant)' },
    { value: 'maj7', label: 'Maj7' },
    { value: 'sus4', label: 'Sus4' },
  ],
  min: [
    { value: 'm',  label: 'Triad' },
    { value: 'm7', label: 'm7' },
    { value: 'sus4', label: 'Sus4' },
  ],
  dim: [
    { value: 'dim', label: 'Triad' },
  ],
};

// A progression chip's current suffix could be almost anything by the time
// you're looking at it (loaded from a preset, edited from a chart card,
// duplicated, etc.) -- this figures out which MOD_OPTIONS list actually
// applies to it, so the chip's own mod dropdown always shows a sensible set.
function suffixToQualityBucket(suffix){
  if (suffix === 'dim' || suffix === 'dim7' || suffix === 'm7b5') return 'dim';
  if (suffix.startsWith('m') && !suffix.startsWith('maj')) return 'min';
  return 'maj';
}

function ensureChordsDbLoaded(){
  if (chordsDbLoadPromise) return chordsDbLoadPromise;
  chordsDbLoadPromise = fetch('./vendor/chords-db/guitar.json')
    .then(r => r.ok ? r.json() : Promise.reject(new Error('chords-db fetch failed: ' + r.status)))
    .then(data => { if (data && data.chords) chordsDbData = data; });
  return chordsDbLoadPromise;
}

function lookupChordShape(rootIndex, ourSuffix, voicingIndex){
  if (!chordsDbData || !chordsDbData.chords) return null;
  const dbKey = ROOT_TO_DB_KEY[rootIndex];
  const dbSuffix = SUFFIX_TO_DB[ourSuffix];
  if (!dbSuffix) return null;
  const entries = chordsDbData.chords[dbKey];
  if (!entries) return null;
  const match = entries.find(e => e.suffix === dbSuffix);
  if (!match || !match.positions || match.positions.length === 0) return null;
  const idx = Math.min(voicingIndex || 0, match.positions.length - 1);
  return match.positions[idx];
}

// Shifts a REAL chords-db shape up by whole octaves, producing a genuinely
// different, playable shape -- not just an audio layer. This works because
// moving any fretted shape up exactly 12 frets produces the exact same
// chord one octave higher (a real guitar principle: a "moveable shape").
// Even open strings work: an open string shifted by 12 becomes fret 12 on
// that same string, a completely normal position. Verified against real
// chords-db data (an open C major and a barre position further up the
// neck) before being ported here -- hand-checked the actual resulting
// pitches landed exactly one octave higher, not just that the numbers
// looked plausible.
//
// Returns null when the shift would exceed a realistic 24-fret ceiling --
// "where applicable", matching how much room a real guitar actually has.
function shiftShapeByOctaves(shape, octaves){
  if (!octaves) return shape;
  const shiftAmount = octaves * 12;
  const shiftedAbsolute = shape.frets.map(f => {
    if (f === -1) return -1;
    const absoluteFret = f > 0 ? shape.baseFret + f - 1 : 0;
    return absoluteFret + shiftAmount;
  });
  const playedFrets = shiftedAbsolute.filter(f => f !== -1);
  if (playedFrets.length === 0) return null;
  if (Math.max(...playedFrets) > 24) return null; // not playable on a realistic guitar
  const newBaseFret = Math.min(...playedFrets);
  const newFrets = shiftedAbsolute.map(af => af === -1 ? -1 : (af - newBaseFret + 1));
  return { frets: newFrets, baseFret: newBaseFret, fingers: shape.fingers, barres: shape.barres };
}

// Given a base shape, returns the list of octave levels (0 = original, 1,
// 2, 3...) that are actually playable for it -- used to build the cycling
// control and to know how many levels are available before landing on
// "not applicable".
function getPlayableOctaveLevels(shape){
  const levels = [0];
  for (let oct = 1; oct <= 3; oct++) {
    if (shiftShapeByOctaves(shape, oct)) levels.push(oct);
    else break; // once one level fails, higher ones will too -- frets only increase
  }
  return levels;
}

// Looks up a progression entry's shape AND applies its stored octave
// shift in one call -- every consumer of a progression entry's shape
// (chip preview, playback, MIDI export, Save Image) goes through this
// instead of calling lookupChordShape directly, so the octave shift is
// applied consistently everywhere rather than needing to remember it at
// each call site individually.
function lookupEntryShape(entry){
  const baseShape = lookupChordShape(entry.rootIndex, entry.suffix, entry.voicingIndex || 0);
  if (!baseShape) return null;
  if (!entry.octaveShift) return baseShape;
  return shiftShapeByOctaves(baseShape, entry.octaveShift) || baseShape;
}

function getVoicingCount(rootIndex, ourSuffix){
  if (!chordsDbData || !chordsDbData.chords) return 0;
  const dbKey = ROOT_TO_DB_KEY[rootIndex];
  const dbSuffix = SUFFIX_TO_DB[ourSuffix];
  if (!dbSuffix) return 0;
  const entries = chordsDbData.chords[dbKey];
  if (!entries) return 0;
  const match = entries.find(e => e.suffix === dbSuffix);
  return (match && match.positions) ? match.positions.length : 0;
}

// Standard tuning, low string to high (matches chords-db's own fret-array
// ordering, confirmed against real data): E2 A2 D3 G3 B3 E4, expressed as
// semitone pitch-class from C.
const STRING_PITCH_CLASS = [4,9,2,7,11,4];
function getBassPitchClass(shape){
  for (let i = 0; i < shape.frets.length; i++) {
    const f = shape.frets[i];
    if (f !== -1) {
      const absoluteFret = f > 0 ? shape.baseFret + f - 1 : 0;
      return (STRING_PITCH_CLASS[i] + absoluteFret) % 12;
    }
  }
  return null;
}
// Mirror of getBassPitchClass -- scans from the HIGH string side instead of
// the low side. Same simplification as bass: "highest string that's
// actually played," not necessarily the technically highest-pitched note
// (a high fret on a lower string could occasionally exceed an open higher
// string) -- consistent with how bass note already works.
function getTopPitchClass(shape){
  for (let i = shape.frets.length - 1; i >= 0; i--) {
    const f = shape.frets[i];
    if (f !== -1) {
      const absoluteFret = f > 0 ? shape.baseFret + f - 1 : 0;
      return (STRING_PITCH_CLASS[i] + absoluteFret) % 12;
    }
  }
  return null;
}
function describeBassNote(shape, rootIndex){
  const fretNote = shape.baseFret > 1 ? (' \u00b7 ' + ordinal(shape.baseFret) + ' fret') : '';
  const bassPitchClass = getBassPitchClass(shape);
  if (bassPitchClass === null) return 'Root Position' + fretNote;
  return (bassPitchClass === rootIndex ? 'Root Position' : (NOTE_NAMES[bassPitchClass] + ' in Bass')) + fretNote;
}
function ordinal(n){
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

// Hand-drawn SVG fretboard diagram -- deliberately not using an external
// rendering library, same "vendor data, build our own visuals" approach
// as the rest of this app.
// Maps a semitone interval from the chord root to a practical chord-tone
// name and a distinct color family, so fretboard diagrams can show WHAT
// each fretted note actually is (root/3rd/5th/7th/extension), not just
// where to put your fingers. Root stays the app's amber accent for
// consistency with everywhere else; everything else gets its own hue.
// Distinct from every interval-role color below (root=amber, 3rds=green,
// 5ths=blue, 6/7ths=purple, 9/11ths=pink) -- deliberately NOT colored
// blue despite the name, since the b5 interval it usually represents
// already shares blue with the perfect 5th below, which would make it
// blend in rather than stand out as "special, non-diatonic, optional."
const BLUE_NOTE_COLOR = '#e85d5d';

function getIntervalRole(interval){
  if (interval === 0) return { name: 'R', fullName: 'Root', color: 'var(--amber)' };
  if (interval === 3) return { name: 'm3', fullName: 'Minor 3rd', color: '#7fd88f' };
  if (interval === 4) return { name: 'M3', fullName: 'Major 3rd', color: '#7fd88f' };
  if (interval === 6) return { name: 'b5', fullName: 'Flat 5th', color: '#7fb3d5' };
  if (interval === 7) return { name: '5', fullName: 'Perfect 5th', color: '#7fb3d5' };
  if (interval === 8) return { name: '#5', fullName: 'Sharp 5th', color: '#7fb3d5' };
  if (interval === 9) return { name: '6', fullName: '6th', color: '#c58fd8' };
  if (interval === 10) return { name: 'b7', fullName: 'Flat 7th (Dominant 7th)', color: '#c58fd8' };
  if (interval === 11) return { name: '7', fullName: 'Major 7th', color: '#c58fd8' };
  if (interval === 1) return { name: 'b9', fullName: 'Flat 9th', color: '#e88fa8' };
  if (interval === 2) return { name: '9', fullName: '9th', color: '#e88fa8' };
  return { name: '11', fullName: '11th', color: '#e88fa8' }; // interval === 5
}

function renderChordDiagramSVG(position, rootIndex){
  const { frets, fingers, baseFret, barres } = position;
  const numStrings = 6;
  // IMPORTANT: frets values are already relative to baseFret (f=1 means
  // "the first row of the diagram, i.e. baseFret itself") -- verified
  // empirically against real data, the same fact the playback pitch fix
  // relies on. The display row is simply the raw value; no further
  // transformation. The old "f - baseFret + 1" formula assumed f was an
  // absolute fret number, which produces NEGATIVE rows (dots drawn off
  // the top of the visible diagram, looking like an empty grid) for any
  // voicing where baseFret > 1 -- invisible until voicing-cycling made it
  // possible to reach those voicings at all.
  const relFrets = frets;
  const maxRel = Math.max(4, ...relFrets.filter(f => f > 0));
  const numFretRows = maxRel;

  const width = 140, topPad = 26, leftPad = 14, rightPad = 14, bottomPad = 10;
  const gridWidth = width - leftPad - rightPad;
  const rowHeight = 26;
  const gridHeight = numFretRows * rowHeight;
  const height = topPad + gridHeight + bottomPad;
  const stringX = (i) => leftPad + (gridWidth / (numStrings - 1)) * i;
  const fretY = (row) => topPad + row * rowHeight; // row 0 = nut line

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

  // string lines
  for (let i = 0; i < numStrings; i++) {
    svg += `<line x1="${stringX(i)}" y1="${topPad}" x2="${stringX(i)}" y2="${topPad + gridHeight}" stroke="var(--amber-dim)" stroke-width="1.5" />`;
  }
  // fret lines
  for (let row = 0; row <= numFretRows; row++) {
    const isNut = row === 0 && baseFret === 1;
    svg += `<line x1="${leftPad}" y1="${fretY(row)}" x2="${leftPad + gridWidth}" y2="${fretY(row)}" stroke="var(--amber-dim)" stroke-width="${isNut ? 3 : 1.5}" />`;
  }
  // base fret label if not starting at the nut
  if (baseFret > 1) {
    svg += `<text x="${leftPad - 8}" y="${fretY(0) + rowHeight * 0.65}" font-size="11" font-weight="700" fill="var(--amber)" text-anchor="end" font-family="JetBrains Mono, monospace">${baseFret}fr</text>`;
  }
  // barres
  (barres || []).forEach(barreFret => {
    const relBarre = barreFret; // barreFret is in the same relative units as frets -- no baseFret subtraction needed
    const stringsAtBarre = [];
    frets.forEach((f, i) => { if (f === barreFret) stringsAtBarre.push(i); });
    if (stringsAtBarre.length >= 2) {
      const x1 = stringX(Math.min(...stringsAtBarre));
      const x2 = stringX(Math.max(...stringsAtBarre));
      const y = fretY(relBarre - 1) + rowHeight / 2;
      svg += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--amber)" stroke-width="8" stroke-linecap="round" opacity="0.85" />`;
    }
  });
  // per-string markers: X (muted), O (open), or a filled dot with finger number
  frets.forEach((f, i) => {
    const x = stringX(i);
    if (f === -1) {
      svg += `<text x="${x}" y="${topPad - 10}" font-size="12" fill="var(--off)" text-anchor="middle" font-family="JetBrains Mono, monospace">x</text>`;
    } else if (f === 0) {
      const role = (rootIndex !== undefined) ? getIntervalRole((STRING_PITCH_CLASS[i] - rootIndex + 12) % 12) : null;
      const strokeColor = role ? role.color : 'var(--live-white)';
      svg += `<circle cx="${x}" cy="${topPad - 13}" r="4.5" fill="none" stroke="${strokeColor}" stroke-width="1.5">${role ? '<title>' + role.fullName + '</title>' : ''}</circle>`;
    } else {
      const row = f; // same fix as the pitch calculation -- f is already relative to baseFret
      const y = fretY(row - 1) + rowHeight / 2;
      const absoluteFret = baseFret + f - 1;
      const role = (rootIndex !== undefined) ? getIntervalRole((STRING_PITCH_CLASS[i] + absoluteFret - rootIndex + 1200) % 12) : null;
      const dotColor = role ? role.color : 'var(--amber)';
      svg += `<circle cx="${x}" cy="${y}" r="8" fill="${dotColor}">${role ? '<title>' + role.fullName + '</title>' : ''}</circle>`;
      const fingerNum = fingers ? fingers[i] : 0;
      if (fingerNum > 0) {
        svg += `<text x="${x}" y="${y + 3.5}" font-size="9" fill="#2a1c08" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="700">${fingerNum}</text>`;
      }
    }
  });

  svg += '</svg>';
  return svg;
}

function updateChordDiagram(rootIndex, ourSuffix){
  chordDiagramWrap.innerHTML = '';
  ensureChordsDbLoaded().then(() => {
    const shape = lookupChordShape(rootIndex, ourSuffix);
    if (!shape) {
      chordDiagramWrap.innerHTML = '<div class="chord-diagram-caption">no diagram available for this voicing</div>';
      return;
    }
    chordDiagramWrap.innerHTML = renderChordDiagramSVG(shape, rootIndex) + '<div class="chord-diagram-caption">common voicing</div>';
  }).catch(() => {
    chordDiagramWrap.innerHTML = '';
  });
}

let audioCtx = null;
let mediaStream = null;
let workletNode = null;
let silentGain = null;
let capturing = false;
let capturedChunks = [];
let capturedSampleCount = 0;

function setChordStatus(text, live){
  chordStatusText.textContent = text;
  chordStatusDot.classList.toggle('live', !!live);
}

// Lazily load the vendored library + model on first use, so users who never
// open Chord ID mode never pay the download/parse cost.
function ensureModelLoaded(){
  if (modelLoadPromise) return modelLoadPromise;
  chordEngineNote.textContent = 'loading model…';
  modelLoadPromise = import('./vendor/basic-pitch/index.js')
    .then((mod) => {
      basicPitchModule = mod;
      basicPitchInstance = new mod.BasicPitch('./model/basic-pitch/model.json');
      return basicPitchInstance.model; // this is itself a Promise<tf.GraphModel>; awaiting confirms it actually loaded
    })
    .then(() => {
      chordEngineNote.textContent = 'engine: Basic Pitch (on-device ML)';
    })
    .catch((err) => {
      chordEngineNote.textContent = 'model failed to load';
      modelLoadPromise = null; // allow retry on next capture attempt
      throw err;
    });
  return modelLoadPromise;
}

// ---- capture worklet: just forwards raw sample blocks to the main thread.
// Unlike the tuner's continuous 60fps pitch loop, this only needs to run for
// ~2 seconds total, so accumulating on the main thread from these messages
// is perfectly fine -- no need for the heavier on-thread buffering the
// tuner's YIN detector uses.
const CAPTURE_WORKLET_SRC = [
  "class CaptureProcessor extends AudioWorkletProcessor {",
  "  process(inputs){",
  "    const input = inputs[0];",
  "    if(input && input[0]){",
  "      this.port.postMessage(input[0].slice());",
  "    }",
  "    return true;",
  "  }",
  "}",
  "registerProcessor('capture-processor', CaptureProcessor);"
].join("\n");

function stopChordCapture(){
  capturing = false;
  if (workletNode){ try { workletNode.disconnect(); } catch(e){} workletNode = null; }
  if (silentGain){ try { silentGain.disconnect(); } catch(e){} silentGain = null; }
  if (mediaStream){ mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (audioCtx){ audioCtx.close(); audioCtx = null; }
}

async function startChordCapture(){
  if (capturing) return;
  chordNameEl.textContent = '–';
  chordNotesEl.textContent = 'listening…';
  setChordStatus('requesting mic…', false);

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch (err) {
    setChordStatus('mic permission denied', false);
    chordNotesEl.textContent = 'enable microphone access and try again';
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  try {
    await audioCtx.resume();
    await audioCtx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([CAPTURE_WORKLET_SRC], { type: 'application/javascript' }))
    );

    const source = audioCtx.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioCtx, 'capture-processor');
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(workletNode);
    workletNode.connect(silentGain);
    silentGain.connect(audioCtx.destination);
  } catch (err) {
    // Common cause: testing via file:// instead of the deployed https:// site --
    // blob-URL worklet loading and ES module imports are both blocked under
    // the file: origin. Clean up fully rather than leaving the mic open.
    console.error('Chord capture setup failed:', err);
    setChordStatus('capture setup failed', false);
    chordNotesEl.textContent = 'audio setup failed — if opening this file directly, try the deployed site instead';
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    return;
  }

  capturedChunks = [];
  capturedSampleCount = 0;
  capturing = true;
  setChordStatus('armed — strum when ready', true);

  const targetSamples = Math.ceil(CAPTURE_SECONDS * audioCtx.sampleRate);
  const nativeSampleRate = audioCtx.sampleRate;
  const ARM_TIMEOUT_MS = 6000;     // give the player a real window to get ready and strum
  const ONSET_RMS_THRESHOLD = 0.02;

  let onsetDetected = false;
  let postOnsetSamples = 0;
  const armTimeoutId = setTimeout(() => {
    if (!onsetDetected && capturing) {
      capturing = false;
      stopChordCapture();
      setChordStatus('no strum detected', false);
      chordNotesEl.textContent = 'try again — strum clearly within a few seconds of arming';
    }
  }, ARM_TIMEOUT_MS);

  workletNode.port.onmessage = (e) => {
    if (!capturing) return;
    const chunk = e.data;

    if (!onsetDetected) {
      // Wait for the actual strum rather than starting the 2s clock the instant
      // the mic connects -- otherwise part of the capture window is silence
      // before the player has even picked up the guitar, which was very
      // likely why richer/quieter chords were coming back wrong or unmatched.
      let rms = 0;
      for (let i = 0; i < chunk.length; i++) rms += chunk[i] * chunk[i];
      rms = Math.sqrt(rms / chunk.length);
      if (rms < ONSET_RMS_THRESHOLD) return;
      onsetDetected = true;
      clearTimeout(armTimeoutId);
      setChordStatus('capturing — hold the chord', true);
    }

    capturedChunks.push(chunk);
    capturedSampleCount += chunk.length;
    postOnsetSamples += chunk.length;
    if (postOnsetSamples >= targetSamples) {
      capturing = false;
      finishCapture(nativeSampleRate);
    }
  };
}

async function finishCapture(nativeSampleRate){
  setChordStatus('analyzing…', true);

  // flatten the captured chunks into one Float32Array
  const combined = new Float32Array(capturedSampleCount);
  let offset = 0;
  for (const chunk of capturedChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  capturedChunks = [];

  stopChordCapture();

  try {
    await ensureModelLoaded();
    const resampled = await resampleTo22050(combined, nativeSampleRate);
    const notes = await runBasicPitch(resampled);
    renderChordResult(notes);
  } catch (err) {
    setChordStatus('analysis failed', false);
    chordNotesEl.textContent = 'something went wrong — try again';
    console.error(err);
    return;
  }

  setChordStatus('ready', false);
}

// Basic Pitch requires exactly 22050Hz mono. Our capture is at whatever the
// device's native rate is (typically 44100 or 48000), so resample via a
// throwaway OfflineAudioContext -- the standard Web Audio technique for this.
async function resampleTo22050(float32Data, originalSampleRate){
  const TARGET_RATE = 22050;
  const scratchCtx = new (window.AudioContext || window.webkitAudioContext)();
  const originalBuffer = scratchCtx.createBuffer(1, float32Data.length, originalSampleRate);
  originalBuffer.copyToChannel(float32Data, 0);
  scratchCtx.close();

  const targetLength = Math.ceil(float32Data.length * TARGET_RATE / originalSampleRate);
  const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_RATE);
  const src = offlineCtx.createBufferSource();
  src.buffer = originalBuffer;
  src.connect(offlineCtx.destination);
  src.start(0);
  return offlineCtx.startRendering(); // resolves to an AudioBuffer at 22050Hz mono
}

async function runBasicPitch(resampledBuffer){
  const { outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = basicPitchModule;
  const frames = [], onsets = [], contours = [];

  await basicPitchInstance.evaluateModel(
    resampledBuffer,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    () => {} // percent callback -- capture is short enough not to need a progress bar
  );

  const rawNotes = outputToNotesPoly(frames, onsets); // library defaults for thresholds
  const withBends = addPitchBendsToNoteEvents(contours, rawNotes);
  const timed = noteFramesToTime(withBends);

  // Filter out faint/very-short spurious detections
  // A guitar has 6 strings, so 6 is a hard ceiling on simultaneous distinct
  // notes -- keeping the loudest 6 (rather than a flat amplitude cutoff) is
  // more robust against stray harmonics or pick noise adding spurious extras.
  const filtered = timed.filter(n => n.durationSeconds > 0.03);
  filtered.sort((a, b) => b.amplitude - a.amplitude);
  return filtered.slice(0, 6);
}

function midiToNoteName(pitchMidi){
  const pitchClass = ((Math.round(pitchMidi) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(pitchMidi) / 12) - 1;
  return { name: NOTE_NAMES[pitchClass], octave, pitchClass };
}

function matchChord(pitchClassSet, lowestPitchClass){
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const tmpl of CHORD_TEMPLATES) {
      const expected = new Set(tmpl.intervals.map(iv => (root + iv) % 12));
      let inCommon = 0;
      expected.forEach(pc => { if (pitchClassSet.has(pc)) inCommon++; });
      const missing = expected.size - inCommon;
      let extra = 0;
      pitchClassSet.forEach(pc => { if (!expected.has(pc)) extra++; });
      let score = inCommon - missing * 0.6 - extra * 0.35;
      // Guitar chords played in common shapes overwhelmingly have the root
      // as the lowest string played -- weighting this more heavily helps
      // distinguish between chords that otherwise share most of their tones
      // (e.g. a 6th chord vs. its relative minor 7th).
      if (root === lowestPitchClass) score += 0.5;
      if (!best || score > best.score) {
        best = { root, tmpl, score, inCommon, expectedSize: expected.size, coverage: inCommon / expected.size };
      }
    }
  }
  return best;
}

function renderChordResult(notes){
  if (notes.length === 0) {
    chordNameEl.textContent = '–';
    chordNotesEl.textContent = 'no clear notes detected — try strumming louder or closer to the mic';
    chordDiagramWrap.innerHTML = '';
    return;
  }

  const namedNotes = notes
    .map(n => ({ ...midiToNoteName(n.pitchMidi), midi: n.pitchMidi }))
    .sort((a, b) => a.midi - b.midi);

  const pitchClassSet = new Set(namedNotes.map(n => n.pitchClass));
  const lowestPitchClass = namedNotes[0].pitchClass;

  const breakdown = namedNotes.map(n => `${n.name}${n.octave}`).join(' · ');

  if (pitchClassSet.size === 1) {
    chordNameEl.textContent = NOTE_NAMES[lowestPitchClass];
    chordNotesEl.textContent = breakdown + ' (single note, not a chord)';
    chordDiagramWrap.innerHTML = '';
    return;
  }

  const best = matchChord(pitchClassSet, lowestPitchClass);

  if (!best || best.inCommon < 2 || best.coverage < 0.7) {
    chordNameEl.textContent = '?';
    chordNotesEl.textContent = breakdown + ' — no clean chord match';
    chordDiagramWrap.innerHTML = '';
    return;
  }

  chordNameEl.textContent = NOTE_NAMES[best.root] + best.tmpl.suffix;
  chordNotesEl.textContent = breakdown;
  updateChordDiagram(best.root, best.tmpl.suffix);
}

chordCaptureBtn.addEventListener('click', () => {
  ensureModelLoaded().catch(() => {}); // kick off loading if not already; capture proceeds regardless, evaluateModel awaits it
  startChordCapture();
});

// ---- mode toggle ----
const modeChartBtn = document.getElementById('modeChartBtn');
const chartModeEl = document.getElementById('chartMode');
const modeLeadBtn = document.getElementById('modeLeadBtn');
const leadModeEl = document.getElementById('leadMode');
const modeDrumsBtn = document.getElementById('modeDrumsBtn');
const drumsModeEl = document.getElementById('drumsMode');
const chartKeySelect = document.getElementById('chartKeySelect');
const modePicker = document.getElementById('modePicker');
const chartGroups = document.getElementById('chartGroups');
const progressionRow = document.getElementById('progressionRow');
const progressionEmpty = document.getElementById('progressionEmpty');
const progressionStatus = document.getElementById('progressionStatus');
const progressionSummary = document.getElementById('progressionSummary');
const progressionCadence = document.getElementById('progressionCadence');
const progressionDownloadBtn = document.getElementById('progressionDownloadBtn');
const progressionClearBtn = document.getElementById('progressionClearBtn');
const undoProgressionBtn = document.getElementById('undoProgressionBtn');
const redoProgressionBtn = document.getElementById('redoProgressionBtn');

// ---- MIDI export -- Standard MIDI File, Type 0, single track. The binary
// encoding below (VLQ delta-times, chunk structure, event bytes) was
// verified against the formal MIDI spec's test vectors and against a real,
// independent MIDI parser (Python's mido) before being ported here -- a
// malformed byte stream just silently fails to open in a DAW, so this
// isn't something to get approximately right.
const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64]; // low E to high E, standard tuning
function writeVLQ(value){
  if (value === 0) return [0];
  const groups = [];
  while (value > 0) {
    groups.unshift(value & 0x7F);
    value = value >>> 7;
  }
  for (let i = 0; i < groups.length - 1; i++) groups[i] |= 0x80;
  return groups;
}
function uint16BE(v){ return [(v >> 8) & 0xFF, v & 0xFF]; }
function uint32BE(v){ return [(v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF]; }
function stringBytes(s){ return Array.from(s).map(c => c.charCodeAt(0)); }

function generateMidiBytes(prog, tempo){
  const division = 480; // ticks per quarter note -- 1 beat === 1 quarter note throughout this app, matching beatMs()
  const trackBytes = [];

  const microsPerQuarter = Math.round(60000000 / tempo);
  trackBytes.push(...writeVLQ(0), 0xFF, 0x51, 0x03, (microsPerQuarter >> 16) & 0xFF, (microsPerQuarter >> 8) & 0xFF, microsPerQuarter & 0xFF);

  const name = 'Frequency Target Replicator Export';
  trackBytes.push(...writeVLQ(0), 0xFF, 0x03, ...writeVLQ(name.length), ...stringBytes(name));

  let lastSection = undefined;
  // Respect Mute/Solo the same way playback does -- otherwise an export
  // would include chords the person deliberately silenced, or exclude
  // nothing when they soloed down to a specific section, silently
  // disagreeing with what they actually hear. Solo is scoped to each
  // chord's own stack (see isAnyPartOfStackSoloed, defined in drums.js
  // but safe to call here since this only ever runs after all scripts
  // have loaded, triggered by the Export MIDI click) -- soloing a lead
  // layer on one chord silences that chord's own note here too, since
  // it's part of the same stack, without touching any other chord.
  let pendingDelta = 0; // accumulated ticks from muted chords with no event of their own -- carried forward onto whatever the next real event is, rather than emitting a spurious placeholder message
  prog.forEach(entry => {
    if (entry.section !== lastSection) {
      lastSection = entry.section;
      if (entry.section) {
        trackBytes.push(...writeVLQ(pendingDelta), 0xFF, 0x06, ...writeVLQ(entry.section.length), ...stringBytes(entry.section));
        pendingDelta = 0;
      }
    }
    const durationTicks = (entry.beats || 4) * division;
    const anyStackSoloed = isAnyPartOfStackSoloed(entry);
    const chordAudible = (!anyStackSoloed || entry.solo) && !entry.muted;
    if (!chordAudible) {
      // Still advance the timeline by this chord's duration -- muting a
      // chord silences it, it doesn't delete it from the progression's
      // timing, so the rest of the export shouldn't shift earlier. No
      // event is emitted for it at all; the skipped time is simply added
      // to whatever the next real event's delta-time turns out to be.
      pendingDelta += durationTicks;
      return;
    }
    const shape = lookupEntryShape(entry);
    // Real voicing when we have one -- falls back to just the root note
    // alone if this exact chord has no diagram available, rather than
    // silently dropping the chord from the export entirely.
    const notes = shape
      ? shape.frets.map((f, i) => f === -1 ? null : (OPEN_STRING_MIDI[i] + (f > 0 ? shape.baseFret + f - 1 : 0))).filter(n => n !== null)
      : [60 + entry.rootIndex - 0]; // root note in a reasonable octave, computed relative to middle C's pitch class (C=0)

    notes.forEach((note, i) => { trackBytes.push(...writeVLQ(i === 0 ? pendingDelta : 0), 0x90, note, 90); });
    pendingDelta = 0;
    notes.forEach((note, i) => { trackBytes.push(...writeVLQ(i === 0 ? durationTicks : 0), 0x80, note, 64); });
  });

  trackBytes.push(...writeVLQ(pendingDelta), 0xFF, 0x2F, 0x00); // carries any trailing muted-chord time through, so total length still reflects the full progression even if it ends on a muted stretch

  const header = [...stringBytes('MThd'), ...uint32BE(6), ...uint16BE(0), ...uint16BE(1), ...uint16BE(division)];
  const track = [...stringBytes('MTrk'), ...uint32BE(trackBytes.length), ...trackBytes];
  return new Uint8Array([...header, ...track]);
}

const exportMidiBtn = document.getElementById('exportMidiBtn');
exportMidiBtn.addEventListener('click', () => {
  if (progression.length === 0) {
    window.alert('Your progression is empty -- add some chords first.');
    return;
  }
  const tempo = parseInt(tempoInput.value, 10) || 90;
  const bytes = generateMidiBytes(progression, tempo);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'frequency-target-replicator-progression.mid';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

const ALL_MODE_BTNS = [modeTuneBtn, modeChordBtn, modeChartBtn, modeLeadBtn, modeDrumsBtn];
const ALL_MODE_PANELS = [tuneModeEl, chordModeEl, chartModeEl, leadModeEl, drumsModeEl];

// Tone/Arpeggiate picker only makes sense where something actually gets
// played: Tune uses Tone (single reference notes) but never chords, so
// Arpeggiate has nothing to do there; Chord ID doesn't play anything at all.
const tonePickerEl = document.querySelector('.tone-picker');
const arpeggiateLabel = document.getElementById('strumPatternSelect').closest('label');
function updatePickerVisibility(activePanel){
  tonePickerEl.style.display = (activePanel === chordModeEl || activePanel === leadModeEl || activePanel === drumsModeEl) ? 'none' : '';
  arpeggiateLabel.style.display = (activePanel === chartModeEl) ? '' : 'none';
}

let currentActiveMode = 'tune'; // 'tune' | 'chord' | 'chart' | 'lead' | 'drums' -- tracked for keyboard shortcuts

function switchToMode(activeBtn, activePanel){
  ALL_MODE_BTNS.forEach(b => b.classList.toggle('active', b === activeBtn));
  ALL_MODE_PANELS.forEach(p => { p.style.display = (p === activePanel) ? '' : 'none'; });
  updatePickerVisibility(activePanel);
  stopChordCapture();
  if (window.__tunerStop) window.__tunerStop();
  currentActiveMode = activePanel === tuneModeEl ? 'tune' : activePanel === chordModeEl ? 'chord' : activePanel === chartModeEl ? 'chart' : activePanel === leadModeEl ? 'lead' : 'drums';
}

function showTuneMode(){
  switchToMode(modeTuneBtn, tuneModeEl);
}
function showChordMode(){
  switchToMode(modeChordBtn, chordModeEl);
  ensureModelLoaded().catch(() => {}); // pre-warm the model as soon as this mode is opened
  ensureChordsDbLoaded().catch(() => {}); // pre-warm the chord diagram database too
}
function showChartMode(){
  switchToMode(modeChartBtn, chartModeEl);
  ensureChordsDbLoaded().then(renderChartGroups).catch(() => {});
  const usedDrumKits = new Set(progression.filter(en => en.drumPattern).map(en => en.drumPattern.kit));
  usedDrumKits.forEach(k => ensureDrumSamplesLoaded(getChartToneCtx(), k).catch(() => {})); // only load kits actually in use by this progression's drum patterns, not every possible sample-backed kit
}
function showLeadMode(){
  switchToMode(modeLeadBtn, leadModeEl);
  renderLeadEditor();
}
function showDrumsMode(){
  switchToMode(modeDrumsBtn, drumsModeEl);
  renderDrumEditor();
  ensureDrumSamplesLoaded(getChartToneCtx(), drumKit).catch(() => {}); // only load the currently-selected kit, not every possible sample-backed kit
}

modeTuneBtn.addEventListener('click', showTuneMode);
modeChordBtn.addEventListener('click', showChordMode);
modeChartBtn.addEventListener('click', showChartMode);
modeLeadBtn.addEventListener('click', showLeadMode);
modeDrumsBtn.addEventListener('click', showDrumsMode);

// ---- Shared "unsaved changes" tracker for the Lead and Drums grid
// editors -- reused as-is by both, so the same reasoning and the same
// edge-case handling applies to each rather than being reimplemented
// twice. Tracks position in the undo/redo timeline relative to a known-
// saved reference point, rather than raw undo-stack length: the stack
// has a max size and silently evicts old entries once full, so length
// alone would misreport "clean" if an edit happens to land exactly back
// at the cap after saving there. A plain incrementing counter for edits
// (and matching decrement/increment for undo/redo) has no such blind
// spot, since it's completely independent of how much history storage
// still remembers.
function createUnsavedChangesTracker(saveButtonIds){
  let position = 0;
  let savedPosition = 0;
  let everSaved = false; // distinguishes "never touched yet" (neutral) from "clean because it was just saved" (green) -- both have position === savedPosition, but should look different
  function apply(){
    const dirty = position !== savedPosition;
    saveButtonIds.forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle('save-btn-dirty', dirty);
      btn.classList.toggle('save-btn-clean', !dirty && everSaved);
    });
  }
  return {
    onEdit(){ position++; apply(); },
    onUndo(){ position--; apply(); },
    onRedo(){ position++; apply(); },
    // Forces a dirty state regardless of the current position -- for
    // actions (Clear Grid, a time-signature resize) that genuinely
    // change the content away from whatever's saved, even though they
    // reset the undo stack directly rather than going through it.
    markDirty(){ position = savedPosition + 1; apply(); },
    // Marks the current position as the new saved reference point --
    // used both by the actual Save action, and by loading a different
    // existing (already-saved) pattern for editing, since that content
    // exactly matches what's saved and should read as clean, not dirty.
    markClean(){ savedPosition = position; everSaved = true; apply(); },
  };
}
