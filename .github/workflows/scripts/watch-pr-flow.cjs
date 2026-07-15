#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require('child_process');

const DEFAULT_ORCHESTRATOR_REF = 'main';
const DEFAULT_ORCHESTRATOR_WORKFLOW = 'pr-flow.yml';
const STALE_DRAFT_LABEL = 'flow/draft';
const READY_STATUS_CONTEXT = 'pr-flow/ready';
const KILO_STATUS_CONTEXT = 'pr-flow/kilo-review';
const DEFAULT_KILO_TIMEOUT_MINUTES = 30;
const DEFAULT_READY_PENDING_TIMEOUT_MINUTES = 30;
// 8 pending aggregates on one head ≈ 4h of 30-minute re-pokes with no
// progress — long past anything a lost reactive wake explains.
const DEFAULT_READY_LOOP_THRESHOLD = 8;
const ESCALATION_LABEL = 'pm-escalation';

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

function hasExpiredPendingStatus(
  statuses,
  context,
  { now = new Date().toISOString(), timeoutMinutes } = {},
) {
  const current = new Date(now);
  return normalizeStatuses(statuses).some((status) => {
    if (status.context !== context) return false;
    if (String(status.state ?? '').toLowerCase() !== 'pending') return false;
    const created = statusTime(status);
    if (!created || Number.isNaN(current.getTime())) return false;
    return current - created >= Number(timeoutMinutes) * 60000;
  });
}

function hasExpiredKiloPendingStatus(
  statuses,
  {
    now = new Date().toISOString(),
    timeoutMinutes = DEFAULT_KILO_TIMEOUT_MINUTES,
  } = {},
) {
  return hasExpiredPendingStatus(statuses, KILO_STATUS_CONTEXT, {
    now,
    timeoutMinutes,
  });
}

// A `pr-flow/ready` status stuck in `pending` means the orchestrator's last run
// decided "waiting" and every later reactive wake was lost (e.g. cancelled or
// collapsed before it ran). Re-dispatching is idempotent: if checks are still
// genuinely running, the orchestrator re-decides pending and refreshes the
// status timestamp, restarting this clock.
function hasExpiredReadyPendingStatus(
  statuses,
  {
    now = new Date().toISOString(),
    timeoutMinutes = DEFAULT_READY_PENDING_TIMEOUT_MINUTES,
  } = {},
) {
  return hasExpiredPendingStatus(statuses, READY_STATUS_CONTEXT, {
    now,
    timeoutMinutes,
  });
}

function selectStalePrs(
  prs,
  {
    labelName = STALE_DRAFT_LABEL,
    getStatuses = () => [],
    getStatusHistory = () => [],
    now = new Date().toISOString(),
    kiloTimeoutMinutes = DEFAULT_KILO_TIMEOUT_MINUTES,
    readyPendingTimeoutMinutes = DEFAULT_READY_PENDING_TIMEOUT_MINUTES,
    readyLoopThreshold = DEFAULT_READY_LOOP_THRESHOLD,
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

    if (
      pr.headRefOid &&
      hasExpiredReadyPendingStatus(statuses, {
        now,
        timeoutMinutes: readyPendingTimeoutMinutes,
      })
    ) {
      recoveryReasons.push('stale-ready-pending');

      // Each re-poke rewrites the pending aggregate with a fresh timestamp, so
      // a PR the orchestrator can never advance loops silently forever. A long
      // trail of pending pr-flow/ready statuses on the same head is the
      // fingerprint of that loop — surface it for escalation instead of only
      // poking again.
      const history = getStatusHistory(pr);
      const pendingReadyCount = (history ?? []).filter(
        (status) =>
          status.context === READY_STATUS_CONTEXT &&
          String(status.state ?? '').toLowerCase() === 'pending',
      ).length;
      if (pendingReadyCount >= readyLoopThreshold) {
        recoveryReasons.push('ready-pending-loop');
      }
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

// Full per-context status history for a head (the /status endpoint above
// dedupes to the latest entry per context). Failures degrade to an empty
// history: loop detection is best-effort and must never block recovery pokes.
function createStatusHistoryReader({ runJsonCommand = runJson } = {}) {
  let repository = null;

  return (pr) => {
    if (!pr.headRefOid) return [];

    try {
      repository ??= readRepository({ runJsonCommand });
      if (!repository) return [];
      return runJsonCommand(
        'gh',
        [
          'api',
          `repos/${repository}/commits/${pr.headRefOid}/statuses?per_page=100`,
        ],
        [],
      );
    } catch {
      return [];
    }
  };
}

function addEscalationLabel(pr, { runCommand = run } = {}) {
  try {
    runCommand('gh', [
      'pr',
      'edit',
      String(pr.number),
      '--add-label',
      ESCALATION_LABEL,
    ]);
    return true;
  } catch {
    return false;
  }
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
  getStatusHistory = null,
  escalate = addEscalationLabel,
  runJsonCommand = runJson,
  workflow = DEFAULT_ORCHESTRATOR_WORKFLOW,
  ref = DEFAULT_ORCHESTRATOR_REF,
  now = new Date().toISOString(),
  kiloTimeoutMinutes = DEFAULT_KILO_TIMEOUT_MINUTES,
  readyPendingTimeoutMinutes = DEFAULT_READY_PENDING_TIMEOUT_MINUTES,
  readyLoopThreshold = DEFAULT_READY_LOOP_THRESHOLD,
} = {}) {
  const pullRequests = listPullRequests({ runJsonCommand });
  const readStatuses = getStatuses ?? createStatusReader({ runJsonCommand });
  const readStatusHistory =
    getStatusHistory ?? createStatusHistoryReader({ runJsonCommand });
  const selected = selectStalePrs(pullRequests, {
    getStatuses: readStatuses,
    getStatusHistory: readStatusHistory,
    now,
    kiloTimeoutMinutes,
    readyPendingTimeoutMinutes,
    readyLoopThreshold,
  });
  const dispatched = [];
  const escalated = [];
  const escalationFailures = [];

  if (!dryRun) {
    for (const pr of selected) {
      dispatch(pr, { workflow, ref });
      dispatched.push(summarizePr(pr));
      if (!pr.recoveryReasons.includes('ready-pending-loop')) continue;
      if (escalate(pr) !== false) {
        escalated.push(summarizePr(pr));
      } else {
        // Adding pm-escalation failed (e.g. the label is missing). Record it
        // so the PR is not silently dropped from the summary looking handled
        // while nothing human-visible was actually posted.
        escalationFailures.push(summarizePr(pr));
      }
    }
  }

  return {
    status: 'ok',
    dryRun,
    totalOpenPrs: pullRequests.length,
    selected: selected.map(summarizePr),
    dispatched,
    escalated,
    escalationFailures,
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
  hasExpiredReadyPendingStatus,
  hasCurrentReadyStatus,
  runWatchdog,
  selectStalePrs,
  selectStaleDraftPrs,
};
