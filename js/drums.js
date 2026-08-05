// ---- Drum synthesis engine ----
// Every sound here is pure Web Audio synthesis, consistent with how
// every other tone in this app works (only Piano uses real samples).
// Data-driven: DRUM_KIT_PARAMS holds per-kit, per-sound parameters, and
// a small set of generic synthesis functions consume them -- adding a
// new kit later means adding a parameter row, not new synthesis code.

// ---- Real drum samples ----
// Some kits are backed by real recordings instead of synthesis --
// "drummachine" (CC0-licensed TR-808, tidalcycles/sounds-tr808-fischer)
// and "jazz" (studio recordings: bop kick, hi-hats, flat ride/crash).
// Any sound within a sample-backed kit that has no real recording falls
// back to synthesis automatically -- jazz currently has no real
// snare/toms/clap/rim/cowbell, so those four keep using the synthesized
// jazz parameters until real samples exist for them too. Follows the
// exact same fetch -> arrayBuffer -> decodeAudioData -> cache pattern
// already used for piano samples.
const DRUM_SAMPLE_KITS = {
  drummachine: {
    folder: 'tr808',
    files: {
      kick: 'kick.wav', snare: 'snare.wav', closedHat: 'closedHat.wav', openHat: 'openHat.wav',
      crash: 'crash.wav', tomHigh: 'tomHigh.wav', tomLow: 'tomLow.wav', clap: 'clap.wav',
      rim: 'rim.wav', cowbell: 'cowbell.wav',
    },
  },
  jazz: {
    folder: 'jazz',
    files: {
      kick: 'kick.wav', snare: 'snare.wav', closedHat: 'closedHat.wav', openHat: 'openHat.wav',
      crash: 'crash.wav', tomHigh: 'tomHigh.wav', tomLow: 'tomLow.wav', rim: 'rim.wav',
      clap: 'clap.wav', cowbell: 'cowbell.wav',
    },
  },
  rock: {
    folder: 'rock',
    files: {
      kick: 'kick.wav', snare: 'snare.wav', closedHat: 'closedHat.wav', openHat: 'openHat.wav',
      crash: 'crash.wav', tomHigh: 'tomHigh.wav', tomLow: 'tomLow.wav', clap: 'clap.wav',
      rim: 'rim.wav', cowbell: 'cowbell.wav',
    },
  },
};
let drumSampleBuffers = {}; // keyed by "kitName:soundName"
let drumSampleLoadPromises = {}; // keyed by kitName, so each kit loads independently and only once
function ensureDrumSamplesLoaded(ctx, kitName){
  const kit = DRUM_SAMPLE_KITS[kitName];
  if (!kit) return Promise.resolve(); // this kit has no real samples at all -- nothing to load
  if (drumSampleLoadPromises[kitName]) return drumSampleLoadPromises[kitName];
  drumSampleLoadPromises[kitName] = Promise.all(Object.keys(kit.files).map(sound => {
    return fetch('./audio/drums/' + kit.folder + '/' + kit.files[sound])
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(audioBuffer => { drumSampleBuffers[kitName + ':' + sound] = audioBuffer; })
      .catch(err => console.error('Failed to load drum sample', kitName, sound, err));
  }));
  return drumSampleLoadPromises[kitName];
}
function playRealDrumSample(ctx, kitName, soundName, startAt, gainMult){
  const buffer = drumSampleBuffers[kitName + ':' + soundName];
  if (!buffer) return null; // not loaded yet, or this kit/sound has no real sample -- caller falls back to synthesis rather than staying silent
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.7 * gainMult; // real recordings are already at a sensible relative level; this just brings a single hit in line with the synthesized kits' overall loudness
  src.connect(gain); gain.connect(window.__getMasterBus(ctx));
  src.start(startAt);
  return { gainNode: gain, sourceNodes: [src] }; // truthy voice handle -- lets an open hat played this way be choked by a later closed hat
}

let sharedNoiseBuffer = null;
function getNoiseBuffer(ctx){
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === ctx.sampleRate) return sharedNoiseBuffer;
  const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise, long enough for the longest crash/open-hat decay, looped/trimmed via playback duration rather than regenerated per hit
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  sharedNoiseBuffer = buffer;
  return buffer;
}

const DRUM_SOUNDS = ['kick', 'snare', 'closedHat', 'openHat', 'crash', 'tomHigh', 'tomLow', 'clap', 'rim', 'cowbell'];
const DRUM_SOUND_LABELS = {
  kick: 'Kick', snare: 'Snare', closedHat: 'Closed Hi-Hat', openHat: 'Open Hi-Hat', crash: 'Crash/Ride',
  tomHigh: 'Tom (High)', tomLow: 'Tom (Low)', clap: 'Clap', rim: 'Rimshot', cowbell: 'Cowbell',
};
const DRUM_KITS = ['rock', 'hiphop', 'jazz', 'drummachine'];
const DRUM_KIT_LABELS = { rock: 'Rock', hiphop: 'Retro', jazz: 'Jazz', drummachine: 'Drum Machine' };

const DRUM_KIT_PARAMS = {
  rock: {
    kick: { startFreq: 150, endFreq: 55, pitchDropTime: 0.08, ampDecay: 0.25 },
    snare: { noiseDecay: 0.18, toneFreq: 180, toneDecay: 0.10, noiseFilterFreq: 2000, mix: 0.6 },
    closedHat: { decay: 0.05, filterFreq: 7000 },
    openHat: { decay: 0.30, filterFreq: 7000 },
    crash: { decay: 1.2, filterFreq: 5000 },
    tomHigh: { startFreq: 220, endFreq: 160, pitchDropTime: 0.05, ampDecay: 0.22 },
    tomLow: { startFreq: 130, endFreq: 90, pitchDropTime: 0.06, ampDecay: 0.28 },
    clap: { burstCount: 3, burstGap: 0.012, decay: 0.15, filterFreq: 1800 },
    rim: { freq: 900, decay: 0.05 },
    cowbell: { freqA: 800, freqB: 540, decay: 0.3 },
  },
  hiphop: {
    kick: { startFreq: 120, endFreq: 40, pitchDropTime: 0.15, ampDecay: 0.45 },
    snare: { noiseDecay: 0.22, toneFreq: 150, toneDecay: 0.12, noiseFilterFreq: 1500, mix: 0.55 },
    closedHat: { decay: 0.04, filterFreq: 6000 },
    openHat: { decay: 0.25, filterFreq: 6000 },
    crash: { decay: 1.0, filterFreq: 4500 },
    tomHigh: { startFreq: 200, endFreq: 140, pitchDropTime: 0.07, ampDecay: 0.3 },
    tomLow: { startFreq: 110, endFreq: 70, pitchDropTime: 0.09, ampDecay: 0.38 },
    clap: { burstCount: 4, burstGap: 0.014, decay: 0.2, filterFreq: 1500 },
    rim: { freq: 800, decay: 0.06 },
    cowbell: { freqA: 780, freqB: 520, decay: 0.35 },
  },
  jazz: {
    kick: { startFreq: 130, endFreq: 60, pitchDropTime: 0.06, ampDecay: 0.20 },
    snare: { noiseDecay: 0.15, toneFreq: 200, toneDecay: 0.08, noiseFilterFreq: 3000, mix: 0.75 }, // more noise-dominant -- reads as brushy rather than a sharp backbeat hit
    closedHat: { decay: 0.06, filterFreq: 8000 },
    openHat: { decay: 0.35, filterFreq: 8000 },
    crash: { decay: 1.5, filterFreq: 6000 }, // longer wash, closer to a ride cymbal's sustain
    tomHigh: { startFreq: 210, endFreq: 165, pitchDropTime: 0.04, ampDecay: 0.2 },
    tomLow: { startFreq: 125, endFreq: 95, pitchDropTime: 0.05, ampDecay: 0.25 },
    clap: { burstCount: 3, burstGap: 0.010, decay: 0.12, filterFreq: 2200 },
    rim: { freq: 950, decay: 0.04 },
    cowbell: { freqA: 820, freqB: 560, decay: 0.25 },
  },
  drummachine: {
    kick: { startFreq: 100, endFreq: 45, pitchDropTime: 0.25, ampDecay: 0.6 }, // classic 808-style boom, long pitched tail
    snare: { noiseDecay: 0.20, toneFreq: 180, toneDecay: 0.10, noiseFilterFreq: 1800, mix: 0.5 },
    closedHat: { decay: 0.03, filterFreq: 9000 },
    openHat: { decay: 0.20, filterFreq: 9000 },
    crash: { decay: 0.8, filterFreq: 5500 },
    tomHigh: { startFreq: 230, endFreq: 175, pitchDropTime: 0.08, ampDecay: 0.35 },
    tomLow: { startFreq: 100, endFreq: 60, pitchDropTime: 0.12, ampDecay: 0.45 },
    clap: { burstCount: 4, burstGap: 0.016, decay: 0.22, filterFreq: 1600 },
    rim: { freq: 1000, decay: 0.04 },
    cowbell: { freqA: 800, freqB: 540, decay: 0.4 }, // the "classic" 808 cowbell ratio, kept consistent across kits' pitch since it's such a recognizable sound
  },
};

function synthKickOrTom(ctx, params, startAt, gainMult){
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(params.startFreq, startAt);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, params.endFreq), startAt + params.pitchDropTime);
  gain.gain.setValueAtTime(0.9 * gainMult, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + params.ampDecay);
  osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
  osc.start(startAt); osc.stop(startAt + params.ampDecay + 0.05);

  // Short click transient layered on the attack -- a real kick/tom's
  // beater strike, missing entirely from a bare sine tone. Without this,
  // the sine's pitch-drop alone reads as a soft, indistinct "boop" rather
  // than a percussive hit with real definition.
  const clickDecay = 0.02;
  const clickSrc = ctx.createBufferSource();
  clickSrc.buffer = getNoiseBuffer(ctx);
  const clickFilter = ctx.createBiquadFilter();
  clickFilter.type = 'highpass';
  clickFilter.frequency.value = 1000;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.25 * gainMult, startAt);
  clickGain.gain.exponentialRampToValueAtTime(0.001, startAt + clickDecay);
  clickSrc.connect(clickFilter); clickFilter.connect(clickGain); clickGain.connect(window.__getMasterBus(ctx));
  clickSrc.start(startAt); clickSrc.stop(startAt + clickDecay + 0.02);
}

function synthNoiseHit(ctx, params, startAt, gainMult, decayOverride){
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = params.filterFreq;
  const gain = ctx.createGain();
  const decay = decayOverride !== undefined ? decayOverride : params.decay;
  gain.gain.setValueAtTime(0.5 * gainMult, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + decay);
  src.connect(filter); filter.connect(gain); gain.connect(window.__getMasterBus(ctx));
  src.start(startAt); src.stop(startAt + decay + 0.05);
}

// Hi-hats and crash use this, not synthNoiseHit -- plain filtered white
// noise reads as generic hiss, not a recognizable cymbal. This uses the
// standard technique real 808/909-style hi-hats are built from: several
// square-wave oscillators at inharmonic frequency ratios (not integer
// multiples -- that's what gives a bell/cymbal its characteristic
// clangy, non-musical-pitch quality) summed together, then high-pass
// filtered to keep only the metallic upper content.
const METALLIC_RATIOS = [1, 1.342, 1.732, 2.253, 2.855, 3.414];
function synthMetallicHit(ctx, params, startAt, gainMult){
  const sumGain = ctx.createGain(); // sums all the oscillators before filtering, so the filter shapes the combined metallic content as one voice
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = params.filterFreq;
  const outGain = ctx.createGain();
  outGain.gain.setValueAtTime(0.4 * gainMult, startAt);
  outGain.gain.exponentialRampToValueAtTime(0.001, startAt + params.decay);
  sumGain.connect(filter); filter.connect(outGain); outGain.connect(window.__getMasterBus(ctx));
  const baseFreq = 220; // fixed base -- the inharmonic ratios, not the absolute pitch, are what create the metallic character; filterFreq (which varies by kit) does the actual brightness shaping
  const oscillators = [];
  METALLIC_RATIOS.forEach(ratio => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = baseFreq * ratio;
    osc.connect(sumGain);
    osc.start(startAt); osc.stop(startAt + params.decay + 0.05);
    oscillators.push(osc);
  });
  return { gainNode: outGain, sourceNodes: oscillators };
}

function synthSnare(ctx, params, startAt, gainMult){
  // Noise component (the "snap")
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = params.noiseFilterFreq;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.6 * params.mix * gainMult, startAt);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, startAt + params.noiseDecay);
  src.connect(filter); filter.connect(noiseGain); noiseGain.connect(window.__getMasterBus(ctx));
  src.start(startAt); src.stop(startAt + params.noiseDecay + 0.05);
  // Tone component (the "body")
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = params.toneFreq;
  const toneGain = ctx.createGain();
  toneGain.gain.setValueAtTime(0.5 * (1 - params.mix) * gainMult, startAt);
  toneGain.gain.exponentialRampToValueAtTime(0.001, startAt + params.toneDecay);
  osc.connect(toneGain); toneGain.connect(window.__getMasterBus(ctx));
  osc.start(startAt); osc.stop(startAt + params.toneDecay + 0.05);
}

