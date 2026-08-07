// ---- Lead tab: melody grid editor ----
// Grid size is deliberately NOT hardcoded as "32" anywhere below -- it's
// always beats * slotsPerBeat, so a future "change grid size" control
// wouldn't need touching this logic, just these two numbers. These are
// mutable (not const) because recomputeLeadGridDimensions (defined once
// beatsPerBar exists further down) resizes them whenever the time
// signature changes -- always 2 bars' worth of beats, whatever the
// current time signature says a bar contains.
let LEAD_GRID_BEATS = 8;
let LEAD_GRID_SLOTS_PER_BEAT = 4;
let LEAD_GRID_TOTAL_SLOTS = LEAD_GRID_BEATS * LEAD_GRID_SLOTS_PER_BEAT;
let LEAD_GRID_FIRST_SECTION_SLOTS = (LEAD_GRID_BEATS / 2) * LEAD_GRID_SLOTS_PER_BEAT; // first half of the grid, active by default

// ---- Lead note transposition -- shared foundation for both auto-transpose
// on cross-chord copy and key/mode remapping (below). A lead note is a
// fretboard position ({stringIdx, fret}), not an abstract pitch, so
// "transpose by N semitones" means finding a new playable position, not
// just adding a number. ----
const MAX_LEAD_FRET = 24; // matches renderChordToneMapSVG's numFrets, the actual range the lead fretboard renders

// Semitones above OPEN_STRING_FREQS[0] (low E) for a given string's open
// pitch -- computed from the real tuning frequencies rather than assumed
// intervals, so this stays correct even if the tuning ever changes.
function openStringSemitonesFromLowE(stringIdx){
  return Math.log2(OPEN_STRING_FREQS[stringIdx] / OPEN_STRING_FREQS[0]) * 12;
}

// Shifts a single lead note by `semitones` (positive = up, negative =
// down), staying on the fretboard. Prefers the same string first (same
// hand position, just slid up/down the neck -- the least surprising
// result); if that would fall off the fretboard, finds whichever string
// can play the target pitch within [0, MAX_LEAD_FRET], preferring the
// string closest to the original so the transposed line still sits in a
// similar physical position. Returns null only if the target pitch is
// genuinely unplayable anywhere (an extreme transposition run off both
// ends) -- callers should skip the note rather than crash on null.
function transposeLeadNote(note, semitones){
  if (!note) return note;
  const sameStringFret = note.fret + semitones;
  if (sameStringFret >= 0 && sameStringFret <= MAX_LEAD_FRET) {
    return { stringIdx: note.stringIdx, fret: sameStringFret };
  }
  const targetAbsoluteSemitones = openStringSemitonesFromLowE(note.stringIdx) + note.fret + semitones;
  let best = null, bestStringDistance = Infinity;
  for (let s = 0; s < OPEN_STRING_FREQS.length; s++) {
    const neededFret = Math.round(targetAbsoluteSemitones - openStringSemitonesFromLowE(s));
    if (neededFret < 0 || neededFret > MAX_LEAD_FRET) continue;
    const stringDistance = Math.abs(s - note.stringIdx);
    if (stringDistance < bestStringDistance) {
      bestStringDistance = stringDistance;
      best = { stringIdx: s, fret: neededFret };
    }
  }
  return best;
}

// Shortest-path semitone interval from one root pitch class to another --
// e.g. C(0) to B(11) is -1, not +11, so a transpose never jumps a full
// near-octave when a one-semitone move down was the obviously intended
// (and far more common) result.
function shortestSemitoneInterval(fromRootIndex, toRootIndex){
  let diff = (toRootIndex - fromRootIndex) % 12;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  return diff;
}

// Finds the scale degree (0-6) in `intervals` (a MODES_TABLE mode's
// interval array) closest to a given semitone interval-from-root, plus
// any leftover chromatic offset -- 0 for a note that's exactly in the
// scale, nonzero for a passing tone or blue note that isn't.
function findClosestScaleDegree(intervalFromRoot, intervals){
  let bestIdx = 0, bestDiff = Infinity;
  intervals.forEach((iv, idx) => {
    const diff = Math.abs(iv - intervalFromRoot);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = idx; }
  });
  return { degreeIdx: bestIdx, chromaticOffset: intervalFromRoot - intervals[bestIdx] };
}

// Re-maps a single lead note from one key/mode to another BY SCALE
// DEGREE, not a fixed chromatic shift -- e.g. Dorian's 3rd degree sits a
// different distance from the root than Ionian's 3rd degree, so mapping
// "the note that functions as scale degree 3" preserves the melodic
// role relative to the new mode, rather than just sliding every pitch by
// the same constant regardless of what changed. A note outside the
// source scale (a chromatic passing tone or blue note) keeps its
// chromatic offset relative to its nearest degree, so that character
// carries over instead of snapping onto the new scale.
function remapLeadNoteToKeyMode(note, sourceRootIndex, sourceIntervals, targetRootIndex, targetIntervals){
  if (!note) return note;
  const absoluteSemitones = openStringSemitonesFromLowE(note.stringIdx) + note.fret;
  const pitchClass = ((STRING_PITCH_CLASS[0] + Math.round(absoluteSemitones)) % 12 + 12) % 12;
  const intervalFromSourceRoot = ((pitchClass - sourceRootIndex) % 12 + 12) % 12;
  const { degreeIdx, chromaticOffset } = findClosestScaleDegree(intervalFromSourceRoot, sourceIntervals);
  const targetDegreeInterval = targetIntervals[degreeIdx % targetIntervals.length];
  const newPitchClass = ((targetRootIndex + targetDegreeInterval + chromaticOffset) % 12 + 12) % 12;
  const semitoneShift = shortestSemitoneInterval(pitchClass, newPitchClass);
  return transposeLeadNote(note, semitoneShift);
}

// Payload-level wrapper, same shape as transposeLeadPayload above.
function remapLeadPayloadToKeyMode(payload, sourceRootIndex, sourceIntervals, targetRootIndex, targetIntervals){
  return { ...payload, slots: payload.slots.map(note => remapLeadNoteToKeyMode(note, sourceRootIndex, sourceIntervals, targetRootIndex, targetIntervals)) };
}

// Resizes the grid to 2 bars' worth of beats at whatever the current time
// signature is. Called once at startup isn't needed (the let defaults
// above already assume 4/4), only when the time signature actually
// changes -- which is also the only time the grid's content gets reset,
// since resizing mid-composition has no unambiguous "keep the old notes"
// behavior worth building.
function recomputeLeadGridDimensions(){
  LEAD_GRID_BEATS = beatsPerBar * 2; // 2 bars, whatever a bar means at the current time signature
  LEAD_GRID_TOTAL_SLOTS = LEAD_GRID_BEATS * LEAD_GRID_SLOTS_PER_BEAT;
  LEAD_GRID_FIRST_SECTION_SLOTS = (LEAD_GRID_BEATS / 2) * LEAD_GRID_SLOTS_PER_BEAT;
  leadGridSlots = new Array(LEAD_GRID_TOTAL_SLOTS).fill(null);
  leadGridSelectedSlot = null;
  leadGridSelectionRange = null;
  leadSecondHalfOpen = false;
  leadUndoStack = [];
  leadRedoStack = [];
  leadUnsavedTracker.markDirty();
  updateLeadUndoRedoButtons();
  updateLeadAdvancedGridBtnLabel();
  renderLeadEditor();
  leadGridWrap.scrollLeft = 0;
}

// Keeps the Advanced button's own look honest about the CURRENT grid's
// actual resolution -- called after every place that can change or
// restore it (the toggle itself, loading a different saved layer,
// Clear Grid / a time-signature change), rather than trusting it was
// left in the right state from whatever happened last.
function updateLeadAdvancedGridBtnLabel(){
  const btn = document.getElementById('leadAdvancedGridBtn');
  const isAdvanced = LEAD_GRID_SLOTS_PER_BEAT > 4;
  btn.classList.toggle('active', isAdvanced);
  btn.textContent = isAdvanced ? 'Advanced \u2713' : 'Advanced';
}

const leadKeySelect = document.getElementById('leadKeySelect');
const leadModeSelect = document.getElementById('leadModeSelect');
const leadFretboardWrap = document.getElementById('leadFretboardWrap');
const leadGridWrap = document.getElementById('leadGridWrap');
const leadPlayBtn = document.getElementById('leadPlayBtn');
const leadStopBtn = document.getElementById('leadStopBtn');
const leadLoopToggle = document.getElementById('leadLoopToggle');
const leadTempoInput = document.getElementById('leadTempoInput');
leadTempoInput.value = tempoInput.value; // start in sync with whatever Chart's tempo already is, not a separate default
leadTempoInput.addEventListener('input', () => {
  tempoInput.value = leadTempoInput.value;
  const drumTempoInputEl = document.getElementById('drumTempoInput');
  if (drumTempoInputEl) drumTempoInputEl.value = leadTempoInput.value;
});

// Shared time signature -- one value, both tabs, always in sync (same
// reasoning as tempo: two independent values here is exactly the kind of
// mismatch that caused the earlier tempo bug). beatsPerBar is treated as
// a plain integer beat count per bar for grid/duration purposes, even for
// compound meters like 6/8 -- a deliberate simplification rather than
// modeling the traditional "2 dotted-quarter feel" distinction.
let beatsPerBar = 4;
const timeSigSelect = document.getElementById('timeSigSelect');
const leadTimeSigSelect = document.getElementById('leadTimeSigSelect');
function setBeatsPerBar(newValue){
  if (newValue === beatsPerBar) return;
  const hasContent = (typeof leadGridSlots !== 'undefined' && leadGridSlots.some(Boolean))
    || (typeof drumGridSlots !== 'undefined' && drumGridSlots.some(row => row.some(Boolean)));
  if (hasContent && !window.confirm('Changing the time signature resizes the grid and clears its current notes. Continue?')) {
    timeSigSelect.value = beatsPerBar;
    leadTimeSigSelect.value = beatsPerBar;
    return;
  }
  beatsPerBar = newValue;
  timeSigSelect.value = newValue;
  leadTimeSigSelect.value = newValue;
  recomputeLeadGridDimensions();
  recomputeDrumGridDimensions();
}
timeSigSelect.addEventListener('change', () => setBeatsPerBar(parseInt(timeSigSelect.value, 10)));
leadTimeSigSelect.addEventListener('change', () => setBeatsPerBar(parseInt(leadTimeSigSelect.value, 10)));

const leadClearGridBtn = document.getElementById('leadClearGridBtn');
const leadSaveGridBtn = document.getElementById('leadSaveGridBtn');
const leadUndoBtn = document.getElementById('leadUndoBtn');
const leadRedoBtn = document.getElementById('leadRedoBtn');
const leadDupBtn = document.getElementById('leadDupBtn');
const leadDupBlockSize = document.getElementById('leadDupBlockSize');
const leadMetronomeToggle = document.getElementById('leadMetronomeToggle');

