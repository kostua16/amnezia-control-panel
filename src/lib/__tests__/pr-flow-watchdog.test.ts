import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildDispatchArgs,
  hasExpiredKiloPendingStatus,
  hasCurrentReadyStatus,
  runWatchdog,
  selectStalePrs,
  selectStaleDraftPrs,
} = require('../../../.github/workflows/scripts/watch-pr-flow.cjs');

type Label = string | { name: string };

type WatchPr = {
  number: number;
  title: string;
  url: string;
  state?: string;
  isDraft: boolean;
  labels: Label[];
  headRefOid?: string;
  recoveryReasons?: string[];
};

function prFixture(overrides: Partial<WatchPr> = {}): WatchPr {
  return {
    number: 205,
    title: 'fix: sample',
    url: 'https://github.example.test/repo/pull/205',
    state: 'OPEN',
    isDraft: false,
    labels: [{ name: 'flow/draft' }],
    ...overrides,
  };
}

function leadingSpaces(value: string) {
  return value.match(/^\s*/)?.[0].length ?? 0;
}

function readWorkflowList(parentKey: string, childKey: string) {
  const workflow = readWorkflow('.github/workflows/pr-flow.yml');
  const lines = workflow.split(/\r?\n/);
  const parentIndex = lines.findIndex(
    (line) => line.trim() === `${parentKey}:`,
  );

  assert.notEqual(parentIndex, -1, `Missing ${parentKey}`);
  const parentIndent = leadingSpaces(lines[parentIndex]);
  let childIndex = -1;

  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const indent = leadingSpaces(line);
    if (indent <= parentIndent) break;
    if (line.trim() === `${childKey}:`) {
      childIndex = index;
      break;
    }
  }

  assert.notEqual(childIndex, -1, `Missing ${parentKey}.${childKey}`);
  const childIndent = leadingSpaces(lines[childIndex]);
  const values: string[] = [];

  for (const line of lines.slice(childIndex + 1)) {
    if (!line.trim()) continue;

    const indent = leadingSpaces(line);
    if (indent <= childIndent) break;

    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      values.push(trimmed.slice(2));
    }
  }

  return values;
}

function readWorkflow(path: string) {
  return fs.readFileSync(path, 'utf8');
}

function readTopLevelMapping(
  parentKey: string,
  workflowPath = '.github/workflows/pr-flow.yml',
) {
  const workflow = readWorkflow(workflowPath);
  const lines = workflow.split(/\r?\n/);
  const parentIndex = lines.findIndex(
    (line) => line.trim() === `${parentKey}:`,
  );

  assert.notEqual(parentIndex, -1, `Missing ${parentKey}`);
  const parentIndent = leadingSpaces(lines[parentIndex]);
  const values = new Map<string, string>();

  for (const line of lines.slice(parentIndex + 1)) {
    if (!line.trim()) continue;

    const indent = leadingSpaces(line);
    if (indent <= parentIndent) break;

    const match = line.trim().match(/^([a-z-]+):\s*(.+)$/);
    if (match) {
      values.set(match[1], match[2]);
    }
  }

  return values;
}

