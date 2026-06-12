import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const policy = require('../../../.github/workflows/policy.json');
const {
  evaluatePrPolicy,
} = require('../../../.github/workflows/scripts/evaluate-pr-policy.cjs');
const {
  classifyAuditFix,
} = require('../../../.github/workflows/scripts/classify-audit-fix.cjs');
const {
  validateRichBody,
} = require('../../../.github/workflows/scripts/build-automation-pr-body.cjs');

function file(path: string, additions = 5, deletions = 1) {
  return { path, additions, deletions };
}

function tempExecutionFile(result: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-fix-classifier-'));
  const filePath = path.join(dir, 'execution.jsonl');
  fs.writeFileSync(filePath, `${JSON.stringify({ type: 'result', result })}\n`);
  return filePath;
}

function pr({
  headRefName,
  title = 'fix(audit): address autonomous audit findings',
  body = '',
  authorLogin = 'github-actions[bot]',
  labels = [],
  files = [file('src/lib/resource-monitor.ts')],
  isDraft = false,
}: {
  headRefName: string;
  title?: string;
  body?: string;
  authorLogin?: string;
  labels?: string[];
  files?: Array<
    | string
    | {
        path: string;
        additions?: number;
        deletions?: number;
        changedLinesKnown?: boolean;
      }
  >;
  isDraft?: boolean;
}) {
  return {
    number: 1,
    title,
    body,
    isDraft,
    headRefName,
    baseRefName: 'main',
    author: { login: authorLogin },
    labels: labels.map((name) => ({ name })),
    files,
    isCrossRepository: false,
  };
}