ROOT_TO_DB_KEY.forEach((_, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = NOTE_NAMES[i];
  leadKeySelect.appendChild(opt);
});
leadKeySelect.value = 9; // default to A, matching Chart's own default

MODE_NAMES.forEach(modeName => {
  const opt = document.createElement('option');
  opt.value = modeName;
  opt.textContent = modeName;
  leadModeSelect.appendChild(opt);
});
leadModeSelect.value = 'Ionian';

const leadToneSelect = document.getElementById('leadToneSelect');
Array.from(document.getElementById('toneTypeSelect').options).forEach(opt => {
  const clone = document.createElement('option');
  clone.value = opt.value;
  clone.textContent = opt.textContent;
  leadToneSelect.appendChild(clone);
});
leadToneSelect.value = window.__toneType || 'piano';
leadToneSelect.addEventListener('change', () => {
  window.__toneType = leadToneSelect.value;
  document.getElementById('toneTypeSelect').value = leadToneSelect.value; // keep the main Chart-tab dropdown in sync, same shared global state
  window.__toneEngine.ensureInstrumentPreloaded(getChartToneCtx(), leadToneSelect.value);
});

const leadIsBassToggle = document.getElementById('leadIsBassToggle');

// ---- Arp Generator: suggests a starting note selection from a real
// chord+inversion+pattern, which the user can hand-tweak before it maps
// into the grid. "Suggest, don't force": picking a chord sets a sensible
// key/mode ONLY until the user manually touches either dropdown --
// after that, switching chords stops overriding their choice. This
// matters because two real workflows both need to work: one key across
// a whole chorus (manual choice should stick), vs. each chord as its own
// momentary key (fresh suggestion every time, right up until overridden).
const MINOR_TYPE_SUFFIXES = new Set(['m', 'm7', 'm6', 'm9', 'm11', 'm69', 'madd9', 'mmaj7']);
const DIMINISHED_TYPE_SUFFIXES = new Set(['dim', 'dim7', 'm7b5']);
const DOMINANT_TYPE_SUFFIXES = new Set(['7', '9', '11', '13', '7b9', '7#9', '7b5', 'alt', '7sus4', '69']);
function suggestModeForSuffix(suffix){
  if (DIMINISHED_TYPE_SUFFIXES.has(suffix)) return 'Locrian';
  if (MINOR_TYPE_SUFFIXES.has(suffix)) return 'Aeolian';
  if (DOMINANT_TYPE_SUFFIXES.has(suffix)) return 'Mixolydian';
  return 'Ionian'; // '', maj7, 6, add9, maj9, maj11, maj13, sus2, sus4, aug, 5
}

let arpKeyManuallySet = false; // flips true the moment the user touches Key or Mode themselves
leadKeySelect.addEventListener('change', () => { arpKeyManuallySet = true; });
leadModeSelect.addEventListener('change', () => { arpKeyManuallySet = true; });

const arpPatternSelect = document.getElementById('arpPatternSelect');
STRUM_PATTERNS.forEach(opt => {
  const o = document.createElement('option');
  o.value = opt.value;
  o.textContent = opt.label;
  arpPatternSelect.appendChild(o);
});

const arpChordSelect = document.getElementById('arpChordSelect');
const arpInversionSelect = document.getElementById('arpInversionSelect');
const arpOctaveRangeSelect = document.getElementById('arpOctaveRangeSelect');
const arpChordDiagram = document.getElementById('arpChordDiagram');
const arpGenerateBtn = document.getElementById('arpGenerateBtn');
const arpGenerateSpaceBtn = document.getElementById('arpGenerateSpaceBtn');

let arpSelectedNotes = new Set(); // string indices currently selected for the arp -- hand-tweakable on top of the default (all of the voicing's notes)
let arpCurrentShape = null; // the voicing currently shown in the diagram

function populateArpChordSelect(){
  const prevValue = arpChordSelect.value;
  arpChordSelect.innerHTML = '<option value="">-- pick a chord from your progression --</option>';
  progression.forEach((entry, idx) => {
    const o = document.createElement('option');
    o.value = idx;
    o.textContent = entry.chordName;
    arpChordSelect.appendChild(o);
  });
  // keep the previous selection if that chord still exists at the same index and still matches
  if (prevValue !== '' && progression[prevValue]) arpChordSelect.value = prevValue;
}

function renderArpInversionOptions(rootIndex, suffix){
  const count = getVoicingCount(rootIndex, suffix);
  arpInversionSelect.innerHTML = '';
  for (let i = 0; i < Math.max(1, count); i++) {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = 'Voicing ' + (i + 1) + (count <= 1 ? ' (only one available)' : '');
    arpInversionSelect.appendChild(o);
  }
}

function renderArpDiagram(){
  if (!arpCurrentShape) { arpChordDiagram.innerHTML = ''; return; }
  const rootIndex = parseInt(leadKeySelect.value, 10);
  arpChordDiagram.innerHTML = renderArpChordSelectorSVG(arpCurrentShape, rootIndex, arpSelectedNotes);
}

function refreshArpForSelectedChord(){
  const idx = arpChordSelect.value;
  if (idx === '') { arpCurrentShape = null; arpChordDiagram.innerHTML = ''; arpInversionSelect.innerHTML = ''; return; }
  const entry = progression[idx];
  if (!entry) return;

  if (!arpKeyManuallySet) {
    leadKeySelect.value = entry.rootIndex;
    leadModeSelect.value = suggestModeForSuffix(entry.suffix);
  }

  renderArpInversionOptions(entry.rootIndex, entry.suffix);
  arpInversionSelect.value = 0;
  const shape = lookupChordShape(entry.rootIndex, entry.suffix, 0);
  arpCurrentShape = shape;
  // default selection: every note the voicing actually plays (all non-muted strings)
  arpSelectedNotes = new Set();
  if (shape) shape.frets.forEach((f, i) => { if (f !== -1) arpSelectedNotes.add(i); });
  renderArpDiagram();
}
arpChordSelect.addEventListener('change', refreshArpForSelectedChord);

arpInversionSelect.addEventListener('change', () => {
  const idx = arpChordSelect.value;
  if (idx === '') return;
  const entry = progression[idx];
  const shape = lookupChordShape(entry.rootIndex, entry.suffix, parseInt(arpInversionSelect.value, 10));
  arpCurrentShape = shape;
  arpSelectedNotes = new Set();
  if (shape) shape.frets.forEach((f, i) => { if (f !== -1) arpSelectedNotes.add(i); });
  renderArpDiagram();
});

// Shared by preview and Generate Into Grid -- orders the currently
// selected notes per the chosen pattern, reusing STRUM_PATTERN_CONFIG's
// real sort+reorder logic rather than a separate system.
function getOrderedArpNotes(){
  if (!arpCurrentShape) return [];
  const notes = [];
  arpCurrentShape.frets.forEach((f, i) => {
    if (f === -1 || !arpSelectedNotes.has(i)) return;
    const absoluteFret = f > 0 ? arpCurrentShape.baseFret + f - 1 : 0;
    notes.push({ stringIdx: i, fret: absoluteFret, freq: OPEN_STRING_FREQS[i] * Math.pow(2, absoluteFret / 12) });
  });
  const patternConfig = STRUM_PATTERN_CONFIG[arpPatternSelect.value] || STRUM_PATTERN_CONFIG.block;
  let ordered = [...notes];
  if (patternConfig.sortDir === 1) ordered.sort((a, b) => a.freq - b.freq);
  else if (patternConfig.sortDir === -1) ordered.sort((a, b) => b.freq - a.freq);
  if (patternConfig.reorder) ordered = patternConfig.reorder(ordered);

  // Octave Range: repeats the whole pattern-ordered sequence again one
  // octave higher for each additional range level, same convention as
  // real hardware/software arps (play the full pattern at the base
  // octave, then the full pattern again an octave up, and so on) --
  // capped at a realistic guitar's practical range so it can't wander
  // into unplayable territory, reusing the same ceiling already
  // verified for octave-doubling chords.
  const octaveRange = parseInt(arpOctaveRangeSelect.value, 10) || 1;
  if (octaveRange > 1) {
    const expanded = [];
    for (let octave = 0; octave < octaveRange; octave++) {
      ordered.forEach(note => {
        const newFreq = note.freq * Math.pow(2, octave);
        if (newFreq > MAX_REALISTIC_GUITAR_FREQ) return;
        expanded.push({ stringIdx: note.stringIdx, fret: note.fret + octave * 12, freq: newFreq });
      });
    }
    if (expanded.length > 0) ordered = expanded; // never return an empty sequence if every higher octave got filtered out
  }
  return ordered;
}

// Previews the whole selection played in the current pattern's real
// order and timing -- lets the user hear how a Pattern+Inversion
// combination will actually sound before committing it to the grid.
function previewArpPattern(){
  if (!arpCurrentShape || arpSelectedNotes.size === 0) return;
  const ordered = getOrderedArpNotes();
  const patternConfig = STRUM_PATTERN_CONFIG[arpPatternSelect.value] || STRUM_PATTERN_CONFIG.block;
  const ctx = getChartToneCtx();
  ordered.forEach((note, idx) => {
    const startAt = ctx.currentTime + patternConfig.getStagger(idx, ordered.length);
    playMelodyNoteTone(ctx, note, startAt, 0.6);
  });
}

arpChordDiagram.addEventListener('click', (e) => {
  const dot = e.target.closest('.arp-note-dot');
  if (!dot) {
    previewArpPattern(); // clicking the background (not a specific note dot) previews the whole pattern
    return;
  }
  if (!arpCurrentShape) return;
  const stringIdx = parseInt(dot.getAttribute('data-string'), 10);
  const f = arpCurrentShape.frets[stringIdx];
  if (f !== -1) {
    const absoluteFret = f > 0 ? arpCurrentShape.baseFret + f - 1 : 0; // frets[] is relative to baseFret, per our established convention -- must convert before computing pitch
    const ctx = getChartToneCtx();
    playMelodyNoteTone(ctx, { stringIdx, fret: absoluteFret }, ctx.currentTime, 0.6); // always audition, same pattern as the main fretboard
  }
  if (arpSelectedNotes.has(stringIdx)) arpSelectedNotes.delete(stringIdx);
  else arpSelectedNotes.add(stringIdx);
  renderArpDiagram();
});

const arpPreviewBtn = document.getElementById('arpPreviewBtn');
arpPreviewBtn.addEventListener('click', previewArpPattern);

// Generate Into Grid -- orders the selected notes per the chosen pattern,
// then walks through that order one note per grid slot at the grid's
// native rate, wrapping back to the start whenever the sequence is
// shorter than the space available. This matches the real, established
// hardware-arp convention confirmed by research: classic arps don't try
// to stretch N notes evenly across a bar, they just cycle at a fixed
// rate and repeat/wrap -- verified against a synth forum discussion
// before adopting this as our own rule, not assumed.
arpGenerateBtn.addEventListener('click', () => {
  if (!arpCurrentShape || arpSelectedNotes.size === 0) {
    window.alert('Pick a chord and at least one note first.');
    return;
  }
  const ordered = getOrderedArpNotes();
  const updated = [...leadGridSlots];
  for (let slotIdx = 0; slotIdx < LEAD_GRID_FIRST_SECTION_SLOTS; slotIdx++) {
    const note = ordered[slotIdx % ordered.length]; // wrap/repeat, the real arp convention -- not stretched to fit
    updated[slotIdx] = { stringIdx: note.stringIdx, fret: note.fret };
  }
  setLeadGridSlots(updated);
});

