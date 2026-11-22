/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const { MAX_RETRIES, RETRY_BASE_MS, isTransient } = require('./lib/retry.cjs');
const {
  collectCheckEvidence,
  getRequiredCheckStatus,
} = require('./required-check-evidence.cjs');
const { evaluateExternalReview } = require('./evaluate-external-review.cjs');
const { fetchReviewInputsGraphql } = require('./lib/review-inputs-graphql.cjs');
// Shared sticky-comment create-or-update helper (single source for the
// marker-based PR comment upsert used across review/size/orchestration scripts).
const { upsertComment } = require('./lib/sticky-comment.cjs');
const { createWorkerRunsLoader } = require('./lib/worker-runs-by-head.cjs');

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
};

const STATUS_WORKER_LABELS = {
  codeReview: 'Code review',
  securityReview: 'Security review',
  dependencyReview: 'Dependency review',
  kiloReview: 'Kilo review',
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
  const retryEnabled = options.retry === true;

  for (let attempt = 0; ; attempt++) {
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

      if (retryEnabled && attempt < MAX_RETRIES - 1 && isTransient(stderr)) {
        const delay = RETRY_BASE_MS * 2 ** attempt;
        console.warn(
          `orchestrate-pr-flow: transient HTTP error on attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${delay}ms: ${stderr.split('\n')[0]}`,
        );
        execFileSync('sleep', [String(delay / 1000)], { stdio: 'ignore' });
        continue;
      }

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
}

function runJson(command, args, fallback, options = {}) {
  const output = run(command, args, {
    retry: true,
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

function isBotAccount(user = {}) {
  const login = String(user.login ?? '');
  const type = String(user.type ?? '');

  return type === 'Bot' || /\[bot\]$/.test(login);
}

function isMaintainerComment(comment = {}, maintainerAssociations = []) {
  return (
    maintainerAssociations.includes(comment.author_association) &&
    !isBotAccount(comment.user)
  );
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
    headCommittedAt: pr.headCommittedAt ?? pr.head?.commit?.committedDate ?? '',
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
        path.join(__dirname, 'evaluate-pr-policy.cjs'),
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
  // Entries ending in `/**` match any file under that directory prefix;
  // everything else stays an exact-path match.
  return files.some((file) =>
    (paths ?? []).some((pattern) =>
      pattern.endsWith('/**')
        ? file.startsWith(pattern.slice(0, -2))
        : pattern === file,
    ),
  );
}

/**
 * Matches a worker workflow run to a specific PR + head SHA.
 *
 * ### Run-name contract
 *
 * Worker workflows dispatched by the orchestrator MUST include both the PR
 * number and the head SHA in their `run-name` YAML field, e.g.:
 *
 *     run-name: "PR #${{ inputs.pr_number }} @ ${{ inputs.head_sha }}"
 *
 * The orchestrator calls `gh run list` and filters results through this
 * function.  If a worker changes its run-name format and drops either token,
 * the orchestrator will silently stop matching that worker's runs, which can
 * lead to duplicate dispatches or stuck PR states.
 *
 * Consumers of `matchesWorkerTitle` (`summarizeWorkerRuns`,
 * `getWorkerSummary`) rely on this two-token contract — keep it in sync.
 */
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

  const failedCount = runs.filter(
    (runItem) => runItem.conclusion && runItem.conclusion !== 'success',
  ).length;

  return {
    active,
    latest: runs[0] ?? null,
    failedCount,
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

const MAX_FINALIZER_RETRIES = 3;

// Maximum automatic re-dispatches of a failed code-review run per head SHA
// (so at most MAX_CODE_REVIEW_RETRIES + 1 runs happen without a human).
const MAX_CODE_REVIEW_RETRIES = 2;

function getFinalizerRetryCount(labels) {
  let maxRetry = 0;
  for (const label of labels) {
    const match = label.match(/^flow\/finalizer-retry-(\d+)$/);
    if (match) {
      maxRetry = Math.max(maxRetry, parseInt(match[1], 10));
    }
  }
  return maxRetry;
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
  externalReview = {
    state: 'skipped',
    reason: 'Kilo review was not required.',
  },
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

  // Terminal manual-only stops dispatching review workers, but it must not
  // erase achieved review outcomes from the table: the terminal snapshot is
  // the one a maintainer reads to decide the manual merge, and a recorded
  // pass/concern (review labels, Kilo verdict) is exactly the signal that
  // decision needs. Each review worker therefore renders "N/A: PR is
  // manual-only." only when it has no recorded signal; with a signal, the
  // normal branches below render it. prImprove and finalizer keep the
  // unconditional N/A — they genuinely never run on manual-only PRs.
  const codeDispatchError = dispatchErrorFor('codeReview');
  if (
    manualTerminal &&
    !hasAny(labels, ['ai-review-concerns', 'ai-review-passed'])
  ) {
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
    statuses.codeReview = reviewPendingStatus(
      'codeReview',
      'Waiting for code review signal.',
    );
  }

  const securityDispatchError = dispatchErrorFor('securityReview');
  if (
    manualTerminal &&
    !hasAny(labels, ['security-review-concerns', 'security-review-passed'])
  ) {
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
    statuses.securityReview = reviewPendingStatus(
      'securityReview',
      'Waiting for security review signal.',
    );
  }

  const dependencyDispatchError = dispatchErrorFor('dependencyReview');
  if (
    manualTerminal &&
    needsDependencyReview &&
    !hasAny(labels, [
      'deps-review-manual',
      'deps-review-blocked',
      'deps-review-passed',
    ])
  ) {
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

  if (manualTerminal && externalReview.state === 'pending') {
    statuses.kiloReview = skippedStatus(
      'kiloReview',
      'N/A: PR is manual-only.',
    );
  } else if (policy.dependabot) {
    statuses.kiloReview = skippedStatus(
      'kiloReview',
      'N/A: Dependabot PRs use dependency review.',
    );
  } else if (externalReview.state === 'blocked') {
    statuses.kiloReview = failureStatus(
      'kiloReview',
      externalReview.reason || 'Kilo review is blocking.',
    );
  } else if (externalReview.state === 'passed') {
    statuses.kiloReview = successStatus(
      'kiloReview',
      externalReview.reason || 'Kilo review passed.',
    );
  } else if (externalReview.state === 'skipped') {
    statuses.kiloReview = skippedStatus(
      'kiloReview',
      externalReview.reason || 'Kilo review was skipped.',
    );
  } else {
    statuses.kiloReview = waitingStatus(
      'kiloReview',
      externalReview.reason || 'Waiting for Kilo review signal.',
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
    const retries = getFinalizerRetryCount(decision.labelsToAdd);
    const retryInfo =
      retries > 0 ? ` (attempt ${retries}/${MAX_FINALIZER_RETRIES})` : '';
    statuses.finalizer = waitingStatus(
      'finalizer',
      `Finalizer completed without enabling auto-merge; waiting to retry.${retryInfo}`,
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
    // If manual-only PR has completed all advisory review labels, indicate reviews passed.
    // Mirror makeDecision's hasAll(codeReviewWorker.passLabels) so the aggregate cannot
    // report "advisory reviews passed" when only a subset of required reviews completed.
    if (hasAll(labels, workers.codeReview?.passLabels ?? [])) {
      aggregateDescription =
        'Manual-only PR: advisory reviews passed. Ready for human merge decision.';
    } else {
      aggregateDescription =
        decision.reason || 'PR is manual-only; orchestration is complete.';
    }
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
      statuses.kiloReview,
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

const RUN_LINK_AT_ROW_END = /\[run\]\(([^)]*)\) \|$/;

function workerRowKey(line) {
  return line.startsWith('| ') ? line.slice(2, line.indexOf(' | ', 2)) : null;
}

// Every wake renders a different link for workers that have no run of their
// own (it falls back to the orchestrator run URL), so a freshly rendered body
// is never byte-identical to the stored one even when nothing changed. Rows
// whose new link is the current run URL therefore keep the stored link; every
// other difference (state, reason, a changed worker-run link, ...) is kept
// as is and still counts as a change. A stored row with no link at all does
// not adopt the volatile one for free: gaining a link is a real change.
function stabilizeRunLinks(existingBody, newBody, currentRunUrl) {
  if (!currentRunUrl) return newBody;
  const storedLinkByRow = new Map();
  for (const line of String(existingBody).split('\n')) {
    const key = workerRowKey(line);
    const match = key === null ? null : line.match(RUN_LINK_AT_ROW_END);
    if (match) storedLinkByRow.set(key, match[1]);
  }

  return newBody
    .split('\n')
    .map((line) => {
      const match = line.match(RUN_LINK_AT_ROW_END);
      if (!match || match[1] !== currentRunUrl) return line;
      const storedLink = storedLinkByRow.get(workerRowKey(line));
      return storedLink === undefined
        ? line
        : line.replace(RUN_LINK_AT_ROW_END, () => `[run](${storedLink}) |`);
    })
    .join('\n');
}

// GitHub may hand a stored body back with CRLF line endings.
function flowCommentUnchanged(existingBody, newBody, currentRunUrl) {
  const stored = existingBody.replace(/\r\n/g, '\n');
  return stored === stabilizeRunLinks(stored, newBody, currentRunUrl);
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

// Status ids are monotonic but may arrive as strings, and a missing id
// (null, undefined, '') coerces to 0 via Number — guard the raw value
// before coercing so an absent id is never treated as a real id of 0.
function usableStatusId(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

// Compare duplicate entries for the same context without trusting array
// order. A usable created_at outranks an unusable one, so a missing or
// malformed timestamp cannot pin the first array entry. Equal timestamps
// (GitHub has second granularity, so overlapping prt/wake runs on the same
// head can tie) and pairs with no usable timestamp both fall back to the
// monotonic status id, where a usable id likewise outranks an unusable one.
// Only when neither signal is usable does the first array entry stay.
function isNewerStatusEntry(entry, current) {
  const entryAt = Date.parse(entry.created_at ?? '');
  const currentAt = Date.parse(current.created_at ?? '');
  const entryUsable = !Number.isNaN(entryAt);
  const currentUsable = !Number.isNaN(currentAt);
  if (entryUsable !== currentUsable) return entryUsable;
  if (entryUsable && entryAt !== currentAt) return entryAt > currentAt;
  const entryId = usableStatusId(entry.id);
  const currentId = usableStatusId(current.id);
  if ((entryId === null) !== (currentId === null)) return entryId !== null;
  if (entryId !== null && entryId !== currentId) return entryId > currentId;
  return false;
}

// Index the latest status per context explicitly by created_at (tie-broken
// on the status id) instead of trusting array order: a caller passing full
// history (commits/{sha}/statuses) would make last-wins pick the oldest
// duplicate, which could suppress a needed success POST while the real
// latest status is a failure.
function indexStatusesByContext(statuses) {
  const byContext = new Map();
  if (!Array.isArray(statuses)) return byContext;
  for (const entry of statuses) {
    if (entry && typeof entry.context === 'string') {
      const current = byContext.get(entry.context);
      if (!current || isNewerStatusEntry(entry, current)) {
        byContext.set(entry.context, entry);
      }
    }
  }
  return byContext;
}

// Only an unchanged `success` is safe to skip. The watchdog and the Kilo
// review timeout read the age and history of pending/failure/error statuses,
// so those are re-posted on every wake to keep refreshing their timestamps.
function shouldPublishStatus(
  previousStatusByContext,
  status,
  currentRunUrl = getCurrentRunUrl(),
) {
  const previous = previousStatusByContext?.get?.(status.context);
  if (!previous) return true;
  if (String(status.state).toLowerCase() !== 'success') return true;
  if (String(previous.state).toLowerCase() !== 'success') return true;
  if (
    String(previous.description ?? '') !==
    truncateStatusDescription(status.description)
  ) {
    return true;
  }
  const previousUrl = String(previous.target_url ?? '');
  const nextUrl = String(status.targetUrl ?? '');
  // The orchestrator run URL changes on every wake, so requiring it to match
  // would make the skip never apply to statuses that link to the current run.
  // When the new link is that volatile URL the previous link is kept instead:
  // an older worker-run link stays in place (a run URL is a run URL, and the
  // worker link is more specific than the orchestrator one), while a status
  // that had no link yet is posted once so it actually gains the link.
  const nextUrlIsCurrentRun = nextUrl !== '' && nextUrl === currentRunUrl;
  if (nextUrlIsCurrentRun && previousUrl === '') return true;
  return !(nextUrlIsCurrentRun || previousUrl === nextUrl);
}

function publishFlowStatuses(
  pr,
  visibility,
  {
    readStatuses = fetchCommitStatuses,
    publishStatus = publishCommitStatus,
    currentRunUrl = getCurrentRunUrl(),
    freshStatuses = null,
  } = {},
) {
  const statuses = visibility.orderedStatuses;
  let previousByContext = new Map();
  // Nothing can be skipped unless some status is a success, so avoid the
  // extra read otherwise.
  if (statuses.some((s) => String(s.state).toLowerCase() === 'success')) {
    try {
      // Read at publish time rather than reusing a snapshot from earlier in
      // the wake (e.g. the external-review evaluation): prt and wake runs use
      // separate concurrency groups, so another orchestrator run for the same
      // head may have posted statuses in between. `freshStatuses` is such a
      // publish-time read made through GraphQL; without one the REST read runs.
      previousByContext = indexStatusesByContext(
        Array.isArray(freshStatuses) ? freshStatuses : readStatuses(pr.headSha),
      );
    } catch (error) {
      console.error(
        `Could not read current commit statuses; posting all: ${formatCommandError(error)}`,
      );
    }
  }
  for (const status of statuses) {
    if (shouldPublishStatus(previousByContext, status, currentRunUrl)) {
      publishStatus(pr, status);
    }
  }
}

// The wake rewrites the comment only when its content changed: replacing it is
// a POST plus a DELETE and a new issue_comment event every time. `freshComments`
// is a publish-time GraphQL read of the PR's issue comments; without one the
// sticky lookup reads them over REST.
function upsertFlowComment(
  pr,
  body,
  {
    upsert = upsertComment,
    currentRunUrl = getCurrentRunUrl(),
    freshComments = null,
  } = {},
) {
  upsert({
    repo: getRepoSlug(),
    prNumber: pr.number,
    marker: COMMENT_MARKER,
    body,
    skipIfUnchanged: true,
    sameBody: (existingBody, nextBody) =>
      flowCommentUnchanged(existingBody, nextBody, currentRunUrl),
    ...(Array.isArray(freshComments) ? { comments: freshComments } : {}),
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

function fetchPrIssueComments(prNumber) {
  return runJson(
    'gh',
    ['api', `repos/${getRepoSlug()}/issues/${prNumber}/comments`, '--paginate'],
    [],
  );
}

function fetchPrReviewComments(prNumber) {
  return runJson(
    'gh',
    ['api', `repos/${getRepoSlug()}/pulls/${prNumber}/comments`, '--paginate'],
    [],
  );
}

function fetchPrReviews(prNumber) {
  return runJson(
    'gh',
    ['api', `repos/${getRepoSlug()}/pulls/${prNumber}/reviews`, '--paginate'],
    [],
  );
}

function fetchCommitStatuses(headSha) {
  if (!headSha) return [];
  const response = runJson(
    'gh',
    ['api', `repos/${getRepoSlug()}/commits/${headSha}/status?per_page=100`],
    { statuses: [] },
  );
  return response?.statuses ?? [];
}

function fetchCheckRuns(headSha) {
  if (!headSha) return [];
  const response = runJson(
    'gh',
    ['api', `repos/${getRepoSlug()}/commits/${headSha}/check-runs`],
    { check_runs: [] },
  );
  return response?.check_runs ?? [];
}

// `strict` drops the empty fallback so a failed commit read throws instead of
// reading as "date unknown". The orchestrator wants the fallback (an unknown
// date only sends the worker-run lookup to the per-workflow path), but the
// parity comparison must not classify a failed read as that legitimate case.
function fetchHeadCommittedAt(headSha, { strict = false } = {}) {
  if (!headSha) return '';
  const response = runJson(
    'gh',
    ['api', `repos/${getRepoSlug()}/commits/${headSha}`],
    strict ? undefined : null,
  );
  return (
    response?.commit?.committer?.date ?? response?.commit?.author?.date ?? ''
  );
}

// Which transport feeds the Kilo review evaluation. GraphQL has its own quota
// bucket, so it spares the (scarcer) REST one; REST stays the reference path
// and the fallback. A repository variable overrides the default without a
// commit: `rest` is the rollback switch.
const DEFAULT_REVIEW_SOURCE = 'graphql';

function resolveReviewSource(value = process.env.PR_FLOW_REVIEW_SOURCE) {
  const requested = String(value ?? '')
    .trim()
    .toLowerCase();
  if (requested === '') return DEFAULT_REVIEW_SOURCE;
  if (requested === 'graphql' || requested === 'rest') return requested;
  // A typo must never silently enable the newer path.
  console.warn(
    `orchestrate-pr-flow: unknown PR_FLOW_REVIEW_SOURCE "${requested}", using rest.`,
  );
  return 'rest';
}

// The -f vs -F split is load-bearing: the query declares `: Boolean!` /
// `: Int!` variables, and a boolean or number routed through -f would be sent
// as the JSON string "false"/"7", which GraphQL rejects on every call.
function buildGraphqlArgs(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) continue;
    // -f keeps strings (cursors) literal; -F types numbers and booleans.
    args.push(typeof value === 'string' ? '-f' : '-F', `${key}=${value}`);
  }
  return args;
}

function runGraphqlQuery(query, variables) {
  return JSON.parse(
    run('gh', buildGraphqlArgs(query, variables), { retry: true }),
  );
}

function fetchRestReviewInputs(pr) {
  return {
    comments: fetchPrIssueComments(pr.number),
    reviewComments: fetchPrReviewComments(pr.number),
    reviews: fetchPrReviews(pr.number),
    checkRuns: fetchCheckRuns(pr.headSha),
    statuses: fetchCommitStatuses(pr.headSha),
  };
}

function fetchGraphqlReviewInputs(pr) {
  const { cost, ...inputs } = fetchReviewInputsGraphql({
    repo: getRepoSlug(),
    prNumber: pr.number,
    headSha: pr.headSha,
    runGraphql: runGraphqlQuery,
  });
  console.log(`orchestrate-pr-flow: review inputs via GraphQL (cost ${cost}).`);
  return inputs;
}

function collectExternalReview(
  pr,
  {
    source = resolveReviewSource(),
    loadRest = fetchRestReviewInputs,
    loadGraphql = fetchGraphqlReviewInputs,
    evaluate = evaluateExternalReview,
  } = {},
) {
  let inputs = null;
  if (source === 'graphql') {
    try {
      inputs = loadGraphql(pr);
    } catch (error) {
      // Any doubt about the GraphQL data: use REST for this wake only.
      console.warn(
        `orchestrate-pr-flow: GraphQL review inputs unavailable, using REST: ${error.message}`,
      );
    }
  }
  return evaluate({ pr, ...(inputs ?? loadRest(pr)) });
}

// The head commit date comes from the `commits` field of the PR read the wake
// already makes (a GraphQL call), instead of a separate REST `commits/{sha}`
// read. Only the PR's last commit counts, and only when it is the head: `gh`
// lists a bounded page of commits, so on a very long PR the last listed commit
// may not be the tip. Same precedence as REST (committer date, then author
// date); anything unusable returns '' so the caller reads REST.
function headCommittedAtFromCommits(commits, headSha) {
  if (!headSha || !Array.isArray(commits) || commits.length === 0) return '';
  const last = commits[commits.length - 1];
  if (last?.oid !== headSha) return '';
  const date = last.committedDate ?? last.authoredDate ?? '';
  return Number.isNaN(Date.parse(date)) ? '' : date;
}

function resolveHeadCommittedAt(
  rawPr,
  pr,
  { source = resolveReviewSource(), readRest = fetchHeadCommittedAt } = {},
) {
  if (source === 'graphql') {
    const date = headCommittedAtFromCommits(rawPr?.commits, pr.headSha);
    if (date) return date;
    console.warn(
      'orchestrate-pr-flow: head commit date missing from the PR read, using REST.',
    );
  }
  return readRest(pr.headSha);
}

// Both flags are normalized to strict booleans before they reach the adapter:
// it treats an omitted `contexts` as `true`, so a truthy-but-not-`true`
// `wantStatuses` would pay for the status rollup and then be discarded here.
function fetchPublishSnapshotGraphql(
  pr,
  { wantComments = true, wantStatuses = false } = {},
) {
  const comments = wantComments === true;
  const statuses = wantStatuses === true;
  const snapshot = fetchReviewInputsGraphql({
    repo: getRepoSlug(),
    prNumber: pr.number,
    headSha: pr.headSha,
    runGraphql: runGraphqlQuery,
    want: {
      comments,
      reviews: false,
      threads: false,
      contexts: statuses,
    },
  });
  console.log(
    `orchestrate-pr-flow: publish snapshot via GraphQL (cost ${snapshot.cost}).`,
  );
  return {
    comments: comments ? snapshot.comments : null,
    statuses: statuses ? snapshot.statuses : null,
  };
}

// Publish-time GraphQL reads at the visibility step, each taken immediately
// before its consumer: the commit statuses right before their POSTs (only when
// a success status could be skipped) and the sticky-comment list right before
// the comment write, after the status POSTs. Reading the comment list before
// those up-to-seven REST writes would leave it stale long enough for
// overlapping prt/wake runs on one head to both see "no sticky comment" and
// both POST one — a duplicate `skipIfUnchanged` then never converges away.
// Every field is null when the read is unavailable (or the source is `rest`),
// and each consumer then performs its own REST read.
function readPublishSnapshot(
  pr,
  {
    wantComments = true,
    wantStatuses = false,
    source = resolveReviewSource(),
    loadGraphql = fetchPublishSnapshotGraphql,
  },
) {
  const none = { comments: null, statuses: null };
  if (source !== 'graphql') return none;
  try {
    return loadGraphql(pr, {
      wantComments: wantComments === true,
      wantStatuses: wantStatuses === true,
    });
  } catch (error) {
    console.warn(
      `orchestrate-pr-flow: publish-time GraphQL read unavailable, using REST: ${error.message}`,
    );
    return none;
  }
}

// The visibility step's writes, in one enforced order: read the commit
// statuses, post the flow statuses, and only then read the PR's comment list
// and upsert the sticky comment. Reading the comment list together with the
// status read would leave it stale across those up-to-seven REST writes long
// enough for overlapping prt/wake runs on one head to both see "no sticky
// comment" and both POST one — a duplicate `skipIfUnchanged` comment then
// never converges away. Readers and writers are injectable so the ordering
// stays regression-tested. A failed comment write re-renders the visibility
// with the error surfaced and returns it as `fatalError` for the caller.
function publishVisibilityUpdates(
  pr,
  visibility,
  {
    reviewSource,
    decision,
    dispatchOutcome,
    config,
    policy,
    externalReview,
    workerRuns,
    eventName,
    event,
    visibilityErrors = [],
    readSnapshot = readPublishSnapshot,
    publishStatuses = publishFlowStatuses,
    writeComment = upsertFlowComment,
    renderComment = renderFlowComment,
    publishAggregateStatus = publishCommitStatus,
    buildVisibility = buildFlowVisibility,
  } = {},
) {
  const statusSnapshot = readSnapshot(pr, {
    wantComments: false,
    wantStatuses: visibility.orderedStatuses.some(
      (status) => String(status.state).toLowerCase() === 'success',
    ),
    source: reviewSource,
  });
  publishStatuses(pr, visibility, { freshStatuses: statusSnapshot.statuses });

  const commentSnapshot = readSnapshot(pr, {
    wantComments: true,
    wantStatuses: false,
    source: reviewSource,
  });
  try {
    writeComment(
      pr,
      renderComment({ pr, decision, visibility, dispatchOutcome }),
      { freshComments: commentSnapshot.comments },
    );
    return { visibility, fatalError: null };
  } catch (error) {
    const errorMessage = formatCommandError(error);
    const commentError = `PR flow comment update failed: ${errorMessage}`;
    visibilityErrors.push(commentError);
    const errorVisibility = buildVisibility({
      pr,
      config,
      policy,
      decision,
      externalReview,
      workerRuns,
      eventName,
      event,
      dispatchOutcome,
      visibilityErrors,
    });
    publishAggregateStatus(pr, errorVisibility.aggregate);
    return { visibility: errorVisibility, fatalError: new Error(commentError) };
  }
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
    if (resetLabels.length > 0 && /^flow\/finalizer-retry-\d+$/.test(label))
      return false;
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
    externalReview = {
      state: 'skipped',
      reason: 'Kilo review was not required.',
    },
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
    isMaintainerComment(event?.comment, policy.maintainerAssociations ?? []) &&
    hasStandaloneCommand(event?.comment?.body, '/review') &&
    !policy.dependabot;
  const manualOnly = policy.manual_only || manualReviewLabels.length > 0;
  if (nonReviewHardBlockingLabels.length > 0) {
    return finish(
      'flow/review-blocked',
      `Blocking labels are present: ${nonReviewHardBlockingLabels.join(', ')}.`,
    );
  }

  // Cross-repository PRs never receive automated workers — this gate must
  // sit below the failing gates above (required checks, hard blocking
  // labels) so a broken fork PR resolves to a failing state instead of
  // passing the pr-flow/ready aggregate, and above any worker dispatch so a
  // maintainer /review cannot dispatch a privileged worker either. Advisory
  // review concerns stay blocking here: no automated review will ever
  // replace them on a fork PR, so they cannot be masked as success.
  if (pr.isCrossRepository) {
    const concernLabels = (codeReviewWorker.blockLabels ?? []).filter((label) =>
      labels.includes(label),
    );
    if (concernLabels.length > 0 && !maintainerApproved) {
      return finish(
        'flow/review-blocked',
        `Blocking labels are present: ${concernLabels.join(', ')}.`,
      );
    }
    return finish(
      'flow/manual-only',
      'Cross-repository PRs require manual review.',
      null,
      [],
      currentLabels.filter((label) =>
        /^flow\/finalizer-retry-\d+$/.test(label),
      ),
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

  // Advisory review concerns (ai-/security-review-concerns) stay blocking on
  // manual-only PRs so a needs-review label never masks them as success.
  if (
    manualOnly &&
    !maintainerApproved &&
    hasAny(labels, codeReviewWorker.blockLabels ?? [])
  ) {
    const concernLabels = (codeReviewWorker.blockLabels ?? []).filter((label) =>
      labels.includes(label),
    );
    return finish(
      'flow/review-blocked',
      `Blocking labels are present: ${concernLabels.join(', ')}.`,
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
        const failedAttempts = codeReviewRuns.failedCount ?? 1;
        if (failedAttempts <= MAX_CODE_REVIEW_RETRIES) {
          return finish(
            'flow/review-pending',
            `Code review failed; retrying (attempt ${failedAttempts + 1} of ${MAX_CODE_REVIEW_RETRIES + 1}).`,
            {
              key: 'codeReview',
              workflow: codeReviewWorker.workflow,
              inputs: codeReviewWorker.inputs,
            },
          );
        }

        // Retries exhausted: dispatch the advisory fallback reviewer once so
        // the maintainer gets a second opinion while the flow stays failed.
        // The merge gate still requires the primary review pass labels.
        const antigravityWorker = workers.antigravityCodeReview ?? {};
        const antigravitySignalLabels = [
          ...(antigravityWorker.passLabels ?? []),
          ...(antigravityWorker.blockLabels ?? []),
        ];
        if (antigravityWorker.workflow) {
          const antigravityRuns = getWorkerSummary('antigravityCodeReview');
          if (
            !antigravityRuns.active &&
            !antigravityRuns.latest &&
            !hasAny(labels, antigravitySignalLabels)
          ) {
            return finish(
              'flow/review-failed',
              'Code review failed after retries; dispatching advisory Antigravity review.',
              {
                key: 'antigravityCodeReview',
                workflow: antigravityWorker.workflow,
                inputs: antigravityWorker.inputs,
              },
            );
          }
        }
        return finish('flow/review-failed', 'Code review workflow failed.');
      }

      return finish('flow/review-pending', 'Dispatching code review.', {
        key: 'codeReview',
        workflow: codeReviewWorker.workflow,
        inputs: codeReviewWorker.inputs,
      });
    }
  }

  if (!policy.dependabot) {
    if (externalReview.state === 'blocked') {
      return finish(
        'flow/review-blocked',
        externalReview.reason || 'Kilo review is blocking.',
      );
    }

    if (externalReview.state === 'pending') {
      return finish(
        'flow/review-pending',
        externalReview.reason || 'Waiting for Kilo review signal.',
      );
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
  const autoMergeEnabled = Boolean(pr.autoMergeRequest);
  const finalizerSucceeded = workerRunSucceeded(finalizerRuns);
  const finalizerFailed = workerRunFailed(finalizerRuns);
  const finalizerRetries = getFinalizerRetryCount(currentLabels);
  const retryLabels = currentLabels.filter((l) =>
    /^flow\/finalizer-retry-\d+$/.test(l),
  );
  const manualOnlyLabels =
    manualOnly && !maintainerApproved ? ['flow/manual-only'] : [];

  if (manualOnly && !maintainerApproved) {
    // The finalizer decision for an unapproved manual-only PR is
    // deterministic (manual_only) — dispatching it can never merge; it only
    // keeps the aggregate pending, which makes the watchdog re-poke and
    // re-dispatch forever. Land on the terminal manual-only state instead;
    // /approve or a manual merge is the only way forward.
    return finish(
      'flow/manual-only',
      'Manual review required; use /approve or merge manually.',
      null,
      [],
      retryLabels,
    );
  }

  // A finalizer run that FAILED (e.g. the approve/merge apply step was
  // rejected) is deliberately NOT terminal here: it falls through to the
  // bounded retry lane below, because the failure is usually environmental
  // (token permissions, transient API error) rather than a policy decision.
  if (
    finalizerRuns.active ||
    (finalizerAlreadyDispatched && autoMergeEnabled) ||
    (finalizerAlreadyDispatched && finalizerSucceeded)
  ) {
    const reason = finalizerSucceeded
      ? autoMergeEnabled
        ? 'Finalizer completed and auto-merge is enabled.'
        : 'Finalizer completed without enabling auto-merge; manual merge required.'
      : 'Finalizer already dispatched for this head SHA.';
    return finish(
      'flow/finalizer-dispatched',
      reason,
      null,
      manualOnlyLabels,
      retryLabels,
    );
  }

  if (
    finalizerAlreadyDispatched &&
    !finalizerSucceeded &&
    finalizerRetries >= MAX_FINALIZER_RETRIES
  ) {
    return finish(
      'flow/manual-only',
      `Finalizer retry limit (${MAX_FINALIZER_RETRIES}) reached without auto-merge; falling back to manual merge.`,
      null,
      ['flow/manual-only'],
      retryLabels,
    );
  }

  const newRetryCount = finalizerRetries + 1;
  const retryExtraLabels = finalizerAlreadyDispatched
    ? [`flow/finalizer-retry-${newRetryCount}`]
    : [];

  return finish(
    'flow/finalizer-dispatched',
    finalizerAlreadyDispatched
      ? finalizerFailed
        ? `Retrying finalizer after a failed run (attempt ${newRetryCount}/${MAX_FINALIZER_RETRIES}).`
        : `Dispatching finalizer (attempt ${newRetryCount}/${MAX_FINALIZER_RETRIES}).`
      : 'Dispatching finalizer.',
    {
      key: 'finalizer',
      workflow: finalizerWorker.workflow,
      inputs: finalizerWorker.inputs,
    },
    [...retryExtraLabels, ...manualOnlyLabels],
    retryLabels,
  );
}

// `strict` drops the empty-list fallback so a failed `gh run list` throws
// instead of reading as "no runs" — the parity comparison must not classify a
// failed read as data.
function collectWorkerRuns(config, workerName, { strict = false } = {}) {
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
    strict ? undefined : [],
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
    run(
      'gh',
      [
        'issue',
        'edit',
        String(prNumber),
        '--add-label',
        decision.labelsToAdd.join(','),
      ],
      { allowFailure: true },
    );
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

const PULL_REQUEST_FIELDS =
  'number,title,url,state,mergedAt,isDraft,headRefName,headRefOid,baseRefName,author,labels,files,isCrossRepository,autoMergeRequest';

// `includeCommits` adds the commit list that supplies the head commit date; the
// `rest` source leaves the call exactly as it was.
function fetchPullRequest(prNumber, { includeCommits = false } = {}) {
  return runJson(
    'gh',
    [
      'pr',
      'view',
      String(prNumber),
      '--json',
      includeCommits ? `${PULL_REQUEST_FIELDS},commits` : PULL_REQUEST_FIELDS,
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
  // Resolved once so a mistyped variable warns once and every reuse point of
  // this wake agrees on the transport.
  const reviewSource = resolveReviewSource();

  const resolved = timeStep(timings, 'resolve-pr', () => {
    const prNumber = resolvePrNumber(eventName, event, explicitPrNumber);
    if (!prNumber) {
      return { prNumber: null, config: null, pr: null };
    }

    const config = readConfig(configFile);
    const rawPr = fetchPullRequest(prNumber, {
      includeCommits: reviewSource === 'graphql',
    });
    const pr = rawPr ? normalizePr(rawPr) : null;
    if (pr) {
      pr.headCommittedAt = resolveHeadCommittedAt(rawPr, pr, {
        source: reviewSource,
      });
    }
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
  let externalReview = {
    state: 'skipped',
    reason: 'Kilo review was not required.',
  };

  if (!pr.isDraft) {
    checkEvidence = timeStep(timings, 'checks', () =>
      collectCheckEvidence({
        pr,
        config,
        eventName,
        event,
        allowRunListFallback: true,
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

    if (!policy.dependabot) {
      externalReview = timeStep(timings, 'worker-runs', () =>
        collectExternalReview(pr, { source: reviewSource }),
      );
    }
  }

  const workerRuns = {};
  const loadWorkerRuns = createWorkerRunsLoader({
    config,
    pr,
    getRepo: getRepoSlug,
    run,
    loadLegacy: (workerName) => collectWorkerRuns(config, workerName),
  });
  const getWorkerRuns = (workerName) => {
    if (workerRuns[workerName] === undefined) {
      workerRuns[workerName] = timeStep(timings, 'worker-runs', () =>
        loadWorkerRuns(workerName),
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
    externalReview,
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
        externalReview,
        workerRuns,
        eventName,
        event,
        dispatchOutcome,
        visibilityErrors,
      });

      // Statuses are read and posted before the comment list so the sticky
      // write matches against a list that cannot be stale across those REST
      // writes; publishVisibilityUpdates owns and regression-tests that order.
      const published = publishVisibilityUpdates(pr, visibility, {
        reviewSource,
        decision: appliedDecision,
        dispatchOutcome,
        config,
        policy,
        externalReview,
        workerRuns,
        eventName,
        event,
        visibilityErrors,
      });
      visibility = published.visibility;
      fatalError = published.fatalError;
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
      externalReview,
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
  buildGraphqlArgs,
  buildFlowVisibility,
  collectCheckEvidence,
  collectExternalReview,
  COMMENT_MARKER,
  decisionWithDispatchError,
  fetchCheckRuns,
  fetchCommitStatuses,
  fetchHeadCommittedAt,
  fetchPrIssueComments,
  fetchPublishSnapshotGraphql,
  fetchPrReviewComments,
  fetchPrReviews,
  getFinalizerRetryCount,
  getWorkerDispatchRef,
  headCommittedAtFromCommits,
  getWorkerTargetUrl,
  getLabelsForDecision,
  indexStatusesByContext,
  matchesWorkerTitle,
  getRequiredCheckStatus,
  evaluatePolicy,
  makeDecision,
  MAX_CODE_REVIEW_RETRIES,
  MAX_FINALIZER_RETRIES,
  pathsMatch,
  publishFlowStatuses,
  publishVisibilityUpdates,
  readConfig,
  readPublishSnapshot,
  renderFlowComment,
  resolveHeadCommittedAt,
  resolvePrNumber,
  resolveReviewSource,
  runGraphqlQuery,
  shouldPublishStatus,
  stabilizeRunLinks,
  summarizeWorkerRuns,
  upsertFlowComment,
  usableStatusId,
  collectWorkerRuns,
};
