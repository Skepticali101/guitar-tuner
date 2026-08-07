// One command for everything: concatenates the real js/*.js files (same
// order index.html loads them) into combined.js for linting/type-
// checking, then runs a real jsdom execution test of index.html itself,
// then the regression test suite. Dev-only -- none of this ships with
// the site. Run with: node verify.mjs
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const JS_FILES = [
  'tuner.js', 'core-and-chordid.js', 'chart-cards.js',
  'chart-progression.js', 'drums.js', 'lead.js', 'app-init.js',
];
const combined = JS_FILES.map(f => readFileSync(`../js/${f}`, 'utf8')).join('\n');
writeFileSync('combined.js', combined);
console.log(`Combined ${JS_FILES.length} files into combined.js (${combined.split('\n').length} lines)\n`);

console.log('=== ESLint ===');
try {
  execSync('npx eslint combined.js', { stdio: 'inherit' });
  console.log('No lint errors.\n');
} catch {
  console.log('(non-zero exit above is expected if there are warnings -- check for "error" vs "warning" in the output)\n');
}

console.log('=== TypeScript checkJs ===');
try {
  execSync('npx tsc', { stdio: 'inherit' });
  console.log('No type errors.\n');
} catch {
  console.log('(see errors above -- cross-reference against KNOWN_SAFE.md before treating any as a new bug)\n');
}

console.log('=== Real execution test (jsdom loads and runs the actual index.html) ===');
try {
  execSync('node jsdom-validate.mjs', { stdio: 'inherit' });
  console.log();
} catch {
  console.log('\n(a real error above means index.html does not run cleanly -- do not ship)\n');
}

console.log('=== Regression tests ===');
try {
  execSync('node --test', { stdio: 'inherit' });
} catch {
  console.log('\n(test failures above are real -- do not ship until these pass)\n');
}