function synthClap(ctx, params, startAt, gainMult){
  // Several quick, slightly-staggered noise bursts -- the classic clap
  // synthesis technique, distinguishing it from a single snare-like hit.
  for (let b = 0; b < params.burstCount; b++) {
    synthNoiseHit(ctx, params, startAt + b * params.burstGap, gainMult * (b === params.burstCount - 1 ? 1 : 0.7), params.decay);
  }
}

function synthRim(ctx, params, startAt, gainMult){
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = params.freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.35 * gainMult, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + params.decay);
  osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
  osc.start(startAt); osc.stop(startAt + params.decay + 0.02);
}

function synthCowbell(ctx, params, startAt, gainMult){
  // Two square oscillators at a fixed ratio -- the standard, recognizable
  // cowbell synthesis technique (popularized by the 808).
  [params.freqA, params.freqB].forEach(freq => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25 * gainMult, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + params.decay);
    osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
    osc.start(startAt); osc.stop(startAt + params.decay + 0.02);
  });
}

// Single entry point -- given a kit name, a sound name, and a start time,
// plays that hit. gainMult supports velocity/accent later without
// changing this function's shape.
// Hi-hat choke: on a real kit, open and closed hi-hat are the same
// physical cymbals -- closing the hat immediately cuts off whatever the
// open hat was still ringing. Tracks the most recently played open-hat
// voice per kit and chokes it the instant a closed hat is scheduled to
// fire. Uses cancelAndHoldAtTime where available so this still works
// correctly for hits scheduled ahead of time (which is how this app
// always plays drums), not just ones triggered immediately.
let drumOpenHatVoices = {}; // keyed by kitName
function chokeVoice(voice, atTime){
  if (!voice) return;
  const CHOKE_FADE = 0.015; // fast enough to read as an instant mechanical cutoff, slow enough to avoid a click
  const g = voice.gainNode.gain;
  if (typeof g.cancelAndHoldAtTime === 'function') {
    g.cancelAndHoldAtTime(atTime);
  } else {
    g.cancelScheduledValues(atTime); // less precise fallback for browsers without cancelAndHoldAtTime -- may click faintly on an in-progress ramp, but still cuts the ring-out short
  }
  g.linearRampToValueAtTime(0.0001, atTime + CHOKE_FADE);
  voice.sourceNodes.forEach(node => { try { node.stop(atTime + CHOKE_FADE + 0.005); } catch (e) {} });
}

function playDrumSound(ctx, kitName, soundName, startAt, gainMult){
  const kit = DRUM_KIT_PARAMS[kitName] || DRUM_KIT_PARAMS.rock;
  const params = kit[soundName];
  if (!params) return;
  const mult = gainMult !== undefined ? gainMult : 1.0;
  if (soundName === 'closedHat') chokeVoice(drumOpenHatVoices[kitName], startAt); // closing the hat always cuts off whatever open hat was ringing, real sample or synthesized alike
  let voice = null;
  if (DRUM_SAMPLE_KITS[kitName]) voice = playRealDrumSample(ctx, kitName, soundName, startAt, mult);
  if (voice) {
    if (soundName === 'openHat') drumOpenHatVoices[kitName] = voice;
    return; // a real recording exists for this kit+sound and played successfully -- done
  }
  if (soundName === 'kick' || soundName === 'tomHigh' || soundName === 'tomLow') synthKickOrTom(ctx, params, startAt, mult);
  else if (soundName === 'snare') synthSnare(ctx, params, startAt, mult);
  else if (soundName === 'closedHat' || soundName === 'openHat' || soundName === 'crash') {
    const synthVoice = synthMetallicHit(ctx, params, startAt, mult);
    if (soundName === 'openHat') drumOpenHatVoices[kitName] = synthVoice;
  }
  else if (soundName === 'clap') synthClap(ctx, params, startAt, mult);
  else if (soundName === 'rim') synthRim(ctx, params, startAt, mult);
  else if (soundName === 'cowbell') synthCowbell(ctx, params, startAt, mult);
}

// ---- Drums tab ----
// Grid dimensions mirror the Lead tab's own approach: always 2 bars,
// beat count derived from the shared time signature, recomputed whenever
// it changes. Unlike the lead grid (one note per slot), a drum slot is a
// row of booleans -- any number of the 10 sounds can hit simultaneously.
let DRUM_GRID_SLOTS_PER_BEAT = 4;
let DRUM_GRID_BEATS = 8;
let DRUM_GRID_TOTAL_SLOTS = DRUM_GRID_BEATS * DRUM_GRID_SLOTS_PER_BEAT;
let drumGridSlots = Array(DRUM_GRID_TOTAL_SLOTS).fill(null).map(() => Array(DRUM_SOUNDS.length).fill(false));
let drumRowVolumes = Array(DRUM_SOUNDS.length).fill(100); // one volume per sound (0-100), independent of the whole pattern's own volume knob on its Chart chip
let drumKit = 'rock';
let drumEditingEntryIndex = null;
let drumEditingPatternId = null; // stable id of the specific drum pattern being edited -- entryIndex alone goes stale the moment an earlier chord is removed/reordered, since every later entry then shifts to a different array index
// Editing tools -- mirrors the Lead grid's own state exactly (selection,
// range, undo/redo, drag source, clipboard, locked second half), adapted
// for a genuinely rectangular selection: rowStart/rowEnd/colStart/colEnd
// can describe a single cell, a same-row horizontal strip, a same-column
// vertical strip, or a full 2D lasso region -- one shape covers all of
// it, so Duplicate/Copy/Paste/Move never need to know which kind of
// selection they're operating on.
let drumSelection = null; // { rowStart, rowEnd, colStart, colEnd } | null
let drumSelectionAnchor = null; // { row, col } | null -- set on every plain click; Shift+click extends the rectangle from here
let drumSecondHalfOpen = false;
let drumDragSourceCell = null; // { row, col } | null -- for moving an existing selection via HTML5 drag/drop
let drumLassoOrigin = null; // { row, col } | null -- mousedown origin on a not-yet-selected cell, tracked to distinguish a plain click from a drag-to-lasso
let drumLassoPreview = null; // { rowStart, rowEnd, colStart, colEnd } | null -- live rectangle shown while actively dragging a lasso, before mouseup commits it to drumSelection
let drumLassoDidDrag = false; // true once the lasso has actually spanned more than one cell, so the trailing click event doesn't overwrite it with a single-cell selection
let drumClipboard = null; // { numRows, numCols, data } | null -- data[r][c] is a boolean, relative to the copied region's own top-left corner
let drumUndoStack = [];
let drumRedoStack = [];
const DRUM_MAX_UNDO_STEPS = 30;
const drumUnsavedTracker = createUnsavedChangesTracker(['drumSaveBtn', 'drumSaveToBinBtn']);

function recomputeDrumGridDimensions(){
  DRUM_GRID_BEATS = beatsPerBar * 2;
  DRUM_GRID_TOTAL_SLOTS = DRUM_GRID_BEATS * DRUM_GRID_SLOTS_PER_BEAT;
  drumGridSlots = Array(DRUM_GRID_TOTAL_SLOTS).fill(null).map(() => Array(DRUM_SOUNDS.length).fill(false));
  drumEditingEntryIndex = null;
  drumEditingPatternId = null;
  drumSelection = null;
  drumSelectionAnchor = null;
  drumSecondHalfOpen = false;
  drumUndoStack = [];
  drumRedoStack = [];
  drumUnsavedTracker.markDirty(); // resizing genuinely changes content (resets to empty), so this should read as unsaved
  updateDrumAdvancedGridBtnLabel();
  renderDrumEditor();
  drumGridWrap.scrollLeft = 0;
}

// Keeps the Advanced button's own look honest about the CURRENT grid's
// actual resolution -- called after every place that can change or
// restore it.
function updateDrumAdvancedGridBtnLabel(){
  const btn = document.getElementById('drumAdvancedGridBtn');
  const isAdvanced = DRUM_GRID_SLOTS_PER_BEAT > 4;
  btn.classList.toggle('active', isAdvanced);
  btn.textContent = isAdvanced ? 'Advanced \u2713' : 'Advanced';
}

function setDrumGridSlots(newSlots, options){
  options = options || {};
  if (!options.skipHistory) {
    drumUndoStack.push(JSON.stringify(drumGridSlots));
    if (drumUndoStack.length > DRUM_MAX_UNDO_STEPS) drumUndoStack.shift();
    drumRedoStack = [];
    drumUnsavedTracker.onEdit();
  }
  drumGridSlots = newSlots;
  updateDrumUndoRedoButtons();
  if (!options.skipRender) renderDrumEditor();
}
function undoDrumGrid(){
  if (drumUndoStack.length === 0) return;
  drumRedoStack.push(JSON.stringify(drumGridSlots));
  drumGridSlots = JSON.parse(drumUndoStack.pop());
  drumUnsavedTracker.onUndo();
  updateDrumUndoRedoButtons();
  renderDrumEditor();
}
function redoDrumGrid(){
  if (drumRedoStack.length === 0) return;
  drumUndoStack.push(JSON.stringify(drumGridSlots));
  drumGridSlots = JSON.parse(drumRedoStack.pop());
  drumUnsavedTracker.onRedo();
  updateDrumUndoRedoButtons();
  renderDrumEditor();
}
function updateDrumUndoRedoButtons(){
  const undoBtn = document.getElementById('drumUndoBtn');
  const redoBtn = document.getElementById('drumRedoBtn');
  if (undoBtn) undoBtn.disabled = drumUndoStack.length === 0;
  if (redoBtn) redoBtn.disabled = drumRedoStack.length === 0;
}

const drumKitSelect = document.getElementById('drumKitSelect');
DRUM_KITS.forEach(k => {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = DRUM_KIT_LABELS[k];
  drumKitSelect.appendChild(o);
});
drumKitSelect.addEventListener('change', () => {
  drumKit = drumKitSelect.value;
  ensureDrumSamplesLoaded(getChartToneCtx(), drumKit).catch(() => {});
});

const drumTempoInput = document.getElementById('drumTempoInput');
drumTempoInput.value = tempoInput.value; // start in sync with the shared tempo, same reasoning as leadTempoInput
drumTempoInput.addEventListener('input', () => {
  tempoInput.value = drumTempoInput.value;
  leadTempoInput.value = drumTempoInput.value;
});

function drumBeatMs(){
  return 60000 / (parseInt(drumTempoInput.value, 10) || 90);
}

