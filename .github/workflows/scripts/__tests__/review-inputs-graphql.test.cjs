/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_PAGES_PER_CONNECTION,
  REVIEW_INPUTS_QUERY,
  ReviewInputsUnavailable,
  fetchReviewInputsGraphql,
} = require('../lib/review-inputs-graphql.cjs');
const { isKiloUser, KILO_LOGINS, KILO_MARKER } = require('../lib/kilo.cjs');
const { findExistingComment } = require('../lib/sticky-comment.cjs');
const { evaluateExternalReview } = require('../evaluate-external-review.cjs');
const { normalizeInputs } = require('../compare-review-input-sources.cjs');
const {
  collectExternalReview,
  headCommittedAtFromCommits,
  readPublishSnapshot,
  resolveHeadCommittedAt,
  resolveReviewSource,
} = require('../orchestrate-pr-flow.cjs');

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const KILO_PASSED = `${KILO_MARKER}\n## Code Review Summary\n**No Issues Found**`;
const KILO_BLOCKED = `${KILO_MARKER}\n## Code Review Summary\n**2 Issues Found**`;
// Real suggestions-only Kilo summary (PR #1181) with its history section.
const KILO_SUGGESTIONS =
  require('./fixtures/kilo-sticky-comment-revisions.json').revisions.find(
    (rev) => rev.index === 5,
  ).body;

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

