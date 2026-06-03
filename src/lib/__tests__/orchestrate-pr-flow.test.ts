import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  makeDecision,
} = require('../../../.github/workflows/scripts/orchestrate-pr-flow.cjs');

const requiredCheckNames = ['Lint', 'Type Check', 'Test', 'Build'];
const headSha = 'abc123def456';

type Check = {
  name: string;
  workflow: string;
  bucket: string;
  state: string;
};

type Pr = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  headRefName: string;
  headSha: string;
  baseRefName: string;
  authorLogin: string;
  labels: string[];
  files: string[];
  isCrossRepository: boolean;
};

type Policy = {
  dependabot: null | {
    ecosystem: string;
    supported: boolean;
    updateType: string;
  };
  should_analyze: boolean;
  manual_only: boolean;
  blocking_labels_present: string[];
};

type WorkerRun = {
  displayTitle: string;
  status: string;
  conclusion?: string;
  createdAt: string;
};

type DecisionOverrides = {
  pr?: Pr;
  policy?: Policy;
  checks?: Check[];
  workerRuns?: Record<string, WorkerRun[]>;
  eventName?: string;
  event?: { action?: string };
};

const flowLabelNames = [
  'flow/draft',
  'flow/checks-pending',
  'flow/checks-failed',
  'flow/review-pending',
  'flow/review-blocked',
  'flow/review-failed',
  'flow/improve-pending',
  'flow/improve-failed',
  'flow/finalizer-dispatched',
  'flow/manual-only',
];

const config = {
  labels: Object.fromEntries(
    flowLabelNames.map((name) => [
      name,
      { color: 'ededed', description: `${name} test label` },
    ]),
  ),
  resetOnHeadChange: {
    labels: [
      'ai-review-passed',
      'ai-review-concerns',
      'security-review-passed',
      'security-review-concerns',
      'deps-review-passed',
      'deps-review-manual',
      'deps-review-blocked',
      'planning-draft-open',
    ],
  },
  checks: {
    required: [
      {
        workflow: 'CI',
        names: requiredCheckNames,
      },
    ],
  },
  workers: {
    codeReview: {
      workflow: 'code-review.yml',
      passLabels: ['ai-review-passed', 'security-review-passed'],
      blockLabels: ['ai-review-concerns', 'security-review-concerns'],
    },
    dependencyReview: {
      workflow: 'dependency-review.yml',
      paths: ['package.json', 'package-lock.json'],
      passLabels: ['deps-review-passed'],
      blockLabels: ['deps-review-manual', 'deps-review-blocked'],
    },
    prImprove: {
      workflow: 'pr-improve.yml',
      inputs: { dry_run: 'false' },
      required: false,
      successLabels: ['planning-draft-open'],
      skipLabels: ['skip-improve'],
    },
    finalizer: {
      workflow: 'pr-finalizer.yml',
      inputs: { dry_run: 'false' },
    },
  },
};

function prFixture(overrides: Partial<Pr> = {}): Pr {
  return {
    number: 181,
    title: 'fix: sample PR',
    url: 'https://github.example.test/repo/pull/181',
    isDraft: false,
    headRefName: 'feature/pr-flow',
    headSha,
    baseRefName: 'main',
    authorLogin: 'maintainer',
    labels: [],
    files: ['src/app.ts'],
    isCrossRepository: false,
    ...overrides,
  };
}

function policyFixture(overrides: Partial<Policy> = {}): Policy {
  return {
    dependabot: null,
    should_analyze: false,
    manual_only: false,
    blocking_labels_present: [],
    ...overrides,
  };
}

function greenChecks(): Check[] {
  return requiredCheckNames.map((name) => ({
    name,
    workflow: 'CI',
    bucket: 'pass',
    state: 'success',
  }));
}

function pendingChecks(): Check[] {
  return greenChecks().map((check, index) =>
    index === 0
      ? {
          ...check,
          bucket: 'pending',
          state: 'pending',
        }
      : check,
  );
}

