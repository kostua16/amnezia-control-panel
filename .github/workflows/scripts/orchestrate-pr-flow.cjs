/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');

const TIMING_NAMES = [
  'resolve-pr',
  'checks',
  'policy',
  'worker-runs',
  'labels',
  'dispatch',
  'visibility',
];

const DEFAULT_STATUS_CONFIG = {
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
    prImprove: {
      context: 'pr-flow/pr-improve',
      description: 'Optional PR improvement worker status',
    },
    finalizer: {
      context: 'pr-flow/finalizer',
      description: 'PR finalizer worker status',
    },
  },
};

const STATUS_WORKER_LABELS = {
  codeReview: 'Code review',
  securityReview: 'Security review',
  dependencyReview: 'Dependency review',
  prImprove: 'PR Improve',
  finalizer: 'Finalizer',
};

const MANUAL_REVIEW_LABELS = new Set(['needs-review']);

const COMMENT_MARKER = '<!-- pr-flow-orchestration -->';

const PR_NOT_FOUND_PATTERN =
  /Could not resolve to a PullRequest|no pull requests found|HTTP 404|Not Found/i;

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readConfig(filePath) {
  return readJson(filePath);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value) {
  return String(value ?? '').toLowerCase() === 'true';
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

function runJson(command, args, fallback, options = {}) {
  const output = run(command, args, {
    allowFailure: fallback !== undefined,
    allowedFailurePattern: options.allowedFailurePattern,
    fallback: fallback === undefined ? undefined : JSON.stringify(fallback),
  });
  return output ? JSON.parse(output) : fallback;
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

function createTimings() {
  return Object.fromEntries(TIMING_NAMES.map((name) => [name, 0]));
}

function timeStep(timings, name, fn) {
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    const elapsed = performance.now() - startedAt;
    timings[name] = Number(((timings[name] ?? 0) + elapsed).toFixed(2));
    console.log(
      `::notice title=PR flow timing::${name} ${elapsed.toFixed(2)}ms`,
    );
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeLabels(labels) {
  return unique(
    (labels ?? []).map((label) => {
      if (typeof label === 'string') return label;
      return label.name;
    }),
  );
}

function normalizeFiles(files) {
  return unique(
    (files ?? []).map((file) => {
      if (typeof file === 'string') return file;
      return file.path ?? file.filename;
    }),
  );
}

function hasAny(labels, names) {
  return (names ?? []).some((name) => labels.includes(name));
}

function hasAll(labels, names) {
  return (names ?? []).every((name) => labels.includes(name));
}

function splitBlockingLabels(labels) {
  const manualReview = [];
  const hard = [];

  for (const label of labels ?? []) {
    if (MANUAL_REVIEW_LABELS.has(label)) {
      manualReview.push(label);
    } else {
      hard.push(label);
    }
  }

  return { hard, manualReview };
}

function isHeadResetEvent(eventName, event) {
  return (
    eventName === 'pull_request_target' &&
    ['opened', 'synchronize', 'reopened'].includes(event.action)
  );
}

function resolvePrNumber(eventName, event, explicitPrNumber) {
  const explicit = toNumber(explicitPrNumber);
  if (explicit) return explicit;

  if (eventName === 'pull_request_target' || eventName === 'pull_request') {
    return toNumber(event.pull_request?.number);
  }

  if (eventName === 'workflow_run') {
    const fromPayload = toNumber(
      event.workflow_run?.pull_requests?.[0]?.number,
    );
    if (fromPayload) return fromPayload;

    const title = String(
      event.workflow_run?.display_title ?? event.workflow_run?.name ?? '',
    ).trim();
    const match = title.match(/^PR #(\d+)\b/);
    return match ? toNumber(match[1]) : null;
  }

  return toNumber(event.inputs?.pr_number);
}

function normalizePr(pr) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state ?? '',
    mergedAt: pr.mergedAt ?? '',
    isDraft: Boolean(pr.isDraft),
    headRefName: pr.headRefName ?? '',
    headSha: pr.headRefOid ?? pr.head?.sha ?? '',
    baseRefName: pr.baseRefName ?? pr.base?.ref ?? 'main',
    authorLogin: pr.author?.login ?? pr.user?.login ?? null,
    labels: normalizeLabels(pr.labels),
    files: normalizeFiles(pr.files),
    isCrossRepository: Boolean(pr.isCrossRepository),
  };
}

function writeTempJson(prefix, value) {
  const filePath = path.join(
    os.tmpdir(),
    `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

function getRepoSlug() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !repo.includes('/')) {
    throw new Error('GITHUB_REPOSITORY must be set to owner/repo.');
  }
  return repo;
}

function getCurrentRunUrl() {
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  return repo && runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : '';
}

function formatCommandError(error) {
  const stderr = String(error?.stderr ?? '').trim();
  const stdout = String(error?.stdout ?? '').trim();
  const message = String(error?.message ?? '').trim();
  return stderr || stdout || message || 'Command failed.';
}

function truncateStatusDescription(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 140
    ? `${normalized.slice(0, 137)}...`
    : normalized;
}

function getStatusConfig(config) {
  return {
    aggregate: {
      ...DEFAULT_STATUS_CONFIG.aggregate,
      ...(config.statuses?.aggregate ?? {}),
    },
    workers: {
      ...DEFAULT_STATUS_CONFIG.workers,
      ...(config.statuses?.workers ?? {}),
    },
  };
}

function emptyPolicy() {
  return {
    dependabot: null,
    should_analyze: false,
    manual_only: false,
    blocking_labels_present: [],
  };
}

function evaluatePolicy(pr, policyFile) {
  const prFile = writeTempJson('pr-flow-pr', {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    isDraft: pr.isDraft,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    author: { login: pr.authorLogin },
    labels: pr.labels,
    files: pr.files,
    isCrossRepository: pr.isCrossRepository,
  });

  try {
    return JSON.parse(
      run('node', [
        '.github/workflows/scripts/evaluate-pr-policy.cjs',
        '--policy-file',
        policyFile,
        '--pr-file',
        prFile,
      ]),
    );
  } finally {
    fs.rmSync(prFile, { force: true });
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

function getNotRequestedCheckStatus() {
  return { status: 'not_requested', failing: [], pending: [], missing: [] };
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

  if (conclusion === 'cancelled' || conclusion === 'skipped') {
    return { bucket: 'cancel', state: conclusion };
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

function collectCheckEvidence({
  pr,
  config,
  eventName,
  event,
  runJson = runJsonResult,
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

function pathsMatch(files, paths) {
  return files.some((file) => (paths ?? []).includes(file));
}

function matchesWorkerTitle(runItem, pr) {
  const title = runItem.displayTitle ?? runItem.display_title ?? '';
  return title.includes(`PR #${pr.number}`) && title.includes(pr.headSha);
}

function summarizeWorkerRuns(workerRuns, workerName, pr) {
  const runs = (workerRuns[workerName] ?? [])
    .filter((runItem) => matchesWorkerTitle(runItem, pr))
    .sort((a, b) =>
      String(b.createdAt ?? b.created_at ?? '').localeCompare(
        String(a.createdAt ?? a.created_at ?? ''),
      ),
    );
  const active = runs.find((runItem) =>
    ['queued', 'in_progress', 'pending', 'waiting', 'requested'].includes(
      String(runItem.status ?? '').toLowerCase(),
    ),
  );

  return {
    active,
    latest: runs[0] ?? null,
  };
}

function getWorkerSummary(workerRuns, workerName, pr) {
  return summarizeWorkerRuns(workerRuns, workerName, pr);
}

function workerRunFailed(summary) {
  return (
    summary.latest &&
    summary.latest.conclusion &&
    summary.latest.conclusion !== 'success'
  );
}

function workerRunSucceeded(summary) {
  return summary.latest?.conclusion === 'success';
}

function getWorkerTargetUrl(summary, fallbackUrl) {
  return summary.active?.url || summary.latest?.url || fallbackUrl;
}

function makeCommitStatus({
  context,
  state,
  displayState = state,
  description,
  targetUrl,
  details = '',
}) {
  return {
    context,
    state,
    displayState,
    description: truncateStatusDescription(description),
    targetUrl,
    details,
  };
}

function makeWorkerStatus(statusConfig, workerName, values) {
  const configured = statusConfig.workers[workerName];
  return makeCommitStatus({
    context: configured.context,
    ...values,
  });
}

function buildFlowVisibility({
  pr,
  config,
  policy = emptyPolicy(),
  decision,
  workerRuns = {},
  eventName,
  event,
  dispatchOutcome = null,
  visibilityErrors = [],
  currentRunUrl = getCurrentRunUrl(),
}) {
  const statusConfig = getStatusConfig(config);
  const labels = getLabelsForDecision(pr, config, eventName, event);
  const workers = config.workers ?? {};
  const codeRuns = getWorkerSummary(workerRuns, 'codeReview', pr);
  const dependencyRuns = getWorkerSummary(workerRuns, 'dependencyReview', pr);
  const improveRuns = getWorkerSummary(workerRuns, 'prImprove', pr);
  const finalizerRuns = getWorkerSummary(workerRuns, 'finalizer', pr);
  const dispatchKey = decision.dispatch?.key ?? null;
  const dispatchFailed = dispatchOutcome?.ok === false;
  const dispatchError = dispatchOutcome?.error ?? '';
  const needsDependencyReview =
    Boolean(policy.dependabot) &&
    pathsMatch(pr.files, workers.dependencyReview?.paths);
  const shouldImprove =
    !policy.dependabot &&
    policy.should_analyze &&
    !hasAny(labels, workers.prImprove?.skipLabels) &&
    !hasAny(labels, workers.prImprove?.successLabels);
  const finalizerAlreadyDispatched = labels.includes(
    'flow/finalizer-dispatched',
  );
  const manualTerminal = decision.state === 'flow/manual-only';
  const statuses = {};

  function dispatchErrorFor(workerName) {
    if (!dispatchFailed) return null;
    if (dispatchKey === workerName) return dispatchError;
    if (workerName === 'securityReview' && dispatchKey === 'codeReview') {
      return dispatchError;
    }
    return null;
  }

  function waitingStatus(workerName, description, targetUrl = currentRunUrl) {
    return makeWorkerStatus(statusConfig, workerName, {
      state: 'pending',
      displayState: 'pending',
      description,
      targetUrl,
    });
  }

  function runningStatus(workerName, summary, description) {
    return makeWorkerStatus(statusConfig, workerName, {
      state: 'pending',
      displayState: 'running',
      description,
      targetUrl: getWorkerTargetUrl(summary, currentRunUrl),
    });
  }

  function successStatus(workerName, description, targetUrl = currentRunUrl) {
    return makeWorkerStatus(statusConfig, workerName, {
      state: 'success',
      displayState: 'success',
      description,
      targetUrl,
    });
  }

  function skippedStatus(workerName, description) {
    return makeWorkerStatus(statusConfig, workerName, {
      state: 'success',
      displayState: 'N/A',
      description,
      targetUrl: currentRunUrl,
    });
  }

  function failureStatus(workerName, description, targetUrl = currentRunUrl) {
    return makeWorkerStatus(statusConfig, workerName, {
      state: 'failure',
      displayState: 'failure',
      description,
      targetUrl,
    });
  }

  function errorStatus(workerName, description) {
    return makeWorkerStatus(statusConfig, workerName, {
      state: 'error',
      displayState: 'error',
      description,
      targetUrl: currentRunUrl,
    });
  }

  const codeDispatchError = dispatchErrorFor('codeReview');
  if (manualTerminal) {
    statuses.codeReview = skippedStatus(
      'codeReview',
      'N/A: PR is manual-only.',
    );
  } else if (policy.dependabot) {
    statuses.codeReview = skippedStatus(
      'codeReview',
      'N/A: Dependabot PRs use dependency review.',
    );
  } else if (codeDispatchError) {
    statuses.codeReview = errorStatus(
      'codeReview',
      `Code review dispatch failed: ${codeDispatchError}`,
    );
  } else if (hasAny(labels, ['ai-review-concerns'])) {
    statuses.codeReview = failureStatus(
      'codeReview',
      'Code review concerns are present.',
    );
  } else if (hasAny(labels, ['ai-review-passed'])) {
    statuses.codeReview = successStatus(
      'codeReview',
      'Code review signal passed.',
      getWorkerTargetUrl(codeRuns, currentRunUrl),
    );
  } else if (codeRuns.active) {
    statuses.codeReview = runningStatus(
      'codeReview',
      codeRuns,
      'Code review is running.',
    );
  } else if (workerRunFailed(codeRuns)) {
    statuses.codeReview = failureStatus(
      'codeReview',
      'Code review workflow failed.',
      getWorkerTargetUrl(codeRuns, currentRunUrl),
    );
  } else if (dispatchKey === 'codeReview') {
    statuses.codeReview = waitingStatus(
      'codeReview',
      'Code review was dispatched.',
    );
  } else {
    statuses.codeReview = waitingStatus(
      'codeReview',
      'Waiting for code review signal.',
    );
  }

  const securityDispatchError = dispatchErrorFor('securityReview');
  if (manualTerminal) {
    statuses.securityReview = skippedStatus(
      'securityReview',
      'N/A: PR is manual-only.',
    );
  } else if (policy.dependabot) {
    statuses.securityReview = skippedStatus(
      'securityReview',
      'N/A: Dependabot PRs use dependency review.',
    );
  } else if (securityDispatchError) {
    statuses.securityReview = errorStatus(
      'securityReview',
      `Security review dispatch failed: ${securityDispatchError}`,
    );
  } else if (hasAny(labels, ['security-review-concerns'])) {
    statuses.securityReview = failureStatus(
      'securityReview',
      'Security review concerns are present.',
    );
  } else if (hasAny(labels, ['security-review-passed'])) {
    statuses.securityReview = successStatus(
      'securityReview',
      'Security review signal passed.',
      getWorkerTargetUrl(codeRuns, currentRunUrl),
    );
  } else if (codeRuns.active) {
    statuses.securityReview = runningStatus(
      'securityReview',
      codeRuns,
      'Security review is queued in the code review workflow.',
    );
  } else if (workerRunFailed(codeRuns)) {
    statuses.securityReview = failureStatus(
      'securityReview',
      'Code review workflow failed before the security signal.',
      getWorkerTargetUrl(codeRuns, currentRunUrl),
    );
  } else if (dispatchKey === 'codeReview') {
    statuses.securityReview = waitingStatus(
      'securityReview',
      'Security review was dispatched with code review.',
    );
  } else {
    statuses.securityReview = waitingStatus(
      'securityReview',
      'Waiting for security review signal.',
    );
  }

  const dependencyDispatchError = dispatchErrorFor('dependencyReview');
  if (manualTerminal) {
    statuses.dependencyReview = skippedStatus(
      'dependencyReview',
      'N/A: PR is manual-only.',
    );
  } else if (!needsDependencyReview) {
    statuses.dependencyReview = skippedStatus(
      'dependencyReview',
      'N/A: Dependency review is not required for this PR.',
    );
  } else if (dependencyDispatchError) {
    statuses.dependencyReview = errorStatus(
      'dependencyReview',
      `Dependency review dispatch failed: ${dependencyDispatchError}`,
    );
  } else if (hasAny(labels, ['deps-review-manual', 'deps-review-blocked'])) {
    statuses.dependencyReview = failureStatus(
      'dependencyReview',
      'Dependency review is manual or blocked.',
    );
  } else if (hasAny(labels, ['deps-review-passed'])) {
    statuses.dependencyReview = successStatus(
      'dependencyReview',
      'Dependency review signal passed.',
      getWorkerTargetUrl(dependencyRuns, currentRunUrl),
    );
  } else if (dependencyRuns.active) {
    statuses.dependencyReview = runningStatus(
      'dependencyReview',
      dependencyRuns,
      'Dependency review is running.',
    );
  } else if (workerRunFailed(dependencyRuns)) {
    statuses.dependencyReview = failureStatus(
      'dependencyReview',
      'Dependency review workflow failed.',
      getWorkerTargetUrl(dependencyRuns, currentRunUrl),
    );
  } else if (dispatchKey === 'dependencyReview') {
    statuses.dependencyReview = waitingStatus(
      'dependencyReview',
      'Dependency review was dispatched.',
    );
  } else {
    statuses.dependencyReview = waitingStatus(
      'dependencyReview',
      'Waiting for dependency review signal.',
    );
  }

  const improveDispatchError = dispatchErrorFor('prImprove');
  if (manualTerminal) {
    statuses.prImprove = skippedStatus('prImprove', 'N/A: PR is manual-only.');
  } else if (!shouldImprove) {
    statuses.prImprove = skippedStatus(
      'prImprove',
      'N/A: PR Improve is not required for this PR.',
    );
  } else if (improveDispatchError) {
    statuses.prImprove = errorStatus(
      'prImprove',
      `PR Improve dispatch failed: ${improveDispatchError}`,
    );
  } else if (hasAny(labels, workers.prImprove?.successLabels)) {
    statuses.prImprove = successStatus(
      'prImprove',
      'PR Improve completed.',
      getWorkerTargetUrl(improveRuns, currentRunUrl),
    );
  } else if (improveRuns.active) {
    statuses.prImprove = runningStatus(
      'prImprove',
      improveRuns,
      'PR Improve is running.',
    );
  } else if (workerRunFailed(improveRuns)) {
    statuses.prImprove = failureStatus(
      'prImprove',
      'PR Improve workflow failed.',
      getWorkerTargetUrl(improveRuns, currentRunUrl),
    );
  } else if (dispatchKey === 'prImprove') {
    statuses.prImprove = waitingStatus(
      'prImprove',
      'PR Improve was dispatched.',
    );
  } else {
    statuses.prImprove = waitingStatus('prImprove', 'Waiting for PR Improve.');
  }

  const finalizerDispatchError = dispatchErrorFor('finalizer');
  if (manualTerminal) {
    statuses.finalizer = skippedStatus('finalizer', 'N/A: PR is manual-only.');
  } else if (finalizerDispatchError) {
    statuses.finalizer = errorStatus(
      'finalizer',
      `Finalizer dispatch failed: ${finalizerDispatchError}`,
    );
  } else if (finalizerRuns.active) {
    statuses.finalizer = runningStatus(
      'finalizer',
      finalizerRuns,
      'Finalizer is running.',
    );
  } else if (workerRunSucceeded(finalizerRuns)) {
    statuses.finalizer = successStatus(
      'finalizer',
      'Finalizer completed.',
      getWorkerTargetUrl(finalizerRuns, currentRunUrl),
    );
  } else if (workerRunFailed(finalizerRuns)) {
    statuses.finalizer = failureStatus(
      'finalizer',
      'Finalizer workflow failed.',
      getWorkerTargetUrl(finalizerRuns, currentRunUrl),
    );
  } else if (dispatchKey === 'finalizer') {
    statuses.finalizer = waitingStatus(
      'finalizer',
      'Finalizer was dispatched.',
    );
  } else if (finalizerAlreadyDispatched) {
    statuses.finalizer = waitingStatus(
      'finalizer',
      'Finalizer was dispatched and has not completed yet.',
    );
  } else {
    statuses.finalizer = waitingStatus(
      'finalizer',
      'Waiting for prior orchestration gates.',
    );
  }

  const blockingWorker = Object.values(statuses).find((status) =>
    ['failure', 'error'].includes(status.state),
  );
  let aggregateState = 'pending';
  let aggregateDescription = decision.reason || 'PR orchestration is pending.';
  let aggregateDisplayState = 'pending';

  if (String(pr.state).toUpperCase() !== 'OPEN' || pr.mergedAt) {
    aggregateState = 'success';
    aggregateDisplayState = 'success';
    aggregateDescription = 'PR is closed or already merged.';
  } else if (visibilityErrors.length > 0) {
    aggregateState = 'error';
    aggregateDisplayState = 'error';
    aggregateDescription = visibilityErrors[0];
  } else if (dispatchFailed) {
    aggregateState = 'error';
    aggregateDisplayState = 'error';
    aggregateDescription = `Worker dispatch failed: ${dispatchError}`;
  } else if (decision.checkStatus?.status === 'unavailable') {
    aggregateState = 'error';
    aggregateDisplayState = 'error';
    aggregateDescription =
      decision.checkStatus.reason || 'Required checks could not be read.';
  } else if (
    [
      'flow/checks-failed',
      'flow/review-blocked',
      'flow/review-failed',
      'flow/improve-failed',
    ].includes(decision.state)
  ) {
    aggregateState = 'failure';
    aggregateDisplayState = 'failure';
  } else if (manualTerminal) {
    aggregateState = 'success';
    aggregateDisplayState = 'success';
    aggregateDescription =
      decision.reason || 'PR is manual-only; orchestration is complete.';
  } else if (statuses.finalizer.state === 'failure') {
    aggregateState = 'failure';
    aggregateDisplayState = 'failure';
    aggregateDescription = statuses.finalizer.description;
  } else if (statuses.finalizer.state === 'success') {
    aggregateState = 'success';
    aggregateDisplayState = 'success';
    aggregateDescription = 'PR orchestration gates completed.';
  } else if (
    blockingWorker &&
    blockingWorker.context !== statuses.prImprove.context
  ) {
    aggregateState = blockingWorker.state;
    aggregateDisplayState = blockingWorker.displayState;
    aggregateDescription = blockingWorker.description;
  }

  const aggregate = makeCommitStatus({
    context: statusConfig.aggregate.context,
    state: aggregateState,
    displayState: aggregateDisplayState,
    description: aggregateDescription,
    targetUrl: currentRunUrl,
  });

  return {
    aggregate,
    workers: statuses,
    orderedStatuses: [
      aggregate,
      statuses.codeReview,
      statuses.securityReview,
      statuses.dependencyReview,
      statuses.prImprove,
      statuses.finalizer,
    ],
  };
}

function renderFlowComment({
  pr,
  decision,
  visibility,
  dispatchOutcome = null,
}) {
  const statusLines = Object.entries(visibility.workers).map(
    ([workerName, status]) => {
      const label = STATUS_WORKER_LABELS[workerName] ?? workerName;
      const link = status.targetUrl ? `[run](${status.targetUrl})` : '';
      return `| ${label} | ${status.displayState} | ${status.description} | ${link} |`;
    },
  );
  const dispatchLine = dispatchOutcome
    ? dispatchOutcome.ok
      ? `- Dispatch: ${decision.dispatch?.key ?? 'none'} succeeded`
      : `- Dispatch: ${decision.dispatch?.key ?? 'none'} failed: ${dispatchOutcome.error}`
    : `- Dispatch: ${decision.dispatch?.key ?? 'none'}`;

  return [
    COMMENT_MARKER,
    '## PR Flow Orchestration',
    '',
    `- Head SHA: \`${pr.headSha}\``,
    `- Aggregate: **${visibility.aggregate.displayState}** (${visibility.aggregate.context})`,
    `- Decision: ${decision.state ?? 'none'}`,
    `- Reason: ${decision.reason}`,
    dispatchLine,
    '',
    '| Worker | Status | Details | Link |',
    '| --- | --- | --- | --- |',
    ...statusLines,
  ].join('\n');
}

function publishCommitStatus(pr, status) {
  const repo = getRepoSlug();
  const payloadFile = writeTempJson('pr-flow-status', {
    state: status.state,
    context: status.context,
    description: status.description,
    target_url: status.targetUrl || undefined,
  });

  try {
    run('gh', [
      'api',
      '-X',
      'POST',
      `repos/${repo}/statuses/${pr.headSha}`,
      '--input',
      payloadFile,
    ]);
  } finally {
    fs.rmSync(payloadFile, { force: true });
  }
}

function publishFlowStatuses(pr, visibility) {
  for (const status of visibility.orderedStatuses) {
    publishCommitStatus(pr, status);
  }
}

function upsertFlowComment(pr, body) {
  const repo = getRepoSlug();
  const comments = runJson(
    'gh',
    ['api', `repos/${repo}/issues/${pr.number}/comments`, '--paginate'],
    [],
  );
  const existing = comments.find(
    (comment) =>
      comment.user?.login === 'github-actions[bot]' &&
      String(comment.body ?? '').includes(COMMENT_MARKER),
  );
  const payloadFile = writeTempJson('pr-flow-comment', { body });

  try {
    if (existing) {
      run('gh', [
        'api',
        '-X',
        'PATCH',
        `repos/${repo}/issues/comments/${existing.id}`,
        '--input',
        payloadFile,
      ]);
      return;
    }

    run('gh', [
      'api',
      '-X',
      'POST',
      `repos/${repo}/issues/${pr.number}/comments`,
      '--input',
      payloadFile,
    ]);
  } finally {
    fs.rmSync(payloadFile, { force: true });
  }
}

function collectConfiguredWorkerRuns(config, workerRuns, getWorkerRuns) {
  for (const workerName of Object.keys(config.workers ?? {})) {
    if (workerRuns[workerName] === undefined) {
      workerRuns[workerName] = getWorkerRuns(workerName);
    }
  }
  return workerRuns;
}

function decisionWithDispatchError({ decision, pr, config, errorMessage }) {
  const failureStateByWorker = {
    codeReview: 'flow/review-failed',
    dependencyReview: 'flow/review-failed',
    prImprove: 'flow/improve-failed',
    finalizer: 'flow/finalizer-dispatched',
  };
  const key = decision.dispatch?.key;
  const state = failureStateByWorker[key] ?? decision.state;
  const extraLabels = decision.desiredLabels.includes('flow/manual-only')
    ? ['flow/manual-only']
    : [];
  const desiredLabels = unique([state, ...extraLabels]);
  const presentFlowLabels = allFlowLabels(config).filter((label) =>
    pr.labels.includes(label),
  );

  return {
    ...decision,
    state,
    reason: `Failed to dispatch ${key ?? 'worker'}: ${errorMessage}`,
    desiredLabels,
    labelsToAdd: desiredLabels.filter((label) => !pr.labels.includes(label)),
    labelsToRemove: unique([
      ...presentFlowLabels.filter((label) => !desiredLabels.includes(label)),
      ...decision.labelsToRemove.filter(
        (label) => !desiredLabels.includes(label),
      ),
    ]),
  };
}

function allFlowLabels(config) {
  return Object.keys(config.labels ?? {});
}

function getResetLabels(config, eventName, event, pr) {
  return isHeadResetEvent(eventName, event) && !pr.isDraft
    ? (config.resetOnHeadChange?.labels ?? [])
    : [];
}

function getLabelsForDecision(pr, config, eventName, event) {
  const resetLabels = getResetLabels(config, eventName, event, pr);
  const flowLabels = allFlowLabels(config);
  const resetLabelSet = new Set(resetLabels);
  const flowLabelSet = new Set(flowLabels);

  return pr.labels.filter((label) => {
    if (resetLabelSet.has(label)) return false;
    if (resetLabels.length > 0 && flowLabelSet.has(label)) return false;
    return true;
  });
}

function makeDecision(context) {
  const {
    pr,
    policy = emptyPolicy(),
    checks = null,
    workerRuns = {},
    getWorkerRuns,
    eventName,
    event,
    config,
    checkStatus: providedCheckStatus,
  } = context;
  const workers = config.workers ?? {};
  const currentLabels = pr.labels;
  const labels = getLabelsForDecision(pr, config, eventName, event);
  const flowLabels = allFlowLabels(config);
  const resetLabels = getResetLabels(config, eventName, event, pr);
  const presentFlowLabels = flowLabels.filter((label) =>
    currentLabels.includes(label),
  );
  const presentResetLabels = resetLabels.filter((label) =>
    currentLabels.includes(label),
  );
  const checkStatus =
    providedCheckStatus ??
    (checks === null
      ? getNotRequestedCheckStatus()
      : getRequiredCheckStatus(checks, config.checks?.required));

  function getWorkerSummary(workerName) {
    if (workerRuns[workerName] === undefined) {
      workerRuns[workerName] =
        typeof getWorkerRuns === 'function' ? getWorkerRuns(workerName) : [];
    }
    return summarizeWorkerRuns(workerRuns, workerName, pr);
  }

  function finish(state, reason, dispatch = null, extraLabels = []) {
    const desiredLabels = unique([state, ...extraLabels]);
    const labelsToAdd = desiredLabels.filter(
      (label) => !currentLabels.includes(label),
    );
    const labelsToRemove = unique([
      ...presentFlowLabels.filter((label) => !desiredLabels.includes(label)),
      ...presentResetLabels,
    ]);

    return {
      state,
      reason,
      dispatch,
      desiredLabels,
      labelsToAdd,
      labelsToRemove,
      checkStatus,
    };
  }

  if (String(pr.state).toUpperCase() !== 'OPEN' || pr.mergedAt) {
    return finish(null, 'PR is closed or already merged.');
  }

  if (pr.isDraft) {
    return finish('flow/draft', 'PR is draft.');
  }

  if (checkStatus.status === 'failed') {
    return finish('flow/checks-failed', 'Required checks are failing.');
  }
  if (checkStatus.status === 'pending') {
    return finish('flow/checks-pending', 'Waiting for required checks.');
  }
  if (checkStatus.status === 'unavailable') {
    return finish(
      'flow/checks-unavailable',
      checkStatus.reason ?? 'Required checks could not be read.',
    );
  }

  const dependencyWorker = workers.dependencyReview ?? {};
  const codeReviewWorker = workers.codeReview ?? {};
  const improveWorker = workers.prImprove ?? {};
  const finalizerWorker = workers.finalizer ?? {};
  const policyBlockingLabels = policy.blocking_labels_present ?? [];
  const { hard: hardBlockingLabels, manualReview: manualReviewLabels } =
    splitBlockingLabels(policyBlockingLabels);

  if (hardBlockingLabels.length > 0) {
    return finish(
      'flow/review-blocked',
      `Blocking labels are present: ${hardBlockingLabels.join(', ')}.`,
    );
  }

  if (policy.manual_only || manualReviewLabels.length > 0) {
    const reason =
      policy.blocked_reason ||
      (manualReviewLabels.length > 0
        ? `Manual review is required by label: ${manualReviewLabels.join(', ')}.`
        : 'PR is manual-only by policy.');

    return finish('flow/manual-only', reason);
  }

  const needsDependencyReview =
    Boolean(policy.dependabot) && pathsMatch(pr.files, dependencyWorker.paths);

  if (needsDependencyReview) {
    if (hasAny(labels, dependencyWorker.blockLabels)) {
      return finish('flow/review-blocked', 'Dependency review is blocking.');
    }

    if (!hasAll(labels, dependencyWorker.passLabels)) {
      const dependencyRuns = getWorkerSummary('dependencyReview');
      if (dependencyRuns.active) {
        return finish(
          'flow/review-pending',
          'Dependency review is already running.',
        );
      }

      if (
        dependencyRuns.latest &&
        dependencyRuns.latest.conclusion &&
        dependencyRuns.latest.conclusion !== 'success'
      ) {
        return finish(
          'flow/review-failed',
          'Dependency review workflow failed.',
        );
      }

      return finish('flow/review-pending', 'Dispatching dependency review.', {
        key: 'dependencyReview',
        workflow: dependencyWorker.workflow,
        inputs: dependencyWorker.inputs,
      });
    }
  } else if (!policy.dependabot) {
    if (hasAny(labels, codeReviewWorker.blockLabels)) {
      return finish('flow/review-blocked', 'AI review is blocking.');
    }

    if (!hasAll(labels, codeReviewWorker.passLabels)) {
      const codeReviewRuns = getWorkerSummary('codeReview');
      if (codeReviewRuns.active) {
        return finish('flow/review-pending', 'Code review is already running.');
      }

      if (
        codeReviewRuns.latest &&
        codeReviewRuns.latest.conclusion &&
        codeReviewRuns.latest.conclusion !== 'success'
      ) {
        return finish('flow/review-failed', 'Code review workflow failed.');
      }

      return finish('flow/review-pending', 'Dispatching code review.', {
        key: 'codeReview',
        workflow: codeReviewWorker.workflow,
        inputs: codeReviewWorker.inputs,
      });
    }
  }

  const shouldImprove =
    !policy.dependabot &&
    policy.should_analyze &&
    !hasAny(labels, improveWorker.skipLabels) &&
    !hasAny(labels, improveWorker.successLabels);

  if (shouldImprove) {
    const improveRuns = getWorkerSummary('prImprove');
    if (improveRuns.active) {
      return finish('flow/improve-pending', 'PR Improve is already running.');
    }

    const improveFailed =
      improveRuns.latest &&
      improveRuns.latest.conclusion &&
      improveRuns.latest.conclusion !== 'success';
    if (improveFailed && improveWorker.required !== false) {
      return finish(
        'flow/improve-failed',
        'Required PR Improve workflow failed.',
      );
    }

    if (!improveRuns.latest) {
      return finish('flow/improve-pending', 'Dispatching PR Improve.', {
        key: 'prImprove',
        workflow: improveWorker.workflow,
        inputs: improveWorker.inputs,
      });
    }
  }

  const finalizerRuns = getWorkerSummary('finalizer');
  const finalizerAlreadyDispatched = labels.includes(
    'flow/finalizer-dispatched',
  );
  const manualOnlyLabels = policy.manual_only ? ['flow/manual-only'] : [];

  if (finalizerRuns.active || finalizerAlreadyDispatched) {
    return finish(
      'flow/finalizer-dispatched',
      'Finalizer already dispatched for this head SHA.',
      null,
      manualOnlyLabels,
    );
  }

  return finish(
    'flow/finalizer-dispatched',
    'Dispatching finalizer.',
    {
      key: 'finalizer',
      workflow: finalizerWorker.workflow,
      inputs: finalizerWorker.inputs,
    },
    manualOnlyLabels,
  );
}

function collectWorkerRuns(config, workerName) {
  const worker = config.workers?.[workerName];
  if (!worker?.workflow) {
    return [];
  }

  return runJson(
    'gh',
    [
      'run',
      'list',
      '--workflow',
      worker.workflow,
      '--limit',
      '50',
      '--json',
      'databaseId,status,conclusion,event,displayTitle,createdAt,updatedAt,url',
    ],
    [],
  );
}

function ensureLabels(config) {
  for (const [name, label] of Object.entries(config.labels ?? {})) {
    run('gh', [
      'label',
      'create',
      name,
      '--color',
      label.color,
      '--description',
      label.description,
      '--force',
    ]);
  }
}

function syncLabels(prNumber, decision) {
  for (const label of decision.labelsToRemove) {
    run('gh', ['issue', 'edit', String(prNumber), '--remove-label', label], {
      allowFailure: true,
    });
  }

  if (decision.labelsToAdd.length > 0) {
    run('gh', [
      'issue',
      'edit',
      String(prNumber),
      '--add-label',
      decision.labelsToAdd.join(','),
    ]);
  }
}

function dispatchWorker(pr, dispatch) {
  const args = [
    'workflow',
    'run',
    dispatch.workflow,
    '--ref',
    pr.baseRefName,
    '-f',
    `pr_number=${pr.number}`,
    '-f',
    `head_sha=${pr.headSha}`,
    '-f',
    `base_ref=${pr.baseRefName}`,
    '-f',
    'orchestrated=true',
  ];

  for (const [name, value] of Object.entries(dispatch.inputs ?? {})) {
    args.push('-f', `${name}=${String(value)}`);
  }

  run('gh', args);
}

function fetchPullRequest(prNumber) {
  return runJson(
    'gh',
    [
      'pr',
      'view',
      String(prNumber),
      '--json',
      'number,title,url,state,mergedAt,isDraft,headRefName,headRefOid,baseRefName,author,labels,files,isCrossRepository',
    ],
    null,
    { allowedFailurePattern: PR_NOT_FOUND_PATTERN },
  );
}

function skippedSummary(reason, eventName, timings, extra = {}) {
  return {
    status: 'skipped',
    reason,
    eventName,
    timings,
    ...extra,
  };
}

function main() {
  const timings = createTimings();
  const eventName = getArg('--event-name', process.env.GITHUB_EVENT_NAME ?? '');
  const eventPath = getArg('--event-path', process.env.GITHUB_EVENT_PATH ?? '');
  const explicitPrNumber =
    getArg('--pr-number', process.env.PR_NUMBER ?? '') || null;
  const configFile = getArg('--config-file', '.github/pr-flow.json');
  const policyFile = getArg('--policy-file', '.github/workflows/policy.json');
  const dryRun = toBoolean(getArg('--dry-run', process.env.DRY_RUN ?? 'false'));
  const ensureLabelsRequested = toBoolean(
    getArg('--ensure-labels', process.env.ENSURE_LABELS ?? 'false'),
  );
  const event =
    eventPath && fs.existsSync(eventPath) ? readJson(eventPath) : {};

  const resolved = timeStep(timings, 'resolve-pr', () => {
    const prNumber = resolvePrNumber(eventName, event, explicitPrNumber);
    if (!prNumber) {
      return { prNumber: null, config: null, pr: null };
    }

    const config = readConfig(configFile);
    const rawPr = fetchPullRequest(prNumber);
    const pr = rawPr ? normalizePr(rawPr) : null;
    return { prNumber, config, pr };
  });

  if (!resolved.prNumber) {
    console.log(
      JSON.stringify(
        skippedSummary(
          'No pull request context could be resolved.',
          eventName,
          timings,
        ),
        null,
        2,
      ),
    );
    return;
  }

  if (!resolved.pr) {
    console.log(
      JSON.stringify(
        skippedSummary(
          `Resolved number #${resolved.prNumber} is not a pull request.`,
          eventName,
          timings,
          { number: resolved.prNumber },
        ),
        null,
        2,
      ),
    );
    return;
  }

  const { config, pr } = resolved;
  let checkEvidence = {
    checks: null,
    checkStatus: getNotRequestedCheckStatus(),
    source: 'not-requested',
    reason: 'PR is draft.',
  };
  let policy = emptyPolicy();

  if (!pr.isDraft) {
    checkEvidence = timeStep(timings, 'checks', () =>
      collectCheckEvidence({
        pr,
        config,
        eventName,
        event,
      }),
    );
  }

  const { checks, checkStatus } = checkEvidence;

  if (!pr.isDraft && checkStatus.status === 'passed') {
    policy = timeStep(timings, 'policy', () =>
      evaluatePolicy(
        {
          ...pr,
          labels: getLabelsForDecision(pr, config, eventName, event),
        },
        policyFile,
      ),
    );
  }

  const workerRuns = {};
  const getWorkerRuns = (workerName) => {
    if (workerRuns[workerName] === undefined) {
      workerRuns[workerName] = timeStep(timings, 'worker-runs', () =>
        collectWorkerRuns(config, workerName),
      );
    }
    return workerRuns[workerName];
  };

  const decision = makeDecision({
    pr,
    checks,
    policy,
    workerRuns,
    getWorkerRuns,
    eventName,
    event,
    config,
    checkStatus,
  });
  let appliedDecision = decision;
  let dispatchOutcome = null;
  let visibility = null;
  let fatalError = null;
  const visibilityErrors = [];

  if (!dryRun) {
    if (decision.dispatch) {
      try {
        timeStep(timings, 'dispatch', () =>
          dispatchWorker(pr, decision.dispatch),
        );
        dispatchOutcome = { ok: true, error: null };
      } catch (error) {
        const errorMessage = formatCommandError(error);
        dispatchOutcome = { ok: false, error: errorMessage };
        appliedDecision = decisionWithDispatchError({
          decision,
          pr,
          config,
          errorMessage,
        });
        console.error(`Worker dispatch failed: ${errorMessage}`);
      }
    }

    timeStep(timings, 'labels', () => {
      try {
        if (ensureLabelsRequested) {
          ensureLabels(config);
        }
        syncLabels(pr.number, appliedDecision);
      } catch (error) {
        const errorMessage = formatCommandError(error);
        visibilityErrors.push(`Label update failed: ${errorMessage}`);
        console.error(`Label update failed: ${errorMessage}`);
      }
    });

    timeStep(timings, 'visibility', () => {
      collectConfiguredWorkerRuns(config, workerRuns, getWorkerRuns);
      visibility = buildFlowVisibility({
        pr,
        config,
        policy,
        decision: appliedDecision,
        workerRuns,
        eventName,
        event,
        dispatchOutcome,
        visibilityErrors,
      });

      publishFlowStatuses(pr, visibility);

      try {
        upsertFlowComment(
          pr,
          renderFlowComment({
            pr,
            decision: appliedDecision,
            visibility,
            dispatchOutcome,
          }),
        );
      } catch (error) {
        const errorMessage = formatCommandError(error);
        const commentError = `PR flow comment update failed: ${errorMessage}`;
        visibilityErrors.push(commentError);
        const errorVisibility = buildFlowVisibility({
          pr,
          config,
          policy,
          decision: appliedDecision,
          workerRuns,
          eventName,
          event,
          dispatchOutcome,
          visibilityErrors,
        });
        visibility = errorVisibility;
        publishCommitStatus(pr, errorVisibility.aggregate);
        fatalError = new Error(commentError);
      }
    });

    if (dispatchOutcome?.ok === false || visibilityErrors.length > 0) {
      fatalError = new Error(
        [
          dispatchOutcome?.ok === false
            ? `Worker dispatch failed: ${dispatchOutcome.error}`
            : '',
          ...visibilityErrors,
        ]
          .filter(Boolean)
          .join('; '),
      );
    }
  } else {
    visibility = buildFlowVisibility({
      pr,
      config,
      policy,
      decision: appliedDecision,
      workerRuns,
      eventName,
      event,
      dispatchOutcome,
      visibilityErrors,
    });
  }

  const summary = {
    status: dryRun ? 'dry-run' : 'applied',
    pr: pr.number,
    headSha: pr.headSha,
    state: appliedDecision.state,
    reason: appliedDecision.reason,
    dispatch: appliedDecision.dispatch,
    dispatchOutcome,
    desiredLabels: appliedDecision.desiredLabels,
    labelsToAdd: appliedDecision.labelsToAdd,
    labelsToRemove: appliedDecision.labelsToRemove,
    checkStatus: appliedDecision.checkStatus,
    checkSource: checkEvidence.source,
    checkSourceReason: checkEvidence.reason,
    visibility,
    visibilityErrors,
    timings,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (fatalError) {
    throw fatalError;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildFlowVisibility,
  collectCheckEvidence,
  decisionWithDispatchError,
  getLabelsForDecision,
  getRequiredCheckStatus,
  makeDecision,
  readConfig,
  renderFlowComment,
  resolvePrNumber,
  summarizeWorkerRuns,
};
