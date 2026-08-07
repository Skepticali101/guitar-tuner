// ---- progression tray -- persists via localStorage until explicitly cleared ----
const PROGRESSION_STORAGE_KEY = 'ftr-progression-v1';
let progression = [];
let selectedLeadForCopy = null; // { type: 'lead'|'drum', entryIdx, layerId (leads only), chordName } | null -- which chip is checked for the Dup/Copy toolbar
try {
  const saved = localStorage.getItem(PROGRESSION_STORAGE_KEY);
  if (saved) progression = JSON.parse(saved);
} catch (e) { progression = []; }

function saveProgression(){
  try {
    localStorage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(progression));
  } catch (e) {
    console.error('Failed to save progression to localStorage -- changes will be lost on reload:', e);
  }
}

// ---- named, saved progressions -- a small "song list" separate from the
// single working progression above. Each entry is a full independent
// snapshot: saving never touches the working tray, and loading one always
// goes through setProgression so it's undo-able like any other change.
const SAVED_PROGRESSIONS_KEY = 'ftr-saved-progressions-v1';
function loadSavedProgressions(){
  try {
    const raw = localStorage.getItem(SAVED_PROGRESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load saved progressions:', e);
    return [];
  }
}
function writeSavedProgressions(list){
  try {
    localStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save the progression list -- it may not persist across reloads:', e);
  }
}

// ---- Saved Bin -- a permanent library of standalone lead/drum patterns,
// independent of any chord or progression. Something built while
// exploring that's worth keeping even if it doesn't fit the current
// project. Attaching a bin entry to a chord COPIES it there (same as
// every other cross-chord copy in this app) -- the bin entry and the
// chord's own copy are independent after that point, by design, so
// editing one never silently changes the other. lastAttachedChordName is
// purely informational (last place this was sent), not a live link.
const SAVED_BIN_KEY = 'ftr-saved-bin-v1';
function loadSavedBin(){
  try {
    const raw = localStorage.getItem(SAVED_BIN_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load the saved bin:', e);
    return [];
  }
}
function writeSavedBin(list){
  try {
    localStorage.setItem(SAVED_BIN_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save the bin -- it may not persist across reloads:', e);
  }
}
function addToSavedBin(entry){
  const bin = loadSavedBin();
  bin.push(entry);
  writeSavedBin(bin);
  return bin;
}
function removeFromSavedBin(id){
  writeSavedBin(loadSavedBin().filter(e => e.id !== id));
}
function renameSavedBinEntry(id, newName){
  const bin = loadSavedBin();
  const entry = bin.find(e => e.id === id);
  if (entry) entry.customName = newName || null;
  writeSavedBin(bin);
}

// Builds the default, no-custom-name label: chord context (if this was
// saved from an existing chord's content) or key+mode (for a lead saved
// fresh from the editor), plus the creation date. A custom name, if set,
// is used instead entirely -- this is only the fallback.
function formatSavedBinEntryLabel(entry){
  const dateStr = new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (entry.type === 'drum') {
    const kitLabel = DRUM_KIT_LABELS[entry.payload.kit] || entry.payload.kit;
    return kitLabel + ' Drum Pattern \u2014 ' + dateStr;
  }
  const kindLabel = entry.payload && entry.payload.isBass ? 'Bass' : 'Lead';
  if (entry.chordContext) {
    return entry.chordContext + ' ' + kindLabel + ' \u2014 ' + dateStr;
  }
  const keyLabel = (entry.keyIndex !== null && entry.keyIndex !== undefined) ? NOTE_NAMES[entry.keyIndex] : '';
  const modeLabel = entry.modeName || '';
  return [keyLabel, modeLabel, kindLabel].filter(Boolean).join(' ') + ' \u2014 ' + dateStr;
}

// ---- Centralized progression mutation -- every single change to the
// progression array (add, remove, reorder, transpose, mod-swap, voicing
// change, clear, preset-load) goes through this one function instead of
// each of those ~14 call sites independently handling persistence,
// re-rendering, and preset-tracking. This is what makes Undo possible
// without bolting separate tracking onto every one of them -- and it's the
// same reasoning as extracting createChartCard: one place to get right,
// instead of many places that can quietly drift out of sync with each
// other over time.
let progressionUndoStack = [];
let progressionRedoStack = [];
const MAX_UNDO_STEPS = 20;

// Several places track "which chord/layer am I currently editing or have
// selected" by array index (selectedLeadForCopy.entryIdx,
// leadEditingEntryIndex, drumEditingEntryIndex, fretboardActiveEntryIndex).
// An array index is only meaningful until the array itself changes shape --
// removing, inserting, or reordering any entry shifts every index after it,
// silently pointing these trackers at a DIFFERENT chord than the one they
// were actually set for. Left unfixed, this means things like Save Lead,
// Dup to Next Chord, or the mute/solo copy toolbar can quietly overwrite or
// operate on the wrong chord's content the next time they're used -- not a
// crash, just silent, hard-to-notice data corruption. Called from
// setProgression itself (not renderProgression) so it can never be skipped
// regardless of which render/history options a caller passes.
function revalidateIndexBasedEditingState(){
  if (selectedLeadForCopy) {
    const foundIdx = selectedLeadForCopy.type === 'drum'
      ? progression.findIndex(e => e.drumPattern && e.drumPattern.id === selectedLeadForCopy.drumPatternId)
      : progression.findIndex(e => getEntryLeadGrids(e).some(g => g.id === selectedLeadForCopy.layerId));
    selectedLeadForCopy = foundIdx === -1 ? null : { ...selectedLeadForCopy, entryIdx: foundIdx, chordName: progression[foundIdx].chordName };
  }
  if (leadEditingLayerId !== null) {
    const foundIdx = progression.findIndex(e => getEntryLeadGrids(e).some(g => g.id === leadEditingLayerId));
    leadEditingEntryIndex = foundIdx === -1 ? null : foundIdx;
    if (foundIdx === -1) leadEditingLayerId = null;
  }
  if (drumEditingPatternId !== null) {
    const foundIdx = progression.findIndex(e => e.drumPattern && e.drumPattern.id === drumEditingPatternId);
    drumEditingEntryIndex = foundIdx === -1 ? null : foundIdx;
    if (foundIdx === -1) drumEditingPatternId = null;
  }
  // fretboardActiveEntryIndex (the older arp-recording feature) has no
  // stable id of its own to re-locate by -- ending that preview/recording
  // session is the safe choice here, versus risking a write to whatever
  // chord now happens to sit at the same index.
  fretboardActiveEntryIndex = null;
}

function setProgression(newProgression, options){
  options = options || {};
  if (!options.skipHistory) {
    progressionUndoStack.push(JSON.stringify(progression)); // snapshot from BEFORE this change
    if (progressionUndoStack.length > MAX_UNDO_STEPS) progressionUndoStack.shift();
    progressionRedoStack = []; // any new edit invalidates the redo history -- standard undo/redo semantics
  }
  progression = newProgression;
  revalidateIndexBasedEditingState();
  if (!options.keepPreset) activePresetIndex = null; // any manual edit means this is no longer the untouched preset
  saveProgression();
  if (!options.skipRender) {
    renderProgression();
    syncCardSelectionStates();
  }
  updateUndoBtnState();
}

// Applies one field change to every chip of the same KIND across the
// whole progression, not just the one the user directly interacted
// with -- the Shift-held "sync all like chips" gesture. kind is
// 'chord' (the chip itself) or 'lead' (every lead layer on every
// chord). Goes through the normal setProgression path, so this is a
// single undo-able action, not one per chip touched.
function applyToAllLikeChips(kind, field, value){
  if (kind === 'chord') {
    setProgression(progression.map(en => ({ ...en, [field]: value })));
  } else if (kind === 'lead') {
    setProgression(progression.map(en => {
      const grids = getEntryLeadGrids(en);
      if (grids.length === 0) return en;
      return { ...en, leadGrids: grids.map(g => ({ ...g, [field]: value })), leadGrid: undefined };
    }));
  }
}

function undoProgression(){
  if (progressionUndoStack.length === 0) return;
  progressionRedoStack.push(JSON.stringify(progression)); // save current state so redo can restore it
  const prevSnapshot = progressionUndoStack.pop();
  progression = JSON.parse(prevSnapshot);
  saveProgression();
  renderProgression();
  syncCardSelectionStates();
  updateUndoBtnState();
}

function redoProgression(){
  if (progressionRedoStack.length === 0) return;
  progressionUndoStack.push(JSON.stringify(progression)); // so the redo itself can be undone again if needed
  const nextSnapshot = progressionRedoStack.pop();
  progression = JSON.parse(nextSnapshot);
  saveProgression();
  renderProgression();
  syncCardSelectionStates();
  updateUndoBtnState();
}

function updateUndoBtnState(){
  if (typeof undoProgressionBtn !== 'undefined' && undoProgressionBtn) {
    undoProgressionBtn.disabled = progressionUndoStack.length === 0;
  }
  if (typeof redoProgressionBtn !== 'undefined' && redoProgressionBtn) {
    redoProgressionBtn.disabled = progressionRedoStack.length === 0;
  }
}

// ---- persistent "in progression" highlight on chart cards, tracked by ROOT
// rather than exact (root+suffix) pair -- so editing a chord's mod on either
// side (the card or its matching chip in the tray) keeps the card linked and
// highlighted, following whatever variant is currently in the progression,
// instead of silently losing the highlight the moment the two diverge.
// Only an actual removal from the progression breaks the link. ----
let renderedChartCards = []; // { card, rootIndex, getCurrentSuffix, followLinkedSuffix, refreshToggleBtn } for every card currently on screen

function findLinkedEntry(rootIndex){
  // most recently added/edited entry with this root; if you have two
  // different variants of the same root chord in your progression, the
  // card follows whichever one was touched most recently.
  //
  // When a section is currently active, the search is scoped to just that
  // section's chords -- otherwise a chord already used in a DIFFERENT
  // section (a very common case -- the same chord often appears in both a
  // verse and a chorus) would incorrectly show as "already added" while
  // you're building a new section, forcing an awkward deselect-then-add
  // dance to add it again for the section you're actually working on.
  const scope = activeSectionName ? progression.filter(e => e.section === activeSectionName) : progression;
  for (let i = scope.length - 1; i >= 0; i--) {
    if (scope[i].rootIndex === rootIndex) return scope[i];
  }
  return null;
}

// Exact (root AND suffix) match -- used for secondary dominants and
// borrowed chords instead of the root-only match above. Those cards
// frequently share a root with some completely unrelated chord already in
// the progression (a secondary dominant's root is literally "a fifth above
// an existing diatonic root", so overlap is common) -- root-only matching
// made them show as already-added just from that coincidence, even when
// that exact chord had never actually been added. Same section-scoping as
// findLinkedEntry above, for the same reason.
function findExactEntry(rootIndex, suffix){
  const scope = activeSectionName ? progression.filter(e => e.section === activeSectionName) : progression;
  for (let i = scope.length - 1; i >= 0; i--) {
    if (scope[i].rootIndex === rootIndex && scope[i].suffix === suffix) return scope[i];
  }
  return null;
}

function syncCardSelectionStates(){
  renderedChartCards.forEach(entry => {
    const linked = entry.exactMatch
      ? findExactEntry(entry.rootIndex, entry.getCurrentSuffix())
      : findLinkedEntry(entry.rootIndex);
    entry.card.classList.toggle('selected', !!linked);
    if (linked && entry.followLinkedSuffix) {
      entry.followLinkedSuffix(linked.suffix, linked.voicingIndex || 0);
    } else if (!linked && entry.resetToBaseSuffix) {
      entry.resetToBaseSuffix();
    }
    if (entry.refreshToggleBtn) entry.refreshToggleBtn();
  });
}

// Drag-to-reorder for progression chips, built on Pointer Events (unifies
// mouse and touch) rather than native HTML5 drag-and-drop, which doesn't
// work reliably on iOS Safari -- the primary device this app is actually
// used on. The dragged chip's DOM node moves live as you drag over other
// chips (immediate visual feedback); on release, the final DOM order is
// read back and used to rebuild the actual progression array.
// Reorder by discrete position swap -- used by both the arrow buttons on
// each chip and the ArrowLeft/ArrowRight keyboard handler below. Deliberately
// NOT drag-based: a custom pointer-tracking drag (tried in the previous
// round) turned out to be unreliable across devices, particularly touch --
// a simple index swap on a click/keypress has no continuous gesture state
// to get into a bad state in the first place.
function moveChip(idx, direction){
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= progression.length) return false;
  const updated = [...progression];
  const [moved] = updated.splice(idx, 1); // splice on the COPY, not the real progression array
  updated.splice(newIdx, 0, moved);
  setProgression(updated);
  return true;
}

// Section block reordering -- moves an entire contiguous section run (e.g.
// all of "Chorus") as one unit, swapping it with its immediate neighbor.
// Verified against several scenarios (mid-swap, boundary cases) before
// wiring into the UI.
// Auto-increments a section name for duplication -- "Verse 1" -> "Verse 2",
// "Chorus" (no number) -> "Chorus 2". Verified against several realistic
// naming patterns (double-digit numbers, hyphenated names, no trailing
// number) before being wired into Duplicate Section.
function nextSectionName(name){
  const match = name.match(/^(.*?)(\d+)\s*$/);
  if (match) {
    const prefix = match[1];
    const num = parseInt(match[2], 10);
    return prefix + (num + 1);
  }
  return name + ' 2';
}

function findBlockBounds(prog, anchorIdx){
  const section = prog[anchorIdx].section;
  let start = anchorIdx, end = anchorIdx;
  while (start > 0 && prog[start - 1].section === section) start--;
  while (end < prog.length - 1 && prog[end + 1].section === section) end++;
  return { start, end };
}
function moveSectionBlock(anchorIdx, direction){
  const { start, end } = findBlockBounds(progression, anchorIdx);
  if (direction === -1) {
    if (start === 0) return false;
    const prevBounds = findBlockBounds(progression, start - 1);
    const updated = [
      ...progression.slice(0, prevBounds.start),
      ...progression.slice(start, end + 1),
      ...progression.slice(prevBounds.start, prevBounds.end + 1),
      ...progression.slice(end + 1)
    ];
    setProgression(updated);
    return true;
  } else {
    if (end === progression.length - 1) return false;
    const nextBounds = findBlockBounds(progression, end + 1);
    const updated = [
      ...progression.slice(0, start),
      ...progression.slice(nextBounds.start, nextBounds.end + 1),
      ...progression.slice(start, end + 1),
      ...progression.slice(nextBounds.end + 1)
    ];
    setProgression(updated);
    return true;
  }
}
// ---- Section definitions: an optional layer ON TOP of the flat progression
// list, not a replacement for it. The working progression stays the single
// source of truth (so undo, transpose, playback, MIDI export -- everything
// already built -- keeps working completely unchanged). A "definition" is
// just a separately-stored, named snapshot of a section's chords. Syncing
// between a definition and the chords actually in your progression is
// always a DELIBERATE, explicit action -- never automatic -- since real
// songs commonly have small variations between repeats (a different last
// chord in the final chorus, etc.) that a rigid "must always match" model
// would fight against.
const SECTION_DEFINITIONS_KEY = 'ftr-section-definitions-v1';
function loadSectionDefinitions(){
  try {
    const raw = localStorage.getItem(SECTION_DEFINITIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to load section definitions:', e);
    return [];
  }
}
function writeSectionDefinitions(list){
  try {
    localStorage.setItem(SECTION_DEFINITIONS_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save section definitions:', e);
  }
}

// Saves (or updates) a definition from the chords currently in the
// progression under this section name. Deliberately scoped to just the
// FIRST contiguous run tagged with this name, not every entry matching it
// anywhere in the progression -- if the same section name appears twice
// with different content (a real, common case), grabbing all of them would
// silently blend two different instances into one corrupted definition.
function saveSectionDefinition(name){
  const firstIdx = progression.findIndex(e => e.section === name);
  if (firstIdx === -1) return false;
  const { start, end } = findBlockBounds(progression, firstIdx);
  const chords = progression.slice(start, end + 1).map(e => {
    const { section, ...rest } = e; // stripped -- reapplied fresh at insert/sync time
    return rest;
  });
  const definitions = loadSectionDefinitions();
  const existingIdx = definitions.findIndex(d => d.name === name);
  const newDef = { id: existingIdx >= 0 ? definitions[existingIdx].id : Date.now(), name, chords };
  if (existingIdx >= 0) definitions[existingIdx] = newDef;
  else definitions.push(newDef);
  writeSectionDefinitions(definitions);
  return true;
}

// Replaces EVERY contiguous run tagged with this section name, anywhere in
// the progression, with a fresh copy of the definition -- verified against
// a two-instance scenario (different current content in each) before this
// was wired into any UI.
function syncFromDefinition(name){
  const definitions = loadSectionDefinitions();
  const def = definitions.find(d => d.name === name);
  if (!def) return false;
  const result = [];
  let i = 0;
  while (i < progression.length) {
    if (progression[i].section === name) {
      result.push(...def.chords.map(c => ({ ...c, section: name })));
      while (i < progression.length && progression[i].section === name) i++;
    } else {
      result.push(progression[i]);
      i++;
    }
  }
  setProgression(result);
  return true;
}

function insertSectionDefinition(definitionId){
  const definitions = loadSectionDefinitions();
  const def = definitions.find(d => String(d.id) === String(definitionId));
  if (!def) return false;
  const copies = def.chords.map(c => ({ ...c, section: def.name }));
  setProgression([...progression, ...copies]);
  return true;
}


// Classifies a chord's roman-numeral label for cadence detection.
// Deliberately excludes secondary-dominant labels (anything with "/") --
// "V7/vi" starting with "V" would otherwise false-positive as a plain
// dominant resolving to the main tonic, which it isn't.
function classifyLabel(label){
  if (!label || label.includes('/')) return null;
  const clean = label.replace(/\u00b0|\+/g, ''); // strip \u00b0 and + decorations
  if (clean === 'I' || clean === 'i') return 'tonic';
  if (clean === 'IV' || clean === 'iv') return 'subdominant';
  if (clean === 'vi' || clean === 'VI') return 'submediant';
  if (clean.startsWith('V') && !clean.startsWith('VI')) return 'dominant'; // V, V7 -- but not VI
  return null;
}
function detectCadence(prog){
  if (prog.length < 2) return null;
  const prev = classifyLabel(prog[prog.length - 2].label);
  const last = classifyLabel(prog[prog.length - 1].label);
  if (prev === 'dominant' && last === 'tonic') return 'Perfect Authentic Cadence \u2014 strong, complete resolution';
  if (prev === 'dominant' && last === 'submediant') return 'Deceptive Cadence \u2014 resolution redirected at the last moment';
  if (prev === 'subdominant' && last === 'tonic') return 'Plagal Cadence \u2014 the classic \u201cAmen\u201d resolution';
  if (last === 'dominant') return 'Half Cadence \u2014 ends open, wanting resolution';
  return null;
}

// How many bars a chord's beats value spans, for the chip's bar-length
// indicator. Rounds rather than floors/ceils since a chord's beats should
// always be an exact multiple of beatsPerBar in practice (the selector
// only offers bar-aligned options) -- rounding just guards against odd
// data (e.g. an old saved progression with a raw, non-bar-aligned value)
// without ever showing zero segments.
function computeBarCount(beats, beatsPerBarValue){
  return Math.max(1, Math.round((beats || beatsPerBarValue) / beatsPerBarValue));
}

let renderedChipElements = []; // parallel to progression -- chips are no longer direct children of progressionRow now that they're grouped into per-section rows, so anything needing "the chip at index i" uses this instead of DOM position
// Set by a caller right before triggering a re-render (setProgression ->
// renderProgression) to request that a specific chip gets focused and
// scrolled into view once the rebuild finishes -- e.g. Duplicate sets
// this to the new chip's index so the user actually sees what they just
// created, instead of the tray silently rebuilding off-screen. When left
// null, renderProgression instead just preserves whatever scroll position
// the tray already had, so routine in-place toggles (mute, solo, pattern
// change) never visually move anything the user wasn't touching.
let pendingChipFocusIndex = null;
function renderProgression(){
  // Selection can go stale if the selected chip's chord (or the lead/drum
  // content itself) was removed by some other action -- validate and
  // clear rather than leaving the toolbar pointing at something that no
  // longer exists.
  if (selectedLeadForCopy) {
    const entry = progression[selectedLeadForCopy.entryIdx];
    const stillExists = entry && (selectedLeadForCopy.type === 'drum'
      ? !!entry.drumPattern
      : getEntryLeadGrids(entry).some(g => g.id === selectedLeadForCopy.layerId));
    if (!stillExists) selectedLeadForCopy = null;
  }
  updateLeadCopyToolbar();
  if (activePresetIndex !== null && POPULAR_PROGRESSIONS[activePresetIndex]) {
    progressionStatus.style.display = '';
    progressionStatus.textContent = '\u2713 Tracking "' + POPULAR_PROGRESSIONS[activePresetIndex].name + '" -- changes to key/mode auto-update it. Edit any chord to make it your own.';
  } else {
    progressionStatus.style.display = 'none';
  }

  if (progression.length > 0) {
    progressionSummary.style.display = '';
    progressionSummary.textContent = progression.map(e => e.label).join(' \u2013 ');
  } else {
    progressionSummary.style.display = 'none';
  }

  const cadence = detectCadence(progression);
  if (cadence) {
    progressionCadence.style.display = '';
    progressionCadence.textContent = cadence;
  } else {
    progressionCadence.style.display = 'none';
  }

  const preservedScrollLeft = progressionRow.scrollLeft;
  // The outer #progressionRow is NOT where chips actually scroll -- they
  // live in inner .progression-row divs (one per section, or one shared
  // row when there are none), which get fully destroyed and rebuilt
  // below. Capture each inner row's own scroll position first, keyed by
  // its section, so it can be restored onto the newly-created row with
  // the same section after rebuild -- preserving only the outer
  // container's scrollLeft (as an earlier version of this fix did) never
  // actually touched the element that was really scrolling.
  const preservedInnerScrollLeftBySection = {};
  progressionRow.querySelectorAll(':scope > .progression-row').forEach(row => {
    preservedInnerScrollLeftBySection[row.dataset.section || '__none__'] = row.scrollLeft;
  });
  progressionRow.innerHTML = '';
  if (progression.length === 0) {
    progressionRow.appendChild(progressionEmpty);
    renderTimeline();
    pendingChipFocusIndex = null;
    return;
  }
  populateSectionNameOptions();
  renderedChipElements = [];
  let lastSection = undefined; // tracks section changes as we walk the list, to know when to start a new row
  let currentRow = null;
  function ensureRowFor(section, idx){
    if (section === lastSection && currentRow) return currentRow;
    lastSection = section;
    if (section) {
      const header = document.createElement('div');
      header.className = 'progression-section-header';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = section;
      header.appendChild(nameSpan);
      const playSectionBtn = document.createElement('button');
      playSectionBtn.type = 'button';
      playSectionBtn.className = 'progression-section-move-btn';
      playSectionBtn.textContent = '\u25b6';
      playSectionBtn.title = 'Play just this section';
      playSectionBtn.addEventListener('click', () => {
        loopSectionSelect.value = section;
        playProgressionThrough();
      });
      header.appendChild(playSectionBtn);
      const moveUpBtn = document.createElement('button');
      moveUpBtn.type = 'button';
      moveUpBtn.className = 'progression-section-move-btn';
      moveUpBtn.textContent = '\u25b2';
      moveUpBtn.title = 'Move this whole section earlier';
      moveUpBtn.addEventListener('click', () => moveSectionBlock(idx, -1));
      header.appendChild(moveUpBtn);
      const moveDownBtn = document.createElement('button');
      moveDownBtn.type = 'button';
      moveDownBtn.className = 'progression-section-move-btn';
      moveDownBtn.textContent = '\u25bc';
      moveDownBtn.title = 'Move this whole section later';
      moveDownBtn.addEventListener('click', () => moveSectionBlock(idx, 1));
      header.appendChild(moveDownBtn);
      progressionRow.appendChild(header);
    }
    currentRow = document.createElement('div');
    currentRow.className = 'progression-row';
    currentRow.dataset.section = section || '__none__';
    progressionRow.appendChild(currentRow);
    return currentRow;
  }
  progression.forEach((entry, idx) => {
    // Same rationale as chart cards: this contains a nested <select> and
    // <button>, so it can't be a real <button> itself (invalid nesting) --
    // role="button" + tabindex + explicit key handling instead.
    const chip = document.createElement('div');
    chip.className = 'progression-chip';
    chip.style.cursor = 'pointer';
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.setAttribute('aria-label', entry.chordName + ', ' + entry.label + ', ' + entry.modeName + '. Press Enter to preview, Delete to remove.');
    chip.addEventListener('click', () => {
      const shape = lookupEntryShape(entry);
      // Preview for exactly as long as this chord's own beat count represents
      // at the current tempo -- not a fixed length -- so clicking a chip
      // actually previews how it will sound in context, not a generic blip.
      const dur = (progression[idx].beats || 4) * beatMs() / 1000;
      if (shape) playChordShape(shape, chip, progression[idx].strumPattern, dur, previewOctaveDoubleToggle.checked, undefined, undefined, progression[idx].tremolo, progression[idx].delayPreset, progression[idx].envelopeFilter);
      maybePlayPreviewBassNote(shape, dur);
      maybePlayPreviewTopNote(shape, dur);
      updateFretboardPanel(shape, entry.chordName, entry.rootIndex, idx);
      updateChartPianoPanel(shape, entry.chordName, entry.rootIndex);
    });
    chip.addEventListener('keydown', (e) => {
      if (e.target !== chip) return; // let the nested select/button handle their own keys
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const shape = lookupEntryShape(entry);
        const dur = (progression[idx].beats || 4) * beatMs() / 1000;
        if (shape) playChordShape(shape, chip, progression[idx].strumPattern, dur, previewOctaveDoubleToggle.checked, undefined, undefined, progression[idx].tremolo, progression[idx].delayPreset, progression[idx].envelopeFilter);
        maybePlayPreviewBassNote(shape, dur);
        maybePlayPreviewTopNote(shape, dur);
        updateFretboardPanel(shape, entry.chordName, entry.rootIndex, idx);
        updateChartPianoPanel(shape, entry.chordName, entry.rootIndex);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setProgression(progression.filter((_, i) => i !== idx));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const newIdx = idx + (e.key === 'ArrowLeft' ? -1 : 1);
        if (moveChip(idx, e.key === 'ArrowLeft' ? -1 : 1)) {
          // refocus the same chord at its new position so repeated arrow
          // presses keep moving it further, instead of losing focus
          const movedChip = renderedChipElements[newIdx];
          if (movedChip) movedChip.focus();
        }
      }
    });

    // Bar-length indicator -- one small segment per bar this chord spans,
    // so scanning down the tray shows the arrangement's shape at a glance
    // (a 2-bar chord visibly reads as "twice as wide" as a 1-bar one)
    // without needing the chip itself to resize, which would squeeze out
    // the mod/beats/pattern selectors and action buttons it holds.
    const barIndicator = document.createElement('div');
    barIndicator.className = 'progression-chip-bar-indicator';
    const barCount = computeBarCount(entry.beats, beatsPerBar);
    for (let b = 0; b < barCount; b++) {
      const seg = document.createElement('span');
      barIndicator.appendChild(seg);
    }
    barIndicator.title = barCount + ' bar' + (barCount === 1 ? '' : 's');
    chip.appendChild(barIndicator);

    // Two small buttons instead of a drag handle -- move left/right one
    // position at a time. Simple, discrete, and fully keyboard-reachable
    // as real buttons (no separate accessibility work needed for these).
    const moveLeftBtn = document.createElement('button');
    moveLeftBtn.type = 'button';
    moveLeftBtn.className = 'progression-chip-move';
    moveLeftBtn.textContent = '\u2190';
    moveLeftBtn.disabled = (idx === 0);
    moveLeftBtn.setAttribute('aria-label', 'Move ' + entry.chordName + ' earlier');
    moveLeftBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveChip(idx, -1);
    });
    chip.appendChild(moveLeftBtn);

    const moveRightBtn = document.createElement('button');
    moveRightBtn.type = 'button';
    moveRightBtn.className = 'progression-chip-move';
    moveRightBtn.textContent = '\u2192';
    moveRightBtn.disabled = (idx === progression.length - 1);
    moveRightBtn.setAttribute('aria-label', 'Move ' + entry.chordName + ' later');
    moveRightBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveChip(idx, 1);
    });
    chip.appendChild(moveRightBtn);

    const nameEl = document.createElement('span');
    nameEl.className = 'progression-chip-name';
    nameEl.textContent = entry.chordName;
    chip.appendChild(nameEl);

    const chipModSelect = document.createElement('select');
    chipModSelect.className = 'progression-chip-mod';
    chipModSelect.setAttribute('aria-label', 'Change ' + entry.chordName + ' to a different extension');
    const bucket = suffixToQualityBucket(entry.suffix);
    const chipBaseOptions = simpleMode ? MOD_OPTIONS_SIMPLE[bucket] : MOD_OPTIONS[bucket];
    const chipAlreadyIncluded = chipBaseOptions.some(opt => opt.value === entry.suffix);
    const chipCurrentOption = !chipAlreadyIncluded ? MOD_OPTIONS[bucket].find(opt => opt.value === entry.suffix) : null;
    const chipOptions = chipCurrentOption ? [...chipBaseOptions, chipCurrentOption] : chipBaseOptions;
    chipOptions.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === entry.suffix) o.selected = true;
      chipModSelect.appendChild(o);
    });
    chipModSelect.addEventListener('click', (e) => e.stopPropagation());
    chipModSelect.addEventListener('change', () => {
      const newSuffix = chipModSelect.value;
      const updated = progression.map((e, i) => i === idx
        ? { ...e, suffix: newSuffix, chordName: NOTE_NAMES[entry.rootIndex] + newSuffix, voicingIndex: 0 }
        : e);
      setProgression(updated);
    });
    chip.appendChild(chipModSelect);

    const labelEl = document.createElement('span');
    labelEl.className = 'progression-chip-label';
    labelEl.textContent = entry.label + ' · ' + entry.modeName;
    chip.appendChild(labelEl);

    const beatsSelect = document.createElement('select');
    beatsSelect.className = 'progression-chip-beats';
    beatsSelect.setAttribute('aria-label', 'Length for ' + entry.chordName);
    const barOptions = [];
    if (beatsPerBar % 2 === 0) barOptions.push({ value: beatsPerBar / 2, label: 'Half bar' });
    [1, 2, 3, 4].forEach(bars => barOptions.push({ value: beatsPerBar * bars, label: bars + ' bar' + (bars > 1 ? 's' : '') }));
    barOptions.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === (entry.beats || beatsPerBar)) opt.selected = true;
      beatsSelect.appendChild(opt);
    });
    beatsSelect.addEventListener('click', (e) => e.stopPropagation());
    beatsSelect.addEventListener('change', () => {
      const updated = progression.map((e, i) => i === idx ? { ...e, beats: parseInt(beatsSelect.value, 10) } : e);
      setProgression(updated, { skipRender: true });
      renderTimeline(); // only the timeline needs to reflect the new duration, no need to rebuild every chip
    });
    chip.appendChild(beatsSelect);

    const chipPatternSelect = document.createElement('select');
    chipPatternSelect.className = 'progression-chip-pattern-select';
    chipPatternSelect.title = 'Strum pattern for this chord (hold Shift while changing: apply to every chord)';
    STRUM_PATTERNS.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if ((entry.strumPattern || 'block') === opt.value) o.selected = true;
      chipPatternSelect.appendChild(o);
    });
    chipPatternSelect.addEventListener('click', (e) => e.stopPropagation());
    chipPatternSelect.addEventListener('change', () => {
      if (window.__shiftHeld) { applyToAllLikeChips('chord', 'strumPattern', chipPatternSelect.value); return; }
      const updated = progression.map((en, i) => i === idx ? { ...en, strumPattern: chipPatternSelect.value } : en);
      setProgression(updated, { skipRender: true });
    });
    chip.appendChild(chipPatternSelect);

    const duplicateEl = document.createElement('button');
    duplicateEl.type = 'button';
    duplicateEl.className = 'progression-chip-duplicate';
    duplicateEl.textContent = '\u29C9'; // two-squares "copy" glyph
    duplicateEl.setAttribute('aria-label', 'Duplicate ' + entry.chordName);
    duplicateEl.title = 'Duplicate this chord';
    duplicateEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const copy = { ...progression[idx] };
      pendingChipFocusIndex = idx + 1; // show the new chip, don't leave the user wondering where it went
      setProgression([...progression.slice(0, idx + 1), copy, ...progression.slice(idx + 1)]);
    });
    chip.appendChild(duplicateEl);

    const sectionTagEl = document.createElement('button');
    sectionTagEl.type = 'button';
    sectionTagEl.className = 'progression-chip-section-tag';
    sectionTagEl.textContent = '\u{1F3F7}\uFE0F';
    sectionTagEl.title = entry.section ? ('Section: ' + entry.section + ' -- click to change') : 'No section -- click to assign one';
    sectionTagEl.setAttribute('aria-label', 'Change section for ' + entry.chordName);
    sectionTagEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const newSection = window.prompt('Section for this chord (leave blank for none):', entry.section || '');
      if (newSection === null) return; // cancelled
      const trimmed = newSection.trim();
      const updated = progression.map((en, i) => i === idx ? { ...en, section: trimmed || null } : en);
      setProgression(updated);
    });
    chip.appendChild(sectionTagEl);

    const muteEl = document.createElement('button');
    muteEl.type = 'button';
    muteEl.className = 'progression-chip-mute' + (entry.muted ? ' active' : '');
    muteEl.textContent = 'M';
    muteEl.title = 'Mute this chord (Shift+click: mute/unmute every chord)';
    muteEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const newValue = !entry.muted;
      if (e.shiftKey) { applyToAllLikeChips('chord', 'muted', newValue); return; }
      const updated = progression.map((en, i) => i === idx ? { ...en, muted: newValue } : en);
      setProgression(updated);
    });
    chip.appendChild(muteEl);

    const soloEl = document.createElement('button');
    soloEl.type = 'button';
    soloEl.className = 'progression-chip-solo' + (entry.solo ? ' active' : '');
    soloEl.textContent = 'S';
    soloEl.title = 'Solo this chord (Shift+click: solo/unsolo every chord)';
    soloEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const newValue = !entry.solo;
      if (e.shiftKey) { applyToAllLikeChips('chord', 'solo', newValue); return; }
      const updated = progression.map((en, i) => i === idx ? { ...en, solo: newValue } : en);
      setProgression(updated);
    });
    chip.appendChild(soloEl);

    const tremoloEl = document.createElement('button');
    tremoloEl.type = 'button';
    tremoloEl.className = 'progression-chip-tremolo' + (entry.tremolo ? ' active' : '');
    tremoloEl.textContent = 'Trem';
    tremoloEl.title = 'Tremolo effect on this chord (Shift+click: apply to every chord)';
    tremoloEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const newValue = !entry.tremolo;
      if (e.shiftKey) { applyToAllLikeChips('chord', 'tremolo', newValue); return; }
      const updated = progression.map((en, i) => i === idx ? { ...en, tremolo: newValue } : en);
      setProgression(updated);
    });
    chip.appendChild(tremoloEl);

    const envelopeFilterEl = document.createElement('button');
    envelopeFilterEl.type = 'button';
    envelopeFilterEl.className = 'progression-chip-envfilter' + (entry.envelopeFilter ? ' active' : '');
    envelopeFilterEl.textContent = 'Env';
    envelopeFilterEl.title = 'Envelope filter (auto-wah) effect on this chord (Shift+click: apply to every chord)';
    envelopeFilterEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const newValue = !entry.envelopeFilter;
      if (e.shiftKey) { applyToAllLikeChips('chord', 'envelopeFilter', newValue); return; }
      const updated = progression.map((en, i) => i === idx ? { ...en, envelopeFilter: newValue } : en);
      setProgression(updated);
    });
    chip.appendChild(envelopeFilterEl);

    const delaySelect = document.createElement('select');
    delaySelect.className = 'progression-chip-delay' + ((entry.delayPreset && entry.delayPreset !== 'off') ? ' active' : '');
    delaySelect.title = 'Delay effect on this chord, synced to the current tempo (hold Shift while changing: apply to every chord)';
    Object.keys(DELAY_PRESET_LABELS).forEach(key => {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = DELAY_PRESET_LABELS[key];
      if ((entry.delayPreset || 'off') === key) o.selected = true;
      delaySelect.appendChild(o);
    });
    delaySelect.addEventListener('click', (e) => e.stopPropagation());
    delaySelect.addEventListener('change', () => {
      if (window.__shiftHeld) { applyToAllLikeChips('chord', 'delayPreset', delaySelect.value); return; }
      const updated = progression.map((en, i) => i === idx ? { ...en, delayPreset: delaySelect.value } : en);
      setProgression(updated);
    });
    chip.appendChild(delaySelect);

    const volumeKnob = createVolumeKnob(entry.volume, (newVolume) => {
      const updated = progression.map((en, i) => i === idx ? { ...en, volume: newVolume } : en);
      setProgression(updated, { skipRender: true, skipHistory: true }); // avoid rebuilding the whole chip DOM mid-drag (which would kill the active drag), and avoid flooding undo with every intermediate drag-tick
    }, (finalVolume, shiftHeld) => {
      if (shiftHeld) applyToAllLikeChips('chord', 'volume', finalVolume);
    });
    chip.appendChild(volumeKnob);

    const removeEl = document.createElement('button');
    removeEl.type = 'button';
    removeEl.className = 'progression-chip-remove';
    removeEl.textContent = '×';
    removeEl.setAttribute('aria-label', 'Remove ' + entry.chordName + ' from progression');
    removeEl.addEventListener('click', (e) => {
      e.stopPropagation(); // don't also trigger the chip's play-on-click
      setProgression(progression.filter((_, i) => i !== idx));
    });
    chip.appendChild(removeEl);

    const chipStack = document.createElement('div');
    chipStack.className = 'chip-stack';
    chipStack.appendChild(chip);
    if (entry.leadSaved && entry.leadPattern && entry.leadPattern.length > 0) {
      const leadChip = document.createElement('div');
      leadChip.className = 'lead-chip';

      const leadPlayBtn = document.createElement('button');
      leadPlayBtn.type = 'button';
      leadPlayBtn.className = 'lead-chip-play';
      leadPlayBtn.textContent = '\u266a Lead (' + entry.leadPattern.length + ')';
      leadPlayBtn.title = 'Click to preview this lead pattern';
      leadPlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ctx = getChartToneCtx();
        const ordered = applyPatternToLeadNotes(entry.leadPattern, entry.leadPatternType || 'asPlayed');
        const stagger = (STRUM_PATTERN_CONFIG[entry.leadPatternType || 'asPlayed'] || STRUM_PATTERN_CONFIG.asPlayed).getStagger;
        ordered.forEach((note, noteIdx) => {
          playMelodyNoteTone(ctx, note, ctx.currentTime + stagger(noteIdx), 0.5);
        });
      });
      leadChip.appendChild(leadPlayBtn);

      const leadPatternSelect = document.createElement('select');
      leadPatternSelect.className = 'lead-chip-pattern-select';
      leadPatternSelect.title = 'Playback pattern for this lead';
      STRUM_PATTERNS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if ((entry.leadPatternType || 'asPlayed') === opt.value) o.selected = true;
        leadPatternSelect.appendChild(o);
      });
      leadPatternSelect.addEventListener('click', (e) => e.stopPropagation());
      leadPatternSelect.addEventListener('change', () => {
        const updated = progression.map((en, i) => i === idx ? { ...en, leadPatternType: leadPatternSelect.value } : en);
        setProgression(updated, { skipRender: true });
      });
      leadChip.appendChild(leadPatternSelect);

      const leadMuteBtn = document.createElement('button');
      leadMuteBtn.type = 'button';
      leadMuteBtn.className = 'lead-chip-mute' + (entry.leadPatternMuted ? ' active' : '');
      leadMuteBtn.textContent = 'M';
      leadMuteBtn.title = 'Mute this lead';
      leadMuteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const updated = progression.map((en, i) => i === idx ? { ...en, leadPatternMuted: !en.leadPatternMuted } : en);
        setProgression(updated);
      });
      leadChip.appendChild(leadMuteBtn);

      const leadSoloBtn = document.createElement('button');
      leadSoloBtn.type = 'button';
      leadSoloBtn.className = 'lead-chip-solo' + (entry.leadPatternSolo ? ' active' : '');
      leadSoloBtn.textContent = 'S';
      leadSoloBtn.title = 'Solo this lead';
      leadSoloBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const updated = progression.map((en, i) => i === idx ? { ...en, leadPatternSolo: !en.leadPatternSolo } : en);
        setProgression(updated);
      });
      leadChip.appendChild(leadSoloBtn);

      const leadVolumeKnob = createVolumeKnob(entry.leadPatternVolume, (newVolume) => {
        const updated = progression.map((en, i) => i === idx ? { ...en, leadPatternVolume: newVolume } : en);
        setProgression(updated, { skipRender: true, skipHistory: true });
      });
      leadChip.appendChild(leadVolumeKnob);

      chipStack.appendChild(leadChip);
    }
    getEntryLeadGrids(entry).forEach((leadLayer, layerIdx) => {
      const gridLeadChip = document.createElement('div');
      gridLeadChip.className = 'grid-lead-chip';

      const gridLeadSelectBox = document.createElement('input');
      gridLeadSelectBox.type = 'checkbox';
      gridLeadSelectBox.className = 'grid-lead-chip-select';
      gridLeadSelectBox.title = 'Select this lead to duplicate or copy it to another chord';
      gridLeadSelectBox.checked = !!(selectedLeadForCopy && selectedLeadForCopy.type === 'lead' && selectedLeadForCopy.entryIdx === idx && selectedLeadForCopy.layerId === leadLayer.id);
      gridLeadSelectBox.addEventListener('click', (e) => e.stopPropagation());
      gridLeadSelectBox.addEventListener('change', () => {
        selectedLeadForCopy = gridLeadSelectBox.checked ? { type: 'lead', entryIdx: idx, layerId: leadLayer.id, chordName: entry.chordName } : null;
        updateLeadCopyToolbar();
        renderProgression(); // refresh so only this box stays checked (selection is exclusive, one chip at a time)
      });
      gridLeadChip.appendChild(gridLeadSelectBox);

      const gridLeadOpenBtn = document.createElement('button');
      gridLeadOpenBtn.type = 'button';
      gridLeadOpenBtn.className = 'grid-lead-chip-open';
      const gridNoteCount = leadLayer.slots.filter(Boolean).length;
      const stackLabel = getEntryLeadGrids(entry).length > 1 ? ' #' + (layerIdx + 1) : '';
      const gridLeadKindLabel = leadLayer.isBass ? 'Bass' : 'Lead';
      gridLeadOpenBtn.textContent = '\u270e Edit ' + gridLeadKindLabel + stackLabel + ' (' + gridNoteCount + ')';
      gridLeadOpenBtn.title = 'Open and edit this ' + gridLeadKindLabel.toLowerCase() + ' in the Lead tab';
      gridLeadOpenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadLeadGridFromEntry(idx, leadLayer.id);
        showLeadMode();
      });
      gridLeadChip.appendChild(gridLeadOpenBtn);

      // Clicking anywhere on the chip that isn't a button/select/checkbox
      // (all of which already stop propagation) selects it, same as
      // clicking the checkbox directly -- the checkbox stays as the
      // precise, properly-labeled control; this is a mouse convenience
      // matching how the main chord chip's own background is clickable.
      gridLeadChip.style.cursor = 'pointer';
      gridLeadChip.addEventListener('click', () => {
        gridLeadSelectBox.checked = !gridLeadSelectBox.checked;
        gridLeadSelectBox.dispatchEvent(new Event('change'));
      });

      const gridLeadToneSelect = document.createElement('select');
      gridLeadToneSelect.className = 'grid-lead-chip-tone-select';
      gridLeadToneSelect.title = 'This lead\u2019s own instrument, independent from the chord\u2019s and any other stacked leads';
      Array.from(document.getElementById('toneTypeSelect').options).forEach(opt => {
        const clone = document.createElement('option');
        clone.value = opt.value;
        clone.textContent = opt.textContent;
        if ((leadLayer.toneType || 'piano') === opt.value) clone.selected = true;
        gridLeadToneSelect.appendChild(clone);
      });
      gridLeadToneSelect.addEventListener('click', (e) => e.stopPropagation());
      gridLeadToneSelect.title = (gridLeadToneSelect.title || '') + ' (hold Shift while changing: apply to every lead)';
      gridLeadToneSelect.addEventListener('change', () => {
        window.__toneEngine.ensureInstrumentPreloaded(getChartToneCtx(), gridLeadToneSelect.value);
        if (window.__shiftHeld) { applyToAllLikeChips('lead', 'toneType', gridLeadToneSelect.value); return; }
        const updated = progression.map((en, i) => {
          if (i !== idx) return en;
          const newGrids = getEntryLeadGrids(en).map(g => g.id === leadLayer.id ? { ...g, toneType: gridLeadToneSelect.value } : g);
          return { ...en, leadGrids: newGrids, leadGrid: undefined };
        });
        setProgression(updated, { skipRender: true });
      });
      gridLeadChip.appendChild(gridLeadToneSelect);

      const gridLeadMuteBtn = document.createElement('button');
      gridLeadMuteBtn.type = 'button';
      gridLeadMuteBtn.className = 'grid-lead-chip-mute' + (leadLayer.muted ? ' active' : '');
      gridLeadMuteBtn.textContent = 'M';
      gridLeadMuteBtn.title = 'Mute this lead (Shift+click: mute/unmute every lead)';
      gridLeadMuteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newValue = !leadLayer.muted;
        if (e.shiftKey) { applyToAllLikeChips('lead', 'muted', newValue); return; }
        updateLeadLayerField(idx, leadLayer.id, 'muted', newValue);
      });
      gridLeadChip.appendChild(gridLeadMuteBtn);

      const gridLeadSoloBtn = document.createElement('button');
      gridLeadSoloBtn.type = 'button';
      gridLeadSoloBtn.className = 'grid-lead-chip-solo' + (leadLayer.solo ? ' active' : '');
      gridLeadSoloBtn.textContent = 'S';
      gridLeadSoloBtn.title = 'Solo this lead (Shift+click: solo/unsolo every lead)';
      gridLeadSoloBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newValue = !leadLayer.solo;
        if (e.shiftKey) { applyToAllLikeChips('lead', 'solo', newValue); return; }
        updateLeadLayerField(idx, leadLayer.id, 'solo', newValue);
      });
      gridLeadChip.appendChild(gridLeadSoloBtn);

      const gridLeadTremoloBtn = document.createElement('button');
      gridLeadTremoloBtn.type = 'button';
      gridLeadTremoloBtn.className = 'grid-lead-chip-tremolo' + (leadLayer.tremolo ? ' active' : '');
      gridLeadTremoloBtn.textContent = 'Trem';
      gridLeadTremoloBtn.title = 'Tremolo effect on this lead (Shift+click: apply to every lead)';
      gridLeadTremoloBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newValue = !leadLayer.tremolo;
        if (e.shiftKey) { applyToAllLikeChips('lead', 'tremolo', newValue); return; }
        updateLeadLayerField(idx, leadLayer.id, 'tremolo', newValue);
      });
      gridLeadChip.appendChild(gridLeadTremoloBtn);

      const gridLeadEnvFilterBtn = document.createElement('button');
      gridLeadEnvFilterBtn.type = 'button';
      gridLeadEnvFilterBtn.className = 'grid-lead-chip-envfilter' + (leadLayer.envelopeFilter ? ' active' : '');
      gridLeadEnvFilterBtn.textContent = 'Env';
      gridLeadEnvFilterBtn.title = 'Envelope filter (auto-wah) effect on this lead (Shift+click: apply to every lead)';
      gridLeadEnvFilterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newValue = !leadLayer.envelopeFilter;
        if (e.shiftKey) { applyToAllLikeChips('lead', 'envelopeFilter', newValue); return; }
        updateLeadLayerField(idx, leadLayer.id, 'envelopeFilter', newValue);
      });
      gridLeadChip.appendChild(gridLeadEnvFilterBtn);

      const gridLeadDelaySelect = document.createElement('select');
      gridLeadDelaySelect.className = 'grid-lead-chip-delay' + ((leadLayer.delayPreset && leadLayer.delayPreset !== 'off') ? ' active' : '');
      gridLeadDelaySelect.title = 'Delay effect on this lead, synced to the current tempo (hold Shift while changing: apply to every lead)';
      Object.keys(DELAY_PRESET_LABELS).forEach(key => {
        const o = document.createElement('option');
        o.value = key;
        o.textContent = DELAY_PRESET_LABELS[key];
        if ((leadLayer.delayPreset || 'off') === key) o.selected = true;
        gridLeadDelaySelect.appendChild(o);
      });
      gridLeadDelaySelect.addEventListener('click', (e) => e.stopPropagation());
      gridLeadDelaySelect.addEventListener('change', () => {
        if (window.__shiftHeld) { applyToAllLikeChips('lead', 'delayPreset', gridLeadDelaySelect.value); return; }
        updateLeadLayerField(idx, leadLayer.id, 'delayPreset', gridLeadDelaySelect.value);
      });
      gridLeadChip.appendChild(gridLeadDelaySelect);

      const gridLeadVolumeKnob = createVolumeKnob(leadLayer.volume, (newVolume) => {
        const updated = progression.map((en, i) => {
          if (i !== idx) return en;
          const newGrids = getEntryLeadGrids(en).map(g => g.id === leadLayer.id ? { ...g, volume: newVolume } : g);
          return { ...en, leadGrids: newGrids, leadGrid: undefined };
        });
        setProgression(updated, { skipRender: true, skipHistory: true });
      }, (finalVolume, shiftHeld) => {
        if (shiftHeld) applyToAllLikeChips('lead', 'volume', finalVolume);
      });
      gridLeadChip.appendChild(gridLeadVolumeKnob);

      const gridLeadRemoveBtn = document.createElement('button');
      gridLeadRemoveBtn.type = 'button';
      gridLeadRemoveBtn.className = 'grid-lead-chip-remove';
      gridLeadRemoveBtn.textContent = '\u00d7';
      gridLeadRemoveBtn.title = 'Remove just this lead from the stack';
      gridLeadRemoveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const updated = progression.map((en, i) => {
          if (i !== idx) return en;
          const newGrids = getEntryLeadGrids(en).filter(g => g.id !== leadLayer.id);
          return { ...en, leadGrids: newGrids, leadGrid: undefined };
        });
        setProgression(updated);
      });
      gridLeadChip.appendChild(gridLeadRemoveBtn);

      chipStack.appendChild(gridLeadChip);
    });

    if (entry.drumPattern) {
      const drumChip = document.createElement('div');
      drumChip.className = 'drum-chip';

      const drumSelectBox = document.createElement('input');
      drumSelectBox.type = 'checkbox';
      drumSelectBox.className = 'drum-chip-select';
      drumSelectBox.title = 'Select this drum pattern to duplicate or copy it to another chord';
      drumSelectBox.checked = !!(selectedLeadForCopy && selectedLeadForCopy.type === 'drum' && selectedLeadForCopy.entryIdx === idx);
      drumSelectBox.addEventListener('click', (e) => e.stopPropagation());
      drumSelectBox.addEventListener('change', () => {
        selectedLeadForCopy = drumSelectBox.checked ? { type: 'drum', entryIdx: idx, chordName: entry.chordName, drumPatternId: entry.drumPattern.id } : null;
        updateLeadCopyToolbar();
        renderProgression();
      });
      drumChip.appendChild(drumSelectBox);

      const drumOpenBtn = document.createElement('button');
      drumOpenBtn.type = 'button';
      drumOpenBtn.className = 'drum-chip-open';
      const hitCount = entry.drumPattern.slots.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
      drumOpenBtn.textContent = '\u270e Edit Drums: ' + DRUM_KIT_LABELS[entry.drumPattern.kit] + ' (' + hitCount + ')';
      drumOpenBtn.title = 'Open and edit this pattern in the Drums tab';
      drumOpenBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadDrumPatternFromEntry(idx);
        showDrumsMode();
      });
      drumChip.appendChild(drumOpenBtn);

      // Same click-anywhere-to-select convenience as the grid-lead chip above.
      drumChip.style.cursor = 'pointer';
      drumChip.addEventListener('click', () => {
        drumSelectBox.checked = !drumSelectBox.checked;
        drumSelectBox.dispatchEvent(new Event('change'));
      });

      const drumMuteBtn = document.createElement('button');
      drumMuteBtn.type = 'button';
      drumMuteBtn.className = 'drum-chip-mute' + (entry.drumPattern.muted ? ' active' : '');
      drumMuteBtn.textContent = 'M';
      drumMuteBtn.title = 'Mute this drum pattern';
      drumMuteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const updated = progression.map((en, i) => i === idx ? { ...en, drumPattern: { ...en.drumPattern, muted: !en.drumPattern.muted } } : en);
        setProgression(updated);
      });
      drumChip.appendChild(drumMuteBtn);

      const drumSoloBtn = document.createElement('button');
      drumSoloBtn.type = 'button';
      drumSoloBtn.className = 'drum-chip-solo' + (entry.drumPattern.solo ? ' active' : '');
      drumSoloBtn.textContent = 'S';
      drumSoloBtn.title = 'Solo this drum pattern';
      drumSoloBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const updated = progression.map((en, i) => i === idx ? { ...en, drumPattern: { ...en.drumPattern, solo: !en.drumPattern.solo } } : en);
        setProgression(updated);
      });
      drumChip.appendChild(drumSoloBtn);

      const drumVolumeKnob = createVolumeKnob(entry.drumPattern.volume, (newVolume) => {
        const updated = progression.map((en, i) => i === idx ? { ...en, drumPattern: { ...en.drumPattern, volume: newVolume } } : en);
        setProgression(updated, { skipRender: true, skipHistory: true });
      });
      drumChip.appendChild(drumVolumeKnob);

      const drumRemoveBtn = document.createElement('button');
      drumRemoveBtn.type = 'button';
      drumRemoveBtn.className = 'drum-chip-remove';
      drumRemoveBtn.textContent = '\u00d7';
      drumRemoveBtn.title = 'Remove this drum pattern';
      drumRemoveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const updated = progression.map((en, i) => i === idx ? { ...en, drumPattern: undefined } : en);
        setProgression(updated);
      });
      drumChip.appendChild(drumRemoveBtn);

      chipStack.appendChild(drumChip);
    }

    ensureRowFor(entry.section, idx).appendChild(chipStack);
    renderedChipElements[idx] = chip;
  });
  renderTimeline();

  if (pendingChipFocusIndex !== null && renderedChipElements[pendingChipFocusIndex]) {
    renderedChipElements[pendingChipFocusIndex].focus();
    if (typeof renderedChipElements[pendingChipFocusIndex].scrollIntoView === 'function') {
      renderedChipElements[pendingChipFocusIndex].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  } else {
    progressionRow.scrollLeft = preservedScrollLeft;
    progressionRow.querySelectorAll(':scope > .progression-row').forEach(row => {
      const key = row.dataset.section || '__none__';
      if (key in preservedInnerScrollLeftBySection) row.scrollLeft = preservedInnerScrollLeftBySection[key];
    });
  }
  pendingChipFocusIndex = null;
}

