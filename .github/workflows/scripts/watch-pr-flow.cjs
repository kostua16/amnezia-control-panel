#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require('child_process');

const DEFAULT_ORCHESTRATOR_REF = 'main';
const DEFAULT_ORCHESTRATOR_WORKFLOW = 'pr-flow.yml';
const STALE_DRAFT_LABEL = 'flow/draft';
const READY_STATUS_CONTEXT = 'pr-flow/ready';
const KILO_STATUS_CONTEXT = 'pr-flow/kilo-review';
const DEFAULT_KILO_TIMEOUT_MINUTES = 30;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[key] =
      argv[index + 1] && !argv[index + 1].startsWith('--')
        ? argv[++index]
        : 'true';
  }
  return args;
}

function asBoolean(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function normalizeLabels(labels) {
  return (labels ?? []).map((label) =>
    typeof label === 'string' ? label : label.name,
  );
}

function summarizePr(pr) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    reasons: pr.recoveryReasons ?? [],
  };
}

function normalizeStatuses(statuses) {
  if (Array.isArray(statuses)) return statuses;
  return statuses?.statuses ?? [];
}

function hasCurrentReadyStatus(statuses) {
  return normalizeStatuses(statuses).some(
    (status) => status.context === READY_STATUS_CONTEXT,
  );
}

function statusTime(status = {}) {
  const raw = status.created_at ?? status.createdAt ?? '';
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function hasExpiredKiloPendingStatus(
  statuses,
  {
    now = new Date().toISOString(),
    timeoutMinutes = DEFAULT_KILO_TIMEOUT_MINUTES,
  } = {},
) {
  const current = new Date(now);
  return normalizeStatuses(statuses).some((status) => {
    if (status.context !== KILO_STATUS_CONTEXT) return false;
    if (String(status.state ?? '').toLowerCase() !== 'pending') return false;
    const created = statusTime(status);
    if (!created || Number.isNaN(current.getTime())) return false;
    return current - created >= Number(timeoutMinutes) * 60000;
  });
}

function selectStalePrs(
  prs,
  {
    labelName = STALE_DRAFT_LABEL,
    getStatuses = () => [],
    now = new Date().toISOString(),
    kiloTimeoutMinutes = DEFAULT_KILO_TIMEOUT_MINUTES,
  } = {},
) {
  return (prs ?? []).flatMap((pr) => {
    const labels = normalizeLabels(pr.labels);
    const isOpen = !pr.state || pr.state === 'OPEN';
    if (!isOpen || pr.isDraft !== false) return [];

    const recoveryReasons = [];
    if (labels.includes(labelName)) {
      recoveryReasons.push('stale-draft');
    }

    const statuses = pr.headRefOid ? getStatuses(pr) : [];

    if (pr.headRefOid && !hasCurrentReadyStatus(statuses)) {
      recoveryReasons.push('missing-ready-status');
    }

    if (
      pr.headRefOid &&
      hasExpiredKiloPendingStatus(statuses, {
        now,
        timeoutMinutes: kiloTimeoutMinutes,
      })
    ) {
      recoveryReasons.push('expired-kilo-review');
    }

    return recoveryReasons.length > 0 ? [{ ...pr, recoveryReasons }] : [];
  });
}

function selectStaleDraftPrs(prs, labelName = STALE_DRAFT_LABEL) {
  return selectStalePrs(prs, { labelName, getStatuses: () => [] });
}

function run(command, args) {
  return (
    execFileSync(command, args, {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) ?? ''
  ).trim();
}

function runJson(command, args, fallback = []) {
  const output = run(command, args);
  return output ? JSON.parse(output) : fallback;
}

function listOpenPullRequests({ runJsonCommand = runJson } = {}) {
  return runJsonCommand(
    'gh',
    [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '200',
      '--json',
      'number,title,url,state,isDraft,labels,headRefOid',
    ],
    [],
  );
}

function readRepository({ runJsonCommand = runJson } = {}) {
  return runJsonCommand('gh', ['repo', 'view', '--json', 'nameWithOwner'], null)
    ?.nameWithOwner;
}

function createStatusReader({ runJsonCommand = runJson } = {}) {
  let repository = null;
  const unreadableStatuses = [{ context: READY_STATUS_CONTEXT }];

  return (pr) => {
    if (!pr.headRefOid) return [];

    try {
      repository ??= readRepository({ runJsonCommand });
    } catch {
      return unreadableStatuses;
    }

    if (!repository) return unreadableStatuses;

    try {
      return runJsonCommand(
        'gh',
        ['api', `repos/${repository}/commits/${pr.headRefOid}/status`],
        { statuses: [] },
      );
    } catch {
      return unreadableStatuses;
    }
  };
}

function buildDispatchArgs({
  prNumber,
  workflow = DEFAULT_ORCHESTRATOR_WORKFLOW,
  ref = DEFAULT_ORCHESTRATOR_REF,
}) {
  return [
    'workflow',
    'run',
    workflow,
    '--ref',
    ref,
    '-f',
    `pr_number=${prNumber}`,
    '-f',
    'dry_run=false',
  ];
}

function dispatchOrchestrator(pr, { runCommand = run, workflow, ref } = {}) {
  runCommand('gh', buildDispatchArgs({ prNumber: pr.number, workflow, ref }));
}

function runWatchdog({
  dryRun = false,
  listPullRequests = listOpenPullRequests,
  dispatch = dispatchOrchestrator,
  getStatuses = null,
  runJsonCommand = runJson,
  workflow = DEFAULT_ORCHESTRATOR_WORKFLOW,
  ref = DEFAULT_ORCHESTRATOR_REF,
  now = new Date().toISOString(),
  kiloTimeoutMinutes = DEFAULT_KILO_TIMEOUT_MINUTES,
} = {}) {
  const pullRequests = listPullRequests({ runJsonCommand });
  const readStatuses = getStatuses ?? createStatusReader({ runJsonCommand });
  const selected = selectStalePrs(pullRequests, {
    getStatuses: readStatuses,
    now,
    kiloTimeoutMinutes,
  });
  const dispatched = [];

  if (!dryRun) {
    for (const pr of selected) {
      dispatch(pr, { workflow, ref });
      dispatched.push(summarizePr(pr));
    }
  }

  return {
    status: 'ok',
    dryRun,
    totalOpenPrs: pullRequests.length,
    selected: selected.map(summarizePr),
    dispatched,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = asBoolean(args.dryRun || process.env.DRY_RUN || 'false');
  const workflow = args.workflow || DEFAULT_ORCHESTRATOR_WORKFLOW;
  const ref = args.ref || DEFAULT_ORCHESTRATOR_REF;
  const summary = runWatchdog({ dryRun, workflow, ref });

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  buildDispatchArgs,
  hasExpiredKiloPendingStatus,
  hasCurrentReadyStatus,
  runWatchdog,
  selectStalePrs,
  selectStaleDraftPrs,
};
