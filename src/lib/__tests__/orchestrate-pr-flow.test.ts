import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildFlowVisibility,
  collectCheckEvidence,
  decisionWithDispatchError,
  getLabelsForDecision,
  makeDecision,
  readConfig,
  renderFlowComment,
  resolvePrNumber,
} = require('../../../.github/workflows/scripts/orchestrate-pr-flow.cjs');
const {
  evaluateFinalizerDecision,
} = require('../../../.github/workflows/scripts/evaluate-pr-finalizer-decision.cjs');
const {
  filterRequiredChecks,
} = require('../../../.github/workflows/scripts/filter-required-pr-checks.cjs');

const requiredCheckNames = ['Lint', 'Type Check', 'Test', 'Build'];
const headSha = 'abc123def456';

type Check = {
  name: string;
  workflow: string;
  bucket: string;
  state: string;
};

type CheckStatus = {
  status: string;
  failing: string[];
  pending: string[];
  missing: string[];
  reason?: string;
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
  autoMergeRequest: Record<string, unknown> | null;
  labels: string[];
  files: string[];
  isCrossRepository: boolean;
};

type Policy = {
  eligible?: boolean;
  dependabot: null | {
    ecosystem: string;
    supported: boolean;
    updateType: string;
  };
  should_analyze: boolean;
  manual_only: boolean;
  maintainer_approved: boolean;
  blocked_reason?: string;
  blocking_labels_present: string[];
  same_repo?: boolean;
  head_ref_name?: string;
  required_pass_labels?: string[];
  labels?: string[];
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
  checkStatus?: CheckStatus;
  workerRuns?: Record<string, WorkerRun[]>;
  getWorkerRuns?: (workerName: string) => WorkerRun[];
  eventName?: string;
  event?: { action?: string };
  externalReview?: { state: string; reason: string };
};

const flowLabelNames = [
  'flow/draft',
  'flow/checks-pending',
  'flow/checks-failed',
  'flow/checks-unavailable',
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
      'planning-intake-open',
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
  statuses: {
    aggregate: {
      context: 'pr-flow/ready',
      description: 'Required aggregate PR orchestration status',
    },
    workers: {
      codeReview: {
        context: 'pr-flow/code-review',
        description: 'AI code review worker status',
      },
      securityReview: {
        context: 'pr-flow/security-review',
        description: 'AI security review worker status',
      },
      dependencyReview: {
        context: 'pr-flow/dependency-review',
        description: 'Dependency review worker status',
      },
      kiloReview: {
        context: 'pr-flow/kilo-review',
        description: 'Kilo external review worker status',
      },
      prImprove: {
        context: 'pr-flow/pr-improve',
        description: 'Optional PR improvement worker status',
      },
      finalizer: {
        context: 'pr-flow/finalizer',
        description: 'PR finalizer worker status',
      },
    },
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
    kiloReview: {
      required: false,
      external: true,
    },
    prImprove: {
      workflow: 'pr-improve.yml',
      inputs: { dry_run: 'false' },
      required: false,
      successLabels: ['planning-intake-open', 'planning-draft-open'],
      skipLabels: ['skip-improve'],
    },
    finalizer: {
      workflow: 'pr-finalizer.yml',
      inputs: { dry_run: 'false' },
    },
  },
};

