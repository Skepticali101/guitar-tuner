# Known-safe findings from lint/type-check audits

This file exists so a future run of `verify.mjs` doesn't have to
re-litigate the same confirmed-safe patterns every time. If the error
count jumps well above what's listed here, that's worth investigating.
If it's roughly the same number in the same files, it's almost
certainly the same known pattern.

## Baseline as of the initial audit (index.html ~9,500 lines)
- ESLint: 0 errors, 12 warnings (all idiomatic empty-catch `(e)`/`(err)`
  parameters, plus one intentional destructure-to-omit pattern in
  `saveSectionDefinition`)
- tsc --checkJs: ~172 errors, all in the confirmed-safe categories below

## Confirmed-safe categories (investigated individually, not assumed)

**Generic `HTMLElement` typing (the majority of remaining errors, TS2339
"Property X does not exist on type HTMLElement")** -- `document.getElementById()`
returns a generic `HTMLElement`, not the specific `HTMLInputElement` /
`HTMLSelectElement` subtype that actually has `.value`, `.checked`,
`.disabled`, `.options`, `.selectedIndex`, etc. This is expected for an
untyped codebase that doesn't add per-call type assertions. Not
suppressed globally on purpose -- a real typo like `el.vlaue` would
also show up as TS2339, and globally silencing this category would
hide that too.

**`osc.type = toneType` assigned a plain `string`, not `OscillatorType`**
-- every occurrence is preceded by an `isInstrument(toneType)` guard
that routes instrument names (e.g. `'piano'`) to a separate
sample-based playback path first; `osc.type` is only ever reached once
`toneType` is confirmed to be a genuine oscillator waveform name.
TypeScript can't see this narrowing since `isInstrument()` isn't a
formal type predicate. Verified this guard exists at every flagged
call site, not assumed from one example.

**`option.value = <number>`, not assignable to `string`** -- the DOM
spec auto-stringifies any value assigned to `HTMLOptionElement.value`
at runtime. Harmless; TypeScript's declared type is just stricter than
what the browser actually requires.

**Updated baseline after the chord-card strum-pattern fix**: tsc
--checkJs now reports ~198 errors (up from ~172), all still in the
categories above plus two new, equally safe ones:
- `Property '__refreshAllCardPatternRows' does not exist on type
  'Window & typeof globalThis'` (3 occurrences) -- same generic
  `window.__customProperty` pattern as `window.__strumPattern`,
  `window.__toneType`, etc. throughout this codebase; none of these
  custom runtime properties have type declarations.
- `error TS2739` on `createChartCard`'s parameter object at a few call
  sites -- a type-inference side effect of adding nearby code in an
  untyped codebase, where TypeScript infers one parameter type from
  every call site combined. Confirmed harmless: the real jsdom
  execution test (which actually runs the page and would catch a
  genuine runtime mismatch) passes, along with the full regression
  suite.

**`Cannot find module './vendor/basic-pitch/index.js'`** -- false
positive from the extracted files living in `tooling/` rather than the
project root; the relative import path is correct in the real deployed
`index.html`.

## Genuine issues found and fixed during the initial audit
- `usingWorklet` (classic.js) -- set but never read anywhere; the real
  cleanup function already handled both code paths via independent
  null-checks, so the flag was dead. Removed.
- `leadMetronomeIntervalId` (module.mjs) -- declared, never assigned or
  read; leftover from before this app settled on chained `setTimeout`
  scheduling. Removed.
- `createChartCard()` -- called with different parameter subsets from
  three call sites (diatonic / secondary-dominant / borrowed-chord
  cards), which is intentional, but nothing documented that the
  differing fields were optional per call site. Added a JSDoc
  annotation describing the real contract.

## Genuine issue found and fixed during the file split (index.html -> js/*.js)
- `updateLeadCopyToolbar` (defined in `lead.js`) was being called from a
  top-level `renderProgression()` call sitting inside `drums.js`, which
  loads before `lead.js`. This worked invisibly in the original single
  file because of how function hoisting works within one script scope
  -- `function` declarations are hoisted across the entire containing
  script regardless of textual position, so it didn't matter that
  `updateLeadCopyToolbar` was defined "later" in the file. Splitting
  into separate `<script>` tags breaks that guarantee: hoisting only
  applies within each individual script now, not across script
  boundaries.
  Root cause: a chunk of genuinely global app-initialization code
  (mode-picker setup, keyboard shortcuts, scale/modulation popups) had
  been sitting at the tail end of the "Drums tab" section in the
  original file purely by physical position, not because it was
  drums-specific. Extracted it into its own `app-init.js`, which loads
  last -- after every other file has finished defining its functions.
  This is exactly the class of bug `jsdom-validate.mjs` exists to catch
  automatically: it actually executes `index.html` in a simulated DOM,
  so a cross-file ordering mistake throws a real, visible error instead
  of silently shipping.

