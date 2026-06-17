/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('child_process');

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function run(command, args, options = {}) {
  const stdio = options.input
    ? ['pipe', 'pipe', 'pipe']
    : ['ignore', 'pipe', 'pipe'];

  try {
    return (
      execFileSync(command, args, {
        encoding: 'utf8',
        env: process.env,
        input: options.input,
        stdio,
      }) ?? ''
    ).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim();
    const allowed =
      options.allowFailure &&
      (!options.allowedFailurePattern ||
        options.allowedFailurePattern.test(stderr));

    if (allowed) {
      return options.fallback ?? '';
    }

    if (stderr) {
      console.error(stderr);
    }
    throw error;
  }
}

function runJsonResult(command, args, fallback = null) {
  try {
    return {
      ok: true,
      value: JSON.parse(run(command, args)),
      error: null,
    };
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim();
    const message = String(error.message ?? '').trim();
    return {
      ok: false,
      value: fallback,
      error: stderr || message || 'Command failed.',
    };
  }
}

function getRequiredCheckStatus(checks, requiredChecks) {
  const missing = [];
  const pending = [];
  const failing = [];

  for (const group of requiredChecks ?? []) {
    for (const name of group.names ?? []) {
      const match = checks.find((check) => {
        const workflowMatches =
          !group.workflow || check.workflow === group.workflow;
        return workflowMatches && check.name === name;
      });

      if (!match) {
        missing.push(name);
        continue;
      }

      const bucket = String(match.bucket ?? '').toLowerCase();
      const state = String(match.state ?? '').toLowerCase();

      if (bucket === 'fail' || bucket === 'cancel' || state === 'failure') {
        failing.push(name);
      } else if (bucket === 'skip') {
        // intentionally skipped — neither failing nor pending; does not block
      } else if (bucket !== 'pass' && state !== 'success') {
        pending.push(name);
      }
    }
  }

  if (failing.length > 0) {
    return { status: 'failed', failing, pending, missing };
  }

  if (pending.length > 0 || missing.length > 0) {
    return { status: 'pending', failing, pending, missing };
  }

  return { status: 'passed', failing, pending, missing };
}

function getUnavailableCheckStatus(reason, missing = []) {
  return {
    status: 'unavailable',
    failing: [],
    pending: [],
    missing,
    reason,
  };
}

function getRequiredCheckNames(requiredChecks) {
  return unique((requiredChecks ?? []).flatMap((group) => group.names ?? []));
}

function getRequiredWorkflowNames(requiredChecks) {
  return unique((requiredChecks ?? []).map((group) => group.workflow));
}

function areAllRequiredChecksMissing(checkStatus, requiredChecks) {
  const requiredNames = getRequiredCheckNames(requiredChecks);
  return (
    requiredNames.length > 0 &&
    checkStatus.failing.length === 0 &&
    checkStatus.pending.length === 0 &&
    requiredNames.every((name) => checkStatus.missing.includes(name))
  );
}

function getWorkflowRunName(workflowRun) {
  return workflowRun?.workflow_name ?? workflowRun?.name ?? '';
}

function workflowRunMatchesRequiredChecks(eventName, event, pr, config) {
  if (eventName !== 'workflow_run') return false;

  const workflowRun = event.workflow_run ?? {};
  const requiredWorkflowNames = getRequiredWorkflowNames(
    config.checks?.required,
  );
  const workflowName = getWorkflowRunName(workflowRun);
  const headSha = workflowRun.head_sha ?? workflowRun.headSha ?? '';
  const status = String(workflowRun.status ?? '').toLowerCase();
  const prNumbers = (workflowRun.pull_requests ?? [])
    .map((item) => toNumber(item.number))
    .filter(Boolean);
  const prMatches =
    prNumbers.length === 0 || prNumbers.includes(toNumber(pr.number));

  return (
    status === 'completed' &&
    headSha === pr.headSha &&
    prMatches &&
    requiredWorkflowNames.includes(workflowName)
  );
}

function getWorkflowRunId(event) {
  return (
    event.workflow_run?.database_id ??
    event.workflow_run?.databaseId ??
    event.workflow_run?.id ??
    null
  );
}