function renderTimeline(){
  progressionTimeline.innerHTML = '';
  const BEAT_PX = 18;
  progression.forEach((entry) => {
    const block = document.createElement('div');
    block.className = 'timeline-block';
    block.style.width = ((entry.beats || 4) * BEAT_PX) + 'px';
    block.textContent = entry.chordName;
    progressionTimeline.appendChild(block);
  });
}


let activeSectionName = ''; // '' = no section assigned; whatever chords are added while this is set get tagged with it
function addToProgression(entry){
  setProgression([...progression, { ...entry, beats: beatsPerBar, strumPattern: entry.strumPattern || 'block', section: activeSectionName || null }]);
}

const surpriseMeBtn = document.getElementById('surpriseMeBtn');
surpriseMeBtn.addEventListener('click', () => {
  if (progression.length === 0) return;
  const updated = progression.map(entry => {
    const count = getVoicingCount(entry.rootIndex, entry.suffix);
    if (count <= 1) return entry; // nothing to randomize into
    let newVoicingIndex = Math.floor(Math.random() * count);
    if (newVoicingIndex === (entry.voicingIndex || 0)) {
      newVoicingIndex = (newVoicingIndex + 1) % count; // avoid landing back on the same voicing when possible
    }
    return { ...entry, voicingIndex: newVoicingIndex };
  });
  setProgression(updated);
});

