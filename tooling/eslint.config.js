// Dev-only lint config for the Frequency Target Replicator codebase.
// Does not ship with the site -- run manually or as part of the verify
// step before shipping a change. Tuned to catch real bugs, especially
// the ones that have actually happened in this project: a large edit
// accidentally dropping a function signature (leaves orphaned code,
// often surfaces as no-undef or a redeclare), or two definitions of the
// same function silently coexisting (no-redeclare / no-func-assign).
//
// Lints the CONCATENATED combined.js (built by verify.mjs by joining
// the real js/*.js files in the same order index.html loads them), not
// each file individually -- all 7 files share one global scope at
// runtime (classic scripts, no modules), so linting them separately
// would flag every legitimate cross-file reference as a false-positive
// no-undef. Concatenating first means the linter sees exactly the same
// combined scope the browser actually executes.
export default [
  {
    files: ['combined.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly',
        navigator: 'readonly', localStorage: 'readonly', setTimeout: 'readonly',
        setInterval: 'readonly', clearTimeout: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', AudioContext: 'readonly',
        webkitAudioContext: 'readonly', fetch: 'readonly', Promise: 'readonly',
        Blob: 'readonly', URL: 'readonly', tf: 'readonly',
        AudioWorkletNode: 'readonly', OfflineAudioContext: 'readonly',
        ClipboardItem: 'readonly', performance: 'readonly',
        cancelAnimationFrame: 'readonly', Event: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-func-assign': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-fallthrough': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
    },
  },
];