function mapJobConclusion(job) {
  const status = String(job.status ?? '').toLowerCase();
  const conclusion = String(job.conclusion ?? '').toLowerCase();

  if (status !== 'completed') {
    return { bucket: 'pending', state: status || 'pending' };
  }

  if (conclusion === 'success') {
    return { bucket: 'pass', state: 'success' };
  }

  // A skipped job (its `if:` evaluated false) is an intentional non-run and must
  // not block a merge. A cancelled job was aborted mid-run and did not actually
  // pass, so it stays blocking. See docs/workflow-e2e-scenarios.md (merge gate).
  if (conclusion === 'skipped') {
    return { bucket: 'skip', state: 'skipped' };
  }

  if (conclusion === 'cancelled') {
    return { bucket: 'cancel', state: 'cancelled' };
  }

  if (
    ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(
      conclusion,
    )
  ) {
    return { bucket: 'fail', state: conclusion };
  }

  return { bucket: 'pending', state: conclusion || status || 'pending' };
}

function workflowRunJobsToChecks(runView, workflowName) {
  return (runView?.jobs ?? []).map((job) => ({
    name: job.name,
    workflow: runView.workflowName ?? workflowName,
    ...mapJobConclusion(job),
  }));
}

function workflowRunName(run) {
  return run.workflowName ?? run.workflow_name ?? run.name ?? '';
}

function workflowRunHeadSha(run) {
  return run.headSha ?? run.head_sha ?? '';
}

function workflowRunDatabaseId(run) {
  return run.databaseId ?? run.database_id ?? run.id ?? null;
}

function findExactHeadWorkflowRun(runs, pr, workflowName) {
  return (runs ?? []).find((run) => {
    const status = String(run.status ?? '').toLowerCase();
    return (
      status === 'completed' &&
      workflowRunHeadSha(run) === pr.headSha &&
      workflowRunName(run) === workflowName
    );
  });
}

function collectChecksFromWorkflowRuns({ pr, config, runJson }) {
  const requiredChecks = config.checks?.required ?? [];
  const requiredNames = getRequiredCheckNames(requiredChecks);
  const runListResult = runJson(
    'gh',
    [
      'run',
      'list',
      '--commit',
      pr.headSha,
      '--limit',
      '50',
      '--json',
      'databaseId,status,conclusion,workflowName,name,headSha,url',
    ],
    [],
  );

  if (!runListResult.ok) {
    return {
      checks: null,
      checkStatus: getUnavailableCheckStatus(
        `Unable to list workflow runs for required checks: ${runListResult.error}`,
        requiredNames,
      ),
      source: 'unavailable',
      reason: `Unable to list workflow runs for required checks: ${runListResult.error}`,
    };
  }

  const jobChecks = [];

  for (const group of requiredChecks) {
    const workflowName = group.workflow ?? '';
    const run = findExactHeadWorkflowRun(
      runListResult.value ?? [],
      pr,
      workflowName,
    );

    if (!run) {
      return {
        checks: null,
        checkStatus: getUnavailableCheckStatus(
          `No completed ${workflowName} workflow run found for head ${pr.headSha}.`,
          group.names ?? [],
        ),
        source: 'unavailable',
        reason: `No completed ${workflowName} workflow run found for head ${pr.headSha}.`,
      };
    }

    const runId = workflowRunDatabaseId(run);
    if (!runId) {
      return {
        checks: null,
        checkStatus: getUnavailableCheckStatus(
          `Completed ${workflowName} workflow run did not include a run id.`,
          group.names ?? [],
        ),
        source: 'unavailable',
        reason: `Completed ${workflowName} workflow run did not include a run id.`,
      };
    }

    const runViewResult = runJson(
      'gh',
      [
        'run',
        'view',
        String(runId),
        '--json',
        'jobs,workflowName,status,conclusion',
      ],
      null,
    );

    if (!runViewResult.ok || !runViewResult.value) {
      return {
        checks: null,
        checkStatus: getUnavailableCheckStatus(
          `Unable to read ${workflowName} workflow-run jobs: ${runViewResult.error}`,
          group.names ?? [],
        ),
        source: 'unavailable',
        reason: `Unable to read ${workflowName} workflow-run jobs: ${runViewResult.error}`,
      };
    }

    jobChecks.push(
      ...workflowRunJobsToChecks(runViewResult.value, workflowName),
    );
  }

  const jobCheckStatus = getRequiredCheckStatus(jobChecks, requiredChecks);

  if (jobCheckStatus.missing.length > 0) {
    return {
      checks: null,
      checkStatus: getUnavailableCheckStatus(
        `Completed workflow-run jobs are missing required checks: ${jobCheckStatus.missing.join(', ')}.`,
        jobCheckStatus.missing,
      ),
      source: 'unavailable',
      reason: `Completed workflow-run jobs are missing required checks: ${jobCheckStatus.missing.join(', ')}.`,
    };
  }

  return {
    checks: jobChecks,
    checkStatus: jobCheckStatus,
    source: 'workflow-run-jobs',
    reason: `Mapped completed workflow-run jobs for required checks at ${pr.headSha}.`,
  };
}