arpGenerateSpaceBtn.addEventListener('click', () => {
  if (!arpCurrentShape || arpSelectedNotes.size === 0) {
    window.alert('Pick a chord and at least one note first.');
    return;
  }
  const ordered = getOrderedArpNotes();
  const updated = [...leadGridSlots];
  let beatCount = 0;
  for (let slotIdx = 0; slotIdx < LEAD_GRID_FIRST_SECTION_SLOTS; slotIdx++) {
    if (slotIdx % LEAD_GRID_SLOTS_PER_BEAT === 0) {
      const note = ordered[beatCount % ordered.length]; // same wrap/repeat convention as Generate Into Grid, just one note per beat instead of one per slot
      updated[slotIdx] = { stringIdx: note.stringIdx, fret: note.fret };
      beatCount++;
    } else {
      updated[slotIdx] = null; // explicitly cleared -- a clean, evenly-spaced result every time, not whatever happened to already be in these slots
    }
  }
  setLeadGridSlots(updated);
});

let leadGridSlots = new Array(LEAD_GRID_TOTAL_SLOTS).fill(null); // each: {stringIdx, fret} | null
let leadGridSelectedSlot = null;
let leadIsPlaying = false;
let leadActiveTimeoutIds = [];
let leadSecondHalfOpen = false; // second 4 beats stay locked/greyed until engaged, keeping a fresh grid simple by default
let leadDragSourceSlot = null; // tracks the slot being dragged, for drag-to-move
let leadGridSelectionRange = null; // {start, end} | null -- freeform shift-click range, used by Duplicate instead of the fixed block size when active

// Centralized mutation -- every change to leadGridSlots goes through this,
// same discipline as setProgression for the main progression system
// (which caught a real bug earlier when one code path bypassed it
// directly). Powers undo/redo below.
let leadUndoStack = [];
let leadRedoStack = [];
const LEAD_MAX_UNDO_STEPS = 20;
const leadUnsavedTracker = createUnsavedChangesTracker(['leadSaveGridBtn', 'leadSaveAsNewBtn', 'leadSaveStackedBtn', 'leadSaveToBinBtn']);
function setLeadGridSlots(newSlots, options){
  options = options || {};
  if (!options.skipHistory) {
    leadUndoStack.push(JSON.stringify(leadGridSlots));
    if (leadUndoStack.length > LEAD_MAX_UNDO_STEPS) leadUndoStack.shift();
    leadRedoStack = [];
    leadUnsavedTracker.onEdit();
  }
  leadGridSlots = newSlots;
  updateLeadUndoRedoButtons();
  if (!options.skipRender) renderLeadGrid();
}
// Shifts every note currently in the grid by one octave (12 semitones),
// reusing the same transposeLeadNote engine as cross-chord copy and key/
// mode remapping. A full octave is a much bigger jump than those smaller
// intervals, so it's meaningfully more likely to run a note off the edge
// of the fretboard -- checked up front for every note first, and if ANY
// of them would become unplayable, the whole shift is aborted with a
// warning rather than silently dropping just that one note. Partial,
// silent data loss is worse than making the user pick a smaller shift.
function shiftLeadGridOctave(direction){
  const semitones = direction * 12;
  const unplayableCount = leadGridSlots.filter(note => note && !transposeLeadNote(note, semitones)).length;
  if (unplayableCount > 0) {
    window.alert('Shifting ' + (direction > 0 ? 'up' : 'down') + ' an octave would run ' + unplayableCount + ' note' + (unplayableCount > 1 ? 's' : '') + ' off the edge of the fretboard, so nothing was changed. Try a smaller move, or edit those notes first.');
    return;
  }
  setLeadGridSlots(leadGridSlots.map(note => note ? transposeLeadNote(note, semitones) : null));
}

function undoLeadGrid(){
  if (leadUndoStack.length === 0) return;
  leadRedoStack.push(JSON.stringify(leadGridSlots));
  leadGridSlots = JSON.parse(leadUndoStack.pop());
  leadUnsavedTracker.onUndo();
  updateLeadUndoRedoButtons();
  renderLeadGrid();
}
function redoLeadGrid(){
  if (leadRedoStack.length === 0) return;
  leadUndoStack.push(JSON.stringify(leadGridSlots));
  leadGridSlots = JSON.parse(leadRedoStack.pop());
  leadUnsavedTracker.onRedo();
  updateLeadUndoRedoButtons();
  renderLeadGrid();
}
function updateLeadUndoRedoButtons(){
  leadUndoBtn.disabled = leadUndoStack.length === 0;
  leadRedoBtn.disabled = leadRedoStack.length === 0;
}

function getLeadScalePitchClasses(){
  const tonicIndex = parseInt(leadKeySelect.value, 10);
  const modeData = MODES_TABLE[leadModeSelect.value];
  return new Set(modeData.intervals.map(iv => (tonicIndex + iv) % 12));
}

// Pentatonic reduction + blues "blue note" -- verified against real music
// theory: removing scale-degree positions 4&7 (major-3rd modes) or 2&6
// (minor-3rd modes) reduces every mode to one of exactly two well-known,
// mode-invariant shapes (major pentatonic 1-2-3-5-6, or minor pentatonic
// 1-b3-4-5-b7) -- checked this against all 7 modes' actual intervals
// before trusting it, not just the two textbook cases. The blue note is
// the one extra note that turns pentatonic into blues: b3 for major-type,
// b5 for minor-type. Locrian is a genuine edge case -- its own b5 already
// survives the pentatonic filter (since Locrian's natural 5th degree is
// itself flat), so the blue note there would just duplicate a note
// that's already present, and is skipped rather than added twice.
function getPentatonicInfo(modeName){
  const modeData = MODES_TABLE[modeName];
  const isMajorType = modeData.intervals[2] === 4; // scale degree 3 is always index 2
  const excludeIndices = isMajorType ? [3, 6] : [1, 5];
  const pentatonicIntervals = modeData.intervals.filter((_, i) => !excludeIndices.includes(i));
  const blueNoteInterval = isMajorType ? 3 : 6;
  const blueNoteAlreadyPresent = pentatonicIntervals.includes(blueNoteInterval);
  return { pentatonicIntervals, blueNoteInterval: blueNoteAlreadyPresent ? null : blueNoteInterval };
}

let leadFretboardZoom = 1.4; // new default -- noticeably larger than the old baseline (which is now the zoom-out minimum), so the neck starts more readable without needing to zoom in first
const LEAD_FRETBOARD_ZOOM_MIN = 1; // matches the old default exactly -- zooming all the way out returns to "where it was before, full and large"
const LEAD_FRETBOARD_ZOOM_MAX = 2.2; // genuinely closer than before, for focusing on a small section of the neck
let leadPentatonicMode = false; // when on, the fretboard filters to just the 5 pentatonic notes, always showing the blue note too (in its own distinct color) rather than needing a separate toggle for it

// Melody-first, not chord-first: shows the WHOLE current scale across the
// full neck, not one chord's tones -- reuses the exact same full-neck
// renderer already built for the Chart tab's "safe notes" panel, just fed
// a scale's pitch classes instead of a chord's, and requesting the full
// 24 frets (the wrapper's overflow-x:auto handles the scrolling this
// creates automatically -- no extra scroll logic needed). No "recorded
// note" highlighting here (passed an empty array) -- with up to 32 grid
// slots, highlighting every used fretboard position at once would be
// visual noise; the grid itself is what shows the melody's actual shape.
function renderLeadFretboard(){
  const tonicIndex = parseInt(leadKeySelect.value, 10);
  let pitchClasses = getLeadScalePitchClasses();
  let blueNotePitchClass = null;
  if (leadPentatonicMode) {
    const info = getPentatonicInfo(leadModeSelect.value);
    pitchClasses = new Set(info.pentatonicIntervals.map(iv => (tonicIndex + iv) % 12));
    if (info.blueNoteInterval !== null) {
      blueNotePitchClass = (tonicIndex + info.blueNoteInterval) % 12;
      pitchClasses.add(blueNotePitchClass); // the blue note is always shown alongside the pentatonic notes, just colored distinctly -- not a separate toggle
    }
  }
  // preserve scroll position proportionally across a zoom change, rather
  // than snapping back to the start every time the SVG is replaced
  const prevScrollWidth = leadFretboardWrap.scrollWidth || 1;
  const scrollFraction = leadFretboardWrap.scrollLeft / prevScrollWidth;
  leadFretboardWrap.innerHTML = renderChordToneMapSVG(pitchClasses, tonicIndex, [], 24, leadFretboardZoom, blueNotePitchClass, getSelectedLeadNotes());
  leadFretboardWrap.scrollLeft = scrollFraction * leadFretboardWrap.scrollWidth;
}

// The grid note(s) the fretboard should ring as "this is what's selected
// right now" -- either the single selected slot, or every filled slot
// within an active freeform range. Empty slots are skipped since there's
// no fretboard position to highlight for them.
function getSelectedLeadNotes(){
  if (leadGridSelectionRange) {
    const notes = [];
    for (let i = leadGridSelectionRange.start; i <= leadGridSelectionRange.end; i++) {
      if (leadGridSlots[i]) notes.push(leadGridSlots[i]);
    }
    return notes;
  }
  if (leadGridSelectedSlot !== null && leadGridSlots[leadGridSelectedSlot]) {
    return [leadGridSlots[leadGridSelectedSlot]];
  }
  return [];
}

const leadPentatonicBtn = document.getElementById('leadPentatonicBtn');
leadPentatonicBtn.addEventListener('click', () => {
  leadPentatonicMode = !leadPentatonicMode;
  leadPentatonicBtn.classList.toggle('active', leadPentatonicMode);
  renderLeadFretboard();
});

const leadLegend = document.getElementById('leadLegend');
const leadLegendToggleBtn = document.getElementById('leadLegendToggleBtn');
function renderLeadLegend(){
  const entries = [
    { color: 'var(--amber)', label: 'Root' },
    { color: '#7fd88f', label: '3rd (major or minor)' },
    { color: '#7fb3d5', label: '5th (or b5/#5)' },
    { color: '#c58fd8', label: '6th / 7th' },
    { color: '#e88fa8', label: '9th / 11th' },
    { color: BLUE_NOTE_COLOR, label: 'Blue Note (Pentatonic mode)' },
  ];
  leadLegend.innerHTML = entries.map(e =>
    `<div class="lead-legend-row"><span class="lead-legend-swatch" style="background:${e.color};"></span><span>${e.label}</span></div>`
  ).join('');
}
leadLegendToggleBtn.addEventListener('click', () => {
  const show = leadLegend.style.display === 'none';
  leadLegend.style.display = show ? 'flex' : 'none';
  leadLegendToggleBtn.classList.toggle('active', show);
  if (show) renderLeadLegend();
});

