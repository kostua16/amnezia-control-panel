/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  areAllRequiredChecksMissing,
  collectCheckEvidence,
  getRequiredCheckStatus,
  getRequiredCheckNames,
  getRequiredWorkflowNames,
  getUnavailableCheckStatus,
  pendingChecksForWorkflowRun,
  workflowRunMatchesRequiredChecks,
} = require('../required-check-evidence.cjs');

const CI_WORKFLOW = {
  workflow: 'CI',
  names: ['Lint', 'Type Check', 'Test', 'Build'],
};
const POLICY_WORKFLOW = {
  workflow: 'PR Policy',
  names: ['label-and-validate'],
};
const REQUIRED_CHECKS = [CI_WORKFLOW, POLICY_WORKFLOW];

const BASE_PR = {
  number: 42,
  headSha: 'abc123def',
  state: 'OPEN',
  mergedAt: '',
  isDraft: false,
  labels: [],
};

const BASE_CONFIG = {
  checks: { required: REQUIRED_CHECKS },
};

// ─── Helpers ────────────────────────────────────────────────────────

function runJsonOk(value) {
  return { ok: true, value, error: null };
}

function runJsonFail(error) {
  return { ok: false, value: null, error };
}

function ciJobs(conclusions) {
  const names = ['Lint', 'Type Check', 'Test', 'Build'];
  return {
    jobs: names.map((name, i) => ({
      name,
      status: 'completed',
      conclusion: conclusions[i] ?? 'success',
    })),
    workflowName: 'CI',
  };
}

function policyJobs(conclusion = 'success') {
  return {
    jobs: [{ name: 'label-and-validate', status: 'completed', conclusion }],
    workflowName: 'PR Policy',
  };
}

function completedRunList(workflowName, runId = 100) {
  return [
    {
      databaseId: runId,
      status: 'completed',
      conclusion: 'success',
      workflowName,
      headSha: BASE_PR.headSha,
      name: `${workflowName} run`,
    },
  ];
}

function collectWith(opts) {
  const {
    pr = BASE_PR,
    config = BASE_CONFIG,
    eventName = 'pull_request_target',
    event = {},
    runJson,
    allowRunListFallback = true,
  } = opts;
  return collectCheckEvidence({
    pr,
    config,
    eventName,
    event,
    runJson: runJson ?? runJsonOk([]),
    allowRunListFallback,
  });
}

// ─── getRequiredCheckStatus ──────────────────────────────────────────

test('getRequiredCheckStatus returns passed when all checks pass', () => {
  const checks = [
    { name: 'Lint', workflow: 'CI', bucket: 'pass', state: 'success' },
    { name: 'Type Check', workflow: 'CI', bucket: 'pass', state: 'success' },
    { name: 'Test', workflow: 'CI', bucket: 'pass', state: 'success' },
    { name: 'Build', workflow: 'CI', bucket: 'pass', state: 'success' },
    {
      name: 'label-and-validate',
      workflow: 'PR Policy',
      bucket: 'pass',
      state: 'success',
    },
  ];
  const result = getRequiredCheckStatus(checks, REQUIRED_CHECKS);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.failing, []);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.missing, []);
});

test('getRequiredCheckStatus returns failed when any check fails', () => {
  const checks = [
    { name: 'Lint', workflow: 'CI', bucket: 'fail', state: 'failure' },
  ];
  const result = getRequiredCheckStatus(checks, REQUIRED_CHECKS);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failing, ['Lint']);
});

test('getRequiredCheckStatus returns pending when checks are incomplete', () => {
  const checks = [
    { name: 'Lint', workflow: 'CI', bucket: 'pass', state: 'success' },
  ];
  const result = getRequiredCheckStatus(checks, REQUIRED_CHECKS);
  assert.equal(result.status, 'pending');
});

test('getRequiredCheckStatus treats skipped job as pass unless sibling failed', () => {
  const checks = [
    { name: 'Build', workflow: 'CI', bucket: 'skip', state: 'skipped' },
  ];
  const result = getRequiredCheckStatus(checks, REQUIRED_CHECKS);
  assert.equal(result.status, 'pending');
});