progressionClearBtn.addEventListener('click', () => {
  setProgression([]);
});

undoProgressionBtn.addEventListener('click', () => {
  undoProgression();
});

redoProgressionBtn.addEventListener('click', () => {
  redoProgression();
});

// ---- saved progressions ("song list") UI ----
const savedProgressionsSelect = document.getElementById('savedProgressionsSelect');
const saveProgressionAsBtn = document.getElementById('saveProgressionAsBtn');
const loadSavedProgressionBtn = document.getElementById('loadSavedProgressionBtn');
const deleteSavedProgressionBtn = document.getElementById('deleteSavedProgressionBtn');

function populateSavedProgressionsSelect(selectId){
  const saved = loadSavedProgressions();
  savedProgressionsSelect.innerHTML = '<option value="">My Saved Progressions...</option>';
  saved.forEach(entry => {
    const opt = document.createElement('option');
    opt.value = entry.id;
    opt.textContent = entry.name + ' (' + entry.progression.length + ' chords)';
    if (selectId !== undefined && entry.id === selectId) opt.selected = true;
    savedProgressionsSelect.appendChild(opt);
  });
}
populateSavedProgressionsSelect();

saveProgressionAsBtn.addEventListener('click', () => {
  if (progression.length === 0) {
    window.alert('Your progression is empty -- add some chords first.');
    return;
  }
  const name = window.prompt('Name this progression:', '');
  if (!name) return; // cancelled, or left blank
  const saved = loadSavedProgressions();
  const newEntry = {
    id: Date.now(),
    name: name.trim(),
    progression: JSON.parse(JSON.stringify(progression)), // deep copy -- this saved snapshot must never share references with the live working progression
    savedAt: Date.now()
  };
  saved.push(newEntry);
  writeSavedProgressions(saved);
  populateSavedProgressionsSelect(newEntry.id);
});