test('the review-thread query requests the original inline comment commit', () => {
  assert.match(
    REVIEW_INPUTS_QUERY,
    /reviewThreads\([^)]*\)[\s\S]*?comments\([^)]*\)\s*\{\s*nodes\s*\{[^\n]*originalCommit\s*\{\s*oid\s*\}/,
  );
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
  [
    'suggestions-only summary and suggestion inline pass',
    KILO_SUGGESTIONS,
    '**SUGGESTION:** rename',
    'passed',
    HEAD,
  ],
  [
    'suggestions-only summary with a warning inline blocks',
    KILO_SUGGESTIONS,
    '**WARNING:** guard',
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
    const normalizedRest = normalizeInputs(restInputs);
    const normalizedGraphql = normalizeInputs(graphqlInputs);
    assert.deepEqual(
      normalizedGraphql.reviewComments,
      normalizedRest.reviewComments,
    );
    if (inline) {
      assert.equal(
        normalizedGraphql.reviewComments[0].original_commit_id,
        originalCommit ?? null,
      );
    }
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

test('an issue comment without a usable databaseId makes the read unavailable', () => {
  // The sticky-comment update/delete address a comment by this id; a null would
  // become `DELETE issues/comments/null`.
  for (const databaseId of [null, undefined, 0, -4, 1.5, '12']) {
    const { run } = fetchWith([
      response({
        comments: conn([{ ...summaryComment(bot('x'), 'hi', 1), databaseId }]),
      }),
    ]);
    assert.throws(run, ReviewInputsUnavailable, String(databaseId));
  }
});

test('the sticky comment is found by its REST id and bot login on the GraphQL shape', () => {
  const marker = '<!-- pr-flow-orchestration -->';
  const { run } = fetchWith([
    response({
      comments: conn([
        summaryComment(human('github-actions'), `${marker}\nspoofed`, 11),
        summaryComment(bot('github-actions'), `${marker}\nreal`, 12),
      ]),
    }),
  ]);
  const { comments } = run();
  const found = findExistingComment(comments, marker);
  assert.equal(found.id, 12);
  assert.equal(found.user.login, 'github-actions[bot]');
});

test('the Kilo allow-list is not widened to the GraphQL bot login', () => {
  assert.deepEqual(KILO_LOGINS, ['kilo-code-bot[bot]']);
});

test('a caller can request only some connections and the others are never queried', () => {
  const { run, calls } = fetchWith(
    [
      response({
        comments: conn([summaryComment(bot('github-actions'), 'x', 5)]),
        commits: {
          nodes: [
            {
              commit: {
                oid: HEAD,
                statusCheckRollup: {
                  contexts: conn([
                    {
                      __typename: 'StatusContext',
                      context: 'pr-flow/ready',
                      state: 'SUCCESS',
                      description: 'ok',
                      targetUrl: 'https://example.test/run/1',
                      createdAt: '2026-01-01T10:00:00Z',
                    },
                  ]),
                },
              },
            },
          ],
        },
      }),
    ],
    {
      want: { comments: true, reviews: false, threads: false, contexts: true },
    },
  );
  const result = run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].wantComments, true);
  assert.equal(calls[0].wantContexts, true);
  assert.equal(calls[0].wantReviews, false);
  assert.equal(calls[0].wantThreads, false);
  assert.deepEqual(
    result.comments.map((c) => c.id),
    [5],
  );
  assert.deepEqual(result.statuses, [
    {
      context: 'pr-flow/ready',
      state: 'success',
      description: 'ok',
      target_url: 'https://example.test/run/1',
      created_at: '2026-01-01T10:00:00Z',
    },
  ]);
  assert.deepEqual(result.reviews, []);
  assert.deepEqual(result.reviewComments, []);
});

test('requesting only comments needs no status rollup and still guards the head', () => {
  const only = { want: { reviews: false, threads: false, contexts: false } };
  const ok = fetchWith([response()], only);
  assert.deepEqual(ok.run().statuses, []);
  assert.equal(ok.calls[0].wantContexts, false);

  const moved = fetchWith([response({ headRefOid: OTHER })], only);
  assert.throws(moved.run, ReviewInputsUnavailable);
});

test('requesting nothing performs no query', () => {
  const { run, calls } = fetchWith([response()], {
    want: { comments: false, reviews: false, threads: false, contexts: false },
  });
  assert.deepEqual(run().comments, []);
  assert.equal(calls.length, 0);
});

const commit = (oid, extra = {}) => ({ oid, ...extra });

test('the head commit date is the last commit committer date, then its author date', () => {
  const commits = [
    commit('1'.repeat(40), { committedDate: '2026-01-01T00:00:00Z' }),
    commit(HEAD, {
      committedDate: '2026-02-02T10:00:00Z',
      authoredDate: '2026-02-01T09:00:00Z',
    }),
  ];
  assert.equal(
    headCommittedAtFromCommits(commits, HEAD),
    '2026-02-02T10:00:00Z',
  );
  assert.equal(
    headCommittedAtFromCommits(
      [
        commit(HEAD, {
          committedDate: null,
          authoredDate: '2026-02-01T09:00:00Z',
        }),
      ],
      HEAD,
    ),
    '2026-02-01T09:00:00Z',
  );
});

test('the head commit date is unknown unless the last listed commit is the head', () => {
  const dated = { committedDate: '2026-02-02T10:00:00Z' };
  // A long PR: the listed page ends before the tip.
  assert.equal(headCommittedAtFromCommits([commit(OTHER, dated)], HEAD), '');
  assert.equal(headCommittedAtFromCommits([], HEAD), '');
  assert.equal(headCommittedAtFromCommits(undefined, HEAD), '');
  assert.equal(headCommittedAtFromCommits([commit(HEAD, dated)], ''), '');
  assert.equal(headCommittedAtFromCommits([commit(HEAD)], HEAD), '');
  assert.equal(
    headCommittedAtFromCommits(
      [commit(HEAD, { committedDate: 'not a date' })],
      HEAD,
    ),
    '',
  );
});

function withMutedWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    return { value: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

test('resolveHeadCommittedAt takes the date from the PR read and skips the REST read', () => {
  const reads = [];
  const { value, warnings } = withMutedWarnings(() =>
    resolveHeadCommittedAt(
      { commits: [commit(HEAD, { committedDate: '2026-02-02T10:00:00Z' })] },
      { headSha: HEAD },
      {
        source: 'graphql',
        readRest: (sha) => {
          reads.push(sha);
          return 'rest-date';
        },
      },
    ),
  );
  assert.equal(value, '2026-02-02T10:00:00Z');
  assert.deepEqual(reads, []);
  assert.deepEqual(warnings, []);
});

test('resolveHeadCommittedAt reads REST once, with one warning, when the PR read has no usable date', () => {
  const reads = [];
  const { value, warnings } = withMutedWarnings(() =>
    resolveHeadCommittedAt(
      { commits: [commit(OTHER, { committedDate: '2026-02-02T10:00:00Z' })] },
      { headSha: HEAD },
      {
        source: 'graphql',
        readRest: (sha) => {
          reads.push(sha);
          return 'rest-date';
        },
      },
    ),
  );
  assert.equal(value, 'rest-date');
  assert.deepEqual(reads, [HEAD]);
  assert.equal(warnings.length, 1);
});

test('resolveHeadCommittedAt ignores the PR read and warns nothing when the source is rest', () => {
  const reads = [];
  const { value, warnings } = withMutedWarnings(() =>
    resolveHeadCommittedAt(
      { commits: [commit(HEAD, { committedDate: '2026-02-02T10:00:00Z' })] },
      { headSha: HEAD },
      {
        source: 'rest',
        readRest: (sha) => {
          reads.push(sha);
          return 'rest-date';
        },
      },
    ),
  );
  assert.equal(value, 'rest-date');
  assert.deepEqual(reads, [HEAD]);
  assert.deepEqual(warnings, []);
});

test('readPublishSnapshot returns the GraphQL read and passes along strict booleans', () => {
  const seen = [];
  const load = (pr, options) => {
    seen.push([pr.number, options]);
    return { comments: [{ id: 3 }], statuses: [] };
  };
  const snapshot = readPublishSnapshot(
    { number: 7, headSha: HEAD },
    {
      wantStatuses: true,
      source: 'graphql',
      loadGraphql: load,
    },
  );
  assert.deepEqual(snapshot, { comments: [{ id: 3 }], statuses: [] });

  // A truthy-but-not-true flag must not reach the adapter, which treats an
  // omitted connection flag as `true` — the read would be paid and discarded.
  readPublishSnapshot(
    { number: 7, headSha: HEAD },
    {
      wantComments: 1,
      wantStatuses: 'yes',
      source: 'graphql',
      loadGraphql: load,
    },
  );
  assert.deepEqual(seen, [
    [7, { wantComments: true, wantStatuses: true }],
    [7, { wantComments: false, wantStatuses: false }],
  ]);
});

test('readPublishSnapshot gives every consumer its REST fallback when the read is unavailable', () => {
  for (const failure of [
    new ReviewInputsUnavailable('head moved'),
    new Error('gh not found'),
  ]) {
    const { value, warnings } = withMutedWarnings(() =>
      readPublishSnapshot(
        { number: 7, headSha: HEAD },
        {
          wantStatuses: true,
          source: 'graphql',
          loadGraphql: () => {
            throw failure;
          },
        },
      ),
    );
    assert.deepEqual(value, { comments: null, statuses: null });
    assert.equal(warnings.length, 1);
  }
});

test('readPublishSnapshot never queries when the source is rest', () => {
  let queried = false;
  const snapshot = readPublishSnapshot(
    { number: 7, headSha: HEAD },
    {
      wantStatuses: true,
      source: 'rest',
      loadGraphql: () => {
        queried = true;
        return { comments: [], statuses: [] };
      },
    },
  );
  assert.equal(queried, false);
  assert.deepEqual(snapshot, { comments: null, statuses: null });
});

const flow = require('../orchestrate-pr-flow.cjs');
const { compareReusePoints } = require('../compare-review-input-sources.cjs');

const STICKY_MARKER = '<!-- pr-flow-orchestration -->';
const restSticky = (id) => ({
  id,
  user: { login: 'github-actions[bot]' },
  body: `${STICKY_MARKER}\nflow`,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
});
const restStatus = (context, overrides = {}) => ({
  id: 9,
  context,
  state: 'success',
  description: 'ok',
  target_url: 'https://example.test/run/1',
  created_at: '2026-01-01T10:00:00Z',
  ...overrides,
});
// GraphQL status contexts carry no numeric id.
const gqlStatus = (context, overrides = {}) => {
  const status = restStatus(context, overrides);
  delete status.id;
  return status;
};

function parityInputs(overrides = {}) {
  return {
    flow,
    headSha: HEAD,
    restHeadCommittedAt: '2026-02-02T10:00:00Z',
    prCommits: [commit(HEAD, { committedDate: '2026-02-02T10:00:00Z' })],
    restComments: [restSticky(12)],
    restStatuses: [restStatus('pr-flow/ready')],
    snapshot: {
      comments: [restSticky(12)],
      statuses: [gqlStatus('pr-flow/ready')],
    },
    ...overrides,
  };
}

test('parity reports identical reads for the head date, sticky comment and statuses', () => {
  const result = compareReusePoints(parityInputs());
  assert.equal(result.head.result, 'identical');
  assert.equal(result.sticky.result, 'identical');
  assert.equal(result.statuses.result, 'identical');
});

test('parity flags a head commit date the PR read reports differently', () => {
  const result = compareReusePoints(
    parityInputs({ restHeadCommittedAt: '2026-02-02T10:00:01Z' }),
  );
  assert.equal(result.head.result, 'DIFFERENT');
});

test('parity treats an unusable PR-read date as a fallback, not a difference', () => {
  const result = compareReusePoints(parityInputs({ prCommits: [] }));
  assert.equal(result.head.result, 'fallback');
});

test('parity flags a sticky comment the two sources resolve to different ids', () => {
  const result = compareReusePoints(
    parityInputs({
      snapshot: { comments: [restSticky(13)], statuses: [] },
    }),
  );
  assert.equal(result.sticky.result, 'DIFFERENT');
});

test('parity flags a status whose skip decision would change', () => {
  // Same context, but the GraphQL side lost the description: an unchanged
  // success would be re-posted on one source and skipped on the other.
  const result = compareReusePoints(
    parityInputs({
      snapshot: {
        comments: [restSticky(12)],
        statuses: [gqlStatus('pr-flow/ready', { description: null })],
      },
    }),
  );
  assert.equal(result.statuses.result, 'DIFFERENT');
});

test('parity reports a missing publish-time read as a fallback for both reuse points', () => {
  const result = compareReusePoints(parityInputs({ snapshot: null }));
  assert.equal(result.sticky.result, 'fallback');
  assert.equal(result.statuses.result, 'fallback');
  assert.equal(result.head.result, 'identical');
});