## Major genuine correctness bugs found and fixed since (chronological)

- **Progression tray scroll snap-back (real fix, not the first attempt).**
  An earlier fix preserved the *outer* `#progressionRow` container's
  `scrollLeft`, but chips actually scroll inside a dynamically-created
  *inner* `.progression-row` div (one per section) that gets fully
  destroyed and rebuilt on every edit. Preserving the wrong element's
  scroll position meant Mute/Solo/mod-change kept visibly snapping the
  tray back to the start. Fixed by tagging each inner row with its
  section and restoring scroll position onto the correctly-matched new
  row after rebuild.

- **Chip Edit button swallowing the "click to select" hitbox.** The Edit
  button on lead/drum chips had `flex:1 1 auto`, meaning it expanded to
  fill all remaining row space -- so what looked like blank chip
  background (meant to select the chip on click) was actually still
  inside the button's own clickable area, silently navigating to the
  editor instead of selecting. Fixed by removing the flex-grow so the
  button only occupies its own text width.

- **Electric Bass / Double Bass silently producing no sound.** These are
  the only two bass instruments backed by real audio samples (the rest
  are synthesized). Moving bass sounds into Lead's own tone menu
  dropped the one piece of code that actually triggered loading the
  sample file -- selecting the instrument, or loading an existing layer
  that used it, never fetched the `.wav`. `playAcousticBassNote` fails
  completely silently when its buffer isn't loaded (`if(!buffer) return;`),
  so there was no error to notice, just no sound. Fixed by adding one
  shared `ensureInstrumentPreloaded()` helper used at every entry point
  that can select or restore an instrument, rather than three separate
  ad hoc checks that could each independently forget the bass case (which
  is exactly what happened).
  **Follow-up:** the first pass at this fix wasn't actually complete --
  two more entry points that can change an instrument were found later
  (reported as "still silent unless I open Lead and re-save"): the
  progression chip's own tone selector (`grid-lead-chip-tone-select`,
  which changes a layer's instrument without ever opening the Lead tab
  at all) and the `T` keyboard shortcut for cycling instruments. Both
  now call the same shared helper. Worth remembering for any *future*
  new way to select an instrument: search for every place `toneType` or
  `window.__toneType` gets assigned, not just the one path that was
  reported broken.

- **Drums tab's Save button never actually marking itself "saved."**
  `saveDrumPatternToEntry` and the Drums "Save to Bin" handler never
  called the unsaved-changes tracker's `markClean()`, so the Save
  button's dirty/clean highlight would stay red-flagged even
  immediately after a successful save. Lead's equivalent handlers did
  this correctly; Drums' didn't. Found by directly testing the described
  edit-then-undo-then-save flow end-to-end rather than trusting the
  tracker's design was correctly wired everywhere it needed to be.

- **Stale array-index corruption after removing/reordering a chord (the
  most serious one found).** Several trackers -- "which chord/layer am I
  currently editing" (`leadEditingEntryIndex`, `drumEditingEntryIndex`)
  and "which chip is selected for Dup/Copy" (`selectedLeadForCopy`) --
  referenced a chord by its raw position in the `progression` array.
  Removing an earlier chord shifts every later index down by one
  without updating any of these trackers, so the next Save/Dup/Copy
  action would silently write to whatever chord now happened to occupy
  that stale index -- a *different* chord than the one actually being
  edited -- while the chord that was really being edited never received
  its update at all. This is the root cause behind two separately
  reported symptoms that turned out to be the same bug: "removing a
  chip resets other chips' sound/type" and "Electric/Double Bass needs
  re-saving after any other chip changes." One case made this
  especially easy to get wrong silently: the drum-pattern staleness
  check only asked "does *some* drum pattern exist at this index,"
  not whether it was the *same* one -- so if two chords both had drum
  patterns, a removal could silently reattach the selection to the
  wrong chord's pattern with no visible sign anything was wrong.
  Fixed by giving every one of these trackers a companion stable id
  (drum patterns already had one; lead layers already had one; a
  `drumEditingPatternId` was added to match) and a single centralized
  `revalidateIndexBasedEditingState()` function, called from
  `setProgression` itself so it can never be skipped regardless of
  which options a caller passes, that re-locates each tracker to its
  actual current position -- or clears it to null if the thing it
  referred to no longer exists at all.