const drumGridWrap = document.getElementById('drumGridWrap');
function renderDrumEditor(){
  drumGridWrap.innerHTML = '';

  if (!drumSecondHalfOpen) {
    const openLabel = document.createElement('div');
    openLabel.className = 'drum-grid-open-label';
    openLabel.textContent = '\u2192 click a locked cell to extend the grid';
    drumGridWrap.appendChild(openLabel);
  }

  // The rectangle currently shown as selected/highlighted -- the live
  // lasso preview (while actively dragging) takes precedence over the
  // committed selection, so you see the region update as you drag.
  const activeSelection = drumLassoPreview || drumSelection;

  DRUM_SOUNDS.forEach((sound, rowIdx) => {
    const row = document.createElement('div');
    row.className = 'drum-grid-row';
    const label = document.createElement('div');
    label.className = 'drum-grid-row-label';
    label.textContent = DRUM_SOUND_LABELS[sound];
    row.appendChild(label);
    const rowVolumeKnob = createVolumeKnob(drumRowVolumes[rowIdx], (newVolume) => {
      drumRowVolumes[rowIdx] = newVolume;
    });
    row.appendChild(rowVolumeKnob);
    for (let slotIdx = 0; slotIdx < DRUM_GRID_TOTAL_SLOTS; slotIdx++) {
      const isLocked = slotIdx >= DRUM_GRID_TOTAL_SLOTS / 2 && !drumSecondHalfOpen;
      const isActive = drumGridSlots[slotIdx][rowIdx];
      const isInSelection = activeSelection
        && rowIdx >= activeSelection.rowStart && rowIdx <= activeSelection.rowEnd
        && slotIdx >= activeSelection.colStart && slotIdx <= activeSelection.colEnd;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'drum-grid-cell'
        + (isActive ? ' active' : '')
        + (slotIdx % DRUM_GRID_SLOTS_PER_BEAT === 0 ? ' beat-start' : '')
        + (isLocked ? ' locked' : '')
        + (isInSelection ? ' cell-selected' : '');
      cell.setAttribute('aria-label', DRUM_SOUND_LABELS[sound] + ', slot ' + (slotIdx + 1) + (isActive ? ', active' : ', empty') + (isLocked ? ', locked -- click to extend the grid' : '') + ' -- click to select, drag to select a region, double-click to remove if active');

      // Single click: creates a hit on an empty cell (instant, unchanged
      // -- fast beat-building matters), or selects just that one cell if
      // it's already active (never removes on a single click -- that's
      // the earlier fix, still in place). Shift+click extends a
      // rectangle from the last-clicked cell to this one, which can span
      // multiple rows, multiple columns, or both -- covers "select a
      // range within one row" and "select a block across several rows"
      // with the same mechanism.
      cell.addEventListener('click', (e) => {
        if (drumLassoDidDrag) { drumLassoDidDrag = false; return; } // a genuine lasso drag just finished on mouseup -- don't let the trailing click event collapse it back to one cell
        if (isLocked) {
          drumSecondHalfOpen = true;
          drumSelection = { rowStart: rowIdx, rowEnd: rowIdx, colStart: slotIdx, colEnd: slotIdx };
          drumSelectionAnchor = { row: rowIdx, col: slotIdx };
          renderDrumEditor();
          return;
        }
        if (e.detail >= 2) {
          const updated = drumGridSlots.map(col => [...col]);
          updated[slotIdx][rowIdx] = !updated[slotIdx][rowIdx];
          if (updated[slotIdx][rowIdx]) {
            const ctx = getChartToneCtx();
            playDrumSound(ctx, drumKit, sound, ctx.currentTime, drumRowVolumes[rowIdx] / 100);
          }
          setDrumGridSlots(updated);
          return;
        }
        if (e.shiftKey && drumSelectionAnchor) {
          drumSelection = {
            rowStart: Math.min(drumSelectionAnchor.row, rowIdx), rowEnd: Math.max(drumSelectionAnchor.row, rowIdx),
            colStart: Math.min(drumSelectionAnchor.col, slotIdx), colEnd: Math.max(drumSelectionAnchor.col, slotIdx),
          };
          renderDrumEditor();
          return;
        }
        if (!isActive) {
          const updated = drumGridSlots.map(col => [...col]);
          updated[slotIdx][rowIdx] = true;
          const ctx = getChartToneCtx();
          playDrumSound(ctx, drumKit, sound, ctx.currentTime, drumRowVolumes[rowIdx] / 100); // always audition on creation, at this row's own mixed volume
          drumSelection = { rowStart: rowIdx, rowEnd: rowIdx, colStart: slotIdx, colEnd: slotIdx };
          drumSelectionAnchor = { row: rowIdx, col: slotIdx };
          setDrumGridSlots(updated);
        } else {
          const isSameSingleCell = drumSelection && drumSelection.rowStart === rowIdx && drumSelection.rowEnd === rowIdx && drumSelection.colStart === slotIdx && drumSelection.colEnd === slotIdx;
          drumSelection = isSameSingleCell ? null : { rowStart: rowIdx, rowEnd: rowIdx, colStart: slotIdx, colEnd: slotIdx };
          drumSelectionAnchor = isSameSingleCell ? null : { row: rowIdx, col: slotIdx };
          renderDrumEditor();
        }
      });

      // Lasso: mousedown on a cell that ISN'T already part of the
      // selection starts tracking a potential drag; dragging over other
      // cells (mouseenter, while the button is held) grows a live
      // preview rectangle. A global mouseup (added once, outside this
      // render loop) commits the preview as the real selection. Cells
      // that ARE already selected skip this entirely and use native
      // HTML5 drag instead (below), so the two gestures never compete
      // for the same mousedown.
      if (!isInSelection) {
        cell.addEventListener('mousedown', () => {
          if (isLocked) return;
          drumLassoOrigin = { row: rowIdx, col: slotIdx };
          drumLassoDidDrag = false;
          drumLassoPreview = null;
        });
        cell.addEventListener('mouseenter', () => {
          if (!drumLassoOrigin) return;
          if (rowIdx === drumLassoOrigin.row && slotIdx === drumLassoOrigin.col) return;
          drumLassoDidDrag = true;
          drumLassoPreview = {
            rowStart: Math.min(drumLassoOrigin.row, rowIdx), rowEnd: Math.max(drumLassoOrigin.row, rowIdx),
            colStart: Math.min(drumLassoOrigin.col, slotIdx), colEnd: Math.max(drumLassoOrigin.col, slotIdx),
          };
          renderDrumEditor();
        });
      }

      // Drag-to-move an existing selection -- only draggable once this
      // cell is already part of the current selection, matching Lead's
      // exact pattern, so plain clicks and lasso drags elsewhere are
      // never intercepted as a move attempt.
      cell.draggable = isInSelection && !isLocked;
      cell.addEventListener('dragstart', () => { drumDragSourceCell = { row: rowIdx, col: slotIdx }; });
      cell.addEventListener('dragend', () => { drumDragSourceCell = null; });
      cell.addEventListener('dragover', (e) => { e.preventDefault(); });
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        performDrumMove(rowIdx, slotIdx, isLocked);
      });

      row.appendChild(cell);
    }
    drumGridWrap.appendChild(row);
  });
}

let drumActiveTimeoutIds = [];
let drumIsPlaying = false;
const drumPlayBtn = document.getElementById('drumPlayBtn');
const drumStopBtn = document.getElementById('drumStopBtn');
const drumLoopToggle = document.getElementById('drumLoopToggle');

function stopDrumPlayback(){
  drumIsPlaying = false;
  drumActiveTimeoutIds.forEach(id => clearTimeout(id));
  drumActiveTimeoutIds = [];
  drumPlayBtn.disabled = false;
  drumStopBtn.disabled = true;
  window.__hardStopAllAudio(getChartToneCtx());
}

function playDrumGrid(){
  stopDrumPlayback();
  drumIsPlaying = true;
  drumPlayBtn.disabled = true;
  drumStopBtn.disabled = false;
  const activeSlotCount = drumSecondHalfOpen ? DRUM_GRID_TOTAL_SLOTS : DRUM_GRID_TOTAL_SLOTS / 2;
  function runOnce(){
    const ctx = getChartToneCtx();
    const startTime = ctx.currentTime; // single fixed reference for this run, same discipline as Chart's own playback
    const slotMs = drumBeatMs() / DRUM_GRID_SLOTS_PER_BEAT;
    for (let slotIdx = 0; slotIdx < activeSlotCount; slotIdx++) {
      const elapsed = slotIdx * slotMs;
      const hitStartTime = startTime + elapsed / 1000;
      const id = setTimeout(() => {
        DRUM_SOUNDS.forEach((sound, rowIdx) => {
          if (drumGridSlots[slotIdx][rowIdx]) playDrumSound(ctx, drumKit, sound, hitStartTime, drumRowVolumes[rowIdx] / 100);
        });
      }, elapsed);
      drumActiveTimeoutIds.push(id);
    }
    const totalMs = activeSlotCount * slotMs;
    const endId = setTimeout(() => {
      if (drumLoopToggle.checked && drumIsPlaying) runOnce();
      else stopDrumPlayback();
    }, totalMs);
    drumActiveTimeoutIds.push(endId);
  }
  runOnce();
}
drumPlayBtn.addEventListener('click', playDrumGrid);
drumStopBtn.addEventListener('click', stopDrumPlayback);

document.getElementById('drumClearGridBtn').addEventListener('click', () => {
  setDrumGridSlots(Array(DRUM_GRID_TOTAL_SLOTS).fill(null).map(() => Array(DRUM_SOUNDS.length).fill(false)));
  drumRowVolumes = Array(DRUM_SOUNDS.length).fill(100);
  drumSelection = null;
  drumSelectionAnchor = null;
  drumSecondHalfOpen = false;
  drumEditingEntryIndex = null;
  drumEditingPatternId = null;
  drumUndoStack = [];
  drumRedoStack = [];
  updateDrumUndoRedoButtons();
  renderDrumEditor();
  drumGridWrap.scrollLeft = 0;
});

document.getElementById('drumUndoBtn').addEventListener('click', undoDrumGrid);
document.getElementById('drumRedoBtn').addEventListener('click', redoDrumGrid);
document.getElementById('drumAdvancedGridBtn').addEventListener('click', () => {
  const newSlotsPerBeat = DRUM_GRID_SLOTS_PER_BEAT > 4 ? 4 : 8;
  const newTotalSlots = DRUM_GRID_BEATS * newSlotsPerBeat;
  const newSlots = Array(newTotalSlots).fill(null).map(() => Array(DRUM_SOUNDS.length).fill(false));
  let anyCollision = false;
  drumGridSlots.forEach((row, oldIndex) => {
    if (!row.some(Boolean)) return; // empty slot, nothing to remap
    const newIndex = remapSlotIndex(oldIndex, DRUM_GRID_SLOTS_PER_BEAT, newSlotsPerBeat);
    if (newIndex < 0 || newIndex >= newTotalSlots) return;
    if (newSlots[newIndex].some(Boolean)) anyCollision = true; // this slot already received a hit from a different old slot
    row.forEach((hit, soundIdx) => { if (hit) newSlots[newIndex][soundIdx] = true; }); // OR together -- a hit in either old slot survives
  });
  if (anyCollision) {
    const confirmed = window.confirm('Some hits are close enough together that switching to this resolution will merge them onto the same slot. Continue?');
    if (!confirmed) return;
  }
  DRUM_GRID_SLOTS_PER_BEAT = newSlotsPerBeat;
  DRUM_GRID_TOTAL_SLOTS = newTotalSlots;
  drumGridSlots = newSlots;
  drumSelection = null;
  drumSelectionAnchor = null;
  drumSecondHalfOpen = newSlots.slice(DRUM_GRID_TOTAL_SLOTS / 2).some(col => col.some(Boolean));
  drumUndoStack = [];
  drumRedoStack = [];
  drumUnsavedTracker.markDirty();
  updateDrumAdvancedGridBtnLabel();
  renderDrumEditor();
  drumGridWrap.scrollLeft = 0;
});

// Duplicate: takes the selected rectangle (or, with nothing selected,
// the block CONTAINING the anchor column at the chosen block size,
// spanning all rows) and copies it into the immediately following
// block of columns, overwriting whatever was there -- same rule as
// Lead's own Duplicate, generalized to a full rectangle instead of a
// single note.
// Extracted from the drop handler below so it's independently testable,
// same reasoning as performDrumDuplicate/Copy/Paste. destRow/destCol/
// isLocked are passed in rather than closed over, since in the original
// inline handler they came from the render loop's per-cell scope.
function performDrumMove(destRow, destCol, isLocked){
  if (!drumDragSourceCell || isLocked || !drumSelection) return;
  if (drumDragSourceCell.row === destRow && drumDragSourceCell.col === destCol) { drumDragSourceCell = null; return; }
  const rowShift = destRow - drumDragSourceCell.row;
  const colShift = destCol - drumDragSourceCell.col;
  const newRowStart = drumSelection.rowStart + rowShift, newRowEnd = drumSelection.rowEnd + rowShift;
  const newColStart = drumSelection.colStart + colShift, newColEnd = drumSelection.colEnd + colShift;
  if (newRowStart < 0 || newRowEnd >= DRUM_SOUNDS.length || newColStart < 0 || newColEnd >= DRUM_GRID_TOTAL_SLOTS) {
    window.alert('Not enough room to move this selection there.');
    drumDragSourceCell = null;
    return;
  }
  const isSingleCell = drumSelection.rowStart === drumSelection.rowEnd && drumSelection.colStart === drumSelection.colEnd;
  const updated = drumGridSlots.map(col => [...col]);
  if (isSingleCell) {
    // single-cell move swaps with whatever's at the destination, never silently losing it
    const temp = updated[newColStart][newRowStart];
    updated[newColStart][newRowStart] = updated[drumSelection.colStart][drumSelection.rowStart];
    updated[drumSelection.colStart][drumSelection.rowStart] = temp;
  } else {
    // multi-cell block move: extract, clear the source, write the destination -- same rule Lead's own range-move already uses
    const content = [];
    for (let r = drumSelection.rowStart; r <= drumSelection.rowEnd; r++) {
      const rowContent = [];
      for (let c = drumSelection.colStart; c <= drumSelection.colEnd; c++) rowContent.push(drumGridSlots[c][r]);
      content.push(rowContent);
    }
    for (let r = drumSelection.rowStart; r <= drumSelection.rowEnd; r++) {
      for (let c = drumSelection.colStart; c <= drumSelection.colEnd; c++) updated[c][r] = false;
    }
    content.forEach((rowContent, ri) => {
      rowContent.forEach((val, ci) => { updated[newColStart + ci][newRowStart + ri] = val; });
    });
  }
  drumSelection = { rowStart: newRowStart, rowEnd: newRowEnd, colStart: newColStart, colEnd: newColEnd };
  drumSelectionAnchor = { row: newRowStart, col: newColStart };
  drumDragSourceCell = null;
  setDrumGridSlots(updated);
}

function performDrumDuplicate(){
  let rowStart, rowEnd, colStart, blockSize;
  if (drumSelection) {
    rowStart = drumSelection.rowStart; rowEnd = drumSelection.rowEnd;
    colStart = drumSelection.colStart;
    blockSize = drumSelection.colEnd - drumSelection.colStart + 1;
  } else {
    rowStart = 0; rowEnd = DRUM_SOUNDS.length - 1;
    blockSize = parseInt(document.getElementById('drumDupBlockSize').value, 10);
    const anchorCol = drumSelectionAnchor ? drumSelectionAnchor.col : 0;
    colStart = Math.floor(anchorCol / blockSize) * blockSize;
  }
  const targetStart = colStart + blockSize;
  if (targetStart >= DRUM_GRID_TOTAL_SLOTS) {
    window.alert('No room left in the grid to duplicate this into.');
    return;
  }
  if (targetStart + blockSize > DRUM_GRID_TOTAL_SLOTS / 2 && !drumSecondHalfOpen) {
    drumSecondHalfOpen = true; // duplicating into the second half is itself a genuine "engage" action
  }
  const updated = drumGridSlots.map(col => [...col]);
  for (let i = 0; i < blockSize && targetStart + i < DRUM_GRID_TOTAL_SLOTS; i++) {
    for (let r = rowStart; r <= rowEnd; r++) updated[targetStart + i][r] = drumGridSlots[colStart + i][r];
  }
  drumSelection = { rowStart, rowEnd, colStart: targetStart, colEnd: Math.min(targetStart + blockSize - 1, DRUM_GRID_TOTAL_SLOTS - 1) };
  drumSelectionAnchor = { row: rowStart, col: targetStart };
  setDrumGridSlots(updated);
}
document.getElementById('drumDupBtn').addEventListener('click', performDrumDuplicate);