const leadFretZoomInBtn = document.getElementById('leadFretZoomInBtn');
const leadFretZoomOutBtn = document.getElementById('leadFretZoomOutBtn');
const leadFretPanLeftBtn = document.getElementById('leadFretPanLeftBtn');
const leadFretPanRightBtn = document.getElementById('leadFretPanRightBtn');
leadFretZoomInBtn.addEventListener('click', () => {
  leadFretboardZoom = Math.min(LEAD_FRETBOARD_ZOOM_MAX, leadFretboardZoom + 0.15);
  renderLeadFretboard();
});
leadFretZoomOutBtn.addEventListener('click', () => {
  leadFretboardZoom = Math.max(LEAD_FRETBOARD_ZOOM_MIN, leadFretboardZoom - 0.15);
  renderLeadFretboard();
});
leadFretPanLeftBtn.addEventListener('click', () => {
  leadFretboardWrap.scrollBy({ left: -150, behavior: 'smooth' });
});
leadFretPanRightBtn.addEventListener('click', () => {
  leadFretboardWrap.scrollBy({ left: 150, behavior: 'smooth' });
});

function renderLeadGrid(){
  leadGridWrap.innerHTML = '';
  for (let beat = 0; beat < LEAD_GRID_BEATS; beat++) {
    const beatGroup = document.createElement('div');
    beatGroup.className = 'lead-grid-beat-group';
    // Visual boundary between the two 4-beat halves, and the "open" label
    // when the second half is still locked -- clicking any slot past this
    // point activates the whole second half in one action, but this
    // label makes the boundary and its meaning visible up front too.
    if (beat === LEAD_GRID_BEATS / 2 && !leadSecondHalfOpen) {
      const openLabel = document.createElement('div');
      openLabel.className = 'lead-grid-open-label';
      openLabel.textContent = '\u2192 click to extend to 8 beats';
      leadGridWrap.appendChild(openLabel);
    }
    for (let sub = 0; sub < LEAD_GRID_SLOTS_PER_BEAT; sub++) {
      const slotIdx = beat * LEAD_GRID_SLOTS_PER_BEAT + sub;
      const note = leadGridSlots[slotIdx];
      const isLocked = slotIdx >= LEAD_GRID_FIRST_SECTION_SLOTS && !leadSecondHalfOpen;
      const inRange = leadGridSelectionRange && slotIdx >= leadGridSelectionRange.start && slotIdx <= leadGridSelectionRange.end;
      const velocity = note ? (note.velocity || 'normal') : null;
      const slotEl = document.createElement('button');
      slotEl.type = 'button';
      slotEl.className = 'lead-grid-slot'
        + (slotIdx === leadGridSelectedSlot ? ' selected' : '')
        + (note ? ' filled' : '')
        + (isLocked ? ' locked' : '')
        + (inRange ? ' in-range' : '')
        + (velocity ? ' velocity-' + velocity : '');
      slotEl.textContent = note ? NOTE_NAMES[(STRING_PITCH_CLASS[note.stringIdx] + note.fret) % 12] : '';
      slotEl.setAttribute('aria-label', 'Beat ' + (beat + 1) + ', slot ' + (sub + 1) + (note ? ', ' + slotEl.textContent + ', velocity ' + velocity : ', empty') + (isLocked ? ', locked -- click to extend the grid' : ''));
      slotEl.addEventListener('click', (e) => {
        if (isLocked) { leadSecondHalfOpen = true; leadGridSelectedSlot = slotIdx; leadGridSelectionRange = null; renderLeadGrid(); return; }
        if (e.altKey && note) {
          // Alt+click on a filled slot cycles its velocity -- kept on a
          // separate modifier from Shift (range selection) so the two
          // interactions never collide.
          const order = ['soft', 'normal', 'accent'];
          const current = order.indexOf(note.velocity || 'normal');
          const next = order[(current + 1) % order.length];
          const updated = [...leadGridSlots];
          updated[slotIdx] = { ...note, velocity: next };
          setLeadGridSlots(updated);
          return;
        }
        if (e.shiftKey && leadGridSelectedSlot !== null) {
          // Shift-click extends a freeform range from the current selected
          // slot to this one -- used by Duplicate instead of the fixed
          // block-size dropdown when a range is active.
          leadGridSelectionRange = { start: Math.min(leadGridSelectedSlot, slotIdx), end: Math.max(leadGridSelectedSlot, slotIdx) };
        } else {
          leadGridSelectedSlot = (leadGridSelectedSlot === slotIdx) ? null : slotIdx;
          leadGridSelectionRange = null; // a plain click always clears any active range, back to normal single-slot note placement
        }
        renderLeadGrid();
      });
      // Drag-to-move: single filled slots swap with whatever's at the
      // destination (never silently losing a note that was already
      // there). When a freeform range is selected, dragging ANY slot
      // within it (filled or empty) moves the WHOLE range together --
      // the shift amount is computed from wherever inside the range the
      // drag started, not just the range's start, so grabbing any note
      // in the middle of a selected phrase still moves the whole thing
      // correctly, verified with a direct simulation before wiring in.
      const inActiveRange = leadGridSelectionRange && slotIdx >= leadGridSelectionRange.start && slotIdx <= leadGridSelectionRange.end;
      slotEl.draggable = (!!note || inActiveRange) && !isLocked;
      slotEl.addEventListener('dragstart', () => { leadDragSourceSlot = slotIdx; });
      slotEl.addEventListener('dragend', () => { leadDragSourceSlot = null; });
      slotEl.addEventListener('dragover', (e) => { e.preventDefault(); });
      slotEl.addEventListener('drop', (e) => {
        e.preventDefault();
        performLeadMove(slotIdx, isLocked);
      });
      beatGroup.appendChild(slotEl);
    }
    leadGridWrap.appendChild(beatGroup);
  }
  renderLeadFretboard(); // keeps the selection ring in sync with whatever just changed here -- selection, note placement, or grid size
}

leadFretboardWrap.addEventListener('click', (e) => {
  const dot = e.target.closest('.fretboard-tone-dot');
  if (!dot) return;
  const stringIdx = parseInt(dot.getAttribute('data-string'), 10);
  const fret = parseInt(dot.getAttribute('data-fret'), 10);
  const ctx = getChartToneCtx();
  playMelodyNoteTone(ctx, { stringIdx, fret }, ctx.currentTime, 0.6); // always audition, same as the Chart tab's fretboard

  if (leadGridSelectedSlot === null) return; // no slot selected -- this click was just an audition
  const updated = [...leadGridSlots];
  updated[leadGridSelectedSlot] = { stringIdx, fret };
  const placedSlot = leadGridSelectedSlot;
  // auto-advance to the next slot for faster entry -- stops at the end rather than wrapping around
  leadGridSelectedSlot = (placedSlot + 1 < LEAD_GRID_TOTAL_SLOTS) ? placedSlot + 1 : null;
  setLeadGridSlots(updated);
});

// Delete/Backspace clears whichever slot is currently selected -- only
// active while the Lead tab itself is focused/active, so it doesn't
// interfere with deleting text in an input field elsewhere, or with the
// main progression's own Delete-to-remove-chip behavior on other tabs.
document.addEventListener('keydown', (e) => {
  if (currentActiveMode !== 'lead') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; // don't hijack typing in the tempo/key/mode fields
  if ((e.key === 'Delete' || e.key === 'Backspace') && leadGridSelectedSlot !== null) {
    e.preventDefault();
    if (leadGridSlots[leadGridSelectedSlot] === null) return; // nothing to clear
    const updated = [...leadGridSlots];
    updated[leadGridSelectedSlot] = null;
    setLeadGridSlots(updated);
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoLeadGrid(); else undoLeadGrid();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redoLeadGrid();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    performLeadDuplicate();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    performLeadCopy();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    performLeadPaste();
  }
});

leadUndoBtn.addEventListener('click', undoLeadGrid);
leadRedoBtn.addEventListener('click', redoLeadGrid);
document.getElementById('leadOctaveDownBtn').addEventListener('click', () => shiftLeadGridOctave(-1));
document.getElementById('leadOctaveUpBtn').addEventListener('click', () => shiftLeadGridOctave(1));
document.getElementById('leadAdvancedGridBtn').addEventListener('click', () => {
  const newSlotsPerBeat = LEAD_GRID_SLOTS_PER_BEAT > 4 ? 4 : 8;
  const newTotalSlots = LEAD_GRID_BEATS * newSlotsPerBeat;
  const newSlots = new Array(newTotalSlots).fill(null);
  let anyCollision = false;
  leadGridSlots.forEach((note, oldIndex) => {
    if (!note) return;
    const newIndex = remapSlotIndex(oldIndex, LEAD_GRID_SLOTS_PER_BEAT, newSlotsPerBeat);
    if (newIndex < 0 || newIndex >= newTotalSlots) return;
    if (newSlots[newIndex]) anyCollision = true; // two notes now land on the same slot at the coarser resolution
    newSlots[newIndex] = note;
  });
  if (anyCollision) {
    const confirmed = window.confirm('Some notes are close enough together that switching to this resolution will merge them onto the same slot, losing one of them. Continue?');
    if (!confirmed) return;
  }
  LEAD_GRID_SLOTS_PER_BEAT = newSlotsPerBeat;
  LEAD_GRID_TOTAL_SLOTS = newTotalSlots;
  LEAD_GRID_FIRST_SECTION_SLOTS = (LEAD_GRID_BEATS / 2) * newSlotsPerBeat;
  leadGridSlots = newSlots;
  leadGridSelectedSlot = null;
  leadGridSelectionRange = null;
  leadSecondHalfOpen = newSlots.slice(LEAD_GRID_FIRST_SECTION_SLOTS).some(Boolean);
  leadUndoStack = [];
  leadRedoStack = [];
  leadUnsavedTracker.markDirty();
  updateLeadUndoRedoButtons();
  updateLeadAdvancedGridBtnLabel();
  renderLeadEditor();
  leadGridWrap.scrollLeft = 0;
});

