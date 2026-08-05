// ---- Chart mode: diatonic 7-chord tables for all 7 modes of the major scale ----
// intervals: semitone offsets of each scale degree from the tonic
// qualities: chord quality built on that degree ('maj' | 'min' | 'dim')
// labels: the roman-numeral text to display (matches standard modal-harmony notation)
const MODES_TABLE = {
  Ionian:     { intervals:[0,2,4,5,7,9,11], qualities:['maj','min','min','maj','maj','min','dim'], labels:['I','ii','iii','IV','V','vi','vii°'] },
  Dorian:     { intervals:[0,2,3,5,7,9,10], qualities:['min','min','maj','maj','min','dim','maj'], labels:['i','ii','bIII','IV','v','vi°','bVII'] },
  Phrygian:   { intervals:[0,1,3,5,7,8,10], qualities:['min','maj','maj','min','dim','maj','min'], labels:['i','bII','bIII','iv','v°','bVI','bvii'] },
  Lydian:     { intervals:[0,2,4,6,7,9,11], qualities:['maj','maj','min','dim','maj','min','min'], labels:['I','II','iii','#iv°','V','vi','vii'] },
  Mixolydian: { intervals:[0,2,4,5,7,9,10], qualities:['maj','min','dim','maj','min','min','maj'], labels:['I','ii','iii°','IV','v','vi','bVII'] },
  Aeolian:    { intervals:[0,2,3,5,7,8,10], qualities:['min','dim','maj','min','min','maj','maj'], labels:['i','ii°','bIII','iv','v','bVI','bVII'] },
  Locrian:    { intervals:[0,1,3,5,6,8,10], qualities:['dim','maj','min','min','maj','maj','min'], labels:['i°','bII','biii','iv','bV','bVI','bvii'] },
  'Harmonic Minor': { intervals:[0,2,3,5,7,8,11], qualities:['min','dim','aug','min','maj','maj','dim'], labels:['i','ii°','bIII+','iv','V','bVI','vii°'] },
  'Melodic Minor':  { intervals:[0,2,3,5,7,9,11], qualities:['min','min','aug','maj','maj','dim','dim'], labels:['i','ii','bIII+','IV','V','vi°','vii°'] },
};
const QUALITY_TO_SUFFIX = { maj: '', min: 'm', dim: 'dim', aug: 'aug' };

// Harmonic function by scale-degree index -- Tonic (stable/"home"),
// Subdominant (movement away from home), Dominant (tension wanting to
// resolve back). This is about each degree's relationship to the tonic in
// the circle of fifths, which holds true regardless of which mode you're
// in or whether a given degree happens to be major/minor/diminished --
// degree ii is always subdominant-family, degree V is always
// dominant-family, in every mode.
// Traditional per-degree name (Supertonic, Mediant, Submediant, Leading
// Tone, etc.) -- more precise than a 3-way grouping, and standard music
// theory terminology. FUNCTION_COLOR_FAMILY below still groups these into
// the same 3 functional families (tonic/subdominant/dominant) purely for
// the badge's color, so the visual grouping from before is preserved
// alongside the more specific name.
const DEGREE_NAME = ['Tonic','Supertonic','Mediant','Subdominant','Dominant','Submediant','Leading Tone'];

// Short, practical explanations for the "explain this chord" popup. Phrased
// generically (no "major"/"minor" specifics) since the same structural role
// holds true regardless of which mode gives this degree its actual quality.
const DEGREE_EXPLANATION = [
  "The \u201chome\u201d chord \u2014 stable and resolved. Progressions often start and end here.",
  "Frequently moves toward the Dominant, especially as part of a ii\u2013V\u2013I motion.",
  "Shares two notes with the tonic, so it can substitute for it or add a different color in its place.",
  "Creates a sense of moving away from home. Commonly leads to the Dominant, or back to the Tonic directly.",
  "The strongest pull back to the Tonic \u2014 full of tension that wants to resolve.",
  "Tonic-family color chord, often used for a \u201cdeceptive\u201d resolution instead of the expected Tonic.",
  "Sits a half-step below the tonic, naturally pulling upward into it. Often replaced by a dominant 7th chord in practice.",
];
const SECONDARY_DOMINANT_EXPLANATION = "Temporarily borrows the \u201cV of X\u201d relationship to create a stronger pull toward a specific chord, without actually changing key.";
const BORROWED_CHORD_EXPLANATION = "Brought in from the parallel mode with the opposite major/minor character \u2014 adds color and variety without changing the key you're in.";
const FUNCTION_COLOR_FAMILY = ['tonic','subdominant','tonic','subdominant','dominant','tonic','dominant'];
const MODE_NAMES = Object.keys(MODES_TABLE);

