import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const scriptPath = path.join(
  repoRoot,
  '.github/workflows/scripts/evaluate-trigger-policy.cjs',
);
const policyPath = path.join(repoRoot, '.github/workflows/policy.json');
const prFlowConfigPath = path.join(repoRoot, '.github/pr-flow.json');

function runApprovePolicy(event: unknown, eventName = 'issue_comment') {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-policy-'));
  const eventPath = path.join(tempDir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(event));

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
    { encoding: 'utf8' },
  );

  return JSON.parse(output) as {
    should_run: boolean;
    triggered: boolean;
    trusted: boolean;
    approve_requested: boolean;
    review_requested: boolean;
    pr_number: number | null;
  };
}

function runFixPrPolicy(event: unknown, sourcePr: unknown) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-policy-'));
  const eventPath = path.join(tempDir, 'event.json');
  const sourcePrPath = path.join(tempDir, 'source-pr.json');
  fs.writeFileSync(eventPath, JSON.stringify(event));
  fs.writeFileSync(sourcePrPath, JSON.stringify(sourcePr));

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
    { encoding: 'utf8' },
  );

  return JSON.parse(output) as {
    should_run: boolean;
    head_ref_name: string;
    labels: string[];
    reason: string | null;
  };
}

function runPrFlowPullRequestTargetPolicy(
  event: unknown,
  eventName = 'pull_request_target',
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-policy-'));
  const eventPath = path.join(tempDir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify(event));

  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      '--mode',
      'pr-flow-pull-request-target',
      '--policy-file',
      policyPath,
      '--config-file',
      prFlowConfigPath,
      '--event-path',
      eventPath,
      '--event-name',
      eventName,
    ],
    { encoding: 'utf8' },
  );

  return JSON.parse(output) as {
    should_run: boolean;
    triggered: boolean;
    action: string;
    label: string | null;
    relevant_label: boolean;
  };
}

function prComment(body: string, authorAssociation = 'MEMBER') {
  return {
    issue: {
      number: 42,
      pull_request: {
        url: 'https://api.github.test/repos/acme/repo/pulls/42',
      },
    },
    comment: {
      body,
      author_association: authorAssociation,
    },
  };
}

describe('trigger policy', () => {
  it('allows maintainer PR comments with standalone /approve', () => {
    const result = runApprovePolicy(prComment('Looks good.\n/approve\n'));

    assert.equal(result.should_run, true);
    assert.equal(result.triggered, true);
    assert.equal(result.trusted, true);
    assert.equal(result.approve_requested, true);
    assert.equal(result.review_requested, false);
    assert.equal(result.pr_number, 42);
  });

  it('allows maintainer PR comments with standalone /review as a PR Flow control', () => {
    const result = runApprovePolicy(prComment('Please rerun.\n/review\n'));

    assert.equal(result.should_run, true);
    assert.equal(result.triggered, true);
    assert.equal(result.trusted, true);
    assert.equal(result.approve_requested, false);
    assert.equal(result.review_requested, true);
    assert.equal(result.pr_number, 42);
  });

  it('rejects standalone /approve from non-maintainers', () => {
    const result = runApprovePolicy(prComment('/approve', 'CONTRIBUTOR'));

    assert.equal(result.should_run, false);
    assert.equal(result.triggered, true);
    assert.equal(result.trusted, false);
    assert.equal(result.pr_number, null);
  });

  it('ignores /approve on issue comments that are not PR comments', () => {
    const result = runApprovePolicy({
      issue: { number: 42 },
      comment: {
        body: '/approve',
        author_association: 'MEMBER',
      },
    });

    assert.equal(result.should_run, false);
    assert.equal(result.triggered, false);
    assert.equal(result.pr_number, null);
  });

  it('does not match /approve-auto-fix or prose mentions as PR approval', () => {
    assert.equal(
      runApprovePolicy(prComment('/approve-auto-fix')).should_run,
      false,
    );
    assert.equal(
      runApprovePolicy(prComment('please /approve this')).should_run,
      false,
    );
    assert.equal(
      runApprovePolicy(prComment('please /review this')).should_run,
      false,
    );
  });

  it('skips PR auto-fix for source PRs already labeled auto-fix', () => {
    const result = runFixPrPolicy(
      {
        workflow_run: {
          head_branch: 'codex/260609-quiet-gh-auth-log',
        },
      },
      {
        headRefName: 'codex/260609-quiet-gh-auth-log',
        labels: [{ name: 'auto-fix' }, { name: 'needs-review' }],
      },
    );

    assert.equal(result.should_run, false);
    assert.equal(result.head_ref_name, 'codex/260609-quiet-gh-auth-log');
    assert.equal(result.reason, 'source PR already has the auto-fix label');
  });

  it('skips PR auto-fix for generated automation branches', () => {
    const result = runFixPrPolicy(
      {
        workflow_run: {
          head_branch: 'claude-audit-fix-27142639323',
        },
      },
      {
        headRefName: 'claude-audit-fix-27142639323',
        labels: [{ name: 'needs-review' }],
      },
    );

    assert.equal(result.should_run, false);
    assert.equal(
      result.reason,
      'source PR branch claude-audit-fix-27142639323 already matches an automation prefix',
    );
  });

  it('skips PR auto-fix for generated Codex branches', () => {
    const result = runFixPrPolicy(
      {
        workflow_run: {
          head_branch: 'codex/260611-draft-pr-label-backfill',
        },
      },
      {
        headRefName: 'codex/260611-draft-pr-label-backfill',
        labels: [{ name: 'needs-review' }],
      },
    );

    assert.equal(result.should_run, false);
    assert.equal(
      result.reason,
      'source PR branch codex/260611-draft-pr-label-backfill already matches an automation prefix',
    );
  });

  it('allows PR auto-fix for non-automation source PRs', () => {
    const result = runFixPrPolicy(
      {
        workflow_run: {
          head_branch: 'feature/human-pr',
        },
      },
      {
        headRefName: 'feature/human-pr',
        labels: [{ name: 'bug' }],
      },
    );

    assert.equal(result.should_run, true);
    assert.equal(result.reason, null);
  });

  it('runs PR flow for standard pull request lifecycle events', () => {
    const result = runPrFlowPullRequestTargetPolicy({ action: 'opened' });

    assert.equal(result.should_run, true);
    assert.equal(result.triggered, true);
    assert.equal(result.relevant_label, false);
  });

  it('skips generic pull request labels that do not affect PR flow', () => {
    const result = runPrFlowPullRequestTargetPolicy({
      action: 'labeled',
      label: { name: 'javascript' },
    });

    assert.equal(result.should_run, false);
    assert.equal(result.triggered, true);
    assert.equal(result.label, 'javascript');
    assert.equal(result.relevant_label, false);
  });

  it('runs PR flow when a label affects orchestration policy', () => {
    const result = runPrFlowPullRequestTargetPolicy({
      action: 'labeled',
      label: { name: 'do-not-merge' },
    });

    assert.equal(result.should_run, true);
    assert.equal(result.triggered, true);
    assert.equal(result.label, 'do-not-merge');
    assert.equal(result.relevant_label, true);
  });
});
