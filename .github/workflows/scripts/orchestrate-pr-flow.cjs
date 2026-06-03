/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readConfig(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
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
    return execFileSync(command, args, {
      encoding: 'utf8',
      env: process.env,
      input: options.input,
      stdio,
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return options.fallback ?? '';
    }

    const stderr = String(error.stderr ?? '').trim();
    if (stderr) {
      console.error(stderr);
    }
    throw error;
  }
}

function runJson(command, args, fallback) {
  const output = run(command, args, {
    allowFailure: fallback !== undefined,
    fallback: fallback === undefined ? undefined : JSON.stringify(fallback),
  });
  return output ? JSON.parse(output) : fallback;
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

    const title =
      event.workflow_run?.display_title ?? event.workflow_run?.name ?? '';
    const match = title.match(/\bPR #(\d+)\b/);
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

function makeDecision(context) {
  const { pr, policy, checks, workerRuns, eventName, event, config } = context;
  const workers = config.workers ?? {};
  const labels = pr.labels;
  const flowLabels = allFlowLabels(config);
  const labelsToRemove = [...flowLabels];
  const labelsToAdd = [];
  const resetLabels =
    isHeadResetEvent(eventName, event) && !pr.isDraft
      ? (config.resetOnHeadChange?.labels ?? [])
      : [];

  function finish(state, reason, dispatch = null, extraLabels = []) {
    labelsToAdd.push(...extraLabels);
    if (state) {
      labelsToAdd.unshift(state);
    }

    return {
      state,
      reason,
      dispatch,
      labelsToAdd: unique(labelsToAdd),
      labelsToRemove: unique([...labelsToRemove, ...resetLabels]),
      checkStatus: getRequiredCheckStatus(checks, config.checks?.required),
    };
  }

  if (pr.isDraft) {
    return finish('flow/draft', 'PR is draft.');
  }

  const checkStatus = getRequiredCheckStatus(checks, config.checks?.required);
  if (checkStatus.status === 'failed') {
    return finish('flow/checks-failed', 'Required checks are failing.');
  }
  if (checkStatus.status === 'pending') {
    return finish('flow/checks-pending', 'Waiting for required checks.');
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
      const dependencyRuns = summarizeWorkerRuns(
        workerRuns,
        'dependencyReview',
        pr,
      );
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
      const codeReviewRuns = summarizeWorkerRuns(workerRuns, 'codeReview', pr);
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
    const improveRuns = summarizeWorkerRuns(workerRuns, 'prImprove', pr);
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

  const finalizerRuns = summarizeWorkerRuns(workerRuns, 'finalizer', pr);
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

function collectWorkerRuns(config) {
  const entries = Object.entries(config.workers ?? {});
  const result = {};

  for (const [key, worker] of entries) {
    result[key] = runJson(
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

  return result;
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

function main() {
  const eventName = getArg('--event-name', process.env.GITHUB_EVENT_NAME ?? '');
  const eventPath = getArg('--event-path', process.env.GITHUB_EVENT_PATH ?? '');
  const explicitPrNumber =
    getArg('--pr-number', process.env.PR_NUMBER ?? '') || null;
  const configFile = getArg('--config-file', '.github/pr-flow.yml');
  const policyFile = getArg('--policy-file', '.github/workflows/policy.json');
  const dryRun = getArg('--dry-run', process.env.DRY_RUN ?? 'false') === 'true';
  const event =
    eventPath && fs.existsSync(eventPath) ? readJson(eventPath) : {};
  const prNumber = resolvePrNumber(eventName, event, explicitPrNumber);

  if (!prNumber) {
    console.log(
      JSON.stringify(
        {
          status: 'skipped',
          reason: 'No pull request context could be resolved.',
          eventName,
        },
        null,
        2,
      ),
    );
    return;
  }

  const config = readConfig(configFile);
  const rawPr = runJson('gh', [
    'pr',
    'view',
    String(prNumber),
    '--json',
    'number,title,url,isDraft,headRefName,headRefOid,baseRefName,author,labels,files,isCrossRepository',
  ]);
  const pr = normalizePr(rawPr);
  const checks = runJson(
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
  const policy = evaluatePolicy(pr, policyFile);
  const workerRuns = collectWorkerRuns(config);
  const decision = makeDecision({
    pr,
    checks,
    policy,
    workerRuns,
    eventName,
    event,
    config,
  });

  const summary = {
    status: dryRun ? 'dry-run' : 'applied',
    pr: pr.number,
    headSha: pr.headSha,
    state: decision.state,
    reason: decision.reason,
    dispatch: decision.dispatch,
    labelsToAdd: decision.labelsToAdd,
    labelsToRemove: decision.labelsToRemove,
    checkStatus: decision.checkStatus,
  };

  if (!dryRun) {
    ensureLabels(config);
    syncLabels(pr.number, decision);
    if (decision.dispatch) {
      dispatchWorker(pr, decision.dispatch);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  getRequiredCheckStatus,
  makeDecision,
  resolvePrNumber,
  summarizeWorkerRuns,
};