// Well-known progressions, defined as scale-degree indices (0 = degree 1,
// 4 = degree 5, etc.) rather than fixed chord names -- this is what lets the
// SAME progression resolve correctly against whichever mode is active. The
// classic "I-V-vi-IV" pop progression in Ionian becomes a genuinely
// different, mode-appropriate set of chords if loaded while Dorian or
// Mixolydian is selected instead, since the quality at each degree comes
// straight from MODES_TABLE. Each entry also carries a "style" category,
// used to split the single dropdown into a Style -> Pattern pair below.
const POPULAR_PROGRESSIONS = [
  { name: 'Pop Progression (I-V-vi-IV)', style: 'Pop', defaultMode: 'Ionian', degrees: [0,4,5,3] },
  { name: '50s Progression (I-vi-IV-V)', style: 'Pop', defaultMode: 'Ionian', degrees: [0,5,3,4] },
  { name: 'Minor Pop (vi-IV-I-V)', style: 'Pop', defaultMode: 'Ionian', degrees: [5,3,0,4] },
  { name: 'Simple Pop (I-ii-IV-I)', style: 'Pop', defaultMode: 'Ionian', degrees: [0,1,3,0] },

  { name: 'Minor Rock (i-bVII-bVI-bVII)', style: 'Rock', defaultMode: 'Aeolian', degrees: [0,6,5,6] },
  { name: 'Mixolydian Rock (I-bVII-IV)', style: 'Rock', defaultMode: 'Mixolydian', degrees: [0,6,3] },
  { name: 'La Bamba (I-IV-V-IV)', style: 'Rock', defaultMode: 'Ionian', degrees: [0,3,4,3] },
  { name: 'Rock Anthem (I-V-IV-I)', style: 'Rock', defaultMode: 'Ionian', degrees: [0,4,3,0] },

  { name: 'Three-Chord Blues (I-IV-V)', style: 'Blues', defaultMode: 'Ionian', degrees: [0,3,4] },
  { name: '12-Bar Blues', style: 'Blues', defaultMode: 'Ionian', degrees: [0,0,0,0,3,3,0,0,4,3,0,0] },
  { name: 'Extended Blues Turnaround', style: 'Blues', defaultMode: 'Ionian', degrees: [0,3,0,4,3,0] },

  { name: 'Jazz Turnaround (ii-V-I)', style: 'Jazz', defaultMode: 'Ionian', degrees: [1,4,0] },
  { name: 'Circle Progression (vi-ii-V-I)', style: 'Jazz', defaultMode: 'Ionian', degrees: [5,1,4,0] },
  { name: 'Ragtime Turnaround (I-vi-ii-V)', style: 'Jazz', defaultMode: 'Ionian', degrees: [0,5,1,4] },
  { name: 'Descending Fifths (full circle)', style: 'Jazz', defaultMode: 'Ionian', degrees: [0,3,6,2,5,1,4,0] },

  { name: 'Simple Folk (I-IV-I-V)', style: 'Folk', defaultMode: 'Ionian', degrees: [0,3,0,4] },
  { name: 'Andalusian Cadence', style: 'Folk', defaultMode: 'Aeolian', degrees: [0,6,5,4] },

  { name: 'Canon Progression', style: 'Classical', defaultMode: 'Ionian', degrees: [0,4,5,2,3,0,3,4] },

  { name: 'Minor Ballad (i-VI-III-VII)', style: 'Ballad', defaultMode: 'Aeolian', degrees: [0,5,2,6] },

  { name: 'Latin Minor Vamp (i-iv-v-i)', style: 'Latin', defaultMode: 'Aeolian', degrees: [0,3,4,0] },
  { name: 'Bolero (I-vi-ii-V-I)', style: 'Latin', defaultMode: 'Ionian', degrees: [0,5,1,4,0] },
  { name: 'Latin Pop (I-IV-vi-V)', style: 'Latin', defaultMode: 'Ionian', degrees: [0,3,5,4] },

  { name: 'One Drop (I-V)', style: 'Reggae', defaultMode: 'Ionian', degrees: [0,4] },
  { name: 'Reggae Skank (I-IV-I-IV-V)', style: 'Reggae', defaultMode: 'Ionian', degrees: [0,3,0,3,4] },
  { name: 'Minor Roots (i-iv-bVII)', style: 'Reggae', defaultMode: 'Aeolian', degrees: [0,3,6] },

  { name: 'Phrygian Riff (i-bII)', style: 'Metal', defaultMode: 'Phrygian', degrees: [0,1] },
  { name: 'Metal Minor (i-VI-VII)', style: 'Metal', defaultMode: 'Aeolian', degrees: [0,5,6] },
  { name: 'Power Trio (i-iv-VI)', style: 'Metal', defaultMode: 'Aeolian', degrees: [0,3,5] },

  { name: 'Soul Vamp (ii-V)', style: 'R&B/Soul', defaultMode: 'Ionian', degrees: [1,4] },
  { name: 'R&B Turnaround (I-IV-ii-V)', style: 'R&B/Soul', defaultMode: 'Ionian', degrees: [0,3,1,4] },
  { name: 'Neo-Soul (I-iii-vi-IV)', style: 'R&B/Soul', defaultMode: 'Ionian', degrees: [0,2,5,3] },
];

const PROGRESSION_STYLES = [...new Set(POPULAR_PROGRESSIONS.map(p => p.style))];

const progressionStyleSelect = document.getElementById('progressionStyleSelect');
const popularProgressionSelect = document.getElementById('popularProgressionSelect');
const loadProgressionBtn = document.getElementById('loadProgressionBtn');

PROGRESSION_STYLES.forEach(style => {
  const opt = document.createElement('option');
  opt.value = style;
  opt.textContent = style;
  progressionStyleSelect.appendChild(opt);
});

function populatePatternsForStyle(style){
  popularProgressionSelect.innerHTML = '';
  POPULAR_PROGRESSIONS.forEach((p, i) => {
    if (p.style !== style) return;
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    popularProgressionSelect.appendChild(opt);
  });
}
populatePatternsForStyle(PROGRESSION_STYLES[0]);
progressionStyleSelect.addEventListener('change', () => populatePatternsForStyle(progressionStyleSelect.value));

// Tracks which preset (if any) currently populated the tray, so changing the
// key or toggling a mode can automatically re-resolve the SAME preset against
// the new context -- no need to re-click Load every time while exploring.
// Cleared the moment the user manually edits the tray (add/remove/clear),
// since at that point it's their own custom progression, not the preset
// anymore, and shouldn't get silently overwritten by a later key change.
let activePresetIndex = null;

function resolvePresetIntoTray(presetIndex){
  const preset = POPULAR_PROGRESSIONS[presetIndex];
  if (!preset) return;
  const tonicIndex = parseInt(chartKeySelect.value, 10);
  // Use this progression's own intended mode if it's currently active --
  // NOT just "whichever mode happened to be selected first". A "Minor
  // Ballad" needs a minor tonic; if Aeolian is active but isn't first in
  // the list, activeModes[0] alone would silently resolve it against a
  // major mode instead, flipping every chord's quality without anything
  // about it looking wrong in the UI.
  const modeName = (preset.defaultMode && activeModes.includes(preset.defaultMode))
    ? preset.defaultMode
    : (activeModes[0] || preset.defaultMode || 'Ionian');
  const modeData = MODES_TABLE[modeName];

  const newProgression = preset.degrees.map(degreeIdx => {
    const rootIndex = (tonicIndex + modeData.intervals[degreeIdx]) % 12;
    const quality = modeData.qualities[degreeIdx];
    const suffix = QUALITY_TO_SUFFIX[quality];
    const label = modeData.labels[degreeIdx];
    return {
      chordName: NOTE_NAMES[rootIndex] + suffix,
      label, modeName, rootIndex, suffix,
      beats: beatsPerBar, strumPattern: 'block'
    };
  });

  setProgression(newProgression, { keepPreset: true });
}

function applyActivePresetIfAny(){
  if (activePresetIndex !== null) resolvePresetIntoTray(activePresetIndex);
}

loadProgressionBtn.addEventListener('click', () => {
  const idx = popularProgressionSelect.value;
  if (idx === '') return;
  const presetIndex = parseInt(idx, 10);
  const preset = POPULAR_PROGRESSIONS[presetIndex];
  if (!preset) return;

  if (progression.length > 0 && activePresetIndex === null) {
    // only warn when replacing genuinely custom work -- re-loading while a
    // preset is already active isn't a surprising/destructive action
    const ok = window.confirm('Loading "' + preset.name + '" will replace your current progression. Continue?');
    if (!ok) return;
  }

  activePresetIndex = presetIndex;
  resolvePresetIntoTray(presetIndex);
});

ROOT_TO_DB_KEY.forEach((_, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = NOTE_NAMES[i];
  chartKeySelect.appendChild(opt);
});
chartKeySelect.value = 9; // default to A, a friendly starting key

