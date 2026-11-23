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
  fetchPrCommitsGraphql,
  mapCommits,
  resolveAutoCoverSource,
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
    source: 'rest',
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
    source: 'rest',
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
    source: 'rest',
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
      source: 'rest',
      fetchJson,
      viewPull,
    }),
    /rate limit/i,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// GraphQL context path: the shared lib/review-inputs-graphql.cjs adapter plus
// the Auto Cover commits query replace the seven per-PR REST calls. The
// written files keep the REST shapes; GraphQL doubt falls back to REST per PR
// and never silently becomes an empty context.
// ---------------------------------------------------------------------------

const HEAD_SHA = 'headsha';
const PAGE_INFO_DONE = { hasNextPage: false, endCursor: null };

function viewPullHead(headRefOid = HEAD_SHA) {
  return async (prNumber) => ({
    number: Number(prNumber),
    headRefOid,
    state: 'OPEN',
    mergedAt: null,
    isDraft: false,
    headRefName: 'feat-x',
    baseRefName: 'main',
    labels: [{ name: 'ai-review-concerns' }],
    isCrossRepository: false,
    files: [{ path: 'src/lib/a.ts', additions: 1, deletions: 0 }],
  });
}

// Envelope shaped exactly like lib/review-inputs-graphql.cjs expects from
// `gh api graphql` (its REVIEW_INPUTS_QUERY selection set).
function reviewInputsResponse(overrides = {}) {
  const pr = {
    headRefOid: HEAD_SHA,
    commits: {
      nodes: [
        {
          commit: {
            oid: HEAD_SHA,
            statusCheckRollup: {
              contexts: {
                nodes: [
                  {
                    __typename: 'CheckRun',
                    name: 'Kilo Code Review',
                    conclusion: 'SUCCESS',
                    checkSuite: {
                      app: { slug: 'kilo-code', name: 'Kilo Code' },
                    },
                  },
                  {
                    __typename: 'StatusContext',
                    context: 'pr-flow/kilo-review',
                    state: 'PENDING',
                    description: null,
                    targetUrl: null,
                    createdAt: '2026-06-24T12:01:00Z',
                  },
                ],
                pageInfo: PAGE_INFO_DONE,
              },
            },
          },
        },
      ],
    },
    comments: {
      nodes: [
        {
          databaseId: 101,
          author: { __typename: 'Bot', login: 'github-actions' },
          body: `${AUTO_COVER_MARKER}\ndispatched`,
          createdAt: '2026-06-24T10:00:00Z',
          updatedAt: '2026-06-24T10:00:00Z',
        },
        {
          databaseId: 102,
          author: { __typename: 'User', login: 'octocat' },
          body: 'human note',
          createdAt: '2026-06-24T10:05:00Z',
          updatedAt: '2026-06-24T10:05:00Z',
        },
      ],
      pageInfo: PAGE_INFO_DONE,
    },
    reviews: {
      nodes: [
        {
          databaseId: 11,
          author: { __typename: 'Bot', login: 'kilo-code-bot' },
          commit: { oid: HEAD_SHA },
          submittedAt: '2026-06-24T11:00:00Z',
          state: 'COMMENTED',
        },
      ],
      pageInfo: PAGE_INFO_DONE,
    },
    reviewThreads: {
      nodes: [
        {
          comments: {
            nodes: [
              {
                databaseId: 201,
                author: { __typename: 'Bot', login: 'kilo-code-bot' },
                body: '**WARNING:** missing guard',
                commit: { oid: HEAD_SHA },
                originalCommit: { oid: HEAD_SHA },
                createdAt: '2026-06-24T11:00:00Z',
                updatedAt: '2026-06-24T11:00:00Z',
              },
            ],
            pageInfo: PAGE_INFO_DONE,
          },
        },
      ],
      pageInfo: PAGE_INFO_DONE,
    },
    ...overrides,
  };
  return {
    data: {
      rateLimit: { cost: 1, remaining: 4999 },
      repository: { pullRequest: pr },
    },
  };
}

