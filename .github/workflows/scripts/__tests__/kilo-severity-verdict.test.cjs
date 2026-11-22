/* eslint-disable @typescript-eslint/no-require-imports */
// Kilo reviews whose only findings are SUGGESTIONs count as passed; CRITICAL
// and WARNING findings (and anything that cannot be read with confidence)
// keep blocking. Summary bodies come from real revisions of the Kilo sticky
// comment on PR #1181 (fixtures/kilo-sticky-comment-revisions.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  evaluateExternalReview,
  currentInlineIssue,
  inlineSeverity,
  parseBlockingSeverities,
  severityCounts,
  summaryVerdict,
} = require('../evaluate-external-review.cjs');

const SCRIPT = path.join(__dirname, '..', 'evaluate-external-review.cjs');
const { revisions } = require('./fixtures/kilo-sticky-comment-revisions.json');
const HISTORY = '<!-- kilo-review-history -->';

function revision(index) {
  const found = revisions.find((rev) => rev.index === index);
  assert.ok(found, `fixture revision ${index} exists`);
  return found.body;
}

const head = 'c'.repeat(40);
const pr = { headSha: head };
const kilo = { login: 'kilo-code-bot[bot]', type: 'Bot' };
const now = '2026-11-22T21:40:00Z';

function summary(body, at = '2026-11-22T21:30:00Z') {
  return { user: kilo, body, created_at: at, updated_at: at };
}

function inline(body, at = '2026-11-22T21:20:00Z', commit = head) {
  return {
    user: kilo,
    body,
    commit_id: commit,
    original_commit_id: commit,
    created_at: at,
    updated_at: at,
  };
}

const headReview = {
  user: kilo,
  commit_id: head,
  submitted_at: '2026-11-22T21:10:00Z',
};

// [name, fixture revision, expected verdict with default severities]
const REAL_SUMMARIES = [
  ['7 issues: 2 WARNING + 5 SUGGESTION', 1, 'blocked'],
  ['3 SUGGESTION, history holds a WARNING table', 3, 'non-blocking'],
  ['2 SUGGESTION after a top-of-review edit', 4, 'non-blocking'],
  ['2 SUGGESTION after a history-only edit', 5, 'non-blocking'],
  ['1 SUGGESTION', 7, 'non-blocking'],
  ['No Issues Found with history', 13, 'passed'],
  ['2 issues: 1 WARNING + 1 SUGGESTION', 17, 'blocked'],
];

for (const [name, index, expected] of REAL_SUMMARIES) {
  test(`summaryVerdict on a real Kilo summary: ${name}`, () => {
    assert.equal(summaryVerdict(revision(index), ''), expected);
    // Rollback: every finding blocks again.
    assert.equal(
      summaryVerdict(revision(index), 'all'),
      expected === 'passed' ? 'passed' : 'blocked',
    );
  });
}

test('severityCounts reads only the current overview table', () => {
  const top = revision(3).split(HISTORY)[0];
  assert.deepEqual(severityCounts(top), {
    CRITICAL: 0,
    WARNING: 0,
    SUGGESTION: 3,
  });
  assert.deepEqual(severityCounts(revision(17).split(HISTORY)[0]), {
    CRITICAL: 0,
    WARNING: 1,
    SUGGESTION: 1,
  });
});

test('CRLF line endings do not change the verdict', () => {
  const crlf = revision(5).replace(/\n/g, '\r\n');
  assert.equal(summaryVerdict(crlf, ''), 'non-blocking');
});

const TABLE_HEAD = '| Severity | Count |\n|----------|-------|';
function body(status, rows, extra = '') {
  return `<!-- kilo-review -->\n\n**Status:** ${status} | **Recommendation:** Address before merge\n\n${TABLE_HEAD}\n${rows.join('\n')}\n${extra}`;
}
const S3 = ['| CRITICAL | 0 |', '| WARNING | 0 |', '| SUGGESTION | 3 |'];