loadSavedProgressionBtn.addEventListener('click', () => {
  const id = savedProgressionsSelect.value;
  if (!id) return;
  const saved = loadSavedProgressions();
  const entry = saved.find(e => String(e.id) === String(id));
  if (!entry) return;
  if (progression.length > 0) {
    const ok = window.confirm('Loading "' + entry.name + '" will replace your current progression. Continue?');
    if (!ok) return;
  }
  setProgression(JSON.parse(JSON.stringify(entry.progression))); // deep copy again -- editing the loaded working progression must never mutate the saved entry
});

deleteSavedProgressionBtn.addEventListener('click', () => {
  const id = savedProgressionsSelect.value;
  if (!id) return;
  const saved = loadSavedProgressions();
  const entry = saved.find(e => String(e.id) === String(id));
  if (!entry) return;
  const ok = window.confirm('Delete the saved progression "' + entry.name + '"? This cannot be undone.');
  if (!ok) return;
  writeSavedProgressions(saved.filter(e => String(e.id) !== String(id)));
  populateSavedProgressionsSelect();
});

const transposeDownBtn = document.getElementById('transposeDownBtn');
const transposeUpBtn = document.getElementById('transposeUpBtn');
function transposeProgression(semitones){
  if (progression.length === 0) return;
  const updated = progression.map(entry => {
    const newRootIndex = ((entry.rootIndex + semitones) % 12 + 12) % 12; // safe modulo, handles negative shifts
    return { ...entry, rootIndex: newRootIndex, chordName: NOTE_NAMES[newRootIndex] + entry.suffix };
  });
  setProgression(updated);

  // The Key dropdown represents "what key am I working in" -- after a
  // transpose that's genuinely different, so it needs to follow along
  // instead of silently showing the key you started in.
  const currentKeyIndex = parseInt(chartKeySelect.value, 10);
  const newKeyIndex = ((currentKeyIndex + semitones) % 12 + 12) % 12;
  chartKeySelect.value = newKeyIndex;
  renderChartGroups();
  applyActivePresetIfAny();
}
transposeDownBtn.addEventListener('click', () => transposeProgression(-1));
transposeUpBtn.addEventListener('click', () => transposeProgression(1));