test('getRequiredCheckStatus treats skipped job as failure when sibling failed', () => {
  const checks = [
    { name: 'Lint', workflow: 'CI', bucket: 'fail', state: 'failure' },
    { name: 'Build', workflow: 'CI', bucket: 'skip', state: 'skipped' },
  ];
  const result = getRequiredCheckStatus(checks, REQUIRED_CHECKS);
  assert.equal(result.status, 'failed');
  assert.ok(
    result.failing.includes('Build'),
    'sibling-failure skip should be failing',
  );
});

// ─── areAllRequiredChecksMissing ──────────────────────────────────────

test('areAllRequiredChecksMissing returns true when every required check is missing', () => {
  const checkStatus = {
    failing: [],
    pending: [],
    missing: ['Lint', 'Type Check', 'Test', 'Build', 'label-and-validate'],
  };
  assert.equal(areAllRequiredChecksMissing(checkStatus, REQUIRED_CHECKS), true);
});

test('areAllRequiredChecksMissing returns false when at least one check is not missing', () => {
  const checkStatus = {
    failing: [],
    pending: ['Lint'],
    missing: ['Type Check', 'Test', 'Build', 'label-and-validate'],
  };
  assert.equal(
    areAllRequiredChecksMissing(checkStatus, REQUIRED_CHECKS),
    false,
  );
});

test('areAllRequiredChecksMissing returns false when failing checks exist', () => {
  const checkStatus = {
    failing: ['Lint'],
    pending: [],
    missing: ['Type Check', 'Test', 'Build', 'label-and-validate'],
  };
  assert.equal(
    areAllRequiredChecksMissing(checkStatus, REQUIRED_CHECKS),
    false,
  );
});

// ─── getRequiredCheckNames / getRequiredWorkflowNames ─────────────────

test('getRequiredCheckNames flattens all check names', () => {
  const names = getRequiredCheckNames(REQUIRED_CHECKS);
  assert.ok(names.includes('Lint'));
  assert.ok(names.includes('label-and-validate'));
});

test('getRequiredWorkflowNames extracts unique workflow names', () => {
  const workflows = getRequiredWorkflowNames(REQUIRED_CHECKS);
  assert.deepEqual(workflows, ['CI', 'PR Policy']);
});

// ─── workflowRunMatchesRequiredChecks ────────────────────────────────

test('workflowRunMatchesRequiredChecks matches completed run on matching head SHA and workflow', () => {
  const event = {
    workflow_run: {
      status: 'completed',
      head_sha: BASE_PR.headSha,
      workflow_name: 'CI',
      pull_requests: [{ number: BASE_PR.number }],
    },
  };
  assert.equal(
    workflowRunMatchesRequiredChecks(
      'workflow_run',
      event,
      BASE_PR,
      BASE_CONFIG,
    ),
    true,
  );
});

test('workflowRunMatchesRequiredChecks returns false for non-workflow_run events', () => {
  assert.equal(
    workflowRunMatchesRequiredChecks(
      'pull_request_target',
      {},
      BASE_PR,
      BASE_CONFIG,
    ),
    false,
  );
});

test('workflowRunMatchesRequiredChecks returns false when head SHA mismatches', () => {
  const event = {
    workflow_run: {
      status: 'completed',
      head_sha: 'other-sha',
      workflow_name: 'CI',
      pull_requests: [{ number: BASE_PR.number }],
    },
  };
  assert.equal(
    workflowRunMatchesRequiredChecks(
      'workflow_run',
      event,
      BASE_PR,
      BASE_CONFIG,
    ),
    false,
  );
});

test('workflowRunMatchesRequiredChecks returns false for non-required workflow', () => {
  const event = {
    workflow_run: {
      status: 'completed',
      head_sha: BASE_PR.headSha,
      workflow_name: 'Some Other Workflow',
      pull_requests: [{ number: BASE_PR.number }],
    },
  };
  assert.equal(
    workflowRunMatchesRequiredChecks(
      'workflow_run',
      event,
      BASE_PR,
      BASE_CONFIG,
    ),
    false,
  );
});

// ─── collectCheckEvidence: pr-checks path ────────────────────────────