function performDrumCopy(){
  if (!drumSelection) return; // nothing selected to copy
  const numRows = drumSelection.rowEnd - drumSelection.rowStart + 1;
  const numCols = drumSelection.colEnd - drumSelection.colStart + 1;
  const data = [];
  for (let r = 0; r < numRows; r++) {
    const rowData = [];
    for (let c = 0; c < numCols; c++) rowData.push(drumGridSlots[drumSelection.colStart + c][drumSelection.rowStart + r]);
    data.push(rowData);
  }
  drumClipboard = { numRows, numCols, data };
}
function performDrumPaste(){
  if (!drumClipboard) return;
  const pasteRowStart = drumSelectionAnchor ? drumSelectionAnchor.row : 0;
  const pasteColStart = drumSelectionAnchor ? drumSelectionAnchor.col : 0;
  const pasteRowEnd = pasteRowStart + drumClipboard.numRows - 1;
  const pasteColEnd = pasteColStart + drumClipboard.numCols - 1;
  if (pasteRowEnd >= DRUM_SOUNDS.length || pasteColEnd >= DRUM_GRID_TOTAL_SLOTS) {
    window.alert('Not enough room in the grid to paste here.');
    return;
  }
  if (pasteColEnd >= DRUM_GRID_TOTAL_SLOTS / 2 && !drumSecondHalfOpen) {
    drumSecondHalfOpen = true; // pasting into the second half is itself a genuine "engage" action
  }
  const updated = drumGridSlots.map(col => [...col]);
  drumClipboard.data.forEach((rowData, r) => {
    rowData.forEach((val, c) => { updated[pasteColStart + c][pasteRowStart + r] = val; });
  });
  drumSelection = { rowStart: pasteRowStart, rowEnd: pasteRowEnd, colStart: pasteColStart, colEnd: pasteColEnd };
  setDrumGridSlots(updated);
}
document.getElementById('drumCopyBtn').addEventListener('click', performDrumCopy);
document.getElementById('drumPasteBtn').addEventListener('click', performDrumPaste);

document.getElementById('drumLoadTemplateBtn').addEventListener('click', () => {
  const templateKey = document.getElementById('drumTemplateSelect').value;
  if (!templateKey) return;
  const barLength = Math.min(beatsPerBar * DRUM_GRID_SLOTS_PER_BEAT, DRUM_GRID_TOTAL_SLOTS);
  const firstBarHasContent = drumGridSlots.slice(0, barLength).some(col => col.some(Boolean));
  if (firstBarHasContent && !window.confirm('This will replace the first bar of the current pattern. Continue?')) return;
  loadDrumPatternTemplate(templateKey);
});

// Commits a completed lasso drag into the real selection. Added once,
// globally, rather than per-cell -- mouseup can land anywhere (even
// outside the grid entirely if the drag overshoots), so it needs to be
// heard regardless of which element it actually fires on.
document.addEventListener('mouseup', () => {
  if (drumLassoOrigin && drumLassoDidDrag && drumLassoPreview) {
    drumSelection = drumLassoPreview;
    drumSelectionAnchor = { row: drumLassoOrigin.row, col: drumLassoOrigin.col };
    drumLassoOrigin = null;
    drumLassoPreview = null;
    renderDrumEditor();
  } else if (drumLassoOrigin) {
    // mousedown happened but no drag occurred -- let the upcoming click event handle it as a plain click
    drumLassoOrigin = null;
    drumLassoPreview = null;
  }
});

// Keyboard shortcuts -- only active while the Drums tab itself is
// focused/active, same guard as Lead's own shortcuts, so these never
// interfere with typing in an input field or with other tabs' own
// Delete-to-remove-chip behavior.
document.addEventListener('keydown', (e) => {
  if (currentActiveMode !== 'drums') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && drumSelection) {
    e.preventDefault();
    const updated = drumGridSlots.map(col => [...col]);
    for (let r = drumSelection.rowStart; r <= drumSelection.rowEnd; r++) {
      for (let c = drumSelection.colStart; c <= drumSelection.colEnd; c++) updated[c][r] = false;
    }
    setDrumGridSlots(updated);
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoDrumGrid(); else undoDrumGrid();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redoDrumGrid();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    performDrumDuplicate();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    performDrumCopy();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    performDrumPaste();
  }
});

function buildDrumPatternPayload(){
  return {
    id: Date.now() + '-' + Math.random().toString(36).slice(2),
    slots: drumGridSlots.map(row => [...row]),
    patternLengthSlots: drumSecondHalfOpen ? DRUM_GRID_TOTAL_SLOTS : DRUM_GRID_TOTAL_SLOTS / 2,
    slotsPerBeat: DRUM_GRID_SLOTS_PER_BEAT,
    kit: drumKit,
    rowVolumes: [...drumRowVolumes],
    savedAt: Date.now(),
  };
}

function saveDrumPatternToEntry(entryIndex){
  const entry = progression[entryIndex];
  const existing = entry ? entry.drumPattern : null;
  const newPattern = { ...buildDrumPatternPayload(), id: existing ? existing.id : undefined, muted: existing ? existing.muted : undefined, solo: existing ? existing.solo : undefined };
  if (!newPattern.id) newPattern.id = Date.now() + '-' + Math.random().toString(36).slice(2);
  const updated = progression.map((en, i) => i === entryIndex ? { ...en, drumPattern: newPattern } : en);
  setProgression(updated);
  drumEditingEntryIndex = entryIndex;
  drumEditingPatternId = newPattern.id;
  drumUnsavedTracker.markClean();
}

