/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Behavioral characterization of the issue-catch-up collect job's bucket
// routing. Executes the real embedded github-script source against fixture
// issues, because the routing bugs this pins were invisible to text-level
// assertions: the priority_escalation bucket used to capture high/critical
// parked dead letters before the dead-letter retry branch could run, which
// both spammed the reminder comment hourly and made the one-shot
// fresh-context retry unreachable forever (issue #759).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workflowPath = path.join(
  repoRoot,
  '.github',
  'workflows',
  'issue-catch-up.yml',
);

// Extract the "Fetch and categorize open issues" github-script body by
// indentation: the `script: |` scalar sits at 10 spaces, its body at >=12.
function extractCollectScript() {
  const lines = fs.readFileSync(workflowPath, 'utf8').split('\n');
  const stepIdx = lines.findIndex((l) =>
    l.includes('name: Fetch and categorize open issues'),
  );
  assert.ok(stepIdx >= 0, 'collect step not found in issue-catch-up.yml');
  const scriptIdx = lines.findIndex(
    (l, i) => i > stepIdx && l.trim() === 'script: |',
  );
  assert.ok(scriptIdx > stepIdx, 'script block not found for collect step');
  const bodyIndent = 12;
  const body = [];
  for (let i = scriptIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (line.search(/\S/) < bodyIndent) break;
    body.push(line.slice(bodyIndent));
  }
  assert.ok(body.length > 50, 'extracted script body suspiciously short');
  return body.join('\n');
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}
function hoursAgo(n) {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

function makeIssue({ number, title, labels, createdAt, body = '', author }) {
  return {
    number,
    title,
    labels: labels.map((name) => ({ name })),
    created_at: createdAt,
    body,
    user: author || { login: 'kostua16', type: 'User' },
  };
}

const bot = { login: 'github-actions[bot]', type: 'Bot' };

async function runCollect({ issues, commentsByIssue }) {
  const script = extractCollectScript();
  const outputs = {};
  const core = {
    info: () => {},
    warning: () => {},
    setOutput: (k, v) => {
      outputs[k] = v;
    },
  };
  const github = {
    rest: {
      issues: {
        listForRepo: async ({ page }) => ({ data: page === 1 ? issues : [] }),
        listComments: async ({ issue_number: num }) => ({
          data: commentsByIssue[num] || [],
        }),
      },
      actions: {
        listWorkflowRunsForRepo: async () => ({ data: { workflow_runs: [] } }),
      },
      repos: {
        listBranches: async () => ({ data: [] }),
      },
    },
  };
  const context = { repo: { owner: 'test-owner', repo: 'test-repo' } };
  const prevWorkspace = process.env.GITHUB_WORKSPACE;
  process.env.GITHUB_WORKSPACE = repoRoot;
  try {
    const fn = new Function(
      'github',
      'context',
      'core',
      'require',
      `return (async () => {\n${script}\n})();`,
    );
    await fn(github, context, core, require);
  } finally {
    if (prevWorkspace === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = prevWorkspace;
  }
  assert.ok(
    outputs.categorized,
    'collect script produced no categorized output',
  );
  return JSON.parse(outputs.categorized);
}

const PARK_COMMENT =
  'Triage attempted 2x without success. Manual review needed.';
const NUDGE_COMMENT =
  "⚠️ Priority issue awaiting attention for >48h. Consider adding 'in-progress' label or assigning.";

test('high parked dead letter with only inert bot attempts reaches dead_letter_retry immediately', async () => {
  // Issue #759's exact shape: high + needs-review, untriaged, two /triage
  // comments that were bot-authored (inert — never started a run), parked
  // less than 7 days ago, buried under hourly reminder comments.
  const issue = makeIssue({
    number: 759,
    title: 'MNT-E01: Runner disk-usage sweep with cleanup dispatch',
    labels: ['auto-fix', 'needs-review', 'high', 'umbrella-sub-issue'],
    createdAt: daysAgo(4),
  });
  const buckets = await runCollect({
    issues: [issue],
    commentsByIssue: {
      759: [
        { user: bot, body: '/triage', created_at: daysAgo(4) },
        { user: bot, body: '/triage', created_at: daysAgo(3.5) },
        { user: bot, body: PARK_COMMENT, created_at: daysAgo(3) },
        { user: bot, body: NUDGE_COMMENT, created_at: hoursAgo(2) },
      ],
    },
  });
  assert.equal(buckets.dead_letter_retry.length, 1);
  assert.equal(buckets.dead_letter_retry[0].number, 759);
  assert.equal(buckets.dead_letter_retry[0].kind, 'triage');
  assert.equal(
    buckets.priority_escalation.length,
    0,
    'escalation must not shadow the dead-letter retry path',
  );
});

test('a real dispatch attempt keeps the 7-day cooldown, escalation fires as deduped fallback', async () => {
  // One attempt is a re-triage dispatch marker (a real workflow_dispatch
  // happened), so the transient-failure cooldown applies. With the retry
  // declined and the last nudge >24h old, the human nudge is the fallback.
  const issue = makeIssue({
    number: 801,
    title: 'high issue with one real triage attempt',
    labels: ['auto-fix', 'needs-review', 'high'],
    createdAt: daysAgo(4),
  });
  const buckets = await runCollect({
    issues: [issue],
    commentsByIssue: {
      801: [
        { user: bot, body: '/triage', created_at: daysAgo(4) },
        {
          user: bot,
          body: '<!-- re-triage-dispatch -->\nRe-triage dispatched (attempt 2)',
          created_at: daysAgo(3.5),
        },
        { user: bot, body: PARK_COMMENT, created_at: daysAgo(3) },
        { user: bot, body: NUDGE_COMMENT, created_at: daysAgo(2) },
      ],
    },
  });
  assert.equal(
    buckets.dead_letter_retry.length,
    0,
    'real failed attempts must wait out the 7-day cooldown',
  );
  assert.equal(buckets.priority_escalation.length, 1);
  assert.equal(buckets.priority_escalation[0].number, 801);
});

test('the priority reminder is posted at most once per day', async () => {
  const issue = makeIssue({
    number: 802,
    title: 'high issue already nudged this hour',
    labels: ['auto-fix', 'needs-review', 'high'],
    createdAt: daysAgo(4),
  });
  const buckets = await runCollect({
    issues: [issue],
    commentsByIssue: {
      802: [
        { user: bot, body: '/triage', created_at: daysAgo(4) },
        {
          user: bot,
          body: '<!-- re-triage-dispatch -->\nRe-triage dispatched (attempt 2)',
          created_at: daysAgo(3.5),
        },
        { user: bot, body: PARK_COMMENT, created_at: daysAgo(3) },
        { user: bot, body: NUDGE_COMMENT, created_at: hoursAgo(1) },
      ],
    },
  });
  assert.equal(buckets.dead_letter_retry.length, 0);
  assert.equal(
    buckets.priority_escalation.length,
    0,
    'a reminder posted <24h ago must suppress the next one',
  );
});

test('unparked high untriaged issue routes to re-triage, not escalation', async () => {
  // Automated recovery supersedes reminders: an untriaged issue that is not
  // parked gets a real workflow_dispatch re-triage instead of comment spam.
  const issue = makeIssue({
    number: 803,
    title: 'high issue never triaged',
    labels: ['auto-fix', 'high'],
    createdAt: daysAgo(3),
  });
  const buckets = await runCollect({
    issues: [issue],
    commentsByIssue: { 803: [] },
  });
  assert.equal(buckets.needs_retriage.length, 1);
  assert.equal(buckets.needs_retriage[0].number, 803);
  assert.equal(buckets.priority_escalation.length, 0);
});

test('manually parked high issue without a dead-letter comment gets the nudge, not re-triage', async () => {
  // needs-review without an "attempted 2x" comment is a human park — the
  // sweep must neither re-triage it nor go silent, so the deduped reminder
  // is the only action.
  const issue = makeIssue({
    number: 804,
    title: 'high issue parked by a maintainer',
    labels: ['needs-review', 'high'],
    createdAt: daysAgo(3),
  });
  const buckets = await runCollect({
    issues: [issue],
    commentsByIssue: { 804: [] },
  });
  assert.equal(buckets.priority_escalation.length, 1);
  assert.equal(buckets.priority_escalation[0].number, 804);
  assert.equal(buckets.needs_retriage.length, 0);
  assert.equal(buckets.dead_letter_retry.length, 0);
});

test('inert-attempt waiver never bypasses the one-shot retry marker', async () => {
  // A dead letter that already consumed its fresh-context retry must stay
  // parked even when its pre-retry attempts were all inert.
  const issue = makeIssue({
    number: 805,
    title: 'high dead letter that already used its retry',
    labels: ['auto-fix', 'needs-review', 'high'],
    createdAt: daysAgo(5),
  });
  const buckets = await runCollect({
    issues: [issue],
    commentsByIssue: {
      805: [
        { user: bot, body: '/triage', created_at: daysAgo(5) },
        { user: bot, body: '/triage', created_at: daysAgo(4.5) },
        { user: bot, body: PARK_COMMENT, created_at: daysAgo(4) },
        {
          user: bot,
          body: '<!-- dead-letter-retry --> One-time fresh-context retry.',
          created_at: daysAgo(2),
        },
        { user: bot, body: PARK_COMMENT, created_at: daysAgo(1) },
      ],
    },
  });
  assert.equal(
    buckets.dead_letter_retry.length,
    0,
    'the retry marker caps fresh-context retries at one, waiver or not',
  );
});
