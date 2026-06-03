import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  getLabelsForDecision,
  makeDecision,
  readConfig,
  resolvePrNumber,
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
  state: string;
  mergedAt: string | null;
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
  checks?: Check[] | null;
  workerRuns?: Record<string, WorkerRun[]>;
  getWorkerRuns?: (workerName: string) => WorkerRun[];
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
    state: 'OPEN',
    mergedAt: null,
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
  const checks = Object.hasOwn(overrides, 'checks')
    ? overrides.checks
    : greenChecks();

  return makeDecision({
    pr: overrides.pr ?? prFixture(),
    policy: overrides.policy ?? policyFixture(),
    checks,
    workerRuns: overrides.workerRuns ?? {},
    getWorkerRuns: overrides.getWorkerRuns,
    eventName: overrides.eventName ?? 'pull_request_target',
    event: overrides.event ?? { action: 'ready_for_review' },
    config,
  });
}

describe('makeDecision', () => {
  it('skips closed or merged PRs without dispatching workers', () => {
    const decision = decide({
      pr: prFixture({
        state: 'MERGED',
        mergedAt: '2026-06-03T09:50:00Z',
        labels: ['flow/checks-pending'],
      }),
    });

    assert.equal(decision.state, null);
    assert.equal(decision.reason, 'PR is closed or already merged.');
    assert.equal(decision.dispatch, null);
    assert.deepEqual(decision.labelsToAdd, []);
    assert.ok(decision.labelsToRemove.includes('flow/checks-pending'));
  });

  it('pauses draft PRs without requiring checks or worker runs', () => {
    const queriedWorkers: string[] = [];
    const decision = decide({
      pr: prFixture({ isDraft: true }),
      checks: null,
      getWorkerRuns(workerName) {
        queriedWorkers.push(workerName);
        return [];
      },
    });

    assert.equal(decision.state, 'flow/draft');
    assert.equal(decision.dispatch, null);
    assert.deepEqual(decision.labelsToAdd, ['flow/draft']);
    assert.equal(decision.checkStatus.status, 'not_requested');
    assert.deepEqual(queriedWorkers, []);
  });

  it('waits for pending required checks without querying worker runs', () => {
    const queriedWorkers: string[] = [];
    const decision = decide({
      checks: pendingChecks(),
      getWorkerRuns(workerName) {
        queriedWorkers.push(workerName);
        return [];
      },
    });

    assert.equal(decision.state, 'flow/checks-pending');
    assert.equal(decision.dispatch, null);
    assert.deepEqual(queriedWorkers, []);
  });

  it('dispatches code review only for a ready human PR with green checks', () => {
    const queriedWorkers: string[] = [];
    const decision = decide({
      getWorkerRuns(workerName) {
        queriedWorkers.push(workerName);
        return [];
      },
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
    assert.equal(decision.dispatch?.workflow, 'code-review.yml');
    assert.deepEqual(queriedWorkers, ['codeReview']);
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

  it('keeps a correct existing flow label without label mutation', () => {
    const decision = decide({
      pr: prFixture({ labels: ['flow/checks-pending'] }),
      checks: pendingChecks(),
    });

    assert.equal(decision.state, 'flow/checks-pending');
    assert.deepEqual(decision.labelsToAdd, []);
    assert.deepEqual(decision.labelsToRemove, []);
  });

  it('removes only present stale flow labels', () => {
    const decision = decide({
      pr: prFixture({ labels: ['flow/review-pending'] }),
      checks: pendingChecks(),
    });

    assert.equal(decision.state, 'flow/checks-pending');
    assert.deepEqual(decision.labelsToAdd, ['flow/checks-pending']);
    assert.deepEqual(decision.labelsToRemove, ['flow/review-pending']);
  });

  it('ignores reset labels and flow labels on head changes', () => {
    const resetPr = prFixture({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
      ],
    });
    const labels = getLabelsForDecision(
      resetPr,
      config,
      'pull_request_target',
      { action: 'synchronize' },
    );
    const decision = decide({
      pr: resetPr,
      event: { action: 'synchronize' },
    });

    assert.deepEqual(labels, []);
    assert.equal(decision.dispatch?.key, 'codeReview');
    assert.deepEqual(decision.labelsToRemove.sort(), [
      'ai-review-passed',
      'flow/finalizer-dispatched',
      'security-review-passed',
    ]);
  });
});

describe('resolvePrNumber', () => {
  it('skips issue-only workflow_run titles', () => {
    const prNumber = resolvePrNumber(
      'workflow_run',
      {
        workflow_run: {
          display_title: 'Issue #195 @ 641528f',
          pull_requests: [],
        },
      },
      null,
    );

    assert.equal(prNumber, null);
  });

  it('accepts PR-style issue_comment workflow_run titles', () => {
    const prNumber = resolvePrNumber(
      'workflow_run',
      {
        workflow_run: {
          display_title: `PR #181 @ ${headSha}`,
          pull_requests: [],
        },
      },
      null,
    );

    assert.equal(prNumber, 181);
  });
});

describe('readConfig', () => {
  it('loads the JSON orchestrator config', () => {
    const loaded = readConfig('.github/pr-flow.json');

    assert.equal(loaded.workers.codeReview.workflow, 'code-review.yml');
    assert.equal(loaded.labels['flow/draft'].color, '6e7781');
  });
});
