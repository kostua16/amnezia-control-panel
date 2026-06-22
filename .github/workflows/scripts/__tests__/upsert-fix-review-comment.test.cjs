/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMENT_MARKER,
  isTrue,
  repoBaseUrl,
  renderStarted,
  renderWorking,
  renderSkipped,
  renderNoChanges,
  renderPushRejected,
  renderValidationFailed,
  renderFailed,
  renderCancelled,
  renderComplete,
  resolveFinishedBody,
} = require('../upsert-fix-review-comment.cjs');

const SHA = 'e699b0871d0379b5c32afbe977f4f70aef57a39d';
const RUN = 'https://example.com/owner/repo/actions/runs/1';

test('renderStarted prefixes marker, command and head SHA', () => {
  const body = renderStarted({
    headSha: SHA,
    runUrl: RUN,
    command: '/fix-review',
    startedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, new RegExp(`^${COMMENT_MARKER}`));
  assert.match(body, /Review fix started/);
  assert.match(body, /Command: `\/fix-review`/);
  assert.match(body, /`e699b0871d03`/);
  assert.match(body, /2026-06-17T00:00:00\.000Z/);
});

test('renderWorking shows the applying-fixs state', () => {
  const body = renderWorking({
    headSha: SHA,
    runUrl: RUN,
    command: '/address-review',
    updatedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, /Applying review fixes/);
  assert.match(body, /Command: `\/address-review`/);
});

test('renderSkipped quotes a reason and hints re-run', () => {
  const body = renderSkipped({
    headSha: SHA,
    runUrl: RUN,
    reason: 'cross-repository PR',
    updatedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, /Review fix skipped/);
  assert.match(body, /cross-repository PR/);
  assert.match(body, /Re-run `\/fix-review`/);
});

test('renderNoChanges states no actionable findings', () => {
  const body = renderNoChanges({
    headSha: SHA,
    runUrl: RUN,
    command: '/fix-review',
    structured: { summary: 'all good' },
    updatedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, /No changes needed/);
  assert.match(body, /> all good/);
});

test('renderPushRejected lists attempted changes and forbids force-push', () => {
  const body = renderPushRejected({
    headSha: SHA,
    runUrl: RUN,
    command: '/fix-review',
    structured: { changed_files: ['src/a.ts', 'src/b.ts'] },
    updatedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, /Push rejected \(non-fast-forward\)/);
  assert.match(body, /never\s+force-pushes/);
  assert.match(body, /Attempted changes \(2\)/);
  assert.match(body, /- src\/a\.ts/);
});

test('renderValidationFailed shows dual-block: agent-reported + authoritative gate', () => {
  const body = renderValidationFailed({
    headSha: SHA,
    runUrl: RUN,
    command: '/fix-review',
    structured: {
      changed_files: ['src/a.ts'],
      validation: { tsc: 'pass', lint: 'pass', build: 'pass' },
    },
    gateOutcomes: {
      lint: 'failure',
      test: 'success',
      build: 'skipped',
      scriptTests: 'success',
      prismaSafe: 'success',
    },
    updatedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, /Validation failed — fixes not pushed/);
  assert.match(body, /NOT pushed/);
  // Banner + both labelled blocks present.
  assert.match(body, /Agent self-reported checks can be inaccurate/);
  assert.match(body, /Agent-reported \(may be inaccurate\):/);
  assert.match(body, /Workflow gate \(authoritative\):/);
  // Agent-reported values come from structured.validation.
  assert.match(body, /- lint: \*\*pass\*\*/);
  // Authoritative gate values are normalized (failure -> fail).
  assert.match(body, /- lint \(tracked files\): \*\*fail\*\*/);
  assert.match(body, /- build: \*\*skipped\*\*/);
});

test('renderValidationFailed omits the agent block when none was reported', () => {
  const body = renderValidationFailed({
    headSha: SHA,
    runUrl: RUN,
    command: '/fix-review',
    structured: { changed_files: ['src/a.ts'] },
    gateOutcomes: {
      lint: 'success',
      test: 'failure',
      build: 'success',
      scriptTests: 'success',
      prismaSafe: 'success',
    },
    updatedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, /Workflow gate \(authoritative\):/);
  assert.match(body, /- unit tests: \*\*fail\*\*/);
  assert.doesNotMatch(body, /Agent-reported/);
});

test('renderFailed uses the provided reason', () => {
  const body = renderFailed({
    headSha: SHA,
    runUrl: RUN,
    failReason: 'claude-code-action step failed',
    updatedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, /Review fix failed/);
  assert.match(body, /claude-code-action step failed/);
});

test('renderCancelled explains the cancellation', () => {
  const body = renderCancelled({
    headSha: SHA,
    runUrl: RUN,
    updatedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, /Review fix cancelled/);
  assert.match(body, /timeout|superseded/);
  assert.doesNotMatch(body, /Review fixes applied/);
});

test('renderComplete renders summary, files, findings, commit link and automerge note', () => {
  const body = renderComplete({
    structured: {
      summary: 'fixed the null check',
      changed_files: ['src/auth.ts'],
      findings_addressed: [{ file: 'src/auth.ts', change: 'guard user' }],
      findings_skipped: [{ file: 'README.md', reason: 'nit' }],
    },
    numTurns: '12',
    headSha: SHA,
    runUrl: RUN,
    command: '/fix-review',
    commitSha: 'abcdef1234567890',
    commitUrl: 'https://example.com/owner/repo/commit/abcdef1234567890',
    automergeDisabled: 'true',
    updatedAt: '2026-06-17T00:00:00.000Z',
  });
  assert.match(body, /Review fixes applied/);
  assert.match(body, /> fixed the null check/);
  assert.match(body, /Changed files \(1\)/);
  assert.match(
    body,
    /\[abcdef123456\]\(https:\/\/example\.com\/owner\/repo\/commit\/abcdef1234567890\)/,
  );
  assert.match(body, /Findings addressed \(1\)/);
  assert.match(body, /Findings skipped \(1\)/);
  assert.match(body, /Turns: 12/);
  assert.match(body, /Auto-merge was disabled/);
});

test('resolveFinishedBody: cancelled wins over everything', () => {
  const body = resolveFinishedBody({
    outcome: 'cancelled',
    failed: 'true',
    hasChanges: 'true',
    gatePassed: 'false',
    pushed: 'true',
    structured: {},
  });
  assert.match(body, /Review fix cancelled/);
});

test('resolveFinishedBody: Claude hard-failure beats a passing gate', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'true',
    failReason: 'api error',
    hasChanges: 'true',
    gatePassed: 'true',
    pushed: 'true',
    structured: {},
  });
  assert.match(body, /Review fix failed/);
  assert.match(body, /api error/);
});

test('resolveFinishedBody: clean no-op (has_changes=false) -> no-changes, gate skipped', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'false',
    hasChanges: 'false',
    gatePassed: 'false',
    pushed: 'false',
    structured: {},
  });
  assert.match(body, /No changes needed/);
});

test('resolveFinishedBody: gate failure -> validation-failed, not pushed', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'false',
    hasChanges: 'true',
    gatePassed: 'false',
    pushed: 'false',
    gateOutcomes: {
      lint: 'failure',
      test: 'success',
      build: 'success',
      scriptTests: 'success',
      prismaSafe: 'success',
    },
    structured: { changed_files: ['a.ts'] },
  });
  assert.match(body, /Validation failed/);
  assert.match(body, /Workflow gate \(authoritative\):/);
});

