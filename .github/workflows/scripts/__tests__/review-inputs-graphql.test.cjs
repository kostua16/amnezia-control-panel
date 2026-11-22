/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_PAGES_PER_CONNECTION,
  ReviewInputsUnavailable,
  fetchReviewInputsGraphql,
} = require('../lib/review-inputs-graphql.cjs');
const { isKiloUser, KILO_MARKER } = require('../lib/kilo.cjs');
const { evaluateExternalReview } = require('../evaluate-external-review.cjs');
const {
  collectExternalReview,
  resolveReviewSource,
} = require('../orchestrate-pr-flow.cjs');

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const KILO_PASSED = `${KILO_MARKER}\n## Code Review Summary\n**No Issues Found**`;
const KILO_BLOCKED = `${KILO_MARKER}\n## Code Review Summary\n**2 Issues Found**`;

const done = { hasNextPage: false, endCursor: null };
const bot = (login) => ({ __typename: 'Bot', login });
const human = (login) => ({ __typename: 'User', login });

function conn(nodes, pageInfo = done) {
  return { nodes, pageInfo };
}

// Mirrors the shape of the real response; `pr` overrides top-level fields.
function response(pr = {}, extra = {}) {
  return {
    data: {
      rateLimit: { cost: 1, remaining: 4999 },
      repository: {
        pullRequest: {
          headRefOid: HEAD,
          commits: {
            nodes: [
              {
                commit: {
                  oid: HEAD,
                  statusCheckRollup: { contexts: conn([]) },
                },
              },
            ],
          },
          comments: conn([]),
          reviews: conn([]),
          reviewThreads: conn([]),
          ...pr,
        },
      },
    },
    ...extra,
  };
}

function summaryComment(author, body, id = 1) {
  return {
    databaseId: id,
    author,
    body,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:05:00Z',
  };
}

function restSummaryComment(login, body, id = 1) {
  return {
    id,
    user: { login },
    body,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:05:00Z',
  };
}

function fetchWith(responses, overrides = {}) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : null;
  const runGraphql = (query, variables) => {
    calls.push(variables);
    return queue ? queue.shift() : responses(query, variables);
  };
  const run = () =>
    fetchReviewInputsGraphql({
      repo: 'owner/repo',
      prNumber: 7,
      headSha: HEAD,
      runGraphql,
      ...overrides,
    });
  return { run, calls };
}

test('Bot authors get the [bot] suffix REST uses, other authors keep their login', () => {
  const { run } = fetchWith([
    response({
      comments: conn([
        summaryComment(bot('kilo-code-bot'), KILO_PASSED, 1),
        summaryComment(human('alice'), 'hi', 2),
        summaryComment(null, 'ghost comment', 3),
        summaryComment(bot('already[bot]'), 'x', 4),
      ]),
    }),
  ]);
  const { comments } = run();
  assert.deepEqual(
    comments.map((c) => c.user?.login ?? null),
    ['kilo-code-bot[bot]', 'alice', null, 'already[bot]'],
  );
  assert.equal(comments[0].user.type, 'Bot');
  assert.equal(isKiloUser(comments[0].user), true);
});

test('a human account named kilo-code-bot is not a trusted Kilo signal', () => {
  const { run } = fetchWith([
    response({
      comments: conn([summaryComment(human('kilo-code-bot'), KILO_PASSED, 1)]),
      reviews: conn([
        {
          databaseId: 5,
          author: human('kilo-code-bot'),
          commit: { oid: HEAD },
          submittedAt: '2026-01-01T10:06:00Z',
          state: 'COMMENTED',
        },
      ]),
      reviewThreads: conn([
        {
          comments: conn([
            {
              databaseId: 9,
              author: human('kilo-code-bot'),
              body: 'issue here',
              commit: { oid: HEAD },
              createdAt: '2026-01-01T10:07:00Z',
              updatedAt: '2026-01-01T10:07:00Z',
            },
          ]),
        },
      ]),
    }),
  ]);
  const inputs = run();
  assert.equal(isKiloUser(inputs.comments[0].user), false);
  const result = evaluateExternalReview({
    pr: { headSha: HEAD },
    ...inputs,
    now: '2026-01-01T10:10:00Z',
  });
  assert.equal(result.state, 'pending');
});

