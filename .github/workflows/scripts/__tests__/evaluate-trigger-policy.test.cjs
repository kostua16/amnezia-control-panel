/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const scriptPath = path.join(
  repoRoot,
  '.github/workflows/scripts/evaluate-trigger-policy.cjs',
);
const policyPath = path.join(repoRoot, '.github/workflows/policy.json');

function runPrFlowControl({ event, eventName = 'issue_comment' }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-flow-control-'));
  const eventPath = path.join(tempDir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--mode',
      'pr-flow-control',
      '--policy-file',
      policyPath,
      '--event-path',
      eventPath,
      '--event-name',
      eventName,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

function runFixPrPolicy({ event, sourcePr }) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evaluate-trigger-policy-'),
  );
  const eventPath = path.join(tempDir, 'event.json');
  const sourcePrPath = path.join(tempDir, 'source-pr.json');

  fs.writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  fs.writeFileSync(sourcePrPath, JSON.stringify(sourcePr), 'utf8');

  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--mode',
      'fix-pr',
      '--policy-file',
      policyPath,
      '--event-path',
      eventPath,
      '--event-name',
      'workflow_run',
      '--source-pr-file',
      sourcePrPath,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  return JSON.parse(output);
}

test('fix-pr skips bot-authored source PRs before invoking auto-fix', () => {
  const result = runFixPrPolicy({
    event: {
      workflow_run: {
        head_branch: 'feature/bot-fix',
      },
    },
    sourcePr: {
      head: { ref: 'feature/bot-fix' },
      user: {
        login: 'dependabot[bot]',
        type: 'Bot',
      },
      labels: [],
    },
  });

  assert.equal(result.should_run, false);
  assert.equal(result.source_pr_author_login, 'dependabot[bot]');
  assert.equal(result.source_pr_author_type, 'Bot');
  assert.match(result.reason, /skips bot-authored PRs/);
});