// ---- click-to-play for chart cards -- same triangle-wave approach as the
// tuner's string reference tones (not square wave, despite the resemblance --
// triangle has cleaner harmonics and was already tuned for phone-speaker
// audibility on the low strings; reused here for consistency, and now
// selectable via the global Tone picker). ----
const OPEN_STRING_FREQS = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63]; // low E to high E
function getChartToneCtx(){
  return window.__getSharedToneCtx();
}

// Scale preview -- plays a mode's raw ascending scale (tonic to octave), not
// a chord. Deliberately a separate control on the mode-column header, not
// tied to any chord card, specifically so it never fires from browsing or
// swapping mods -- that's the whole reason it lives up here instead of
// being attached to chord clicks.
// Bass line, Stage A: plays whatever note is ALREADY the bass note of the
// current voicing (same getBassPitchClass used for the "X in Bass" label),
// at a real low register clearly separate from the chord itself -- offset
// of -36 semitones verified to land exactly on real octave-1 frequencies
// (C1=32.70Hz, E1=41.20Hz, etc.) before being used here.
function bassNoteFreq(pitchClass){
  const totalSemitoneFromA4 = (pitchClass - 9) - 36;
  return 440 * Math.pow(2, totalSemitoneFromA4 / 12);
}
// Mirror of bassNoteFreq -- offset of +12 verified to land exactly on real
// octave-5 frequencies (C5=523.25Hz, E5=659.26Hz, etc.), a bright, sparkly
// register clearly above the chord itself, for the top-note doubling.
function topNoteFreq(pitchClass){
  const totalSemitoneFromA4 = (pitchClass - 9) + 12;
  return 440 * Math.pow(2, totalSemitoneFromA4 / 12);
}
function playBassTone(ctx, pitchClass, startAt, duration, volumeMultOverride){
  const freq = bassNoteFreq(pitchClass);
  const toneType = 'synthbass'; // fixed default now that the dedicated bass-sound selector is gone -- this only powers the chord-card hover preview
  const isInstrument = window.__toneEngine.isInstrument(toneType);
  const volumeMult = volumeMultOverride !== undefined ? volumeMultOverride : 1.0;
  if (isInstrument) {
    window.__toneEngine.playNote(ctx, toneType, freq, startAt, 0.4 * volumeMult, duration);
  } else {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = toneType;
    osc.frequency.value = freq;
    const peakGain = 0.32 * volumeMult;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.02);
    gain.gain.linearRampToValueAtTime(peakGain, startAt + duration - 0.08);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
    osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
    osc.start(startAt); osc.stop(startAt + duration + 0.05);
  }
}
// Mirror of playBassTone for the top note -- slightly lower gain (0.28 vs
// 0.32) since a high, bright note tends to read as louder than a low one
// at the same amplitude, and it's meant to add sparkle, not dominate.
function playTopNoteTone(ctx, pitchClass, startAt, duration, volumeMultOverride){
  const freq = topNoteFreq(pitchClass);
  const toneType = window.__toneType || 'triangle';
  const isInstrument = window.__toneEngine.isInstrument(toneType);
  const volumeMult = volumeMultOverride !== undefined ? volumeMultOverride : 1.0;
  if (isInstrument) {
    window.__toneEngine.playNote(ctx, toneType, freq, startAt, 0.32 * volumeMult, duration);
  } else {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = toneType;
    osc.frequency.value = freq;
    const peakGain = 0.26 * volumeMult;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.02);
    gain.gain.linearRampToValueAtTime(peakGain, startAt + duration - 0.08);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
    osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
    osc.start(startAt); osc.stop(startAt + duration + 0.05);
  }
}

// Melody note playback -- uses the exact real fretboard frequency for the
// recorded string+fret (same formula used everywhere else in the app),
// not just a pitch class, since a melody is specific notes, not a general
// register like bass/top note.
const VELOCITY_GAIN_MULTIPLIER = { soft: 0.55, normal: 1.0, accent: 1.35 };
function playMelodyNoteTone(ctx, melodyNote, startAt, duration, toneTypeOverride, volumeMultOverride){
  const freq = OPEN_STRING_FREQS[melodyNote.stringIdx] * Math.pow(2, melodyNote.fret / 12);
  const toneType = toneTypeOverride || window.__toneType || 'triangle';
  const isInstrument = window.__toneEngine.isInstrument(toneType);
  const velocityMult = VELOCITY_GAIN_MULTIPLIER[melodyNote.velocity] || 1.0;
  const volumeMult = volumeMultOverride !== undefined ? volumeMultOverride : 1.0;
  const combinedMult = velocityMult * volumeMult;
  if (isInstrument) {
    window.__toneEngine.playNote(ctx, toneType, freq, startAt, 0.3 * combinedMult, duration);
  } else {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = toneType;
    osc.frequency.value = freq;
    const peakGain = 0.24 * combinedMult;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.02);
    gain.gain.linearRampToValueAtTime(peakGain, startAt + duration - 0.08);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
    osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
    osc.start(startAt); osc.stop(startAt + duration + 0.05);
  }
}

// Applies a custom hold-then-fade envelope on top of whatever
// instrument/tone is currently active, WITHOUT modifying any of the 10
// individually hand-tuned instrument envelope functions (each has its
// own fixed, short release -- rewriting all of them to support a
// variable fade fraction would be real surgery on carefully-tuned
// sounds, and risky). Instead: every voice-building function connects
// synchronously (no async/await in between) to whatever
// window.__getMasterBus(ctx) currently returns, which is just a cached
// node reference. So we temporarily swap that cached reference to a
// sub-bus we create and control, call the normal note-playing function
// (which connects to our sub-bus without knowing anything changed),
// restore the real reference immediately after, then apply our own gain
// automation on the sub-bus. holdFraction is the portion of the total
// duration spent at full volume before the fade begins (e.g. 0.5 = hold
// for the first half, fade over the second half).
function playNoteWithCustomFade(ctx, melodyNote, startAt, duration, toneTypeOverride, holdFraction, volumeMultOverride){
  const trueMasterBus = window.__getMasterBus(ctx); // ensures the real chain exists, returns the permanent node
  const subBus = ctx.createGain();
  subBus.gain.value = 1;
  subBus.connect(trueMasterBus);
  ctx.__masterBusInput = subBus; // temporary redirect -- safe only because the call below is fully synchronous
  playMelodyNoteTone(ctx, melodyNote, startAt, duration, toneTypeOverride, volumeMultOverride);
  ctx.__masterBusInput = trueMasterBus; // restored immediately, before any other voice could be affected

  const holdUntil = startAt + duration * holdFraction;
  subBus.gain.setValueAtTime(1, startAt);
  subBus.gain.setValueAtTime(1, holdUntil);
  subBus.gain.linearRampToValueAtTime(0, startAt + duration);
}

