/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Behavioral tests for the issue-pipeline invariant module. Fixtures mirror
// the exact findings that piled up on the claude-health tracker (#814):
// #767 (2 inert bot commands, inert since 2026-07-15), #1061/#1062 (stuck
// 24h, 0 fix attempts), #835 (stuck 521h, 2 fix attempts) — lines that said
// when something last happened but never what to do about it.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BLOCKING_LABELS,
  MAX_REPORTED,
  detectInertBotCommand,
  detectStuckFixable,
  findingsHash,
  isUnchangedReport,
  renderFindingsReport,
} = require('../lib/issue-pipeline-invariants.cjs');

const BOT = { login: 'github-actions[bot]', type: 'Bot' };
const HUMAN = { login: 'kostua16', type: 'User' };

const NOW = new Date('2026-08-15T12:00:00.000Z').getTime();
function hoursAgo(n) {
  return new Date(NOW - n * 3600000).toISOString();
}
function daysAgo(n) {
  return new Date(NOW - n * 24 * 3600000).toISOString();
}

function makeIssue({ number, title, labels, createdAt, body = '', state = 'open', author }) {
  return {
    number,
    title,
    labels: labels.map((name) => ({ name })),
    created_at: createdAt,
    body,
    state,
    user: author || HUMAN,
  };
}

// ── detectInertBotCommand ────────────────────────────────────────────

test('exact #814 finding: #767 with two bot /fix commands reports sources, actor, trigger, action', () => {
  const comments = [
    { user: BOT, body: '/fix', created_at: '2026-07-15T19:00:00Z', html_url: 'https://github.com/o/r/issues/767#issuecomment-1', id: 1 },
    { user: BOT, body: 'Fix auto-authorized (catch-up workflow, attempt 1)', created_at: '2026-07-15T19:00:01Z' },
    { user: BOT, body: '/fix', created_at: '2026-07-15T20:38:50Z', html_url: 'https://github.com/o/r/issues/767#issuecomment-2', id: 2 },
  ];
  const f = detectInertBotCommand({ issueNumber: 767, comments });
  assert.ok(f);
  assert.equal(f.type, 'inert_bot_command');
  assert.equal(f.number, 767);
  assert.equal(f.count, 2);
  assert.equal(f.last_at, '2026-07-15T20:38:50Z');
  assert.equal(f.actor, 'github-actions[bot]');
  assert.equal(f.trigger_path, 'catchup-phase6-autofix');
  assert.match(f.action, /dispatch fix-issue\.yml via workflow_dispatch/);
  assert.equal(f.sources.length, 2);
  assert.equal(f.sources[1].url, 'https://github.com/o/r/issues/767#issuecomment-2');
  assert.equal(f.sources[1].actor, 'github-actions[bot]');
});

test('bot /triage command maps to the legacy re-triage path and triage dispatch action', () => {
  const comments = [
    { user: BOT, body: '/triage', created_at: daysAgo(30), html_url: 'u1', id: 1 },
  ];
  const f = detectInertBotCommand({ issueNumber: 742, comments });
  assert.equal(f.trigger_path, 'legacy-catchup-retriage');
  assert.match(f.action, /dispatch triage\.yml via workflow_dispatch/);
});

test('indented bot commands classify by their command, not unknown', () => {
  const comments = [
    { user: BOT, body: '  /fix', created_at: daysAgo(2), html_url: 'u1', id: 1 },
    { user: BOT, body: '\n/triage', created_at: daysAgo(1), html_url: 'u2', id: 2 },
  ];
  const fix = detectInertBotCommand({ issueNumber: 1, comments: comments.slice(0, 1) });
  assert.equal(fix.trigger_path, 'catchup-phase6-autofix');
  const triage = detectInertBotCommand({ issueNumber: 2, comments: comments.slice(1) });
  assert.equal(triage.trigger_path, 'legacy-catchup-retriage');
});

