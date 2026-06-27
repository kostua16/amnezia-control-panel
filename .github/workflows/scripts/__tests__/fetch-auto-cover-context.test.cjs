/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isMissingResponse,
  mapWithConcurrency,
  extractAttempts,
  fetchPrContext,
  commitTimestamp,
  fetchAutoCoverContext,
  AUTO_COVER_MARKER,
} = require('../fetch-auto-cover-context.cjs');

test('isMissingResponse only treats HTTP 404 as missing', () => {
  assert.equal(isMissingResponse('gh: HTTP 404: Not Found'), true);
  assert.equal(isMissingResponse('HTTP 404'), true);
  assert.equal(isMissingResponse(''), false);
  assert.equal(isMissingResponse('gh: HTTP 403: rate limit exceeded'), false);
  assert.equal(isMissingResponse('gh: HTTP 500: Server Error'), false);
});

test('mapWithConcurrency preserves order and caps concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  const items = [10, 20, 30, 40, 50, 60];
  const results = await mapWithConcurrency(items, 2, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return item * 2;
  });
  assert.deepEqual(results, [20, 40, 60, 80, 100, 120]);
  assert.ok(maxActive <= 2, `concurrency exceeded cap: ${maxActive}`);
});

test('extractAttempts keeps only auto-cover summary comments', () => {
  const comments = [
    { body: '<!-- auto-cover-review-summary -->\ndispatched' },
    { body: 'random human comment' },
    { body: '<!-- kilo-review -->\nblocked' },
  ];
  assert.equal(extractAttempts(comments).length, 1);
  assert.ok(extractAttempts(comments)[0].body.includes(AUTO_COVER_MARKER));
});

test('commitTimestamp prefers committer date and falls back to author date', () => {
  assert.equal(
    commitTimestamp({
      commit: {
        author: { date: '2026-06-24T11:59:00Z' },
        committer: { date: '2026-06-24T12:00:00Z' },
      },
    }),
    '2026-06-24T12:00:00Z',
  );
  assert.equal(
    commitTimestamp({
      commit: { author: { date: '2026-06-24T11:59:00Z' } },
    }),
    '2026-06-24T11:59:00Z',
  );
});

test('fetchPrContext pulls statuses/check-runs from sub-keys and tolerates 404', async () => {
  const calls = [];
  const fetchJson = async (apiPath, opts = {}) => {
    calls.push({ apiPath, opts });
    if (apiPath.endsWith('/commits/headsha')) {
      return {
        commit: {
          committer: { date: '2026-06-24T12:00:00Z' },
        },
      };
    }
    if (apiPath.endsWith('/commits/headsha/status')) {
      return {
        statuses: [{ context: 'pr-flow/kilo-review', state: 'pending' }],
      };
    }
    if (apiPath.endsWith('/commits/headsha/check-runs')) {
      return {
        check_runs: [{ name: 'Kilo Code Review', conclusion: 'success' }],
      };
    }
    if (apiPath.includes('/issues/7/comments')) return [{ body: 'c1' }];
    if (apiPath.includes('/pulls/7/comments')) return [{ body: 'rc1' }];
    if (apiPath.includes('/pulls/7/reviews')) return [{ body: 'rv1' }];
    if (apiPath.includes('/pulls/7/commits')) return [{ sha: 'headsha' }];
    return null;
  };
  const viewPull = async () => ({
    number: 7,
    headRefOid: 'headsha',
    state: 'open',
  });

  const ctx = await fetchPrContext({
    fetchJson,
    viewPull,
    repo: 'owner/repo',
    prNumber: '7',
  });
  assert.equal(ctx.headSha, 'headsha');
  assert.equal(ctx.pr.headCommittedAt, '2026-06-24T12:00:00Z');
  assert.deepEqual(ctx.statuses, [
    { context: 'pr-flow/kilo-review', state: 'pending' },
  ]);
  assert.deepEqual(ctx.checkRuns, [
    { name: 'Kilo Code Review', conclusion: 'success' },
  ]);
  assert.deepEqual(ctx.commits, [{ sha: 'headsha' }]);
  assert.deepEqual(
    calls.find(({ apiPath }) => apiPath.endsWith('/commits/headsha/check-runs'))
      ?.opts,
    { paginate: true },
  );
});