describe('PR flow watchdog', () => {
  it('selects non-draft PRs stuck on flow/draft', () => {
    const selected = selectStaleDraftPrs([prFixture()]);

    assert.deepEqual(
      selected.map((pr: WatchPr) => pr.number),
      [205],
    );
  });

  it('skips draft PRs stuck on flow/draft', () => {
    const selected = selectStaleDraftPrs([prFixture({ isDraft: true })]);

    assert.deepEqual(selected, []);
  });

  it('skips non-draft PRs without flow/draft', () => {
    const selected = selectStaleDraftPrs([
      prFixture({ labels: [{ name: 'flow/review-pending' }] }),
    ]);

    assert.deepEqual(selected, []);
  });

  it('detects open non-draft PRs missing pr-flow ready on current head', () => {
    const selected = selectStalePrs(
      [
        prFixture({
          labels: [{ name: 'flow/review-pending' }],
          headRefOid: 'abc123',
        }),
      ],
      { getStatuses: () => [{ context: 'ci/test', state: 'success' }] },
    );

    assert.deepEqual(
      selected.map((pr: WatchPr) => ({
        number: pr.number,
        reasons: pr.recoveryReasons,
      })),
      [{ number: 205, reasons: ['missing-ready-status'] }],
    );
  });

  it('selects PRs with expired pending Kilo review status', () => {
    const selected = selectStalePrs(
      [
        prFixture({
          labels: [],
          headRefOid: 'abc123',
        }),
      ],
      {
        now: '2026-06-24T12:00:00Z',
        getStatuses: () => [
          {
            context: 'pr-flow/ready',
            state: 'pending',
          },
          {
            context: 'pr-flow/kilo-review',
            state: 'pending',
            created_at: '2026-06-24T11:29:00Z',
          },
        ],
      },
    );

    assert.deepEqual(selected[0]?.recoveryReasons, ['expired-kilo-review']);
  });

  it('does not treat fresh Kilo pending status as expired', () => {
    assert.equal(
      hasExpiredKiloPendingStatus(
        [
          {
            context: 'pr-flow/kilo-review',
            state: 'pending',
            created_at: '2026-06-24T11:45:00Z',
          },
        ],
        { now: '2026-06-24T12:00:00Z' },
      ),
      false,
    );
  });

  it('skips open non-draft PRs with current pr-flow ready status', () => {
    const selected = selectStalePrs(
      [
        prFixture({
          labels: [{ name: 'flow/review-pending' }],
          headRefOid: 'abc123',
        }),
      ],
      {
        getStatuses: () => [
          { context: 'pr-flow/ready', state: 'pending' },
          { context: 'ci/test', state: 'success' },
        ],
      },
    );

    assert.deepEqual(selected, []);
  });

  it('recognizes ready status lists and combined status payloads', () => {
    assert.equal(
      hasCurrentReadyStatus([{ context: 'pr-flow/ready', state: 'success' }]),
      true,
    );
    assert.equal(
      hasCurrentReadyStatus({
        statuses: [{ context: 'pr-flow/ready', state: 'pending' }],
      }),
      true,
    );
    assert.equal(
      hasCurrentReadyStatus([{ context: 'pr-flow/code-review' }]),
      false,
    );
  });

  it('does not infer missing ready status when status reads fail', () => {
    const summary = runWatchdog({
      dryRun: true,
      listPullRequests() {
        return [
          prFixture({
            labels: [{ name: 'flow/review-pending' }],
            headRefOid: 'abc123',
          }),
        ];
      },
      runJsonCommand() {
        throw new Error('status read failed');
      },
    });

    assert.deepEqual(summary.selected, []);
  });

  it('still recovers stale draft labels when status reads fail', () => {
    const summary = runWatchdog({
      dryRun: true,
      listPullRequests() {
        return [prFixture({ headRefOid: 'abc123' })];
      },
      runJsonCommand() {
        throw new Error('status read failed');
      },
    });

    assert.deepEqual(summary.selected, [
      {
        number: 205,
        title: 'fix: sample',
        url: 'https://github.example.test/repo/pull/205',
        reasons: ['stale-draft'],
      },
    ]);
  });

  it('logs selected PRs in dry-run mode without dispatching', () => {
    let dispatchCount = 0;
    const summary = runWatchdog({
      dryRun: true,
      listPullRequests() {
        return [prFixture()];
      },
      dispatch() {
        dispatchCount += 1;
      },
    });

    assert.equal(dispatchCount, 0);
    assert.deepEqual(summary.selected, [
      {
        number: 205,
        title: 'fix: sample',
        url: 'https://github.example.test/repo/pull/205',
        reasons: ['stale-draft'],
      },
    ]);
    assert.deepEqual(summary.dispatched, []);
  });

  it('dispatches PR Orchestrator with dry_run=false for selected PRs', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const summary = runWatchdog({
      listPullRequests() {
        return [prFixture()];
      },
      dispatch(
        pr: WatchPr,
        { workflow, ref }: { workflow: string; ref: string },
      ) {
        calls.push({
          command: 'gh',
          args: buildDispatchArgs({ prNumber: pr.number, workflow, ref }),
        });
      },
    });

    assert.deepEqual(summary.dispatched, summary.selected);
    assert.deepEqual(calls, [
      {
        command: 'gh',
        args: [
          'workflow',
          'run',
          'pr-flow.yml',
          '--ref',
          'main',
          '-f',
          'pr_number=205',
          '-f',
          'dry_run=false',
        ],
      },
    ]);
  });
});

