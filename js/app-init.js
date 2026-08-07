// ---- Simple Mode -- a display filter, not a data restriction. Hides a
// curated set of advanced options (exotic modes, deep chord alterations,
// a few theory-heavy tools) to reduce decision paralysis for someone new
// to music, without ever touching what's actually stored. Anything
// already in use when the toggle is turned on stays visible and
// functional -- see the per-feature comments where this is applied for
// how each one honors that.
const SIMPLE_MODE_KEY = 'ftr-simple-mode-v1';
let simpleMode = false;
try { simpleMode = localStorage.getItem(SIMPLE_MODE_KEY) === '1'; } catch (e) { /* ignore -- defaults to off */ }
document.body.classList.toggle('simple-mode', simpleMode);
const simpleModeToggle = document.getElementById('simpleModeToggle');
simpleModeToggle.checked = simpleMode;
simpleModeToggle.addEventListener('change', () => {
  simpleMode = simpleModeToggle.checked;
  document.body.classList.toggle('simple-mode', simpleMode);
  try { localStorage.setItem(SIMPLE_MODE_KEY, simpleMode ? '1' : '0'); } catch (e) { /* ignore -- setting just won't persist across reloads */ }
  renderModePicker();
  renderChartGroups();
  renderProgression();
});

renderModePicker();
renderProgression();
// Chart mode is the desktop-first section of this app (browsing/building
// progressions genuinely benefits from a bigger screen and a keyboard);
// Tune and Chord ID are the phone-first, mid-practice tools. Default to
// whichever fits the device, using the same 760px breakpoint the CSS
// already uses everywhere else.
if (window.matchMedia('(min-width: 760px)').matches) {
  showChartMode();
} else {
  updatePickerVisibility(tuneModeEl); // Tune is the default active mode on mobile
}

// ============================================================
// Keyboard shortcuts -- desktop only, doesn't affect phone/touch use at all.
// Global tab-switching uses Alt+1/2/3 rather than bare 1/2/3, specifically
// to avoid colliding with Chart mode's bare 1-7 mode-pill shortcuts.
// ============================================================
const SHORTCUTS = [
  { section: 'Global', items: [
    { keys: '?', desc: 'Toggle this help' },
    { keys: 'Cmd/Ctrl+Z', desc: 'Undo last progression change' },
    { keys: 'Cmd/Ctrl+Shift+Z or Ctrl+Y', desc: 'Redo' },
    { keys: 'Cmd/Ctrl+S', desc: 'Save (Chart: name and save progression; Lead: save to a chord)' },
    { keys: 'Space', desc: 'Stop all audio immediately, from any tab' },
  ]},
  { section: 'Tune', items: [
    { keys: 'Space', desc: 'Start / stop tuning' },
    { keys: '1\u20136', desc: 'Play reference tone (low E \u2192 high E)' },
    { keys: 'T', desc: 'Cycle tone type' },
  ]},
  { section: 'Chord ID', items: [
    { keys: 'Space or C', desc: 'Capture chord' },
  ]},
  { section: 'Chart', items: [
    { keys: '\u2190 / \u2192', desc: 'Change key' },
    { keys: '1\u20139', desc: 'Toggle mode pill (Ionian\u2026Melodic Minor)' },
    { keys: 'P', desc: 'Play progression' },
    { keys: 'S or Esc', desc: 'Stop playback' },
    { keys: 'L', desc: 'Toggle loop' },
    { keys: 'M', desc: 'Toggle metronome' },
    { keys: '+ / -', desc: 'Tempo \u00b15 bpm' },
  ]},
  { section: 'Chart \u2014 chord card focused', items: [
    { keys: 'Enter / Space', desc: 'Play this chord' },
    { keys: 'Shift+Enter', desc: 'Add to progression' },
    { keys: 'A', desc: 'Cycle to the next strum pattern for this chord' },
    { keys: '\u2191 / \u2193', desc: 'Cycle its mod dropdown' },
  ]},
  { section: 'Chart \u2014 progression chip focused', items: [
    { keys: 'Enter / Space', desc: 'Preview this chord' },
    { keys: 'Delete / Backspace', desc: 'Remove from progression' },
  ]},
];

const shortcutsOverlay = document.getElementById('shortcutsOverlay');
const shortcutsBody = document.getElementById('shortcutsBody');
const shortcutsCloseBtn = document.getElementById('shortcutsCloseBtn');

function renderShortcutsHelp(){
  shortcutsBody.innerHTML = '';
  SHORTCUTS.forEach(group => {
    const title = document.createElement('div');
    title.className = 'shortcuts-section-title';
    title.textContent = group.section;
    shortcutsBody.appendChild(title);
    group.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'shortcuts-row';
      const keys = document.createElement('span');
      keys.className = 'shortcuts-keys';
      keys.textContent = item.keys;
      const desc = document.createElement('span');
      desc.className = 'shortcuts-desc';
      desc.textContent = item.desc;
      row.appendChild(keys);
      row.appendChild(desc);
      shortcutsBody.appendChild(row);
    });
  });
}
renderShortcutsHelp();