// ---- song structure: sections ----
const sectionNameInput = document.getElementById('sectionNameInput');
const sectionNameOptions = document.getElementById('sectionNameOptions');
const duplicateSectionBtn = document.getElementById('duplicateSectionBtn');

sectionNameInput.addEventListener('input', () => {
  activeSectionName = sectionNameInput.value.trim();
  syncCardSelectionStates();
});

const loopSectionSelect = document.getElementById('loopSectionSelect');
const previewBassNotesToggle = document.getElementById('previewBassNotesToggle');
const topNoteToggle = document.getElementById('topNoteToggle');
const previewTopNoteToggle = document.getElementById('previewTopNoteToggle');
const octaveDoubleToggle = document.getElementById('octaveDoubleToggle');
const previewOctaveDoubleToggle = document.getElementById('previewOctaveDoubleToggle');
function populateLoopSectionSelect(names){
  const previousValue = loopSectionSelect.value;
  loopSectionSelect.innerHTML = '<option value="">All</option>';
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    loopSectionSelect.appendChild(opt);
  });
  // keep the current selection if that section still exists, otherwise fall back to "All"
  if (names.includes(previousValue)) loopSectionSelect.value = previousValue;
}

function populateSectionNameOptions(){
  const names = [...new Set(progression.map(e => e.section).filter(Boolean))];
  sectionNameOptions.innerHTML = '';
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    sectionNameOptions.appendChild(opt);
  });
  populateLoopSectionSelect(names);
}
populateSectionNameOptions();

