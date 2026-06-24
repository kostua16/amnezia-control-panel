/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const {
  collectCheckEvidence,
  getRequiredCheckStatus,
} = require('./required-check-evidence.cjs');
// Shared sticky-comment create-or-update helper (single source for the
// marker-based PR comment upsert used across review/size/orchestration scripts).
const { upsertComment } = require('./lib/sticky-comment.cjs');

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

const GUIDANCE_BLOCKING_LABELS = [
  'do-not-merge',
  'ai-review-concerns',
  'security-review-concerns',
  'deps-review-manual',
  'deps-review-blocked',
  'antigravity-review-concerns',
];

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

function hasStandaloneCommand(body, command) {
  return String(body ?? '')
    .split(/\r?\n/)
    .some((line) => line.trim() === command);
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

  if (eventName === 'issue_comment' && event.issue?.pull_request) {
    return toNumber(event.issue?.number);
  }

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
    autoMergeRequest: pr.autoMergeRequest ?? null,
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
    maintainer_approved: false,
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

function getNotRequestedCheckStatus() {
  return { status: 'not_requested', failing: [], pending: [], missing: [] };
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
  const autoMergeEnabled = Boolean(pr.autoMergeRequest);
  const closedOrMerged =
    String(pr.state).toUpperCase() !== 'OPEN' || pr.mergedAt;
  const policyBlockingLabels = policy.blocking_labels_present ?? [];
  const { manualReview: manualReviewLabels } =
    splitBlockingLabels(policyBlockingLabels);
  const manualOnly =
    Boolean(policy.manual_only) ||
    manualReviewLabels.length > 0 ||
    decision.state === 'flow/manual-only';
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

  function reviewPendingStatus(workerName, defaultDescription) {
    if (closedOrMerged) {
      return skippedStatus(workerName, 'N/A: PR is closed or already merged.');
    }

    if (decision.state === 'flow/draft') {
      return waitingStatus(
        workerName,
        'Review waits until the PR is ready for review.',
      );
    }

    if (
      [
        'flow/checks-failed',
        'flow/checks-pending',
        'flow/checks-unavailable',
      ].includes(decision.state)
    ) {
      return waitingStatus(
        workerName,
        'Review waits for required checks to pass.',
      );
    }

    return waitingStatus(workerName, defaultDescription);
  }

  const codeDispatchError = dispatchErrorFor('codeReview');
  if (policy.dependabot) {
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
    statuses.codeReview = reviewPendingStatus(
      'codeReview',
      'Waiting for code review signal.',
    );
  }

  const securityDispatchError = dispatchErrorFor('securityReview');
  if (policy.dependabot) {
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
    statuses.securityReview = reviewPendingStatus(
      'securityReview',
      'Waiting for security review signal.',
    );
  }

  const dependencyDispatchError = dispatchErrorFor('dependencyReview');
  if (!needsDependencyReview) {
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
  if (manualOnly) {
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
  if (manualOnly) {
    statuses.finalizer = skippedStatus('finalizer', 'N/A: PR is manual-only.');
  } else if (closedOrMerged) {
    statuses.finalizer = skippedStatus(
      'finalizer',
      'N/A: PR is closed or already merged.',
    );
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
  } else if (workerRunSucceeded(finalizerRuns) && autoMergeEnabled) {
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
  } else if (workerRunSucceeded(finalizerRuns)) {
    statuses.finalizer = waitingStatus(
      'finalizer',
      'Finalizer completed without enabling auto-merge; waiting to retry.',
      getWorkerTargetUrl(finalizerRuns, currentRunUrl),
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

  if (closedOrMerged) {
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
  } else if (manualOnly) {
    aggregateState = 'pending';
    aggregateDisplayState = 'pending';
    aggregateDescription =
      decision.reason || 'Manual-only PR is waiting for advisory reviews.';
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

function formatInlineLabels(labels) {
  return labels.map((label) => `\`${label}\``).join(', ');
}

function pushUnique(items, item) {
  if (item && !items.includes(item)) {
    items.push(item);
  }
}

function buildFlowGuidance({
  pr,
  decision,
  visibility,
  dispatchOutcome = null,
}) {
  const nextSteps = [];
  const controls = [];
  const labels = normalizeLabels(pr.labels);
  const activeBlockingLabels = GUIDANCE_BLOCKING_LABELS.filter((label) =>
    labels.includes(label),
  );
  const state = decision.state ?? 'none';
  const checkStatus = decision.checkStatus ?? {};
  const finalizerStatus = visibility.workers?.finalizer?.displayState ?? '';

  const addNext = (item) => pushUnique(nextSteps, item);
  const addControl = (item) => pushUnique(controls, item);
  const addStopControl = () =>
    addControl('Add `do-not-merge` to block PR Finalizer and auto-merge.');

  if (String(pr.state).toUpperCase() !== 'OPEN' || pr.mergedAt) {
    addNext(
      'No PR Flow action is needed; this PR is closed or already merged.',
    );
    return { nextSteps, controls };
  }

  if (dispatchOutcome?.ok === false) {
    addNext(
      `Inspect the failed ${decision.dispatch?.key ?? 'worker'} dispatch, then rerun PR Orchestrator.`,
    );
    addStopControl();
  }

  switch (state) {
    case 'flow/draft':
      addNext(
        'Mark the PR ready for review when it should enter CI and PR Flow.',
      );
      addNext('This comment updates after PR Flow runs on the ready PR.');
      addStopControl();
      break;

    case 'flow/checks-pending':
      addNext(
        'Wait for required checks to finish; PR Flow updates after CI or PR Policy completes.',
      );
      addNext(
        'If the state looks stale, run the PR Orchestrator workflow for this PR.',
      );
      addStopControl();
      break;

    case 'flow/checks-failed': {
      const failing =
        checkStatus.failing?.length > 0
          ? formatInlineLabels(checkStatus.failing)
          : 'the failing required checks';
      addNext(`Fix ${failing}, then push updates or rerun the failed jobs.`);
      addNext('PR Flow updates after the required checks complete again.');
      addStopControl();
      break;
    }

    case 'flow/checks-unavailable':
      addNext(
        'Inspect the PR Flow run for the check-read error before trusting this state.',
      );
      addNext(
        'Rerun the required checks or PR Orchestrator if GitHub check data is stale.',
      );
      addStopControl();
      break;

    case 'flow/review-pending':
      addNext(
        'Wait for the active review worker to finish; PR Flow updates after review labels change.',
      );
      addNext(
        'Comment `/review` to manually rerun Code Review if the signal is stale.',
      );
      addControl('Comment `/review` on this PR to rerun Code Review.');
      addControl('Add `needs-review` when the PR should stay human-reviewed.');
      addStopControl();
      break;

    case 'flow/review-blocked':
      if (activeBlockingLabels.length > 0) {
        addNext(
          `Address active concern/block labels: ${formatInlineLabels(activeBlockingLabels)}.`,
        );
      } else {
        addNext('Address the review or policy blocker named in the reason.');
      }
      addNext(
        'After resolving feedback, rerun review if needed and let PR Flow refresh.',
      );
      addControl('Comment `/review` to rerun Code Review after fixes.');
      addControl(
        'Remove concern/block labels only after their findings are resolved.',
      );
      addControl('Add `needs-review` to require a human merge decision.');
      addStopControl();
      break;

    case 'flow/review-failed':
      addNext('Inspect the failed review worker run, then rerun the worker.');
      addNext('Comment `/review` to manually rerun Code Review.');
      addControl('Comment `/review` on this PR to rerun Code Review.');
      addStopControl();
      break;

    case 'flow/improve-pending':
      addNext(
        'Wait for PR Improve to finish; it labels `planning-draft-open` when follow-up planning is created.',
      );
      addNext(
        'Add `skip-improve` if this optional improvement intake should be skipped.',
      );
      addControl('Add `skip-improve` to skip optional PR Improve intake.');
      addStopControl();
      break;

    case 'flow/improve-failed':
      addNext('Inspect or rerun PR Improve, or skip the optional intake.');
      addNext('Add `skip-improve` to let PR Flow continue without PR Improve.');
      addControl('Add `skip-improve` to skip optional PR Improve intake.');
      addStopControl();
      break;

    case 'flow/manual-only':
      addNext('Human review is required before merge or follow-up automation.');
      addNext(
        'Comment `/approve` to record `maintainer-approved` for this head if PR Flow should continue.',
      );
      addNext(
        'Merge manually when ready; PR Finalizer stays off for manual-only policy.',
      );
      addControl(
        'Comment `/approve` to add `maintainer-approved` for this head.',
      );
      addControl(
        'Keep or add `needs-review` when a human merge decision is required.',
      );
      addStopControl();
      break;

    case 'flow/finalizer-dispatched':
      if (finalizerStatus === 'success') {
        addNext('No PR Flow action is needed; PR Finalizer completed.');
      } else {
        addNext('Wait for PR Finalizer to finish; it wakes PR Flow afterward.');
        addNext(
          'If finalization stalls, inspect the PR Finalizer run or comment.',
        );
      }
      addStopControl();
      break;

    default:
      addNext(
        'Watch `pr-flow/ready`; this comment updates when PR Flow reruns.',
      );
      addStopControl();
      break;
  }

  return {
    nextSteps: nextSteps.slice(0, 3),
    controls,
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
  const guidance = buildFlowGuidance({
    pr,
    decision,
    visibility,
    dispatchOutcome,
  });
  const nextStepLines = guidance.nextSteps.map((item) => `- ${item}`);
  const controlLines = guidance.controls.map((item) => `- ${item}`);
  const controlsSection =
    controlLines.length > 0 ? ['### Controls', '', ...controlLines, ''] : [];

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
    '### Next steps',
    '',
    ...nextStepLines,
    '',
    ...controlsSection,
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
  upsertComment({
    repo: getRepoSlug(),
    prNumber: pr.number,
    marker: COMMENT_MARKER,
    body,
  });
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

  function finish(
    state,
    reason,
    dispatch = null,
    extraLabels = [],
    extraRemoveLabels = [],
  ) {
    const desiredLabels = unique([state, ...extraLabels]);
    const labelsToAdd = desiredLabels.filter(
      (label) => !currentLabels.includes(label),
    );
    const labelsToRemove = unique([
      ...presentFlowLabels.filter((label) => !desiredLabels.includes(label)),
      ...presentResetLabels,
      ...extraRemoveLabels.filter((label) => currentLabels.includes(label)),
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
  const maintainerApproved = Boolean(policy.maintainer_approved);
  const { hard: hardBlockingLabels, manualReview: manualReviewLabels } =
    splitBlockingLabels(policyBlockingLabels);
  const reviewSignalLabels = unique([
    ...(codeReviewWorker.passLabels ?? []),
    ...(codeReviewWorker.blockLabels ?? []),
  ]);
  const nonReviewHardBlockingLabels = hardBlockingLabels.filter(
    (label) => !reviewSignalLabels.includes(label),
  );
  const manualCodeReviewRequested =
    eventName === 'issue_comment' &&
    Boolean(event?.issue?.pull_request) &&
    hasStandaloneCommand(event?.comment?.body, '/review') &&
    !policy.dependabot;
  const manualOnly = policy.manual_only || manualReviewLabels.length > 0;
  const manualOnlyReason =
    policy.blocked_reason ||
    (manualReviewLabels.length > 0
      ? `Manual review is required by label: ${manualReviewLabels.join(', ')}.`
      : 'PR is manual-only by policy.');

  if (nonReviewHardBlockingLabels.length > 0) {
    return finish(
      'flow/review-blocked',
      `Blocking labels are present: ${nonReviewHardBlockingLabels.join(', ')}.`,
    );
  }

  if (manualCodeReviewRequested) {
    const codeReviewRuns = getWorkerSummary('codeReview');
    if (codeReviewRuns.active) {
      return finish(
        'flow/review-pending',
        'Code review is already running.',
        null,
        [],
        reviewSignalLabels,
      );
    }

    return finish(
      'flow/review-pending',
      'Manual code review requested.',
      {
        key: 'codeReview',
        workflow: codeReviewWorker.workflow,
        inputs: codeReviewWorker.inputs,
      },
      [],
      reviewSignalLabels,
    );
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

  if (manualOnly && !maintainerApproved) {
    return finish('flow/manual-only', manualOnlyReason);
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
  const autoMergeEnabled = Boolean(pr.autoMergeRequest);
  const finalizerCompleted =
    workerRunSucceeded(finalizerRuns) || workerRunFailed(finalizerRuns);
  const manualOnlyLabels =
    manualOnly && !maintainerApproved ? ['flow/manual-only'] : [];

  if (
    finalizerRuns.active ||
    (finalizerAlreadyDispatched && autoMergeEnabled) ||
    (finalizerAlreadyDispatched && finalizerCompleted)
  ) {
    const reason = finalizerCompleted
      ? autoMergeEnabled
        ? 'Finalizer completed and auto-merge is enabled.'
        : 'Finalizer completed without enabling auto-merge; manual merge required.'
      : 'Finalizer already dispatched for this head SHA.';
    return finish('flow/finalizer-dispatched', reason, null, manualOnlyLabels);
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

function getWorkerDispatchRef(pr) {
  return pr.isCrossRepository || !pr.headRefName
    ? pr.baseRefName
    : pr.headRefName;
}

function dispatchWorker(pr, dispatch) {
  const dispatchRef = getWorkerDispatchRef(pr);
  const args = [
    'workflow',
    'run',
    dispatch.workflow,
    '--ref',
    dispatchRef,
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
      'number,title,url,state,mergedAt,isDraft,headRefName,headRefOid,baseRefName,author,labels,files,isCrossRepository,autoMergeRequest',
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
  buildFlowGuidance,
  buildFlowVisibility,
  collectCheckEvidence,
  dispatchWorker,
  decisionWithDispatchError,
  getWorkerDispatchRef,
  getLabelsForDecision,
  getRequiredCheckStatus,
  makeDecision,
  readConfig,
  renderFlowComment,
  resolvePrNumber,
  summarizeWorkerRuns,
};