function collectCheckEvidence({
  pr,
  config,
  eventName,
  event,
  runJson = runJsonResult,
  allowRunListFallback = false,
}) {
  const requiredChecks = config.checks?.required ?? [];
  const requiredNames = getRequiredCheckNames(requiredChecks);
  const prChecksResult = runJson(
    'gh',
    [
      'pr',
      'checks',
      String(pr.number),
      '--json',
      'name,state,bucket,workflow,link',
    ],
    [],
  );
  const prChecks = prChecksResult.value ?? [];
  const prCheckStatus = prChecksResult.ok
    ? getRequiredCheckStatus(prChecks, requiredChecks)
    : getUnavailableCheckStatus(
        `Unable to read PR checks: ${prChecksResult.error}`,
        requiredNames,
      );
  const shouldFallback =
    workflowRunMatchesRequiredChecks(eventName, event, pr, config) &&
    (!prChecksResult.ok ||
      areAllRequiredChecksMissing(prCheckStatus, requiredChecks));

  if (
    !shouldFallback &&
    allowRunListFallback &&
    (!prChecksResult.ok ||
      areAllRequiredChecksMissing(prCheckStatus, requiredChecks))
  ) {
    return collectChecksFromWorkflowRuns({ pr, config, runJson });
  }

  if (!shouldFallback) {
    return {
      checks: prChecksResult.ok ? prChecks : null,
      checkStatus: prCheckStatus,
      source: prChecksResult.ok ? 'pr-checks' : 'unavailable',
      reason: prChecksResult.ok
        ? 'Read PR checks.'
        : `Unable to read PR checks: ${prChecksResult.error}`,
    };
  }

  const runId = getWorkflowRunId(event);
  if (!runId) {
    return {
      checks: null,
      checkStatus: getUnavailableCheckStatus(
        'Completed required workflow_run did not include a run id.',
        requiredNames,
      ),
      source: 'unavailable',
      reason: 'Completed required workflow_run did not include a run id.',
    };
  }

  const workflowName = getWorkflowRunName(event.workflow_run);
  const runViewResult = runJson(
    'gh',
    [
      'run',
      'view',
      String(runId),
      '--json',
      'jobs,workflowName,status,conclusion',
    ],
    null,
  );

  if (!runViewResult.ok || !runViewResult.value) {
    return {
      checks: null,
      checkStatus: getUnavailableCheckStatus(
        `Unable to read workflow_run jobs: ${runViewResult.error}`,
        requiredNames,
      ),
      source: 'unavailable',
      reason: `Unable to read workflow_run jobs: ${runViewResult.error}`,
    };
  }

  const jobChecks = workflowRunJobsToChecks(runViewResult.value, workflowName);
  const jobCheckStatus = getRequiredCheckStatus(jobChecks, requiredChecks);

  if (jobCheckStatus.missing.length > 0) {
    return {
      checks: null,
      checkStatus: getUnavailableCheckStatus(
        `Completed ${workflowName} workflow_run jobs are missing required checks: ${jobCheckStatus.missing.join(', ')}.`,
        jobCheckStatus.missing,
      ),
      source: 'unavailable',
      reason: `Completed ${workflowName} workflow_run jobs are missing required checks: ${jobCheckStatus.missing.join(', ')}.`,
    };
  }

  return {
    checks: jobChecks,
    checkStatus: jobCheckStatus,
    source: 'workflow-run-jobs',
    reason: `Mapped completed ${workflowName} workflow_run jobs for required checks.`,
  };
}

module.exports = {
  areAllRequiredChecksMissing,
  collectCheckEvidence,
  collectChecksFromWorkflowRuns,
  findExactHeadWorkflowRun,
  getRequiredCheckNames,
  getRequiredCheckStatus,
  getRequiredWorkflowNames,
  getUnavailableCheckStatus,
  getWorkflowRunId,
  getWorkflowRunName,
  mapJobConclusion,
  runJsonResult,
  workflowRunDatabaseId,
  workflowRunJobsToChecks,
  workflowRunHeadSha,
  workflowRunMatchesRequiredChecks,
  workflowRunName,
};