for (const [name, kiloBody, inline, expected, originalCommit] of [
  ['passed', KILO_PASSED, null, 'passed'],
  ['blocked by summary', KILO_BLOCKED, null, 'blocked'],
  ['blocked by inline comment', KILO_PASSED, 'fix this', 'blocked'],
  ['pending without a summary', null, null, 'pending'],
  [
    'ignores remapped old inline comment',
    KILO_PASSED,
    'old finding',
    'passed',
    OTHER,
  ],
  [
    'blocks original head inline comment',
    KILO_PASSED,
    'new finding',
    'blocked',
    HEAD,
  ],
]) {
  test(`GraphQL inputs give the same verdict as REST inputs (${name})`, () => {
    const headReview = {
      databaseId: 10,
      author: bot('kilo-code-bot'),
      commit: { oid: HEAD },
      submittedAt: '2026-01-01T10:01:00Z',
      state: 'COMMENTED',
    };
    const { run } = fetchWith([
      response({
        comments: conn(
          kiloBody ? [summaryComment(bot('kilo-code-bot'), kiloBody)] : [],
        ),
        reviews: conn(kiloBody ? [headReview] : []),
        reviewThreads: conn(
          inline
            ? [
                {
                  comments: conn([
                    {
                      databaseId: 11,
                      author: bot('kilo-code-bot'),
                      body: inline,
                      commit: { oid: HEAD },
                      originalCommit: originalCommit
                        ? { oid: originalCommit }
                        : null,
                      createdAt: '2026-01-01T10:08:00Z',
                      updatedAt: '2026-01-01T10:08:00Z',
                    },
                  ]),
                },
              ]
            : [],
        ),
      }),
    ]);
    const graphqlInputs = run();

    const restInputs = {
      comments: kiloBody
        ? [restSummaryComment('kilo-code-bot[bot]', kiloBody)]
        : [],
      reviewComments: inline
        ? [
            {
              id: 11,
              user: { login: 'kilo-code-bot[bot]' },
              body: inline,
              commit_id: HEAD,
              original_commit_id: originalCommit,
              created_at: '2026-01-01T10:08:00Z',
              updated_at: '2026-01-01T10:08:00Z',
            },
          ]
        : [],
      reviews: kiloBody
        ? [
            {
              id: 10,
              user: { login: 'kilo-code-bot[bot]' },
              commit_id: HEAD,
              submitted_at: '2026-01-01T10:01:00Z',
              state: 'COMMENTED',
            },
          ]
        : [],
      checkRuns: [],
      statuses: [],
    };
    const args = { pr: { headSha: HEAD }, now: '2026-01-01T10:10:00Z' };
    const viaGraphql = evaluateExternalReview({ ...args, ...graphqlInputs });
    const viaRest = evaluateExternalReview({ ...args, ...restInputs });
    assert.equal(viaRest.state, expected);
    assert.deepEqual(viaGraphql, viaRest);
  });
}

test('review comments are read from every thread, resolved or outdated, with the commit they were made on', () => {
  const { run } = fetchWith([
    response({
      reviewThreads: conn([
        {
          comments: conn([
            {
              databaseId: 1,
              author: bot('kilo-code-bot'),
              body: 'a',
              commit: { oid: OTHER },
              createdAt: '2026-01-01T10:00:00Z',
              updatedAt: '2026-01-01T10:00:00Z',
            },
            {
              databaseId: 2,
              author: human('bob'),
              body: 'reply',
              commit: null,
              createdAt: '2026-01-01T10:01:00Z',
              updatedAt: '2026-01-01T10:01:00Z',
            },
          ]),
        },
        {
          comments: conn([
            {
              databaseId: 3,
              author: bot('kilo-code-bot'),
              body: 'b',
              commit: { oid: HEAD },
              createdAt: '2026-01-01T10:02:00Z',
              updatedAt: '2026-01-01T10:02:00Z',
            },
          ]),
        },
      ]),
    }),
  ]);
  const { reviewComments } = run();
  assert.deepEqual(
    reviewComments.map((c) => [c.id, c.commit_id]),
    [
      [1, OTHER],
      [2, null],
      [3, HEAD],
    ],
  );
});

