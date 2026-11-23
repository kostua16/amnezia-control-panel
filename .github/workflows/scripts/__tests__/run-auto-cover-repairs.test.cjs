/* eslint-disable @typescript-eslint/no-require-imports */
// Auto Cover repair actions after evaluation: direct fix-review dispatch
// (previous behavior), handoff to the quiet-period workflow, and the
// re-validation that runs after the quiet period. GitHub is replaced by a fake
// `gh` that records every call.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  commentIdFromUrl,
  runAutoCoverRepairs,
  summaryBody,
  summaryLine,
} = require('../run-auto-cover-repairs.cjs');

const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'policy.json'), 'utf8'),
);
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const BOT = { login: 'github-actions[bot]' };
const DISPATCHER = 'https://github.com/o/r/actions/runs/99';

function prJson(number, overrides = {}) {
  return {
    number,
    title: 'ci(workflows): example',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRefOid: SHA,
    headRefName: `claude-workflow-optimize-${number}`,
    baseRefName: 'main',
    labels: [{ name: 'needs-review' }, { name: 'ai-review-concerns' }],
    files: [{ path: '.planning/example.md' }],
    ...overrides,
  };
}

// Writes the per-PR files fetch-auto-cover-context.cjs produces.
function contextDir(prs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-cover-'));
  for (const [number, ctx = {}] of prs) {
    const prefix = path.join(dir, `pr-${number}`);
    const pr = prJson(number, ctx.pr);
    const files = {
      pr,
      comments: ctx.comments ?? [],
      attempts: ctx.attempts ?? [],
      'review-comments': [],
      reviews: [],
      commits: ctx.commits ?? [],
      'fix-review-runs': ctx.fixReviewRuns ?? [],
      statuses: [],
      'check-runs': [],
    };
    for (const [name, value] of Object.entries(files)) {
      fs.writeFileSync(`${prefix}-${name}.json`, JSON.stringify(value));
    }
    fs.writeFileSync(`${prefix}-head-sha`, pr.headRefOid);
  }
  fs.writeFileSync(
    path.join(dir, 'prs-to-evaluate.txt'),
    prs.map(([n]) => `${n}\n`).join(''),
  );
  return dir;
}

function fakeGh({ runs = [], failHandoffFor = [] } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'workflow' && args[1] === 'run') {
      const pr = args.find((a) => a.startsWith('pr_number='))?.split('=')[1];
      if (
        args[2] === 'auto-cover-dispatch.yml' &&
        failHandoffFor.includes(pr)
      ) {
        throw new Error('HTTP 500');
      }
      return '';
    }
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify(runs);
    if (args[0] === 'issue' && args[1] === 'comment') {
      return 'https://github.com/o/r/pull/7#issuecomment-555\n';
    }
    return '';
  };
  return { gh, calls };
}

function run(dir, mode, extra = {}) {
  const logs = [];
  const result = runAutoCoverRepairs({
    dir,
    mode,
    policy,
    repo: 'o/r',
    dispatcherUrl: DISPATCHER,
    sleep: () => {},
    now: () => new Date('2026-11-23T10:00:00.123Z'),
    log: (line) => logs.push(line),
    warn: (line) => logs.push(line),
    ...extra,
  });
  return { result, logs };
}

const fixReviewRun = {
  displayTitle: `Fix Review PR #7 @ ${SHA}`,
  createdAt: '2026-11-23T10:00:05Z',
  url: 'https://github.com/o/r/actions/runs/123',
  status: 'queued',
};

test('delayed mode hands an eligible PR to the quiet-period workflow, nothing else', () => {
  const dir = contextDir([[7]]);
  const { gh, calls } = fakeGh();
  const { result } = run(dir, 'delayed', { gh });
  assert.deepEqual(calls, [
    [
      'workflow',
      'run',
      'auto-cover-dispatch.yml',
      '--ref',
      'main',
      '-f',
      'pr_number=7',
      '-f',
      `head_sha=${SHA}`,
    ],
  ]);
  assert.deepEqual(result, {
    evaluated: 1,
    dispatched: 0,
    handedOff: 1,
    failed: [],
  });
});