// Genre pattern templates -- each defined for one 16-step (4/4) bar
// using standard, well-established genre conventions: basic rock beat,
// blues shuffle, jazz swing ride, funk syncopation, boom-bap hip-hop,
// reggae one-drop, and disco four-on-the-floor. Only sounds that are
// actually part of a given pattern appear in its map -- anything absent
// is simply left empty on load, same as an unedited grid.
const DRUM_PATTERN_TEMPLATES = {
  rock: {
    label: 'Rock (basic beat)',
    sounds: { kick: [0, 8], snare: [4, 12], closedHat: [0, 2, 4, 6, 8, 10, 12, 14] },
  },
  blues: {
    label: 'Blues (shuffle)',
    sounds: { kick: [0, 8], snare: [4, 12], closedHat: [0, 3, 4, 7, 8, 11, 12, 15] },
  },
  jazz: {
    label: 'Jazz (swing ride)',
    sounds: { kick: [0], snare: [10], closedHat: [4, 12], crash: [0, 3, 4, 7, 8, 11, 12, 15] },
  },
  funk: {
    label: 'Funk (16th syncopation)',
    sounds: { kick: [0, 3, 10], snare: [4, 12], closedHat: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
  },
  hiphop: {
    label: 'Hip-Hop (boom-bap)',
    sounds: { kick: [0, 6, 10], snare: [4, 12], closedHat: [0, 2, 4, 6, 8, 10, 12], openHat: [14] },
  },
  reggae: {
    label: 'Reggae (one-drop)',
    sounds: { kick: [8], snare: [8], closedHat: [2, 6, 10, 14] },
  },
  disco: {
    label: 'Disco (four-on-the-floor)',
    sounds: { kick: [0, 4, 8, 12], snare: [4, 12], closedHat: [0, 4, 8, 12], openHat: [2, 6, 10, 14] },
  },
  // The following are transcribed directly from a drum machine pattern
  // reference book (260-pattern collection), read column-by-column off
  // the grids and converted to this app's 0-indexed 16-step numbering.
  // Jazz 1/2 originate from a 12-column TRIPLET grid in the source (3
  // subdivisions per beat, not 4) -- converted to our straight 16-step
  // grid using the standard rounding for placing triplet content on a
  // 16th-note sequencer: each beat's 3 triplet positions (0, 1.33, 2.67)
  // map to the nearest available step (0, 1, 3). This is an
  // approximation of the original swing feel, not an exact match.
  funk1: {
    label: 'Funk 1 (book)',
    sounds: { kick: [0, 6, 8, 12], snare: [2, 10], closedHat: [0, 4, 8, 12], openHat: [15] },
  },
  funk2: {
    label: 'Funk 2 (book)',
    sounds: { kick: [0, 2, 6, 8, 12], snare: [6], closedHat: [0, 4, 8, 12], openHat: [2, 10], tomHigh: [10], tomLow: [14] },
  },
  jazz1: {
    label: 'Jazz 1 (book, triplet feel)',
    sounds: { kick: [0, 8], snare: [5, 13], crash: [0, 5, 8, 11, 13] },
  },
  jazz2: {
    label: 'Jazz 2 (book, triplet feel)',
    sounds: { kick: [0, 11], snare: [3, 11, 13], crash: [0, 5, 11, 13] },
  },
  pop2: {
    label: 'Pop 2 (book)',
    sounds: { kick: [0, 2, 8, 12, 14, 15], snare: [4, 10], closedHat: [0, 2, 4, 6, 8, 10, 12, 14] },
  },
  pop3: {
    label: 'Pop 3 (book)',
    sounds: { kick: [0, 2, 4, 12], snare: [4], closedHat: [0, 2, 4, 8, 12], openHat: [6, 14] },
  },
  rock2: {
    label: 'Rock 2 (book)',
    sounds: { kick: [0, 2, 6, 8, 12, 14], snare: [4, 12], closedHat: [0, 2, 4, 6, 8, 10, 12, 14] },
  },
  rock3: {
    label: 'Rock 3 (book)',
    sounds: { kick: [0, 8, 10], snare: [4, 12, 14], closedHat: [0, 2, 4, 6, 8, 10, 12, 14] },
  },
};

// Loads a template into the currently-open bar (the first 16 steps --
// one 4/4 bar). If the grid is longer than 16 steps, the rest is left
// untouched rather than guessed at; Duplicate is already the right tool
// to repeat the bar into the second half once it's loaded.
function loadDrumPatternTemplate(templateKey){
  const template = DRUM_PATTERN_TEMPLATES[templateKey];
  if (!template) return;
  const updated = drumGridSlots.map(col => [...col]);
  // Templates are always authored at 16th-note resolution (4 slots per
  // beat) -- their step numbers need scaling to whatever resolution is
  // actually live right now, or Advanced mode (8 slots per beat) would
  // squeeze the whole pattern into the first half of each beat instead
  // of spanning the intended musical duration.
  const TEMPLATE_AUTHORING_SLOTS_PER_BEAT = 4;
  const barLength = Math.min(beatsPerBar * DRUM_GRID_SLOTS_PER_BEAT, DRUM_GRID_TOTAL_SLOTS);
  for (let c = 0; c < barLength; c++) updated[c] = Array(DRUM_SOUNDS.length).fill(false);
  DRUM_SOUNDS.forEach((sound, rowIdx) => {
    const steps = template.sounds[sound];
    if (!steps) return;
    steps.forEach(step => {
      const scaledStep = remapSlotIndex(step, TEMPLATE_AUTHORING_SLOTS_PER_BEAT, DRUM_GRID_SLOTS_PER_BEAT);
      if (scaledStep < barLength) updated[scaledStep][rowIdx] = true;
    });
  });
  drumSelection = null;
  drumSelectionAnchor = null;
  setDrumGridSlots(updated);
}

function loadDrumPatternFromEntry(entryIndex){
  const entry = progression[entryIndex];
  if (!entry || !entry.drumPattern) return;
  // Different patterns can now be saved at different grid resolutions
  // (Advanced mode doubles slots-per-beat). Restore THIS pattern's own
  // resolution before assigning its slots or computing anything derived
  // from DRUM_GRID_TOTAL_SLOTS -- old saved patterns with no
  // slotsPerBeat field default to 4, the resolution that always existed
  // before this feature.
  DRUM_GRID_SLOTS_PER_BEAT = entry.drumPattern.slotsPerBeat || 4;
  DRUM_GRID_TOTAL_SLOTS = DRUM_GRID_BEATS * DRUM_GRID_SLOTS_PER_BEAT;
  drumGridSlots = entry.drumPattern.slots.map(row => [...row]);
  drumKit = entry.drumPattern.kit;
  drumKitSelect.value = drumKit;
  drumRowVolumes = DRUM_SOUNDS.map((s, i) => (entry.drumPattern.rowVolumes && entry.drumPattern.rowVolumes[i] !== undefined) ? entry.drumPattern.rowVolumes[i] : 100);
  drumEditingEntryIndex = entryIndex;
  drumEditingPatternId = entry.drumPattern.id;
  drumSelection = null;
  drumSelectionAnchor = null;
  // saved data in the second half should never be hidden behind a locked
  // state -- only a genuinely fresh/empty second half stays closed
  drumSecondHalfOpen = drumGridSlots.slice(DRUM_GRID_TOTAL_SLOTS / 2).some(col => col.some(Boolean));
  // fresh pattern, fresh history -- the old undo/redo stack belongs to
  // whatever was being edited before
  drumUndoStack = [];
  drumRedoStack = [];
  drumUnsavedTracker.markClean();
  updateDrumUndoRedoButtons();
  updateDrumAdvancedGridBtnLabel();
  renderDrumEditor();
  drumGridWrap.scrollLeft = 0;
}

document.getElementById('drumSaveBtn').addEventListener('click', () => {
  const hasAnyHit = drumGridSlots.some(row => row.some(Boolean));
  if (!hasAnyHit) {
    window.alert('Add at least one hit to the grid first.');
    return;
  }
  if (drumEditingEntryIndex !== null && progression[drumEditingEntryIndex]) {
    saveDrumPatternToEntry(drumEditingEntryIndex); // already linked to a chord -- update it in place, no need to re-pick a target
  } else {
    showDrumTargetPicker();
  }
});

function showDrumTargetPicker(){
  if (progression.length === 0) {
    window.alert('Your progression is empty -- add some chords on the Chart tab first, then come back to save this pattern to one of them.');
    return;
  }
  leadTargetTitle.textContent = 'Save Drum Pattern To...'; // reuses the same overlay as the Lead tab's target pickers
  leadTargetBody.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'modulation-list';
  progression.forEach((entry, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'modulation-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'modulation-row-name';
    nameSpan.textContent = entry.chordName + (entry.drumPattern ? ' (has a pattern -- will replace it)' : '');
    row.appendChild(nameSpan);
    row.addEventListener('click', () => {
      saveDrumPatternToEntry(i);
      closeLeadTargetPicker();
    });
    list.appendChild(row);
  });
  leadTargetBody.appendChild(list);
  leadTargetOverlay.style.display = 'flex';
}

function playMetronomeTick(accented, startTimeOverride){
  const ctx = getChartToneCtx();
  const now = (startTimeOverride !== undefined && startTimeOverride !== null) ? startTimeOverride : ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = accented ? 1600 : 1100;
  gain.gain.setValueAtTime(0.22, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
  osc.start(now); osc.stop(now + 0.06);
}

function stopPlayback(){
  isPlaying = false;
  activeTimeoutIds.forEach(id => clearTimeout(id));
  activeTimeoutIds = [];
  currentPlayIndex = -1;
  updateTimelineHighlight();
  progressionPlayBtn.disabled = false;
  progressionStopBtn.disabled = true;
  window.__hardStopAllAudio(getChartToneCtx());
}

// Loops or truncates a saved pattern's content to exactly fill however
// many slots the chord it's attached to actually spans -- a chord's own
// beats/bar count can change after a pattern was drawn (that's the whole
// point of duplicating one pattern across several chords and then
// adjusting bar lengths later), and a pattern should never just go silent
// early or bleed into the next chord because of that. `getSlotContent`
// abstracts over drum rows (2D: content per sound per slot) vs lead grid
// slots (1D: one note per slot) so this one function covers both.
function forEachLoopedSlot(pattern, chordDurationSlots, fallbackHalfLength, getSlotContent, callback){
  const totalRawSlots = pattern.slots.length;
  // Fallback for patterns saved before patternLengthSlots existed: rather
  // than guessing a fixed default, actually check whether the second half
  // has any real content -- if it does, treat the pattern as full-length
  // (nothing saved is lost); if it's genuinely empty, treat it as half-length
  // (so it loops to fill a longer chord, the same as a freshly-saved one would).
  let patternLen = pattern.patternLengthSlots;
  if (!patternLen) {
    const secondHalfHasContent = Array.from({ length: totalRawSlots - fallbackHalfLength }, (_, i) => fallbackHalfLength + i)
      .some(slotIdx => getSlotContent(pattern, slotIdx));
    patternLen = secondHalfHasContent ? totalRawSlots : fallbackHalfLength;
  }
  for (let i = 0; i < chordDurationSlots; i++){
    const sourceIdx = i % patternLen; // loop if chordDurationSlots > patternLen, truncate (loop body just never reaches beyond) if shorter
    if (sourceIdx >= totalRawSlots) continue; // safety guard, shouldn't normally trigger
    callback(i, sourceIdx);
  }
}

// Whether ANY part of this one chord's own stack -- the chord itself,
// any lead/bass layer on it, or its drum pattern -- is currently
// soloed. Solo is scoped to a single chord's stack, not the whole
// progression: soloing the bass layer on chord #2 mutes the rest of
// chord #2's own stack (its chord audio, other leads, its drums), and
// has no effect at all on any other chord elsewhere in the progression.
function isAnyPartOfStackSoloed(entry){
  return !!entry.solo
    || !!entry.leadPatternSolo
    || getEntryLeadGrids(entry).some(g => g.solo)
    || !!(entry.drumPattern && entry.drumPattern.solo);
}

// The actual audio-scheduling for one chord's slot: chord, bass, top
// note, both lead styles, and drums. Deliberately excludes anything
// live-playback-only (UI highlight updates, metronome ticks) -- this is
// exactly what an offline render needs too, called immediately in a
// loop instead of deferred behind a wall-clock setTimeout, and exactly
// what live playback needs, called from inside its setTimeout once the
// wall-clock delay elapses. Keeping this in one place means the two can
// never schedule something different from each other.
function scheduleChordAudio(entry, i, ctx, chordStartTime, audioDur, chordAudible, chordVolumeMult, anyStackSoloed){
  const shape = lookupEntryShape(entry);
  if (shape && chordAudible) playChordShape(shape, renderedChipElements[i], entry.strumPattern, audioDur, octaveDoubleToggle.checked, chordStartTime, chordVolumeMult);
  if (shape && chordAudible && topNoteToggle.checked) {
    const topPitchClass = getTopPitchClass(shape);
    if (topPitchClass !== null) playTopNoteTone(ctx, topPitchClass, chordStartTime, audioDur, chordVolumeMult);
  }
  if (entry.leadPattern && entry.leadPattern.length > 0 && (!anyStackSoloed || entry.leadPatternSolo) && !entry.leadPatternMuted) {
    const orderedLeadNotes = applyPatternToLeadNotes(entry.leadPattern, entry.leadPatternType || 'asPlayed');
    const leadStagger = (STRUM_PATTERN_CONFIG[entry.leadPatternType || 'asPlayed'] || STRUM_PATTERN_CONFIG.asPlayed).getStagger;
    const leadPatternVolumeMult = (entry.leadPatternVolume !== undefined && entry.leadPatternVolume !== null) ? entry.leadPatternVolume / 100 : 1.0;
    orderedLeadNotes.forEach((note, noteIdx) => {
      const startAt = chordStartTime + leadStagger(noteIdx);
      const remaining = Math.max(0.3, audioDur - leadStagger(noteIdx));
      playMelodyNoteTone(ctx, note, startAt, remaining, undefined, leadPatternVolumeMult);
    });
  }
  getEntryLeadGrids(entry).forEach(leadLayer => {
    if ((anyStackSoloed && !leadLayer.solo) || leadLayer.muted) return;
    const leadSlotsPerBeat = leadLayer.slotsPerBeat || 4; // this layer's OWN resolution, not the live editor's -- different layers can be saved at different resolutions (Advanced mode)
    const gridSlotMs = beatMs() / leadSlotsPerBeat; // the chord's own live tempo, not a frozen value from when the lead was saved -- guarantees every layer and its chord can never run on different clocks
    const leadVolumeMult = (leadLayer.volume !== undefined && leadLayer.volume !== null) ? leadLayer.volume / 100 : 1.0;
    // The LAST note in a lead, if nothing else is filled after it,
    // always gets a fixed 2-beat duration with a 50% hold-then-fade
    // envelope (full volume for the first half, fading out over the
    // second half) -- rather than the old "ring to the end of the
    // grid" default, or an earlier attempt at a flat one-bar cap.
    const lastNoteSlots = 2 * leadSlotsPerBeat; // fixed 2-beat "count", independent of chord duration or tempo-derived bar length
    const chordDurationSlots = (entry.beats || 4) * leadSlotsPerBeat;
    // Loop or truncate this layer's content to exactly fill the
    // chord's actual duration -- same reasoning as drum patterns:
    // a chord's bar count can change after the lead was drawn, and
    // the lead shouldn't silently go quiet early or bleed into the
    // next chord because of that.
    const totalRawSlots = leadLayer.slots.length;
    let patternLen = leadLayer.patternLengthSlots;
    if (!patternLen) {
      const fallbackHalf = totalRawSlots / 2; // half of THIS layer's own saved array, not the live editor's current total (which could be a different resolution/bar-count entirely)
      const secondHalfHasContent = leadLayer.slots.slice(fallbackHalf).some(Boolean);
      patternLen = secondHalfHasContent ? totalRawSlots : fallbackHalf;
    }
    const loopedSlots = [];
    for (let i = 0; i < chordDurationSlots; i++) {
      const sourceIdx = i % patternLen;
      loopedSlots.push(sourceIdx < totalRawSlots ? leadLayer.slots[sourceIdx] : null);
    }
    loopedSlots.forEach((note, slotIdx) => {
      if (!note) return;
      let nextFilledIdx = null;
      for (let j = slotIdx + 1; j < loopedSlots.length; j++) {
        if (loopedSlots[j]) { nextFilledIdx = j; break; }
      }
      const startAt = chordStartTime + (slotIdx * gridSlotMs) / 1000;
      if (nextFilledIdx === null) {
        const cappedEndSlot = Math.min(loopedSlots.length, slotIdx + lastNoteSlots);
        const lastNoteDurationSeconds = Math.max(0.15, ((cappedEndSlot - slotIdx) * gridSlotMs) / 1000);
        playNoteWithCustomFade(ctx, note, startAt, lastNoteDurationSeconds, leadLayer.toneType, 0.5, leadVolumeMult);
        return;
      }
      const noteDurationSeconds = Math.max(0.15, ((nextFilledIdx - slotIdx) * gridSlotMs) / 1000);
      playMelodyNoteTone(ctx, note, startAt, noteDurationSeconds, leadLayer.toneType, leadVolumeMult);
    });
  });
  if (entry.drumPattern && (!anyStackSoloed || entry.drumPattern.solo) && !entry.drumPattern.muted) {
    const drumSlotsPerBeat = entry.drumPattern.slotsPerBeat || 4; // this pattern's OWN resolution, not the live editor's
    const drumGridSlotMs = beatMs() / drumSlotsPerBeat; // the chord's own live tempo, same discipline as grid-leads -- a drum pattern can never drift from its chord regardless of what tempo it was built at
    const drumVolumeMult = (entry.drumPattern.volume !== undefined && entry.drumPattern.volume !== null) ? entry.drumPattern.volume / 100 : 1.0;
    const chordDurationSlots = (entry.beats || 4) * drumSlotsPerBeat;
    forEachLoopedSlot(
      entry.drumPattern, chordDurationSlots, entry.drumPattern.slots.length / 2, // half of THIS pattern's own saved array, not the live editor's current total
      (pattern, slotIdx) => pattern.slots[slotIdx] && pattern.slots[slotIdx].some(Boolean),
      (targetSlotIdx, sourceSlotIdx) => {
        const slotRow = entry.drumPattern.slots[sourceSlotIdx];
        DRUM_SOUNDS.forEach((sound, rowIdx) => {
          if (!slotRow[rowIdx]) return;
          const rowVol = (entry.drumPattern.rowVolumes && entry.drumPattern.rowVolumes[rowIdx] !== undefined) ? entry.drumPattern.rowVolumes[rowIdx] / 100 : 1.0;
          playDrumSound(ctx, entry.drumPattern.kit, sound, chordStartTime + (targetSlotIdx * drumGridSlotMs) / 1000, drumVolumeMult * rowVol);
        });
      }
    );
  }
}

function playProgressionThrough(){
  if (progression.length === 0) return;
  const sectionFilter = loopSectionSelect.value;
  const entriesToPlay = progression
    .map((entry, i) => ({ entry, i }))
    .filter(x => !sectionFilter || x.entry.section === sectionFilter);
  if (entriesToPlay.length === 0) return; // selected section has no chords (shouldn't normally happen, but don't schedule an empty loop if it does)

  stopPlayback(); // cancel any prior run cleanly before starting a new one
  isPlaying = true;
  progressionPlayBtn.disabled = true;
  progressionStopBtn.disabled = false;

  function runOnce(){
    const ctx = getChartToneCtx();
    const playbackStartTime = ctx.currentTime; // single fixed reference for this whole run -- every audio event below is computed from THIS, not from ctx.currentTime read again later inside a possibly-late callback
    // Every tone function's envelope fades to silence over its final ~150ms
    // (needed to avoid a click when a note/oscillator stops) -- if a
    // chord's audio duration exactly matches its nominal slot, that fade
    // lands right at the boundary with the next chord, which is itself
    // just starting its own attack ramp from silence. The combination
    // reads as an audible dip/gap even though the SCHEDULING is precise.
    // Extending the actual audio slightly past the nominal boundary means
    // the fade instead overlaps into the next chord, which is already at
    // full volume by then -- masking the transition instead of exposing it.
    const CHORD_AUDIO_OVERLAP_SECONDS = 0.15;
    let elapsed = 0;
    let globalBeatIndex = 0; // continuous beat counter across all chords, for the metronome's every-4th-beat accent
    // Mute/Solo -- scoped to each chord's own stack (its chord audio,
    // any lead/bass layers, its drums), not the whole progression.
    // Soloing the bass layer on one chord mutes the rest of THAT
    // chord's stack only; it has no effect on any other chord.
    entriesToPlay.forEach(({ entry, i }) => {
      const anyStackSoloed = isAnyPartOfStackSoloed(entry);
      const chordAudible = (!anyStackSoloed || entry.solo) && !entry.muted;
      const chordVolumeMult = (entry.volume !== undefined && entry.volume !== null) ? entry.volume / 100 : 1.0;
      const durMs = (entry.beats || 4) * beatMs();
      const chordStartTime = playbackStartTime + elapsed / 1000; // this chord's exact intended start, computed up front
      const audioDur = durMs / 1000 + CHORD_AUDIO_OVERLAP_SECONDS;
      const id = setTimeout(() => {
        currentPlayIndex = i;
        updateTimelineHighlight();
        const shape = lookupEntryShape(entry);
        updateFretboardPanel(shape, entry.chordName, entry.rootIndex, i);
        updateChartPianoPanel(shape, entry.chordName, entry.rootIndex);
        scheduleChordAudio(entry, i, ctx, chordStartTime, audioDur, chordAudible, chordVolumeMult, anyStackSoloed);
      }, elapsed);
      activeTimeoutIds.push(id);

      // Metronome ticks for this chord's beats -- scheduled against the
      // SAME fixed playbackStartTime reference as the chord audio above,
      // so metronome and chords can never drift relative to each other
      // no matter how late any individual setTimeout callback fires.
      // Tracked in the same activeTimeoutIds array as everything else,
      // so Stop cancels pending ticks too without a separate mechanism.
      if (metronomeToggle.checked) {
        const beatMsValue = beatMs();
        for (let b = 0; b < (entry.beats || 4); b++) {
          const beatElapsed = elapsed + b * beatMsValue;
          const tickTime = playbackStartTime + beatElapsed / 1000;
          const accented = globalBeatIndex % beatsPerBar === 0;
          const tickId = setTimeout(() => playMetronomeTick(accented, tickTime), beatElapsed);
          activeTimeoutIds.push(tickId);
          globalBeatIndex++;
        }
      }

      elapsed += durMs;
    });
    const endId = setTimeout(() => {
      if (loopToggle.checked && isPlaying) {
        runOnce();
      } else {
        stopPlayback();
      }
    }, elapsed);
    activeTimeoutIds.push(endId);
  }
  runOnce();
}

// Renders the current progression (or a selected section, matching the
// Loop Section dropdown) into a finished audio buffer using
// OfflineAudioContext -- same scheduling as live playback
// (scheduleChordAudio, shared above), just scheduled immediately in one
// pass instead of deferred behind wall-clock setTimeout calls. Respects
// whatever the current UI toggle state actually is (bass notes, top
// note, octave double, mute/solo), since scheduleChordAudio reads those
// live -- the export always matches what pressing Play would sound
// like right now, not a separately-maintained "export settings" concept.
async function renderProgressionOffline(){
  if (progression.length === 0) return null;
  const sectionFilter = loopSectionSelect.value;
  const entriesToPlay = progression
    .map((entry, i) => ({ entry, i }))
    .filter(x => !sectionFilter || x.entry.section === sectionFilter);
  if (entriesToPlay.length === 0) return null;

  const totalDurMs = entriesToPlay.reduce((sum, { entry }) => sum + (entry.beats || 4) * beatMs(), 0);
  const TAIL_SECONDS = 2; // generous fixed tail so the last note's release/fade is never cut off by the buffer ending exactly where the nominal duration does
  const totalSeconds = totalDurMs / 1000 + TAIL_SECONDS;

  const SAMPLE_RATE = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(totalSeconds * SAMPLE_RATE), SAMPLE_RATE);

  // Pre-load only the samples this progression actually needs, same
  // "only what's in use" discipline as showChartMode -- an export should
  // never kick off loading a kit nobody's using.
  const usedDrumKits = new Set(entriesToPlay.map(x => x.entry.drumPattern && x.entry.drumPattern.kit).filter(Boolean));
  const usedBassSampleTypes = new Set(
    entriesToPlay
      .flatMap(x => getEntryLeadGrids(x.entry).map(g => g.toneType))
      .filter(toneType => toneType === 'electricbass' || toneType === 'doublebass')
  );
  await Promise.all([
    window.__toneEngine.ensurePianoLoaded(ctx),
    ...[...usedDrumKits].map(kit => ensureDrumSamplesLoaded(ctx, kit)),
    ...[...usedBassSampleTypes].map(type => window.__toneEngine.ensureBassSampleLoaded(ctx, type)),
  ]);

  const CHORD_AUDIO_OVERLAP_SECONDS = 0.15; // same overlap trick as live playback -- masks the transition between chords instead of exposing a click/gap
  let elapsed = 0;
  entriesToPlay.forEach(({ entry, i }) => {
    const anyStackSoloed = isAnyPartOfStackSoloed(entry);
    const chordAudible = (!anyStackSoloed || entry.solo) && !entry.muted;
    const chordVolumeMult = (entry.volume !== undefined && entry.volume !== null) ? entry.volume / 100 : 1.0;
    const durMs = (entry.beats || 4) * beatMs();
    const chordStartTime = elapsed / 1000; // offline rendering's own clock starts at 0 -- ctx.currentTime is meaningless here since nothing has actually started rendering yet
    const audioDur = durMs / 1000 + CHORD_AUDIO_OVERLAP_SECONDS;
    scheduleChordAudio(entry, i, ctx, chordStartTime, audioDur, chordAudible, chordVolumeMult, anyStackSoloed);
    elapsed += durMs;
  });

  return await ctx.startRendering();
}

// Converts a rendered AudioBuffer into a standard 16-bit PCM WAV file.
// Web Audio only decodes audio formats, it doesn't encode any -- WAV is
// uncompressed and simple enough (a 44-byte header, then raw interleaved
// samples) to write by hand without needing a library for it.
function audioBufferToWavBlob(audioBuffer){
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels and convert float samples (-1..1) to 16-bit
  // signed PCM, clamping so an accidental slightly-over-1.0 peak can
  // never wrap around into a loud noise burst instead of just clipping.
  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) channelData.push(audioBuffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7FFF), true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

progressionPlayBtn.addEventListener('click', playProgressionThrough);
progressionStopBtn.addEventListener('click', stopPlayback);

const exportWavBtn = document.getElementById('exportWavBtn');
exportWavBtn.addEventListener('click', async () => {
  if (progression.length === 0) {
    window.alert('Your progression is empty -- add some chords first.');
    return;
  }
  const originalLabel = exportWavBtn.textContent;
  exportWavBtn.textContent = 'Rendering...';
  exportWavBtn.disabled = true;
  try {
    const audioBuffer = await renderProgressionOffline();
    if (!audioBuffer) return; // matches renderProgressionOffline's own guards (e.g. the selected section loop filter matching nothing)
    const blob = audioBufferToWavBlob(audioBuffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frequency-target-replicator-progression.wav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('WAV export failed:', err);
    window.alert('Something went wrong rendering the WAV file. Check the browser console for details.');
  } finally {
    exportWavBtn.textContent = originalLabel;
    exportWavBtn.disabled = false;
  }
});

// Builds one fully-wired chart card: diagram, mod dropdown, arp toggle,
// add/remove toggle, keyboard handling, highlight-tracking registration --
// everything. Used for normal diatonic degrees, and designed so secondary
// dominants, borrowed chords, and inversions can all be built from this
// same function later instead of duplicating this logic per feature.
//
// degreeIdx is optional -- diatonic cards pass their real 0-6 index (used
// for the Tonic/Subdominant/Dominant function badge); non-diatonic cards
// (a secondary dominant, a borrowed chord) can omit it, and the badge is
// simply skipped, since "function" in the classical sense doesn't cleanly
// apply to a chord that isn't a plain diatonic degree.
// Secondary dominants: the V7 that would tonicize a given diatonic degree,
// borrowed temporarily for stronger motion toward it. Skips the tonic
// itself (there's no "V of I" in this sense -- that's just the plain V)
// and any degree whose own diatonic quality is diminished (standard
// practice doesn't tonicize a diminished chord this way).
function computeSecondaryDominants(tonicIndex, modeName){
  const modeData = MODES_TABLE[modeName];
  const results = [];
  modeData.intervals.forEach((interval, i) => {
    if (i === 0) return;
    if (modeData.qualities[i] === 'dim') return;
    const targetRoot = (tonicIndex + interval) % 12;
    const dominantRoot = (targetRoot + 7) % 12; // a fifth above the target
    results.push({
      rootIndex: dominantRoot,
      suffix: '7',
      label: 'V7/' + modeData.labels[i],
      targetDegreeIdx: i,
    });
  });
  return results;
}

// Borrowed chords (modal interchange): contrasts the mode you're browsing
// against the single most pedagogically relevant opposite-quality
// reference -- Aeolian for major-family modes (Ionian/Lydian/Mixolydian),
// Ionian for everything else -- rather than cross-referencing all 9 modes,
// which would be overwhelming. Only chords that are genuinely DIFFERENT
// from what's already diatonically available in the current mode are
// shown; this is computed by comparing actual (root, suffix) pairs, not
// hardcoded per mode, so it's automatically correct no matter which mode
// you're browsing.
function getBorrowedReferenceMode(currentModeName){
  return ['Ionian','Lydian','Mixolydian'].includes(currentModeName) ? 'Aeolian' : 'Ionian';
}
function computeBorrowedChords(tonicIndex, currentModeName){
  const currentModeData = MODES_TABLE[currentModeName];
  const currentPairs = new Set(currentModeData.intervals.map((interval, i) => {
    const root = (tonicIndex + interval) % 12;
    return root + ':' + QUALITY_TO_SUFFIX[currentModeData.qualities[i]];
  }));
  const refModeName = getBorrowedReferenceMode(currentModeName);
  if (refModeName === currentModeName) return [];
  const refModeData = MODES_TABLE[refModeName];
  const results = [];
  refModeData.intervals.forEach((interval, i) => {
    if (i === 0) return; // replacing the tonic itself is a mode change, not "borrowing a color chord" -- same treatment as secondary dominants
    const root = (tonicIndex + interval) % 12;
    const suffix = QUALITY_TO_SUFFIX[refModeData.qualities[i]];
    if (currentPairs.has(root + ':' + suffix)) return; // already diatonically available, not actually "borrowed"
    results.push({
      rootIndex: root,
      suffix,
      label: refModeData.labels[i],
      sourceModeName: refModeName,
    });
  });
  return results;
}

/**
 * @param {{
 *   rootIndex: number, suffix: string, label: string, modeName: string,
 *   degreeIdx?: number, pivotModes?: string[],
 *   explanation?: string, linkedTargetCard?: HTMLElement, isSpecial?: boolean
 * }} opts degreeIdx/pivotModes are only ever passed for diatonic chords;
 *   explanation/linkedTargetCard/isSpecial are only ever passed for
 *   secondary-dominant and borrowed-chord cards. Each caller passes only
 *   the fields relevant to its own card type -- the rest are
 *   intentionally left undefined, not omitted by mistake.
 */
// Every rendered card that hasn't been individually overridden follows
// the global Pattern dropdown live for actual playback (see
// effectiveCardStrumPattern below), but its displayed label only
// updates when something calls its own refreshPatternRow. This registry
// lets the dropdown's own change handler (in tuner.js) refresh every
// visible card's label in one pass, without needing to know anything
// about how cards are built -- cards that DO have their own override
// are harmless to refresh too, since effectiveCardStrumPattern just
// returns their unchanged override either way.
let cardPatternRowRefreshers = [];
window.__refreshAllCardPatternRows = function(){
  cardPatternRowRefreshers.forEach(fn => fn());
};

function createChartCard({ rootIndex, suffix: baseSuffix, label, modeName, degreeIdx, explanation, linkedTargetCard, isSpecial, pivotModes }){
  // mutable per-card state -- the mod dropdown changes this, and
  // everything else on the card (name, diagram, sound, add-to-progression)
  // stays in sync with whatever it's currently set to
  let currentSuffix = baseSuffix;
  let currentShape = null;
  let cardStrumPattern = 'block'; // only meaningful once cardStrumPatternOverridden is true
  let cardStrumPatternOverridden = false; // becomes true the moment this specific card's pattern-nav arrows are used; until then, the card follows the global Pattern dropdown live
  let octaveShift = 0; // 0 = normal, 1/2/3 = shifted up that many octaves, cycled via the octave-nav row
  let voicingIndex = 0; // which alternate voicing/inversion is currently shown; reset to 0 whenever the suffix changes

  // Special cards (secondary dominants, borrowed chords) use exact
  // root+suffix matching instead of the normal root-only matching --
  // otherwise they'd show as "already added" just from sharing a root with
  // some unrelated chord already in the progression (very common for
  // secondary dominants specifically, since their root is literally "a
  // fifth above an existing diatonic root").
  function findMatch(){
    return isSpecial ? findExactEntry(rootIndex, currentSuffix) : findLinkedEntry(rootIndex);
  }

  // Deliberately NOT a real <button> for the card itself -- it contains
  // nested interactive children (the mod select, the add/arp buttons),
  // and a <button> is not allowed to contain other interactive content
  // per the HTML spec (browsers will mishandle the nesting). role="button"
  // + tabindex + explicit key handling gives the same keyboard behavior
  // without that invalid nesting.
  const card = document.createElement('div');
  card.className = 'chart-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const modSelect = document.createElement('select');
  modSelect.className = 'chart-card-mod';
  function rebuildModOptions(suffixToSelect){
    const bucket = suffixToQualityBucket(suffixToSelect);
    modSelect.innerHTML = '';
    const baseOptions = simpleMode ? MOD_OPTIONS_SIMPLE[bucket] : MOD_OPTIONS[bucket];
    const alreadyIncluded = baseOptions.some(opt => opt.value === suffixToSelect);
    // If Simple Mode hid the option matching what's already selected (an
    // advanced suffix picked before the toggle was turned on), add it
    // back in from the full list so the current choice is never silently
    // replaced or hidden -- only what's offered to pick NEXT is limited.
    const currentOption = !alreadyIncluded ? MOD_OPTIONS[bucket].find(opt => opt.value === suffixToSelect) : null;
    const options = currentOption ? [...baseOptions, currentOption] : baseOptions;
    options.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === suffixToSelect) o.selected = true;
      modSelect.appendChild(o);
    });
  }
  rebuildModOptions(baseSuffix);
  modSelect.addEventListener('click', (e) => e.stopPropagation());
  card.appendChild(modSelect);

  // Single toggling button, not two separate ones: shows '+' and adds
  // when this chord isn't in the progression yet, swaps to a minus and
  // removes when it already is.
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'chart-card-add';
  function refreshToggleBtn(){
    const linked = findMatch();
    toggleBtn.textContent = linked ? '\u2212' : '+';
    toggleBtn.setAttribute('aria-label', linked ? 'Remove from progression' : 'Add to progression');
    toggleBtn.setAttribute('aria-pressed', linked ? 'true' : 'false');
    toggleBtn.classList.toggle('remove-mode', !!linked);
  }
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const linked = findMatch();
    if (linked) {
      const linkedIdx = progression.indexOf(linked);
      if (linkedIdx === -1) return;
      setProgression(progression.filter((_, i) => i !== linkedIdx));
    } else {
      const chordName = NOTE_NAMES[rootIndex] + currentSuffix;
      addToProgression({ chordName, label, modeName, rootIndex, suffix: currentSuffix, voicingIndex, strumPattern: effectiveCardStrumPattern(), octaveShift });
    }
  });
  card.appendChild(toggleBtn);

  const degreeEl = document.createElement('div');
  degreeEl.className = 'chart-card-degree';
  degreeEl.textContent = label;
  card.appendChild(degreeEl);

  if (degreeIdx !== undefined && degreeIdx !== null) {
    const degreeName = DEGREE_NAME[degreeIdx];
    const colorFamily = FUNCTION_COLOR_FAMILY[degreeIdx];
    const functionEl = document.createElement('div');
    functionEl.className = 'chart-card-function chart-card-function-' + colorFamily;
    functionEl.textContent = degreeName;
    card.appendChild(functionEl);
  }

  if (pivotModes && pivotModes.length > 0) {
    const pivotBadge = document.createElement('div');
    pivotBadge.className = 'chart-card-pivot-badge';
    pivotBadge.textContent = '\u21c4 Pivot';
    pivotBadge.title = 'Also appears in: ' + pivotModes.join(', ');
    card.appendChild(pivotBadge);
  }

  // "Explain this chord" -- a short, always-available bit of context on
  // what this chord's role actually is and how it tends to behave, not
  // just its name. Uses the per-degree explanation when this is a plain
  // diatonic card; non-diatonic cards (secondary dominants, borrowed
  // chords) get whatever generic explanation the caller passed in instead.
  const resolvedExplanation = explanation || (degreeIdx !== undefined && degreeIdx !== null ? DEGREE_EXPLANATION[degreeIdx] : null);
  if (resolvedExplanation) {
    const infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.className = 'chart-card-info-btn';
    infoBtn.textContent = '\u24d8'; // circled letter i
    infoBtn.setAttribute('aria-label', 'Explain this chord');
    infoBtn.setAttribute('aria-expanded', 'false');
    const explanationEl = document.createElement('div');
    explanationEl.className = 'chart-card-explanation';
    explanationEl.textContent = resolvedExplanation;
    explanationEl.style.display = 'none';
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const showing = explanationEl.style.display !== 'none';
      explanationEl.style.display = showing ? 'none' : 'block';
      infoBtn.setAttribute('aria-expanded', showing ? 'false' : 'true');
      infoBtn.classList.toggle('active', !showing);
    });
    card.appendChild(infoBtn);
    card.appendChild(explanationEl);
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'chart-card-name';
  card.appendChild(nameEl);

  const diagramSlot = document.createElement('div');
  card.appendChild(diagramSlot);

  const keyboardSlot = document.createElement('div');
  keyboardSlot.className = 'chart-card-keyboard';
  card.appendChild(keyboardSlot);

  // Alternate voicings/inversions -- chords-db has real, distinct fingerings
  // for the same chord at different neck positions (up to 4 for a plain
  // triad); previously only the first one was ever shown. Cycling through
  // them and labeling the actual bass note turns "here's *a* shape" into
  // "here's every way to play this, including which ones are inversions."
  const voicingRow = document.createElement('div');
  voicingRow.className = 'chart-card-voicing-row';
  const voicingPrevBtn = document.createElement('button');
  voicingPrevBtn.type = 'button';
  voicingPrevBtn.className = 'chart-card-voicing-nav';
  voicingPrevBtn.textContent = '\u25c0';
  voicingPrevBtn.setAttribute('aria-label', 'Previous voicing');
  const voicingLabel = document.createElement('span');
  voicingLabel.className = 'chart-card-voicing-label';
  voicingLabel.addEventListener('click', (e) => e.stopPropagation()); // seal the whole nav row against click-bleed into the card's own preview-play handler, matching the arrows on either side
  const voicingNextBtn = document.createElement('button');
  voicingNextBtn.type = 'button';
  voicingNextBtn.className = 'chart-card-voicing-nav';
  voicingNextBtn.textContent = '\u25b6';
  voicingNextBtn.setAttribute('aria-label', 'Next voicing');
  function syncVoicingToLinkedEntry(){
    const linked = findMatch();
    if (!linked) return;
    const linkedIdx = progression.indexOf(linked);
    if (linkedIdx === -1) return;
    const updated = progression.map((e, i) => i === linkedIdx ? { ...e, voicingIndex, octaveShift } : e);
    setProgression(updated, { skipRender: true });
  }
  voicingPrevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (voicingIndex > 0) { voicingIndex--; octaveShift = 0; refreshCard(); syncVoicingToLinkedEntry(); }
  });
  voicingNextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    voicingIndex++; octaveShift = 0; refreshCard(); syncVoicingToLinkedEntry();
  });
  voicingRow.appendChild(voicingPrevBtn);
  voicingRow.appendChild(voicingLabel);
  voicingRow.appendChild(voicingNextBtn);
  card.appendChild(voicingRow);

  // Strum pattern control -- same cycling interaction as the voicing row
  // above it, so a card gets the same 6 patterns available to chips
  // without adding a whole new dropdown. Landing on anything other than
  // "Block Chord" highlights the row, giving clear visual confirmation
  // a special pattern is active, without needing a separate on/off step.
  const patternRow = document.createElement('div');
  patternRow.className = 'chart-card-voicing-row';
  const patternPrevBtn = document.createElement('button');
  patternPrevBtn.type = 'button';
  patternPrevBtn.className = 'chart-card-voicing-nav';
  patternPrevBtn.textContent = '\u25c0';
  patternPrevBtn.setAttribute('aria-label', 'Previous strum pattern');
  const patternLabel = document.createElement('span');
  patternLabel.className = 'chart-card-voicing-label';
  patternLabel.addEventListener('click', (e) => e.stopPropagation());
  const patternNextBtn = document.createElement('button');
  patternNextBtn.type = 'button';
  patternNextBtn.className = 'chart-card-voicing-nav';
  patternNextBtn.textContent = '\u25b6';
  patternNextBtn.setAttribute('aria-label', 'Next strum pattern');
  // Resolves to this card's own explicit override once the user has
  // cycled it via the arrows below; until then, follows the global
  // Pattern dropdown live, so changing it actually affects cards that
  // haven't been individually touched -- this is the fix for cards
  // otherwise always silently falling back to a hardcoded 'block'.
  function effectiveCardStrumPattern(){
    return cardStrumPatternOverridden ? cardStrumPattern : (window.__strumPattern || 'block');
  }
  function refreshPatternRow(){
    const currentIdx = Math.max(0, STRUM_PATTERNS.findIndex(p => p.value === effectiveCardStrumPattern()));
    patternLabel.textContent = STRUM_PATTERNS[currentIdx].label;
    patternRow.classList.toggle('pattern-active', effectiveCardStrumPattern() !== 'block');
  }
  cardPatternRowRefreshers.push(refreshPatternRow);
  patternPrevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const currentIdx = Math.max(0, STRUM_PATTERNS.findIndex(p => p.value === effectiveCardStrumPattern()));
    cardStrumPattern = STRUM_PATTERNS[(currentIdx - 1 + STRUM_PATTERNS.length) % STRUM_PATTERNS.length].value;
    cardStrumPatternOverridden = true;
    refreshPatternRow();
  });
  patternNextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const currentIdx = Math.max(0, STRUM_PATTERNS.findIndex(p => p.value === effectiveCardStrumPattern()));
    cardStrumPattern = STRUM_PATTERNS[(currentIdx + 1) % STRUM_PATTERNS.length].value;
    cardStrumPatternOverridden = true;
    refreshPatternRow();
  });
  patternRow.appendChild(patternPrevBtn);
  patternRow.appendChild(patternLabel);
  patternRow.appendChild(patternNextBtn);
  card.appendChild(patternRow);
  refreshPatternRow();

  // Octave shift -- cycles through real, alternate PLAYABLE shapes (not
  // just an audio layer): shifting a shape up 12 frets per octave produces
  // the exact same chord, genuinely higher, using the same guitar-shape
  // principle as a capo or barre chord moved up the neck. Only cycles
  // through levels that are actually playable for whatever voicing is
  // currently showing -- shifting the CURRENT shape means whatever
  // inversion you've cycled to carries through automatically.
  const octaveRow = document.createElement('div');
  octaveRow.className = 'chart-card-voicing-row';
  const octavePrevBtn = document.createElement('button');
  octavePrevBtn.type = 'button';
  octavePrevBtn.className = 'chart-card-voicing-nav';
  octavePrevBtn.textContent = '\u25c0';
  octavePrevBtn.setAttribute('aria-label', 'Lower octave');
  const octaveLabel = document.createElement('span');
  octaveLabel.className = 'chart-card-voicing-label';
  octaveLabel.addEventListener('click', (e) => e.stopPropagation());
  const octaveNextBtn = document.createElement('button');
  octaveNextBtn.type = 'button';
  octaveNextBtn.className = 'chart-card-voicing-nav';
  octaveNextBtn.textContent = '\u25b6';
  octaveNextBtn.setAttribute('aria-label', 'Higher octave');
  function refreshOctaveRow(){
    octaveLabel.textContent = octaveShift === 0 ? 'Normal' : ('Oct \u00d7' + octaveShift);
    octaveRow.classList.toggle('pattern-active', octaveShift > 0);
    const baseShape = lookupChordShape(rootIndex, currentSuffix, voicingIndex);
    const maxLevel = baseShape ? getPlayableOctaveLevels(baseShape).length - 1 : 0;
    octavePrevBtn.disabled = (octaveShift === 0);
    octaveNextBtn.disabled = (octaveShift >= maxLevel);
    if (maxLevel === 0) { octaveRow.style.visibility = 'hidden'; } else { octaveRow.style.visibility = 'visible'; }
  }
  octavePrevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (octaveShift > 0) { octaveShift--; refreshCard(); syncVoicingToLinkedEntry(); }
  });
  octaveNextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    octaveShift++; refreshCard(); syncVoicingToLinkedEntry();
  });
  octaveRow.appendChild(octavePrevBtn);
  octaveRow.appendChild(octaveLabel);
  octaveRow.appendChild(octaveNextBtn);
  card.appendChild(octaveRow);

  function refreshCard(){
    const chordName = NOTE_NAMES[rootIndex] + currentSuffix;
    nameEl.textContent = chordName;
    card.setAttribute('aria-label', chordName + ', chord ' + label + ', ' + modeName + '. Press Enter to play, Shift+Enter to add to progression.');
    const voicingCount = getVoicingCount(rootIndex, currentSuffix);
    if (voicingIndex >= voicingCount) voicingIndex = Math.max(0, voicingCount - 1);
    currentShape = lookupChordShape(rootIndex, currentSuffix, voicingIndex);
    if (currentShape && octaveShift > 0) {
      const shifted = shiftShapeByOctaves(currentShape, octaveShift);
      if (shifted) currentShape = shifted;
      else octaveShift = 0; // this level isn't valid for the current shape/voicing -- fall back to normal
    }
    diagramSlot.innerHTML = '';
    if (currentShape) {
      const holder = document.createElement('div');
      holder.innerHTML = renderChordDiagramSVG(currentShape, rootIndex);
      diagramSlot.appendChild(holder.firstChild);
    } else {
      const empty = document.createElement('div');
      empty.className = 'chart-card-empty';
      empty.textContent = 'no diagram';
      diagramSlot.appendChild(empty);
    }
    keyboardSlot.innerHTML = currentShape
      ? renderPianoKeyboardSVG(getChordTonePitchClasses(currentShape), rootIndex, { numOctaves: 1, scale: 0.62 })
      : '';
    refreshOctaveRow();
    if (voicingCount > 1) {
      voicingRow.style.visibility = 'visible';
      voicingPrevBtn.disabled = (voicingIndex === 0);
      voicingNextBtn.disabled = (voicingIndex === voicingCount - 1);
      voicingLabel.textContent = currentShape ? describeBassNote(currentShape, rootIndex) : '';
    } else {
      voicingRow.style.visibility = 'hidden'; // reserves the layout space so cards in the same row stay the same height, rather than jumping
    }
    const isLinked = !!findMatch();
    card.classList.toggle('selected', isLinked);
    card.classList.toggle('selected-no-diagram', isLinked && !currentShape);
    card.classList.toggle('selected-special', isLinked && !!isSpecial);
    refreshToggleBtn();
  }
  function followLinkedSuffix(linkedSuffix, linkedVoicingIndex){
    const suffixChanged = linkedSuffix !== currentSuffix;
    const voicingChanged = (linkedVoicingIndex || 0) !== voicingIndex;
    if (!suffixChanged && !voicingChanged) return;
    currentSuffix = linkedSuffix;
    voicingIndex = suffixChanged ? 0 : (linkedVoicingIndex || 0); // a different chord variant starts from its first voicing; same suffix just follows the stored one
    if (suffixChanged) rebuildModOptions(currentSuffix);
    refreshCard();
  }
  function resetToBaseSuffix(){
    if (currentSuffix === baseSuffix) return;
    currentSuffix = baseSuffix;
    voicingIndex = 0;
    rebuildModOptions(currentSuffix);
    refreshCard();
  }
  renderedChartCards.push({ card, rootIndex, getCurrentSuffix: () => currentSuffix, followLinkedSuffix, resetToBaseSuffix, refreshToggleBtn, exactMatch: !!isSpecial });
  refreshCard();

  modSelect.addEventListener('change', () => {
    const newSuffix = modSelect.value;
    const linked = findMatch();
    if (linked) {
      const linkedIdx = progression.indexOf(linked);
      if (linkedIdx !== -1) {
        const updated = progression.map((e, i) => i === linkedIdx
          ? { ...e, suffix: newSuffix, chordName: NOTE_NAMES[rootIndex] + newSuffix, voicingIndex: 0 }
          : e);
        setProgression(updated);
      }
    }
    currentSuffix = newSuffix;
    voicingIndex = 0; // a different chord type has its own separate set of voicings -- start from its simplest, not wherever the previous chord's cycling happened to land
    octaveShift = 0;
    refreshCard();
  });

  card.addEventListener('click', () => {
    if (currentShape) playChordShape(currentShape, card, effectiveCardStrumPattern(), undefined, previewOctaveDoubleToggle.checked);
    if (currentShape) maybePlayPreviewBassNote(currentShape, window.__toneEngine.isInstrument(window.__toneType || 'triangle') ? 1.8 : 1.4);
    if (currentShape) maybePlayPreviewTopNote(currentShape, window.__toneEngine.isInstrument(window.__toneType || 'triangle') ? 1.8 : 1.4);
  });

  card.addEventListener('keydown', (e) => {
    if (e.target !== card) return;
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      toggleBtn.click(); // was `addBtn.click()` -- addBtn was renamed to toggleBtn a few rounds back when add/remove merged into one button; this call was never updated, so Shift+Enter has been throwing since then
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (currentShape) playChordShape(currentShape, card, effectiveCardStrumPattern(), undefined, previewOctaveDoubleToggle.checked);
      if (currentShape) maybePlayPreviewBassNote(currentShape, window.__toneEngine.isInstrument(window.__toneType || 'triangle') ? 1.8 : 1.4);
      if (currentShape) maybePlayPreviewTopNote(currentShape, window.__toneEngine.isInstrument(window.__toneType || 'triangle') ? 1.8 : 1.4);
    } else if (e.key.toLowerCase() === 'a') {
      e.preventDefault();
      patternNextBtn.click();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      const nextIndex = Math.max(0, Math.min(modSelect.options.length - 1, modSelect.selectedIndex + dir));
      modSelect.selectedIndex = nextIndex;
      currentSuffix = modSelect.value;
      voicingIndex = 0;
      refreshCard();
    }
  });

  // Hover/focus-to-highlight: a secondary dominant's label ("V7/vi") tells
  // you WHAT it resolves to in text, but scanning a whole column to find
  // "which card is actually vi" is exactly the kind of friction that makes
  // this feel more confusing than it needs to. Hovering (or tabbing to,
  // for keyboard users) the secondary dominant card lights up its real
  // target card directly, no reading required.
  if (linkedTargetCard) {
    card.addEventListener('mouseenter', () => linkedTargetCard.classList.add('resolution-target'));
    card.addEventListener('mouseleave', () => linkedTargetCard.classList.remove('resolution-target'));
    card.addEventListener('focus', () => linkedTargetCard.classList.add('resolution-target'));
    card.addEventListener('blur', () => linkedTargetCard.classList.remove('resolution-target'));
  }

  return card;
}