test('bot commands adjacent to dispatch markers are real dispatch echoes, not inert', () => {
  // Re-triage marker lands right after its trigger command.
  const retriage = [
    { user: BOT, body: '/triage', created_at: daysAgo(2), html_url: 'u1', id: 1 },
    { user: BOT, body: '<!-- re-triage-dispatch -->\nRe-triage dispatched via workflow_dispatch (attempt 2)', created_at: daysAgo(2) },
  ];
  assert.equal(detectInertBotCommand({ issueNumber: 1, comments: retriage }), null);

  // Dead-letter retry posts its marker immediately before the /fix.
  const retry = [
    { user: BOT, body: '<!-- dead-letter-retry --> One-time fresh-context retry', created_at: daysAgo(1) },
    { user: BOT, body: '/fix', created_at: daysAgo(1), html_url: 'u2', id: 2 },
  ];
  assert.equal(detectInertBotCommand({ issueNumber: 2, comments: retry }), null);

  // A marker two comments away does not vouch for the command.
  const far = [
    { user: BOT, body: '<!-- re-triage-dispatch -->', created_at: daysAgo(3) },
    { user: HUMAN, body: 'unrelated discussion', created_at: daysAgo(2) },
    { user: BOT, body: '/fix', created_at: daysAgo(1), html_url: 'u3', id: 3 },
  ];
  const f = detectInertBotCommand({ issueNumber: 3, comments: far });
  assert.ok(f, 'non-adjacent bot command is still inert');
  assert.equal(f.count, 1);
});

test('dispatch markers and maintainer commands are never inert findings', () => {
  const comments = [
    // A dispatch marker is bot-authored but contains no slash command — real
    // trigger, must not match.
    { user: BOT, body: '<!-- re-triage-dispatch -->\nRe-triage dispatched (attempt 2)', created_at: hoursAgo(3) },
    // Maintainer-authored /fix is a real trigger.
    { user: HUMAN, body: '/fix', created_at: hoursAgo(2) },
    // Bot prose that merely mentions /fix without starting with it.
    { user: BOT, body: 'the workflow would post /fix here', created_at: hoursAgo(1) },
  ];
  for (const issueNumber of [1, 2, 3]) {
    assert.equal(
      detectInertBotCommand({ issueNumber, comments }),
      null,
      `none of the legit comments may yield a finding (#${issueNumber})`,
    );
  }
});

test('no comments and no bot commands yield null', () => {
  assert.equal(detectInertBotCommand({ issueNumber: 1, comments: [] }), null);
  assert.equal(
    detectInertBotCommand({
      issueNumber: 1,
      comments: [{ user: HUMAN, body: '/triage', created_at: daysAgo(1) }],
    }),
    null,
  );
});

// ── detectStuckFixable ───────────────────────────────────────────────

const STUCK_LABELS = ['triaged', 'auto-fix', 'medium', 'maintenance'];

test('exact #814 finding: #1061 stuck 24h with zero attempts prescribes a fix dispatch', () => {
  const issue = makeIssue({ number: 1061, title: 'stuck fresh', labels: STUCK_LABELS, createdAt: hoursAgo(26) });
  const f = detectStuckFixable({ issue, comments: [], fixComments: [], activeFixRun: false, now: NOW });
  assert.ok(f);
  assert.equal(f.type, 'stuck_fixable');
  assert.equal(f.age_hours, 26);
  assert.equal(f.fix_attempts, 0);
  assert.equal(f.last_fix_attempt_at, null);
  assert.deepEqual(f.blocking_labels, []);
  assert.equal(f.linked_pr_state, 'none');
  assert.equal(f.owner, 'automation');
  assert.match(f.next_action, /dispatch fix-issue\.yml via workflow_dispatch/);
});

test('exact #814 finding: #835 stuck 521h with 2 attempts routes to the dead letter', () => {
  const issue = makeIssue({ number: 835, title: 'stuck forever', labels: STUCK_LABELS, createdAt: hoursAgo(521) });
  const comments = [
    { user: HUMAN, body: 'attempt context', created_at: daysAgo(20) },
    { user: BOT, body: 'Fix auto-authorized (attempt 2)', created_at: daysAgo(10) },
  ];
  const f = detectStuckFixable({ issue, comments, fixComments: [], activeFixRun: false, now: NOW });
  assert.ok(f);
  assert.equal(f.age_hours, 521);
  assert.equal(f.fix_attempts, 0);
  assert.equal(f.last_fix_attempt_at, null);
  assert.match(f.next_action, /dispatch fix-issue\.yml/);
});

