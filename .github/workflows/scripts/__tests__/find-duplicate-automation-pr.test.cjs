/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPullRequestFileGetter,
  hasFileOverlap,
  hasExactDuplicate,
  hasEquivalentDuplicate,
  isGhNotFoundError,
} = require('../find-duplicate-automation-pr.cjs');

test('hasFileOverlap returns true when local and remote share a file path', () => {
  const local = [{ path: '.github/workflows/docker-image.yml', patch: '@@' }];
  const remote = [
    { path: 'README.md', patch: '@@' },
    { path: '.github/workflows/docker-image.yml', patch: '@@' },
  ];
  assert.equal(hasFileOverlap(local, remote), true);
});

test('hasFileOverlap returns false when no paths are shared', () => {
  const local = [{ path: '.github/workflows/ci.yml', patch: '@@' }];
  const remote = [{ path: '.github/workflows/docker-image.yml', patch: '@@' }];
  assert.equal(hasFileOverlap(local, remote), false);
});

test('hasFileOverlap handles GitHub files payload (filename key) shape', () => {
  const local = [{ path: 'a/b.yml', patch: '@@' }];
  const remote = [{ filename: 'a/b.yml', patch: '@@' }];
  assert.equal(hasFileOverlap(local, remote), true);
});

test('hasFileOverlap returns false for empty local set', () => {
  assert.equal(hasFileOverlap([], [{ path: 'x.yml', patch: '@@' }]), false);
});

test('hasFileOverlap ignores whitespace-only and empty path entries', () => {
  const local = [{ path: '  ', patch: '@@' }];
  const remote = [{ path: '  ', patch: '@@' }];
  assert.equal(hasFileOverlap(local, remote), false);
});

test('hasExactDuplicate still requires identical full patch sets (regression guard)', () => {
  const local = [
    { path: '.github/workflows/docker-image.yml', patch: '@@ add cache-to' },
  ];
  // Same file, different patch (cache-to vs disk-prune) must NOT be a duplicate.
  const remote = [
    { path: '.github/workflows/docker-image.yml', patch: '@@ add disk-prune' },
  ];
  assert.equal(hasExactDuplicate(local, remote), false);
  assert.equal(hasEquivalentDuplicate(local, remote), false);
  // ...but it IS a same-file overlap, which is the gap overlap detection fills.
  assert.equal(hasFileOverlap(local, remote), true);
});

test('isGhNotFoundError recognizes GitHub CLI 404 pull-file failures', () => {
  assert.equal(
    isGhNotFoundError({
      stdout:
        '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/pulls/pulls#list-pull-requests-files","status":"404"}',
      stderr: 'gh: Not Found (HTTP 404)\n',
    }),
    true,
  );
});

test('createPullRequestFileGetter skips stale PRs whose files endpoint returns 404', () => {
  const warnings = [];
  const getFiles = createPullRequestFileGetter(
    'owner/repo',
    () => {
      const error = new Error(
        'Command failed: gh api repos/owner/repo/pulls/637/files?per_page=100',
      );
      error.stderr = 'gh: Not Found (HTTP 404)\n';
      throw error;
    },
    (message) => warnings.push(message),
  );

  assert.deepEqual(getFiles({ number: 637 }), []);
  assert.deepEqual(warnings, [
    'Skipping PR #637; GitHub no longer exposes its files payload.',
  ]);
});

test('createPullRequestFileGetter rethrows non-404 GitHub API failures', () => {
  const getFiles = createPullRequestFileGetter('owner/repo', () => {
    const error = new Error('gh: server error (HTTP 500)');
    error.stderr = 'gh: server error (HTTP 500)\n';
    throw error;
  });

  assert.throws(() => getFiles({ number: 12 }), /HTTP 500/);
});