function renderChartGroups(){
  const tonicIndex = parseInt(chartKeySelect.value, 10);
  chartGroups.innerHTML = '';
  renderedChartCards = []; // rebuilt fresh each render, used to sync "already in progression" highlighting
  cardPatternRowRefreshers = []; // same reasoning -- stale refresh callbacks for cards no longer in the DOM would be dead weight

  if (activeModes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chart-groups-empty';
    empty.textContent = 'select a mode above to see its chords';
    chartGroups.appendChild(empty);
    return;
  }

  // Pivot chords: which diatonic chords are shared between 2+ of the
  // currently-active modes -- genuinely useful for modulation (a shared
  // chord is a natural pivot point to move from one mode/key feel to
  // another). Computed once up front as root+suffix -> [mode names],
  // rather than as a border color (already at four of those) -- a small
  // badge instead, see createChartCard.
  const pivotMap = {};
  activeModes.forEach(modeName => {
    const modeData = MODES_TABLE[modeName];
    modeData.intervals.forEach((interval, i) => {
      const rootIndex = (tonicIndex + interval) % 12;
      const suffix = QUALITY_TO_SUFFIX[modeData.qualities[i]];
      const key = rootIndex + ':' + suffix;
      if (!pivotMap[key]) pivotMap[key] = [];
      if (!pivotMap[key].includes(modeName)) pivotMap[key].push(modeName);
    });
  });

  activeModes.forEach(modeName => {
    const modeData = MODES_TABLE[modeName];

    const group = document.createElement('div');
    group.className = 'chart-mode-group';
    group.setAttribute('data-mode-name', modeName);
    const header = document.createElement('div');
    header.className = 'chart-group-header';
    const headerLabel = document.createElement('span');
    headerLabel.textContent = modeName;
    header.appendChild(headerLabel);
    const scalePreviewBtn = document.createElement('button');
    scalePreviewBtn.type = 'button';
    scalePreviewBtn.className = 'chart-scale-preview-btn';
    scalePreviewBtn.textContent = '\u25b6 Scale';
    scalePreviewBtn.title = 'Play the ' + modeName + ' scale';
    scalePreviewBtn.addEventListener('click', () => {
      playScalePreview(tonicIndex, modeName);
      showScaleDiagram(tonicIndex, modeName);
    });
    header.appendChild(scalePreviewBtn);
    group.appendChild(header);

    const row = document.createElement('div');
    row.className = 'chart-row';
    row.style.marginTop = '10px';

    const diatonicCardsByDegreeIdx = []; // used below to link each secondary dominant to its real resolution target
    modeData.intervals.forEach((interval, degreeIdx) => {
      const rootIndex = (tonicIndex + interval) % 12;
      const quality = modeData.qualities[degreeIdx];
      const baseSuffix = QUALITY_TO_SUFFIX[quality];
      const label = modeData.labels[degreeIdx];
      const pivotKey = rootIndex + ':' + baseSuffix;
      const pivotModes = (pivotMap[pivotKey] || []).filter(m => m !== modeName);
      const card = createChartCard({ rootIndex, suffix: baseSuffix, label, modeName, degreeIdx, pivotModes });
      diatonicCardsByDegreeIdx[degreeIdx] = card;
      row.appendChild(card);
    });

    group.appendChild(row);

    if (secondaryDominantsToggle.checked) {
      const secDoms = computeSecondaryDominants(tonicIndex, modeName);
      if (secDoms.length > 0) {
        const subHeader = document.createElement('div');
        subHeader.className = 'chart-subgroup-header secondary-dominants';
        subHeader.textContent = 'Secondary Dominants';
        group.appendChild(subHeader);

        const secRow = document.createElement('div');
        secRow.className = 'chart-row';
        secDoms.forEach(sd => {
          const card = createChartCard({
            rootIndex: sd.rootIndex, suffix: sd.suffix, label: sd.label,
            modeName: modeName + ' (sec. dom.)',
            explanation: SECONDARY_DOMINANT_EXPLANATION,
            linkedTargetCard: diatonicCardsByDegreeIdx[sd.targetDegreeIdx],
            isSpecial: true
          });
          secRow.appendChild(card);
        });
        group.appendChild(secRow);
      }
    }

    if (borrowedChordsToggle.checked) {
      const borrowed = computeBorrowedChords(tonicIndex, modeName);
      if (borrowed.length > 0) {
        const subHeader = document.createElement('div');
        subHeader.className = 'chart-subgroup-header borrowed-chords';
        subHeader.textContent = 'Borrowed from ' + getBorrowedReferenceMode(modeName);
        group.appendChild(subHeader);

        const borrowRow = document.createElement('div');
        borrowRow.className = 'chart-row';
        borrowed.forEach(bc => {
          const card = createChartCard({
            rootIndex: bc.rootIndex, suffix: bc.suffix, label: bc.label,
            modeName: bc.sourceModeName + ' (borrowed)',
            explanation: BORROWED_CHORD_EXPLANATION,
            isSpecial: true
          });
          borrowRow.appendChild(card);
        });
        group.appendChild(borrowRow);
      }
    }

    chartGroups.appendChild(group);
  });
}