- **Lead tab grid forcing the whole page wider (took three separate fixes
  to actually resolve -- worth reading in full given how each partial fix
  looked complete on its own).** Reported as "screen is so wide I have to
  zoom to 70%," this took three real, separate CSS issues stacked on top
  of each other, only found because "fixed" was checked against actual
  browser layout each time rather than assumed from CSS looking correct:
  1. `#leadMode`/`#drumsMode` are flex children of `main` (`display:flex;
     flex-direction:column`), and flex children default to
     `min-width:auto` -- refusing to shrink below their own content's
     width, which forces the whole page wider instead of letting the
     grid's own `overflow-x:auto` do anything. Fixed with `min-width:0`
     on both.
  2. `main` is *itself* a flex child of `body` (also `display:flex`), so
     it had the exact same problem one level higher -- and since `body`
     has `overflow-x:hidden`, overflow reaching that level was being
     silently clipped rather than made scrollable, which looked like
     "content missing" rather than "page too wide." Fixed with the same
     `min-width:0` on `main`.
  3. The actual remaining cause, and the one that mattered most:
     `#leadMode` has `align-items:center` (not the default `stretch`).
     On a cross axis with `align-items:center`, a flex child sizes
     itself to its own *content's* natural width and gets centered,
     rather than stretching to fill the container -- so `.lead-grid-wrap`
     was growing to fit its full 64-slot content (confirmed via real
     `getBoundingClientRect()` measurement: 2515px, vs. its parent's
     1200px) regardless of `min-width:0` or `overflow-x:auto`, since it
     never even attempted to match the container's width in the first
     place. The tell: `.lead-fretboard-outer` (a sibling under the same
     `align-items:center` parent) already had `width:100%` explicitly
     set, which is exactly why the fretboard diagram never had this
     problem while the grid did. Fixed by adding the same `width:100%`
     to `.lead-grid-wrap`.
  Steps 1 and 2 were each verified as "fixed" using jsdom (confirming the
  CSS rule text existed) and were each *necessary* but not *sufficient*
  -- neither actually resolved the reported symptom, because jsdom
  doesn't compute real layout, so a CSS property being present was never
  actual proof it was having the intended effect. Step 3 was only found
  by loading the real page in a headless Chromium already available in
  this environment and measuring actual `getBoundingClientRect()` widths
  before and after the fix -- confirming zero page-level horizontal
  overflow (`document.documentElement.scrollWidth <= clientWidth`)
  across every tab, both with and without Advanced mode toggled. Worth
  remembering for any future layout bug report that survives an
  apparently-correct CSS fix: check real computed layout, not just
  whether the right property is declared somewhere in the stylesheet.

- **Advanced grid resolution toggle originally cleared the grid instead
  of preserving content, and drum templates were resolution-blind.**
  The first version of the Advanced toggle (doubling/halving slots per
  beat) just cleared the grid on switch, on the reasoning that a raw
  slot index means something different at a different resolution. That
  reasoning was right about the risk but wrong about the fix -- the
  actual right behavior is converting each note/hit's *array index* into
  its *musical time* (`beat = index / slotsPerBeat`) and placing it at
  the equivalent index in the new resolution, not discarding it. Doubling
  resolution is always exact (every old slot lands on a real new slot).
  Halving can legitimately collapse two closely-spaced notes onto the
  same coarser slot -- only warn when that specific collision actually
  happens, not unconditionally just because the grid has content.
  Separately, drum pattern templates (`DRUM_PATTERN_TEMPLATES`) have
  their hit positions hardcoded as raw step numbers, always authored at
  16th-note (4-slots-per-beat) resolution. Applying a template while in
  Advanced mode (8 slots per beat) was placing those same raw numbers
  directly into the finer grid, silently halving the pattern's actual
  musical length instead of preserving it -- a rock beat that should
  span one bar was landing entirely within the first half of it. Fixed
  by scaling every template step through the same remap math used for
  the toggle itself, from its fixed 4-slots-per-beat authoring
  resolution to whatever is actually live. The general lesson: any
  operation that changes grid resolution, or that places content
  authored at a different resolution, needs to convert through musical
  time -- treating slot index as a stand-in for time only holds when the
  resolution itself is fixed.