// Duplicate: takes the block CONTAINING the currently selected slot
// (rounded down to the nearest block boundary of the chosen size) and
// copies it into the immediately following block of the same size,
// overwriting whatever was there. Clamped at the end of the grid.
// Extracted from the drop handler below so it's independently testable,
// same reasoning as performDrumMove. destSlot/isLocked passed in rather
// than closed over, since in the original inline handler they came from
// the render loop's per-slot scope.
function performLeadMove(destSlot, isLocked){
  if (leadDragSourceSlot === null || leadDragSourceSlot === destSlot || isLocked) return;
  const sourceInRange = leadGridSelectionRange && leadDragSourceSlot >= leadGridSelectionRange.start && leadDragSourceSlot <= leadGridSelectionRange.end;
  if (sourceInRange) {
    const range = leadGridSelectionRange;
    const shift = destSlot - leadDragSourceSlot;
    const newStart = range.start + shift;
    const newEnd = range.end + shift;
    if (newStart < 0 || newEnd >= LEAD_GRID_TOTAL_SLOTS) {
      window.alert('Not enough room to move this selection there.');
      leadDragSourceSlot = null;
      return;
    }
    const rangeContent = leadGridSlots.slice(range.start, range.end + 1);
    const updated = [...leadGridSlots];
    for (let i = range.start; i <= range.end; i++) updated[i] = null;
    rangeContent.forEach((n, i) => { updated[newStart + i] = n; });
    leadGridSelectionRange = { start: newStart, end: newEnd }; // selection follows the move, so it can be moved again immediately
    leadGridSelectedSlot = null;
    leadDragSourceSlot = null;
    setLeadGridSlots(updated);
  } else {
    const updated = [...leadGridSlots];
    const temp = updated[destSlot];
    updated[destSlot] = updated[leadDragSourceSlot];
    updated[leadDragSourceSlot] = temp;
    leadDragSourceSlot = null;
    setLeadGridSlots(updated);
  }
}

function performLeadDuplicate(){
  let sourceStart, blockSize;
  if (leadGridSelectionRange) {
    sourceStart = leadGridSelectionRange.start;
    blockSize = leadGridSelectionRange.end - leadGridSelectionRange.start + 1;
  } else {
    blockSize = parseInt(leadDupBlockSize.value, 10);
    const anchorSlot = leadGridSelectedSlot !== null ? leadGridSelectedSlot : 0;
    sourceStart = Math.floor(anchorSlot / blockSize) * blockSize;
  }
  const targetStart = sourceStart + blockSize;
  if (targetStart >= LEAD_GRID_TOTAL_SLOTS) {
    window.alert('No room left in the grid to duplicate this into.');
    return;
  }
  if (targetStart + blockSize > LEAD_GRID_FIRST_SECTION_SLOTS && !leadSecondHalfOpen) {
    leadSecondHalfOpen = true; // duplicating into the second half is itself a genuine "engage" action
  }
  const updated = [...leadGridSlots];
  for (let i = 0; i < blockSize && targetStart + i < LEAD_GRID_TOTAL_SLOTS; i++) {
    updated[targetStart + i] = leadGridSlots[sourceStart + i];
  }
  setLeadGridSlots(updated);
}
leadDupBtn.addEventListener('click', performLeadDuplicate);

// Clipboard for copy/paste -- separate from Duplicate, since paste can
// target anywhere (not just immediately after the source), and the
// clipboard persists across multiple pastes until something new is copied.
let leadClipboard = null; // array of {stringIdx,fret}|null, or null if nothing copied yet
function performLeadCopy(){
  let start, length;
  if (leadGridSelectionRange) {
    start = leadGridSelectionRange.start;
    length = leadGridSelectionRange.end - leadGridSelectionRange.start + 1;
  } else if (leadGridSelectedSlot !== null) {
    start = leadGridSelectedSlot;
    length = 1;
  } else {
    return; // nothing selected to copy
  }
  leadClipboard = leadGridSlots.slice(start, start + length).map(n => n ? { ...n } : null);
}
function performLeadPaste(){
  if (!leadClipboard) return;
  const pasteStart = leadGridSelectedSlot !== null ? leadGridSelectedSlot : (leadGridSelectionRange ? leadGridSelectionRange.start : 0);
  const pasteEnd = pasteStart + leadClipboard.length - 1;
  if (pasteEnd >= LEAD_GRID_TOTAL_SLOTS) {
    window.alert('Not enough room in the grid to paste here.');
    return;
  }
  if (pasteEnd >= LEAD_GRID_FIRST_SECTION_SLOTS && !leadSecondHalfOpen) {
    leadSecondHalfOpen = true; // pasting into the second half is itself a genuine "engage" action
  }
  const updated = [...leadGridSlots];
  leadClipboard.forEach((n, i) => { updated[pasteStart + i] = n ? { ...n } : null; });
  setLeadGridSlots(updated);
}

leadClearGridBtn.addEventListener('click', () => {
  setLeadGridSlots(new Array(LEAD_GRID_TOTAL_SLOTS).fill(null));
  leadGridSelectedSlot = null;
  leadSecondHalfOpen = false;
  arpKeyManuallySet = false;
  renderLeadGrid();
  leadGridWrap.scrollLeft = 0;
});

leadKeySelect.addEventListener('change', renderLeadFretboard);
leadModeSelect.addEventListener('change', renderLeadFretboard);

const leadListWrap = document.getElementById('leadListWrap');
function renderLeadList(){
  const allLayers = [];
  progression.forEach((entry, idx) => {
    getEntryLeadGrids(entry).forEach((layer, layerIdx, arr) => {
      allLayers.push({ entry, idx, layer, stackLabel: arr.length > 1 ? ' #' + (layerIdx + 1) : '' });
    });
  });
  allLayers.sort((a, b) => (b.layer.savedAt || 0) - (a.layer.savedAt || 0)); // most recent first
  leadListWrap.innerHTML = '';
  if (allLayers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lead-list-empty';
    empty.textContent = 'No saved leads yet -- save one from the grid above to see it here.';
    leadListWrap.appendChild(empty);
    return;
  }
  allLayers.forEach(({ entry, idx, layer, stackLabel }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'lead-list-item' + (idx === leadEditingEntryIndex && layer.id === leadEditingLayerId ? ' active-editing' : '');
    item.textContent = entry.chordName + stackLabel;
    item.title = 'Click to edit this lead';
    item.addEventListener('click', () => {
      loadLeadGridFromEntry(idx, layer.id);
    });
    leadListWrap.appendChild(item);
  });
}

function renderLeadEditor(){
  renderLeadFretboard();
  renderLeadGrid();
  renderLeadList();
  populateArpChordSelect();
}

function leadBeatMs(){
  return 60000 / (parseInt(leadTempoInput.value, 10) || 90);
}
function stopLeadPlayback(){
  leadActiveTimeoutIds.forEach(id => clearTimeout(id));
  leadActiveTimeoutIds = [];
  leadIsPlaying = false;
  leadPlayBtn.disabled = false;
  leadStopBtn.disabled = true;
  window.__hardStopAllAudio(getChartToneCtx());
}
// Each note sustains until the NEXT filled slot, not a fixed short blip --
// that's what gives this a connected, melodic feel instead of choppy
// staccato. A run of empty slots after a note just extends how long that
// note rings, rather than needing an explicit "hold" marker.
function playLeadGrid(){
  stopLeadPlayback();
  leadIsPlaying = true;
  leadPlayBtn.disabled = true;
  leadStopBtn.disabled = false;
  const slotMs = leadBeatMs() / LEAD_GRID_SLOTS_PER_BEAT;
  const activeSlotCount = leadSecondHalfOpen ? LEAD_GRID_TOTAL_SLOTS : LEAD_GRID_FIRST_SECTION_SLOTS;

  function runOnce(){
    const ctx = getChartToneCtx();
    let elapsed = 0;
    for (let slotIdx = 0; slotIdx < activeSlotCount; slotIdx++) {
      const note = leadGridSlots[slotIdx];
      if (leadMetronomeToggle.checked && slotIdx % LEAD_GRID_SLOTS_PER_BEAT === 0) {
        const beatNum = slotIdx / LEAD_GRID_SLOTS_PER_BEAT;
        const tickId = setTimeout(() => playMetronomeTick(beatNum % beatsPerBar === 0), elapsed);
        leadActiveTimeoutIds.push(tickId);
      }
      if (note) {
        let nextFilledIdx = activeSlotCount; // search stops at the active boundary, not the whole array
        for (let j = slotIdx + 1; j < activeSlotCount; j++) {
          if (leadGridSlots[j]) { nextFilledIdx = j; break; }
        }
        const durationSeconds = Math.max(0.15, ((nextFilledIdx - slotIdx) * slotMs) / 1000);
        const id = setTimeout(() => {
          playMelodyNoteTone(ctx, note, ctx.currentTime, durationSeconds);
        }, elapsed);
        leadActiveTimeoutIds.push(id);
      }
      elapsed += slotMs;
    }
    const endId = setTimeout(() => {
      if (leadLoopToggle.checked && leadIsPlaying) runOnce();
      else stopLeadPlayback();
    }, elapsed);
    leadActiveTimeoutIds.push(endId);
  }
  runOnce();
}
leadPlayBtn.addEventListener('click', playLeadGrid);
leadStopBtn.addEventListener('click', stopLeadPlayback);

// Tracks which progression entry (if any) the current working grid is
// attached to for editing -- null means "fresh, unattached melody".
let leadEditingEntryIndex = null;
let leadEditingLayerId = null; // which specific layer within that entry's stack is being edited, if any

function buildLeadGridPayload(){
  return {
    id: Date.now() + '-' + Math.random().toString(36).slice(2),
    slots: leadGridSlots.map(n => n ? { stringIdx: n.stringIdx, fret: n.fret } : null),
    patternLengthSlots: leadSecondHalfOpen ? LEAD_GRID_TOTAL_SLOTS : LEAD_GRID_TOTAL_SLOTS / 2,
    slotsPerBeat: LEAD_GRID_SLOTS_PER_BEAT,
    tempo: parseInt(leadTempoInput.value, 10) || 90,
    keyIndex: parseInt(leadKeySelect.value, 10),
    modeName: leadModeSelect.value,
    toneType: window.__toneType || 'piano',
    isBass: leadIsBassToggle.checked,
    savedAt: Date.now(),
  };
}

// Reads a chord entry's leads uniformly, whether it's an old single-lead
// entry saved before stacking existed (entry.leadGrid, singular) or a
// current stacked entry (entry.leadGrids, an array) -- never mutates the
// entry itself, so old saved progressions keep working without needing
// an explicit migration step.
function getEntryLeadGrids(entry){
  if (entry.leadGrids) return entry.leadGrids;
  if (entry.leadGrid) return [entry.leadGrid];
  return [];
}

