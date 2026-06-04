import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const policy = require('../../../.github/workflows/policy.json');
const {
  evaluatePrPolicy,
} = require('../../../.github/workflows/scripts/evaluate-pr-policy.cjs');
const {
  classifyAuditFix,
} = require('../../../.github/workflows/scripts/classify-audit-fix.cjs');

function file(path: string, additions = 5, deletions = 1) {
  return { path, additions, deletions };
}

function pr({
  headRefName,
  labels = [],
  files = [file('src/lib/resource-monitor.ts')],
  isDraft = false,
}: {
  headRefName: string;
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
    title: 'fix(audit): address autonomous audit findings',
    isDraft,
    headRefName,
    baseRefName: 'main',
    author: { login: 'github-actions[bot]' },
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
        ],
      }),
      policy,
    );

    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(result.blocked_reason ?? '', /file count 4 exceeds limit 3/);
  });

  it('blocks safe audit PRs that exceed changed-line limits', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-safe-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [file('src/lib/resource-monitor.ts', 100, 21)],
      }),
      policy,
    );

    assert.equal(result.manual_only, true);
    assert.equal(result.eligible, false);
    assert.match(
      result.blocked_reason ?? '',
      /changed lines 121 exceed limit 120/,
    );
  });

  it('blocks safe audit PRs with mixed allowed and disallowed paths', () => {
    const result = evaluatePrPolicy(
      pr({
        headRefName: 'claude-audit-safe-fix-123',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: [
          file('src/lib/resource-monitor.ts'),
          file('src/lib/unreviewed-helper.ts'),
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
});

describe('audit-fix classifier', () => {
  it('routes safe diffs to the safe branch lane', () => {
    const result = classifyAuditFix({
      mode: 'auto',
      policy,
      runId: '123',
      fileDetails: [file('src/lib/resource-monitor.ts')],
    });

    assert.equal(result.eligible, true);
    assert.equal(result.branch_name, 'claude-audit-safe-fix-123');
    assert.equal(result.draft, 'false');
    assert.equal(result.labels, 'auto-fix,audit-safe,skip-improve');
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
  });

  it('routes line-limit overflows to the manual branch lane', () => {
    const result = classifyAuditFix({
      mode: 'auto',
      policy,
      runId: '123',
      fileDetails: [
        {
          path: 'src/lib/resource-monitor.ts',
          additions: 100,
          deletions: 21,
          changedLinesKnown: true,
        },
      ],
    });

    assert.equal(result.eligible, false);
    assert.equal(result.branch_name, 'claude-audit-fix-123');
    assert.equal(result.draft, 'true');
    assert.equal(result.labels, 'auto-fix,needs-review');
    assert.match(result.reason, /changed lines 121 exceed limit 120/);
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
