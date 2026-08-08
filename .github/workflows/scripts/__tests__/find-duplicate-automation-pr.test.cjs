/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  buildOverlapMatrix,
  collectLocalFilePatches,
  createPullRequestFileGetter,
  findSupersededPairs,
  hasFileOverlap,
  hasExactDuplicate,
  hasEquivalentDuplicate,
  isGhNotFoundError,
  runOverlapMatrix,
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

test('buildOverlapMatrix returns empty result for fewer than 2 candidates', () => {
  const ghCommand = () =>
    JSON.stringify([
      { number: 1, title: 'fix: x', url: 'https://example.com/1', headRefName: 'fix-1', labels: [] },
    ]);
  const result = buildOverlapMatrix({ repo: 'o/r', label: 'auto-fix', ghCommand });
  assert.deepEqual(result.prs, []);
  assert.deepEqual(result.contestedFiles, []);
  assert.equal(result.markdown, '');
});

test('buildOverlapMatrix detects contested files across multiple PRs', () => {
  const filesPayload = new Map([
    [1, [{ path: 'shared.ts', patch: '@@' }, { path: 'a-only.ts', patch: '@@' }]],
    [2, [{ path: 'shared.ts', patch: '@@' }, { path: 'b-only.ts', patch: '@@' }]],
    [3, [{ path: 'unique.ts', patch: '@@' }]],
  ]);
  const ghCommand = (args) => {
    const str = Array.isArray(args) ? args.join(' ') : String(args);
    if (str.includes('pr list'))
      return JSON.stringify([
        { number: 1, title: 'fix: a', url: 'u/1', headRefName: 'b1', labels: [{ name: 'auto-fix' }] },
        { number: 2, title: 'fix: b', url: 'u/2', headRefName: 'b2', labels: [{ name: 'auto-fix' }] },
        { number: 3, title: 'fix: c', url: 'u/3', headRefName: 'b3', labels: [{ name: 'auto-fix' }] },
      ]);
    const match = str.match(/\/pulls\/(\d+)\//);
    if (match) return JSON.stringify(filesPayload.get(Number(match[1])) || []);
    return '[]';
  };
  const result = buildOverlapMatrix({ repo: 'o/r', label: 'auto-fix', ghCommand });
  assert.equal(result.prs.length, 3);
  assert.equal(result.contestedFiles.length, 1);
  assert.equal(result.contestedFiles[0].file, 'shared.ts');
  assert.deepEqual(result.contestedFiles[0].prNumbers, [1, 2]);
  assert.match(result.markdown, /shared\.ts/);
  assert.match(result.markdown, /contested file/);
});

test('runOverlapMatrix appends markdown to GITHUB_STEP_SUMMARY when set', () => {
  const tmpFile = path.join(os.tmpdir(), `overlap-summary-${Date.now()}.md`);
  const filesPayload = new Map([
    [10, [{ path: 'a.ts', patch: '@@' }]],
    [11, [{ path: 'b.ts', patch: '@@' }]],
  ]);
  const ghCommand = (args) => {
    const str = Array.isArray(args) ? args.join(' ') : String(args);
    if (str.includes('pr list'))
      return JSON.stringify([
        { number: 10, title: 'fix: a', url: 'u/10', headRefName: 'b10', labels: [{ name: 'auto-fix' }] },
        { number: 11, title: 'fix: b', url: 'u/11', headRefName: 'b11', labels: [{ name: 'auto-fix' }] },
      ]);
    const match = str.match(/\/pulls\/(\d+)\//);
    if (match) return JSON.stringify(filesPayload.get(Number(match[1])) || []);
    return '[]';
  };
  try {
    runOverlapMatrix({ ghCommand, summaryPath: tmpFile });
    const written = fs.readFileSync(tmpFile, 'utf8');
    assert.match(written, /File-Overlap Conflict Matrix/);
    assert.match(written, /No contested files/);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('buildOverlapMatrix reports no contested files when all PRs touch unique files', () => {
  const filesPayload = new Map([
    [10, [{ path: 'a.ts', patch: '@@' }]],
    [11, [{ path: 'b.ts', patch: '@@' }]],
  ]);
  const ghCommand = (args) => {
    const str = Array.isArray(args) ? args.join(' ') : String(args);
    if (str.includes('pr list'))
      return JSON.stringify([
        { number: 10, title: 'fix: a', url: 'u/10', headRefName: 'b10', labels: [{ name: 'auto-fix' }] },
        { number: 11, title: 'fix: b', url: 'u/11', headRefName: 'b11', labels: [{ name: 'auto-fix' }] },
      ]);
    const match = str.match(/\/pulls\/(\d+)\//);
    if (match) return JSON.stringify(filesPayload.get(Number(match[1])) || []);
    return '[]';
  };
  const result = buildOverlapMatrix({ repo: 'o/r', label: 'auto-fix', ghCommand });
  assert.equal(result.contestedFiles.length, 0);
  assert.match(result.markdown, /No contested files/);
});

// --- Supersession (subset) detection tests ---

test('findSupersededPairs detects when smaller PR files are strict subset of larger', () => {
  const entries = [
    { number: 1019, title: 'APR-E10 scripts only', url: 'u/1019', paths: new Set(['scripts/escalate-repeated-fixes.cjs', 'scripts/__tests__/escalate-repeated-fixes.test.cjs']) },
    { number: 1040, title: 'Wire orphaned scripts', url: 'u/1040', paths: new Set(['scripts/escalate-repeated-fixes.cjs', 'scripts/__tests__/escalate-repeated-fixes.test.cjs', 'audit-auto-prs.yml', 'maintenance.yml', 'monitor-amnezia-control-panel-github-runs.yml']) },
    { number: 1033, title: 'Stale boundaries', url: 'u/1033', paths: new Set(['stale.yml', 'issue-catch-up.yml', 'maintenance.yml']) },
  ];
  const pairs = findSupersededPairs(entries);
  // #1019's files ⊂ #1040's files → superseded
  const superseded = pairs.filter((p) => p.superseded === 1019);
  assert.equal(superseded.length, 1);
  assert.equal(superseded[0].supersededBy, 1040);
  // #1033 is not a subset of anyone
  assert.equal(pairs.filter((p) => p.superseded === 1033).length, 0);
});

test('findSupersededPairs does not flag equal-size PRs as superseded', () => {
  const entries = [
    { number: 1, title: 'a', url: 'u/1', paths: new Set(['x.ts']) },
    { number: 2, title: 'b', url: 'u/2', paths: new Set(['x.ts']) },
  ];
  const pairs = findSupersededPairs(entries);
  assert.equal(pairs.length, 0, 'Equal-size PRs should not be flagged as superseded');
});

test('findSupersededPairs deduplicates: each superseded PR appears once', () => {
  const entries = [
    { number: 10, title: 'small', url: 'u/10', paths: new Set(['a.ts']) },
    { number: 20, title: 'medium', url: 'u/20', paths: new Set(['a.ts', 'b.ts']) },
    { number: 30, title: 'large', url: 'u/30', paths: new Set(['a.ts', 'b.ts', 'c.ts']) },
  ];
  const pairs = findSupersededPairs(entries);
  // #10 is subset of both #20 and #30, but should appear only once
  const for10 = pairs.filter((p) => p.superseded === 10);
  assert.equal(for10.length, 1);
  // #20 is subset of #30
  const for20 = pairs.filter((p) => p.superseded === 20);
  assert.equal(for20.length, 1);
  assert.equal(for20[0].supersededBy, 30);
});

test('findSupersededPairs returns empty for disjoint file sets', () => {
  const entries = [
    { number: 1, title: 'a', url: 'u/1', paths: new Set(['x.ts']) },
    { number: 2, title: 'b', url: 'u/2', paths: new Set(['y.ts']) },
  ];
  assert.deepEqual(findSupersededPairs(entries), []);
});

test('buildOverlapMatrix includes superseded PRs section in markdown', () => {
  const filesPayload = new Map([
    [1019, [{ path: 'scripts/escalate.cjs', patch: '@@' }]],
    [1040, [
      { path: 'scripts/escalate.cjs', patch: '@@' },
      { path: 'audit-auto-prs.yml', patch: '@@' },
    ]],
  ]);
  const ghCommand = (args) => {
    const str = Array.isArray(args) ? args.join(' ') : String(args);
    if (str.includes('pr list'))
      return JSON.stringify([
        { number: 1019, title: 'fix: scripts only', url: 'u/1019', headRefName: 'b1', labels: [{ name: 'auto-fix' }] },
        { number: 1040, title: 'fix: wire orphaned scripts', url: 'u/1040', headRefName: 'b2', labels: [{ name: 'auto-fix' }] },
      ]);
    const match = str.match(/\/pulls\/(\d+)\//);
    if (match) return JSON.stringify(filesPayload.get(Number(match[1])) || []);
    return '[]';
  };
  const result = buildOverlapMatrix({ repo: 'o/r', label: 'auto-fix', ghCommand });
  assert.ok(result.supersededPairs);
  assert.equal(result.supersededPairs.length, 1);
  assert.equal(result.supersededPairs[0].superseded, 1019);
  assert.equal(result.supersededPairs[0].supersededBy, 1040);
  assert.match(result.markdown, /Superseded PRs/);
  assert.match(result.markdown, /#1019.*#1040/);
  assert.match(result.markdown, /supersedes \(files ⊂\)/);
});

test('buildOverlapMatrix returns supersededPairs empty array when none exist', () => {
  const filesPayload = new Map([
    [10, [{ path: 'a.ts', patch: '@@' }]],
    [11, [{ path: 'b.ts', patch: '@@' }]],
  ]);
  const ghCommand = (args) => {
    const str = Array.isArray(args) ? args.join(' ') : String(args);
    if (str.includes('pr list'))
      return JSON.stringify([
        { number: 10, title: 'fix: a', url: 'u/10', headRefName: 'b10', labels: [{ name: 'auto-fix' }] },
        { number: 11, title: 'fix: b', url: 'u/11', headRefName: 'b11', labels: [{ name: 'auto-fix' }] },
      ]);
    const match = str.match(/\/pulls\/(\d+)\//);
    if (match) return JSON.stringify(filesPayload.get(Number(match[1])) || []);
    return '[]';
  };
  const result = buildOverlapMatrix({ repo: 'o/r', label: 'auto-fix', ghCommand });
  assert.ok(Array.isArray(result.supersededPairs));
  assert.equal(result.supersededPairs.length, 0);
});

test('findSupersededPairs does not flag a PR with empty paths as superseded', () => {
  // A PR whose files failed to load yields an empty path set (gh 404 → [],
  // parse failure → []). It must not be reported as a subset of every non-empty
  // PR even though [].every() is vacuously true.
  const entries = [
    { number: 1, title: 'no files loaded', url: 'u/1', paths: new Set([]) },
    { number: 2, title: 'has files', url: 'u/2', paths: new Set(['a.ts', 'b.ts']) },
    { number: 3, title: 'more files', url: 'u/3', paths: new Set(['a.ts', 'b.ts', 'c.ts']) },
  ];
  const pairs = findSupersededPairs(entries);
  // #1 is not flagged; #2 ⊂ #3 is the only real supersession.
  assert.equal(pairs.filter((p) => p.superseded === 1).length, 0);
  assert.deepEqual(pairs, [{ superseded: 2, supersededBy: 3 }]);
});

test('findSupersededPairs resolves nested subset chains to the maximal keeper', () => {
  // Chain A(#10) ⊂ B(#20) ⊂ C(#30): both A and B should point at C (the keeper),
  // never at a PR that is itself superseded.
  const entries = [
    { number: 10, title: 'A', url: 'u/10', paths: new Set(['a.ts']) },
    { number: 20, title: 'B', url: 'u/20', paths: new Set(['a.ts', 'b.ts']) },
    { number: 30, title: 'C', url: 'u/30', paths: new Set(['a.ts', 'b.ts', 'c.ts']) },
  ];
  const pairs = findSupersededPairs(entries);
  const bySuperseded = new Map(pairs.map((p) => [p.superseded, p.supersededBy]));
  assert.equal(bySuperseded.get(10), 30, 'A should point at the maximal keeper C, not B');
  assert.equal(bySuperseded.get(20), 30, 'B should point at keeper C');
  assert.equal(bySuperseded.get(30), undefined, 'C is the keeper and is not superseded');
});
