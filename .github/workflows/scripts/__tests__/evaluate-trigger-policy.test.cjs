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