// Global preview Bass Notes toggle (near Tone/Arpeggiate) -- deliberately
// separate from the progression-playback Bass Notes toggle near Play/Stop.
// This one fires for any individual chord preview (chart cards, chips)
// regardless of whether that chord belongs to any section or even the
// progression at all.
function maybePlayPreviewBassNote(shape, duration){
  if (!previewBassNotesToggle.checked || !shape) return;
  const bassPitchClass = getBassPitchClass(shape);
  if (bassPitchClass === null) return;
  const ctx = getChartToneCtx();
  playBassTone(ctx, bassPitchClass, ctx.currentTime, duration);
}
// Mirror for the top note preview toggle. Independent of the bass toggle --
// both can be on at once for a wide spread, since they're just two
// separate function calls scheduling two separate, independent tones.
function maybePlayPreviewTopNote(shape, duration){
  if (!previewTopNoteToggle.checked || !shape) return;
  const topPitchClass = getTopPitchClass(shape);
  if (topPitchClass === null) return;
  const ctx = getChartToneCtx();
  playTopNoteTone(ctx, topPitchClass, ctx.currentTime, duration);
}

function playScalePreview(tonicIndex, modeName){
  const modeData = MODES_TABLE[modeName];
  const ctx = getChartToneCtx();
  const toneType = window.__toneType || 'triangle';
  const isInstrument = window.__toneEngine.isInstrument(toneType);
  const NOTE_DURATION = 0.32;
  const GAP = 0.04;

  // Lands the tonic around octave 3 -- a comfortable, guitar-appropriate
  // register, computed directly from equal temperament (A4 = 440Hz)
  // rather than tied to any particular string.
  function noteFreq(semitoneFromTonic){
    const totalSemitoneFromA4 = (tonicIndex - 9) + semitoneFromTonic - 12;
    return 440 * Math.pow(2, totalSemitoneFromA4 / 12);
  }

  const scaleSteps = [...modeData.intervals, 12]; // full ascending run, tonic to octave

  function scheduleNotes(){
    const now = ctx.currentTime;
    scaleSteps.forEach((interval, i) => {
      const freq = noteFreq(interval);
      const startAt = now + i * (NOTE_DURATION + GAP);
      if (isInstrument) {
        window.__toneEngine.playNote(ctx, toneType, freq, startAt, 0.35, NOTE_DURATION);
      } else {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = toneType;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(0.28, startAt + 0.02);
        gain.gain.linearRampToValueAtTime(0.28, startAt + NOTE_DURATION - 0.08);
        gain.gain.linearRampToValueAtTime(0, startAt + NOTE_DURATION);
        osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
        osc.start(startAt); osc.stop(startAt + NOTE_DURATION + 0.05);
      }
    });
  }

  if (toneType === 'piano' || toneType === 'brightpiano') {
    window.__toneEngine.ensurePianoLoaded(ctx).then(scheduleNotes);
  } else {
    scheduleNotes();
  }
}

// Scale-box fretboard diagram: the standard guitarist approach of finding
// where the tonic falls on the low E string and showing every scale tone
// within a 5-fret window from there. Reuses the exact same interval-color
// system as chord diagrams (getIntervalRole) so a scale's root/3rd/5th/etc.
// read the same way here as they do everywhere else in the app.
function computeScaleBox(tonicIndex, modeData){
  const startFret = (tonicIndex - STRING_PITCH_CLASS[0] + 12) % 12;
  const scaleSet = new Set(modeData.intervals.map(iv => (tonicIndex + iv) % 12));
  const dots = [];
  for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
    for (let fret = startFret; fret <= startFret + 4; fret++) {
      const pitchClass = (STRING_PITCH_CLASS[stringIdx] + fret) % 12;
      if (scaleSet.has(pitchClass)) {
        dots.push({ stringIdx, fret, pitchClass });
      }
    }
  }
  return { startFret, dots };
}

function renderScaleBoxSVG(tonicIndex, modeData){
  const { startFret, dots } = computeScaleBox(tonicIndex, modeData);
  const numStrings = 6;
  const numFretRows = 5;
  const width = 220, topPad = 26, leftPad = 18, rightPad = 18, bottomPad = 14;
  const gridWidth = width - leftPad - rightPad;
  const rowHeight = 34;
  const gridHeight = numFretRows * rowHeight;
  const height = topPad + gridHeight + bottomPad;
  const stringX = (i) => leftPad + (gridWidth / (numStrings - 1)) * i;
  const fretY = (row) => topPad + row * rowHeight;

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  for (let i = 0; i < numStrings; i++) {
    svg += `<line x1="${stringX(i)}" y1="${topPad}" x2="${stringX(i)}" y2="${topPad + gridHeight}" stroke="var(--amber-dim)" stroke-width="1.5" />`;
  }
  for (let row = 0; row <= numFretRows; row++) {
    const isNut = row === 0 && startFret === 0;
    svg += `<line x1="${leftPad}" y1="${fretY(row)}" x2="${leftPad + gridWidth}" y2="${fretY(row)}" stroke="var(--amber-dim)" stroke-width="${isNut ? 3 : 1.5}" />`;
  }
  if (startFret > 0) {
    svg += `<text x="${leftPad - 10}" y="${fretY(0) + rowHeight * 0.65}" font-size="12" font-weight="700" fill="var(--amber)" text-anchor="end" font-family="JetBrains Mono, monospace">${startFret}fr</text>`;
  }
  dots.forEach(d => {
    const x = stringX(d.stringIdx);
    const row = d.fret - startFret;
    const y = fretY(row) + rowHeight / 2;
    const role = getIntervalRole((d.pitchClass - tonicIndex + 12) % 12);
    svg += `<circle cx="${x}" cy="${y}" r="8" fill="${role.color}"><title>${role.fullName}</title></circle>`;
    svg += `<text x="${x}" y="${y + 3}" font-size="8" fill="#1a1408" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="700">${role.name}</text>`;
  });
  svg += '</svg>';
  return svg;
}