for (const [name, text] of [
  [
    'table only inside the history section',
    `<!-- kilo-review -->\n**Status:** 3 Issues Found\n${HISTORY}\n${TABLE_HEAD}\n${S3.join('\n')}\n`,
  ],
  ['unknown severity row', body('4 Issues Found', [...S3, '| INFO | 1 |'])],
  ['total inconsistent with the status', body('4 Issues Found', S3)],
  ['missing severity row', body('3 Issues Found', S3.slice(1))],
  [
    'duplicate severity row',
    body('3 Issues Found', [...S3, '| WARNING | 0 |']),
  ],
  [
    'non-numeric count',
    body('3 Issues Found', [
      '| CRITICAL | 0 |',
      '| WARNING | n/a |',
      '| SUGGESTION | 3 |',
    ]),
  ],
  [
    'two overview tables',
    body('3 Issues Found', S3, `\n${TABLE_HEAD}\n${S3.join('\n')}\n`),
  ],
  [
    'all counts zero while issues are reported',
    body('Issues Found', [
      '| CRITICAL | 0 |',
      '| WARNING | 0 |',
      '| SUGGESTION | 0 |',
    ]),
  ],
  ['no table at all', '<!-- kilo-review -->\n**Status:** 3 Issues Found'],
]) {
  test(`unreadable or inconsistent severity evidence stays blocking: ${name}`, () => {
    assert.equal(summaryVerdict(text, ''), 'blocked');
  });
}

test('a consistent suggestions-only table without a status total is non-blocking', () => {
  assert.equal(
    summaryVerdict(body('Review complete', S3), 'critical,warning'),
    'non-blocking',
  );
});

test('parseBlockingSeverities defaults, rollback and fail-safe values', () => {
  assert.deepEqual([...parseBlockingSeverities('')].sort(), [
    'CRITICAL',
    'WARNING',
  ]);
  assert.deepEqual([...parseBlockingSeverities(undefined)].sort(), [
    'CRITICAL',
    'WARNING',
  ]);
  assert.deepEqual(
    [...parseBlockingSeverities(' Critical , warning ')].sort(),
    ['CRITICAL', 'WARNING'],
  );
  assert.deepEqual([...parseBlockingSeverities('critical')], ['CRITICAL']);
  assert.equal(parseBlockingSeverities('all'), null);
  assert.equal(parseBlockingSeverities('ALL'), null);
  // A typo must never let findings through: unknown names mean "all block".
  assert.equal(parseBlockingSeverities('critical,warnings'), null);
  assert.equal(parseBlockingSeverities(','), null);
});

test('inlineSeverity reads only the leading Kilo severity tag', () => {
  assert.equal(inlineSeverity('**SUGGESTION:** rename'), 'SUGGESTION');
  assert.equal(inlineSeverity('  **warning:** guard'), 'WARNING');
  assert.equal(inlineSeverity('**CRITICAL:** leak'), 'CRITICAL');
  assert.equal(inlineSeverity('**NOTE:** fyi'), null);
  assert.equal(inlineSeverity('Agreed, fixed in the next commit'), null);
  assert.equal(inlineSeverity('see **SUGGESTION:** below'), null);
});

test('suggestions-only real summary passes with a dedicated reason', () => {
  const result = evaluateExternalReview({
    pr,
    reviews: [headReview],
    comments: [summary(revision(5))],
    reviewComments: [inline('**SUGGESTION:** rename this')],
    now,
    blockingSeverities: '',
  });
  assert.deepEqual(result, {
    state: 'passed',
    reason: 'Kilo reported only suggestions.',
  });
});

test('suggestions-only summary never masks a current-head blocking inline', () => {
  for (const at of ['2026-11-22T21:20:00Z', '2026-11-22T21:35:00Z']) {
    const result = evaluateExternalReview({
      pr,
      reviews: [headReview],
      comments: [summary(revision(5))],
      reviewComments: [inline('**WARNING:** missing null guard', at)],
      now,
      blockingSeverities: '',
    });
    assert.equal(result.state, 'blocked', `inline at ${at}`);
  }
});