const secondaryDominantsToggle = document.getElementById('secondaryDominantsToggle');
const borrowedChordsToggle = document.getElementById('borrowedChordsToggle');
secondaryDominantsToggle.addEventListener('change', renderChartGroups);
borrowedChordsToggle.addEventListener('change', renderChartGroups);

// Relative major/minor: a major key and its relative minor share the exact
// same key signature -- the minor tonic sits a minor third (3 semitones)
// below the major tonic. Jumping shifts the key accordingly and makes sure
// the corresponding mode (Aeolian or Ionian) is active, regardless of
// whichever modes happen to be selected already.
const relativeMinorBtn = document.getElementById('relativeMinorBtn');
const relativeMajorBtn = document.getElementById('relativeMajorBtn');
function jumpToRelativeKey(semitoneShift, modeToEnsure){
  let wasSelecting = false;
  if (activeModes.includes(modeToEnsure)) {
    // Already active (button is lit) -- toggle it back off, same as
    // clicking its mode pill would. Deliberately doesn't reverse the key
    // shift: other active modes or browsing since the jump may have real
    // reasons to stay at the current key, so only the mode itself toggles.
    activeModes = activeModes.filter(m => m !== modeToEnsure);
  } else {
    const currentKeyIndex = parseInt(chartKeySelect.value, 10);
    const newKeyIndex = ((currentKeyIndex + semitoneShift) % 12 + 12) % 12;
    chartKeySelect.value = newKeyIndex;
    activeModes = [...activeModes, modeToEnsure];
    wasSelecting = true;
  }
  renderModePicker();
  renderChartGroups();
  applyActivePresetIfAny();
  if (wasSelecting) scrollModeIntoView(modeToEnsure);
}
relativeMinorBtn.addEventListener('click', () => jumpToRelativeKey(-3, 'Aeolian'));
relativeMajorBtn.addEventListener('click', () => jumpToRelativeKey(3, 'Ionian'));

chartKeySelect.addEventListener('change', () => {
  renderChartGroups();
  applyActivePresetIfAny();
});