// ---- Live "safe notes" fretboard -- shows every occurrence of a chord's
// actual tones across the whole practical neck (frets 0-12), not just one
// voicing's own fret positions. Extracts the pitch classes a real voicing
// actually plays (so it uses real chords-db data, not a separate chord-
// theory table), then maps those same pitch classes everywhere they occur.
// Verified against a real Am7 voicing before being used here -- caught and
// fixed a mistake in my own hand-typed test shape along the way, which is
// exactly why this got checked against the real data instead of trusted
// on sight.
// Renders one specific chord voicing's actual notes as small, interactive
// dots (one per string, keyed by string index since a voicing has at most
// one note per string) -- different from the full-neck scale view, since
// a real chord shape only occupies a handful of specific positions.
// Positioning matches the verified convention from renderChordDiagramSVG
// exactly (open strings as a ring above the nut, fretted notes centered
// in their row via fretY(row-1) + rowHeight/2) -- reused rather than
// re-derived, since that convention was already hand-verified against
// real chords-db data earlier in this build.
function renderArpChordSelectorSVG(shape, rootIndex, selectedSet){
  const numStrings = 6;
  const maxRel = Math.max(4, ...shape.frets.filter(f => f > 0));
  const numFretRows = maxRel;
  const width = 220, topPad = 26, leftPad = 18, rightPad = 18, bottomPad = 14;
  const gridWidth = width - leftPad - rightPad;
  const rowHeight = 34;
  const gridHeight = numFretRows * rowHeight;
  const height = topPad + gridHeight + bottomPad;
  const stringX = (i) => leftPad + (gridWidth / (numStrings - 1)) * i;
  const fretY = (row) => topPad + row * rowHeight;

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
  for (let i = 0; i < numStrings; i++) {
    svg += `<line x1="${stringX(i)}" y1="${topPad}" x2="${stringX(i)}" y2="${topPad + gridHeight}" stroke="var(--amber-dim)" stroke-width="1.5" />`;
  }
  for (let row = 0; row <= numFretRows; row++) {
    const isNut = row === 0 && shape.baseFret === 1;
    svg += `<line x1="${leftPad}" y1="${fretY(row)}" x2="${leftPad + gridWidth}" y2="${fretY(row)}" stroke="var(--amber-dim)" stroke-width="${isNut ? 3 : 1.5}" />`;
  }
  if (shape.baseFret > 1) {
    svg += `<text x="${leftPad - 10}" y="${fretY(0) + rowHeight * 0.65}" font-size="12" font-weight="700" fill="var(--amber)" text-anchor="end" font-family="JetBrains Mono, monospace">${shape.baseFret}fr</text>`;
  }
  shape.frets.forEach((f, i) => {
    if (f === -1) return; // muted string, no note here to select
    const x = stringX(i);
    const absoluteFret = f > 0 ? shape.baseFret + f - 1 : 0;
    const pitchClass = (STRING_PITCH_CLASS[i] + absoluteFret) % 12;
    const role = getIntervalRole((pitchClass - rootIndex + 12) % 12);
    const isSelected = selectedSet.has(i);
    const y = f === 0 ? topPad - 13 : fretY(f - 1) + rowHeight / 2;
    const r = f === 0 ? 8 : 9;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${isSelected ? role.color : '#2a2a2a'}" class="arp-note-dot" data-string="${i}" style="cursor:pointer;" stroke="${isSelected ? '#fff' : 'var(--amber-dim)'}" stroke-width="${isSelected ? 2 : 1}"><title>${role.fullName}</title></circle>`;
    svg += `<text x="${x}" y="${y + 3.5}" font-size="9" fill="${isSelected ? 'rgba(0,0,0,0.55)' : 'var(--fg)'}" text-anchor="middle" font-family="JetBrains Mono, monospace" pointer-events="none">${NOTE_NAMES[pitchClass]}</text>`;
  });
  svg += '</svg>';
  return svg;
}

// Renders a 2-octave piano keyboard, highlighting and labeling any key
// whose pitch class is in pitchClasses. Reuses getIntervalRole for
// coloring, same system already used for fretboard dots, so a chord
// tone reads the same color whether you're looking at the neck or the
// keyboard. Geometry (which white key positions have a black key
// following them) verified numerically before writing this -- no black
// key after E or B, matching a real keyboard.
const PIANO_WHITE_KEY_PATTERN = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B pitch classes
const PIANO_WHITE_KEY_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const PIANO_BLACK_AFTER_WHITE = [true, true, false, true, true, true, false];
const PIANO_BLACK_KEY_NAMES = { 0: 'C#', 2: 'D#', 5: 'F#', 7: 'G#', 9: 'A#' }; // keyed by the white key's pitch class it follows
function renderPianoKeyboardSVG(pitchClasses, rootIndex, options){
  const opts = options || {};
  const numOctaves = opts.numOctaves || 2;
  const scale = opts.scale || 1;
  const NUM_WHITE_KEYS = numOctaves * 7;
  const whiteKeyWidth = 30 * scale, whiteKeyHeight = 100 * scale;
  const blackKeyWidth = 18 * scale, blackKeyHeight = 62 * scale;
  const width = NUM_WHITE_KEYS * whiteKeyWidth;
  const height = whiteKeyHeight;

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

  // White keys first (drawn under the black keys)
  const whiteKeyInfo = [];
  for (let i = 0; i < NUM_WHITE_KEYS; i++) {
    const posInOctave = i % 7;
    const pitchClass = PIANO_WHITE_KEY_PATTERN[posInOctave];
    const name = PIANO_WHITE_KEY_NAMES[posInOctave];
    const x = i * whiteKeyWidth;
    const isHighlighted = pitchClasses.has(pitchClass);
    const role = isHighlighted ? getIntervalRole((pitchClass - rootIndex + 12) % 12) : null;
    whiteKeyInfo.push({ x, pitchClass, name, isHighlighted, role });
    svg += `<rect x="${x}" y="0" width="${whiteKeyWidth}" height="${whiteKeyHeight}" fill="${isHighlighted ? role.color : '#f0ede4'}" stroke="#1a1a1a" stroke-width="1" />`;
    if (isHighlighted && scale >= 0.5) { // labels get unreadably small below this scale -- omit rather than render illegible text
      svg += `<text x="${x + whiteKeyWidth / 2}" y="${whiteKeyHeight - 10 * scale}" font-size="${11 * scale}" font-weight="700" fill="#1a1a1a" text-anchor="middle" font-family="JetBrains Mono, monospace" pointer-events="none">${name}</text>`;
    }
  }

  // Black keys on top
  for (let i = 0; i < NUM_WHITE_KEYS; i++) {
    const posInOctave = i % 7;
    if (!PIANO_BLACK_AFTER_WHITE[posInOctave] || i >= NUM_WHITE_KEYS - 1) continue;
    const whitePitchClass = PIANO_WHITE_KEY_PATTERN[posInOctave];
    const blackPitchClass = (whitePitchClass + 1) % 12;
    const blackName = PIANO_BLACK_KEY_NAMES[whitePitchClass];
    const blackX = (i + 1) * whiteKeyWidth - blackKeyWidth / 2;
    const isHighlighted = pitchClasses.has(blackPitchClass);
    const role = isHighlighted ? getIntervalRole((blackPitchClass - rootIndex + 12) % 12) : null;
    svg += `<rect x="${blackX}" y="0" width="${blackKeyWidth}" height="${blackKeyHeight}" fill="${isHighlighted ? role.color : '#1a1a1a'}" stroke="#000" stroke-width="1" />`;
    if (isHighlighted && scale >= 0.5) {
      svg += `<text x="${blackX + blackKeyWidth / 2}" y="${blackKeyHeight - 8 * scale}" font-size="${9 * scale}" font-weight="700" fill="#1a1a1a" text-anchor="middle" font-family="JetBrains Mono, monospace" pointer-events="none">${blackName}</text>`;
    }
  }

  svg += '</svg>';
  return svg;
}