duplicateSectionBtn.addEventListener('click', () => {
  if (!activeSectionName) {
    window.alert('Type an existing section name first (e.g. "Verse 1"), then Duplicate Section will create "Verse 2" as a copy of it.');
    return;
  }
  const matching = progression.filter(e => e.section === activeSectionName);
  if (matching.length === 0) {
    window.alert('No chords are tagged "' + activeSectionName + '" yet -- Duplicate Section copies an EXISTING section into a brand new one, so add some chords to "' + activeSectionName + '" first.');
    return;
  }
  const newName = nextSectionName(activeSectionName);
  const copies = matching.map(e => ({ ...e, section: newName }));
  setProgression([...progression, ...copies]);
  activeSectionName = newName;
  sectionNameInput.value = newName;
  syncCardSelectionStates();
});

const tagUntaggedBtn = document.getElementById('tagUntaggedBtn');
tagUntaggedBtn.addEventListener('click', () => {
  if (!activeSectionName) {
    window.alert('Type a section name first.');
    return;
  }
  const untaggedCount = progression.filter(e => !e.section).length;
  if (untaggedCount === 0) {
    window.alert('Every chord already has a section -- nothing untagged to tag.');
    return;
  }
  const updated = progression.map(e => e.section ? e : { ...e, section: activeSectionName });
  setProgression(updated);
});

