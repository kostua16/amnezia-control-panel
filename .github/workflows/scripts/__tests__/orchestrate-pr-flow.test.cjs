/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const { getWorkerDispatchRef } = require('../orchestrate-pr-flow.cjs');

test('dispatches same-repo PR workers from the head branch', () => {
  assert.equal(
    getWorkerDispatchRef({
      baseRefName: 'main',
      headRefName: 'codex/fix-branch',
      isCrossRepository: false,
    }),
    'codex/fix-branch',
  );
});

test('falls back to the base branch when the head branch is unavailable', () => {
  assert.equal(
    getWorkerDispatchRef({
      baseRefName: 'main',
      headRefName: '',
      isCrossRepository: false,
    }),
    'main',
  );
});

test('keeps cross-repo PR workers on the base branch', () => {
  assert.equal(
    getWorkerDispatchRef({
      baseRefName: 'main',
      headRefName: 'contrib/fork-branch',
      isCrossRepository: true,
    }),
    'main',
  );
});