function commitsResponse(
  nodes = [
    {
      commit: {
        oid: HEAD_SHA,
        message: 'feat: thing',
        authoredDate: '2026-06-24T11:59:00Z',
        committedDate: '2026-06-24T12:00:00Z',
      },
    },
  ],
  pageInfo = PAGE_INFO_DONE,
) {
  return {
    data: { repository: { pullRequest: { commits: { nodes, pageInfo } } } },
  };
}

// Synchronous fake for the shared gh transport, dispatching on the operation.
function fakeRunGraphql({
  reviewInputs = reviewInputsResponse(),
  commits = commitsResponse(),
  recorder = null,
} = {}) {
  return (query, variables) => {
    if (recorder) recorder.push({ query, variables });
    const resolve = (value) => {
      if (value instanceof Error) throw value;
      if (typeof value === 'function') return value(variables);
      return value;
    };
    if (String(query).includes('AutoCoverPrCommits')) return resolve(commits);
    return resolve(reviewInputs);
  };
}

// Legacy REST fake covering every endpoint the all-REST path (and the GraphQL
// fallbacks) read, recording each call for quota assertions.
function legacyFetchJson(recorder) {
  return async (apiPath, opts = {}) => {
    recorder.push({ apiPath, opts });
    if (apiPath.includes('/actions/workflows/fix-review.yml/runs')) {
      return { workflow_runs: [] };
    }
    const headMatch = apiPath.match(
      /\/commits\/([^/]+?)(\/status|\/check-runs)?$/,
    );
    if (headMatch) {
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
    if (apiPath.includes('/issues/') && apiPath.includes('/comments'))
      return [{ body: 'rest comment', user: { login: 'octocat' } }];
    if (apiPath.includes('/pulls/') && apiPath.includes('/comments'))
      return [{ body: 'rest review comment' }];
    if (apiPath.includes('/reviews')) return [{ body: 'rest review' }];
    if (apiPath.includes('/commits'))
      return [{ sha: 'restsha', commit: { message: 'fix(review): via REST' } }];
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
    source: 'rest',
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

test('graphql path: lib query + commits query per PR, zero per-PR REST calls, REST-shaped files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const gqlCalls = [];
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['1', '2'],
    outDir: dir,
    source: 'graphql',
    fetchJson: legacyFetchJson(restCalls),
    viewPull: viewPullHead(),
    runGraphql: fakeRunGraphql({ recorder: gqlCalls }),
    concurrency: 2,
  });
  assert.deepEqual(manifest.ok, ['1', '2']);
  // 2 GraphQL requests per PR (shared review-inputs query + commits query),
  // and the only REST call in the whole scan is the shared fix-review run list.
  assert.equal(gqlCalls.length, 4);
  assert.equal(restCalls.length, 1);
  assert.ok(restCalls[0].apiPath.includes('/actions/workflows/'));
  const inputsNumbers = gqlCalls
    .filter(({ query }) => !String(query).includes('AutoCoverPrCommits'))
    .map(({ variables }) => variables.number)
    .sort();
  assert.deepEqual(inputsNumbers, [1, 2]);

  for (const pr of ['1', '2']) {
    const read = (name) =>
      JSON.parse(
        fs.readFileSync(path.join(dir, `pr-${pr}-${name}.json`), 'utf8'),
      );
    const comments = read('comments');
    // REST ids kept, bot logins keep the `[bot]` suffix consumers match on
    assert.equal(comments[0].id, 101);
    assert.equal(comments[0].user.login, 'github-actions[bot]');
    assert.equal(comments[1].user.login, 'octocat');
    assert.equal(comments[0].created_at, '2026-06-24T10:00:00Z');
    assert.equal(read('attempts').length, 1);
    const reviewComments = read('review-comments');
    assert.equal(reviewComments.length, 1);
    assert.equal(reviewComments[0].id, 201);
    assert.equal(reviewComments[0].original_commit_id, HEAD_SHA);
    assert.equal(reviewComments[0].commit_id, HEAD_SHA);
    assert.equal(reviewComments[0].user.login, 'kilo-code-bot[bot]');
    const reviews = read('reviews');
    assert.equal(reviews[0].id, 11);
    assert.equal(reviews[0].state, 'COMMENTED');
    assert.equal(reviews[0].commit_id, HEAD_SHA);
    assert.equal(reviews[0].submitted_at, '2026-06-24T11:00:00Z');
    assert.equal(reviews[0].user.login, 'kilo-code-bot[bot]');
    const commits = read('commits');
    assert.equal(commits[0].sha, HEAD_SHA);
    assert.equal(commits[0].commit.message, 'feat: thing');
    assert.equal(commits[0].commit.committer.date, '2026-06-24T12:00:00Z');
    assert.deepEqual(read('statuses'), [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        description: null,
        target_url: null,
        created_at: '2026-06-24T12:01:00Z',
      },
    ]);
    assert.deepEqual(read('check-runs'), [
      {
        name: 'Kilo Code Review',
        conclusion: 'success',
        app: { slug: 'kilo-code', name: 'Kilo Code' },
      },
    ]);
    assert.equal(read('pr').headCommittedAt, '2026-06-24T12:00:00Z');
    assert.equal(
      fs.readFileSync(path.join(dir, `pr-${pr}-head-sha`), 'utf8'),
      HEAD_SHA,
    );
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('graphql context files drive the real consumers to the expected verdicts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['5'],
    outDir: dir,
    source: 'graphql',
    fetchJson: legacyFetchJson([]),
    viewPull: viewPullHead(),
    runGraphql: fakeRunGraphql(),
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
  // Kilo inline WARNING on the current head blocks, exactly like REST data.
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

test('a 200 response carrying GraphQL errors falls back to REST, never empty context', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['6'],
    outDir: dir,
    source: 'graphql',
    fetchJson: legacyFetchJson(restCalls),
    viewPull: viewPullHead(),
    runGraphql: fakeRunGraphql({
      reviewInputs: {
        data: { repository: { pullRequest: { comments: { nodes: [] } } } },
        errors: [{ message: 'Something broke server-side' }],
      },
    }),
  });
  assert.deepEqual(manifest.ok, ['6']);
  // The lib rejected the errored payload, so the whole PR context came from
  // REST: 7 per-PR REST calls + the shared run list.
  const perPr = restCalls.filter(
    ({ apiPath }) => !apiPath.includes('/actions/workflows/'),
  );
  assert.equal(perPr.length, 7);
  const comments = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-6-comments.json'), 'utf8'),
  );
  assert.equal(comments[0].body, 'rest comment');
  const statuses = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-6-statuses.json'), 'utf8'),
  );
  assert.deepEqual(statuses, [
    { context: 'pr-flow/kilo-review', state: 'pending' },
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('errors plus a failing REST fallback abort loudly instead of writing empty context', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const fetchJson = async (apiPath) => {
    if (apiPath.includes('/actions/workflows/fix-review.yml/runs')) {
      return { workflow_runs: [] };
    }
    throw new Error('gh api failed: gh: HTTP 403: rate limit exceeded');
  };
  // Every PR failing is a systemic failure: the scan aborts loudly (retry
  // next cycle) and no silently-empty context file is written.
  await assert.rejects(
    fetchAutoCoverContext({
      repo: 'owner/repo',
      prs: ['7'],
      outDir: dir,
      source: 'graphql',
      fetchJson,
      viewPull: viewPullHead(),
      runGraphql: fakeRunGraphql({
        reviewInputs: { data: null, errors: [{ message: 'abuse detection' }] },
      }),
    }),
    /rate limit/i,
  );
  assert.ok(!fs.existsSync(path.join(dir, 'pr-7-head-sha')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a GraphQL transport failure isolates per PR when REST still works', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['20', '21'],
    outDir: dir,
    source: 'graphql',
    fetchJson: legacyFetchJson(restCalls),
    viewPull: async (prNumber) => ({
      number: Number(prNumber),
      headRefOid: HEAD_SHA,
      state: 'open',
    }),
    runGraphql: (query, variables) => {
      if (variables.number === 21) {
        throw new Error('gh api graphql failed: HTTP 502: Bad Gateway');
      }
      return fakeRunGraphql()(query, variables);
    },
    concurrency: 2,
  });
  // PR 21's GraphQL transport failed but REST worked, so it is still ok —
  // served from the REST fallback (7 per-PR REST calls), while PR 20 stayed
  // on GraphQL.
  assert.deepEqual(manifest.ok, ['20', '21']);
  const perPr = restCalls.filter(
    ({ apiPath }) => !apiPath.includes('/actions/workflows/'),
  );
  assert.equal(perPr.length, 7);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a null pullRequest (deleted/unknown PR) falls back to REST instead of empty files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['8'],
    outDir: dir,
    source: 'graphql',
    fetchJson: legacyFetchJson(restCalls),
    viewPull: viewPullHead(),
    runGraphql: fakeRunGraphql({
      reviewInputs: { data: { repository: { pullRequest: null } } },
    }),
  });
  assert.deepEqual(manifest.ok, ['8']);
  const perPr = restCalls.filter(
    ({ apiPath }) => !apiPath.includes('/actions/workflows/'),
  );
  assert.equal(perPr.length, 7);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a head SHA that moved between view and query falls back to REST', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['9'],
    outDir: dir,
    source: 'graphql',
    fetchJson: legacyFetchJson(restCalls),
    // gh pr view reports a NEWER head than the (stale) GraphQL envelope
    viewPull: viewPullHead('movedsha'),
    runGraphql: fakeRunGraphql(),
  });
  assert.deepEqual(manifest.ok, ['9']);
  const perPr = restCalls.filter(
    ({ apiPath }) => !apiPath.includes('/actions/workflows/'),
  );
  assert.equal(perPr.length, 7);
  assert.ok(
    perPr.some(({ apiPath }) => apiPath.endsWith('/commits/movedsha')),
    'REST head lookup should target the moved head SHA',
  );
  assert.equal(
    fs.readFileSync(path.join(dir, 'pr-9-head-sha'), 'utf8'),
    'movedsha',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failing commits query only refetches commits via REST', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['12'],
    outDir: dir,
    source: 'graphql',
    fetchJson: legacyFetchJson(restCalls),
    viewPull: viewPullHead(),
    runGraphql: fakeRunGraphql({
      commits: { data: null, errors: [{ message: 'commits blew up' }] },
    }),
  });
  assert.deepEqual(manifest.ok, ['12']);
  const perPr = restCalls.filter(
    ({ apiPath }) => !apiPath.includes('/actions/workflows/'),
  );
  // narrow fallback: commits list + head commit date only, not the comment
  // lists (those came from GraphQL)
  assert.deepEqual(
    perPr.map(({ apiPath }) => apiPath),
    [
      `repos/owner/repo/pulls/12/commits`,
      `repos/owner/repo/commits/${HEAD_SHA}`,
    ],
  );
  assert.deepEqual(perPr[0].opts, { paginate: true });
  const commits = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-12-commits.json'), 'utf8'),
  );
  assert.equal(commits[0].commit.message, 'fix(review): via REST');
  const comments = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-12-comments.json'), 'utf8'),
  );
  assert.equal(comments[0].user.login, 'github-actions[bot]');
  const pr = JSON.parse(
    fs.readFileSync(path.join(dir, 'pr-12-pr.json'), 'utf8'),
  );
  assert.equal(pr.headCommittedAt, '2026-06-24T12:00:00Z');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('commits pagination overflow beyond the page cap falls back to REST commits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const gqlCalls = [];
  let pages = 0;
  const manifest = await fetchAutoCoverContext({
    repo: 'owner/repo',
    prs: ['13'],
    outDir: dir,
    source: 'graphql',
    fetchJson: legacyFetchJson(restCalls),
    viewPull: viewPullHead(),
    runGraphql: fakeRunGraphql({
      recorder: gqlCalls,
      commits: () => {
        pages += 1;
        return commitsResponse(
          [
            {
              commit: {
                oid: `sha-${pages}`,
                message: 'chore: page',
                authoredDate: '2026-06-24T11:00:00Z',
                committedDate: '2026-06-24T11:00:00Z',
              },
            },
          ],
          { hasNextPage: true, endCursor: `cursor-${pages}` },
        );
      },
    }),
  });
  assert.deepEqual(manifest.ok, ['13']);
  // 1 review-inputs query + MAX_PAGES_PER_CONNECTION commits pages, then REST
  const commitsQueries = gqlCalls.filter(({ query }) =>
    String(query).includes('AutoCoverPrCommits'),
  );
  assert.equal(commitsQueries.length, 10);
  const perPr = restCalls.filter(
    ({ apiPath }) => !apiPath.includes('/actions/workflows/'),
  );
  assert.deepEqual(
    perPr.map(({ apiPath }) => apiPath),
    [
      `repos/owner/repo/pulls/13/commits`,
      `repos/owner/repo/commits/${HEAD_SHA}`,
    ],
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PR_FLOW_AUTO_COVER_SOURCE=rest keeps production on the legacy REST path', async () => {
  assert.equal(resolveAutoCoverSource(''), 'graphql');
  assert.equal(resolveAutoCoverSource(undefined), 'graphql');
  assert.equal(resolveAutoCoverSource('rest'), 'rest');
  assert.equal(resolveAutoCoverSource('GRAPHQL'), 'graphql');
  // a typo must never silently keep the newer path
  assert.equal(resolveAutoCoverSource('graphgl'), 'rest');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-ctx-'));
  const restCalls = [];
  const prev = process.env.PR_FLOW_AUTO_COVER_SOURCE;
  process.env.PR_FLOW_AUTO_COVER_SOURCE = 'rest';
  try {
    const manifest = await fetchAutoCoverContext({
      repo: 'owner/repo',
      prs: ['14'],
      outDir: dir,
      // no explicit source: the env toggle must select REST
      fetchJson: legacyFetchJson(restCalls),
      viewPull: viewPullHead(),
      runGraphql: () => {
        throw new Error('GraphQL must not be called with source=rest');
      },
    });
    assert.deepEqual(manifest.ok, ['14']);
    const perPr = restCalls.filter(
      ({ apiPath }) => !apiPath.includes('/actions/workflows/'),
    );
    assert.equal(perPr.length, 7);
  } finally {
    if (prev === undefined) delete process.env.PR_FLOW_AUTO_COVER_SOURCE;
    else process.env.PR_FLOW_AUTO_COVER_SOURCE = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetchPrCommitsGraphql validates repo/prNumber and rejects errored payloads', () => {
  const neverCalled = () => {
    throw new Error('must not reach gh');
  };
  assert.throws(
    () =>
      fetchPrCommitsGraphql({
        runGraphql: neverCalled,
        repo: 'bad-repo-slug',
        prNumber: '1',
      }),
    /owner\/name/,
  );
  assert.throws(
    () =>
      fetchPrCommitsGraphql({
        runGraphql: neverCalled,
        repo: 'owner/repo',
        prNumber: '0',
      }),
    /positive integer/,
  );
  assert.throws(
    () =>
      fetchPrCommitsGraphql({
        runGraphql: () => ({ data: {}, errors: [{ message: 'nope' }] }),
        repo: 'owner/repo',
        prNumber: '1',
      }),
    /GraphQL returned errors: nope/,
  );
  assert.throws(
    () =>
      fetchPrCommitsGraphql({
        runGraphql: () => ({ data: { repository: { pullRequest: null } } }),
        repo: 'owner/repo',
        prNumber: '1',
      }),
    /missing the commits connection/,
  );
  // happy path returns the raw nodes
  const nodes = fetchPrCommitsGraphql({
    runGraphql: () =>
      commitsResponse().data.repository.pullRequest ? commitsResponse() : null,
    repo: 'owner/repo',
    prNumber: '1',
  });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].commit.oid, HEAD_SHA);
});

test('mapCommits rebuilds the REST pulls/commits item shape', () => {
  assert.deepEqual(
    mapCommits([
      {
        commit: {
          oid: 'abc',
          message: 'fix(review): x',
          authoredDate: 'a-date',
          committedDate: 'c-date',
        },
      },
    ]),
    [
      {
        sha: 'abc',
        commit: {
          message: 'fix(review): x',
          author: { date: 'a-date' },
          committer: { date: 'c-date' },
        },
      },
    ],
  );
  assert.deepEqual(mapCommits([]), []);
});
