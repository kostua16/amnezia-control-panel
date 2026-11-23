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
  restLogin,
  mapStatuses,
  mapCheckRuns,
  AUTO_COVER_MARKER,
} = require('../fetch-auto-cover-context.cjs');
const { evaluateExternalReview } = require('../evaluate-external-review.cjs');
const {
  evaluateAutoCoverReview,
} = require('../evaluate-auto-cover-review.cjs');

const policyJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'policy.json'), 'utf8'),
);

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

test('extractAttempts keeps only workflow-owned auto-cover summary comments', () => {
  const bot = { login: 'github-actions[bot]' };
  const comments = [
    { user: bot, body: '<!-- auto-cover-review-summary -->\ndispatched' },
    { user: bot, body: 'random bot comment' },
    { user: { login: 'octocat' }, body: 'random human comment' },
    {
      user: { login: 'kilo-code-bot[bot]' },
      body: '<!-- kilo-review -->\nblocked',
    },
    // A copied marker from anyone else never counts as an attempt.
    {
      user: { login: 'octocat' },
      body: '<!-- auto-cover-review-summary -->\nquoted',
    },
    { body: '<!-- auto-cover-review-summary -->\nno author' },
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

// ---------------------------------------------------------------------------
// GraphQL context path: one query per PR replaces seven REST calls, and the
// written files keep the REST field shapes the consumers read.
// ---------------------------------------------------------------------------

const HEAD_SHA = 'headsha';

function graphqlPullPayload(overrides = {}) {
  return {
    repository: {
      pullRequest: {
        comments: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              body: `${AUTO_COVER_MARKER}\ndispatched`,
              createdAt: '2026-06-24T10:00:00Z',
              updatedAt: '2026-06-24T10:00:00Z',
              author: { login: 'github-actions', __typename: 'Bot' },
            },
            {
              body: 'human note',
              createdAt: '2026-06-24T10:05:00Z',
              updatedAt: '2026-06-24T10:05:00Z',
              author: { login: 'octocat', __typename: 'User' },
            },
          ],
        },
        reviewThreads: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              comments: {
                pageInfo: { hasNextPage: false },
                nodes: [
                  {
                    body: '**WARNING:** missing guard',
                    path: 'src/lib/a.ts',
                    originalCommit: { oid: HEAD_SHA },
                    commit: { oid: HEAD_SHA },
                    createdAt: '2026-06-24T11:00:00Z',
                    updatedAt: '2026-06-24T11:00:00Z',
                    author: { login: 'kilo-code-bot', __typename: 'Bot' },
                  },
                ],
              },
            },
          ],
        },
        reviews: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              body: 'review body',
              state: 'COMMENTED',
              submittedAt: '2026-06-24T11:00:00Z',
              commit: { oid: HEAD_SHA },
              author: { login: 'kilo-code-bot', __typename: 'Bot' },
            },
          ],
        },
        commits: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              commit: {
                oid: HEAD_SHA,
                message: 'feat: thing',
                authoredDate: '2026-06-24T11:59:00Z',
                committedDate: '2026-06-24T12:00:00Z',
              },
            },
          ],
        },
        headCommit: {
          nodes: [
            {
              commit: {
                oid: HEAD_SHA,
                committedDate: '2026-06-24T12:00:00Z',
                status: {
                  contexts: [
                    {
                      context: 'pr-flow/kilo-review',
                      state: 'PENDING',
                      createdAt: '2026-06-24T12:01:00Z',
                      updatedAt: '2026-06-24T12:01:00Z',
                      targetUrl: null,
                      description: null,
                    },
                  ],
                },
                checkSuites: {
                  pageInfo: { hasNextPage: false },
                  nodes: [
                    {
                      app: { slug: 'kilo-code', name: 'Kilo Code' },
                      checkRuns: {
                        pageInfo: { hasNextPage: false },
                        nodes: [
                          {
                            name: 'Kilo Code Review',
                            status: 'COMPLETED',
                            conclusion: 'SUCCESS',
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
        ...overrides,
      },
    },
  };
}

function legacyFetchJson(recorder, prHeadShas = {}) {
  return async (apiPath, opts = {}) => {
    recorder.push({ apiPath, opts });
    if (apiPath.includes('/actions/workflows/fix-review.yml/runs')) {
      return { workflow_runs: [] };
    }
    const headMatch = apiPath.match(
      /\/commits\/([^/]+?)(\/status|\/check-runs)?$/,
    );
    if (headMatch) {
      const sha = headMatch[1];
      const sub = headMatch[2];
      if (!sub)
        return { commit: { committer: { date: '2026-06-24T12:00:00Z' } } };
      if (sub === '/status') {
        return {
          statuses: [{ context: 'pr-flow/kilo-review', state: 'pending' }],
        };
      }
      return {
        check_runs: [{ name: 'Kilo Code Review', conclusion: 'success' }],
      };
    }
    if (
      apiPath.includes('/comments') ||
      apiPath.includes('/reviews') ||
      apiPath.includes('/commits')
    ) {
      return [];
    }
    return null;
  };
}

test('repro: legacy REST path costs 7 REST calls per PR plus 1 shared run list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const calls = [];
  const viewPull = async (prNumber) => ({
    number: Number(prNumber),
    headRefOid: `sha${prNumber}`,
    state: 'open',
  });
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['1', '2'],
    outDir: dir,
    fetchJson: legacyFetchJson(calls),
    viewPull,
    concurrency: 2,
  });
  assert.deepEqual(manifest.ok, ['1', '2']);
  const perPr = calls.filter(
    ({ apiPath }) => !apiPath.includes('/actions/workflows/'),
  );
  const shared = calls.filter(({ apiPath }) =>
    apiPath.includes('/actions/workflows/'),
  );
  // 2 PRs x 7 REST lookups (issue comments, review comments, reviews, commits,
  // head commit, combined status, check-runs) + 1 shared fix-review run list.
  assert.equal(perPr.length, 14);
  assert.equal(shared.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('graphql path: one query per PR, zero per-PR REST calls, REST-shaped files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const gqlCalls = [];
  const viewPull = async (prNumber) => ({
    number: Number(prNumber),
    headRefOid: HEAD_SHA,
    state: 'OPEN',
    mergedAt: null,
    isDraft: false,
    headRefName: 'feat-x',
    baseRefName: 'main',
    labels: [{ name: 'ai-review-concerns' }],
    isCrossRepository: false,
    files: [{ path: 'src/lib/a.ts', additions: 1, deletions: 0 }],
  });
  const graphql = async (query, variables) => {
    gqlCalls.push({ query, variables });
    return graphqlPullPayload();
  };
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['1', '2'],
    outDir: dir,
    fetchJson: legacyFetchJson(restCalls),
    viewPull,
    graphql,
    concurrency: 2,
  });
  assert.deepEqual(manifest.ok, ['1', '2']);
  // one GraphQL query per PR, no per-PR REST calls (only the shared run list)
  assert.equal(gqlCalls.length, 2);
  assert.equal(gqlCalls[0].variables.number, 1);
  assert.equal(gqlCalls[1].variables.number, 2);
  const perPrRest = restCalls.filter(
    ({ apiPath }) => !apiPath.includes('/actions/workflows/'),
  );
  assert.deepEqual(perPrRest, []);
  assert.equal(restCalls.length, 1);

  for (const pr of ['1', '2']) {
    const comments = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-comments.json`), 'utf8'),
    );
    // bot logins keep the REST `[bot]` suffix consumers match on
    assert.equal(comments[0].user.login, 'github-actions[bot]');
    assert.equal(comments[1].user.login, 'octocat');
    assert.equal(comments[0].created_at, '2026-06-24T10:00:00Z');
    const attempts = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-attempts.json`), 'utf8'),
    );
    assert.equal(attempts.length, 1);
    const reviewComments = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-review-comments.json`), 'utf8'),
    );
    assert.equal(reviewComments.length, 1);
    assert.equal(reviewComments[0].original_commit_id, HEAD_SHA);
    assert.equal(reviewComments[0].commit_id, HEAD_SHA);
    assert.equal(reviewComments[0].user.login, 'kilo-code-bot[bot]');
    const reviews = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-reviews.json`), 'utf8'),
    );
    assert.equal(reviews[0].state, 'COMMENTED');
    assert.equal(reviews[0].commit_id, HEAD_SHA);
    assert.equal(reviews[0].submitted_at, '2026-06-24T11:00:00Z');
    assert.equal(reviews[0].user.login, 'kilo-code-bot[bot]');
    const commits = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-commits.json`), 'utf8'),
    );
    assert.equal(commits[0].sha, HEAD_SHA);
    assert.equal(commits[0].commit.message, 'feat: thing');
    assert.equal(commits[0].commit.committer.date, '2026-06-24T12:00:00Z');
    const statuses = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-statuses.json`), 'utf8'),
    );
    assert.deepEqual(statuses, [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        created_at: '2026-06-24T12:01:00Z',
        updated_at: '2026-06-24T12:01:00Z',
        target_url: null,
        description: null,
      },
    ]);
    const checkRuns = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-check-runs.json`), 'utf8'),
    );
    assert.deepEqual(checkRuns, [
      {
        name: 'Kilo Code Review',
        status: 'completed',
        conclusion: 'success',
        app: { slug: 'kilo-code', name: 'Kilo Code' },
      },
    ]);
    const prJson = JSON.parse(
      fs.readFileSync(path.join(dir, `pr-${pr}-pr.json`), 'utf8'),
    );
    assert.equal(prJson.headCommittedAt, '2026-06-24T12:00:00Z');
    assert.equal(
      fs.readFileSync(path.join(dir, `pr-${pr}-head-sha`), 'utf8'),
      HEAD_SHA,
    );
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('graphql context files drive the real consumers to the expected verdicts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const viewPull = async () => ({
    number: 5,
    headRefOid: HEAD_SHA,
    state: 'OPEN',
    mergedAt: null,
    isDraft: false,
    headRefName: 'feat-y',
    baseRefName: 'main',
    labels: [{ name: 'ai-review-concerns' }],
    isCrossRepository: false,
    files: [{ path: 'src/lib/a.ts', additions: 1, deletions: 0 }],
  });
  await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['5'],
    outDir: dir,
    fetchJson: legacyFetchJson([]),
    viewPull,
    graphql: async () => graphqlPullPayload(),
  });
  const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(dir, `pr-5-${name}.json`), 'utf8'));
  const pr = read('pr');
  const external = evaluateExternalReview({
    pr,
    comments: read('comments'),
    reviewComments: read('review-comments'),
    reviews: read('reviews'),
    checkRuns: read('check-runs'),
    statuses: read('statuses'),
    now: '2026-06-24T12:05:00Z',
  });
  // Kilo inline WARNING on the current head blocks, exactly like REST-sourced data.
  assert.equal(external.state, 'blocked');
  const decision = evaluateAutoCoverReview({
    pr,
    policy: policyJson,
    externalReview: external,
    comments: read('comments'),
    commits: read('commits'),
    attempts: read('attempts'),
    fixReviewRuns: read('fix-review-runs'),
  });
  assert.equal(decision.should_run, true);
  // one recorded attempt is visible through the mapped comment shape
  assert.equal(decision.attempt_count, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('graphql path falls back to REST when a connection page overflows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const payload = graphqlPullPayload({
    comments: { pageInfo: { hasNextPage: true }, nodes: [] },
  });
  const fetchJson = async (apiPath, opts = {}) => {
    restCalls.push({ apiPath, opts });
    if (apiPath.includes('/actions/workflows/fix-review.yml/runs')) {
      return { workflow_runs: [] };
    }
    if (apiPath.includes('/issues/3/comments')) {
      return [{ body: 'rest comment', user: { login: 'octocat' } }];
    }
    if (apiPath.endsWith(`/commits/${HEAD_SHA}`)) {
      return { commit: { committer: { date: '2026-06-24T12:00:00Z' } } };
    }
    if (apiPath.endsWith(`/commits/${HEAD_SHA}/status`))
      return { statuses: [] };
    if (apiPath.endsWith(`/commits/${HEAD_SHA}/check-runs`))
      return { check_runs: [] };
    return [];
  };
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['3'],
    outDir: dir,
    fetchJson,
    viewPull: async () => ({ number: 3, headRefOid: HEAD_SHA, state: 'open' }),
    graphql: async () => payload,
  });
  assert.deepEqual(manifest.ok, ['3']);
  // only the overflowed list is refetched through REST
  const commentCalls = restCalls.filter(({ apiPath }) =>
    apiPath.includes('/issues/3/comments'),
  );
  assert.equal(commentCalls.length, 1);
  assert.deepEqual(commentCalls[0].opts, { paginate: true });
  const reviewCalls = restCalls.filter(({ apiPath }) =>
    apiPath.includes('/pulls/3/'),
  );
  assert.equal(reviewCalls.length, 0);
  const headCalls = restCalls.filter(({ apiPath }) =>
    apiPath.includes(`/commits/${HEAD_SHA}`),
  );
  assert.equal(headCalls.length, 0);
  const comments = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-3-comments.json'), 'utf8'),
  );
  assert.equal(comments[0].body, 'rest comment');
  // non-overflowed lists still come from GraphQL
  const reviews = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-3-reviews.json'), 'utf8'),
  );
  assert.equal(reviews[0].user.login, 'kilo-code-bot[bot]');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('graphql path falls back to the REST head trio when the head SHA moved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const payload = graphqlPullPayload();
  // head commit in the query no longer matches `gh pr view`'s headRefOid
  payload.repository.pullRequest.headCommit.nodes[0].commit.oid = 'movedsha';
  const fetchJson = async (apiPath, opts = {}) => {
    restCalls.push({ apiPath, opts });
    if (apiPath.includes('/actions/workflows/fix-review.yml/runs')) {
      return { workflow_runs: [] };
    }
    if (apiPath.endsWith(`/commits/${HEAD_SHA}`)) {
      return { commit: { committer: { date: '2026-06-24T13:00:00Z' } } };
    }
    if (apiPath.endsWith(`/commits/${HEAD_SHA}/status`)) {
      return { statuses: [{ context: 'ci', state: 'success' }] };
    }
    if (apiPath.endsWith(`/commits/${HEAD_SHA}/check-runs`)) {
      return { check_runs: [{ name: 'rest check', conclusion: 'failure' }] };
    }
    return [];
  };
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['4'],
    outDir: dir,
    fetchJson,
    viewPull: async () => ({ number: 4, headRefOid: HEAD_SHA, state: 'open' }),
    graphql: async () => payload,
  });
  assert.deepEqual(manifest.ok, ['4']);
  const trio = restCalls.filter(({ apiPath }) =>
    apiPath.includes(`/commits/${HEAD_SHA}`),
  );
  assert.equal(trio.length, 3);
  const statuses = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-4-statuses.json'), 'utf8'),
  );
  assert.deepEqual(statuses, [{ context: 'ci', state: 'success' }]);
  const checkRuns = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-4-check-runs.json'), 'utf8'),
  );
  assert.deepEqual(checkRuns, [{ name: 'rest check', conclusion: 'failure' }]);
  const pr = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-4-pr.json'), 'utf8'),
  );
  assert.equal(pr.headCommittedAt, '2026-06-24T13:00:00Z');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('graphql fetch failures isolate per PR like REST failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['20', '21'],
    outDir: dir,
    fetchJson: legacyFetchJson([]),
    viewPull: async (prNumber) => ({
      number: Number(prNumber),
      headRefOid: HEAD_SHA,
      state: 'open',
    }),
    graphql: async (query, variables) => {
      if (variables.number === 21) {
        throw new Error('gh api graphql failed: HTTP 502: Bad Gateway');
      }
      return graphqlPullPayload();
    },
    concurrency: 2,
  });
  assert.deepEqual(manifest.ok, ['20']);
  assert.equal(manifest.failed.length, 1);
  assert.equal(manifest.failed[0].pr, '21');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restLogin restores the REST bot suffix and keeps humans untouched', () => {
  assert.equal(
    restLogin({ login: 'github-actions', __typename: 'Bot' }),
    'github-actions[bot]',
  );
  assert.equal(
    restLogin({ login: 'kilo-code-bot', __typename: 'Bot' }),
    'kilo-code-bot[bot]',
  );
  assert.equal(
    restLogin({ login: 'already[bot]', __typename: 'Bot' }),
    'already[bot]',
  );
  assert.equal(restLogin({ login: 'octocat', __typename: 'User' }), 'octocat');
  assert.equal(restLogin(null), null);
});

test('mapStatuses lowercases GraphQL state enums', () => {
  assert.deepEqual(
    mapStatuses({
      contexts: [{ context: 'ci', state: 'PENDING', createdAt: 'x' }],
    }),
    [
      {
        context: 'ci',
        state: 'pending',
        created_at: 'x',
        updated_at: null,
        target_url: null,
        description: null,
      },
    ],
  );
  assert.deepEqual(mapStatuses(null), []);
});

test('mapCheckRuns flattens suites, lowercases enums and carries the app', () => {
  const mapped = mapCheckRuns([
    {
      app: { slug: 'kilo-code', name: 'Kilo Code' },
      checkRuns: {
        nodes: [
          { name: 'a', status: 'IN_PROGRESS', conclusion: null },
          { name: 'b', status: 'COMPLETED', conclusion: 'FAILURE' },
        ],
      },
    },
    {
      app: null,
      checkRuns: { nodes: [{ name: 'c', status: 'QUEUED', conclusion: null }] },
    },
  ]);
  assert.deepEqual(mapped, [
    {
      name: 'a',
      status: 'in_progress',
      conclusion: null,
      app: { slug: 'kilo-code', name: 'Kilo Code' },
    },
    {
      name: 'b',
      status: 'completed',
      conclusion: 'failure',
      app: { slug: 'kilo-code', name: 'Kilo Code' },
    },
    { name: 'c', status: 'queued', conclusion: null, app: null },
  ]);
  assert.deepEqual(mapCheckRuns([]), []);
});
