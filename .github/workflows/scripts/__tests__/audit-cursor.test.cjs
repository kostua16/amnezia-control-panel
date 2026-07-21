/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectFocus,
  advanceCursor,
  normalizeIndex,
} = require('../audit-cursor.cjs');

// Mirror the real committed cursor so the test exercises the production shape.
function sampleCursor(currentIndex = 0) {
  return {
    description: 'test cursor',
    focus_areas: [
      { name: 'components', path: 'src/components', description: 'ui' },
      { name: 'api-routes', path: 'src/app/api', description: 'api' },
      {
        name: 'app-pages',
        path: 'src/app',
        exclude: ['src/app/api'],
        description: 'pages',
      },
    ],
    current_index: currentIndex,
    last_audited_run: null,
  };
}

test('selectFocus returns the area at current_index', () => {
  const out = selectFocus(sampleCursor(0));
  assert.equal(out.name, 'components');
  assert.equal(out.path, 'src/components');
  assert.equal(out.current_index, 0);
  assert.equal(out.next_index, 1);
  assert.equal(out.total, 3);
});

test('selectFocus folds exclude into focus_clause (prevents double-audit)', () => {
  const out = selectFocus(sampleCursor(2));
  assert.equal(out.name, 'app-pages');
  assert.equal(out.path, 'src/app');
  assert.deepEqual(out.exclude, ['src/app/api']);
  assert.equal(out.focus_clause, 'src/app (excluding src/app/api)');
});

test('selectFocus clause omits the exclude suffix when there are none', () => {
  const out = selectFocus(sampleCursor(1));
  assert.equal(out.focus_clause, 'src/app/api');
  assert.deepEqual(out.exclude, []);
});

test('normalizeIndex clamps an out-of-range current_index to 0', () => {
  const { idx, total } = normalizeIndex(sampleCursor(99));
  assert.equal(idx, 0);
  assert.equal(total, 3);
});

test('advanceCursor rotates the index and wraps mod length', () => {
  const { next, current_index } = advanceCursor(sampleCursor(2), 'run-42');
  assert.equal(current_index, 0, 'index 2 advances and wraps to 0');
  assert.equal(next.current_index, 0);
  assert.equal(next.last_audited_run, 'run-42');
});

test('advanceCursor keeps focus_areas and other fields intact', () => {
  const original = sampleCursor(0);
  const { next } = advanceCursor(original, 'run-7');
  assert.equal(next.focus_areas.length, original.focus_areas.length);
  assert.equal(next.description, original.description);
  assert.equal(next.current_index, 1);
});

test('advanceCursor stamps null when runId is absent', () => {
  const { next } = advanceCursor(sampleCursor(0));
  assert.equal(next.last_audited_run, null);
  assert.equal(next.current_index, 1);
});

test('normalizeIndex throws on an empty focus_areas list', () => {
  assert.throws(() => normalizeIndex({ focus_areas: [] }), /no focus_areas/);
});
