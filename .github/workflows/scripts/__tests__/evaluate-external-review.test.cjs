/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateExternalReview,
  summaryVerdict,
} = require('../evaluate-external-review.cjs');

const head = 'abc123';
const pr = { headRefOid: head };
const kilo = { login: 'kilo-code-bot[bot]', type: 'Bot' };
const now = '2026-06-24T12:00:00Z';

function summary(body, createdAt = now) {
  return {
    user: kilo,
    body: `<!-- kilo-review -->\n${body}`,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function review(commitId = head, submittedAt = now) {
  return {
    user: kilo,
    commit_id: commitId,
    submitted_at: submittedAt,
  };
}

test('summaryVerdict detects Kilo pass and block states', () => {
  assert.equal(summaryVerdict('Status: No Issues Found'), 'passed');
  assert.equal(summaryVerdict('Status: 2 Issues Found'), 'blocked');
  assert.equal(
    summaryVerdict('Status: No Issues Found\nStatus: 1 Issue Found'),
    'blocked',
  );
  assert.equal(
    summaryVerdict('Recommendation: Address before merge'),
    'blocked',
  );
  assert.equal(summaryVerdict('Still running'), null);
});

test('current-head Kilo No Issues Found passes', () => {
  const result = evaluateExternalReview({
    pr,
    reviews: [review()],
    comments: [summary('Status: No Issues Found')],
    now,
  });

  assert.equal(result.state, 'passed');
});

test('current-head Kilo issues block', () => {
  const result = evaluateExternalReview({
    pr,
    reviews: [review()],
    comments: [summary('Status: 1 Issue Found')],
    now,
  });

  assert.equal(result.state, 'blocked');
});

test('current-head inline Kilo comments block even without a summary', () => {
  const result = evaluateExternalReview({
    pr,
    reviewComments: [
      {
        user: kilo,
        commit_id: head,
        body: 'guard the null path',
      },
    ],
    now,
  });

  assert.equal(result.state, 'blocked');
});

test('old-head Kilo issues do not block current head', () => {
  const result = evaluateExternalReview({
    pr,
    reviews: [review('old-head')],
    reviewComments: [
      {
        user: kilo,
        commit_id: 'old-head',
        body: 'old issue',
      },
    ],
    comments: [summary('Status: 1 Issue Found', '2026-06-24T11:40:00Z')],
    statuses: [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        created_at: '2026-06-24T11:45:00Z',
      },
    ],
    now,
  });

  assert.equal(result.state, 'pending');
});

test('cancelled or skipped Kilo check skips the external gate', () => {
  for (const conclusion of ['cancelled', 'skipped']) {
    const result = evaluateExternalReview({
      pr,
      checkRuns: [{ name: 'Kilo Code Review', conclusion }],
      now,
    });
    assert.equal(result.state, 'skipped');
  }
});

test('current-head Kilo blockers win over cancelled or skipped check-runs', () => {
  const result = evaluateExternalReview({
    pr,
    reviews: [review()],
    comments: [summary('Status: 1 Issue Found')],
    checkRuns: [{ name: 'Kilo Code Review', conclusion: 'cancelled' }],
    now,
  });

  assert.equal(result.state, 'blocked');
});

test('marker-only Kilo summary is current when posted after the pending status', () => {
  const result = evaluateExternalReview({
    pr,
    comments: [summary('Status: 1 Issue Found', '2026-06-24T11:50:00Z')],
    statuses: [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        created_at: '2026-06-24T11:45:00Z',
      },
    ],
    now,
  });

  assert.equal(result.state, 'blocked');
});

test('marker-only Kilo summary before current pending status is ignored', () => {
  const result = evaluateExternalReview({
    pr,
    comments: [summary('Status: 1 Issue Found', '2026-06-24T11:40:00Z')],
    statuses: [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        created_at: '2026-06-24T11:45:00Z',
      },
    ],
    now,
  });

  assert.equal(result.state, 'pending');
});

test('no current-head Kilo reply is pending before 30 minutes', () => {
  const result = evaluateExternalReview({
    pr,
    statuses: [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        created_at: '2026-06-24T11:45:00Z',
      },
    ],
    now,
  });

  assert.equal(result.state, 'pending');
});

test('no current-head Kilo reply skips after 30 minutes', () => {
  const result = evaluateExternalReview({
    pr,
    statuses: [
      {
        context: 'pr-flow/kilo-review',
        state: 'pending',
        created_at: '2026-06-24T11:29:00Z',
      },
    ],
    now,
  });

  assert.equal(result.state, 'skipped');
});