test('attempt count and last-attempt timestamp come from the same retry-filtered list', () => {
  // The sweep resets the attempt budget at a dead-letter retry: the caller
  // passes only post-retry /fix comments, and the module derives both
  // fix_attempts and last_fix_attempt_at from that list — pre-retry history
  // cannot resurface as a "last attempt" that contradicts the count.
  const issue = makeIssue({ number: 836, title: 'retried', labels: STUCK_LABELS, createdAt: hoursAgo(600) });
  const comments = [
    { user: BOT, body: '/fix pre-retry attempt 1', created_at: daysAgo(30) },
    { user: BOT, body: '<!-- dead-letter-retry --> One-time fresh-context retry', created_at: daysAgo(3) },
    { user: BOT, body: '/fix', created_at: daysAgo(3) },
  ];
  const fixComments = comments.slice(2);
  const f = detectStuckFixable({ issue, comments, fixComments, activeFixRun: false, now: NOW });
  assert.ok(f);
  assert.equal(f.fix_attempts, 1);
  assert.equal(f.last_fix_attempt_at, comments[2].created_at);
  assert.notEqual(f.last_fix_attempt_at, comments[0].created_at);
  assert.match(f.next_action, /dispatch fix-issue\.yml/);
});

test('blocking labels change the next action to a maintainer unblock and are reported, not dropped', () => {
  const issue = makeIssue({
    number: 900,
    title: 'parked stuck',
    labels: [...STUCK_LABELS, 'needs-review'],
    createdAt: hoursAgo(100),
  });
  const f = detectStuckFixable({ issue, comments: [], fixComments: [], activeFixRun: false, now: NOW });
  assert.deepEqual(f.blocking_labels, ['needs-review']);
  assert.match(f.next_action, /maintainer unblocks \(needs-review\)/);
});

test('auto-fix label marks automation ownership (repo convention: label, not author type)', () => {
  // The sweep's own authorization check treats the auto-fix label as the
  // authorship marker; the detector requires it, so a human-authored issue
  // that triage marked auto-fix is automation-owned for unsticking purposes.
  const issue = makeIssue({
    number: 901,
    title: 'human stuck',
    labels: ['triaged', 'auto-fix', 'low'],
    createdAt: hoursAgo(48),
  });
  const f = detectStuckFixable({ issue, comments: [], fixComments: [], activeFixRun: false, now: NOW });
  assert.equal(f.owner, 'automation');
  assert.match(f.next_action, /dispatch fix-issue\.yml/);
  // Maintainer involvement surfaces through blocking labels instead — an
  // owner branch cannot exist because auto-fix is a hard prerequisite.
  const blocked = makeIssue({
    number: 901,
    title: 'human stuck',
    labels: ['triaged', 'auto-fix', 'low', 'security'],
    createdAt: hoursAgo(48),
  });
  const fb = detectStuckFixable({ issue: blocked, comments: [], fixComments: [], activeFixRun: false, now: NOW });
  assert.equal(fb.owner, 'automation');
  assert.deepEqual(fb.blocking_labels, ['security']);
  assert.match(fb.next_action, /maintainer unblocks \(security\)/);
});

test('last fix attempt timestamp is the most recent counted /fix comment', () => {
  const issue = makeIssue({ number: 902, title: 'attempts', labels: STUCK_LABELS, createdAt: hoursAgo(72) });
  const comments = [
    { user: BOT, body: '/fix attempt 1', created_at: daysAgo(2) },
    { user: BOT, body: '/fix attempt 2', created_at: daysAgo(1) },
  ];
  const f = detectStuckFixable({ issue, comments, fixComments: comments, activeFixRun: false, now: NOW });
  assert.equal(f.fix_attempts, 2);
  assert.equal(f.last_fix_attempt_at, daysAgo(1));
  assert.match(f.next_action, /fix dead-letter/);
});