describe('audit-safe PR policy', () => {
  it('allows small safe audit PRs after review labels are present', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-safe-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'audit-safe-fix');
    assert.equal(result.manual_only, false);
    assert.equal(result.eligible, true);
    assert.deepEqual(result.required_pass_labels, [
      'ai-review-passed',
      'security-review-passed',
    ]);
  });

  it('keeps safe audit PRs waiting when review labels are missing', () => {
    const result = evaluatePrPolicy(
      pr({ headRefName: 'claude-audit-safe-fix-123' }),
      policy,
    );

    assert.equal(result.pr_class, 'audit-safe-fix');
    assert.equal(result.manual_only, false);
    assert.equal(result.eligible, true);
    assert.deepEqual(result.required_pass_labels, [
      'ai-review-passed',
      'security-review-passed',
    ]);
    assert.deepEqual(result.labels, []);
  });

  it('blocks safe audit PRs that touch workflow paths', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-safe-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [file('.github/workflows/ci.yml')],
      }),
      policy,
    );

    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(result.blocked_reason ?? '', /manual-only paths/);
  });

  it('blocks safe audit PRs that touch API routes', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-safe-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [file('src/app/api/stats/traffic/route.ts')],
      }),
      policy,
    );

    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(result.blocked_reason ?? '', /manual-only paths/);
  });

  it('blocks safe audit PRs that exceed file limits', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-safe-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [
          file('src/components/dashboard/resource-monitor.tsx'),
          file('src/components/dashboard/traffic-stats.tsx'),
          file('src/hooks/use-alerts.ts'),
          file('src/lib/resource-monitor.ts'),
          file('src/lib/resource-alerts.ts'),
          file('src/lib/quota-monitor.ts'),
          file('src/lib/usage-colors.ts'),
          file('src/types/api.ts'),
          file('src/types/monitoring.ts'),
          file('src/components/dashboard/panel-card-expanded.tsx'),
          file('src/hooks/use-chain-status.ts'),
        ],
      }),
      policy,
    );

    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(result.blocked_reason ?? '', /file count 11 exceeds limit 10/);
  });

  it('blocks safe audit PRs that exceed changed-line limits', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-safe-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [file('src/lib/resource-monitor.ts', 300, 101)],
      }),
      policy,
    );

    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(
      result.blocked_reason ?? '',
      /changed lines 401 exceed limit 400/,
    );
  });

  it('blocks safe audit PRs with mixed allowed and disallowed paths', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-safe-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [
          file('src/lib/resource-monitor.ts'),
          file('src/app/dashboard/page.tsx'),
        ],
      }),
      policy,
    );

    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(result.blocked_reason ?? '', /outside safe allow list/);
  });

  it('blocks safe audit PRs when changed-line counts are unknown', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-safe-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: ['src/lib/resource-monitor.ts'],
      }),
      policy,
    );

    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(result.blocked_reason ?? '', /line counts unavailable/);
  });

  it('keeps broad audit PRs manual-only', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'audit-manual-fix');
    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
  });

  it('exposes maintainer approval and requires review labels for approved manual PRs', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-fix-123',
        labels: ['maintainer-approved'],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'audit-manual-fix');
    assert.equal(result.manual_only, true);
    assert.equal(result.maintainer_approved, true);
    assert.equal(result.eligible, false);
    assert.deepEqual(result.required_pass_labels, [
      'ai-review-passed',
      'security-review-passed',
    ]);
  });

  it('defaults maintainer approval to false when the label is absent', () => {
    const result = evaluatePrPolicy(
      pr({ headRefName: 'claude-auto-fix-ci-main-123' }),
      policy,
    );

    assert.equal(result.maintainer_approved, false);
  });

  it('preserves existing CI auto-fix policy', () => {
    const result = evaluatePrPolicy(
      pr({ headRefName: 'claude-auto-fix-ci-main-123' }),
      policy,
    );

    assert.equal(result.pr_class, 'automation-fix');
    assert.equal(result.manual_only, false);
    assert.equal(result.eligible, true);
    assert.deepEqual(result.required_pass_labels, [
      'ai-review-passed',
      'security-review-passed',
    ]);
  });

  it('allows trusted planning PRs that only touch planning artifacts', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-workflow-optimize-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [file('.planning/quick/260612-arch-review/260612-PLAN.md')],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'trusted-planning');
    assert.equal(result.manual_only, false);
    assert.equal(result.eligible, true);
    assert.deepEqual(result.required_pass_labels, [
      'ai-review-passed',
      'security-review-passed',
    ]);
  });

  it('keeps trusted planning PRs waiting when review labels are missing', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-planning-pr-237',
        files: [
          file(
            '.planning/quick/260605-pr237-workflow-improve/260605-pr237-PLAN.md',
          ),
        ],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'trusted-planning');
    assert.equal(result.manual_only, false);
    assert.equal(result.eligible, true);
    assert.deepEqual(result.required_pass_labels, [
      'ai-review-passed',
      'security-review-passed',
    ]);
  });

  it('blocks trusted planning PRs that touch workflow files', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-workflow-optimize-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [
          file('.planning/quick/260612-arch-review/260612-PLAN.md'),
          file('.github/workflows/ci.yml'),
        ],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'trusted-planning');
    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(
      result.blocked_reason ?? '',
      /outside the planning allow list/,
    );
  });

  it('keeps ordinary planning path edits manual-only', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'feature/planning-note',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [file('.planning/quick/manual/proposal.md')],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'other');
    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(
      result.blocked_reason ?? '',
      /manual-only workflow or planning paths/,
    );
  });

  it('allows safe GSD planning execution PRs after review labels', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-gsd-planning-execute-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [
          file(
            '.planning/phases/999-gh-planning-execution-queue/999-001-PLAN.md',
          ),
          file('src/lib/format.ts'),
        ],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'gsd-planning-execution');
    assert.equal(result.manual_only, false);
    assert.equal(result.eligible, true);
    assert.equal(result.gsd_execution?.eligible, true);
  });

  it('keeps risky GSD planning execution PRs manual-only', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-gsd-planning-execute-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [
          file(
            '.planning/phases/999-gh-planning-execution-queue/999-001-PLAN.md',
          ),
          file('.github/workflows/ci.yml'),
        ],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'gsd-planning-execution');
    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.equal(result.gsd_execution?.eligible, false);
    assert.match(result.blocked_reason ?? '', /manual-only paths/);
  });

  it('treats grouped Dependabot patch/minor PRs as supported when the body metadata proves it', () => {
    const result = evaluatePrPolicy(
      pr({
        title:
          'chore(deps-dev): bump the development-dependencies group with 5 updates',
        body: [
          'updated-dependencies:',
          '- dependency-name: eslint-config-next',
          '  update-type: version-update:semver-patch',
          '  dependency-group: development-dependencies',
          '- dependency-name: prettier',
          '  update-type: version-update:semver-patch',
          '  dependency-group: development-dependencies',
          '- dependency-name: tsx',
          '  update-type: version-update:semver-minor',
          '  dependency-group: development-dependencies',
        ].join('\n'),
        headRefName:
          'dependabot/npm_and_yarn/development-dependencies-5368b70e96',
        authorLogin: 'dependabot[bot]',
        labels: ['deps-review-passed'],
        files: [file('package.json'), file('package-lock.json', 20, 20)],
      }),
      policy,
    );

    assert.equal(result.pr_class, 'dependabot');
    assert.equal(result.manual_only, false);
    assert.equal(result.eligible, true);
    assert.equal(result.dependabot?.updateType, 'minor');
    assert.equal(result.dependabot?.supported, true);
    assert.deepEqual(result.required_pass_labels, ['deps-review-passed']);
  });
});