// Creates a small, reusable, drag-to-adjust volume knob for a chip
// (chord, lead, or drum). Vertical drag changes the value -- up
// increases, down decreases, the standard convention in audio software
// -- clamped 0-100. onChange fires continuously during the drag so
// playback gain can be previewed live, not just after release.
function createVolumeKnob(initialValue, onChange, onCommit){
  const value = (initialValue !== undefined && initialValue !== null) ? initialValue : 100;
  const wrap = document.createElement('div');
  wrap.className = 'volume-knob';
  wrap.title = 'Volume: ' + value + '% -- drag up/down to adjust';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'slider');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', '100');
  wrap.setAttribute('aria-valuenow', String(value));

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');

  const bg = document.createElementNS(svgNS, 'circle');
  bg.setAttribute('cx', '10'); bg.setAttribute('cy', '10'); bg.setAttribute('r', '9');
  bg.setAttribute('fill', 'rgba(0,0,0,0.35)');
  bg.setAttribute('stroke', 'rgba(0,0,0,0.5)');
  svg.appendChild(bg);

  const indicator = document.createElementNS(svgNS, 'line');
  indicator.setAttribute('x1', '10'); indicator.setAttribute('y1', '10');
  indicator.setAttribute('stroke', 'var(--amber)');
  indicator.setAttribute('stroke-width', '2');
  indicator.setAttribute('stroke-linecap', 'round');
  svg.appendChild(indicator);

  // Maps 0-100 to a -135deg..+135deg sweep (standard knob range, 0deg
  // pointing straight up), then converts to SVG's coordinate convention
  // (0deg = right, angle increases clockwise since y grows downward) --
  // verified numerically before wiring in: 0% lands down-left, 50%
  // straight up, 100% down-right.
  function updateIndicator(v){
    const angleDeg = -135 + (v / 100) * 270;
    const angleRad = (angleDeg - 90) * Math.PI / 180;
    const x2 = 10 + 7 * Math.cos(angleRad);
    const y2 = 10 + 7 * Math.sin(angleRad);
    indicator.setAttribute('x2', x2.toFixed(2));
    indicator.setAttribute('y2', y2.toFixed(2));
  }
  updateIndicator(value);
  wrap.appendChild(svg);

  let currentValue = value;
  let dragging = false;
  let dragStartY = 0;
  let dragStartValue = 0;
  const DRAG_RANGE_PX = 100; // pixels of vertical drag spanning the full 0-100 range

  function onPointerMove(e){
    if (!dragging) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const deltaY = dragStartY - clientY; // up = positive = increase
    let newValue = Math.round(dragStartValue + (deltaY / DRAG_RANGE_PX) * 100);
    newValue = Math.max(0, Math.min(100, newValue));
    if (newValue !== currentValue) {
      currentValue = newValue;
      updateIndicator(currentValue);
      wrap.title = 'Volume: ' + currentValue + '% -- drag up/down to adjust';
      wrap.setAttribute('aria-valuenow', String(currentValue));
      onChange(currentValue);
    }
  }
  function onPointerUp(){
    dragging = false;
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('touchend', onPointerUp);
    if (onCommit) onCommit(currentValue, window.__shiftHeld);
  }
  function startDrag(e){
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    dragStartY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStartValue = currentValue;
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);
  }
  wrap.addEventListener('mousedown', startDrag);
  wrap.addEventListener('touchstart', startDrag, { passive: false });
  wrap.addEventListener('click', (e) => e.stopPropagation()); // don't let the click-release also trigger the parent chip's own click handler

  return wrap;
}

function updateLeadLayerField(entryIdx, layerId, field, value){
  const updated = progression.map((en, i) => {
    if (i !== entryIdx) return en;
    const newGrids = getEntryLeadGrids(en).map(g => g.id === layerId ? { ...g, [field]: value } : g);
    return { ...en, leadGrids: newGrids, leadGrid: undefined };
  });
  setProgression(updated);
}

function loadLeadGridFromEntry(entryIndex, layerId){
  const entry = progression[entryIndex];
  if (!entry) return;
  const grids = getEntryLeadGrids(entry);
  const layer = layerId !== undefined ? grids.find(g => g.id === layerId) : grids[0];
  if (!layer) return;
  leadKeySelect.value = layer.keyIndex;
  leadModeSelect.value = layer.modeName;
  // Different leads can now be saved at different grid resolutions
  // (Advanced mode doubles slots-per-beat). Restore THIS layer's own
  // resolution before assigning its slots, so the live editing grid's
  // dimensions actually match what it was built at -- old saved layers
  // with no slotsPerBeat field default to 4, the resolution that always
  // existed before this feature.
  LEAD_GRID_SLOTS_PER_BEAT = layer.slotsPerBeat || 4;
  LEAD_GRID_TOTAL_SLOTS = LEAD_GRID_BEATS * LEAD_GRID_SLOTS_PER_BEAT;
  LEAD_GRID_FIRST_SECTION_SLOTS = (LEAD_GRID_BEATS / 2) * LEAD_GRID_SLOTS_PER_BEAT;
  leadGridSlots = layer.slots.map(n => n ? { ...n } : null);
  leadGridSelectedSlot = null;
  leadEditingEntryIndex = entryIndex;
  leadEditingLayerId = layer.id;
  if (layer.toneType) {
    window.__toneType = layer.toneType;
    leadToneSelect.value = layer.toneType;
    document.getElementById('toneTypeSelect').value = layer.toneType;
    window.__toneEngine.ensureInstrumentPreloaded(getChartToneCtx(), layer.toneType);
  }
  leadIsBassToggle.checked = !!layer.isBass;
  // saved data in the second half should never be hidden behind a locked
  // state -- only a genuinely fresh/empty second half stays closed
  leadSecondHalfOpen = leadGridSlots.slice(LEAD_GRID_FIRST_SECTION_SLOTS).some(Boolean);
  // fresh melody, fresh history -- the old undo/redo stack belongs to
  // whatever was being edited before, and undoing into that would be
  // confusing now that a different saved lead is loaded
  leadUndoStack = [];
  leadRedoStack = [];
  leadUnsavedTracker.markClean();
  updateLeadUndoRedoButtons();
  updateLeadAdvancedGridBtnLabel();
  renderLeadEditor();
  leadGridWrap.scrollLeft = 0;
}

// Save Lead (in place): updates the exact layer currently being edited,
// leaving any other layers on that same chord untouched. Only valid when
// already linked to a specific existing layer.
function updateLeadInPlace(){
  const entry = progression[leadEditingEntryIndex];
  if (!entry) return;
  const grids = getEntryLeadGrids(entry);
  const existingLayer = grids.find(g => g.id === leadEditingLayerId);
  const newPayload = { ...buildLeadGridPayload(), id: leadEditingLayerId, muted: existingLayer ? existingLayer.muted : undefined, solo: existingLayer ? existingLayer.solo : undefined, tremolo: existingLayer ? existingLayer.tremolo : undefined, delayPreset: existingLayer ? existingLayer.delayPreset : undefined, envelopeFilter: existingLayer ? existingLayer.envelopeFilter : undefined }; // keep the same identity AND mute/solo/tremolo/delay/envelope-filter state, just refresh the musical content
  const newGrids = grids.map(g => g.id === leadEditingLayerId ? newPayload : g);
  const updated = progression.map((en, i) => i === leadEditingEntryIndex ? { ...en, leadGrids: newGrids, leadGrid: undefined } : en);
  setProgression(updated);
  leadUnsavedTracker.markClean();
  renderLeadList();
}

// Save As New: replaces the ENTIRE stack on the target chord with just
// this one lead -- a clean slate on that chord, matching the "New" name.
// Transposes every note in a saved lead payload by the given semitone
// interval, using transposeLeadNote per note. A note that becomes
// unplayable (extreme transposition run off the fretboard) is dropped
// rather than left at a wrong pitch or crashing -- rare in practice since
// most chord-to-chord intervals are small, but a real possibility for a
// deliberately large key change.
function transposeLeadPayload(payload, semitones){
  if (semitones === 0) return payload;
  return { ...payload, slots: payload.slots.map(note => note ? transposeLeadNote(note, semitones) : null) };
}

function saveLeadAsNewOnEntry(entryIndex){
  const targetEntry = progression[entryIndex];
  const sourceRootIndex = parseInt(leadKeySelect.value, 10);
  const semitones = targetEntry ? shortestSemitoneInterval(sourceRootIndex, targetEntry.rootIndex) : 0;
  const newPayload = transposeLeadPayload(buildLeadGridPayload(), semitones);
  const updated = progression.map((en, i) => i === entryIndex ? { ...en, leadGrids: [newPayload], leadGrid: undefined } : en);
  setProgression(updated);
  leadUnsavedTracker.markClean();
  leadEditingEntryIndex = entryIndex;
  leadEditingLayerId = newPayload.id;
  renderLeadList();
}

// Save as Stacked Lead: adds this as an ADDITIONAL layer to the target
// chord's existing stack, preserving whatever's already there -- the
// bass line + guitar lead + keyboard part scenario.
function saveLeadStackedOnEntry(entryIndex){
  const entry = progression[entryIndex];
  const existingGrids = entry ? getEntryLeadGrids(entry) : [];
  const sourceRootIndex = parseInt(leadKeySelect.value, 10);
  const semitones = entry ? shortestSemitoneInterval(sourceRootIndex, entry.rootIndex) : 0;
  const newPayload = transposeLeadPayload(buildLeadGridPayload(), semitones);
  const updated = progression.map((en, i) => i === entryIndex ? { ...en, leadGrids: [...existingGrids, newPayload], leadGrid: undefined } : en);
  setProgression(updated);
  leadUnsavedTracker.markClean();
  leadEditingEntryIndex = entryIndex;
  leadEditingLayerId = newPayload.id;
  renderLeadList();
}

const leadTargetOverlay = document.getElementById('leadTargetOverlay');
const leadTargetTitle = document.getElementById('leadTargetTitle');
const leadTargetBody = document.getElementById('leadTargetBody');
const leadTargetCloseBtn = document.getElementById('leadTargetCloseBtn');
function closeLeadTargetPicker(){
  leadTargetOverlay.style.display = 'none';
}
leadTargetCloseBtn.addEventListener('click', closeLeadTargetPicker);
leadTargetOverlay.addEventListener('click', (e) => {
  if (e.target === leadTargetOverlay) closeLeadTargetPicker();
});
function showLeadTargetPicker(mode){
  if (progression.length === 0) {
    window.alert('Your progression is empty -- add some chords on the Chart tab first, then come back to send this lead to one of them.');
    return;
  }
  leadTargetTitle.textContent = mode === 'stack' ? 'Add Stacked Lead To...' : 'Send Lead To...';
  leadTargetBody.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'modulation-list'; // reuse the same list styling as the modulation finder
  progression.forEach((entry, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'modulation-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'modulation-row-name';
    const existingCount = getEntryLeadGrids(entry).length;
    let note = '';
    if (existingCount > 0) {
      note = mode === 'stack'
        ? ' (has ' + existingCount + ' lead' + (existingCount > 1 ? 's' : '') + ' -- will add another)'
        : ' (has ' + existingCount + ' lead' + (existingCount > 1 ? 's' : '') + ' -- will replace all of them)';
    }
    const semitonesForHint = shortestSemitoneInterval(parseInt(leadKeySelect.value, 10), entry.rootIndex);
    if (semitonesForHint !== 0) {
      note += ' -- transposed ' + (semitonesForHint > 0 ? '+' : '') + semitonesForHint + ' semitone' + (Math.abs(semitonesForHint) > 1 ? 's' : '');
    }
    nameSpan.textContent = entry.chordName + note;
    row.appendChild(nameSpan);
    row.addEventListener('click', () => {
      if (mode === 'stack') saveLeadStackedOnEntry(i);
      else saveLeadAsNewOnEntry(i);
      closeLeadTargetPicker();
    });
    list.appendChild(row);
  });
  leadTargetBody.appendChild(list);
  leadTargetOverlay.style.display = 'flex';
}