test('pr-flow-control: maintainer /review wakes PR Flow without approval', () => {
  const out = runPrFlowControl({
    event: {
      issue: { number: 42, pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: '/review',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
  });

  assert.equal(out.should_run, true);
  assert.equal(out.review_requested, true);
  assert.equal(out.approve_requested, false);
  assert.equal(out.pr_number, 42);
});

test('pr-flow-control: maintainer /approve keeps approval behavior', () => {
  const out = runPrFlowControl({
    event: {
      issue: { number: 42, pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: '/approve',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
  });

  assert.equal(out.should_run, true);
  assert.equal(out.approve_requested, true);
  assert.equal(out.review_requested, false);
  assert.equal(out.pr_number, 42);
});

test('pr-flow-control: bot and non-maintainer /review comments are ignored', () => {
  const bot = runPrFlowControl({
    event: {
      issue: { number: 42, pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: '/review',
        author_association: 'OWNER',
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
    },
  });
  const nonMaintainer = runPrFlowControl({
    event: {
      issue: { number: 42, pull_request: { url: 'https://example/pr/42' } },
      comment: {
        body: '/review',
        author_association: 'NONE',
        user: { login: 'octo', type: 'User' },
      },
    },
  });

  assert.equal(bot.should_run, false);
  assert.equal(nonMaintainer.should_run, false);
});

test('pr-flow-control: trusted Kilo review marker wakes PR Flow', () => {
  const out = runPrFlowControl({
    event: {
      action: 'created',
      issue: { number: 507, pull_request: { url: 'https://example/pr/507' } },
      comment: {
        body: '<!-- kilo-review -->\nStatus: 1 Issue Found',
        author_association: 'NONE',
        user: { login: 'kilo-code-bot[bot]', type: 'Bot' },
      },
    },
  });

  assert.equal(out.should_run, true);
  assert.equal(out.trusted, true);
  assert.equal(out.kilo_review_posted, true);
  assert.equal(out.pr_number, 507);
});

test('pr-flow-control: edited trusted Kilo review marker wakes PR Flow', () => {
  const out = runPrFlowControl({
    event: {
      action: 'edited',
      issue: { number: 507, pull_request: { url: 'https://example/pr/507' } },
      comment: {
        body: '<!-- kilo-review -->\nStatus: No Issues Found',
        author_association: 'NONE',
        user: { login: 'kilo-code-bot[bot]', type: 'Bot' },
      },
    },
  });

  assert.equal(out.should_run, true);
  assert.equal(out.trusted, true);
  assert.equal(out.kilo_review_posted, true);
  assert.equal(out.pr_number, 507);
});

test('pr-flow-control: other bot comments remain ignored', () => {
  const out = runPrFlowControl({
    event: {
      action: 'edited',
      issue: { number: 507, pull_request: { url: 'https://example/pr/507' } },
      comment: {
        body: '<!-- kilo-review -->\nStatus: 1 Issue Found',
        author_association: 'NONE',
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
    },
  });

  assert.equal(out.should_run, false);
  assert.equal(out.trusted, false);
});

test('fix-pr skips source PRs from automation branch prefixes first', () => {
  const result = runFixPrPolicy({
    event: {
      workflow_run: {
        head_branch: 'dependabot/npm_and_yarn/eslint-10.4.1',
      },
    },
    sourcePr: {
      head: { ref: 'dependabot/npm_and_yarn/eslint-10.4.1' },
      user: {
        login: 'dependabot[bot]',
        type: 'Bot',
      },
      labels: [],
    },
  });

  assert.equal(result.should_run, false);
  assert.match(result.reason, /already matches an automation prefix/);
});

test('fix-pr still runs for human-authored source PRs without guard labels', () => {
  const result = runFixPrPolicy({
    event: {
      workflow_run: {
        head_branch: 'feature/fix-ci',
      },
    },
    sourcePr: {
      head: { ref: 'feature/fix-ci' },
      user: {
        login: 'kostua16',
        type: 'User',
      },
      labels: [],
    },
  });

  assert.equal(result.should_run, true);
  assert.equal(result.reason, null);
});

const cap = JSON.parse(fs.readFileSync(policyPath, 'utf8')).maxAutoFixAttempts;

test('fix-pr stops once the auto-fix attempt cap is reached', () => {
  const result = runFixPrPolicy({
    event: { workflow_run: { head_branch: 'feature/x' } },
    sourcePr: {
      head: { ref: 'feature/x' },
      user: { login: 'kostua16', type: 'User' },
      labels: [],
      auto_fix_attempt_count: cap,
    },
  });
  assert.equal(result.should_run, false);
  assert.match(result.reason, /cap reached/);
});

test('fix-pr still runs below the attempt cap for a human-authored PR', () => {
  const result = runFixPrPolicy({
    event: { workflow_run: { head_branch: 'feature/x' } },
    sourcePr: {
      head: { ref: 'feature/x' },
      user: { login: 'kostua16', type: 'User' },
      labels: [],
      auto_fix_attempt_count: cap - 1,
    },
  });
  assert.equal(result.should_run, true);
  assert.equal(result.reason, null);
});

test('fix-pr AUTO_FIX_MSG tracks the _auto-fix-ci commit messages (no drift)', () => {
  const autoFixYml = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/_auto-fix-ci.yml'),
    'utf8',
  );
  const fixPrYml = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/fix-pr.yml'),
    'utf8',
  );
  const commitMsgLine = autoFixYml
    .split('\n')
    .find((l) => l.includes('commit-message:'));
  assert.ok(commitMsgLine, '_auto-fix-ci.yml has a commit-message input');
  const literals = [...commitMsgLine.matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .filter((s) => s.includes('auto-fix'));
  assert.ok(
    literals.length >= 2,
    `expected >=2 auto-fix literals, got ${literals.length}`,
  );
  const regexMatch = fixPrYml.match(/AUTO_FIX_MSG\s*=\s*\/([\s\S]+?)\//);
  assert.ok(regexMatch, 'fix-pr.yml defines AUTO_FIX_MSG');
  const autoFixRegex = new RegExp(regexMatch[1]);
  for (const literal of literals) {
    assert.ok(
      autoFixRegex.test(literal),
      `fix-pr AUTO_FIX_MSG does not match _auto-fix-ci literal: "${literal}"`,
    );
  }
});

function runReviewApproved({ event }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-approved-'));
  const eventPath = path.join(tempDir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--mode',
      'review-approved',
      '--policy-file',
      policyPath,
      '--event-path',
      eventPath,
      '--event-name',
      'pull_request_review',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

test('review-approved: maintainer approval triggers the label', () => {
  const out = runReviewApproved({
    event: {
      review: { state: 'approved', author_association: 'OWNER' },
      pull_request: { number: 42 },
    },
  });
  assert.equal(out.should_run, true);
  assert.equal(out.pr_number, 42);
});

test('review-approved: non-maintainer approval is ignored', () => {
  const out = runReviewApproved({
    event: {
      review: { state: 'approved', author_association: 'NONE' },
      pull_request: { number: 42 },
    },
  });
  assert.equal(out.should_run, false);
});

test('review-approved: non-approval review (comment) is ignored', () => {
  const out = runReviewApproved({
    event: {
      review: { state: 'comment', author_association: 'OWNER' },
      pull_request: { number: 42 },
    },
  });
  assert.equal(out.should_run, false);
});

function runRebasePr({ event, eventName = 'issue_comment' }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-pr-'));
  const eventPath = path.join(tempDir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--mode',
      'rebase-pr',
      '--policy-file',
      policyPath,
      '--event-path',
      eventPath,
      '--event-name',
      eventName,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

// rebase-pr requires the whole comment body to be exactly "/rebase" (rejects
// prose mentions and "/rebase main"); maintainer-only; issue_comment + dispatch.
test('rebase-pr: maintainer /rebase on a PR runs and reports the command', () => {
  const out = runRebasePr({
    event: {
      issue: { number: 472, pull_request: {} },
      comment: {
        body: '/rebase',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
  });
  assert.equal(out.should_run, true);
  assert.equal(out.trusted, true);
  assert.equal(out.pr_number, 472);
  assert.equal(out.command, '/rebase');
  assert.equal(out.trigger_source, 'comment');
});

test('rebase-pr: /rebase on a non-PR issue is ignored', () => {
  const out = runRebasePr({
    event: {
      issue: { number: 5 },
      comment: {
        body: '/rebase',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
  });
  assert.equal(out.should_run, false);
  assert.equal(out.pr_number, null);
});

test('rebase-pr: bot /rebase is ignored', () => {
  const out = runRebasePr({
    event: {
      issue: { number: 472, pull_request: {} },
      comment: {
        body: '/rebase',
        author_association: 'COLLABORATOR',
        user: { login: 'dependabot[bot]', type: 'Bot' },
      },
    },
  });
  assert.equal(out.should_run, false);
});

test('rebase-pr: non-maintainer /rebase is ignored', () => {
  const out = runRebasePr({
    event: {
      issue: { number: 472, pull_request: {} },
      comment: {
        body: '/rebase',
        author_association: 'NONE',
        user: { login: 'contrib', type: 'User' },
      },
    },
  });
  assert.equal(out.should_run, false);
  assert.equal(out.trusted, false);
});

test('rebase-pr: prose mentioning /rebase does not trigger', () => {
  const out = runRebasePr({
    event: {
      issue: { number: 472, pull_request: {} },
      comment: {
        body: 'can you /rebase this branch please?',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
  });
  assert.equal(out.should_run, false);
});

test('rebase-pr: /rebase with arguments is rejected in v1', () => {
  const out = runRebasePr({
    event: {
      issue: { number: 472, pull_request: {} },
      comment: {
        body: '/rebase main',
        author_association: 'OWNER',
        user: { login: 'kostua16', type: 'User' },
      },
    },
  });
  assert.equal(out.should_run, false);
});

test('rebase-pr: workflow_dispatch runs with the supplied PR number', () => {
  const out = runRebasePr({
    event: { inputs: { pr_number: '472' } },
    eventName: 'workflow_dispatch',
  });
  assert.equal(out.should_run, true);
  assert.equal(out.trusted, true);
  assert.equal(out.pr_number, '472');
  assert.equal(out.trigger_source, 'workflow_dispatch');
});

// --- pr-flow-pull-request-target trigger gate regression tests ---

function runPrFlowPrt({ action, label, sender }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-flow-prt-'));
  const eventPath = path.join(tempDir, 'event.json');
  const event = { action };
  if (label) event.label = { name: label };
  if (sender) event.sender = sender;
  fs.writeFileSync(eventPath, JSON.stringify(event), 'utf8');
  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--mode',
      'pr-flow-pull-request-target',
      '--policy-file',
      policyPath,
      '--config-file',
      path.join(repoRoot, '.github/pr-flow.json'),
      '--event-path',
      eventPath,
      '--event-name',
      'pull_request_target',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

const ALWAYS_RUN_ACTIONS = [
  'opened',
  'synchronize',
  'reopened',
  'ready_for_review',
  'converted_to_draft',
];

for (const action of ALWAYS_RUN_ACTIONS) {
  test(`pr-flow-pull-request-target: ${action} always runs PR flow`, () => {
    const out = runPrFlowPrt({ action });
    assert.equal(out.should_run, true, `${action} should always run`);
    assert.equal(out.action, action);
    assert.equal(out.label, null);
  });
}

const GENERIC_LABELS = [
  'javascript',
  'auto-fix',
  'bug',
  'enhancement',
  'documentation',
  'good first issue',
  'help wanted',
  'question',
  'wontfix',
  'size/S',
  'size/M',
  'area/workflows',
  'area/docs',
  'area/frontend',
  'maintenance',
  'security',
  'critical',
  'high',
  'medium',
  'low',
  'backlog',
  'duplicate',
  'fixed',
  'canceled',
  'triaged',
  'stale-pr-consolidation',
];

for (const label of GENERIC_LABELS) {
  test(`pr-flow-pull-request-target: generic label "${label}" does NOT run PR flow`, () => {
    const out = runPrFlowPrt({ action: 'labeled', label });
    assert.equal(
      out.should_run,
      false,
      `generic label "${label}" should not run PR flow`,
    );
    assert.equal(out.label, label);
    assert.equal(out.relevant_label, false);
  });
}

const RELEVANT_LABELS = [
  'do-not-merge',
  'needs-review',
  'skip-improve',
  'ai-review-passed',
  'ai-review-concerns',
  'security-review-passed',
  'security-review-concerns',
  'deps-review-passed',
  'deps-review-manual',
  'deps-review-blocked',
  'maintainer-approved',
  'antigravity-review-passed',
  'antigravity-review-concerns',
  'deepseek-review-passed',
  'deepseek-review-concerns',
  'planning-draft-open',
  'planning-intake-open',
];

for (const label of RELEVANT_LABELS) {
  test(`pr-flow-pull-request-target: relevant label "${label}" DOES run PR flow`, () => {
    const out = runPrFlowPrt({ action: 'labeled', label });
    assert.equal(
      out.should_run,
      true,
      `relevant label "${label}" should run PR flow`,
    );
    assert.equal(out.label, label);
    assert.equal(out.relevant_label, true);
  });
}

test('pr-flow-pull-request-target: bot-applied relevant label is skipped', () => {
  const out = runPrFlowPrt({
    action: 'labeled',
    label: 'needs-review',
    sender: { login: 'github-actions[bot]', type: 'Bot' },
  });
  assert.equal(out.should_run, false);
  assert.equal(out.sender_is_bot, true);
  assert.match(out.reason, /bot/i);
});

test('pr-flow-pull-request-target: unlabeled relevant label wakes PR flow', () => {
  const out = runPrFlowPrt({ action: 'unlabeled', label: 'do-not-merge' });
  assert.equal(out.should_run, true);
  assert.equal(out.label, 'do-not-merge');
  assert.equal(out.relevant_label, true);
});

test('pr-flow-pull-request-target: unlabeled generic label does NOT wake PR flow', () => {
  const out = runPrFlowPrt({ action: 'unlabeled', label: 'javascript' });
  assert.equal(out.should_run, false);
  assert.equal(out.relevant_label, false);
});

// Non-lifecycle, non-label pull_request_target actions (edited, assigned, ...)
// fall through to the gate's default-deny branch. Cover them so a future change
// cannot silently start running PR flow for actions that must be ignored.
const IGNORED_PR_ACTIONS = [
  'edited',
  'assigned',
  'unassigned',
  'closed',
  'review_requested',
];

for (const action of IGNORED_PR_ACTIONS) {
  test(`pr-flow-pull-request-target: non-lifecycle action "${action}" is default-denied`, () => {
    const out = runPrFlowPrt({ action });
    assert.equal(out.should_run, false, `${action} must not run PR flow`);
    assert.equal(out.action, action);
    assert.equal(out.label, null);
    assert.match(out.reason, /ignored by PR flow/i);
  });
}

// Bot-skip must recognize every production bot sender and the [bot]-suffix
// regex path, not only github-actions[bot] with type 'Bot'. A sender whose
// type is absent is detected solely via the login-suffix regex.
const BOT_SENDERS = [
  { login: 'dependabot[bot]', type: 'Bot' },
  { login: 'renovate[bot]' },
  { login: 'mergify[bot]', type: 'Bot' },
];

for (const sender of BOT_SENDERS) {
  test(`pr-flow-pull-request-target: bot sender "${sender.login}" applying relevant label is skipped`, () => {
    const out = runPrFlowPrt({
      action: 'labeled',
      label: 'needs-review',
      sender,
    });
    assert.equal(out.should_run, false);
    assert.equal(out.sender_is_bot, true);
    assert.match(out.reason, /bot/i);
  });
}
