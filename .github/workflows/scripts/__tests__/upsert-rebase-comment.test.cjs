/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMENT_MARKER,
  isTrue,
  repoBaseUrl,
  renderStarted,
  renderConflictWorking,
  renderSkipped,
  renderAncestryFailed,
  renderComplete,
  renderValidationFailed,
  renderPushRejected,
  renderFailed,
  renderCancelled,
  resolveFinishedBody,
} = require('../upsert-rebase-comment.cjs');

const SHA = 'e699b0871d0379b5c32afbe977f4f70aef57a39d';
const NEW_SHA = 'abcdef1234567890fedcba0987654321abc';
const BASE_SHA = '0123456789abcdef0123456789abcdef0123';
const RUN = 'https://example.com/owner/repo/actions/runs/1';
const TS = '2026-06-24T00:00:00.000Z';

test('COMMENT_MARKER is the rebase sticky marker', () => {
  assert.equal(COMMENT_MARKER, '<!-- rebase-pr-summary -->');
});

test('renderStarted prefixes marker, base ref and head SHA', () => {
  const body = renderStarted({
    headSha: SHA,
    baseRef: 'main',
    runUrl: RUN,
    startedAt: TS,
  });
  assert.match(body, new RegExp(`^${COMMENT_MARKER}`));
  assert.match(body, /Rebase started/);
  assert.match(body, /Base: `origin\/main`/);
  assert.match(body, /`e699b0871d03`/);
  assert.match(body, /2026-06-24T00:00:00\.000Z/);
});

test('renderConflictWorking shows the AI conflict-resolution state', () => {
  const body = renderConflictWorking({
    headSha: SHA,
    baseRef: 'main',
    runUrl: RUN,
    updatedAt: TS,
  });
  assert.match(body, /Resolving rebase conflicts/);
  assert.match(body, /Base: `origin\/main`/);
});

test('renderSkipped quotes a reason and hints re-run', () => {
  const body = renderSkipped({
    headSha: SHA,
    runUrl: RUN,
    reason: 'cross-repository PR',
    updatedAt: TS,
  });
  assert.match(body, /Rebase skipped/);
  assert.match(body, /cross-repository PR/);
  assert.match(body, /Re-run `\/rebase`/);
  assert.match(body, /do-not-merge/);
});

test('renderAncestryFailed shows distinct ancestry failure evidence', () => {
  const body = renderAncestryFailed({
    headSha: SHA,
    baseRef: 'main',
    baseSha: BASE_SHA,
    mergeBase: '',
    replayCount: '925',
    visibleCommitCount: '2',
    runUrl: RUN,
    reason: 'could not find merge base between HEAD and origin/main',
    updatedAt: TS,
  });
  assert.match(body, /Rebase ancestry check failed/);
  assert.match(body, /Base: `origin\/main` @ `0123456789ab`/);
  assert.match(body, /Merge base: _unavailable_/);
  assert.match(body, /Replay count: 925/);
  assert.match(body, /Visible PR commits: 2/);
  assert.match(body, /could not find merge base/);
  assert.match(body, /stopped before attempting `git rebase` or invoking ZAI/);
});

test('renderComplete shows old->new head, base sha, ai-conflicts, pushed, automerge', () => {
  const body = renderComplete({
    headSha: SHA,
    newHeadSha: NEW_SHA,
    baseRef: 'main',
    baseSha: BASE_SHA,
    runUrl: RUN,
    conflictsResolvedByAi: 'true',
    pushed: 'true',
    dryRun: 'false',
    automergeDisabled: 'true',
    numTurns: '8',
    structured: {
      summary: 'rebased onto main',
      conflicts_resolved: [{ file: 'src/a.ts', resolution: 'kept PR guard' }],
      review_findings_preserved: ['thread on src/a.ts'],
      review_findings_addressed: [],
    },
    updatedAt: TS,
  });
  assert.match(body, /Rebase complete/);
  assert.match(body, /> rebased onto main/);
  assert.match(body, /Old head: `e699b0871d03`/);
  assert.match(body, /New head: `abcdef123456`/);
  assert.match(body, /Base: `origin\/main` @ `0123456789ab`/);
  assert.match(body, /Conflicts resolved by AI: yes/);
  assert.match(body, /Pushed: yes \(`--force-with-lease`\)/);
  assert.match(body, /Conflicts resolved \(1\)/);
  assert.match(body, /src\/a\.ts/);
  assert.match(body, /Review findings preserved \(1\)/);
  assert.match(body, /Turns: 8/);
  assert.match(body, /Auto-merge was disabled/);
});

test('renderComplete marks a dry-run and omits the push line', () => {
  const body = renderComplete({
    headSha: SHA,
    newHeadSha: NEW_SHA,
    baseRef: 'main',
    baseSha: BASE_SHA,
    runUrl: RUN,
    conflictsResolvedByAi: 'false',
    pushed: 'false',
    dryRun: 'true',
    structured: {},
    updatedAt: TS,
  });
  assert.match(body, /Pushed: dry-run \(not pushed\)/);
  assert.match(body, /Conflicts resolved by AI: no/);
});