- **Global "Pattern" dropdown at the top of the page silently ignored by
  chord card clicks.** Reported as "changed arp types and clicked a
  chord card, still plays the default pattern." Root cause: every chord
  card on the Chart tab has its own independent, per-card pattern
  variable, hardcoded to start at `'block'`. Since that value is always
  truthy, it always won in the `pattern || window.__strumPattern ||
  'block'` fallback used to resolve what to actually play -- the global
  dropdown's value was structurally unreachable from a card click,
  regardless of what the dropdown was set to. Fixed by having each card
  live-follow the global dropdown until the user explicitly overrides
  that *specific* card via its own pattern-cycling arrows, at which
  point the override persists (a later, unrelated global dropdown
  change must not silently clobber a deliberate per-card choice). A
  small registry of each visible card's label-refresh callback lets the
  dropdown's own change handler keep every non-overridden card's
  displayed label honest too, not just its actual playback behavior.
  While tracking this down, also found and fixed a separate, more
  severe latent bug in the same area: `getVoicingCount` and
  `lookupChordShape` guarded against `chordsDbData` being null, but not
  against it existing with the wrong shape (missing `.chords`) -- which
  can genuinely happen if the chords-db fetch "succeeds" with an
  unexpected response body, not just in a stubbed test environment.
  `lookupChordShape` throwing there would have silently broken chord
  card rendering/playback entirely, worse than the originally reported
  bug. Fixed with an explicit shape guard in both functions, plus
  checking the fetch response actually succeeded before ever assigning
  to `chordsDbData` in the first place.

- **Save Image export redesigned for print (white background, ink-
  efficient) and fixed a real text-overflow bug.** Requested change:
  the exported chord-chart image used the app's own dark theme (near-
  black background, amber/cream accents, a translucent amber fill
  behind every chord cell) -- unusable for printing, and wasteful of
  ink even as a screen image. Rebuilt with a white background and a
  mostly-black/dark-gray palette, replaced the filled cell background
  with a plain border (the fill was purely decorative; the border
  conveys the same grouping with a fraction of the ink), and kept the
  chord diagram's finger-position dots as small solid black fills --
  the one place a fill is actually functional (standard printed
  chord-chart notation), not decorative. Separately, and part of the
  same complaint: chord titles could genuinely overflow their cell,
  since the code just called `fillText` at a fixed 26px with no width
  check at all -- an easy trigger with a longer suffix (`F#maj13#11`),
  a secondary-dominant label (`V7/vi`), or a long mode name. Added a
  `fitTextToWidth` helper (shrinks font size first, falls back to an
  ellipsis only if it still doesn't fit even at the smallest allowed
  size) and applied it everywhere text scales with real user content:
  the chord title, the per-chord label/mode line, and the header's
  key/modes summary line. Verified with a real headless-browser render
  (not just that the drawing calls happened, but the actual rendered
  pixels), including a deliberately extreme case (a very long suffix
  combined with a very long label) to confirm the truncation path
  itself actually engages, not just the font-shrinking path.
  While fixing this, found and fixed a real gap in the canvas test
  mock itself: it recorded every drawing call but returned `undefined`
  for `measureText`, so nothing that measures text before drawing
  (exactly what `fitTextToWidth` does) could be tested at all without
  throwing. Added a deterministic, font-size-based width estimate to
  the mock instead -- close enough to exercise shrink-to-fit and
  truncation logic without a real font-rendering engine. Two separate
  copies of this same mock exist (`jsdom-validate.mjs` and this file's
  own inline setup); both needed the fix.