test('reviews carry only the REST fields the evaluator orders by', () => {
  const { run } = fetchWith([
    response({
      reviews: conn([
        {
          databaseId: 1,
          author: bot('kilo-code-bot'),
          commit: null,
          submittedAt: null,
          state: 'PENDING',
          updatedAt: '2030-01-01T00:00:00Z',
        },
      ]),
    }),
  ]);
  const [review] = run().reviews;
  assert.deepEqual(Object.keys(review).sort(), [
    'commit_id',
    'id',
    'state',
    'submitted_at',
    'user',
  ]);
  assert.equal(review.commit_id, null);
  assert.equal(review.submitted_at, null);
});

test('check runs and statuses are mapped to the REST casing and nesting', () => {
  const { run } = fetchWith([
    response({
      commits: {
        nodes: [
          {
            commit: {
              oid: HEAD,
              statusCheckRollup: {
                contexts: conn([
                  {
                    __typename: 'CheckRun',
                    name: 'Kilo Code Review',
                    conclusion: 'CANCELLED',
                    checkSuite: {
                      app: { slug: 'kilo', name: 'Kilo' },
                    },
                  },
                  {
                    __typename: 'CheckRun',
                    name: 'in-flight',
                    conclusion: null,
                    checkSuite: null,
                  },
                  {
                    __typename: 'StatusContext',
                    context: 'pr-flow/kilo-review',
                    state: 'PENDING',
                    description: 'waiting',
                    targetUrl: null,
                    createdAt: '2026-01-01T10:00:00Z',
                  },
                ]),
              },
            },
          },
        ],
      },
    }),
  ]);
  const { checkRuns, statuses } = run();
  // No `workflow_name`: the REST check-runs response carries none, and
  // `isKiloCheck` matches it — mapping it would classify checks as Kilo on
  // the GraphQL path only.
  assert.deepEqual(checkRuns, [
    {
      name: 'Kilo Code Review',
      conclusion: 'cancelled',
      app: { slug: 'kilo', name: 'Kilo' },
    },
    { name: 'in-flight', conclusion: null, app: null },
  ]);
  assert.deepEqual(statuses, [
    {
      context: 'pr-flow/kilo-review',
      state: 'pending',
      description: 'waiting',
      target_url: null,
      created_at: '2026-01-01T10:00:00Z',
    },
  ]);
});

test('a rollup context type the mapper does not know throws instead of being dropped', () => {
  const { run } = fetchWith([
    response({
      commits: {
        nodes: [
          {
            commit: {
              oid: HEAD,
              statusCheckRollup: {
                contexts: conn([{ __typename: 'SomethingNew' }]),
              },
            },
          },
        ],
      },
    }),
  ]);
  assert.throws(run, (error) => {
    assert.ok(error instanceof ReviewInputsUnavailable);
    assert.match(error.message, /SomethingNew/);
    return true;
  });
});

test('a head commit without a status rollup yields empty checks instead of a fallback', () => {
  const { run } = fetchWith([
    response({
      commits: {
        nodes: [{ commit: { oid: HEAD, statusCheckRollup: null } }],
      },
    }),
  ]);
  const inputs = run();
  assert.deepEqual(inputs.checkRuns, []);
  assert.deepEqual(inputs.statuses, []);
});

test('pagination follows cursors and only re-requests connections that have more pages', () => {
  const page = (id, next) =>
    conn(
      [summaryComment(human('alice'), `c${id}`, id)],
      next
        ? { hasNextPage: true, endCursor: `cursor-${id}` }
        : { hasNextPage: false, endCursor: null },
    );
  const { run, calls } = fetchWith([
    response({
      comments: page(1, true),
      reviews: conn([
        {
          databaseId: 7,
          author: human('alice'),
          commit: { oid: HEAD },
          submittedAt: '2026-01-01T10:00:00Z',
          state: 'COMMENTED',
        },
      ]),
    }),
    response({ comments: page(2, true) }),
    response({ comments: page(3, false) }),
  ]);
  const inputs = run();
  assert.deepEqual(
    inputs.comments.map((c) => c.id),
    [1, 2, 3],
  );
  assert.equal(inputs.reviews.length, 1);
  assert.equal(inputs.cost, 3);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].commentsAfter, 'cursor-1');
  assert.equal(calls[2].commentsAfter, 'cursor-2');
  assert.equal(calls[1].wantComments, true);
  assert.equal(calls[1].wantReviews, false);
  assert.equal(calls[1].wantThreads, false);
  assert.equal(calls[1].wantContexts, false);
});

