/* eslint-disable @typescript-eslint/no-require-imports */
// E2E scenario tests for PR #651 recovery/autonomy flows.
// Covers: P9b fleet back-pressure (composite action contract),
// G6 deferred proposal promotion lifecycle, G8 restore on unmerged close,
// P14 disk-pressure self-heal detection, PM37 CI cancelled rerun, PM38
// flow/review-failed escalation. See docs/workflow-e2e-scenarios.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const NOW = '2026-07-01T10:00:00.000Z';
const BLOCKED_96H_AGO = '2026-06-27T10:00:00.000Z';

function projectManagerPr(overrides = {}) {
  return {
    number: 99,
    title: 'fix: something',
    url: 'https://example.test/pull/99',
    labels: [],
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'fix-branch',
    headRefOid: 'abc123',
    baseRefName: 'main',
    mergeable: 'MERGEABLE',
    checkStatus: { status: 'pending' },
    updatedAt: '2026-07-01T09:00:00.000Z',
    headCommittedAt: '2026-07-01T09:00:00.000Z',
    ...overrides,
  };
}

function projectManagerPlan(pr, options = {}) {
  const pm = require('../project-manager.cjs');
  return pm.buildPlan(
    {
      now: NOW,
      openPrCount: 1,
      openIssueCount: 0,
      openPullRequests: [pr],
      openIssues: [],
      workflowRuns: options.workflowRuns ?? [],
    },
    { route: 'prs', now: NOW },
  );
}

// ---------------------------------------------------------------------------
// P9b — Fleet back-pressure composite action structural contract
// ---------------------------------------------------------------------------
const ACTION_PATH = path.resolve(
  __dirname,
  '../../../actions/fleet-back-pressure/action.yml',
);

test('P9b: fleet-back-pressure action.yml exists and declares required inputs', () => {
  assert.ok(fs.existsSync(ACTION_PATH), 'action.yml must exist');
  const content = fs.readFileSync(ACTION_PATH, 'utf8');

  assert.match(content, /inputs:/, 'must have inputs section');
  assert.match(content, /github-token:/, 'must require github-token input');
  assert.match(
    content,
    /max-open-automation-prs:/,
    'must expose max-open-automation-prs input',
  );
});

test('P9b: fleet-back-pressure action declares skip output wired to pending', () => {
  const content = fs.readFileSync(ACTION_PATH, 'utf8');

  assert.match(content, /outputs:/, 'must have outputs section');
  // The composite action's skip output is wired from the inner step's
  // "pending" field (the script uses "pending" as the skip gate key).
  assert.match(
    content,
    /skip:[\s\S]*?steps\.\w+\.outputs\.pending/,
    'skip output must be wired to inner step pending output',
  );
});

test('P9b: fleet-back-pressure action uses check-pending-automation-pr.cjs', () => {
  const content = fs.readFileSync(ACTION_PATH, 'utf8');

  assert.match(
    content,
    /check-pending-automation-pr\.cjs/,
    'must invoke the back-pressure check script',
  );
});

// ---------------------------------------------------------------------------
// P9b — All 5 workflows reference the composite action (not inline blocks)
// ---------------------------------------------------------------------------
const FLEET_GATE_WORKFLOWS = [
  'audit-auto-prs.yml',
  'audit-fix.yml',
  'docs-drift.yml',
  'gsd-planning-execute.yml',
  'workflow-health-optimize.yml',
  'monitor-amnezia-control-panel-github-runs.yml',
];

test('P9b: all fleet-gate workflows use the composite action', () => {
  for (const wf of FLEET_GATE_WORKFLOWS) {
    const wfPath = path.resolve(__dirname, `../../${wf}`);
    assert.ok(fs.existsSync(wfPath), `${wf} must exist`);
    const content = fs.readFileSync(wfPath, 'utf8');

    assert.match(
      content,
      /uses: \.\/\.github\/actions\/fleet-back-pressure/,
      `${wf} must use the fleet-back-pressure composite action`,
    );
    // Must NOT contain the old inline script invocation
    assert.ok(
      !content.includes('check-pending-automation-pr.cjs'),
      `${wf} must not contain the old inline check-pending-automation-pr.cjs`,
    );
  }
});

test('P9b: fleet-gate job output maps to composite action skip output', () => {
  for (const wf of FLEET_GATE_WORKFLOWS) {
    const content = fs.readFileSync(
      path.resolve(__dirname, `../../${wf}`),
      'utf8',
    );
    // Job output must reference the step's skip output
    assert.match(
      content,
      /skip: \$\{\{ steps\.\w+\.outputs\.skip \}\}/,
      `${wf} fleet-gate outputs.skip must come from composite action step`,
    );
  }
});

test('audit-fix reports fleet-gate failures and audit-fix cancellations', () => {
  const content = fs.readFileSync(
    path.resolve(__dirname, '../../audit-fix.yml'),
    'utf8',
  );

  assert.match(
    content,
    /report-failure:\n\s+needs: \[fleet-gate, audit-fix\]/,
    'report-failure must depend on fleet-gate directly so its failure result is visible',
  );
  assert.match(
    content,
    /needs\.audit-fix\.result == 'cancelled'/,
    'report-failure must still run when audit-fix is cancelled',
  );
  assert.match(
    content,
    /needs\.fleet-gate\.result == 'failure'/,
    'report-failure must run when fleet-gate fails before audit-fix starts',
  );
});