// Chart-tab-native copy: takes whatever lead is currently checked via its
// select box and copies it (as a new stacked layer, source untouched) to
// a chosen chord -- reuses the same overlay as showLeadTargetPicker
// rather than building a second one, just with its own list logic since
// the source chord is excluded (copying a lead onto itself is a no-op)
// and this never touches the Lead tab's own editing state.
function showLeadCopyTargetPicker(){
  if (!selectedLeadForCopy) return;
  const sourceEntry = progression[selectedLeadForCopy.entryIdx];
  if (!sourceEntry) return;
  const isDrum = selectedLeadForCopy.type === 'drum';
  const sourceLayer = isDrum ? sourceEntry.drumPattern : getEntryLeadGrids(sourceEntry).find(g => g.id === selectedLeadForCopy.layerId);
  if (!sourceLayer) return;
  leadTargetTitle.textContent = isDrum ? 'Copy Drum Pattern To...' : 'Copy Lead To...';
  leadTargetBody.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'modulation-list';
  progression.forEach((entry, i) => {
    if (i === selectedLeadForCopy.entryIdx) return; // skip the source chord itself
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'modulation-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'modulation-row-name';
    if (isDrum) {
      nameSpan.textContent = entry.chordName + (entry.drumPattern ? ' (has a pattern -- will replace it)' : '');
    } else {
      const existingCount = getEntryLeadGrids(entry).length;
      const semitones = shortestSemitoneInterval(sourceEntry.rootIndex, entry.rootIndex);
      const transposeNote = semitones !== 0 ? (' -- transposed ' + (semitones > 0 ? '+' : '') + semitones + ' semitone' + (Math.abs(semitones) > 1 ? 's' : '')) : '';
      nameSpan.textContent = entry.chordName + (existingCount > 0 ? ' (has ' + existingCount + ' lead' + (existingCount > 1 ? 's' : '') + ' -- will add another)' : '') + transposeNote;
    }
    row.appendChild(nameSpan);
    row.addEventListener('click', () => {
      if (isDrum) {
        saveDrumPatternInto(i, sourceLayer);
      } else {
        const semitones = shortestSemitoneInterval(sourceEntry.rootIndex, entry.rootIndex);
        const copiedLayer = { ...transposeLeadPayload(sourceLayer, semitones), id: Date.now() + '-' + Math.random().toString(36).slice(2), savedAt: Date.now(), solo: false };
        const updated = progression.map((en, j) => j === i ? { ...en, leadGrids: [...getEntryLeadGrids(en), copiedLayer], leadGrid: undefined } : en);
        setProgression(updated);
      }
      closeLeadTargetPicker();
    });
    list.appendChild(row);
  });
  leadTargetBody.appendChild(list);
  leadTargetOverlay.style.display = 'flex';
}

// Copies a drum pattern's content onto a target chord, replacing
// whatever pattern (if any) was already there -- matching the
// single-pattern-per-chord model, unlike leads which stack.
function saveDrumPatternInto(targetIdx, sourcePattern){
  const copiedPattern = { ...sourcePattern, slots: sourcePattern.slots.map(row => [...row]), id: Date.now() + '-' + Math.random().toString(36).slice(2), savedAt: Date.now(), solo: false };
  const updated = progression.map((en, i) => i === targetIdx ? { ...en, drumPattern: copiedPattern } : en);
  setProgression(updated);
}

function updateLeadCopyToolbar(){
  const leadCopyStatus = document.getElementById('leadCopyStatus');
  const leadDupRightBtn = document.getElementById('leadDupRightBtn');
  const leadCopyToBtn = document.getElementById('leadCopyToBtn');
  const leadMapToKeyModeBtn = document.getElementById('leadMapToKeyModeBtn');
  const leadSaveSelectedToBinBtn = document.getElementById('leadSaveSelectedToBinBtn');
  if (!selectedLeadForCopy) {
    leadCopyStatus.textContent = 'Check a lead\u2019s or drum pattern\u2019s box to select it, then duplicate or copy it to another chord';
    leadDupRightBtn.disabled = true;
    leadCopyToBtn.disabled = true;
    leadMapToKeyModeBtn.disabled = true;
    leadSaveSelectedToBinBtn.disabled = true;
    return;
  }
  let kindLabel = '\u2019s drum pattern';
  if (selectedLeadForCopy.type === 'lead') {
    const selectedEntry = progression[selectedLeadForCopy.entryIdx];
    const selectedLayer = selectedEntry && getEntryLeadGrids(selectedEntry).find(g => g.id === selectedLeadForCopy.layerId);
    kindLabel = (selectedLayer && selectedLayer.isBass) ? '\u2019s bass' : '\u2019s lead';
  }
  leadCopyStatus.textContent = 'Selected: ' + selectedLeadForCopy.chordName + kindLabel;
  const hasNextChord = selectedLeadForCopy.entryIdx + 1 < progression.length;
  leadDupRightBtn.disabled = !hasNextChord;
  leadCopyToBtn.disabled = false;
  leadMapToKeyModeBtn.disabled = selectedLeadForCopy.type === 'drum'; // drums aren't pitched, nothing to remap
  leadSaveSelectedToBinBtn.disabled = false;
}

document.getElementById('leadDupRightBtn').addEventListener('click', () => {
  if (!selectedLeadForCopy) return;
  const sourceEntry = progression[selectedLeadForCopy.entryIdx];
  const targetIdx = selectedLeadForCopy.entryIdx + 1;
  if (!sourceEntry || targetIdx >= progression.length) return;
  const targetEntry = progression[targetIdx];
  if (selectedLeadForCopy.type === 'drum') {
    if (!sourceEntry.drumPattern) return;
    saveDrumPatternInto(targetIdx, sourceEntry.drumPattern);
    return;
  }
  const sourceLayer = getEntryLeadGrids(sourceEntry).find(g => g.id === selectedLeadForCopy.layerId);
  if (!sourceLayer) return;
  const semitones = shortestSemitoneInterval(sourceEntry.rootIndex, targetEntry.rootIndex);
  const copiedLayer = { ...transposeLeadPayload(sourceLayer, semitones), id: Date.now() + '-' + Math.random().toString(36).slice(2), savedAt: Date.now(), solo: false };
  const updated = progression.map((en, i) => i === targetIdx ? { ...en, leadGrids: [...getEntryLeadGrids(en), copiedLayer], leadGrid: undefined } : en);
  setProgression(updated);
});

document.getElementById('leadCopyToBtn').addEventListener('click', () => {
  showLeadCopyTargetPicker();
});

document.getElementById('leadSaveSelectedToBinBtn').addEventListener('click', () => {
  if (!selectedLeadForCopy) return;
  const sourceEntry = progression[selectedLeadForCopy.entryIdx];
  if (!sourceEntry) return;
  if (selectedLeadForCopy.type === 'drum') {
    if (!sourceEntry.drumPattern) return;
    addToSavedBin({
      id: Date.now() + '-' + Math.random().toString(36).slice(2),
      type: 'drum', payload: sourceEntry.drumPattern, customName: null,
      chordContext: sourceEntry.chordName, keyIndex: null, modeName: null,
      createdAt: Date.now(), lastAttachedChordName: sourceEntry.chordName,
    });
  } else {
    const sourceLayer = getEntryLeadGrids(sourceEntry).find(g => g.id === selectedLeadForCopy.layerId);
    if (!sourceLayer) return;
    addToSavedBin({
      id: Date.now() + '-' + Math.random().toString(36).slice(2),
      type: 'lead', payload: sourceLayer, customName: null,
      chordContext: sourceEntry.chordName,
      keyIndex: sourceLayer.keyIndex !== undefined ? sourceLayer.keyIndex : sourceEntry.rootIndex,
      modeName: sourceLayer.modeName || null,
      createdAt: Date.now(), lastAttachedChordName: sourceEntry.chordName,
    });
  }
  window.alert('Saved to your bin.');
});

const leadKeyModeMapOverlay = document.getElementById('leadKeyModeMapOverlay');
const leadKeyModeMapKeySelect = document.getElementById('leadKeyModeMapKeySelect');
const leadKeyModeMapModeSelect = document.getElementById('leadKeyModeMapModeSelect');
ROOT_TO_DB_KEY.forEach((_, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = NOTE_NAMES[i];
  leadKeyModeMapKeySelect.appendChild(opt);
});
MODE_NAMES.forEach(modeName => {
  const opt = document.createElement('option');
  opt.value = modeName;
  opt.textContent = modeName;
  leadKeyModeMapModeSelect.appendChild(opt);
});

document.getElementById('leadMapToKeyModeBtn').addEventListener('click', () => {
  if (!selectedLeadForCopy || selectedLeadForCopy.type === 'drum') return; // drums aren't pitched -- nothing to remap
  const sourceEntry = progression[selectedLeadForCopy.entryIdx];
  const sourceLayer = sourceEntry && getEntryLeadGrids(sourceEntry).find(g => g.id === selectedLeadForCopy.layerId);
  if (!sourceLayer) return;
  // Pre-fill with whatever key/mode this lead was actually built in
  // (saved on the payload itself), not always the Lead tab's current
  // editor state, since the selected lead might belong to a different
  // chord than whatever's currently open for editing.
  leadKeyModeMapKeySelect.value = sourceLayer.keyIndex !== undefined ? sourceLayer.keyIndex : sourceEntry.rootIndex;
  leadKeyModeMapModeSelect.value = sourceLayer.modeName || 'Ionian';
  leadKeyModeMapOverlay.style.display = 'flex';
});
document.getElementById('leadKeyModeMapCloseBtn').addEventListener('click', () => {
  leadKeyModeMapOverlay.style.display = 'none';
});
leadKeyModeMapOverlay.addEventListener('click', (e) => {
  if (e.target === leadKeyModeMapOverlay) leadKeyModeMapOverlay.style.display = 'none';
});
document.getElementById('leadKeyModeMapApplyBtn').addEventListener('click', () => {
  if (!selectedLeadForCopy || selectedLeadForCopy.type === 'drum') return;
  const sourceEntry = progression[selectedLeadForCopy.entryIdx];
  const sourceLayer = sourceEntry && getEntryLeadGrids(sourceEntry).find(g => g.id === selectedLeadForCopy.layerId);
  if (!sourceLayer) { leadKeyModeMapOverlay.style.display = 'none'; return; }
  const sourceKeyIndex = sourceLayer.keyIndex !== undefined ? sourceLayer.keyIndex : sourceEntry.rootIndex;
  const sourceModeName = sourceLayer.modeName || 'Ionian';
  const targetKeyIndex = parseInt(leadKeyModeMapKeySelect.value, 10);
  const targetModeName = leadKeyModeMapModeSelect.value;
  const remapped = {
    ...remapLeadPayloadToKeyMode(sourceLayer, sourceKeyIndex, MODES_TABLE[sourceModeName].intervals, targetKeyIndex, MODES_TABLE[targetModeName].intervals),
    keyIndex: targetKeyIndex, modeName: targetModeName, // update the saved key/mode too, so a later re-map starts from the correct baseline instead of the original
  };
  const updated = progression.map((en, i) => {
    if (i !== selectedLeadForCopy.entryIdx) return en;
    return { ...en, leadGrids: getEntryLeadGrids(en).map(g => g.id === selectedLeadForCopy.layerId ? remapped : g) };
  });
  setProgression(updated);
  leadKeyModeMapOverlay.style.display = 'none';
});