// Updates the always-visible Chart-tab piano panel to reflect whichever
// chord is currently active -- called from the same places
// updateFretboardPanel already is (chip click/preview and progression
// playback), so both stay in sync with zero new trigger logic needed.
function updateChartPianoPanel(shape, chordName, rootIndex){
  const chartPianoDiagram = document.getElementById('chartPianoDiagram');
  const chartPianoLabel = document.getElementById('chartPianoLabel');
  if (!shape) return;
  const pitchClasses = getChordTonePitchClasses(shape);
  chartPianoLabel.textContent = chordName ? chordName + ' on piano' : 'Piano';
  chartPianoDiagram.innerHTML = renderPianoKeyboardSVG(pitchClasses, rootIndex);
}

function getChordTonePitchClasses(shape){
  const pitchClasses = new Set();
  shape.frets.forEach((f, i) => {
    if (f === -1) return;
    const absoluteFret = f > 0 ? shape.baseFret + f - 1 : 0;
    pitchClasses.add((STRING_PITCH_CLASS[i] + absoluteFret) % 12);
  });
  return pitchClasses;
}
function computeChordToneMap(pitchClasses, startFret, endFret){
  const dots = [];
  for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
    for (let fret = startFret; fret <= endFret; fret++) {
      const pc = (STRING_PITCH_CLASS[stringIdx] + fret) % 12;
      if (pitchClasses.has(pc)) dots.push({ stringIdx, fret, pitchClass: pc });
    }
  }
  return dots;
}
// Horizontal layout (frets left-to-right, strings top-to-bottom) -- more
// natural for a whole-neck view than the vertical card-diagram style,
// which only ever needed to show a small 5-fret window.
function renderChordToneMapSVG(pitchClasses, rootIndex, leadNotes, numFrets, scale, blueNotePitchClass, selectedNotes){
  numFrets = numFrets || 12;
  scale = scale || 1;
  const dots = computeChordToneMap(pitchClasses, 0, numFrets);
  const numStrings = 6;
  const leftPad = 30 * scale, rightPad = 14 * scale, topPad = 20 * scale, bottomPad = 20 * scale;
  const colWidth = 32 * scale, rowHeight = 25 * scale; // ~5% smaller than the original 34/26 baseline
  const dotRadius = 7 * scale;
  const gridWidth = numFrets * colWidth;
  const gridHeight = (numStrings - 1) * rowHeight;
  const width = leftPad + gridWidth + rightPad;
  const height = topPad + gridHeight + bottomPad;
  const stringY = (i) => topPad + (numStrings - 1 - i) * rowHeight; // low E at bottom, high E at top
  const fretX = (fret) => leftPad + fret * colWidth;

  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">`;
  for (let i = 0; i < numStrings; i++) {
    svg += `<line x1="${leftPad}" y1="${stringY(i)}" x2="${leftPad + gridWidth}" y2="${stringY(i)}" stroke="var(--amber-dim)" stroke-width="1.5" />`;
  }
  for (let fret = 0; fret <= numFrets; fret++) {
    svg += `<line x1="${fretX(fret)}" y1="${topPad}" x2="${fretX(fret)}" y2="${topPad + gridHeight}" stroke="var(--amber-dim)" stroke-width="${fret === 0 ? 3 : 1}" />`;
  }
  [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].filter(fret => fret <= numFrets).forEach(fret => {
    svg += `<text x="${(fretX(fret - 1) + fretX(fret)) / 2}" y="${topPad - 6}" font-size="${9 * scale}" fill="var(--fg)" opacity="0.5" text-anchor="middle" font-family="JetBrains Mono, monospace">${fret}</text>`;
  });
  dots.forEach(d => {
    const x = d.fret === 0 ? fretX(0) - 12 * scale : (fretX(d.fret - 1) + fretX(d.fret)) / 2;
    const y = stringY(d.stringIdx);
    const isBlueNote = blueNotePitchClass !== null && blueNotePitchClass !== undefined && d.pitchClass === blueNotePitchClass;
    const role = isBlueNote ? { name: 'BN', fullName: 'Blue Note' } : getIntervalRole((d.pitchClass - rootIndex + 12) % 12);
    const dotColor = isBlueNote ? BLUE_NOTE_COLOR : role.color;
    const leadOrder = (leadNotes || []).findIndex(n => n.stringIdx === d.stringIdx && n.fret === d.fret);
    const isRecorded = leadOrder !== -1;
    svg += `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="${dotColor}" class="fretboard-tone-dot" data-string="${d.stringIdx}" data-fret="${d.fret}" style="cursor:pointer;" stroke="${isRecorded ? '#fff' : 'none'}" stroke-width="${isRecorded ? 2.5 : 0}"><title>${role.fullName}</title></circle>`;
    svg += `<text x="${x}" y="${y + 3 * scale}" font-size="${7 * scale}" fill="rgba(0,0,0,0.55)" text-anchor="middle" font-family="JetBrains Mono, monospace" pointer-events="none">${NOTE_NAMES[d.pitchClass]}</text>`;
    if (isRecorded) {
      svg += `<text x="${x}" y="${y - 11 * scale}" font-size="${9 * scale}" font-weight="700" fill="#fff" text-anchor="middle" font-family="JetBrains Mono, monospace">${leadOrder + 1}</text>`;
    }
  });
  // Fallback pass: a lead note recorded against a DIFFERENT chord/voicing
  // than what's currently showing might not be one of the current chord's
  // tones -- computeChordToneMap wouldn't have generated a dot for it at
  // all, which is exactly how a recorded note could go invisible and
  // unreachable the moment the chord changed. Drawing it here, in a
  // neutral color distinct from the interval-role colors above, keeps it
  // permanently visible and clickable (to remove) regardless of what the
  // fretboard is currently showing.
  (leadNotes || []).forEach((n, leadOrder) => {
    const alreadyDrawn = dots.some(d => d.stringIdx === n.stringIdx && d.fret === n.fret);
    if (alreadyDrawn) return;
    const x = n.fret === 0 ? fretX(0) - 12 * scale : (fretX(n.fret - 1) + fretX(n.fret)) / 2;
    const y = stringY(n.stringIdx);
    svg += `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="#888" class="fretboard-tone-dot" data-string="${n.stringIdx}" data-fret="${n.fret}" style="cursor:pointer;" stroke="#fff" stroke-width="2.5"><title>Recorded note (not a tone of the current chord)</title></circle>`;
    svg += `<text x="${x}" y="${y - 11 * scale}" font-size="${9 * scale}" font-weight="700" fill="#fff" text-anchor="middle" font-family="JetBrains Mono, monospace">${leadOrder + 1}</text>`;
  });
  // Selection ring -- which exact fretboard position corresponds to the
  // grid note(s) currently selected. Separate from the "recorded" outline
  // above (that shows the whole saved sequence with order numbers, used
  // elsewhere for a different purpose); this is specifically about
  // instantaneous selection, so a plain bright ring with no number is
  // clearer than reusing that mechanism would have been. Drawn as its
  // own final pass so it's never obscured by anything drawn earlier,
  // regardless of whether the position happens to be one of the current
  // chord's dots or an off-chord recorded note.
  (selectedNotes || []).forEach(n => {
    const x = n.fret === 0 ? fretX(0) - 12 * scale : (fretX(n.fret - 1) + fretX(n.fret)) / 2;
    const y = stringY(n.stringIdx);
    const alreadyDrawn = dots.some(d => d.stringIdx === n.stringIdx && d.fret === n.fret)
      || (leadNotes || []).some(ln => ln.stringIdx === n.stringIdx && ln.fret === n.fret);
    if (!alreadyDrawn) {
      // The note's own scale/mode may have changed since it was placed,
      // leaving no dot here to ring -- draw a plain fallback dot first,
      // same reasoning as the "recorded but off-chord" pass above.
      svg += `<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="#888" pointer-events="none" />`;
    }
    svg += `<circle cx="${x}" cy="${y}" r="${dotRadius + 4 * scale}" fill="none" stroke="var(--press-yellow)" stroke-width="3" pointer-events="none" />`;
  });
  svg += '</svg>';
  return svg;
}