// ---------------------------------------------------------------------------
// P14 — Disk-pressure self-heal detects non-failure conclusions
// ---------------------------------------------------------------------------
test('P14: monitor workflow checks completed runs with --log (not --log-failed)', () => {
  const content = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../monitor-amnezia-control-panel-github-runs.yml',
    ),
    'utf8',
  );

  // Extract only the disk-pressure self-heal step (lines between the step name
  // and the next step or job), ignoring comments elsewhere in the file.
  const healMatch = content.match(
    /name: Self-heal runner disk pressure[\s\S]*?(?=\n      - name:|\n  \w)/,
  );
  assert.ok(healMatch, 'must find the Self-heal step block');
  const healBlock = healMatch[0];

  assert.match(
    healBlock,
    /--status completed/,
    'must scan completed runs (not only failure)',
  );
  assert.ok(
    !healBlock.includes('--status failure'),
    'must not limit to --status failure',
  );
  assert.match(healBlock, /--log\b/, 'must use --log (not --log-failed)');
  assert.ok(!healBlock.includes('--log-failed'), 'must not use --log-failed');
});

test('P14: monitor filters for failure/cancelled/timed_out conclusions', () => {
  const content = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../monitor-amnezia-control-panel-github-runs.yml',
    ),
    'utf8',
  );

  assert.match(
    content,
    /conclusion == .failure.|conclusion == .cancelled.|conclusion == .timed_out/,
    'must filter for disk-pressure-relevant conclusions',
  );
});

// ---------------------------------------------------------------------------
// PR721 — All report-failure jobs use always() guard (no if: failure())
// ---------------------------------------------------------------------------
test('PR721: no report-failure job uses if: failure() anti-pattern', () => {
  const workflowsDir = path.resolve(__dirname, '../..');
  const yamlFiles = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  const violations = [];
  for (const file of yamlFiles) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');

    // Find report-failure job blocks and check their if: guard
    const rfBlocks = content.split('\n  report-failure:').slice(1);
    for (const block of rfBlocks) {
      const ifLine = block.split('\n').find((l) => /^\s+if:/.test(l));
      if (ifLine && /if:\s*failure\(\)/.test(ifLine)) {
        violations.push(`${file}: ${ifLine.trim()}`);
      }
    }
  }

  assert.deepStrictEqual(
    violations,
    [],
    'report-failure jobs must use always() + result-check, not if: failure()',
  );
});

// ---------------------------------------------------------------------------
// G8 — Restore-deferred-proposal structural verification
// ---------------------------------------------------------------------------
test('G8: auto-pr-branch-cleanup has restore-deferred-proposal job', () => {
  const content = fs.readFileSync(
    path.resolve(__dirname, '../../auto-pr-branch-cleanup.yml'),
    'utf8',
  );

  assert.match(
    content,
    /restore-deferred-proposal:/,
    'must have restore-deferred-proposal job',
  );
  assert.match(
    content,
    /pull_request\.merged != true/,
    'must gate on unmerged close',
  );
  assert.match(
    content,
    /removeLabel[\s\S]*?in-progress/,
    'must remove in-progress label',
  );
  assert.match(
    content,
    /addLabels[\s\S]*?needs-review/,
    'must restore needs-review label',
  );
});

// ---------------------------------------------------------------------------
// PM37 — CI cancelled rerun behavior
// ---------------------------------------------------------------------------
test('PM37: project-manager plan reruns cancelled CI once before /fix', () => {
  const plan = projectManagerPlan(
    projectManagerPr({ checkStatus: { status: 'failed' } }),
    {
      workflowRuns: [
        {
          databaseId: 555,
          workflowName: 'CI',
          status: 'completed',
          conclusion: 'cancelled',
          headSha: 'abc123',
          createdAt: '2026-07-01T09:30:00.000Z',
        },
      ],
    },
  );

  const reruns = plan.actions.filter(
    (action) => action.type === 'rerun-workflow-run',
  );
  // "once": exactly one rerun is dispatched, not one-per-duplicate-run.
  assert.equal(
    reruns.length,
    1,
    'plan must dispatch the CI rerun exactly once',
  );
  assert.equal(reruns[0].runId, '555');
  assert.ok(
    plan.actions.some(
      (action) =>
        action.type === 'upsert-pr-state' && action.state.ciRerunAt === NOW,
    ),
    'plan must record the same-head CI rerun cooldown',
  );
  // "before /fix": the rerun preempts the repair lane, so the plan must not
  // also post a /fix comment for the same head on the same pass.
  assert.ok(
    !plan.actions.some(
      (action) => action.type === 'comment' && action.body === '/fix',
    ),
    'plan must not escalate to /fix while the cancelled-CI rerun is pending',
  );
});

// ---------------------------------------------------------------------------
// PM38 — flow/review-failed escalation behavior
// ---------------------------------------------------------------------------
test('PM38: project-manager plan escalates stale flow/review-failed PRs', () => {
  const plan = projectManagerPlan(
    projectManagerPr({
      labels: [{ name: 'flow/review-failed' }],
      checkStatus: { status: 'passed' },
      projectManagerState: {
        headSha: 'abc123',
        blockedSince: BLOCKED_96H_AGO,
      },
    }),
  );

  assert.ok(
    plan.actions.some(
      (action) =>
        action.type === 'comment' &&
        action.body.includes('blocked on flow/review-failed'),
    ),
    'plan must add a blocked escalation digest entry',
  );
  assert.ok(
    plan.actions.some(
      (action) =>
        action.type === 'upsert-pr-state' &&
        action.state.blockedEscalatedAt === NOW,
    ),
    'plan must record that flow/review-failed was escalated',
  );
});