leadSaveGridBtn.addEventListener('click', () => {
  const filledCount = leadGridSlots.filter(Boolean).length;
  if (filledCount === 0) {
    window.alert('Place at least one note in the grid first.');
    return;
  }
  if (leadEditingEntryIndex !== null && leadEditingLayerId !== null && progression[leadEditingEntryIndex]) {
    updateLeadInPlace(); // already linked to a specific layer -- just refresh it, no need to re-pick a target
  } else {
    showLeadTargetPicker('replace');
  }
});

const leadSaveAsNewBtn = document.getElementById('leadSaveAsNewBtn');
leadSaveAsNewBtn.addEventListener('click', () => {
  const filledCount = leadGridSlots.filter(Boolean).length;
  if (filledCount === 0) {
    window.alert('Place at least one note in the grid first.');
    return;
  }
  showLeadTargetPicker('replace'); // always opens the picker -- sends this lead to a chosen chord, replacing that chord's entire stack with just this one
});

const leadSaveStackedBtn = document.getElementById('leadSaveStackedBtn');
leadSaveStackedBtn.addEventListener('click', () => {
  const filledCount = leadGridSlots.filter(Boolean).length;
  if (filledCount === 0) {
    window.alert('Place at least one note in the grid first.');
    return;
  }
  showLeadTargetPicker('stack'); // adds this lead as an additional layer on the chosen chord, preserving whatever's already there -- bass line + guitar lead + keys, all on the same chord
});

// ---- Saved Bin UI -- save/browse/attach/rename/delete for the
// independent lead/drum library. Attaching always COPIES into the
// target chord (same as every other cross-chord copy in this app,
// including auto-transpose for leads), never a live link -- see the
// data-model comment in chart-progression.js for why.
const savedBinOverlay = document.getElementById('savedBinOverlay');
const savedBinBody = document.getElementById('savedBinBody');
const savedBinAttachOverlay = document.getElementById('savedBinAttachOverlay');
const savedBinAttachBody = document.getElementById('savedBinAttachBody');

function closeSavedBinOverlay(){ savedBinOverlay.style.display = 'none'; }
function closeSavedBinAttachOverlay(){ savedBinAttachOverlay.style.display = 'none'; }

function renderSavedBin(){
  const bin = loadSavedBin();
  savedBinBody.innerHTML = '';
  if (bin.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'saved-bin-empty';
    empty.textContent = 'Nothing saved yet -- use "Save to Bin" on the Lead or Drums tab to keep something here, independent of any chord.';
    savedBinBody.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'modulation-list';
  // newest first -- what you just saved is what you're most likely looking for
  [...bin].sort((a, b) => b.createdAt - a.createdAt).forEach(entry => {
    const row = document.createElement('div');
    row.className = 'saved-bin-row';

    const info = document.createElement('div');
    info.className = 'saved-bin-row-info';
    const label = document.createElement('span');
    label.className = 'saved-bin-row-label';
    label.textContent = entry.customName || formatSavedBinEntryLabel(entry);
    info.appendChild(label);
    const meta = document.createElement('span');
    meta.className = 'saved-bin-row-meta';
    const metaKindLabel = entry.type === 'drum' ? 'Drum pattern' : (entry.payload && entry.payload.isBass ? 'Bass' : 'Lead');
    meta.textContent = metaKindLabel
      + (entry.lastAttachedChordName ? ' \u2014 last sent to ' + entry.lastAttachedChordName : ' \u2014 not yet attached to a chord');
    info.appendChild(meta);
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'saved-bin-row-actions';

    const attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'mini-btn';
    attachBtn.textContent = '+';
    attachBtn.title = 'Attach a copy of this to a chord';
    attachBtn.setAttribute('aria-label', 'Attach ' + (entry.customName || formatSavedBinEntryLabel(entry)) + ' to a chord');
    attachBtn.addEventListener('click', () => showSavedBinAttachPicker(entry.id));
    actions.appendChild(attachBtn);

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'mini-btn';
    renameBtn.textContent = '\u270e'; // pencil
    renameBtn.title = 'Rename';
    renameBtn.setAttribute('aria-label', 'Rename ' + (entry.customName || formatSavedBinEntryLabel(entry)));
    renameBtn.addEventListener('click', () => {
      const newName = window.prompt('Name this ' + (entry.type === 'drum' ? 'drum pattern' : 'lead') + ':', entry.customName || '');
      if (newName === null) return; // cancelled
      renameSavedBinEntry(entry.id, newName.trim());
      renderSavedBin();
    });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'mini-btn';
    deleteBtn.textContent = '\u00d7';
    deleteBtn.title = 'Delete from the bin';
    deleteBtn.setAttribute('aria-label', 'Delete ' + (entry.customName || formatSavedBinEntryLabel(entry)) + ' from the bin');
    deleteBtn.addEventListener('click', () => {
      if (!window.confirm('Delete this from your saved bin? This can\u2019t be undone.')) return;
      removeFromSavedBin(entry.id);
      renderSavedBin();
    });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);
    list.appendChild(row);
  });
  savedBinBody.appendChild(list);
}

function showSavedBinAttachPicker(entryId){
  const entry = loadSavedBin().find(e => e.id === entryId);
  if (!entry) return;
  if (progression.length === 0) {
    window.alert('Your progression is empty -- add some chords on the Chart tab first, then come back to attach this.');
    return;
  }
  savedBinAttachBody.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'modulation-list';
  progression.forEach((chordEntry, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'modulation-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'modulation-row-name';
    if (entry.type === 'drum') {
      nameSpan.textContent = chordEntry.chordName + (chordEntry.drumPattern ? ' (has a pattern -- will replace it)' : '');
    } else {
      const existingCount = getEntryLeadGrids(chordEntry).length;
      const sourceKeyIndex = entry.keyIndex !== null && entry.keyIndex !== undefined ? entry.keyIndex : chordEntry.rootIndex;
      const semitones = shortestSemitoneInterval(sourceKeyIndex, chordEntry.rootIndex);
      const transposeNote = semitones !== 0 ? (' -- transposed ' + (semitones > 0 ? '+' : '') + semitones + ' semitone' + (Math.abs(semitones) > 1 ? 's' : '')) : '';
      nameSpan.textContent = chordEntry.chordName + (existingCount > 0 ? ' (has ' + existingCount + ' lead' + (existingCount > 1 ? 's' : '') + ' -- will add another)' : '') + transposeNote;
    }
    row.appendChild(nameSpan);
    row.addEventListener('click', () => {
      if (entry.type === 'drum') {
        saveDrumPatternInto(i, entry.payload);
      } else {
        const sourceKeyIndex = entry.keyIndex !== null && entry.keyIndex !== undefined ? entry.keyIndex : chordEntry.rootIndex;
        const semitones = shortestSemitoneInterval(sourceKeyIndex, chordEntry.rootIndex);
        const copiedLayer = { ...transposeLeadPayload(entry.payload, semitones), id: Date.now() + '-' + Math.random().toString(36).slice(2), savedAt: Date.now(), solo: false };
        const updated = progression.map((en, j) => j === i ? { ...en, leadGrids: [...getEntryLeadGrids(en), copiedLayer], leadGrid: undefined } : en);
        setProgression(updated);
      }
      const bin = loadSavedBin();
      const binEntry = bin.find(e => e.id === entryId);
      if (binEntry) { binEntry.lastAttachedChordName = chordEntry.chordName; writeSavedBin(bin); }
      closeSavedBinAttachOverlay();
      renderSavedBin();
    });
    list.appendChild(row);
  });
  savedBinAttachBody.appendChild(list);
  savedBinAttachOverlay.style.display = 'flex';
}

document.getElementById('savedBinCloseBtn').addEventListener('click', closeSavedBinOverlay);
savedBinOverlay.addEventListener('click', (e) => { if (e.target === savedBinOverlay) closeSavedBinOverlay(); });
document.getElementById('savedBinAttachCloseBtn').addEventListener('click', closeSavedBinAttachOverlay);
savedBinAttachOverlay.addEventListener('click', (e) => { if (e.target === savedBinAttachOverlay) closeSavedBinAttachOverlay(); });

document.getElementById('leadOpenBinBtn').addEventListener('click', () => {
  renderSavedBin();
  savedBinOverlay.style.display = 'flex';
});
document.getElementById('drumOpenBinBtn').addEventListener('click', () => {
  renderSavedBin();
  savedBinOverlay.style.display = 'flex';
});

// Go to Progression -- switches to Chart mode AND scrolls straight to the
// progression panel, instead of leaving the user to scroll down within
// Chart themselves after the tab switch. Chart mode is otherwise a tall
// page (mode picker + diatonic chord tables sit above the tray), so
// without this a round trip from Lead/Drums is scroll up, then scroll
// down again -- exactly the friction being fixed here.
function goToProgression(){
  showChartMode();
  const panel = document.querySelector('.progression-panel');
  if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.getElementById('leadGoToProgressionBtn').addEventListener('click', goToProgression);
document.getElementById('drumGoToProgressionBtn').addEventListener('click', goToProgression);
document.getElementById('leadGoToDrumsBtn').addEventListener('click', showDrumsMode);
document.getElementById('drumGoToLeadBtn').addEventListener('click', showLeadMode);

document.getElementById('leadSaveToBinBtn').addEventListener('click', () => {
  if (leadGridSlots.every(s => !s)) {
    window.alert('Place at least one note in the grid first.');
    return;
  }
  addToSavedBin({
    id: Date.now() + '-' + Math.random().toString(36).slice(2),
    type: 'lead',
    payload: buildLeadGridPayload(),
    customName: null,
    chordContext: null, // saved fresh from the editor, not from an existing chord's attached lead
    keyIndex: parseInt(leadKeySelect.value, 10),
    modeName: leadModeSelect.value,
    createdAt: Date.now(),
    lastAttachedChordName: null,
  });
  leadUnsavedTracker.markClean();
  window.alert('Saved to your bin.');
});

document.getElementById('drumSaveToBinBtn').addEventListener('click', () => {
  if (drumGridSlots.every(col => col.every(v => !v))) {
    window.alert('Place at least one hit in the grid first.');
    return;
  }
  addToSavedBin({
    id: Date.now() + '-' + Math.random().toString(36).slice(2),
    type: 'drum',
    payload: buildDrumPatternPayload(),
    customName: null,
    chordContext: null,
    keyIndex: null,
    modeName: null,
    createdAt: Date.now(),
    lastAttachedChordName: null,
  });
  drumUnsavedTracker.markClean();
  window.alert('Saved to your bin.');
});
