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
];

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
    return execFileSync(command, args, {
      encoding: 'utf8',
      env: process.env,
      input: options.input,
      stdio,
    }).trim();
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

  if (policyBlockingLabels.length > 0) {
    return finish(
      'flow/review-blocked',
      `Blocking labels are present: ${policyBlockingLabels.join(', ')}.`,
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
      'number,title,url,isDraft,headRefName,headRefOid,baseRefName,author,labels,files,isCrossRepository',
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

  if (!dryRun) {
    timeStep(timings, 'labels', () => {
      if (ensureLabelsRequested) {
        ensureLabels(config);
      }
      syncLabels(pr.number, decision);
    });

    if (decision.dispatch) {
      timeStep(timings, 'dispatch', () =>
        dispatchWorker(pr, decision.dispatch),
      );
    }
  }

  const summary = {
    status: dryRun ? 'dry-run' : 'applied',
    pr: pr.number,
    headSha: pr.headSha,
    state: decision.state,
    reason: decision.reason,
    dispatch: decision.dispatch,
    desiredLabels: decision.desiredLabels,
    labelsToAdd: decision.labelsToAdd,
    labelsToRemove: decision.labelsToRemove,
    checkStatus: decision.checkStatus,
    checkSource: checkEvidence.source,
    checkSourceReason: checkEvidence.reason,
    timings,
  };

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  collectCheckEvidence,
  getLabelsForDecision,
  getRequiredCheckStatus,
  makeDecision,
  readConfig,
  resolvePrNumber,
  summarizeWorkerRuns,
};