test('collectCheckEvidence returns pr-checks when gh pr checks succeeds', () => {
  const checks = [
    { name: 'Lint', workflow: 'CI', bucket: 'pass', state: 'success' },
    { name: 'Type Check', workflow: 'CI', bucket: 'pass', state: 'success' },
    { name: 'Test', workflow: 'CI', bucket: 'pass', state: 'success' },
    { name: 'Build', workflow: 'CI', bucket: 'pass', state: 'success' },
    {
      name: 'label-and-validate',
      workflow: 'PR Policy',
      bucket: 'pass',
      state: 'success',
    },
  ];
  const result = collectWith({ runJson: () => runJsonOk(checks) });
  assert.equal(result.source, 'pr-checks');
  assert.equal(result.checkStatus.status, 'passed');
});

test('collectCheckEvidence returns unavailable when gh pr checks fails and allowRunListFallback is false', () => {
  const result = collectWith({
    eventName: 'pull_request_target',
    runJson: () => runJsonFail('HTTP 403'),
    allowRunListFallback: false,
  });
  assert.equal(result.checkStatus.status, 'unavailable');
  assert.equal(result.source, 'unavailable');
});

// ─── collectCheckEvidence: allowRunListFallback ───────────────────────

test('collectCheckEvidence uses workflow-run fallback when allowRunListFallback and gh pr checks fails', () => {
  let callCount = 0;
  const runJson = (cmd, args) => {
    callCount++;
    if (args[0] === 'pr') return runJsonFail('no check contexts visible');
    if (args[0] === 'run' && args[1] === 'list') {
      return runJsonOk([
        ...completedRunList('CI', 101),
        ...completedRunList('PR Policy', 102),
      ]);
    }
    if (args[0] === 'run' && args[1] === 'view') {
      const runId = Number(args[2]);
      if (runId === 101)
        return runJsonOk(ciJobs(['success', 'success', 'success', 'success']));
      if (runId === 102) return runJsonOk(policyJobs('success'));
    }
    return runJsonFail('unexpected call');
  };

  const result = collectWith({ runJson, eventName: 'issue_comment' });
  assert.equal(result.checkStatus.status, 'passed');
  assert.equal(result.source, 'workflow-run-jobs');
  assert.ok(callCount > 1, 'should have made multiple gh calls');
});

test('collectCheckEvidence uses workflow-run fallback when all required checks are missing from gh pr checks', () => {
  const runJson = (cmd, args) => {
    if (args[0] === 'pr')
      return runJsonOk([
        {
          name: 'unrelated-check',
          workflow: 'Other',
          bucket: 'pass',
          state: 'success',
        },
      ]);
    if (args[0] === 'run' && args[1] === 'list') {
      return runJsonOk([
        ...completedRunList('CI', 101),
        ...completedRunList('PR Policy', 102),
      ]);
    }
    if (args[0] === 'run' && args[1] === 'view') {
      const runId = Number(args[2]);
      if (runId === 101)
        return runJsonOk(ciJobs(['success', 'success', 'success', 'success']));
      if (runId === 102) return runJsonOk(policyJobs('success'));
    }
    return runJsonFail('unexpected call');
  };

  const result = collectWith({ runJson, eventName: 'pull_request_target' });
  assert.equal(result.checkStatus.status, 'passed');
  assert.equal(result.source, 'workflow-run-jobs');
});

test('collectCheckEvidence returns unavailable when workflow-run fallback also fails', () => {
  const runJson = (cmd, args) => {
    if (args[0] === 'pr') return runJsonFail('no access');
    if (args[0] === 'run' && args[1] === 'list')
      return runJsonFail('gh api error');
    return runJsonFail('unexpected');
  };

  const result = collectWith({ runJson, eventName: 'issue_comment' });
  assert.equal(result.checkStatus.status, 'unavailable');
  assert.match(result.checkStatus.reason, /Unable to list workflow runs/);
});

// ─── collectCheckEvidence: workflow_run event fallback ───────────────