function toggleShortcutsOverlay(forceState){
  const show = forceState !== undefined ? forceState : shortcutsOverlay.style.display === 'none';
  shortcutsOverlay.style.display = show ? 'flex' : 'none';
}
shortcutsCloseBtn.addEventListener('click', () => toggleShortcutsOverlay(false));
shortcutsOverlay.addEventListener('click', (e) => {
  if (e.target === shortcutsOverlay) toggleShortcutsOverlay(false); // click on backdrop, not the panel itself
});

const scaleDiagramOverlay = document.getElementById('scaleDiagramOverlay');
const scaleDiagramTitle = document.getElementById('scaleDiagramTitle');
const scaleDiagramBody = document.getElementById('scaleDiagramBody');
const scaleDiagramCloseBtn = document.getElementById('scaleDiagramCloseBtn');
function showScaleDiagram(tonicIndex, modeName){
  const modeData = MODES_TABLE[modeName];
  scaleDiagramTitle.textContent = NOTE_NAMES[tonicIndex] + ' ' + modeName + ' Scale';
  const pitchClasses = new Set(modeData.intervals.map(iv => (tonicIndex + iv) % 12));
  scaleDiagramBody.innerHTML = '<div class="scale-diagram-wrap">' + renderScaleBoxSVG(tonicIndex, modeData) + '</div>'
    + '<div class="scale-diagram-keyboard">' + renderPianoKeyboardSVG(pitchClasses, tonicIndex) + '</div>';
  scaleDiagramOverlay.style.display = 'flex';
}
function closeScaleDiagram(){
  scaleDiagramOverlay.style.display = 'none';
}
scaleDiagramCloseBtn.addEventListener('click', closeScaleDiagram);
scaleDiagramOverlay.addEventListener('click', (e) => {
  if (e.target === scaleDiagramOverlay) closeScaleDiagram();
});

// Pivot-key modulation finder -- for each of the other 11 possible tonics
// at the SAME mode type as the current key, counts how many diatonic
// chords are shared. More shared chords means a smoother modulation --
// verified against real music theory before this was built (C major and
// G major share exactly 4 diatonic chords -- C, G, Am, Em -- the actual,
// textbook pivot chords for that modulation, not the 6 I originally and
// incorrectly assumed; sharing scale NOTES and sharing diatonic CHORDS
// are different things).
function findModulationTargets(currentTonicIndex, modeName){
  const modeData = MODES_TABLE[modeName];
  const currentSet = new Set(modeData.intervals.map((iv, i) =>
    ((currentTonicIndex + iv) % 12) + ':' + QUALITY_TO_SUFFIX[modeData.qualities[i]]));
  const results = [];
  for (let newTonic = 0; newTonic < 12; newTonic++) {
    if (newTonic === currentTonicIndex) continue;
    const targetChords = modeData.intervals.map((iv, i) => ({
      key: ((newTonic + iv) % 12) + ':' + QUALITY_TO_SUFFIX[modeData.qualities[i]],
      name: NOTE_NAMES[(newTonic + iv) % 12] + QUALITY_TO_SUFFIX[modeData.qualities[i]]
    }));
    const shared = targetChords.filter(c => currentSet.has(c.key));
    results.push({ tonicIndex: newTonic, sharedChords: shared.map(c => c.name) });
  }
  results.sort((a, b) => b.sharedChords.length - a.sharedChords.length);
  return results;
}

const modulationOverlay = document.getElementById('modulationOverlay');
const modulationTitle = document.getElementById('modulationTitle');
const modulationBody = document.getElementById('modulationBody');
const modulationCloseBtn = document.getElementById('modulationCloseBtn');
const findModulationBtn = document.getElementById('findModulationBtn');

function showModulationFinder(){
  const tonicIndex = parseInt(chartKeySelect.value, 10);
  // uses the first active mode as the reference -- modulation targets are computed within the same mode type
  const modeName = activeModes[0] || 'Ionian';
  modulationTitle.textContent = 'Modulate from ' + NOTE_NAMES[tonicIndex] + ' ' + modeName;
  const results = findModulationTargets(tonicIndex, modeName);
  modulationBody.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'modulation-list';
  results.forEach(r => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'modulation-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'modulation-row-name';
    nameSpan.textContent = NOTE_NAMES[r.tonicIndex] + ' ' + modeName;
    const sharedSpan = document.createElement('span');
    sharedSpan.className = 'modulation-row-shared';
    sharedSpan.textContent = r.sharedChords.length + ' shared: ' + r.sharedChords.join(', ');
    row.appendChild(nameSpan);
    row.appendChild(sharedSpan);
    row.addEventListener('click', () => {
      chartKeySelect.value = r.tonicIndex;
      renderChartGroups();
      applyActivePresetIfAny();
      closeModulationFinder();
    });
    list.appendChild(row);
  });
  modulationBody.appendChild(list);
  modulationOverlay.style.display = 'flex';
}
function closeModulationFinder(){
  modulationOverlay.style.display = 'none';
}
findModulationBtn.addEventListener('click', showModulationFinder);
modulationCloseBtn.addEventListener('click', closeModulationFinder);
modulationOverlay.addEventListener('click', (e) => {
  if (e.target === modulationOverlay) closeModulationFinder();
});