test('renderComplete reports no-changes when the rebase moved nothing', () => {
  const body = renderComplete({
    headSha: SHA,
    baseRef: 'main',
    baseSha: BASE_SHA,
    runUrl: RUN,
    conflictsResolvedByAi: 'false',
    pushed: 'false',
    dryRun: 'false',
    rebaseMovedHead: 'false',
    structured: {},
    updatedAt: TS,
  });
  assert.match(body, /Pushed: no \(no changes after rebase\)/);
});

test('renderValidationFailed shows the dual-block gate summary and forbids push', () => {
  const body = renderValidationFailed({
    headSha: SHA,
    runUrl: RUN,
    structured: {
      summary: 'conflicts resolved',
      validation: { tsc: 'pass', lint: 'pass' },
    },
    gateOutcomes: {
      lint: 'failure',
      test: 'success',
      build: 'skipped',
      scriptTests: 'success',
      prismaSafe: 'success',
    },
    updatedAt: TS,
  });
  assert.match(body, /Validation failed — rebased branch not pushed/);
  assert.match(body, /NOT pushed/);
  assert.match(body, /Workflow gate \(authoritative\):/);
  assert.match(body, /- lint \(tracked files\): \*\*fail\*\*/);
  assert.match(body, /- build: \*\*skipped\*\*/);
});

test('renderPushRejected forbids a plain-force retry', () => {
  const body = renderPushRejected({
    headSha: SHA,
    runUrl: RUN,
    reason: 'force-with-lease stale',
    updatedAt: TS,
  });
  assert.match(body, /Push rejected/);
  assert.match(body, /never retries with plain/);
  assert.match(body, /force-with-lease stale/);
});

test('renderFailed uses the provided reason', () => {
  const body = renderFailed({
    headSha: SHA,
    runUrl: RUN,
    failReason: 'conflicts could not be resolved',
    updatedAt: TS,
  });
  assert.match(body, /Rebase failed/);
  assert.match(body, /conflicts could not be resolved/);
});

test('renderCancelled explains the cancellation', () => {
  const body = renderCancelled({ headSha: SHA, runUrl: RUN, updatedAt: TS });
  assert.match(body, /Rebase cancelled/);
  assert.match(body, /timeout|superseded/);
});

test('resolveFinishedBody: cancelled wins over everything', () => {
  const body = resolveFinishedBody({
    outcome: 'cancelled',
    failed: 'true',
    gatePassed: 'false',
    pushed: 'true',
    rebaseMovedHead: 'true',
    structured: {},
  });
  assert.match(body, /Rebase cancelled/);
});

test('resolveFinishedBody: Claude hard-failure beats a passing gate', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'true',
    failReason: 'api error',
    gatePassed: 'true',
    pushed: 'true',
    rebaseMovedHead: 'true',
    structured: {},
  });
  assert.match(body, /Rebase failed/);
  assert.match(body, /api error/);
});

test('resolveFinishedBody: gate failure -> validation-failed, not pushed', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'false',
    gatePassed: 'false',
    pushed: 'false',
    rebaseMovedHead: 'true',
    gateOutcomes: { lint: 'failure', test: 'success', build: 'success' },
    structured: { summary: 'x' },
  });
  assert.match(body, /Validation failed/);
  assert.match(body, /Workflow gate \(authoritative\):/);
});

test('resolveFinishedBody: green gate, not pushed, head moved -> push-rejected', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'false',
    gatePassed: 'true',
    pushed: 'false',
    rebaseMovedHead: 'true',
    structured: {},
  });
  assert.match(body, /Push rejected/);
});

test('resolveFinishedBody: green gate, not pushed, head unmoved -> complete no-op', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'false',
    gatePassed: 'true',
    pushed: 'false',
    rebaseMovedHead: 'false',
    structured: {},
  });
  assert.match(body, /Rebase complete/);
  assert.match(body, /no changes after rebase/);
});

test('resolveFinishedBody: green gate, pushed -> complete', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'false',
    gatePassed: 'true',
    pushed: 'true',
    rebaseMovedHead: 'true',
    structured: { summary: 'done' },
    newHeadSha: NEW_SHA,
  });
  assert.match(body, /Rebase complete/);
});

test('repoBaseUrl strips the actions/runs suffix', () => {
  assert.equal(repoBaseUrl(RUN), 'https://example.com/owner/repo');
  assert.equal(repoBaseUrl(''), '');
});

test('isTrue matches boolean and string true', () => {
  assert.equal(isTrue(true), true);
  assert.equal(isTrue('true'), true);
  assert.equal(isTrue('false'), false);
  assert.equal(isTrue(undefined), false);
});

test('renderComplete surfaces unresolved review feedback presence when provided', () => {
  const body = renderComplete({
    headSha: SHA,
    baseRef: 'main',
    baseSha: BASE_SHA,
    runUrl: RUN,
    reviewFeedbackPresent: 'true',
    structured: {},
    updatedAt: TS,
  });
  assert.match(body, /Unresolved review feedback: present/);
});

test('renderComplete reports none when review feedback is absent', () => {
  const body = renderComplete({
    headSha: SHA,
    baseRef: 'main',
    baseSha: BASE_SHA,
    runUrl: RUN,
    reviewFeedbackPresent: 'false',
    structured: {},
    updatedAt: TS,
  });
  assert.match(body, /Unresolved review feedback: none/);
});