function decide(overrides: DecisionOverrides = {}) {
  return makeDecision({
    pr: overrides.pr ?? prFixture(),
    policy: overrides.policy ?? policyFixture(),
    checks: overrides.checks ?? greenChecks(),
    workerRuns: overrides.workerRuns ?? {},
    eventName: overrides.eventName ?? 'pull_request_target',
    event: overrides.event ?? { action: 'ready_for_review' },
    config,
  });
}

describe('makeDecision', () => {
  it('pauses draft PRs without dispatching workers', () => {
    const decision = decide({
      pr: prFixture({ isDraft: true }),
      checks: pendingChecks(),
    });

    assert.equal(decision.state, 'flow/draft');
    assert.equal(decision.dispatch, null);
    assert.deepEqual(decision.labelsToAdd, ['flow/draft']);
  });

  it('waits for pending required checks before review or finalizer dispatch', () => {
    const decision = decide({ checks: pendingChecks() });

    assert.equal(decision.state, 'flow/checks-pending');
    assert.equal(decision.dispatch, null);
  });

  it('dispatches code review only for a ready human PR with green checks', () => {
    const decision = decide();

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
    assert.equal(decision.dispatch?.workflow, 'code-review.yml');
  });

  it('does not dispatch finalizer while one human review signal is missing', () => {
    const decision = decide({
      pr: prFixture({ labels: ['ai-review-passed'] }),
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
  });

  it('dispatches report-only finalizer for a manual-only workflow PR after gates', () => {
    const decision = decide({
      pr: prFixture({
        headRefName: 'claude-workflow-optimize-181',
        labels: [
          'ai-review-passed',
          'security-review-passed',
          'planning-draft-open',
        ],
        files: ['.github/workflows/pr-finalizer.yml'],
      }),
      policy: policyFixture({
        manual_only: true,
        should_analyze: true,
      }),
    });

    assert.equal(decision.state, 'flow/finalizer-dispatched');
    assert.equal(decision.dispatch?.key, 'finalizer');
    assert.deepEqual(decision.dispatch?.inputs, { dry_run: 'false' });
    assert.ok(decision.labelsToAdd.includes('flow/manual-only'));
  });

  it('dispatches dependency review before finalizer for Dependabot package PRs', () => {
    const dependabotPolicy = policyFixture({
      dependabot: {
        ecosystem: 'npm',
        supported: true,
        updateType: 'patch',
      },
      should_analyze: true,
    });
    const dependabotPr = prFixture({
      authorLogin: 'dependabot[bot]',
      headRefName: 'dependabot/npm_and_yarn/react-19.2.5',
      files: ['package.json', 'package-lock.json'],
    });

    const reviewDecision = decide({
      pr: dependabotPr,
      policy: dependabotPolicy,
    });
    assert.equal(reviewDecision.dispatch?.key, 'dependencyReview');

    const finalizerDecision = decide({
      pr: prFixture({
        ...dependabotPr,
        labels: ['deps-review-passed'],
      }),
      policy: dependabotPolicy,
    });

    assert.equal(finalizerDecision.state, 'flow/finalizer-dispatched');
    assert.equal(finalizerDecision.dispatch?.key, 'finalizer');
  });

  it('stops on blocking labels without dispatching more workers', () => {
    const decision = decide({
      pr: prFixture({ labels: ['do-not-merge'] }),
      policy: policyFixture({
        blocking_labels_present: ['do-not-merge'],
      }),
    });

    assert.equal(decision.state, 'flow/review-blocked');
    assert.equal(decision.dispatch, null);
  });

  it('ignores stale worker runs from an older head SHA', () => {
    const decision = decide({
      workerRuns: {
        codeReview: [
          {
            displayTitle: 'Code Review PR #181 @ old-head',
            status: 'completed',
            conclusion: 'success',
            createdAt: '2026-06-01T00:00:00Z',
          },
        ],
      },
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
  });

  it('does not duplicate dispatch when the matching worker is active', () => {
    const decision = decide({
      workerRuns: {
        codeReview: [
          {
            displayTitle: `Code Review PR #181 @ ${headSha}`,
            status: 'queued',
            createdAt: '2026-06-01T00:00:00Z',
          },
        ],
      },
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch, null);
  });
});
