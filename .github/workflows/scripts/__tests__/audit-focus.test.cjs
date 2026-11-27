/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FOCUS_AREAS,
  isWithinPath,
  parseRunNumber,
  selectFocus,
  validateChangedFiles,
} = require('../audit-focus.cjs');

test('selectFocus maps run_number 1 to the first focus area', () => {
  const out = selectFocus(1);
  assert.equal(out.name, 'components');
  assert.equal(out.path, 'src/components');
  assert.equal(out.index, 0);
  assert.equal(out.total, FOCUS_AREAS.length);
  assert.equal(out.run_number, 1);
});

test('selectFocus advances by run_number and wraps around', () => {
  assert.equal(selectFocus(2).name, 'hooks');
  assert.equal(selectFocus(6).name, 'types');
  assert.equal(selectFocus(7).name, 'components');
});

test('selectFocus folds exclude into focus_clause', () => {
  const out = selectFocus(5);
  assert.equal(out.name, 'app-pages');
  assert.deepEqual(out.exclude, ['src/app/api']);
  assert.equal(out.focus_clause, 'src/app (excluding src/app/api)');
});

test('parseRunNumber rejects invalid values', () => {
  assert.throws(() => parseRunNumber(''), /invalid run number/);
  assert.throws(() => parseRunNumber('0'), /invalid run number/);
  assert.throws(() => parseRunNumber('1.5'), /invalid run number/);
});

test('isWithinPath requires a real path boundary', () => {
  assert.equal(
    isWithinPath('src/components/Button.tsx', 'src/components'),
    true,
  );
  assert.equal(
    isWithinPath('src/components-extra/Button.tsx', 'src/components'),
    false,
  );
});

test('validateChangedFiles accepts files inside the selected focus', () => {
  const result = validateChangedFiles(
    'src/lib/a.ts\nsrc/lib/__tests__/a.test.ts\n',
    selectFocus(3),
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.invalid, []);
});

test('validateChangedFiles rejects files outside the selected focus', () => {
  const result = validateChangedFiles(
    'src/lib/a.ts\nsrc/components/Button.tsx\n',
    selectFocus(3),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.invalid, ['src/components/Button.tsx']);
});

test('validateChangedFiles rejects excluded paths', () => {
  const result = validateChangedFiles(
    'src/app/page.tsx\nsrc/app/api/users/route.ts\n',
    selectFocus(5),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.invalid, ['src/app/api/users/route.ts']);
});

test('validateChangedFiles accepts an empty diff', () => {
  const result = validateChangedFiles('', selectFocus(1));
  assert.equal(result.valid, true);
  assert.deepEqual(result.files, []);
});