- **5 new synthesized instruments and a per-chip Tremolo effect.**
  Electric Guitar, Acoustic Guitar, Nylon Guitar, Jazz Organ, and
  Vibraphone, following the app's existing synthesis conventions (no
  sample files added -- everything else besides Piano/Electric
  Bass/Double Bass is already synthesized). Verified against real Web
  Audio API validation across a full guitar frequency range (41Hz-2kHz)
  in an actual browser, not just that the code runs -- `exponentialRampToValueAtTime`
  and similar calls throw on invalid values the way a plain object mock
  never would.
  The Tremolo effect (a Trem toggle on both the chord chip and each
  lead chip) reuses a technique already established elsewhere in this
  codebase (`playNoteWithCustomFade`'s own fade envelope): every
  existing instrument function connects to whatever
  `window.__getMasterBus(ctx)` returns at the exact moment it's called,
  synchronously, with nothing async in between. `window.__playWithTremolo`
  temporarily redirects that cached reference to an LFO-modulated gain
  bus for the duration of one scheduling call, then restores it
  immediately -- so every one of the ~20 individual instrument
  functions gets the effect for free, without any of them needing to
  change. Verified end-to-end through a real offline render: with two
  chords, only one flagged `tremolo: true`, exactly one call to the
  wrapper occurred -- confirming the effect is applied selectively per
  chip, not globally.

- **Delay effect, tempo-synced presets, chained with Tremolo.** Same
  chip-level toggle pattern as Tremolo (chord chip + lead chip), but a
  dropdown of musical note-value presets (Off, 1/8, Dotted 1/8, 1/4,
  1/4 Triplet) instead of a plain on/off switch, since a delay's actual
  usefulness depends entirely on landing in time with the song. Each
  preset is a *fraction of one beat*, converted to real seconds against
  whatever the tempo currently is at the moment of scheduling -- never
  a value frozen from whenever the preset was picked, same discipline
  as every other tempo-dependent calculation in this app. Verified the
  math is exact at multiple tempos, including that doubling the tempo
  exactly halves every preset's resulting delay time.
  Architecturally reuses the exact same technique as Tremolo
  (`window.__playWithDelay`, mirroring `__playWithTremolo`): split the
  signal into a dry path (straight through, unchanged) and a wet path
  (through a `DelayNode` with a feedback loop for a few decaying
  repeats), both landing on the real master bus, via the same temporary
  master-bus-redirect trick. Since a chord or lead layer can have
  *both* Tremolo and Delay on at once, `scheduleChordAudio` now chains
  the two wrappers via a small shared helper (`applyChipEffects`)
  rather than duplicating the chaining logic in both branches of the
  grid-lead scheduling loop -- tremolo applied first/innermost, delay
  outermost (modulation before time-based effects, a common signal-
  chain convention). Verified through a real render with three chords
  (delay-only, delay+tremolo together, and explicitly off) that the
  effect wrappers fire exactly the expected number of times.

- **Chord card click-bleed, actual root cause finally found.** Reported
  as "the entire card pulses when clicked, the carousel pulses too" --
  every individual button and label within the card's nav rows
  (voicing/pattern/octave) already had its own `stopPropagation`, which
  masked the real gap: the row *containers themselves* never did. A
  click landing in the gap between buttons, or on the row's own
  padding, bubbled straight up to the card's play handler and triggered
  the `.playing` glow across the whole card -- which visually reads as
  "the carousel is pulsing too," since the glow is a `box-shadow` on
  the card element that necessarily wraps its children. Fixed by
  sealing all three row containers directly, rather than continuing to
  rely on catching every individual child element (the same piecemeal
  approach that left this gap in the first place, and the approach
  behind an earlier, narrower click-bleed fix in this same area).
  Verified explicitly, both directions: a click landing on a row
  container now produces zero playback calls, and a click on the
  actual chord name still triggers playback correctly -- confirming
  the fix is scoped to the nav rows, not a blanket click-disable.
  Also found and fixed a related, same-cause gap in the same pass: the
  expanded chord-explanation text was missing the same protection.

- **Envelope Filter (auto-wah) -- a real architectural tradeoff worth
  understanding, not glossed over.** A genuine envelope filter tracks
  the actual live amplitude of the signal in real time; doing that
  properly in Web Audio needs either per-frame JS polling of an
  `AnalyserNode` or a `ScriptProcessorNode`/`AudioWorklet`, none of
  which fit the pure-`AudioParam`-automation architecture the other
  chip effects use (and which is why they need zero JS-side upkeep
  once scheduled). What's implemented instead shapes the filter's
  cutoff directly against the note's own known attack-then-decay
  timing -- which is genuinely how real auto-wah pedals behave (keyed
  to that same contour via an envelope detector), not a simulation of
  a different effect. Uses the identical `window.__playWith*` /
  master-bus-redirect pattern as Tremolo and Delay, and chains
  correctly with both when more than one is active on the same chip
  (verified with real call counts through an actual render: all three
  firing together on one chord, only the enabled ones firing on
  another).

- **Shift-held "sync all like chips" gesture, across every control on
  both chord chips and lead chips.** Requested to solve a real workflow
  pain point: changing an instrument or turning down volume meant
  repeating the same edit on every single chip by hand. Holding Shift
  while interacting with any control -- Mute, Solo, Tremolo, Delay,
  Envelope Filter, Strum Pattern/Instrument, or the Volume knob -- now
  broadcasts that exact change to every chip of the same kind
  (`applyToAllLikeChips('chord' | 'lead', field, value)`) across the
  whole progression, not just the one directly touched. Without Shift,
  every control still behaves exactly as before, scoped to just that
  one chip.
  Two different techniques for detecting Shift, deliberately: for
  buttons, `e.shiftKey` is read directly off the click event, since
  `click`/`MouseEvent` reliably carries modifier-key state. For
  `<select>` dropdowns, `change` events do not reliably carry modifier
  state across browsers, so a small global tracker
  (`window.__shiftHeld`, updated on `keydown`/`keyup`, reset on
  `blur` so it can't get stuck "on" if focus leaves the window mid-
  hold) is checked instead.
  The volume knob needed its own accommodation: its existing `onChange`
  callback already fires continuously during a drag (many times per
  second), so checking Shift there would re-broadcast to the whole
  progression on every pixel of movement. Added a separate `onCommit`
  callback, fired exactly once on drag-release with the final value and
  the Shift state at that moment -- the natural "commit" point for a
  drag gesture, distinct from the live per-tick updates `onChange`
  still handles.
  "Lead chips" sync reaches every lead layer on every chord that has
  one, correctly skipping chords with no lead layer at all rather than
  creating one. Each broadcast goes through the normal `setProgression`
  path as a single call, so it's one undo-able action, not one per chip
  touched.

- **Chord card still visually "pulsed" on carousel clicks after the
  click-bleed fix -- a genuinely different mechanism, not a residual
  gap in the same one.** The earlier fix addressed the JS-level bleed
  (clicks bubbling to the card's `click` handler and triggering
  playback + the `.playing` glow). What remained was pure CSS:
  `.chart-card:active{ transform:scale(0.97); }` is a native browser
  pseudo-class effect that propagates up the ancestor chain on
  `mousedown` regardless of JS `stopPropagation()` -- calling
  `stopPropagation()` on a `click` handler cannot affect it at all,
  since `:active` isn't part of the JS event system. Fixed with a
  `:has()` override: `.chart-card:has(.chart-card-voicing-row:active){
  transform:none; }`, which cancels the press-scale specifically when
  the actively-pressed descendant is within a nav row, while leaving
  the normal press feedback intact for the actual chord-display area.
  Also made the carousel nav buttons a little bigger (24px to 28px)
  and had the nav row break out of the card's own horizontal padding
  (`margin: 0 -10px; width: calc(100% + 20px)`) so the buttons land
  flush with the card's actual edge instead of inset by its padding.
  Verifying this took real, live browser interaction, not just reading
  the CSS -- and along the way surfaced a bug in the verification
  itself worth remembering: an early live-browser test appeared to
  show the `:has()` fix wasn't working, until it turned out the test
  had grabbed a button sitting inside a `visibility:hidden` row (a
  chord with only one voicing hides that row entirely) -- clicking
  that invisible button's coordinates actually landed on the card
  underneath, which is a real, separate reason a click can bypass a
  control, distinct from both the JS bleed and the CSS `:active`
  propagation already covered above. Once the test correctly filtered
  out hidden rows, the fix was confirmed working via real mouse
  down/up events and a real screenshot.

## Known, accepted lower-severity edge case (not fixed, documented on purpose)

- **Editing the progression while a live playback pass is already
  running.** `stopPlayback()` is not called from `setProgression`, so
  chords already scheduled via `setTimeout` before the edit will still
  fire using their original (still-valid, since entries are replaced
  wholesale rather than mutated) chord data -- the *audio* stays
  correct. What can drift is purely cosmetic: `renderedChipElements[i]`
  is rebuilt on every render, so if the array shifted mid-playback the
  wrong chip could flash/animate during an already-scheduled note.
  Deliberately not "fixed" by calling `stopPlayback()` inside
  `setProgression`, since that would also interrupt playback on minor
  live tweaks (a volume knob drag goes through the same function) that
  should be able to happen without stopping the song. Worth revisiting
  if it turns out to bother anyone in practice.