test('collectCheckEvidence on workflow_run event uses event run id as primary fallback', () => {
  const event = {
    workflow_run: {
      status: 'completed',
      head_sha: BASE_PR.headSha,
      workflow_name: 'CI',
      database_id: 200,
      pull_requests: [{ number: BASE_PR.number }],
    },
  };
  let viewCalled = false;
  const runJson = (cmd, args) => {
    if (args[0] === 'pr') return runJsonOk([]); // empty pr checks
    if (args[0] === 'run' && args[1] === 'view' && args[2] === '200') {
      viewCalled = true;
      return runJsonOk(ciJobs(['success', 'success', 'success', 'success']));
    }
    if (args[0] === 'run' && args[1] === 'list') {
      return runJsonFail('gh api error');
    }
    return runJsonFail('unexpected');
  };

  const result = collectWith({ eventName: 'workflow_run', event, runJson });
  // CI passed but PR Policy missing → chains to broader fallback → broader fails
  assert.equal(result.checkStatus.status, 'unavailable');
  assert.match(result.checkStatus.reason, /missing required checks/);
  assert.ok(viewCalled, 'should have called run view for the event run id');
});

test('collectCheckEvidence reconciles stale pending PR checks on completed workflow_run', () => {
  const event = {
    workflow_run: {
      status: 'completed',
      head_sha: BASE_PR.headSha,
      workflow_name: 'CI',
      database_id: 200,
      pull_requests: [{ number: BASE_PR.number }],
    },
  };
  const pendingPrChecks = [
    { name: 'Lint', workflow: 'CI', bucket: 'pending', state: 'pending' },
    {
      name: 'Type Check',
      workflow: 'CI',
      bucket: 'pending',
      state: 'pending',
    },
    { name: 'Test', workflow: 'CI', bucket: 'pending', state: 'pending' },
    { name: 'Build', workflow: 'CI', bucket: 'pending', state: 'pending' },
    {
      name: 'label-and-validate',
      workflow: 'PR Policy',
      bucket: 'pass',
      state: 'success',
    },
  ];
  const runJson = (cmd, args) => {
    if (args[0] === 'pr') return runJsonOk(pendingPrChecks);
    if (args[0] === 'run' && args[1] === 'view' && args[2] === '200') {
      return runJsonOk(ciJobs(['skipped', 'skipped', 'skipped', 'skipped']));
    }
    if (args[0] === 'run' && args[1] === 'list') {
      return runJsonOk([
        ...completedRunList('CI', 200),
        ...completedRunList('PR Policy', 201),
      ]);
    }
    if (args[0] === 'run' && args[1] === 'view' && args[2] === '201') {
      return runJsonOk(policyJobs('success'));
    }
    return runJsonFail('unexpected');
  };

  const result = collectWith({ eventName: 'workflow_run', event, runJson });
  assert.equal(result.checkStatus.status, 'passed');
  assert.equal(result.source, 'workflow-run-jobs');
});

test('collectCheckEvidence preserves pending sibling workflow checks during workflow_run fallback', () => {
  const event = {
    workflow_run: {
      status: 'completed',
      head_sha: BASE_PR.headSha,
      workflow_name: 'CI',
      database_id: 200,
      pull_requests: [{ number: BASE_PR.number }],
    },
  };
  const pendingPrChecks = [
    { name: 'Lint', workflow: 'CI', bucket: 'pending', state: 'pending' },
    {
      name: 'Type Check',
      workflow: 'CI',
      bucket: 'pending',
      state: 'pending',
    },
    { name: 'Test', workflow: 'CI', bucket: 'pending', state: 'pending' },
    { name: 'Build', workflow: 'CI', bucket: 'pending', state: 'pending' },
    {
      name: 'label-and-validate',
      workflow: 'PR Policy',
      bucket: 'pending',
      state: 'pending',
    },
  ];
  let policyRunViewed = false;
  const runJson = (cmd, args) => {
    if (args[0] === 'pr') return runJsonOk(pendingPrChecks);
    if (args[0] === 'run' && args[1] === 'view' && args[2] === '200') {
      return runJsonOk(ciJobs(['skipped', 'skipped', 'skipped', 'skipped']));
    }
    if (args[0] === 'run' && args[1] === 'list') {
      return runJsonOk([...completedRunList('CI', 200)]);
    }
    if (args[0] === 'run' && args[1] === 'view' && args[2] !== '200') {
      policyRunViewed = true;
    }
    return runJsonFail('unexpected');
  };

  const result = collectWith({ eventName: 'workflow_run', event, runJson });
  assert.equal(result.checkStatus.status, 'pending');
  assert.deepEqual(result.checkStatus.pending, ['label-and-validate']);
  assert.equal(result.source, 'workflow-run-jobs');
  assert.equal(
    policyRunViewed,
    false,
    'pending PR-check rows from sibling workflows should not require completed runs',
  );
});