test('an older blocking inline cannot hide behind a newer suggestion inline', () => {
  const comments = [
    inline('**WARNING:** missing null guard', '2026-11-22T21:10:00Z'),
    inline('**SUGGESTION:** rename', '2026-11-22T21:25:00Z'),
  ];
  assert.match(currentInlineIssue(comments, head, '').body, /WARNING/);
  const result = evaluateExternalReview({
    pr,
    reviewComments: comments,
    now,
    blockingSeverities: '',
  });
  assert.equal(result.state, 'blocked');
});

test('inline comments without a known non-blocking tag keep blocking', () => {
  for (const text of ['**NOTE:** fyi', 'Thanks, will fix', '**CRITICAL:** x']) {
    const result = evaluateExternalReview({
      pr,
      reviews: [headReview],
      comments: [summary(revision(5))],
      reviewComments: [inline(text)],
      now,
      blockingSeverities: '',
    });
    assert.equal(result.state, 'blocked', text);
  }
});

test('a lone suggestion inline without a current summary waits instead of passing', () => {
  const result = evaluateExternalReview({
    pr,
    reviewComments: [inline('**SUGGESTION:** rename')],
    now,
    blockingSeverities: '',
  });
  assert.equal(result.state, 'pending');
});

test('a newer clean summary still supersedes an older blocking inline', () => {
  const result = evaluateExternalReview({
    pr,
    reviews: [headReview],
    comments: [summary(revision(13), '2026-11-22T21:30:00Z')],
    reviewComments: [inline('**WARNING:** guard', '2026-11-22T21:20:00Z')],
    now,
    blockingSeverities: '',
  });
  assert.equal(result.state, 'passed');
  assert.equal(result.reason, 'Kilo reported no current-head issues.');
});

test('rollback `all` restores the any-finding-blocks rule for summary and inline', () => {
  const bySummary = evaluateExternalReview({
    pr,
    reviews: [headReview],
    comments: [summary(revision(5))],
    now,
    blockingSeverities: 'all',
  });
  assert.deepEqual(bySummary, {
    state: 'blocked',
    reason: 'Kilo reported current-head issues.',
  });
  const byInline = evaluateExternalReview({
    pr,
    reviewComments: [inline('**SUGGESTION:** rename')],
    now,
    blockingSeverities: 'all',
  });
  assert.deepEqual(byInline, {
    state: 'blocked',
    reason: 'Kilo reported current-head inline review issues.',
  });
});

test('KILO_BLOCKING_SEVERITIES env is the default for in-process callers', () => {
  const saved = process.env.KILO_BLOCKING_SEVERITIES;
  try {
    process.env.KILO_BLOCKING_SEVERITIES = 'all';
    const args = {
      pr,
      reviews: [headReview],
      comments: [summary(revision(5))],
      now,
    };
    assert.equal(evaluateExternalReview(args).state, 'blocked');
    delete process.env.KILO_BLOCKING_SEVERITIES;
    assert.equal(evaluateExternalReview(args).state, 'passed');
  } finally {
    if (saved === undefined) delete process.env.KILO_BLOCKING_SEVERITIES;
    else process.env.KILO_BLOCKING_SEVERITIES = saved;
  }
});

test('the CLI used by Auto Cover honours the same env switch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-severity-'));
  try {
    const write = (name, value) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, JSON.stringify(value));
      return file;
    };
    const args = [
      SCRIPT,
      '--pr-file',
      write('pr.json', pr),
      '--comments-file',
      write('comments.json', [summary(revision(5))]),
      '--review-comments-file',
      write('review-comments.json', [inline('**SUGGESTION:** rename')]),
      '--reviews-file',
      write('reviews.json', [headReview]),
      '--now',
      now,
    ];
    const run = (value) => {
      const env = { ...process.env };
      delete env.KILO_BLOCKING_SEVERITIES;
      if (value !== undefined) env.KILO_BLOCKING_SEVERITIES = value;
      return JSON.parse(execFileSync(process.execPath, args, { env })).state;
    };
    assert.equal(run(undefined), 'passed');
    assert.equal(run(''), 'passed');
    assert.equal(run('all'), 'blocked');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