test('dry-run never dispatches or hands off, in any mode', () => {
  for (const mode of ['delayed', 'direct']) {
    const dir = contextDir([[7]]);
    const { gh, calls } = fakeGh();
    const { logs } = run(dir, mode, { gh, dryRun: true });
    assert.deepEqual(calls, [], mode);
    assert.ok(
      logs.some((line) => line.startsWith('Dry-run:')),
      mode,
    );
  }
});

test('a scan with two eligible PRs hands off two candidates and skips the rest', () => {
  const dir = contextDir([
    [7],
    [8],
    [9, { pr: { labels: [{ name: 'needs-review' }] } }],
  ]);
  const { gh, calls } = fakeGh();
  const { result } = run(dir, 'delayed', { gh });
  assert.deepEqual(
    calls.map((args) => args.find((a) => a.startsWith('pr_number='))),
    ['pr_number=7', 'pr_number=8'],
  );
  assert.equal(result.evaluated, 3);
  assert.equal(result.handedOff, 2);
});

test('one failed handoff does not cost the other PRs theirs', () => {
  const dir = contextDir([[7], [8]]);
  const { gh, calls } = fakeGh({ failHandoffFor: ['7'] });
  const { result } = run(dir, 'delayed', { gh });
  assert.equal(calls.length, 2);
  assert.deepEqual(result.failed, ['7']);
  assert.equal(result.handedOff, 1);
  assert.match(
    summaryLine('delayed', result),
    /Handoff failed for PR\(s\): #7\./,
  );
});

test('direct mode keeps the previous dispatch, lookup and comment sequence', () => {
  const dir = contextDir([[7]]);
  const { gh, calls } = fakeGh({ runs: [fixReviewRun] });
  const { result } = run(dir, 'direct', { gh });
  assert.deepEqual(calls[0], [
    'workflow',
    'run',
    'fix-review.yml',
    '--ref',
    'main',
    '-f',
    'pr_number=7',
    '-f',
    `head_sha=${SHA}`,
    '-f',
    'automation_review_loop=true',
  ]);
  assert.deepEqual(calls[1].slice(0, 6), [
    'run',
    'list',
    '--workflow',
    'fix-review.yml',
    '--event',
    'workflow_dispatch',
  ]);
  assert.deepEqual(calls[2].slice(0, 3), ['issue', 'comment', '7']);
  assert.equal(calls.length, 3);
  assert.equal(
    fs.readFileSync(calls[2][4], 'utf8'),
    `<!-- auto-cover-review-summary -->\n\nAuto-cover review dispatched fix-review for \`${SHA}\`.\n\n- Dispatcher run: ${DISPATCHER}\n- Fix-review run: ${fixReviewRun.url}\n`,
  );
  assert.equal(result.dispatched, 1);
  assert.equal(
    summaryLine('direct', result),
    'Evaluated 1 PR(s); dispatched 1 fix-review run(s).',
  );
});

test('the run lookup ignores other titles and runs created before the dispatch', () => {
  const dir = contextDir([[7]]);
  const { gh, calls } = fakeGh({
    runs: [
      { ...fixReviewRun, displayTitle: `Fix Review PR #8 @ ${SHA}` },
      { ...fixReviewRun, createdAt: '2026-11-23T09:59:59Z' },
    ],
  });
  let sleeps = 0;
  run(dir, 'direct', { gh, sleep: () => sleeps++ });
  const lists = calls.filter((args) => args[0] === 'run');
  assert.equal(lists.length, 10);
  assert.equal(sleeps, 9);
  assert.match(
    fs.readFileSync(calls.at(-1)[4], 'utf8'),
    /- Fix-review run: _unavailable_\n$/,
  );
});