test('contexts pagination follows its own cursor across pages', () => {
  const checkRun = (n) => ({
    __typename: 'CheckRun',
    name: `check-${n}`,
    conclusion: 'SUCCESS',
    checkSuite: { app: null },
  });
  const ctxPage = (n, next) =>
    conn(
      [checkRun(n)],
      next ? { hasNextPage: true, endCursor: `ctx-${n}` } : done,
    );
  const rollup = (contexts) => ({
    commits: {
      nodes: [{ commit: { oid: HEAD, statusCheckRollup: { contexts } } }],
    },
  });
  const { run, calls } = fetchWith([
    response(rollup(ctxPage(1, true))),
    response(rollup(ctxPage(2, true))),
    response(rollup(ctxPage(3, false))),
  ]);
  const { checkRuns } = run();
  assert.deepEqual(
    checkRuns.map((c) => c.name),
    ['check-1', 'check-2', 'check-3'],
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[1].contextsAfter, 'ctx-1');
  assert.equal(calls[2].contextsAfter, 'ctx-2');
  assert.equal(calls[1].wantContexts, true);
  assert.equal(calls[1].wantComments, false);
  assert.equal(calls[1].wantReviews, false);
  assert.equal(calls[1].wantThreads, false);
});

test('reviewThreads pagination follows its own cursor across pages', () => {
  const thread = (id) => ({
    comments: conn([
      {
        databaseId: id,
        author: bot('kilo-code-bot'),
        body: `thread-${id}`,
        commit: { oid: HEAD },
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:00:00Z',
      },
    ]),
  });
  const threadPage = (ids, next) =>
    conn(
      ids.map(thread),
      next ? { hasNextPage: true, endCursor: `th-${ids[0]}` } : done,
    );
  const { run, calls } = fetchWith([
    response({ reviewThreads: threadPage([1, 2], true) }),
    response({ reviewThreads: threadPage([3], false) }),
  ]);
  const { reviewComments } = run();
  assert.deepEqual(
    reviewComments.map((c) => c.id),
    [1, 2, 3],
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].threadsAfter, 'th-1');
  assert.equal(calls[1].wantThreads, true);
  assert.equal(calls[1].wantComments, false);
  assert.equal(calls[1].wantReviews, false);
  assert.equal(calls[1].wantContexts, false);
});

test('more pages than the cap throws so the caller reads REST', () => {
  const endless = response({
    comments: conn([summaryComment(human('alice'), 'x')], {
      hasNextPage: true,
      endCursor: 'more',
    }),
  });
  const { run, calls } = fetchWith(() => endless);
  assert.throws(run, ReviewInputsUnavailable);
  assert.equal(calls.length, MAX_PAGES_PER_CONNECTION);
});

test('a review thread with more comments than one page throws', () => {
  const { run } = fetchWith([
    response({
      reviewThreads: conn([
        {
          comments: conn([], { hasNextPage: true, endCursor: 'x' }),
        },
      ]),
    }),
  ]);
  assert.throws(run, ReviewInputsUnavailable);
});

test('a GraphQL errors array throws even when data is present', () => {
  const { run } = fetchWith([
    response({}, { errors: [{ message: 'Something went wrong' }] }),
  ]);
  assert.throws(run, (error) => {
    assert.ok(error instanceof ReviewInputsUnavailable);
    assert.match(error.message, /Something went wrong/);
    return true;
  });
});

test('a failing GraphQL request is reported as unavailable', () => {
  const { run } = fetchWith(() => {
    throw new Error('gh exited with code 1');
  });
  assert.throws(run, ReviewInputsUnavailable);
});

test('a head that moved away from the evaluated sha throws', () => {
  const moved = fetchWith([response({ headRefOid: OTHER })]);
  assert.throws(moved.run, ReviewInputsUnavailable);

  const lastCommitMoved = fetchWith([
    response({
      commits: { nodes: [{ commit: { oid: OTHER, statusCheckRollup: null } }] },
    }),
  ]);
  assert.throws(lastCommitMoved.run, ReviewInputsUnavailable);
});

