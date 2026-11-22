/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Characterization of the issue-catch-up re-triage contract. Background: the
// agent used to post "/triage" (and rely on "/fix") comments authored by
// github-actions[bot] via GITHUB_TOKEN. GitHub never starts workflows from
// GITHUB_TOKEN events, so re-triage was a guaranteed no-op that still burned
// the attempt counter, and the dead-letter path then applied `needs-review`
// — terminal for project-manager's issue /fix route — leaving issues with no
// automated recovery at all (issue #771). These tests pin the repaired
// contract so it cannot silently regress.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(__dirname, '..', '..', 'issue-catch-up.yml');
const content = fs.readFileSync(workflowPath, 'utf8');

test('re-triage is dispatched via the workflow_dispatch API, not comments', () => {
  assert.match(content, /createWorkflowDispatch/);
  assert.match(content, /workflow_id:\s*'triage\.yml'/);
});

test('the agent prompt never instructs posting a /triage comment', () => {
  assert.ok(
    !content.includes('gh issue comment NUM --body "/triage"'),
    'agent prompt must not post /triage comments — bot-authored command comments never trigger workflows',
  );
});

test('triage dead letters park with triage-failed, never needs-review', () => {
  assert.match(content, /labels:\s*\['triage-failed'\]/);
  assert.ok(
    !/triage_dead_letter[\s\S]{0,400}--add-label "needs-review"/.test(content),
    'triage dead-letter path must not apply needs-review (terminal for the PM issue /fix route)',
  );
});

