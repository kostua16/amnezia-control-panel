/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  collectLocalFilePatches,
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

// Regression: automation workflows run detection while Claude's edits are still
// uncommitted in the working tree (fetch-depth: 1 ⇒ HEAD == origin/main). The
// committed-state diffs saw nothing, so duplicate/overlap detection was inert.
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'find-duplicate-pr-'));
}

function writeFile(root, filePath, content) {
  const fullPath = path.join(root, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function withCwd(cwd, fn) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

function makeBaseRepo() {
  const root = makeTempDir();
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  writeFile(root, 'README.md', 'base\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  // Simulate the shallow-checkout state the workflows actually run in: HEAD is
  // the base ref tip, with no local commits ahead of origin/main.
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return root;
}

test('collectLocalFilePatches sees uncommitted modifications in the working tree', () => {
  const root = makeBaseRepo();
  // Commit the file at the base ref before overwriting it, so the working-tree
  // edit is a tracked-file modification (origin/main holds v1, working tree
  // holds v2) — the more common real-world Claude edit, and the distinct branch
  // the untracked-new-file test below does not cover.
  writeFile(root, 'src/lib/foo.ts', 'export const x = 1;\n');
  git(root, ['add', 'src/lib/foo.ts']);
  git(root, ['commit', '--quiet', '-m', 'foo v1']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  writeFile(root, 'src/lib/foo.ts', 'export const x = 2;\n');

  const files = withCwd(root, () => collectLocalFilePatches('main'));

  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'src/lib/foo.ts');
  assert.match(files[0].patch, /@@/);
  assert.match(files[0].patch, /-export const x = 1/);
  assert.match(files[0].patch, /\+export const x = 2/);
});

test('collectLocalFilePatches sees untracked new files in the working tree', () => {
  const root = makeBaseRepo();
  writeFile(root, 'src/lib/new.ts', 'export const y = 1;\n');

  const files = withCwd(root, () => collectLocalFilePatches('main'));

  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'src/lib/new.ts');
  assert.match(files[0].patch, /\+export const y = 1/);
});