// ---- section definitions UI ----
const sectionDefinitionSelect = document.getElementById('sectionDefinitionSelect');
const insertDefinitionBtn = document.getElementById('insertDefinitionBtn');
const saveDefinitionBtn = document.getElementById('saveDefinitionBtn');
const syncFromDefinitionBtn = document.getElementById('syncFromDefinitionBtn');

function populateSectionDefinitionSelect(selectId){
  const definitions = loadSectionDefinitions();
  sectionDefinitionSelect.innerHTML = definitions.length
    ? ''
    : '<option value="">None saved yet...</option>';
  definitions.forEach(def => {
    const opt = document.createElement('option');
    opt.value = def.id;
    opt.textContent = def.name + ' (' + def.chords.length + ' chords)';
    if (selectId !== undefined && String(def.id) === String(selectId)) opt.selected = true;
    sectionDefinitionSelect.appendChild(opt);
  });
}
populateSectionDefinitionSelect();

insertDefinitionBtn.addEventListener('click', () => {
  const id = sectionDefinitionSelect.value;
  if (!id) { window.alert('Pick a saved definition first.'); return; }
  insertSectionDefinition(id);
});

saveDefinitionBtn.addEventListener('click', () => {
  if (!activeSectionName) { window.alert('Type a section name first.'); return; }
  const ok = saveSectionDefinition(activeSectionName);
  if (!ok) {
    window.alert('No chords are tagged "' + activeSectionName + '" yet -- add some first.');
    return;
  }
  const definitions = loadSectionDefinitions();
  const savedDef = definitions.find(d => d.name === activeSectionName);
  populateSectionDefinitionSelect(savedDef ? savedDef.id : undefined);
});

syncFromDefinitionBtn.addEventListener('click', () => {
  if (!activeSectionName) { window.alert('Type a section name first.'); return; }
  const definitions = loadSectionDefinitions();
  const def = definitions.find(d => d.name === activeSectionName);
  if (!def) {
    window.alert('No saved definition named "' + activeSectionName + '" yet -- use Save As Definition first.');
    return;
  }
  const ok = window.confirm('Replace every "' + activeSectionName + '" section in your progression with the saved definition? This will overwrite any edits made to those instances.');
  if (!ok) return;
  syncFromDefinition(activeSectionName);
});

// ---- Canvas-rendered chord diagram, for the exported image (Canvas can't
// read CSS variables like the inline SVG diagrams do, so colors are literal
// hex values here, matching the app's amber/dark palette). ----
// Fits a line of text within maxWidth: first shrinks the font size down
// to minFontSize, then truncates with an ellipsis as a last resort if
// it still doesn't fit even at the smallest allowed size. Returns the
// font size actually used, so the caller can position text consistently
// (e.g. vertically centering based on the final size).
function fitTextToWidth(ctx, text, maxWidth, fontWeight, maxFontSize, minFontSize, fontFamily){
  let fontSize = maxFontSize;
  ctx.font = fontWeight + ' ' + fontSize + 'px ' + fontFamily;
  while (fontSize > minFontSize && ctx.measureText(text).width > maxWidth) {
    fontSize -= 1;
    ctx.font = fontWeight + ' ' + fontSize + 'px ' + fontFamily;
  }
  if (ctx.measureText(text).width > maxWidth) {
    let truncated = text;
    while (truncated.length > 1 && ctx.measureText(truncated + '\u2026').width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    text = truncated + '\u2026';
  }
  return { fontSize, text };
}

function drawChordDiagramOnCanvas(ctx, originX, originY, shape){
  const { frets, fingers, baseFret, barres } = shape;
  const numStrings = 6;
  const relFrets = frets; // f is already relative to baseFret -- same fix as the SVG renderer and the pitch calculation
  const maxRel = Math.max(4, ...relFrets.filter(f => f > 0));
  const numFretRows = maxRel;

  const width = 140, topPad = 26, leftPad = 14, rightPad = 14;
  const gridWidth = width - leftPad - rightPad;
  const rowHeight = 22;
  const gridHeight = numFretRows * rowHeight;
  const stringX = (i) => originX + leftPad + (gridWidth / (numStrings - 1)) * i;
  const fretY = (row) => originY + topPad + row * rowHeight;

  const INK = '#1a1a1a', INK_DIM = '#6b6b6b', OFF = '#8a1f1a';

  ctx.strokeStyle = INK_DIM;
  for (let i = 0; i < numStrings; i++) {
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(stringX(i), originY + topPad);
    ctx.lineTo(stringX(i), originY + topPad + gridHeight);
    ctx.stroke();
  }
  for (let row = 0; row <= numFretRows; row++) {
    ctx.strokeStyle = (row === 0 && baseFret === 1) ? INK : INK_DIM;
    ctx.lineWidth = (row === 0 && baseFret === 1) ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(originX + leftPad, fretY(row));
    ctx.lineTo(originX + leftPad + gridWidth, fretY(row));
    ctx.stroke();
  }
  if (baseFret > 1) {
    ctx.fillStyle = INK;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(baseFret + 'fr', originX + leftPad - 8, fretY(0) + rowHeight * 0.65);
  }
  (barres || []).forEach(barreFret => {
    const relBarre = barreFret; // same fix -- already relative, no baseFret subtraction needed
    const stringsAt = [];
    frets.forEach((f, i) => { if (f === barreFret) stringsAt.push(i); });
    if (stringsAt.length >= 2) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(stringX(Math.min(...stringsAt)), fretY(relBarre - 1) + rowHeight / 2);
      ctx.lineTo(stringX(Math.max(...stringsAt)), fretY(relBarre - 1) + rowHeight / 2);
      ctx.stroke();
    }
  });
  frets.forEach((f, i) => {
    const x = stringX(i);
    if (f === -1) {
      ctx.fillStyle = OFF;
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('x', x, originY + topPad - 8);
    } else if (f === 0) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, originY + topPad - 12, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const row = f; // same fix -- f is already the relative row
      const y = fretY(row - 1) + rowHeight / 2;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x, y, 7.5, 0, Math.PI * 2);
      ctx.fill();
      const fingerNum = fingers ? fingers[i] : 0;
      if (fingerNum > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(fingerNum), x, y + 3.5);
      }
    }
  });
  return originY + topPad + gridHeight; // bottom edge, for layout stacking
}

function generateProgressionCanvas(){
  const cols = 3;
  const cellW = 190, cellH = 210;
  const padding = 24, headerH = 90, footerH = 30;
  const rows = Math.ceil(progression.length / cols);
  const logicalW = padding * 2 + cols * cellW;
  const logicalH = padding * 2 + headerH + rows * cellH + footerH;

  const SCALE = 2; // retina-sharp export
  const canvas = document.createElement('canvas');
  canvas.width = logicalW * SCALE;
  canvas.height = logicalH * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  const INK = '#1a1a1a', INK_DIM = '#5a5a5a', INK_FAINT = '#9a9a9a', BORDER = '#c9c9c9';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, logicalW, logicalH);

  const keyName = chartKeySelect.options[chartKeySelect.selectedIndex].textContent;
  const modesUsed = [...new Set(progression.map(p => p.modeName))].join(', ');

  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('Frequency Target Replicator', padding, padding + 22);
  ctx.fillStyle = INK_DIM;
  const subtitleFit = fitTextToWidth(ctx, 'Key: ' + keyName + '   \u00b7   Modes: ' + modesUsed, logicalW - padding * 2, '', 13, 10, 'monospace');
  ctx.font = subtitleFit.fontSize + 'px monospace';
  ctx.fillText(subtitleFit.text, padding, padding + 44);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding + 58);
  ctx.lineTo(logicalW - padding, padding + 58);
  ctx.stroke();

  progression.forEach((entry, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cellX = padding + col * cellW;
    const cellY = padding + headerH + row * cellH;
    const boxLeft = cellX + 4, boxWidth = cellW - 16, boxHeight = cellH - 16;
    const textMaxWidth = boxWidth - 20; // matches the 12px left inset used below, plus a small right margin

    // A simple border instead of a filled background -- same footprint,
    // far less ink, still clearly delineates each chord's own cell.
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxLeft, cellY, boxWidth, boxHeight);

    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    const titleFit = fitTextToWidth(ctx, (i + 1) + '. ' + entry.chordName, textMaxWidth, 'bold', 26, 14, 'monospace');
    ctx.font = 'bold ' + titleFit.fontSize + 'px monospace';
    ctx.fillText(titleFit.text, cellX + 12, cellY + 30);

    ctx.fillStyle = INK_DIM;
    const subFit = fitTextToWidth(ctx, entry.label + ' \u00b7 ' + entry.modeName, textMaxWidth, '', 11, 8, 'monospace');
    ctx.font = subFit.fontSize + 'px monospace';
    ctx.fillText(subFit.text, cellX + 12, cellY + 48);

    const shape = lookupEntryShape(entry);
    if (shape) drawChordDiagramOnCanvas(ctx, cellX + 12, cellY + 58, shape);
  });

  ctx.fillStyle = INK_FAINT;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Generated with Frequency Target Replicator', logicalW / 2, logicalH - 12);

  return canvas;
}

