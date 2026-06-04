import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildDispatchArgs,
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
  const childIndex = lines.findIndex((line, index) => {
    if (index <= parentIndex || !line.trim()) return false;
    const indent = leadingSpaces(line);
    return indent > parentIndent && line.trim() === `${childKey}:`;
  });

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

  it('keeps permissions required for check reads and worker dispatch', () => {
    const permissions = readTopLevelMapping('permissions');

    assert.equal(permissions.get('checks'), 'read');
    assert.equal(permissions.get('statuses'), 'write');
    assert.equal(permissions.get('actions'), 'write');
    assert.equal(permissions.get('pull-requests'), 'write');
    assert.equal(permissions.get('issues'), 'write');
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
    const workerWorkflows = [
      'code-review.yml',
      'dependency-review.yml',
      'pr-improve.yml',
      'pr-finalizer.yml',
    ];

    for (const workflowName of workerWorkflows) {
      const workflowPath = `.github/workflows/${workflowName}`;
      const workflow = readWorkflow(workflowPath);
      const permissions = readTopLevelMapping('permissions', workflowPath);

      assert.equal(permissions.get('actions'), 'write', workflowName);
      assert.match(
        workflow,
        /if:\s*always\(\) && github\.event\.inputs\.orchestrated == 'true' && github\.event\.inputs\.pr_number != ''/,
        workflowName,
      );
      assert.match(
        workflow,
        /gh workflow run pr-flow\.yml\s+\\\n\s+--ref main\s+\\\n\s+-f pr_number="\$PR_NUMBER"\s+\\\n\s+-f dry_run=false/,
        workflowName,
      );
    }
  });

  it('wakes the orchestrator when PR Finalizer completes', () => {
    const workflow = readWorkflow('.github/workflows/pr-flow.yml');

    assert.match(workflow, /workflows:\s*\[[^\]]*'PR Finalizer'[^\]]*\]/);
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