test('fetchAutoCoverContext treats an empty scan as a clean no-op', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  let fetched = false;
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: [],
    outDir: dir,
    fetchJson: async () => {
      fetched = true;
      return null;
    },
    viewPull: async () => {
      fetched = true;
      return {};
    },
  });

  assert.equal(fetched, false);
  assert.deepEqual(manifest.prs, []);
  assert.deepEqual(manifest.ok, []);
  assert.equal(
    fs.readFileSync(path.join(dir, 'prs-to-evaluate.txt'), 'utf8'),
    '',
  );
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fetchAutoCoverContext shares fix-review runs across PRs and writes files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const viewPull = async (prNumber) =>
    prNumber === '1'
      ? { number: 1, headRefOid: 'aaa', state: 'open' }
      : { number: 2, headRefOid: 'bbb', state: 'open' };
  const fetchJson = async (apiPath) => {
    if (apiPath.includes('/actions/workflows/fix-review.yml/runs')) {
      return {
        workflow_runs: [{ display_title: 'PR #1', status: 'in_progress' }],
      };
    }
    if (apiPath.endsWith('/commits/aaa'))
      return { commit: { committer: { date: '2026-06-24T12:00:00Z' } } };
    if (apiPath.endsWith('/commits/aaa/status')) return { statuses: [] };
    if (apiPath.endsWith('/commits/aaa/check-runs')) return { check_runs: [] };
    if (apiPath.endsWith('/commits/bbb'))
      return { commit: { committer: { date: '2026-06-24T12:01:00Z' } } };
    if (apiPath.endsWith('/commits/bbb/status')) return { statuses: [] };
    if (apiPath.endsWith('/commits/bbb/check-runs')) return { check_runs: [] };
    if (
      apiPath.includes('/issues/1/comments') ||
      apiPath.includes('/issues/2/comments')
    )
      return [];
    if (apiPath.includes('/pulls/1/') || apiPath.includes('/pulls/2/'))
      return [];
    return null;
  };

  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['1', '2'],
    outDir: dir,
    fetchJson,
    viewPull,
    concurrency: 2,
  });

  assert.deepEqual(manifest.prs, ['1', '2']);
  assert.deepEqual(manifest.ok, ['1', '2']);
  assert.deepEqual(manifest.failed, []);
  assert.equal(manifest.count, 2);
  assert.equal(
    fs.readFileSync(path.join(dir, 'prs-to-evaluate.txt'), 'utf8').trim(),
    '1\n2',
  );
  // fix-review runs shared into every PR's context
  for (const pr of ['1', '2']) {
    const runs = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-fix-review-runs.json`), 'utf8'),
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0].display_title, 'PR #1');
    assert.equal(
      fs.readFileSync(path.join(dir, `pr-${pr}-head-sha`), 'utf8'),
      pr === '1' ? 'aaa' : 'bbb',
    );
    const context = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-pr.json`), 'utf8'),
    );
    assert.equal(
      context.headCommittedAt,
      pr === '1' ? '2026-06-24T12:00:00Z' : '2026-06-24T12:01:00Z',
    );
  }
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fetchAutoCoverContext isolates a per-PR failure so the rest of the scan completes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const viewPull = async (prNumber) =>
    prNumber === '10'
      ? { number: 10, headRefOid: 'ccc', state: 'open' }
      : { number: 11, headRefOid: 'ddd', state: 'open' };
  const fetchJson = async (apiPath) => {
    if (apiPath.includes('/actions/workflows/fix-review.yml/runs')) {
      return { workflow_runs: [] };
    }
    // PR 10 succeeds; PR 11's commit-status lookup fails with a transient 5xx.
    if (apiPath.endsWith('/commits/ccc'))
      return { commit: { committer: { date: '2026-06-24T12:00:00Z' } } };
    if (apiPath.endsWith('/commits/ccc/status')) return { statuses: [] };
    if (apiPath.endsWith('/commits/ccc/check-runs')) return { check_runs: [] };
    if (apiPath.endsWith('/commits/ddd/status')) {
      throw new Error('gh api failed: gh: HTTP 503: Service Unavailable');
    }
    if (
      apiPath.includes('/issues/10/comments') ||
      apiPath.includes('/issues/11/comments')
    )
      return [];
    if (apiPath.includes('/pulls/10/') || apiPath.includes('/pulls/11/'))
      return [];
    return null;
  };

  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['10', '11'],
    outDir: dir,
    fetchJson,
    viewPull,
    concurrency: 2,
  });

  assert.deepEqual(manifest.ok, ['10']);
  assert.equal(manifest.failed.length, 1);
  assert.equal(manifest.failed[0].pr, '11');
  // only the successful PR is handed to the dispatch loop
  assert.equal(
    fs.readFileSync(path.join(dir, 'prs-to-evaluate.txt'), 'utf8').trim(),
    '10',
  );
  assert.ok(fs.existsSync(path.join(dir, 'pr-10-head-sha')));
  assert.ok(!fs.existsSync(path.join(dir, 'pr-11-head-sha')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fetchAutoCoverContext surfaces rate-limit errors instead of masking as empty', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const viewPull = async () => ({
    number: 9,
    headRefOid: 'zzz',
    state: 'open',
  });
  const fetchJson = async (apiPath) => {
    if (apiPath.includes('/actions/workflows/')) {
      return { workflow_runs: [] };
    }
    if (apiPath.includes('/pulls/9/')) return [];
    if (apiPath.includes('/issues/9/comments')) return [];
    // commit status lookup fails with a rate-limit error
    if (apiPath.endsWith('/commits/zzz'))
      return { commit: { committer: { date: '2026-06-24T12:00:00Z' } } };
    if (apiPath.endsWith('/commits/zzz/status')) {
      throw new Error('gh api failed: gh: HTTP 403: rate limit exceeded');
    }
    return null;
  };

  await assert.rejects(
    fetchAutoCoverContext({
      repo: 'owner/repo',
      prs: ['9'],
      outDir: dir,
      fetchJson,
      viewPull,
    }),
    /rate limit/i,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