test('resolveFinishedBody: green gate, not pushed, with changes -> push-rejected', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'false',
    hasChanges: 'true',
    gatePassed: 'true',
    pushed: 'false',
    structured: { changed_files: ['a.ts'] },
  });
  assert.match(body, /Push rejected/);
});

test('resolveFinishedBody: green gate, not pushed, no changed_files -> no-changes', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'false',
    hasChanges: 'true',
    gatePassed: 'true',
    pushed: 'false',
    structured: {},
  });
  assert.match(body, /No changes needed/);
});

test('resolveFinishedBody: green gate, pushed -> complete', () => {
  const body = resolveFinishedBody({
    outcome: 'success',
    failed: 'false',
    hasChanges: 'true',
    gatePassed: 'true',
    pushed: 'true',
    structured: { summary: 'done' },
    commitSha: '1234567890abcdef',
    commitUrl: 'https://example.com/owner/repo/commit/1234567890abcdef',
  });
  assert.match(body, /Review fixes applied/);
});

test('repoBaseUrl strips the actions/runs suffix', () => {
  assert.equal(repoBaseUrl(RUN), 'https://example.com/owner/repo');
  assert.equal(repoBaseUrl(''), '');
});

test('isTrue matches boolean and string true', () => {
  assert.equal(isTrue(true), true);
  assert.equal(isTrue('true'), true);
  assert.equal(isTrue(false), false);
  assert.equal(isTrue('false'), false);
  assert.equal(isTrue(undefined), false);
});