describe('PR flow workflow invariants', () => {
  it('keeps draft-to-ready orchestration wired on pull_request_target', () => {
    const types = readWorkflowList('pull_request_target', 'types');

    assert.deepEqual(types, [
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review',
      'converted_to_draft',
      'labeled',
      'unlabeled',
    ]);
  });

  it('keeps maintainer control PR comments wired through PR flow', () => {
    const workflow = readWorkflow('.github/workflows/pr-flow.yml');

    assert.match(workflow, /issue_comment:\s*\n\s+types: \[created\]/);
    assert.match(workflow, /--mode pr-flow-control/);
    assert.match(
      workflow,
      /contains\(github\.event\.comment\.body, '\/review'\)/,
    );
    assert.match(workflow, /names: maintainer-approved/);
    assert.match(
      workflow,
      /gh issue edit "\$PR_NUMBER" --add-label "maintainer-approved"/,
    );
    assert.match(
      workflow,
      /github\.event_name != 'issue_comment' \|\| steps\.comment\.outputs\.should_run == 'true'/,
    );
  });

  it('gates pull_request_target label churn before expensive PR flow steps', () => {
    const workflow = readWorkflow('.github/workflows/pr-flow.yml');

    assert.match(workflow, /classify-trigger:\s*\n\s+if:\s+>-\s*\n/);
    assert.match(workflow, /classify-trigger:[\s\S]*?runs-on:\s+self-hosted/);
    assert.match(
      workflow,
      /orchestrate:\s*\n\s+needs:\s+classify-trigger\s*\n\s+if:\s+>-\s*\n\s+needs\.classify-trigger\.outputs\.should_run == 'true'/,
    );
    assert.match(workflow, /--mode pr-flow-pull-request-target/);
    assert.match(workflow, /--config-file \.github\/pr-flow\.json/);
  });

  it('keeps workflow_run PR fallback before claiming a runner', () => {
    const workflow = readWorkflow('.github/workflows/pr-flow.yml');

    assert.doesNotMatch(
      workflow,
      /contains\(toJSON\(github\.event\.workflow_run\), '"display_title":"PR #'\)/,
    );
    assert.match(
      workflow,
      /classify-trigger:\s*\n\s+if:\s+>-\s*\n\s+\(\s*\n\s+github\.event_name != 'workflow_run' \|\|\s*\n\s+toJSON\(github\.event\.workflow_run\.pull_requests\) != '\[\]' \|\|\s*\n\s+startsWith\(github\.event\.workflow_run\.display_title \|\| '', 'PR #'\)/,
    );
    assert.match(
      workflow,
      /github\.event_name != 'issue_comment' \|\|\s*\n\s+\(\s*\n\s+github\.event\.issue\.pull_request != null &&\s*\n\s+\(\s*\n\s+contains\(github\.event\.comment\.body, '\/approve'\) \|\|\s*\n\s+contains\(github\.event\.comment\.body, '\/review'\)/,
    );
    assert.match(
      workflow,
      /run-name: "PR Orchestrator \$\{\{[\s\S]*github\.event\.workflow_run\.pull_requests\[0\]\.number && format\('PR #\{0\}', github\.event\.workflow_run\.pull_requests\[0\]\.number\)[\s\S]*startsWith\(github\.event\.workflow_run\.display_title \|\| '', 'PR #'\) && github\.event\.workflow_run\.display_title/,
    );
    assert.match(
      workflow,
      /group: pr-flow-\$\{\{[\s\S]*github\.event\.workflow_run\.pull_requests\[0\]\.number \|\| github\.event\.workflow_run\.display_title \|\| github\.event\.workflow_run\.head_branch/,
    );
  });

  it('keeps non-relevant label events from canceling an in-flight orchestrator run', () => {
    const workflow = readWorkflow('.github/workflows/pr-flow.yml');

    assert.match(
      workflow,
      /cancel-in-progress:\s+\$\{\{\s+github\.event_name != 'pull_request_target' \|\| \(github\.event\.action != 'labeled' && github\.event\.action != 'unlabeled'\)\s+\}\}/,
    );
  });

  it('keeps permissions required for check reads and worker dispatch', () => {
    const permissions = readTopLevelMapping('permissions');

    assert.equal(permissions.get('checks'), 'read');
    assert.equal(permissions.get('statuses'), 'write');
    assert.equal(permissions.get('actions'), 'write');
    assert.equal(permissions.get('pull-requests'), 'write');
    assert.equal(permissions.get('issues'), 'write');
  });

  it('keeps PR Policy permissions required for labels and statuses', () => {
    const permissions = readTopLevelMapping(
      'permissions',
      '.github/workflows/pr-policy.yml',
    );

    assert.equal(permissions.get('issues'), 'write');
    assert.equal(permissions.get('pull-requests'), 'write');
    assert.equal(permissions.get('statuses'), 'write');
  });

  it('keeps watchdog permissions required for status recovery reads', () => {
    const permissions = readTopLevelMapping(
      'permissions',
      '.github/workflows/pr-flow-watchdog.yml',
    );

    assert.equal(permissions.get('statuses'), 'read');
    assert.equal(permissions.get('actions'), 'write');
    assert.equal(permissions.get('pull-requests'), 'read');
  });

  it('keeps orchestrated workers able to wake the orchestrator', () => {
    const unconditionalWorkerWorkflows = [
      'code-review.yml',
      'dependency-review.yml',
      'pr-improve.yml',
    ];
    const baseWakeCondition =
      /if:\s*always\(\) && github\.event\.inputs\.orchestrated == 'true' && github\.event\.inputs\.pr_number != ''/;
    const dispatchCommand =
      /gh workflow run pr-flow\.yml\s+\\\n\s+--ref main\s+\\\n\s+-f pr_number="\$PR_NUMBER"\s+\\\n\s+-f dry_run=false/;

    for (const workflowName of unconditionalWorkerWorkflows) {
      const workflowPath = `.github/workflows/${workflowName}`;
      const workflow = readWorkflow(workflowPath);
      const permissions = readTopLevelMapping('permissions', workflowPath);

      assert.equal(permissions.get('actions'), 'write', workflowName);
      assert.match(workflow, baseWakeCondition, workflowName);
      assert.match(workflow, dispatchCommand, workflowName);
    }

    // PR Finalizer only re-wakes on approval to prevent rate-limit exhaustion
    const finalizerPath = '.github/workflows/pr-finalizer.yml';
    const finalizer = readWorkflow(finalizerPath);
    const finalizerPermissions = readTopLevelMapping(
      'permissions',
      finalizerPath,
    );
    assert.equal(
      finalizerPermissions.get('actions'),
      'write',
      'pr-finalizer.yml',
    );
    assert.equal(
      finalizerPermissions.get('checks'),
      'read',
      'pr-finalizer.yml',
    );
    assert.match(
      finalizer,
      /needs\.finalize\.outputs\.decision == 'approve_and_enable_automerge'/,
      'pr-finalizer.yml',
    );
    assert.match(
      finalizer,
      /evaluate-pr-finalizer-decision\.cjs/,
      'pr-finalizer.yml',
    );
    assert.doesNotMatch(
      finalizer,
      /gh pr checks[^\n]*2>\/dev\/null[^\n]*\|\| echo "\[\]"/,
      'pr-finalizer.yml',
    );
    assert.match(finalizer, dispatchCommand, 'pr-finalizer.yml');
  });

  it('wakes the orchestrator when PR Finalizer completes', () => {
    const workflow = readWorkflow('.github/workflows/pr-flow.yml');

    assert.match(workflow, /workflows:\s*\[[^\]]*'PR Finalizer'[^\]]*\]/);
  });

  it('wakes the orchestrator when PR Policy completes', () => {
    const workflow = readWorkflow('.github/workflows/pr-flow.yml');

    assert.match(workflow, /workflows:\s*\[[^\]]*'PR Policy'[^\]]*\]/);
  });

  it('keeps PR Finalizer maintainer approval scoped to manual gating', () => {
    const finalizerDecision = fs.readFileSync(
      '.github/workflows/scripts/evaluate-pr-finalizer-decision.cjs',
      'utf8',
    );

    assert.match(
      finalizerDecision,
      /const maintainerApproved = Boolean\(policy\.maintainer_approved\)/,
    );
    assert.match(finalizerDecision, /label === 'needs-review'/);
    assert.match(finalizerDecision, /manualReviewLabels\.length > 0/);
    assert.match(finalizerDecision, /!policyEligible && !maintainerApproved/);
  });

  it('allows explicit bots only for orchestrated Claude worker runs', () => {
    for (const workflowName of [
      'code-review.yml',
      'dependency-review.yml',
      'pr-improve.yml',
    ]) {
      const workflow = fs.readFileSync(
        `.github/workflows/${workflowName}`,
        'utf8',
      );

      assert.match(
        workflow,
        /allowed-bots:\s*\$\{\{\s*github\.event\.inputs\.orchestrated == 'true' && 'github-actions,github-actions\[bot\],claude\[bot\]' \|\| ''\s*\}\}/,
        workflowName,
      );
    }
  });
});