test('dispatch markers count as attempts and avoid the /triage trigger string', () => {
  assert.match(content, /<!-- re-triage-dispatch -->/);
  // The workflow embeds JS source, so the YAML file contains a literal
  // backslash-n inside the template string — the \\n here matches those two
  // characters in the file text, not a newline.
  const markerBodies = [
    ...content.matchAll(/re-triage-dispatch -->\\n([^`]*)`/g),
  ];
  // Guard the guard: if the marker body ever moves or is reformatted, this
  // must fail loudly instead of silently skipping the loop below.
  assert.ok(
    markerBodies.length > 0,
    'expected at least one re-triage-dispatch marker body in the workflow',
  );
  for (const [, body] of markerBodies) {
    assert.ok(
      !body.includes('/triage'),
      'marker comment must not contain "/triage" — a maintainer-authored comment with it would start a second triage run',
    );
  }
});

test('fresh-context retry counts same-second attempts (inclusive bound)', () => {
  // Comment timestamps have 1-second resolution; the retry marker and its
  // follow-up /fix often share a second. The attempt filter must be >=.
  assert.match(content, /getTime\(\)\s*>=\s*retryMarkerAt/);
});

test('dead-letter fresh-context retry resets the attempt counter', () => {
  assert.match(content, /afterRetry/);
  assert.match(content, /retryMarkerAt/);
});

test('the analyze agent runs with the PAT so /fix comments are real triggers', () => {
  const agentSection = content.slice(content.indexOf('analyze-and-act:'));
  assert.match(
    agentSection,
    /github-token:\s*\$\{\{\s*secrets\.GH_PAT\s*\}\}/,
    'run-zai must receive GH_PAT — with the default GITHUB_TOKEN, /fix comments are bot-authored and inert',
  );
});

test('priority escalation is decided after comments are fetched, never before recovery routing', () => {
  // The early-continue form of this bucket captured high/critical parked
  // dead letters on every sweep, hiding them from the dead-letter retry
  // branch forever (issue #759). Behavioral coverage lives in
  // issue-catch-up-collect.test.cjs; this pins the structural ordering.
  const firstEscalationPush = content.indexOf(
    'buckets.priority_escalation.push',
  );
  const commentsFetch = content.indexOf('listComments');
  assert.ok(firstEscalationPush > 0 && commentsFetch > 0);
  assert.ok(
    firstEscalationPush > commentsFetch,
    'priority_escalation must not be routed before the comments fetch — it would shadow dead-letter recovery',
  );
  assert.match(content, /priorityEscalationEligible/);
});

test('inert bot attempts waive the dead-letter cooldown; reminders are deduped', () => {
  assert.match(content, /allAttemptsInert/);
  assert.match(content, /shouldNudgePriority/);
});

test('pipeline invariants are collected and reported to the health tracker', () => {
  assert.match(content, /invariant_findings/);
  assert.match(content, /\[claude-health\] Issue-pipeline invariant findings/);
  // Detection/reporting live in the shared pure module; the workflow steps
  // must consume it rather than re-implement the logic inline.
  assert.match(
    content,
    /scripts\/lib\/issue-pipeline-invariants\.cjs/,
    'both invariant steps must consume the shared module',
  );
  const moduleConsumers = content.match(/issue-pipeline-invariants\.cjs/g);
  assert.ok(
    moduleConsumers && moduleConsumers.length >= 2,
    'categorize (detection) and report (rendering/dedup) steps both require the module',
  );
});

test('the invariant module carries the finding types and remediation fields', () => {
  const modulePath = path.resolve(
    __dirname,
    '..',
    'lib',
    'issue-pipeline-invariants.cjs',
  );
  const mod = require(modulePath);
  assert.equal(typeof mod.detectInertBotCommand, 'function');
  assert.equal(typeof mod.detectStuckFixable, 'function');
  assert.equal(typeof mod.findingsHash, 'function');
  assert.equal(typeof mod.renderFindingsReport, 'function');
  assert.equal(typeof mod.isUnchangedReport, 'function');

  // The workflow's categorize step passes the issue through verbatim; the
  // detector must accept the REST shape (label objects with .name).
  const inert = mod.detectInertBotCommand({
    issueNumber: 767,
    comments: [
      {
        user: { login: 'github-actions[bot]', type: 'Bot' },
        body: '/fix',
        created_at: '2026-07-15T20:38:50Z',
        html_url: 'https://github.com/o/r/issues/767#issuecomment-1',
        id: 1,
      },
    ],
  });
  assert.equal(inert.type, 'inert_bot_command');
  assert.equal(inert.trigger_path, 'catchup-phase6-autofix');
  assert.match(inert.action, /fix-issue\.yml/);

  // One /fix attempt, 10h after the issue was created.
  const fixAt = new Date(Date.now() - 20 * 3600000).toISOString();
  const stuck = mod.detectStuckFixable({
    issue: {
      number: 1061,
      title: 'stuck',
      labels: [{ name: 'triaged' }, { name: 'auto-fix' }, { name: 'medium' }],
      created_at: new Date(Date.now() - 30 * 3600000).toISOString(),
      body: '',
      state: 'open',
      user: { login: 'kostua16', type: 'User' },
    },
    comments: [],
    // The categorize step passes its retry-filtered /fix comments as
    // `fixComments`; a renamed parameter would silently fall back to the
    // empty default, so the count assertion below pins the contract.
    fixComments: [
      {
        user: { login: 'github-actions[bot]', type: 'Bot' },
        body: '/fix',
        created_at: fixAt,
      },
    ],
    activeFixRun: false,
    now: Date.now(),
  });
  assert.equal(stuck.type, 'stuck_fixable');
  assert.equal(stuck.fix_attempts, 1);
  assert.equal(stuck.last_fix_attempt_at, fixAt);
  assert.match(stuck.next_action, /dispatch fix-issue\.yml/);
});

test('stuck detection never sees an issue with an in-flight fix run', () => {
  // The sweep skips every issue in activeRuns at the top of its loop, so the
  // stuck detector only runs for issues without a run in flight — the call
  // site has no active-run state to forward (activeRuns.has(num) there would
  // always be false). Pin both facts structurally: the skip sits inside the
  // same loop body as the detector call, and the call site passes no
  // active-run state. The loop scoping matters — comparing raw first
  // occurrences anywhere in the YAML stays green even after the two strings
  // drift into different loops.
  const detectAt = content.indexOf('detectStuckFixable({');
  assert.notEqual(detectAt, -1, 'sweep must call the stuck detector');
  const loopStart = content.lastIndexOf(
    'for (const issue of allIssues)',
    detectAt,
  );
  assert.notEqual(
    loopStart,
    -1,
    'detector call must live in the categorize loop',
  );
  assert.ok(
    content
      .slice(loopStart, detectAt)
      .includes('if (activeRuns.has(num)) continue;'),
    'the loop containing the detector must skip active runs first',
  );
  const callEnd = content.indexOf('});', detectAt);
  assert.notEqual(callEnd, -1, 'detector call must be closed');
  assert.ok(
    !/activeRuns|activeFixRun/.test(content.slice(detectAt, callEnd)),
    'detector call site must not forward active-run state — the loop skip already excluded in-flight issues',
  );
});