// False-positive matrix: every exclusion path returns null.
test('stuck_fixable false positives are excluded', () => {
  const base = { comments: [], fixComments: [], activeFixRun: false, now: NOW };
  const cases = {
    'closed issue': makeIssue({ number: 1, title: 'x', labels: STUCK_LABELS, createdAt: hoursAgo(48), state: 'closed' }),
    'tracking issue (claude-health title)': makeIssue({ number: 2, title: '[claude-health] tracker', labels: STUCK_LABELS, createdAt: hoursAgo(48) }),
    'tracking issue (keep-open label)': makeIssue({ number: 3, title: 'x', labels: [...STUCK_LABELS, 'keep-open'], createdAt: hoursAgo(48) }),
    'exempt backlog label': makeIssue({ number: 4, title: 'x', labels: [...STUCK_LABELS, 'backlog'], createdAt: hoursAgo(48) }),
    'in-progress label': makeIssue({ number: 5, title: 'x', labels: [...STUCK_LABELS, 'in-progress'], createdAt: hoursAgo(48) }),
    'fixed label': makeIssue({ number: 6, title: 'x', labels: [...STUCK_LABELS, 'fixed'], createdAt: hoursAgo(48) }),
    'linked PR via Fixes': makeIssue({ number: 7, title: 'x', labels: STUCK_LABELS, createdAt: hoursAgo(48), body: 'Fixes #123' }),
    'linked PR via pull/ url': makeIssue({ number: 8, title: 'x', labels: STUCK_LABELS, createdAt: hoursAgo(48), body: 'see https://github.com/o/r/pull/42' }),
    'younger than 24h': makeIssue({ number: 9, title: 'x', labels: STUCK_LABELS, createdAt: hoursAgo(23) }),
    'not triaged': makeIssue({ number: 10, title: 'x', labels: ['auto-fix', 'medium'], createdAt: hoursAgo(48) }),
    'no auto-fix label': makeIssue({ number: 11, title: 'x', labels: ['triaged', 'medium'], createdAt: hoursAgo(48) }),
    'no priority label': makeIssue({ number: 12, title: 'x', labels: ['triaged', 'auto-fix'], createdAt: hoursAgo(48) }),
  };
  for (const [name, issue] of Object.entries(cases)) {
    assert.equal(detectStuckFixable({ ...base, issue }), null, name);
  }
  assert.equal(
    detectStuckFixable({ ...base, issue: makeIssue({ number: 13, title: 'x', labels: STUCK_LABELS, createdAt: hoursAgo(48) }), activeFixRun: true }),
    null,
    'active fix run',
  );
  assert.equal(detectStuckFixable({ ...base, issue: null }), null, 'null issue');
});

test('linked PR found in comments also excludes the finding', () => {
  const issue = makeIssue({ number: 14, title: 'x', labels: STUCK_LABELS, createdAt: hoursAgo(48) });
  const f = detectStuckFixable({
    issue,
    comments: [{ user: HUMAN, body: 'PR: #77 relevant', created_at: daysAgo(1) }],
    fixComments: [],
    activeFixRun: false,
    now: NOW,
  });
  assert.equal(f, null);
});

// ── findingsHash ─────────────────────────────────────────────────────

test('hash is stable across volatile drift (age ticks, timestamps, urls, order)', () => {
  const a = [
    { type: 'inert_bot_command', number: 767, count: 2, last_at: '2026-07-15T20:38:50Z', sources: [{ url: 'u1' }], actor: 'github-actions[bot]', trigger_path: 'catchup-phase6-autofix', action: 'act' },
    { type: 'stuck_fixable', number: 1061, age_hours: 24, fix_attempts: 0, last_fix_attempt_at: null, blocking_labels: [], owner: 'automation', next_action: 'dispatch' },
  ];
  const b = [
    { type: 'stuck_fixable', number: 1061, age_hours: 521, fix_attempts: 0, last_fix_attempt_at: 'later', blocking_labels: [], owner: 'maintainer', next_action: 'dispatch' },
    { type: 'inert_bot_command', number: 767, count: 2, last_at: '2026-08-15T11:00:00Z', sources: [{ url: 'uDIFFERENT' }], actor: 'x', trigger_path: 'catchup-phase6-autofix', action: 'act' },
  ];
  assert.equal(findingsHash(a), findingsHash(b));
});