const finalizerConfig = {
  ...config,
  checks: {
    required: [
      {
        workflow: 'CI',
        names: requiredCheckNames,
      },
      {
        workflow: 'PR Policy',
        names: ['label-and-validate'],
      },
    ],
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
    autoMergeRequest: null,
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
    maintainer_approved: false,
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

function workflowRunEvent(overrides = {}) {
  return {
    workflow_run: {
      database_id: 12345,
      workflow_name: 'CI',
      name: 'CI',
      status: 'completed',
      head_sha: headSha,
      pull_requests: [{ number: 181 }],
      ...overrides,
    },
  };
}

function workflowRunJobs(overrides: Record<string, string> = {}) {
  return requiredCheckNames.map((name) => ({
    name,
    status: 'completed',
    conclusion: overrides[name] ?? 'success',
  }));
}

function decide(overrides: DecisionOverrides = {}) {
  const checks = Object.hasOwn(overrides, 'checks')
    ? overrides.checks
    : greenChecks();

  return makeDecision({
    pr: overrides.pr ?? prFixture(),
    policy: overrides.policy ?? policyFixture(),
    checks,
    checkStatus: overrides.checkStatus,
    workerRuns: overrides.workerRuns ?? {},
    getWorkerRuns: overrides.getWorkerRuns,
    eventName: overrides.eventName ?? 'pull_request_target',
    event: overrides.event ?? { action: 'ready_for_review' },
    externalReview: overrides.externalReview ?? {
      state: 'skipped',
      reason: 'Kilo review was skipped.',
    },
    config,
  });
}

describe('filterRequiredChecks', () => {
  it('ignores pr-flow aggregate statuses when configured CI checks passed', () => {
    const filtered = filterRequiredChecks(config, [
      ...greenChecks(),
      {
        name: 'pr-flow/ready',
        workflow: '',
        bucket: 'pending',
        state: 'pending',
      },
    ]);
    const decision = decide({
      pr: prFixture({
        labels: ['ai-review-passed', 'security-review-passed'],
      }),
      checks: filtered,
    });

    assert.deepEqual(
      filtered.map((check: Check) => check.name),
      requiredCheckNames,
    );
    assert.ok(filtered.every((check: Check) => check.bucket === 'pass'));
    assert.equal(decision.state, 'flow/finalizer-dispatched');
    assert.equal(decision.dispatch?.key, 'finalizer');
  });

  it('normalizes skipped required checks to the non-blocking skip bucket', () => {
    const filtered = filterRequiredChecks(
      config,
      requiredCheckNames.map((name) => ({
        name,
        workflow: 'CI',
        state: 'skipped',
      })),
    );
    assert.ok(filtered.every((check: Check) => check.bucket === 'skip'));
  });

  it('normalizes cancelled required checks to the blocking cancel bucket', () => {
    const filtered = filterRequiredChecks(
      config,
      requiredCheckNames.map((name) => ({
        name,
        workflow: 'CI',
        state: 'cancelled',
      })),
    );
    assert.ok(filtered.every((check: Check) => check.bucket === 'cancel'));
  });

  it('synthesizes pending entries for missing configured CI checks', () => {
    const filtered = filterRequiredChecks(
      config,
      greenChecks().filter((check) => check.name !== 'Build'),
    );
    const decision = decide({ checks: filtered });
    const buildCheck = filtered.find((check: Check) => check.name === 'Build');

    assert.ok(buildCheck);
    assert.equal(buildCheck.bucket, 'pending');
    assert.equal(decision.state, 'flow/checks-pending');
    assert.equal(decision.dispatch, null);
  });

  it('preserves failing configured CI checks', () => {
    const filtered = filterRequiredChecks(config, [
      ...greenChecks().filter((check) => check.name !== 'Test'),
      {
        name: 'Test',
        workflow: 'CI',
        bucket: 'fail',
        state: 'failure',
      },
    ]);
    const decision = decide({ checks: filtered });
    const testCheck = filtered.find((check: Check) => check.name === 'Test');

    assert.ok(testCheck);
    assert.equal(testCheck.bucket, 'fail');
    assert.equal(decision.state, 'flow/checks-failed');
    assert.equal(decision.dispatch, null);
  });
});

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

  it('keeps PR-open all-missing checks pending without workflow-run fallback', () => {
    const evidence = collectCheckEvidence({
      pr: prFixture(),
      config,
      eventName: 'pull_request_target',
      event: { action: 'opened' },
      runJson(command: string, args: string[]) {
        assert.equal(command, 'gh');
        assert.equal(args[0], 'pr');
        return { ok: true, value: [], error: null };
      },
    });
    const decision = decide({
      checks: evidence.checks,
      checkStatus: evidence.checkStatus,
    });

    assert.equal(evidence.source, 'pr-checks');
    assert.equal(decision.state, 'flow/checks-pending');
    assert.equal(decision.dispatch, null);
  });

  it('uses completed CI workflow-run jobs when PR checks are invisible', () => {
    const evidence = collectCheckEvidence({
      pr: prFixture(),
      config,
      eventName: 'workflow_run',
      event: workflowRunEvent(),
      runJson(command: string, args: string[]) {
        assert.equal(command, 'gh');
        if (args[0] === 'pr') {
          return { ok: true, value: [], error: null };
        }
        return {
          ok: true,
          value: { workflowName: 'CI', jobs: workflowRunJobs() },
          error: null,
        };
      },
    });
    const decision = decide({
      checks: evidence.checks,
      checkStatus: evidence.checkStatus,
      getWorkerRuns() {
        return [];
      },
    });

    assert.equal(evidence.source, 'workflow-run-jobs');
    assert.equal(evidence.checkStatus.status, 'passed');
    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
  });

  it('blocks on failed completed CI workflow-run jobs', () => {
    const evidence = collectCheckEvidence({
      pr: prFixture(),
      config,
      eventName: 'workflow_run',
      event: workflowRunEvent(),
      runJson(command: string, args: string[]) {
        assert.equal(command, 'gh');
        if (args[0] === 'pr') {
          return { ok: true, value: [], error: null };
        }
        return {
          ok: true,
          value: {
            workflowName: 'CI',
            jobs: workflowRunJobs({ Build: 'failure' }),
          },
          error: null,
        };
      },
    });
    const decision = decide({
      checks: evidence.checks,
      checkStatus: evidence.checkStatus,
    });

    assert.equal(evidence.source, 'workflow-run-jobs');
    assert.equal(evidence.checkStatus.status, 'failed');
    assert.deepEqual(evidence.checkStatus.failing, ['Build']);
    assert.equal(decision.state, 'flow/checks-failed');
    assert.equal(decision.dispatch, null);
  });

  it('marks completed CI checks unavailable when PR checks and run jobs are unreadable', () => {
    const evidence = collectCheckEvidence({
      pr: prFixture(),
      config,
      eventName: 'workflow_run',
      event: workflowRunEvent(),
      runJson(command: string, args: string[]) {
        assert.equal(command, 'gh');
        if (args[0] === 'pr') {
          return { ok: true, value: [], error: null };
        }
        return {
          ok: false,
          value: null,
          error: 'Resource not accessible by integration',
        };
      },
    });
    const decision = decide({
      checks: evidence.checks,
      checkStatus: evidence.checkStatus,
    });

    assert.equal(evidence.source, 'unavailable');
    assert.equal(evidence.checkStatus.status, 'unavailable');
    assert.equal(decision.state, 'flow/checks-unavailable');
    assert.equal(decision.dispatch, null);
  });

  it('uses exact-head workflow runs when finalizer PR checks are empty', () => {
    const evidence = collectCheckEvidence({
      pr: prFixture(),
      config: finalizerConfig,
      eventName: 'workflow_dispatch',
      event: {},
      allowRunListFallback: true,
      runJson(command: string, args: string[]) {
        assert.equal(command, 'gh');
        if (args[0] === 'pr') {
          return { ok: true, value: [], error: null };
        }
        if (args[0] === 'run' && args[1] === 'list') {
          return {
            ok: true,
            value: [
              {
                databaseId: 100,
                workflowName: 'CI',
                status: 'completed',
                conclusion: 'success',
                headSha,
              },
              {
                databaseId: 200,
                workflowName: 'PR Policy',
                status: 'completed',
                conclusion: 'success',
                headSha,
              },
            ],
            error: null,
          };
        }
        if (args[0] === 'run' && args[1] === 'view' && args[2] === '100') {
          return {
            ok: true,
            value: { workflowName: 'CI', jobs: workflowRunJobs() },
            error: null,
          };
        }
        if (args[0] === 'run' && args[1] === 'view' && args[2] === '200') {
          return {
            ok: true,
            value: {
              workflowName: 'PR Policy',
              jobs: [
                {
                  name: 'label-and-validate',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            },
            error: null,
          };
        }
        throw new Error(`unexpected command: ${args.join(' ')}`);
      },
    });

    assert.equal(evidence.source, 'workflow-run-jobs');
    assert.equal(evidence.checkStatus.status, 'passed');
  });

  it('keeps finalizer unavailable when exact-head workflow jobs omit a required check', () => {
    const evidence = collectCheckEvidence({
      pr: prFixture(),
      config: finalizerConfig,
      eventName: 'workflow_dispatch',
      event: {},
      allowRunListFallback: true,
      runJson(command: string, args: string[]) {
        assert.equal(command, 'gh');
        if (args[0] === 'pr') {
          return { ok: true, value: [], error: null };
        }
        if (args[0] === 'run' && args[1] === 'list') {
          return {
            ok: true,
            value: [
              {
                databaseId: 100,
                workflowName: 'CI',
                status: 'completed',
                conclusion: 'success',
                headSha,
              },
            ],
            error: null,
          };
        }
        if (args[0] === 'run' && args[1] === 'view') {
          return {
            ok: true,
            value: {
              workflowName: 'CI',
              jobs: workflowRunJobs().filter((job) => job.name !== 'Build'),
            },
            error: null,
          };
        }
        throw new Error(`unexpected command: ${args.join(' ')}`);
      },
    });

    assert.equal(evidence.source, 'unavailable');
    assert.equal(evidence.checkStatus.status, 'unavailable');
    assert.match(evidence.checkStatus.reason ?? '', /PR Policy/);
  });

  it('lets finalizer approve when PR checks are empty but exact-head required workflows passed', () => {
    const evidence = collectCheckEvidence({
      pr: prFixture(),
      config: finalizerConfig,
      eventName: 'workflow_dispatch',
      event: {},
      allowRunListFallback: true,
      runJson(command: string, args: string[]) {
        assert.equal(command, 'gh');
        if (args[0] === 'pr') {
          return { ok: true, value: [], error: null };
        }
        if (args[0] === 'run' && args[1] === 'list') {
          return {
            ok: true,
            value: [
              {
                databaseId: 100,
                workflowName: 'CI',
                status: 'completed',
                conclusion: 'success',
                headSha,
              },
              {
                databaseId: 200,
                workflowName: 'PR Policy',
                status: 'completed',
                conclusion: 'success',
                headSha,
              },
            ],
            error: null,
          };
        }
        if (args[0] === 'run' && args[1] === 'view' && args[2] === '100') {
          return {
            ok: true,
            value: { workflowName: 'CI', jobs: workflowRunJobs() },
            error: null,
          };
        }
        if (args[0] === 'run' && args[1] === 'view' && args[2] === '200') {
          return {
            ok: true,
            value: {
              workflowName: 'PR Policy',
              jobs: [
                {
                  name: 'label-and-validate',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            },
            error: null,
          };
        }
        throw new Error(`unexpected command: ${args.join(' ')}`);
      },
    });
    const finalizer = evaluateFinalizerDecision({
      pr: prFixture({
        labels: [
          'maintainer-approved',
          'ai-review-passed',
          'security-review-passed',
        ],
      }),
      policy: policyFixture({
        manual_only: true,
        maintainer_approved: true,
        eligible: false,
        same_repo: true,
        head_ref_name: 'feature/pr-flow',
        required_pass_labels: ['ai-review-passed', 'security-review-passed'],
        labels: [
          'maintainer-approved',
          'ai-review-passed',
          'security-review-passed',
        ],
      }),
      checkStatus: evidence.checkStatus,
    });

    assert.equal(evidence.source, 'workflow-run-jobs');
    assert.equal(finalizer.decision, 'approve_and_enable_automerge');
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

  it('dispatches finalizer after human review labels are present', () => {
    const decision = decide({
      pr: prFixture({
        labels: ['ai-review-passed', 'security-review-passed'],
      }),
    });

    assert.equal(decision.state, 'flow/finalizer-dispatched');
    assert.equal(decision.dispatch?.key, 'finalizer');
  });

  it('does not re-dispatch finalizer when a prior success did not enable auto-merge', () => {
    // The finalizer already completed. Re-dispatching would cycle: each
    // completed finalizer re-wakes this orchestrator via workflow_run, so the
    // orchestrator must stop once the finalizer has run for the head SHA.
    const decision = decide({
      pr: prFixture({
        labels: [
          'ai-review-passed',
          'security-review-passed',
          'flow/finalizer-dispatched',
        ],
      }),
      workerRuns: {
        finalizer: [
          {
            displayTitle: `PR #181 @ ${headSha}`,
            status: 'completed',
            conclusion: 'success',
            createdAt: '2026-06-03T16:00:00Z',
          },
        ],
      },
    });

    assert.equal(decision.state, 'flow/finalizer-dispatched');
    assert.equal(decision.dispatch, null);
    assert.equal(
      decision.reason,
      'Finalizer completed without enabling auto-merge; manual merge required.',
    );
  });

  it('does not re-dispatch finalizer after auto-merge is enabled', () => {
    const decision = decide({
      pr: prFixture({
        labels: [
          'ai-review-passed',
          'security-review-passed',
          'flow/finalizer-dispatched',
        ],
        autoMergeRequest: { enabledAt: '2026-06-03T16:00:00Z' },
      }),
      workerRuns: {
        finalizer: [
          {
            displayTitle: `PR #181 @ ${headSha}`,
            status: 'completed',
            conclusion: 'success',
            createdAt: '2026-06-03T16:00:00Z',
          },
        ],
      },
    });

    assert.equal(decision.state, 'flow/finalizer-dispatched');
    assert.equal(decision.dispatch, null);
  });

  it('does not dispatch finalizer while one human review signal is missing', () => {
    const decision = decide({
      pr: prFixture({ labels: ['ai-review-passed'] }),
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
  });

  it('dispatches code review for manual-only workflow PRs after green CI', () => {
    const decision = decide({
      pr: prFixture({
        headRefName: 'claude-workflow-optimize-181',
        labels: [],
        files: ['.github/workflows/pr-finalizer.yml'],
      }),
      policy: policyFixture({
        manual_only: true,
        should_analyze: true,
      }),
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
    assert.ok(!decision.labelsToAdd.includes('flow/manual-only'));
  });

  it('keeps manual-only PRs in review until both advisory signals pass', () => {
    const decision = decide({
      pr: prFixture({
        headRefName: 'claude-workflow-optimize-181',
        labels: ['ai-review-passed'],
        files: ['.github/workflows/pr-finalizer.yml'],
      }),
      policy: policyFixture({
        manual_only: true,
        should_analyze: true,
      }),
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
  });

  it('completes reviewed manual-only PRs without dispatching finalizer', () => {
    const decision = decide({
      pr: prFixture({
        headRefName: 'claude-workflow-optimize-181',
        labels: ['ai-review-passed', 'security-review-passed'],
        files: ['.github/workflows/pr-finalizer.yml'],
      }),
      policy: policyFixture({
        manual_only: true,
        should_analyze: true,
      }),
    });

    assert.equal(decision.state, 'flow/manual-only');
    assert.equal(decision.dispatch, null);
    assert.ok(decision.labelsToAdd.includes('flow/manual-only'));
  });

  it('dispatches code review for maintainer-approved manual-only PRs missing review labels', () => {
    const decision = decide({
      pr: prFixture({
        headRefName: 'claude-workflow-optimize-181',
        labels: ['maintainer-approved'],
        files: ['.github/workflows/pr-finalizer.yml'],
      }),
      policy: policyFixture({
        manual_only: true,
        maintainer_approved: true,
        should_analyze: true,
      }),
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
    assert.ok(!decision.labelsToAdd.includes('flow/manual-only'));
  });

  it('dispatches finalizer for maintainer-approved manual-only PRs after review labels', () => {
    const decision = decide({
      pr: prFixture({
        headRefName: 'claude-workflow-optimize-181',
        labels: [
          'maintainer-approved',
          'ai-review-passed',
          'security-review-passed',
          'flow/manual-only',
        ],
        files: ['.github/workflows/pr-finalizer.yml'],
      }),
      policy: policyFixture({
        manual_only: true,
        maintainer_approved: true,
      }),
    });

    assert.equal(decision.state, 'flow/finalizer-dispatched');
    assert.equal(decision.dispatch?.key, 'finalizer');
    assert.ok(decision.labelsToRemove.includes('flow/manual-only'));
    assert.ok(!decision.desiredLabels.includes('flow/manual-only'));
  });

  it('treats needs-review as manual-only after advisory reviews pass', () => {
    const decision = decide({
      pr: prFixture({
        headRefName: 'claude-audit-fix-26890853027',
        labels: ['needs-review', 'ai-review-passed', 'security-review-passed'],
      }),
      policy: policyFixture({
        manual_only: true,
        blocked_reason: 'audit-fix branches are manual-only by policy',
        blocking_labels_present: ['needs-review'],
      }),
    });

    assert.equal(decision.state, 'flow/manual-only');
    assert.equal(
      decision.reason,
      'audit-fix branches are manual-only by policy',
    );
    assert.equal(decision.dispatch, null);
  });

  it('lets maintainer approval override needs-review manual gating only', () => {
    const decision = decide({
      pr: prFixture({
        labels: ['maintainer-approved', 'needs-review'],
      }),
      policy: policyFixture({
        maintainer_approved: true,
        blocking_labels_present: ['needs-review'],
      }),
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
  });

  it('dispatches advisory review for needs-review PRs before manual completion', () => {
    const decision = decide({
      pr: prFixture({
        headRefName: 'claude-audit-fix-26890853027',
        labels: ['needs-review'],
      }),
      policy: policyFixture({
        manual_only: true,
        blocked_reason: 'audit-fix branches are manual-only by policy',
        blocking_labels_present: ['needs-review'],
      }),
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
  });

  it('keeps hard blocking labels blocking after maintainer approval', () => {
    const decision = decide({
      pr: prFixture({
        labels: ['maintainer-approved', 'do-not-merge'],
      }),
      policy: policyFixture({
        maintainer_approved: true,
        blocking_labels_present: ['do-not-merge'],
      }),
    });

    assert.equal(decision.state, 'flow/review-blocked');
    assert.equal(decision.dispatch, null);
    assert.equal(decision.reason, 'Blocking labels are present: do-not-merge.');
  });

  it('blocks when Kilo reports current-head review issues', () => {
    const decision = decide({
      pr: prFixture({
        labels: ['ai-review-passed', 'security-review-passed'],
      }),
      externalReview: {
        state: 'blocked',
        reason: 'Kilo reported current-head issues.',
      },
    });

    assert.equal(decision.state, 'flow/review-blocked');
    assert.equal(decision.reason, 'Kilo reported current-head issues.');
    assert.equal(decision.dispatch, null);
  });

  it('waits while Kilo review is pending', () => {
    const decision = decide({
      pr: prFixture({
        labels: ['ai-review-passed', 'security-review-passed'],
      }),
      externalReview: {
        state: 'pending',
        reason: 'Waiting for current-head Kilo review signal.',
      },
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(
      decision.reason,
      'Waiting for current-head Kilo review signal.',
    );
    assert.equal(decision.dispatch, null);
  });

  it('continues when Kilo passed or skipped', () => {
    for (const state of ['passed', 'skipped']) {
      const decision = decide({
        pr: prFixture({
          labels: ['ai-review-passed', 'security-review-passed'],
        }),
        externalReview: {
          state,
          reason: `Kilo ${state}.`,
        },
      });

      assert.equal(decision.state, 'flow/finalizer-dispatched');
      assert.equal(decision.dispatch?.key, 'finalizer');
    }
  });

  it('keeps pending checks ahead of maintainer-approved manual-only flow', () => {
    const decision = decide({
      pr: prFixture({
        labels: ['maintainer-approved'],
      }),
      policy: policyFixture({
        manual_only: true,
        maintainer_approved: true,
      }),
      checks: pendingChecks(),
    });

    assert.equal(decision.state, 'flow/checks-pending');
    assert.equal(decision.dispatch, null);
  });

  it('keeps failing checks ahead of maintainer-approved manual-only flow', () => {
    const decision = decide({
      pr: prFixture({
        labels: ['maintainer-approved'],
      }),
      policy: policyFixture({
        manual_only: true,
        maintainer_approved: true,
      }),
      checkStatus: {
        status: 'failed',
        failing: ['Lint'],
        pending: [],
        missing: [],
      },
    });

    assert.equal(decision.state, 'flow/checks-failed');
    assert.equal(decision.dispatch, null);
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

describe('buildFlowVisibility', () => {
  it('publishes pending aggregate and worker statuses for a dispatched code review', () => {
    const pr = prFixture();
    const decision = decide({ pr });
    const visibility = buildFlowVisibility({
      pr,
      config,
      policy: policyFixture(),
      decision,
      workerRuns: {},
      eventName: 'pull_request_target',
      event: { action: 'ready_for_review' },
      currentRunUrl: 'https://github.example.test/run/orchestrator',
    });

    assert.equal(visibility.aggregate.context, 'pr-flow/ready');
    assert.equal(visibility.aggregate.state, 'pending');
    assert.equal(visibility.workers.codeReview.state, 'pending');
    assert.equal(visibility.workers.securityReview.state, 'pending');
    assert.equal(visibility.workers.dependencyReview.displayState, 'N/A');
    assert.equal(visibility.workers.kiloReview.displayState, 'N/A');
    assert.equal(visibility.workers.finalizer.state, 'pending');
  });

  it('marks aggregate ready when the finalizer completed for the head SHA', () => {
    const pr = prFixture({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
      ],
      autoMergeRequest: { enabledAt: '2026-06-03T16:00:00Z' },
    });
    const workerRuns = {
      finalizer: [
        {
          displayTitle: `PR #181 @ ${headSha}`,
          status: 'completed',
          conclusion: 'success',
          createdAt: '2026-06-03T16:00:00Z',
          url: 'https://github.example.test/run/finalizer',
        },
      ],
    };
    const decision = decide({ pr, workerRuns });
    const visibility = buildFlowVisibility({
      pr,
      config,
      policy: policyFixture(),
      decision,
      workerRuns,
      eventName: 'workflow_run',
      event: workflowRunEvent({ workflow_name: 'PR Finalizer' }),
      currentRunUrl: 'https://github.example.test/run/orchestrator',
    });

    assert.equal(visibility.aggregate.state, 'success');
    assert.equal(visibility.workers.finalizer.state, 'success');
    assert.equal(
      visibility.workers.finalizer.targetUrl,
      workerRuns.finalizer[0].url,
    );
  });

  it('keeps aggregate pending when finalizer finished without auto-merge', () => {
    const pr = prFixture({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
      ],
    });
    const workerRuns = {
      finalizer: [
        {
          displayTitle: `PR #181 @ ${headSha}`,
          status: 'completed',
          conclusion: 'success',
          createdAt: '2026-06-03T16:00:00Z',
          url: 'https://github.example.test/run/finalizer',
        },
      ],
    };
    const decision = decide({ pr, workerRuns });
    const visibility = buildFlowVisibility({
      pr,
      config,
      policy: policyFixture(),
      decision,
      workerRuns,
      eventName: 'workflow_run',
      event: workflowRunEvent({ workflow_name: 'PR Finalizer' }),
      currentRunUrl: 'https://github.example.test/run/orchestrator',
    });

    assert.equal(visibility.aggregate.state, 'pending');
    assert.equal(visibility.workers.finalizer.state, 'pending');
    assert.equal(
      visibility.workers.finalizer.description,
      'Finalizer completed without enabling auto-merge; waiting to retry.',
    );
  });

  it('shows manual-only PRs waiting on advisory reviews before completion', () => {
    const pr = prFixture({
      headRefName: 'claude-audit-fix-26890853027',
      labels: ['needs-review'],
    });
    const policy = policyFixture({
      manual_only: true,
      blocked_reason: 'audit-fix branches are manual-only by policy',
      blocking_labels_present: ['needs-review'],
    });
    const decision = decide({ pr, policy });
    const visibility = buildFlowVisibility({
      pr,
      config,
      policy,
      decision,
      workerRuns: {},
      eventName: 'pull_request_target',
      event: { action: 'ready_for_review' },
      currentRunUrl: 'https://github.example.test/run/orchestrator',
    });

    assert.equal(decision.state, 'flow/review-pending');
    assert.equal(decision.dispatch?.key, 'codeReview');
    assert.equal(visibility.aggregate.state, 'pending');
    assert.equal(visibility.workers.codeReview.state, 'pending');
    assert.equal(visibility.workers.securityReview.state, 'pending');
    assert.equal(visibility.workers.kiloReview.displayState, 'N/A');
    assert.equal(visibility.workers.prImprove.displayState, 'N/A');
    assert.equal(visibility.workers.finalizer.displayState, 'N/A');
  });

  it('marks reviewed manual-only PRs ready with review success diagnostics', () => {
    const pr = prFixture({
      headRefName: 'claude-audit-fix-26890853027',
      labels: ['needs-review', 'ai-review-passed', 'security-review-passed'],
    });
    const policy = policyFixture({
      manual_only: true,
      blocked_reason: 'audit-fix branches are manual-only by policy',
      blocking_labels_present: ['needs-review'],
    });
    const decision = decide({ pr, policy });
    const visibility = buildFlowVisibility({
      pr,
      config,
      policy,
      decision,
      workerRuns: {},
      eventName: 'pull_request_target',
      event: { action: 'ready_for_review' },
      currentRunUrl: 'https://github.example.test/run/orchestrator',
    });

    assert.equal(decision.state, 'flow/manual-only');
    assert.equal(visibility.aggregate.state, 'success');
    assert.equal(
      visibility.aggregate.description,
      'audit-fix branches are manual-only by policy',
    );
    assert.equal(visibility.workers.codeReview.state, 'success');
    assert.equal(visibility.workers.securityReview.state, 'success');
    assert.equal(visibility.workers.prImprove.displayState, 'N/A');
    assert.equal(visibility.workers.finalizer.displayState, 'N/A');
  });

  it('surfaces dispatch failures as error statuses and a failed flow label', () => {
    const pr = prFixture();
    const decision = decide({ pr });
    const failedDecision = decisionWithDispatchError({
      decision,
      pr,
      config,
      errorMessage: 'workflow not found',
    });
    const visibility = buildFlowVisibility({
      pr,
      config,
      policy: policyFixture(),
      decision: failedDecision,
      workerRuns: {},
      eventName: 'pull_request_target',
      event: { action: 'ready_for_review' },
      dispatchOutcome: { ok: false, error: 'workflow not found' },
      currentRunUrl: 'https://github.example.test/run/orchestrator',
    });

    assert.equal(failedDecision.state, 'flow/review-failed');
    assert.deepEqual(failedDecision.labelsToAdd, ['flow/review-failed']);
    assert.equal(visibility.aggregate.state, 'error');
    assert.equal(visibility.workers.codeReview.state, 'error');
    assert.equal(visibility.workers.securityReview.state, 'error');
  });

  it('keeps optional PR Improve failure visible without blocking ready aggregate', () => {
    const pr = prFixture({
      labels: [
        'ai-review-passed',
        'security-review-passed',
        'flow/finalizer-dispatched',
      ],
      autoMergeRequest: { enabledAt: '2026-06-03T16:00:00Z' },
    });
    const policy = policyFixture({ should_analyze: true });
    const workerRuns = {
      prImprove: [
        {
          displayTitle: `PR #181 @ ${headSha}`,
          status: 'completed',
          conclusion: 'failure',
          createdAt: '2026-06-03T15:58:00Z',
          url: 'https://github.example.test/run/improve',
        },
      ],
      finalizer: [
        {
          displayTitle: `PR #181 @ ${headSha}`,
          status: 'completed',
          conclusion: 'success',
          createdAt: '2026-06-03T16:00:00Z',
          url: 'https://github.example.test/run/finalizer',
        },
      ],
    };
    const decision = decide({ pr, policy, workerRuns });
    const visibility = buildFlowVisibility({
      pr,
      config,
      policy,
      decision,
      workerRuns,
      eventName: 'workflow_run',
      event: workflowRunEvent({ workflow_name: 'PR Finalizer' }),
      currentRunUrl: 'https://github.example.test/run/orchestrator',
    });

    assert.equal(visibility.workers.prImprove.state, 'failure');
    assert.equal(visibility.aggregate.state, 'success');
  });

  it('renders a sticky PR orchestration comment with worker links', () => {
    const pr = prFixture();
    const decision = decide({ pr });
    const visibility = buildFlowVisibility({
      pr,
      config,
      policy: policyFixture(),
      decision,
      workerRuns: {},
      eventName: 'pull_request_target',
      event: { action: 'ready_for_review' },
      currentRunUrl: 'https://github.example.test/run/orchestrator',
    });
    const body = renderFlowComment({
      pr,
      decision,
      visibility,
      dispatchOutcome: { ok: true, error: null },
    });

    assert.match(body, /<!-- pr-flow-orchestration -->/);
    assert.match(body, /\| Code review \| pending \|/);
    assert.match(body, /Aggregate: \*\*pending\*\* \(pr-flow\/ready\)/);
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
    assert.equal(loaded.statuses.aggregate.context, 'pr-flow/ready');
    assert.equal(
      loaded.statuses.workers.securityReview.context,
      'pr-flow/security-review',
    );
  });
});