test('a head that moves between pages throws', () => {
  const { run } = fetchWith([
    response({
      comments: conn([], { hasNextPage: true, endCursor: 'c' }),
    }),
    response({ headRefOid: OTHER }),
  ]);
  assert.throws(run, ReviewInputsUnavailable);
});

test('a missing structural field throws', () => {
  const noPr = fetchWith([{ data: { repository: { pullRequest: null } } }]);
  assert.throws(noPr.run, ReviewInputsUnavailable);

  const noOid = fetchWith([response({ headRefOid: undefined })]);
  assert.throws(noOid.run, ReviewInputsUnavailable);

  const noPageInfo = fetchWith([
    response({ comments: { nodes: [], pageInfo: null } }),
  ]);
  assert.throws(noPageInfo.run, ReviewInputsUnavailable);

  const noNodes = fetchWith([response({ reviews: { pageInfo: done } })]);
  assert.throws(noNodes.run, ReviewInputsUnavailable);

  const notObject = fetchWith([null]);
  assert.throws(notObject.run, ReviewInputsUnavailable);
});

test('invalid arguments throw instead of querying', () => {
  const cases = [
    { headSha: '' },
    { repo: 'owner/repo/extra' },
    { repo: 'owner/' },
    { repo: 'justowner' },
    { repo: null },
    { prNumber: null },
    { prNumber: '' },
    { prNumber: 0 },
    { prNumber: -3 },
    { prNumber: 7.5 },
  ];
  for (const overrides of cases) {
    const { run, calls } = fetchWith([response()], overrides);
    assert.throws(run, ReviewInputsUnavailable, JSON.stringify(overrides));
    assert.equal(calls.length, 0, JSON.stringify(overrides));
  }
});

test('collectExternalReview uses GraphQL inputs when the source is graphql', () => {
  const calls = [];
  const result = collectExternalReview(
    { number: 7, headSha: HEAD },
    {
      source: 'graphql',
      loadGraphql: () => {
        calls.push('graphql');
        return { comments: [], reviewComments: [], reviews: [] };
      },
      loadRest: () => {
        calls.push('rest');
        return {};
      },
      evaluate: (args) => args,
    },
  );
  assert.deepEqual(calls, ['graphql']);
  assert.deepEqual(result.comments, []);
});

test('collectExternalReview reads REST for the wake when the GraphQL adapter throws', () => {
  const calls = [];
  const restInputs = { comments: [{ id: 1 }], statuses: [] };
  const result = collectExternalReview(
    { number: 7, headSha: HEAD },
    {
      source: 'graphql',
      loadGraphql: () => {
        calls.push('graphql');
        throw new ReviewInputsUnavailable('truncated');
      },
      loadRest: () => {
        calls.push('rest');
        return restInputs;
      },
      evaluate: (args) => args,
    },
  );
  assert.deepEqual(calls, ['graphql', 'rest']);
  assert.equal(result.comments, restInputs.comments);
});

test('collectExternalReview never touches GraphQL when the source is rest', () => {
  const calls = [];
  collectExternalReview(
    { number: 7, headSha: HEAD },
    {
      source: 'rest',
      loadGraphql: () => {
        calls.push('graphql');
        return {};
      },
      loadRest: () => {
        calls.push('rest');
        return {};
      },
      evaluate: () => ({}),
    },
  );
  assert.deepEqual(calls, ['rest']);
});

test('an unexpected GraphQL failure still lets REST errors surface unchanged', () => {
  assert.throws(
    () =>
      collectExternalReview(
        { number: 7, headSha: HEAD },
        {
          source: 'graphql',
          loadGraphql: () => {
            throw new Error('boom');
          },
          loadRest: () => {
            throw new Error('rest is down too');
          },
          evaluate: () => ({}),
        },
      ),
    /rest is down too/,
  );
});

test('resolveReviewSource accepts graphql and rest, defaults when empty, and treats typos as rest', () => {
  assert.equal(resolveReviewSource('graphql'), 'graphql');
  assert.equal(resolveReviewSource(' REST '), 'rest');
  assert.equal(resolveReviewSource('grapql'), 'rest');
  assert.equal(resolveReviewSource(''), 'graphql');
  assert.equal(resolveReviewSource(undefined), 'graphql');
});