describe('audit-fix classifier', () => {
  it('routes safe diffs to the safe branch lane', () => {
    const result = classifyAuditFix({
      mode: 'auto',
      policy,
      runId: '123',
      fileDetails: [file('src/lib/resource-monitor.ts')],
      repository: 'kostua16/amnezia-control-panel',
      serverUrl: 'https://github.com',
    });

    assert.equal(result.eligible, true);
    assert.equal(result.branch_name, 'claude-audit-safe-fix-123');
    assert.equal(result.draft, 'false');
    assert.equal(result.labels, 'auto-fix,audit-safe,skip-improve');
    assert.match(
      result.body,
      /This PR matched the audit-safe policy and may be auto-merged/,
    );
    assert.match(
      result.body,
      /https:\/\/github\.com\/kostua16\/amnezia-control-panel\/actions\/runs\/123/,
    );
    validateRichBody(result.body);
  });

  it('uses captured execution rationale in the PR body when available', () => {
    const executionFile = tempExecutionFile(
      'Extracted duplicated usage color helpers into a shared library module and added coverage for the shared thresholds.',
    );

    const result = classifyAuditFix({
      mode: 'auto',
      policy,
      runId: '123',
      fileDetails: [file('src/lib/resource-monitor.ts')],
      executionFile,
    });

    assert.match(
      result.body,
      /Extracted duplicated usage color helpers into a shared library module/,
    );
    assert.doesNotMatch(
      result.body,
      /## Why Automation Changed This\nClassification:/,
    );
    assert.match(result.body, /Classification: safe auto-merge candidate/);
    validateRichBody(result.body);
  });

  it('routes manual-only mode to the manual branch lane', () => {
    const result = classifyAuditFix({
      mode: 'manual-only',
      policy,
      runId: '123',
      fileDetails: [file('src/lib/resource-monitor.ts')],
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'manual-only mode requested');
    assert.equal(result.branch_name, 'claude-audit-fix-123');
    assert.equal(result.draft, 'true');
    assert.equal(result.labels, 'auto-fix,needs-review');
    assert.match(result.body, /manual-only under repository policy/);
    validateRichBody(result.body);
  });

  it('routes line-limit overflows to the manual branch lane', () => {
    const result = classifyAuditFix({
      mode: 'auto',
      policy,
      runId: '123',
      fileDetails: [
        {
          path: 'src/lib/resource-monitor.ts',
          additions: 300,
          deletions: 101,
          changedLinesKnown: true,
        },
      ],
    });

    assert.equal(result.eligible, false);
    assert.equal(result.branch_name, 'claude-audit-fix-123');
    assert.equal(result.draft, 'true');
    assert.equal(result.labels, 'auto-fix,needs-review');
    assert.match(result.reason, /changed lines 401 exceed limit 400/);
  });

  it('routes unknown changed-line counts to the manual branch lane', () => {
    const result = classifyAuditFix({
      mode: 'auto',
      policy,
      runId: '123',
      fileDetails: [
        {
          path: 'src/lib/resource-monitor.ts',
          additions: 0,
          deletions: 0,
          changedLinesKnown: false,
        },
      ],
    });

    assert.equal(result.eligible, false);
    assert.equal(result.branch_name, 'claude-audit-fix-123');
    assert.equal(result.draft, 'true');
    assert.equal(result.labels, 'auto-fix,needs-review');
    assert.match(result.reason, /line counts unavailable/);
  });

  it('keeps no-change runs on the manual no-op lane', () => {
    const result = classifyAuditFix({
      mode: 'auto',
      policy,
      runId: '123',
      fileDetails: [],
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'no changes');
    assert.equal(result.branch_name, 'claude-audit-fix-123');
  });
});