test('hash changes when the actionable state changes', () => {
  const base = [{ type: 'inert_bot_command', number: 767, count: 2, trigger_path: 'catchup-phase6-autofix', action: 'act' }];
  const variants = {
    'new finding': [...base, { type: 'inert_bot_command', number: 768, count: 1, trigger_path: 'legacy-catchup-retriage', action: 'act' }],
    'count changed': [{ type: 'inert_bot_command', number: 767, count: 3, trigger_path: 'catchup-phase6-autofix', action: 'act' }],
    'action changed': [{ type: 'inert_bot_command', number: 767, count: 2, trigger_path: 'catchup-phase6-autofix', action: 'DIFFERENT' }],
    'attempts changed': [{ type: 'stuck_fixable', number: 835, fix_attempts: 3, blocking_labels: [], next_action: 'x' }],
    'blocking label added': [{ type: 'stuck_fixable', number: 835, fix_attempts: 2, blocking_labels: ['needs-review'], next_action: 'x' }],
    'next action changed': [{ type: 'stuck_fixable', number: 835, fix_attempts: 2, blocking_labels: [], next_action: 'DIFFERENT' }],
  };
  for (const [name, findings] of Object.entries(variants)) {
    assert.notEqual(findingsHash(base), findingsHash(findings), name);
  }
});

// ── renderFindingsReport ─────────────────────────────────────────────

test('report lines carry remediation metadata (the #814 ask)', () => {
  const findings = [
    detectInertBotCommand({
      issueNumber: 767,
      comments: [
        { user: BOT, body: '/fix', created_at: daysAgo(30), html_url: 'https://github.com/o/r/issues/767#issuecomment-9', id: 9 },
        { user: BOT, body: '/fix', created_at: daysAgo(29), html_url: 'https://github.com/o/r/issues/767#issuecomment-10', id: 10 },
      ],
    }),
    detectStuckFixable({
      issue: makeIssue({ number: 1062, title: 'fresh stuck', labels: STUCK_LABELS, createdAt: hoursAgo(30) }),
      comments: [],
      fixComments: [],
      activeFixRun: false,
      now: NOW,
    }),
  ];
  const report = renderFindingsReport({ findings, generatedAt: '2026-08-15T12:00:00.000Z' });
  assert.ok(report);
  assert.match(report.body, /<!-- invariant-findings:[0-9a-f]{16} -->/);
  const inertLine = report.body.split('\n').find((l) => l.includes('#767'));
  assert.ok(inertLine);
  assert.match(inertLine, /#issuecomment-10\)/);
  assert.match(inertLine, /github-actions\[bot\]/);
  assert.match(inertLine, /catchup-phase6-autofix/);
  assert.match(inertLine, /\*\*action\*\*: dispatch fix-issue\.yml/);
  const stuckLine = report.body.split('\n').find((l) => l.includes('#1062'));
  assert.match(stuckLine, /no real attempt yet/);
  assert.match(stuckLine, /owner: automation/);
  assert.match(stuckLine, /\*\*next\*\*: dispatch fix-issue\.yml/);
});

test('empty findings render null (nothing posted)', () => {
  assert.equal(renderFindingsReport({ findings: [], generatedAt: 'x' }), null);
});

test('report caps at 50 findings with an overflow line', () => {
  const findings = Array.from({ length: MAX_REPORTED + 7 }, (_, i) => ({
    type: 'inert_bot_command',
    number: 1000 + i,
    count: 1,
    trigger_path: 'legacy-catchup-retriage',
    action: 'act',
    sources: [],
  }));
  const report = renderFindingsReport({ findings, generatedAt: 'x' });
  const reportedLines = report.body.split('\n').filter((l) => l.startsWith('- #'));
  assert.equal(reportedLines.length, MAX_REPORTED);
  assert.match(report.body, /…and 7 more finding\(s\)/);
});

test('isUnchangedReport matches the marker in the latest tracker comment', () => {
  const report = renderFindingsReport({
    findings: [{ type: 'inert_bot_command', number: 1, count: 1, trigger_path: 'x', action: 'y' }],
    generatedAt: 'x',
  });
  assert.equal(isUnchangedReport({ latestBody: report.body, marker: report.marker }), true);
  assert.equal(isUnchangedReport({ latestBody: 'unrelated', marker: report.marker }), false);
  assert.equal(isUnchangedReport({ latestBody: report.body, marker: null }), false);
});

test('BLOCKING_LABELS contract stays the reported hold set', () => {
  assert.deepEqual([...BLOCKING_LABELS].sort(), ['critical', 'needs-review', 'security', 'triage-failed']);
});