// Strum patterns -- replaces the old simple Arpeggiate on/off with 6 named
// options. sortDir: 0 = natural string order (no sort), 1 = ascending
// (low to high), -1 = descending (high to low). stagger is the real
// spacing between distinct notes, in seconds.
const STRUM_PATTERNS = [
  { value: 'block',     label: 'Block Chord' },
  { value: 'strumDown', label: 'Strum Down' },
  { value: 'strumUp',   label: 'Strum Up' },
  { value: 'arpUp',     label: 'Arp Up' },
  { value: 'arpDown',   label: 'Arp Down' },
  { value: 'altBass',   label: 'Alt Bass' },
  { value: 'upDown',    label: 'Up-Down' },
  { value: 'downUp',    label: 'Down-Up' },
  { value: 'random',    label: 'Random' },
  { value: 'asPlayed',  label: 'As Played' },
];
// Standard arpeggiator pattern vocabulary, verified against how real
// synths/DAWs (Ableton, common hardware arps) name and define these --
// Up/Down/Up-Down/Random/As-Played are close to universal across them.
// reorder is optional -- applied AFTER the initial sort, for patterns that
// need more than a straight ascending/descending order. Up-Down and
// Down-Up verified against the standard convention (C-E-G-E, not
// C-E-G-E-C with a duplicated endpoint) before being used here.
function reverseMiddle(sorted){
  return [...sorted, ...sorted.slice(0, -1).reverse().slice(0, -1)];
}
function shuffleArray(arr){
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
const STRUM_PATTERN_CONFIG = {
  block:     { sortDir: 0,  getStagger: (idx) => idx * 0.02 },  // tight, near-simultaneous -- same feel as the old non-arpeggiated default
  strumDown: { sortDir: 1,  getStagger: (idx) => idx * 0.05 },  // quick ascending sweep, distinctly faster than a full arpeggio
  strumUp:   { sortDir: -1, getStagger: (idx) => idx * 0.05 },  // quick descending sweep
  arpUp:     { sortDir: 1,  getStagger: (idx) => idx * 0.16 },  // same spacing as the old "arpeggiate: true" behavior
  arpDown:   { sortDir: -1, getStagger: (idx) => idx * 0.16 },
  // Classic folk/country "boom-chick" -- the bass note (lowest, hence
  // sortDir:1 putting it first) rings alone, then the rest of the chord
  // comes in together shortly after as a block, not spread out further.
  altBass:   { sortDir: 1,  getStagger: (idx) => idx === 0 ? 0 : 0.22 },
  upDown:    { sortDir: 1,  getStagger: (idx) => idx * 0.13, reorder: reverseMiddle },
  downUp:    { sortDir: -1, getStagger: (idx) => idx * 0.13, reorder: reverseMiddle },
  random:    { sortDir: 0,  getStagger: (idx) => idx * 0.16, reorder: shuffleArray }, // re-shuffled fresh on every single play, not baked in once
  asPlayed:  { sortDir: 0,  getStagger: (idx) => idx * 0.16 }, // natural order, no re-sort at all
};

// Applies a chord pattern's sort+reorder logic to a lead note pattern --
// reuses the exact same pattern vocabulary as chords (Up, Down, Random,
// etc.) so a lead line's arp behavior is consistent with everything else
// in the app instead of being its own separate system.
function applyPatternToLeadNotes(leadPattern, patternType){
  const config = STRUM_PATTERN_CONFIG[patternType] || STRUM_PATTERN_CONFIG.asPlayed;
  let notes = leadPattern.map(n => ({ ...n, freq: OPEN_STRING_FREQS[n.stringIdx] * Math.pow(2, n.fret / 12) }));
  if (config.sortDir === 1) notes.sort((a, b) => a.freq - b.freq);
  else if (config.sortDir === -1) notes.sort((a, b) => b.freq - a.freq);
  if (config.reorder) notes = config.reorder(notes);
  return notes;
}

// Practical upper bound for octave doubling -- high E string, 24th fret,
// a reasonable ceiling for what a real guitar can actually reach. Doubling
// a note that would exceed this just skips that one note's doubled layer
// rather than pushing it into unrealistic, off-instrument territory. If a
// piano section is ever built, this constraint is specific to the guitar
// context and wouldn't carry over.
const MAX_REALISTIC_GUITAR_FREQ = OPEN_STRING_FREQS[5] * Math.pow(2, 24 / 12);

function playChordShape(shape, cardEl, pattern, durationOverrideSeconds, octaveDouble, startTimeOverride, volumeMultOverride){
  const ctx = getChartToneCtx();
  const toneType = window.__toneType || 'triangle';
  const resolvedPattern = pattern || window.__strumPattern || 'block';
  const patternConfig = STRUM_PATTERN_CONFIG[resolvedPattern] || STRUM_PATTERN_CONFIG.block;
  const isInstrument = window.__toneEngine.isInstrument(toneType);

  // compute the real frequency for every active string first -- needed for
  // any sorted pattern, since a fretted low string can occasionally sit
  // HIGHER in pitch than an open higher string, so string order alone
  // isn't reliable for a genuine low-to-high (or high-to-low) sweep
  //
  // IMPORTANT: a non-zero fret value from chords-db is relative to
  // baseFret, not an absolute fret number -- verified empirically against
  // real data (a raw, unadjusted value produces completely wrong notes for
  // any voicing where baseFret > 1). Absolute fret = baseFret + f - 1.
  // Open strings (f === 0) need no adjustment. This bug was invisible the
  // whole time position 0 (which almost always has baseFret 1) was the
  // only voicing ever played -- 1 + f - 1 === f, so the bug and the fix
  // coincidentally agreed. It would have played the wrong pitch entirely
  // for any other voicing.
  let notes = [];
  shape.frets.forEach((f, i) => {
    if (f === -1) return;
    const absoluteFret = f > 0 ? shape.baseFret + f - 1 : 0;
    notes.push({ stringIdx: i, freq: OPEN_STRING_FREQS[i] * Math.pow(2, absoluteFret / 12) });
  });
  if (notes.length === 0) return;

  if (patternConfig.sortDir === 1) notes.sort((a, b) => a.freq - b.freq);
  else if (patternConfig.sortDir === -1) notes.sort((a, b) => b.freq - a.freq);
  const noteGain = Math.min(0.26, 1.0 / notes.length) * (volumeMultOverride !== undefined ? volumeMultOverride : 1.0); // computed from the real chord-tone count, BEFORE any reorder below might expand the sequence (Up-Down repeats existing pitches, it doesn't add new simultaneous voices)
  if (patternConfig.reorder) notes = patternConfig.reorder(notes);
  const dur = durationOverrideSeconds
    ? Math.max(0.3, durationOverrideSeconds) // tied to the chord's actual beat-slot when known (progression playback/preview); floored so a very short slot at a fast tempo still gets an audible attack/release
    : (isInstrument ? 1.8 : 1.4); // no beat context (chart-card browsing preview) -- fixed default as before

  function scheduleNotes(){
    // Uses the precomputed target time when the caller provides one
    // (progression playback), instead of "whatever ctx.currentTime
    // happens to be right now" -- otherwise a setTimeout firing even a
    // few ms late (very common once DOM work like timeline highlighting
    // runs earlier in the same callback) directly delays the audio too,
    // and that delay compounds chord over chord.
    const now = (startTimeOverride !== undefined && startTimeOverride !== null) ? startTimeOverride : ctx.currentTime;
    notes.forEach((note, idx) => {
      const freq = note.freq;
      const stagger = patternConfig.getStagger(idx, notes.length);
      const startAt = now + stagger;

      if (isInstrument) {
        window.__toneEngine.playNote(ctx, toneType, freq, startAt, noteGain * 1.15, dur);
        if (octaveDouble && freq * 2 <= MAX_REALISTIC_GUITAR_FREQ) window.__toneEngine.playNote(ctx, toneType, freq * 2, startAt, noteGain * 0.85, dur);
        return;
      }

      // Single oscillator per note by default -- the note above about why
      // still applies to the base chord. octaveDouble is different: it's
      // an explicit, opt-in user toggle (not hardcoded on), and the doubled
      // layer runs at less than half the main note's gain specifically to
      // avoid reintroducing that same muddiness/clipping risk. The master
      // bus compressor also helps absorb the extra layer when this is
      // combined with Bass Notes and Top Note at the same time.
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = toneType;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(noteGain, startAt + 0.03);
      gain.gain.linearRampToValueAtTime(noteGain, startAt + dur - 0.15);
      gain.gain.linearRampToValueAtTime(0, startAt + dur);
      osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
      osc.start(startAt); osc.stop(startAt + dur + 0.05);

      if (octaveDouble && freq * 2 <= MAX_REALISTIC_GUITAR_FREQ) {
        const dblGain = noteGain * 0.8;
        const dblOsc = ctx.createOscillator();
        const dblGainNode = ctx.createGain();
        dblOsc.type = toneType;
        dblOsc.frequency.value = freq * 2;
        dblGainNode.gain.setValueAtTime(0, startAt);
        dblGainNode.gain.linearRampToValueAtTime(dblGain, startAt + 0.03);
        dblGainNode.gain.linearRampToValueAtTime(dblGain, startAt + dur - 0.15);
        dblGainNode.gain.linearRampToValueAtTime(0, startAt + dur);
        dblOsc.connect(dblGainNode); dblGainNode.connect(window.__getMasterBus(ctx));
        dblOsc.start(startAt); dblOsc.stop(startAt + dur + 0.05);
      }
    });
  }

  if (toneType === 'piano' || toneType === 'brightpiano') {
    window.__toneEngine.ensurePianoLoaded(ctx).then(scheduleNotes);
  } else {
    scheduleNotes();
  }

  const lastStagger = notes.length > 1 ? patternConfig.getStagger(notes.length - 1, notes.length) : 0;
  const totalDurMs = (dur + lastStagger) * 1000;
  if (cardEl) {
    cardEl.classList.add('playing');
    setTimeout(() => cardEl.classList.remove('playing'), totalDurMs);
  }
}

// ---- up to 3 active modes at once, oldest evicted on a 4th pick ----
let activeModes = []; // nothing preselected -- the order the user picks in is theirs to build

// Scrolls a mode's column to the start of the visible area -- used when a
// mode is freshly selected, so the new mode becomes prominent and whatever
// was already visible shifts left out of the way, rather than the new
// column silently appearing off-screen to the right.
function scrollModeIntoView(modeName){
  const group = chartGroups.querySelector('[data-mode-name="' + modeName + '"]');
  if (group) group.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
}

function renderModePicker(){
  modePicker.innerHTML = '';
  const SIMPLE_MODE_NAMES = ['Ionian', 'Aeolian']; // major/minor -- the two almost everyone already has some intuition for
  // Show the simple set, plus anything already selected even if it's not
  // in that set (an exotic mode picked before Simple Mode was turned on
  // stays visible and active -- only what's offered to ADD next is limited).
  const namesToShow = simpleMode
    ? [...new Set([...SIMPLE_MODE_NAMES, ...activeModes.filter(m => MODE_NAMES.includes(m))])]
    : MODE_NAMES;
  namesToShow.forEach(modeName => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mode-pill' + (activeModes.includes(modeName) ? ' active' : '');
    pill.textContent = modeName;
    pill.setAttribute('aria-pressed', activeModes.includes(modeName) ? 'true' : 'false');
    pill.addEventListener('click', () => {
      const wasSelecting = !activeModes.includes(modeName);
      if (activeModes.includes(modeName)) {
        activeModes = activeModes.filter(m => m !== modeName); // free to deselect down to zero
      } else {
        activeModes = [...activeModes, modeName]; // no cap -- select as many as you want, columns scroll on desktop
      }
      renderModePicker();
      renderChartGroups();
      applyActivePresetIfAny();
      if (wasSelecting) scrollModeIntoView(modeName);
    });
    modePicker.appendChild(pill);
  });
  relativeMinorBtn.classList.toggle('active', activeModes.includes('Aeolian'));
  relativeMajorBtn.classList.toggle('active', activeModes.includes('Ionian'));
}
