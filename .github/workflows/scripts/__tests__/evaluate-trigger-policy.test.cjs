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
