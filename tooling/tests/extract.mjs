// Pulls a named function's exact source out of the real js/*.js files
// (concatenated in the same order the browser actually loads them) and
// turns it into a callable JS function, so tests exercise the real,
// current implementation rather than a hand-copied reimplementation
// that can drift out of sync silently. Only works for genuinely
// self-contained functions (ones that don't reach out to module-level
// state or DOM globals the caller hasn't provided) -- see each test
// file's own notes for what it had to supply as a stand-in dependency,
// and why.
import { readFileSync } from 'fs';

// Same load order as the <script> tags in index.html -- keep in sync if
// that ever changes.
const JS_FILES = [
  'tuner.js', 'core-and-chordid.js', 'chart-cards.js',
  'chart-progression.js', 'drums.js', 'lead.js', 'app-init.js',
];
const SOURCE = JS_FILES
  .map(f => readFileSync(new URL(`../../js/${f}`, import.meta.url), 'utf8'))
  .join('\n');

export function extractFunction(name, { dependencies = '' } = {}) {
  const startMarker = `function ${name}(`;
  const startIdx = SOURCE.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`extractFunction: could not find "function ${name}(" in js/*.js -- has it been renamed, removed, or moved to a different file?`);
  }
  // walk forward from the opening brace to find its matching close,
  // so the extraction is correct regardless of nested braces inside
  const braceStart = SOURCE.indexOf('{', startIdx);
  let depth = 0, i = braceStart;
  for (; i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) {
    throw new Error(`extractFunction: brace matching for "${name}" never closed -- extraction is unreliable, don't trust this test run`);
  }
  const source = SOURCE.slice(startIdx, i + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`${dependencies}\nreturn ${source};`)();
}

export function extractConst(name) {
  const re = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\});`, 'm');
  const match = SOURCE.match(re);
  if (!match) {
    throw new Error(`extractConst: could not find "const ${name} = ..." in js/*.js`);
  }
  // eslint-disable-next-line no-new-func
  return new Function(`return ${match[1]};`)();
}

// For functions that read AND reassign module-level `let` state (e.g.
// performDrumDuplicate reassigns drumSelection). initialState values
// become mock `let` bindings the extracted function closes over and can
// mutate (plain JSON-serializable data only). mockGlobals values are
// raw source-code strings the caller writes directly -- not
// auto-serialized -- since mocks like a fake `document` or `window`
// need actual methods, which JSON.stringify would silently drop.
// Returns { call, getState } sharing one closure, so getState() after
// call() reflects whatever the real function's reassignments actually
// did.
export function extractStatefulFunction(name, { initialState = {}, mockGlobals = {} } = {}) {
  const startMarker = `function ${name}(`;
  const startIdx = SOURCE.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`extractStatefulFunction: could not find "function ${name}(" in js/*.js`);
  }
  const braceStart = SOURCE.indexOf('{', startIdx);
  let depth = 0, i = braceStart;
  for (; i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) {
    throw new Error(`extractStatefulFunction: brace matching for "${name}" never closed`);
  }
  const source = SOURCE.slice(startIdx, i + 1);

  const stateDecls = Object.entries(initialState)
    .map(([k, v]) => `let ${k} = ${JSON.stringify(v)};`).join('\n');
  const globalDecls = Object.entries(mockGlobals)
    .map(([k, v]) => `const ${k} = ${v};`).join('\n'); // v is a raw source string, e.g. "{ getElementById: () => ({value: '4'}) }"
  const stateKeys = Object.keys(initialState);

  const wrapperSrc = `
    ${stateDecls}
    ${globalDecls}
    ${source}
    return { call: ${name}, getState: () => ({ ${stateKeys.join(', ')} }) };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(wrapperSrc)();
}