progressionDownloadBtn.textContent = 'Save Image';
progressionDownloadBtn.addEventListener('click', () => {
  if (progression.length === 0) return;
  const canvas = generateProgressionCanvas();
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'progression.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
});

const progressionCopyBtn = document.getElementById('progressionCopyBtn');
progressionCopyBtn.addEventListener('click', async () => {
  if (progression.length === 0) return;
  const canvas = generateProgressionCanvas();
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      progressionCopyBtn.textContent = 'Copied!';
      setTimeout(() => { progressionCopyBtn.textContent = 'Copy'; }, 1200);
    } catch (err) {
      progressionCopyBtn.textContent = 'Use Save instead';
      setTimeout(() => { progressionCopyBtn.textContent = 'Copy'; }, 1600);
    }
  }, 'image/png');
});

// ---- playback: variable beats-per-chord, tempo, metronome, loop, and a
// real Stop that actually cancels everything in flight ----
const progressionPlayBtn = document.getElementById('progressionPlayBtn');
const progressionStopBtn = document.getElementById('progressionStopBtn');
const progressionTimeline = document.getElementById('progressionTimeline');
const tempoInput = document.getElementById('tempoInput');
tempoInput.addEventListener('input', () => {
  const leadTempoInputEl = document.getElementById('leadTempoInput');
  if (leadTempoInputEl) leadTempoInputEl.value = tempoInput.value;
  const drumTempoInputEl = document.getElementById('drumTempoInput');
  if (drumTempoInputEl) drumTempoInputEl.value = tempoInput.value;
});
const metronomeToggle = document.getElementById('metronomeToggle');
const loopToggle = document.getElementById('loopToggle');

let isPlaying = false;
let activeTimeoutIds = [];
let currentPlayIndex = -1;

// Converts a slot index from one grid resolution to another, preserving
// the note/hit's actual musical time position (beat = index /
// slotsPerBeat), not its raw array position. Doubling resolution (e.g.
// 4->8 slots per beat) is always exact -- every old slot lands on a real
// new slot with nothing in between. Halving resolution rounds to the
// nearest slot in the coarser grid, which can legitimately collapse two
// closely-spaced notes onto the same slot; callers that care should
// check for that collision themselves.
function remapSlotIndex(oldIndex, oldSlotsPerBeat, newSlotsPerBeat){
  const beatPosition = oldIndex / oldSlotsPerBeat;
  return Math.round(beatPosition * newSlotsPerBeat);
}

function beatMs(){
  const bpm = Math.max(40, Math.min(220, parseInt(tempoInput.value, 10) || 90));
  return 60000 / bpm;
}

// Delay presets, expressed as a fraction of one beat (one quarter note)
// rather than a fixed millisecond value -- so the echo always lands in
// time with the song regardless of tempo. Values match standard delay-
// pedal/DAW note-division convention.
const DELAY_PRESETS = {
  off: null,
  eighth: 0.5,             // 1/8 note = half a beat
  dottedEighth: 0.75,      // dotted 1/8 = an eighth note plus half again -- the classic U2/Edge-style delay setting
  quarter: 1.0,             // 1/4 note = one full beat
  quarterTriplet: 2 / 3,    // quarter-note triplet = 3 evenly-spaced notes across 2 beats
};
const DELAY_PRESET_LABELS = {
  off: 'Off',
  eighth: '1/8 Note',
  dottedEighth: 'Dotted 1/8',
  quarter: '1/4 Note',
  quarterTriplet: '1/4 Triplet',
};
// Converts a delay preset name to an actual delay time in seconds at the
// CURRENT live tempo -- never a value frozen from whenever the preset
// was chosen, matching the same "always follows the chord's own live
// tempo" discipline used throughout playback scheduling elsewhere.
function delayPresetToSeconds(presetName){
  const fraction = DELAY_PRESETS[presetName];
  if (!fraction) return null; // 'off', or an unrecognized/missing preset -- no delay
  return (beatMs() / 1000) * fraction;
}

function updateTimelineHighlight(){
  Array.from(progressionTimeline.children).forEach((block, i) => {
    block.classList.toggle('playing', i === currentPlayIndex);
  });
  renderedChipElements.forEach((chip, i) => {
    if (chip) chip.classList.toggle('now-playing', i === currentPlayIndex);
  });
}

const fretboardPanel = document.getElementById('fretboardPanel');
const fretboardPanelLabel = document.getElementById('fretboardPanelLabel');
const fretboardPanelDiagram = document.getElementById('fretboardPanelDiagram');
const fretboardToggleBtn = document.getElementById('fretboardToggleBtn');
const melodyRecordToggle = document.getElementById('melodyRecordToggle');
const saveLeadBtn = document.getElementById('saveLeadBtn');
saveLeadBtn.addEventListener('click', () => {
  if (fretboardActiveEntryIndex === null) {
    window.alert('Preview or play a chord first so there\u2019s a lead pattern to save.');
    return;
  }
  const entry = progression[fretboardActiveEntryIndex];
  if (!entry || !entry.leadPattern || entry.leadPattern.length === 0) {
    window.alert('No notes recorded yet for this chord -- turn on Record and click some notes first.');
    return;
  }
  const updated = progression.map((en, i) => i === fretboardActiveEntryIndex ? { ...en, leadSaved: true } : en);
  setProgression(updated);
});
const clearLeadBtn = document.getElementById('clearLeadBtn');
clearLeadBtn.addEventListener('click', () => {
  if (fretboardActiveEntryIndex === null) return;
  const entry = progression[fretboardActiveEntryIndex];
  if (!entry) return;
  const updated = progression.map((en, i) => i === fretboardActiveEntryIndex ? { ...en, leadPattern: [], leadSaved: false } : en);
  setProgression(updated);
  const shape = lookupEntryShape(entry);
  if (shape) updateFretboardPanel(shape, entry.chordName, entry.rootIndex, fretboardActiveEntryIndex);
  if (shape) updateChartPianoPanel(shape, entry.chordName, entry.rootIndex);
});
fretboardToggleBtn.addEventListener('click', () => {
  const show = fretboardPanel.style.display === 'none';
  fretboardPanel.style.display = show ? 'block' : 'none';
  fretboardToggleBtn.classList.toggle('active', show);
});

// Tracks which progression entry the fretboard panel is currently showing
// -- set every time the panel updates (via playback or chip preview), so
// a click on the fretboard while Record is on knows which chord slot to
// attach the note to. Lead notes live directly on the progression entry
// itself (entry.leadPattern = up to 4 {stringIdx, fret} entries, in the
// order clicked -- also the arp playback order) -- same pattern as
// voicingIndex/strumPattern/octaveShift, so it naturally travels with its
// chord through reordering, undo, save/load,
// and duplication instead of needing a separate, parallel data structure
// that could drift out of sync.
let fretboardActiveEntryIndex = null;
function updateFretboardPanel(shape, chordName, rootIndex, entryIndex){
  fretboardActiveEntryIndex = entryIndex !== undefined ? entryIndex : null;
  if (fretboardPanel.style.display === 'none' || !shape) return; // no work when the panel isn't visible
  const pitchClasses = getChordTonePitchClasses(shape);
  const leadNotes = (fretboardActiveEntryIndex !== null && progression[fretboardActiveEntryIndex])
    ? (progression[fretboardActiveEntryIndex].leadPattern || [])
    : [];
  fretboardPanelLabel.textContent = (melodyRecordToggle.checked ? '\u25cf Recording: ' : 'Safe notes for: ') + chordName;
  fretboardPanelDiagram.innerHTML = renderChordToneMapSVG(pitchClasses, rootIndex, leadNotes);
}

fretboardPanelDiagram.addEventListener('click', (e) => {
  const dot = e.target.closest('.fretboard-tone-dot');
  if (!dot) return;
  const stringIdx = parseInt(dot.getAttribute('data-string'), 10);
  const fret = parseInt(dot.getAttribute('data-fret'), 10);

  // Always audition the clicked note -- no more blind clicking, whether
  // Record is on or not.
  const ctx = getChartToneCtx();
  playMelodyNoteTone(ctx, { stringIdx, fret }, ctx.currentTime, 0.6);

  if (!melodyRecordToggle.checked || fretboardActiveEntryIndex === null) return; // recording is still opt-in via the Record toggle
  const entry = progression[fretboardActiveEntryIndex];
  if (!entry) return;
  const currentPattern = entry.leadPattern || [];
  const existingIdx = currentPattern.findIndex(n => n.stringIdx === stringIdx && n.fret === fret);
  let newPattern;
  if (existingIdx !== -1) {
    // clicking a note that's already in the pattern removes it -- a natural toggle
    newPattern = currentPattern.filter((_, i) => i !== existingIdx);
  } else if (currentPattern.length >= 6) {
    window.alert('A lead pattern can hold up to 6 notes -- click one of the numbered notes to remove it first.');
    return;
  } else {
    newPattern = [...currentPattern, { stringIdx, fret }]; // appended in click order, which is the arp playback order
  }
  const updated = progression.map((en, i) => i === fretboardActiveEntryIndex ? { ...en, leadPattern: newPattern } : en);
  setProgression(updated, { skipRender: true }); // don't rebuild the whole tray for this -- just re-render the fretboard panel itself
  const shape = lookupEntryShape(entry);
  if (shape) updateFretboardPanel(shape, entry.chordName, entry.rootIndex, fretboardActiveEntryIndex);
  if (shape) updateChartPianoPanel(shape, entry.chordName, entry.rootIndex);
});