window.__shiftHeld = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') window.__shiftHeld = true; });
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') window.__shiftHeld = false; });
window.addEventListener('blur', () => { window.__shiftHeld = false; });

document.addEventListener('keydown', (e) => {
  // help overlay: Escape always closes it first, regardless of anything else
  if (shortcutsOverlay.style.display !== 'none') {
    if (e.key === 'Escape') toggleShortcutsOverlay(false);
    return;
  }
  if (scaleDiagramOverlay.style.display !== 'none') {
    if (e.key === 'Escape') closeScaleDiagram();
    return;
  }
  if (modulationOverlay.style.display !== 'none') {
    if (e.key === 'Escape') closeModulationFinder();
    return;
  }
  if (e.key === '?') { toggleShortcutsOverlay(true); return; }

  // Everything below is mode-scoped and intentionally skipped while typing in
  // a form control, so it never hijacks normal text/number entry -- per-card
  // and per-chip keydown handlers (Enter/Space/arrows/etc.) are unaffected
  // since those are separate listeners on those specific elements.
  const activeTag = document.activeElement ? document.activeElement.tagName : '';
  if (activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA') return;

  // Undo/Redo -- Cmd (Mac) or Ctrl (Windows/Linux), checked via metaKey ||
  // ctrlKey together since this app runs on both. Covers both common redo
  // conventions (Cmd/Ctrl+Shift+Z and Ctrl+Y) so it works regardless of
  // platform habit. Placed after the input-guard above so it never
  // conflicts with a browser's native undo/redo while typing in a text
  // field -- only acts on the progression when focus isn't in a form
  // control.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undoProgression(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); redoProgression(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoProgression(); return; }

  // Cmd/Ctrl+S -- the working tray already auto-saves to localStorage on
  // every edit (see setProgression), so this triggers the one save
  // action that ISN'T already automatic: Chart's named "Save As" flow,
  // or Lead's save-to-a-chord flow. Must preventDefault, or the browser
  // tries to save the page itself.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (currentActiveMode === 'chart') saveProgressionAsBtn.click();
    else if (currentActiveMode === 'lead') leadSaveAsNewBtn.click();
    return;
  }

  // Space -- stop all audio, everywhere, regardless of what tab is active.
  // Deliberately does NOT return here: Tune mode's own Space handling
  // (toggle the tuner) still runs right after this, since hard-stopping
  // playback and toggling mic listening are independent and both make
  // sense to happen together on a single press.
  if (e.key === ' ') {
    e.preventDefault();
    window.__hardStopAllAudio(getChartToneCtx());
  }

  if (currentActiveMode === 'tune') {
    if (e.key === ' ') { e.preventDefault(); if (window.__tunerToggle) window.__tunerToggle(); return; }
    if (e.key >= '1' && e.key <= '6') { if (window.__playPegByIndex) window.__playPegByIndex(parseInt(e.key, 10) - 1); return; }
    if (e.key.toLowerCase() === 't') { if (window.__cycleToneType) window.__cycleToneType(); return; }
  }

  if (currentActiveMode === 'chord') {
    if (e.key === ' ' || e.key.toLowerCase() === 'c') { e.preventDefault(); chordCaptureBtn.click(); return; }
  }

  if (currentActiveMode === 'chart') {
    if (e.key === 'ArrowLeft') {
      chartKeySelect.selectedIndex = Math.max(0, chartKeySelect.selectedIndex - 1);
      renderChartGroups();
      applyActivePresetIfAny();
      return;
    }
    if (e.key === 'ArrowRight') {
      chartKeySelect.selectedIndex = Math.min(chartKeySelect.options.length - 1, chartKeySelect.selectedIndex + 1);
      renderChartGroups();
      applyActivePresetIfAny();
      return;
    }
    if (e.key >= '1' && e.key <= '9') {
      const modeName = MODE_NAMES[parseInt(e.key, 10) - 1];
      if (modeName) {
        const wasSelecting = !activeModes.includes(modeName);
        if (activeModes.includes(modeName)) {
          activeModes = activeModes.filter(m => m !== modeName);
        } else {
          activeModes = [...activeModes, modeName];
        }
        renderModePicker();
        renderChartGroups();
        applyActivePresetIfAny();
        if (wasSelecting) scrollModeIntoView(modeName);
      }
      return;
    }
    if (e.key.toLowerCase() === 'p') { playProgressionThrough(); return; }
    if (e.key.toLowerCase() === 's' || e.key === 'Escape') { stopPlayback(); return; }
    if (e.key.toLowerCase() === 'l') { loopToggle.checked = !loopToggle.checked; return; }
    if (e.key.toLowerCase() === 'm') { metronomeToggle.checked = !metronomeToggle.checked; return; }
    if (e.key === '+' || e.key === '=') {
      tempoInput.value = Math.min(220, (parseInt(tempoInput.value, 10) || 90) + 5);
      return;
    }
    if (e.key === '-') {
      tempoInput.value = Math.max(40, (parseInt(tempoInput.value, 10) || 90) - 5);
      return;
    }
  }
});
