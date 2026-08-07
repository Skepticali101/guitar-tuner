# Dev tooling for Frequency Target Replicator

Dev-only. None of this ships with the site -- it exists purely to catch
regressions before they reach production.

## Codebase structure (as of the file split)

`index.html` used to contain ~7,500 lines of inline JavaScript in two
`<script>` blocks. It's now ~2,000 lines of HTML/CSS, and the code lives
in `js/`, loaded via plain `<script src="...">` tags in this order:

```
js/tuner.js              -- Tune tab (IIFE-wrapped, self-contained,
                             communicates via window.__x properties)
js/core-and-chordid.js   -- shared constants/helpers + Chord ID tab
js/chart-cards.js        -- Chart tab: diatonic tables, click-to-play
js/chart-progression.js  -- Chart tab: progression data model, sections,
                             saved progressions, playback
js/drums.js              -- Drums tab: synthesis engine, real samples,
                             grid editor
js/lead.js               -- Lead tab: melody grid, arp generator
js/app-init.js           -- MUST load last: global app init, keyboard
                             shortcuts, scale/modulation popups. This
                             file calls functions defined in several of
                             the others above it, so it has to be the
                             final script tag.
```

No build step. These are all plain classic scripts (not ES modules),
so they share one global scope automatically -- exactly like the
original single file did, just split into pieces. Load order matters:
whatever a later file uses has to be defined by an earlier one.

**If you add a new top-level file-init call** (something that runs
immediately when a script loads, not inside a function called later),
double check it doesn't call anything defined in a file that loads
after it. This bit us once already during the split itself -- see
`KNOWN_SAFE.md` for what happened and how `jsdom-validate.mjs` below
exists specifically to catch it automatically going forward.

## Setup (one time)
```bash
cd tooling
npm install
```

## Running everything
```bash
node verify.mjs
```
Concatenates the 7 `js/*.js` files (same order the browser loads them)
into `combined.js`, then runs ESLint, TypeScript's `checkJs`, a real
execution test of `index.html` via jsdom, and the full regression test
suite, in that order. This is the one command to run before shipping
any change.

## Running pieces individually
```bash
npx eslint combined.js   # after node verify.mjs has generated it at least once
npx tsc                  # type-check
node jsdom-validate.mjs  # load and execute the real index.html, report any error
node --test               # regression tests only
```

## What each tool actually catches

**ESLint** (`eslint.config.js`) -- undefined variables, redeclared
functions, dead code, unreachable branches. Lints the *concatenated*
`combined.js`, not each `js/*.js` file separately -- all 7 files share
one global scope at runtime, so linting them individually would flag
every legitimate cross-file reference (e.g. `drums.js` using
`progression`, defined in `chart-progression.js`) as a false-positive
`no-undef`.

**TypeScript `checkJs`** (`tsconfig.json`, `globals.d.ts`) -- type
checking on the existing plain JavaScript, no conversion to real
TypeScript, no build step change. `globals.d.ts` declares this app's
own custom `window`/`AudioContext` properties so the checker doesn't
re-report the same ~172 known-safe findings every run -- see
`KNOWN_SAFE.md` for what those are and why they're confirmed safe, not
just ignored.

**jsdom execution test** (`jsdom-validate.mjs`) -- loads the *actual*
`index.html`, executes every script in a real simulated DOM, and
reports any error. This is the check that catches cross-file ordering
bugs that syntax checking alone can't see -- a function call that
resolves fine within one file but throws `ReferenceError` at runtime
because the function it calls is defined in a file that hasn't loaded
yet. Real browser APIs jsdom doesn't implement (Web Audio, network
fetch, `matchMedia`) are minimally polyfilled inside the test file
itself, not in the app -- see the polyfills at the top of
`jsdom-validate.mjs` for exactly what's stubbed and why.

**Regression tests** (`tests/*.test.mjs`) -- real tests against the
actual current implementation, not hand-copied reimplementations. Uses
`tests/extract.mjs` to pull function source directly out of the real
`js/*.js` files (concatenated in load order) at test-run time via
balanced-brace matching, so a test automatically exercises whatever the
function currently does.

Two extraction helpers, depending on what the function needs:
- `extractFunction(name, { dependencies })` -- for pure functions.
  `dependencies` is a source string providing whatever constants/helper
  functions the extracted function calls but doesn't define itself.
- `extractStatefulFunction(name, { initialState, mockGlobals })` -- for
  functions that read and reassign module-level state (like
  `performDrumDuplicate` reassigning `drumSelection`). Returns
  `{ call, getState }` sharing one closure, so `getState()` after
  `call()` reflects whatever the real function's reassignments did.
  `initialState` values must be plain JSON-serializable data;
  `mockGlobals` values are raw source strings (not auto-serialized,
  since mocks like a fake `document.getElementById` need actual
  methods).

## Adding a new test
1. Confirm the function is either pure or reassigns only clearly-named
   module-level `let`s -- if it reaches into a huge tangle of DOM state,
   it's probably not a good extraction candidate; consider whether the
   function itself should be simplified first.
2. Pick the right helper (`extractFunction` vs `extractStatefulFunction`)
   and check what constants/functions/state it actually touches by
   reading the real source first, not guessing.
3. Write the test, run it, and make sure it actually fails if you
   temporarily break the real function on purpose -- a test that can't
   fail isn't testing anything.

## Current coverage
28 tests across pitch-class extraction, interval/color theory, the
piano keyboard renderer, hi-hat choke timing, and drum grid
duplicate/copy/paste. All genuinely high-risk logic that's been
hand-verified ad-hoc at some point this project's history -- this
suite is what makes that verification permanent instead of disposable.

Known gap: the drum grid's *move* (drag-and-drop) and the Lead tab's
equivalent tools aren't covered yet -- same extraction approach would
work, just not yet written.