test('re-validation records the attempt right after the dispatch, then adds the run URL', () => {
  const dir = contextDir([[7]]);
  const { gh, calls } = fakeGh({ runs: [fixReviewRun] });
  const { result } = run(dir, 'revalidate', { gh, expectedHeadSha: SHA });
  assert.deepEqual(
    calls.map((args) => args.slice(0, 2).join(' ')),
    ['workflow run', 'issue comment', 'run list', 'api -X'],
  );
  assert.equal(calls[0][2], 'fix-review.yml');
  assert.deepEqual(calls[3].slice(0, 4), [
    'api',
    '-X',
    'PATCH',
    'repos/o/r/issues/comments/555',
  ]);
  assert.equal(
    calls[3][5],
    `body=${summaryBody({ headSha: SHA, dispatcherUrl: DISPATCHER, fixReviewUrl: fixReviewRun.url })}`,
  );
  assert.equal(result.dispatched, 1);
});

const attemptComment = (n) => ({
  user: BOT,
  body: `<!-- auto-cover-review-summary -->\nattempt ${n}`,
});

// Every condition that can change during the quiet period vetoes the dispatch.
const VETOES = {
  'review went green (no blocker left)': {
    pr: { labels: [{ name: 'needs-review' }] },
  },
  'PR converted to draft': { pr: { isDraft: true } },
  'PR closed': { pr: { state: 'CLOSED' } },
  'do-not-merge added': {
    pr: {
      labels: [{ name: 'ai-review-concerns' }, { name: 'do-not-merge' }],
    },
  },
  'dependency blocker added': {
    pr: {
      labels: [{ name: 'ai-review-concerns' }, { name: 'deps-review-blocked' }],
    },
  },
  'attempt cap reached during the wait': {
    attempts: [attemptComment(1), attemptComment(2), attemptComment(3)],
  },
  'fix-review already active for the head': {
    fixReviewRuns: [{ ...fixReviewRun, status: 'in_progress' }],
  },
  'fix-review reported no changes needed for the head': {
    comments: [
      {
        user: BOT,
        body: `<!-- fix-review-summary -->\nNo changes needed\n- Head SHA: \`${SHA.slice(0, 12)}\``,
      },
    ],
  },
  'head moved (new push during the wait)': { pr: { headRefOid: OTHER_SHA } },
};

for (const [name, ctx] of Object.entries(VETOES)) {
  test(`re-validation vetoes the dispatch: ${name}`, () => {
    const dir = contextDir([[7, ctx]]);
    const { gh, calls } = fakeGh({ runs: [fixReviewRun] });
    const { result } = run(dir, 'revalidate', { gh, expectedHeadSha: SHA });
    assert.deepEqual(calls, []);
    assert.equal(result.dispatched, 0);
  });
}

test('re-validation still dispatches the third attempt and stops at the cap', () => {
  const two = contextDir([
    [7, { attempts: [attemptComment(1), attemptComment(2)] }],
  ]);
  const first = fakeGh({ runs: [fixReviewRun] });
  run(two, 'revalidate', { gh: first.gh, expectedHeadSha: SHA });
  assert.equal(first.calls[0][2], 'fix-review.yml');

  const three = contextDir([
    [
      7,
      { attempts: [attemptComment(1), attemptComment(2), attemptComment(3)] },
    ],
  ]);
  const second = fakeGh();
  run(three, 'revalidate', { gh: second.gh, expectedHeadSha: SHA });
  assert.deepEqual(second.calls, []);
});

test('unknown modes are rejected', () => {
  assert.throws(
    () => runAutoCoverRepairs({ dir: contextDir([]), mode: 'later' }),
    /Unknown mode/,
  );
});

test('commentIdFromUrl reads the id gh prints for a new comment', () => {
  assert.equal(
    commentIdFromUrl('https://github.com/o/r/pull/7#issuecomment-555\n'),
    '555',
  );
  assert.equal(commentIdFromUrl(''), '');
});

test('revalidate mode refuses a missing or short head SHA', () => {
  const { spawnSync } = require('node:child_process');
  const script = path.join(__dirname, '..', 'run-auto-cover-repairs.cjs');
  for (const args of [[], ['--head-sha', 'abc123'], ['--head-sha', '']]) {
    const result = spawnSync(
      process.execPath,
      [script, '--mode', 'revalidate', '--context-dir', os.tmpdir(), ...args],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /40-character head SHA/);
  }
});
