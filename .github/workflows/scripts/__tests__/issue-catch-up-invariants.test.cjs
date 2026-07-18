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
  assert.match(content, /inert_bot_command/);
  assert.match(content, /stuck_fixable/);
  assert.match(content, /\[claude-health\] Issue-pipeline invariant findings/);
});
