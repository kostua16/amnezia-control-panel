/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  absurdReplayThreshold,
  analyzeRebaseAncestry,
  visibleCommitCountFor,
} = require('../analyze-rebase-ancestry.cjs');

const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
const HEAD_SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const MERGE_BASE = '1111111111111111111111111111111111111111';

function prWithCommits(count) {
  return {
    baseRefName: 'main',
    commits: Array.from({ length: count }, (_, index) => ({
      oid: `commit-${index}`,
    })),
  };
}

function fakeGit(responses) {
  return (args) => {
    const key = args.join(' ');
    const value = responses[key];
    if (value instanceof Error) throw value;
    if (!(key in responses)) {
      throw new Error(`unexpected git command: ${key}`);
    }
    return value;
  };
}

function analyze({
  visibleCommits = 2,
  replayCount = 2,
  mergeBase = MERGE_BASE,
}) {
  return analyzeRebaseAncestry({
    pr: prWithCommits(visibleCommits),
    git: fakeGit({
      'rev-parse origin/main': BASE_SHA,
      'rev-parse HEAD': HEAD_SHA,
      'merge-base HEAD origin/main': mergeBase,
      'rev-list --count origin/main..HEAD': String(replayCount),
    }),
  });
}

test('visibleCommitCountFor counts PR commits from gh metadata', () => {
  assert.equal(visibleCommitCountFor(prWithCommits(2)), 2);
  assert.equal(visibleCommitCountFor({}), null);
});

test('absurdReplayThreshold uses visible plus 20 or 5x, whichever is larger', () => {
  assert.equal(absurdReplayThreshold(2), 22);
  assert.equal(absurdReplayThreshold(10), 50);
});

test('sane PR with two visible commits and two replay commits passes', () => {
  const result = analyze({ visibleCommits: 2, replayCount: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.merge_base, MERGE_BASE);
  assert.equal(result.replay_count, 2);
  assert.equal(result.visible_commit_count, 2);
});

test('small PR one main commit behind still passes when replay count is sane', () => {
  const result = analyze({ visibleCommits: 2, replayCount: 2 });
  assert.equal(result.ok, true);
});

test('missing merge base fails closed', () => {
  const result = analyzeRebaseAncestry({
    pr: prWithCommits(2),
    git: fakeGit({
      'rev-parse origin/main': BASE_SHA,
      'rev-parse HEAD': HEAD_SHA,
      'merge-base HEAD origin/main': new Error('no merge base'),
      'rev-list --count origin/main..HEAD': '2',
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /merge base/);
});

test('absurd replay count fails closed with a clear reason', () => {
  const result = analyze({ visibleCommits: 2, replayCount: 925 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /replay count 925/);
  assert.match(result.reason, /2 visible PR commit/);
});

test('threshold boundary allows the exact threshold and rejects one above it', () => {
  assert.equal(analyze({ visibleCommits: 2, replayCount: 22 }).ok, true);
  assert.equal(analyze({ visibleCommits: 2, replayCount: 23 }).ok, false);
  assert.equal(analyze({ visibleCommits: 10, replayCount: 50 }).ok, true);
  assert.equal(analyze({ visibleCommits: 10, replayCount: 51 }).ok, false);
});