test('collectCheckEvidence preserves in-flight sibling workflow runs as pending', () => {
  const event = {
    workflow_run: {
      status: 'completed',
      head_sha: BASE_PR.headSha,
      workflow_name: 'CI',
      database_id: 200,
      pull_requests: [{ number: BASE_PR.number }],
    },
  };
  const pendingPrChecks = [
    { name: 'Lint', workflow: 'CI', bucket: 'pending', state: 'pending' },
    {
      name: 'Type Check',
      workflow: 'CI',
      bucket: 'pending',
      state: 'pending',
    },
    { name: 'Test', workflow: 'CI', bucket: 'pending', state: 'pending' },
    { name: 'Build', workflow: 'CI', bucket: 'pending', state: 'pending' },
  ];
  let policyRunViewed = false;
  const runJson = (cmd, args) => {
    if (args[0] === 'pr') return runJsonOk(pendingPrChecks);
    if (args[0] === 'run' && args[1] === 'view' && args[2] === '200') {
      return runJsonOk(ciJobs(['skipped', 'skipped', 'skipped', 'skipped']));
    }
    if (args[0] === 'run' && args[1] === 'list') {
      return runJsonOk([
        ...completedRunList('CI', 200),
        {
          databaseId: 201,
          status: 'in_progress',
          conclusion: '',
          workflowName: 'PR Policy',
          headSha: BASE_PR.headSha,
          name: 'PR Policy run',
        },
      ]);
    }
    if (args[0] === 'run' && args[1] === 'view' && args[2] !== '200') {
      policyRunViewed = true;
    }
    return runJsonFail('unexpected');
  };

  const result = collectWith({ eventName: 'workflow_run', event, runJson });
  assert.equal(result.checkStatus.status, 'pending');
  assert.deepEqual(result.checkStatus.pending, ['label-and-validate']);
  assert.equal(result.source, 'workflow-run-jobs');
  assert.equal(
    policyRunViewed,
    false,
    'in-flight sibling workflow should stay pending without requiring job details',
  );
});

test('collectCheckEvidence chains to broader fallback when workflow_run jobs are missing checks', () => {
  const event = {
    workflow_run: {
      status: 'completed',
      head_sha: BASE_PR.headSha,
      workflow_name: 'CI',
      database_id: 200,
      pull_requests: [{ number: BASE_PR.number }],
    },
  };
  let broaderFallbackCalled = false;
  let triggeringRunViewCalls = 0;
  const runJson = (cmd, args) => {
    if (args[0] === 'pr') return runJsonOk([]); // empty pr checks
    if (args[0] === 'run' && args[1] === 'view' && args[2] === '200') {
      triggeringRunViewCalls += 1;
      return runJsonOk(ciJobs(['success', 'success', 'success', 'success']));
    }
    if (args[0] === 'run' && args[1] === 'list') {
      broaderFallbackCalled = true;
      return runJsonOk([
        ...completedRunList('CI', 200),
        ...completedRunList('PR Policy', 201),
      ]);
    }
    if (args[0] === 'run' && args[1] === 'view' && args[2] === '201') {
      return runJsonOk(policyJobs('success'));
    }
    return runJsonFail('unexpected');
  };

  const result = collectWith({ eventName: 'workflow_run', event, runJson });
  assert.equal(result.checkStatus.status, 'passed');
  assert.ok(broaderFallbackCalled, 'should have tried broader fallback');
  assert.equal(triggeringRunViewCalls, 1);
});

test('collectCheckEvidence returns unavailable when both workflow_run and broader fallback fail', () => {
  const event = {
    workflow_run: {
      status: 'completed',
      head_sha: BASE_PR.headSha,
      workflow_name: 'CI',
      database_id: 200,
      pull_requests: [{ number: BASE_PR.number }],
    },
  };
  const runJson = (cmd, args) => {
    if (args[0] === 'pr') return runJsonOk([]);
    if (args[0] === 'run' && args[1] === 'view' && args[2] === '200') {
      return runJsonOk(ciJobs(['success', 'success', 'success', 'success']));
    }
    if (args[0] === 'run' && args[1] === 'list') {
      return runJsonFail('gh api error');
    }
    return runJsonFail('unexpected');
  };

  const result = collectWith({ eventName: 'workflow_run', event, runJson });
  assert.equal(result.checkStatus.status, 'unavailable');
  assert.match(result.checkStatus.reason, /missing required checks/);
  assert.match(result.reason, /Broader workflow-run search also failed/);
  assert.equal(result.reason, result.checkStatus.reason);
});

// ─── getUnavailableCheckStatus ───────────────────────────────────────

test('getUnavailableCheckStatus returns correct shape', () => {
  const result = getUnavailableCheckStatus('some error', ['Lint']);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'some error');
  assert.deepEqual(result.failing, []);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.missing, ['Lint']);
});

// ─── pendingChecksForWorkflowRun ─────────────────────────────────────

test('pendingChecksForWorkflowRun maps completed run status to pending checks', () => {
  const group = CI_WORKFLOW;
  const run = { status: 'completed', headSha: BASE_PR.headSha };
  const result = pendingChecksForWorkflowRun(group, run);
  assert.equal(result.length, 4);
  assert.equal(result[0].bucket, 'pending');
  assert.equal(result[0].state, 'completed');
  assert.equal(result[0].name, 'Lint');
});

test('pendingChecksForWorkflowRun maps in_progress run status to pending checks', () => {
  const group = CI_WORKFLOW;
  const run = { status: 'in_progress', headSha: BASE_PR.headSha };
  const result = pendingChecksForWorkflowRun(group, run);
  assert.equal(result.length, 4);
  assert.equal(result[0].bucket, 'pending');
  assert.equal(result[0].state, 'in_progress');
});

test('pendingChecksForWorkflowRun maps queued run status to pending checks', () => {
  const group = CI_WORKFLOW;
  const run = { status: 'queued', headSha: BASE_PR.headSha };
  const result = pendingChecksForWorkflowRun(group, run);
  assert.equal(result.length, 4);
  for (const check of result) {
    assert.equal(check.bucket, 'pending', 'queued run should produce pending bucket');
    assert.equal(check.state, 'queued', 'queued run should preserve queued state');
  }
});

test('pendingChecksForWorkflowRun maps undefined status to pending fallback', () => {
  const group = CI_WORKFLOW;
  const run = { headSha: BASE_PR.headSha };
  const result = pendingChecksForWorkflowRun(group, run);
  assert.equal(result.length, 4);
  assert.equal(result[0].state, 'pending');
});

// ─── reconciliation indicator ─────────────────────────────────────────

test('collectChecksFromWorkflowRuns returns reconciled field when stale-pending fires', () => {
  const runJson = (cmd, args) => {
    if (args[0] === 'pr') {
      // gh pr checks fails → triggers allowRunListFallback → collectChecksFromWorkflowRuns
      return runJsonFail('no check contexts visible');
    }
    if (args[0] === 'run' && args[1] === 'list') {
      return runJsonOk([
        {
          databaseId: 300,
          status: 'in_progress',
          conclusion: '',
          workflowName: 'CI',
          headSha: BASE_PR.headSha,
          name: 'CI run',
        },
        {
          databaseId: 301,
          status: 'queued',
          conclusion: '',
          workflowName: 'PR Policy',
          headSha: BASE_PR.headSha,
          name: 'PR Policy run',
        },
      ]);
    }
    return runJsonFail('unexpected');
  };

  const result = collectCheckEvidence({
    pr: BASE_PR,
    config: BASE_CONFIG,
    eventName: 'issue_comment',
    event: {},
    runJson,
    allowRunListFallback: true,
  });
  assert.ok(result.reconciled, 'should include reconciled array');
  assert.ok(result.reconciled.includes('CI:in_progress'));
  assert.ok(result.reconciled.includes('PR Policy:queued'));
  assert.match(result.reason, /Stale-pending reconciliation/);
});
