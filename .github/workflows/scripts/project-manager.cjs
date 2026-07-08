#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATE_MARKER = '<!-- project-manager-pr-state -->';
const ISSUE_MARKER = '<!-- project-manager-workflow-issue -->';
const CLAUDE_ESCALATION_MARKER = '<!-- project-manager-claude-escalation -->';
const REBASE_SUMMARY_MARKER = '<!-- rebase-pr-summary -->';
const FIX_REVIEW_SUMMARY_MARKER = '<!-- fix-review-summary -->';
const DEFAULT_NOW = '2026-01-01T00:00:00.000Z';
const CANCELLED_ESCALATION_THRESHOLD = 2;
const ACTIVE_RUN_STATUSES = new Set([
  'queued',
  'in_progress',
  'pending',
  'waiting',
  'requested',
]);
const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
]);

const REPAIR_WORKFLOWS = [
  { workflow: 'fix-pr.yml', key: 'fixPr' },
  { workflow: 'fix-issue.yml', key: 'fixIssue' },
  { workflow: 'fix-review.yml', key: 'fixReview', summary: 'fixReview' },
  { workflow: 'rebase-pr.yml', key: 'rebasePr', summary: 'rebase' },
  { workflow: '_auto-fix-ci.yml', key: 'autoFixCi' },
  { workflow: 'pr-finalizer.yml', key: 'finalizer' },
];

const WORKFLOW_RUN_COLLECTION_WORKFLOWS = [
  'project-manager.yml',
  'fix-pr.yml',
  'fix-issue.yml',
  'fix-review.yml',
  'rebase-pr.yml',
  '_auto-fix-ci.yml',
  'pr-finalizer.yml',
];

const WORKFLOW_NAME_ALIASES = new Map([
  ['project manager', 'project-manager.yml'],
  ['fix pr', 'fix-pr.yml'],
  ['fix issue', 'fix-issue.yml'],
  ['fix review', 'fix-review.yml'],
  ['rebase pr', 'rebase-pr.yml'],
  ['auto fix ci', '_auto-fix-ci.yml'],
  ['auto-fix ci', '_auto-fix-ci.yml'],
  ['pr finalizer', 'pr-finalizer.yml'],
]);

const PR_PRODUCER_REGISTRY = [
  {
    workflow: 'audit-auto-prs.yml',
    category: 'proactive',
    dispatchRef: 'main',
    inputs: {},
    cooldownHours: 6,
    dedupe: { titlePrefix: 'ci(workflows): audit automation-created PRs' },
  },
  {
    workflow: 'audit-fix.yml',
    category: 'proactive',
    dispatchRef: 'main',
    inputs: { lane: 'auto' },
    cooldownHours: 12,
    dedupe: { titlePrefix: 'fix(audit):' },
  },
  {
    workflow: 'docs-drift.yml',
    category: 'proactive',
    dispatchRef: 'main',
    inputs: {},
    cooldownHours: 24,
    dedupe: { titlePrefix: 'docs: reconcile documentation drift' },
  },
  {
    workflow: 'gsd-planning-execute.yml',
    category: 'proactive',
    dispatchRef: 'main',
    inputs: { dry_run: 'false', max_plans: '1' },
    cooldownHours: 6,
    dedupe: { titlePrefix: 'feat(gsd): execute planning intake' },
  },
  {
    workflow: 'monitor-amnezia-control-panel-github-runs.yml',
    category: 'proactive',
    dispatchRef: 'main',
    inputs: {},
    cooldownHours: 4,
    dedupe: { titlePrefix: 'fix(ci): monitored GitHub run finding - ' },
  },
  {
    workflow: 'suggest-improvements.yml',
    category: 'proactive',
    dispatchRef: 'main',
    inputs: {},
    cooldownHours: 24,
    dedupe: { titlePrefix: 'planning: repo-wide improvement follow-ups' },
  },
  {
    workflow: 'workflow-health-optimize.yml',
    category: 'proactive',
    dispatchRef: 'main',
    inputs: {},
    cooldownHours: 4,
    dedupe: { titlePrefix: 'ci(workflows): hourly optimization - ' },
  },
  {
    workflow: 'gsd-planning.yml',
    category: 'conditional-proactive',
    dispatchRef: 'main',
    inputsFrom: 'phase_candidate',
    cooldownHours: 24,
    dedupe: { titlePrefix: 'planning: refresh GSD phase ' },
  },
  {
    workflow: 'fix-issue.yml',
    category: 'contextual',
    reason: 'Requires a standalone issue /fix trigger.',
  },
  {
    workflow: 'fix-pr.yml',
    category: 'contextual',
    reason: 'Requires a failed PR check or trusted PR /fix trigger.',
  },
  {
    workflow: 'fix-branch.yml',
    category: 'contextual',
    reason: 'Requires failed CI on main/develop without an associated PR.',
  },
  {
    workflow: '_auto-fix-ci.yml',
    category: 'contextual',
    reason: 'Reusable workflow called by fix-pr/fix-branch only.',
  },
  {
    workflow: 'fix-review.yml',
    category: 'contextual',
    reason: 'Requires PR review blockers or trusted /fix-review.',
  },
  {
    workflow: 'rebase-pr.yml',
    category: 'contextual',
    reason: 'Requires merge conflict, stale Code Review, or trusted /rebase.',
  },
  {
    workflow: 'pr-finalizer.yml',
    category: 'contextual',
    reason: 'Requires a ready PR.',
  },
  {
    workflow: 'pr-improve.yml',
    category: 'contextual',
    reason: 'PR-flow dispatches it for a specific PR/head.',
  },
];

const INTENTIONAL_PR_PRODUCER_EXCLUSIONS = [
  {
    workflow: 'audit-fix.yml',
    reason: 'Covered as proactive only for lane=auto.',
  },
];

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function toBoolean(value) {
  return String(value ?? '').toLowerCase() === 'true';
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readJson(filePath, fallback = null) {
  if (!filePath) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeLabels(labels) {
  return unique(
    (labels ?? []).map((label) => {
      if (typeof label === 'string') return label;
      return label.name;
    }),
  );
}

function labelObjects(labels) {
  return (labels ?? []).map((label) =>
    typeof label === 'string' ? { name: label } : label,
  );
}

function hasLabel(pr, name) {
  return normalizeLabels(pr.labels).includes(name);
}

function authorAssociation(value) {
  return (
    value?.author_association ??
    value?.authorAssociation ??
    value?.author?.association ??
    ''
  );
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursBetween(start, end) {
  const left = parseDate(start);
  const right = parseDate(end);
  if (!left || !right) return 0;
  return (right.getTime() - left.getTime()) / (60 * 60 * 1000);
}

function isOlderThan(value, now, hours) {
  return hoursBetween(value, now) >= hours;
}

function sortNewest(items) {
  return [...(items ?? [])].sort((a, b) =>
    String(
      b.updatedAt ?? b.updated_at ?? b.createdAt ?? b.created_at ?? '',
    ).localeCompare(
      String(a.updatedAt ?? a.updated_at ?? a.createdAt ?? a.created_at ?? ''),
    ),
  );
}

function normalizeState(pr) {
  const raw = pr.projectManagerState ?? pr.managerState ?? {};
  const headSha = pr.headRefOid ?? pr.headSha ?? '';
  if (raw.headSha && raw.headSha !== headSha) {
    return {
      headSha,
      readySince: '',
      lastAction: '',
      lastActionAt: '',
      directMergeReview: 'not-run',
      directMergeReviewAt: '',
      cooldowns: {},
      workflowIssueNumber: raw.workflowIssueNumber,
      workflowIssueUrl: raw.workflowIssueUrl,
      blockedSince: '',
      blockedEscalatedAt: '',
      depsReviewRedispatchedAt: '',
      duplicateFlaggedAt: '',
    };
  }

  return {
    headSha,
    readySince: raw.readySince ?? raw.ready_since ?? '',
    lastAction: raw.lastAction ?? raw.last_action ?? '',
    lastActionAt: raw.lastActionAt ?? raw.last_action_at ?? '',
    directMergeReview:
      raw.directMergeReview ?? raw.direct_merge_review ?? 'not-run',
    directMergeReviewAt:
      raw.directMergeReviewAt ?? raw.direct_merge_review_at ?? '',
    cooldowns: raw.cooldowns ?? {},
    workflowIssueNumber: raw.workflowIssueNumber ?? raw.workflow_issue_number,
    workflowIssueUrl: raw.workflowIssueUrl ?? raw.workflow_issue_url,
    blockedSince: raw.blockedSince ?? raw.blocked_since ?? '',
    blockedEscalatedAt:
      raw.blockedEscalatedAt ?? raw.blocked_escalated_at ?? '',
    depsReviewRedispatchedAt:
      raw.depsReviewRedispatchedAt ?? raw.deps_review_redispatched_at ?? '',
    duplicateFlaggedAt:
      raw.duplicateFlaggedAt ?? raw.duplicate_flagged_at ?? '',
  };
}

function cooldownActive(state, key, now, hours = 1) {
  const at = state.cooldowns?.[key];
  return Boolean(at && hoursBetween(at, now) < hours);
}

function checkStatus(pr) {
  const status = pr.checkStatus ?? pr.requiredCheckStatus ?? {};
  const normalized =
    typeof status === 'string'
      ? { status }
      : { status: status.status ?? 'unknown', ...status };
  if (normalized.status && normalized.status !== 'unknown') return normalized;

  const labelStatus = deriveCheckStatusFromLabels(pr.labels);
  return labelStatus.status !== 'unknown' ? labelStatus : normalized;
}

function statusCheckItems(rollup) {
  if (Array.isArray(rollup)) return rollup;
  if (Array.isArray(rollup?.nodes)) return rollup.nodes;
  if (Array.isArray(rollup?.contexts)) return rollup.contexts;
  return [];
}

function deriveCheckStatusFromRollup(rollup) {
  const items = statusCheckItems(rollup);
  if (items.length === 0) return { status: 'unknown' };

  const normalized = items.map((item) => {
    const state = String(item.state ?? item.status ?? '').toUpperCase();
    const conclusion = String(item.conclusion ?? '').toUpperCase();
    return {
      name:
        item.name ??
        item.context ??
        item.workflowName ??
        item.checkSuite?.workflowRun?.workflow?.name ??
        '',
      state,
      conclusion,
    };
  });

  const failed = normalized.filter(
    (item) =>
      ['FAILURE', 'ERROR'].includes(item.state) ||
      ['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'CANCELLED'].includes(
        item.conclusion,
      ),
  );
  if (failed.length > 0) {
    return {
      status: 'failed',
      failed: failed.map((item) => item.name).filter(Boolean),
    };
  }

  const pending = normalized.some(
    (item) =>
      ['PENDING', 'QUEUED', 'IN_PROGRESS', 'REQUESTED', 'WAITING'].includes(
        item.state,
      ) ||
      (item.state && item.state !== 'SUCCESS' && item.state !== 'COMPLETED') ||
      (item.conclusion === '' && item.state !== 'SUCCESS'),
  );
  if (pending) return { status: 'pending' };

  return { status: 'passed' };
}

function deriveCheckStatusFromLabels(labels) {
  const names = normalizeLabels(labels);
  if (names.includes('flow/checks-failed')) {
    return {
      status: 'failed',
      source: 'flow-label',
      failed: ['flow/checks-failed'],
    };
  }
  if (names.includes('flow/checks-pending')) {
    return { status: 'pending', source: 'flow-label' };
  }
  return { status: 'unknown' };
}

function checksPassed(pr) {
  return checkStatus(pr).status === 'passed';
}

function checksFailed(pr) {
  return checkStatus(pr).status === 'failed';
}

function reviewSignalsPassed(pr) {
  if (pr.reviewSignalsPassed === true) return true;
  if (pr.policy?.dependabot) return hasLabel(pr, 'deps-review-passed');
  return (
    hasLabel(pr, 'ai-review-passed') && hasLabel(pr, 'security-review-passed')
  );
}

function hasReviewBlocker(pr) {
  const blockerLabels = [
    'ai-review-concerns',
    'security-review-concerns',
    'deps-review-manual',
    'deps-review-blocked',
    'antigravity-review-concerns',
  ];
  return (
    blockerLabels.some((label) => hasLabel(pr, label)) ||
    pr.externalReview?.state === 'blocked' ||
    (pr.reviewBlockers ?? []).length > 0
  );
}

function needsProjectManagerAttention(pr) {
  const labels = normalizeLabels(pr.labels);
  return [
    'flow/finalizer-dispatched',
    'flow/manual-only',
    'flow/checks-failed',
    'flow/checks-pending',
    'ai-review-concerns',
    'security-review-concerns',
    'deps-review-manual',
    'deps-review-blocked',
    'antigravity-review-concerns',
  ].some((label) => labels.includes(label));
}

function selectPrInspectionCandidates(prs, limit) {
  const sorted = sortNewest(prs);
  const byNumber = new Map();
  for (const pr of sorted.slice(0, Number(limit ?? 10))) {
    byNumber.set(pr.number, pr);
  }
  for (const pr of sorted) {
    if (needsProjectManagerAttention(pr)) byNumber.set(pr.number, pr);
  }
  return [...byNumber.values()];
}

function isManualOnly(pr) {
  return (
    pr.manualOnly === true ||
    hasLabel(pr, 'flow/manual-only') ||
    pr.finalizer?.decision === 'manual_only'
  );
}

function hasMaintainerApproval(pr) {
  if (hasLabel(pr, 'maintainer-approved')) return true;
  return (pr.reviews ?? []).some(
    (review) =>
      String(review.state ?? '').toUpperCase() === 'APPROVED' &&
      ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(authorAssociation(review)),
  );
}

function labelUpdatedAfter(pr, labelName, timestamp) {
  const since = parseDate(timestamp);
  if (!since) return false;
  return labelObjects(pr.labels).some((label) => {
    if (label.name !== labelName) return false;
    const updatedAt = parseDate(label.updatedAt ?? label.updated_at);
    // gh pr view --json labels omits label timestamps, so an undated label is
    // treated as active: needs-review must keep blocking direct merge in prod.
    return updatedAt ? updatedAt > since : true;
  });
}

function hasMaintainerRejection(pr, readySince = '') {
  if (hasLabel(pr, 'do-not-merge')) return true;
  if (hasLabel(pr, 'needs-review')) {
    if (!readySince || labelUpdatedAfter(pr, 'needs-review', readySince)) {
      return true;
    }
  }

  const reviewRejected = (pr.reviews ?? []).some(
    (review) =>
      String(review.state ?? '').toUpperCase() === 'CHANGES_REQUESTED' &&
      (!review.commit_id ||
        review.commit_id === (pr.headRefOid ?? pr.headSha ?? '') ||
        review.commitId === (pr.headRefOid ?? pr.headSha ?? '')) &&
      ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(authorAssociation(review)),
  );
  if (reviewRejected) return true;

  return (pr.comments ?? []).some(
    (comment) =>
      String(comment.body ?? '').includes('project-manager: hold') &&
      ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(authorAssociation(comment)),
  );
}

function activeRun(pr, key) {
  return Boolean(pr.runs?.[key]?.active || pr[key]?.active);
}

function normalizeConclusion(value) {
  return String(value ?? '').toLowerCase();
}

function repairRunFailure(run) {
  if (run?.active) return null;
  const latest = run?.latest;
  if (!latest || latest.noop === true) return null;
  const outcome = normalizeConclusion(latest.outcome);
  const conclusion = normalizeConclusion(latest.conclusion);
  if (
    [
      'failed',
      'validation_failed_not_pushed',
      'push_rejected',
      'ancestry_failed',
    ].includes(outcome)
  ) {
    return latest.failureSummary ?? latest.outcome;
  }
  if (FAILURE_CONCLUSIONS.has(conclusion)) {
    return latest.failureSummary ?? latest.conclusion;
  }
  if (
    conclusion === 'cancelled' &&
    Number(run.cancelledCount ?? 0) >= CANCELLED_ESCALATION_THRESHOLD &&
    !run.active
  ) {
    return (
      latest.failureSummary ??
      `repair workflow cancelled ${run.cancelledCount} times for this head`
    );
  }
  return null;
}

function failedRepairRun(pr) {
  const candidates = [
    ['fix-pr.yml', pr.runs?.fixPr],
    ['fix-issue.yml', pr.runs?.fixIssue],
    ['fix-review.yml', pr.runs?.fixReview],
    ['rebase-pr.yml', pr.runs?.rebasePr],
    ['_auto-fix-ci.yml', pr.runs?.autoFixCi],
  ];

  for (const [workflow, run] of candidates) {
    const failureSummary = repairRunFailure(run);
    if (failureSummary) return { workflow, ...run.latest, failureSummary };
  }

  return null;
}

function failureFingerprint(run) {
  return String(
    run?.fingerprint ??
      run?.databaseId ??
      run?.id ??
      run?.url ??
      [
        run?.workflow,
        run?.headSha,
        run?.outcome,
        run?.failureSummary,
        run?.conclusion,
      ]
        .filter(Boolean)
        .join(':'),
  )
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escalationExists(pr, run) {
  if (!run) return false;
  const runId = String(run.databaseId ?? run.id ?? run.url ?? '');
  const workflow = String(run.workflow ?? '').toLowerCase();
  const headSha = String(
    run.headSha ?? pr.headRefOid ?? pr.headSha ?? '',
  ).toLowerCase();
  const fingerprint = failureFingerprint(run);
  return (pr.comments ?? []).some((comment) => {
    const body = String(comment.body ?? '');
    const lower = body.toLowerCase();
    if (!body.includes(CLAUDE_ESCALATION_MARKER)) return false;
    if (runId && body.includes(runId)) return true;
    return (
      (!workflow || lower.includes(workflow)) &&
      (!headSha || lower.includes(headSha)) &&
      (!fingerprint || lower.includes(fingerprint))
    );
  });
}

function latestRebaseNoop(pr) {
  const latest = pr.rebase?.latest ?? pr.runs?.rebasePr?.latest ?? null;
  const body = String(latest?.body ?? pr.latestRebaseSummary ?? '');
  return (
    latest?.noop === true ||
    latest?.rebaseMovedHead === false ||
    latest?.rebase_moved_head === false ||
    body.includes('Pushed: no (no changes after rebase)')
  );
}

function staleCodeReviewNeedsRebase(pr, now) {
  const committedAt =
    pr.headCommittedAt ?? pr.head?.committedDate ?? pr.updatedAt ?? '';
  const stale =
    pr.codeReview?.stale === true ||
    pr.codeReviewStale === true ||
    (pr.codeReview?.latest?.headSha &&
      pr.codeReview.latest.headSha !== (pr.headRefOid ?? pr.headSha));
  return (
    stale &&
    isOlderThan(committedAt, now, 5) &&
    !checksFailed(pr) &&
    !latestRebaseNoop(pr) &&
    !activeRun(pr, 'rebasePr')
  );
}

function recentCommandCommentExists(pr, command, now, hours = 1) {
  return (pr.comments ?? []).some((comment) => {
    if (String(comment.body ?? '').trim() !== command) return false;
    const association = authorAssociation(comment);
    const authorType = comment.author?.type ?? comment.user?.type ?? '';
    const trusted =
      !authorType ||
      authorType !== 'Bot' ||
      ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association);
    if (!trusted) return false;
    const createdAt = comment.createdAt ?? comment.created_at ?? '';
    if (!parseDate(createdAt)) return false;
    return hoursBetween(createdAt, now) < hours;
  });
}

function isOpenPr(pr) {
  return (
    String(pr.state ?? 'OPEN').toUpperCase() === 'OPEN' &&
    !pr.mergedAt &&
    !pr.merged_at
  );
}

function readySinceFor(pr, state, now) {
  if (checksPassed(pr) && reviewSignalsPassed(pr)) {
    return state.readySince || now;
  }
  return state.readySince || '';
}

function isReady(pr) {
  return checksPassed(pr) && reviewSignalsPassed(pr);
}

function finalizerAlreadyDispatched(pr, state) {
  return (
    hasLabel(pr, 'flow/finalizer-dispatched') ||
    state.lastAction === 'finalizer' ||
    Boolean(pr.finalizer?.dispatched)
  );
}

function makeCommentAction(pr, body, actionKey) {
  return {
    type: 'comment',
    target: 'pr',
    number: pr.number,
    body,
    actionKey,
    headSha: pr.headRefOid ?? pr.headSha ?? '',
  };
}

function shortHeadSha(pr) {
  return String(pr.headRefOid ?? pr.headSha ?? '').slice(0, 12) || 'unknown';
}

function buildRepairWorkflowIssue(pr, failedRun) {
  const workflow = failedRun.workflow ?? 'repair workflow';
  const headSha = pr.headRefOid ?? pr.headSha ?? '';
  return {
    title: `[project-manager] PR #${pr.number} ${workflow} failed for ${shortHeadSha(pr)}`,
    body: [
      ISSUE_MARKER,
      '',
      `Project-manager detected a failed downstream repair workflow for PR #${pr.number}.`,
      '',
      `PR: ${pr.url ?? ''}`,
      `Head SHA: ${headSha}`,
      `Workflow: ${workflow}`,
      `Run: ${failedRun.url ?? failedRun.databaseId ?? failedRun.id ?? '_n/a_'}`,
      `Observed failure: ${failedRun.failureSummary ?? failedRun.conclusion ?? failedRun.outcome ?? 'workflow failed'}`,
      `Failure fingerprint: ${failureFingerprint(failedRun)}`,
      '',
      'Project-manager will not repeat the same command loop until this workflow failure is repaired.',
    ].join('\n'),
  };
}

function makeStatePatch(pr, state, actionKey, now, extra = {}) {
  return {
    type: 'upsert-pr-state',
    number: pr.number,
    headSha: pr.headRefOid ?? pr.headSha ?? '',
    state: {
      ...state,
      readySince: extra.readySince ?? state.readySince,
      lastAction: actionKey,
      lastActionAt: now,
      directMergeReview:
        extra.directMergeReview ?? state.directMergeReview ?? 'not-run',
      directMergeReviewAt:
        extra.directMergeReviewAt ?? state.directMergeReviewAt ?? '',
      workflowIssueNumber:
        extra.workflowIssueNumber ?? state.workflowIssueNumber ?? '',
      workflowIssueUrl: extra.workflowIssueUrl ?? state.workflowIssueUrl ?? '',
      blockedSince: extra.blockedSince ?? state.blockedSince ?? '',
      blockedEscalatedAt:
        extra.blockedEscalatedAt ?? state.blockedEscalatedAt ?? '',
      depsReviewRedispatchedAt:
        extra.depsReviewRedispatchedAt ?? state.depsReviewRedispatchedAt ?? '',
      duplicateFlaggedAt:
        extra.duplicateFlaggedAt ?? state.duplicateFlaggedAt ?? '',
      cooldowns: {
        ...(state.cooldowns ?? {}),
        [actionKey]: now,
      },
    },
  };
}

function buildWorkflowIssue(pr, readySince) {
  return {
    title: `[project-manager] PR #${pr.number} ready but not merged`,
    body: [
      ISSUE_MARKER,
      '',
      `PR #${pr.number} was ready for merge for more than 1 hour but PR-flow/finalizer did not merge it.`,
      '',
      `PR: ${pr.url ?? ''}`,
      `Head SHA: ${pr.headRefOid ?? pr.headSha ?? ''}`,
      `Ready since: ${readySince}`,
      'Required checks: passed',
      'Review signals: passed',
      `Finalizer state: ${pr.finalizer?.state ?? pr.runs?.finalizer?.latest?.conclusion ?? 'unknown'}`,
      `PR-flow state: ${normalizeLabels(pr.labels).find((label) => label.startsWith('flow/')) ?? 'unknown'}`,
      '',
      'Project-manager will attempt a direct merge after its review if safe.',
    ].join('\n'),
  };
}

function directMergeReviewDecision(pr, state) {
  // Live review (injected from the workflow run) wins; otherwise consult the
  // persisted sticky-state decision so prior review verdicts are honored
  // across runs instead of being write-only.
  const review = pr.projectManagerReview ?? state?.directMergeReview;
  if (!review) return { decision: 'not-run' };
  if (typeof review === 'string') return { decision: review };
  return review;
}

function stalledReadyAction(pr, state, readySince, now) {
  if (!readySince || hoursBetween(readySince, now) < 1) return null;
  if (pr.autoMergeRequest) return null;
  if (hasMaintainerRejection(pr, readySince)) return null;

  const issue = buildWorkflowIssue(pr, readySince);
  const review = directMergeReviewDecision(pr, state);
  const actions = [
    {
      type: 'create-or-reuse-issue',
      title: issue.title,
      body: issue.body,
      labels: ['auto-fix', 'ci-failure'],
      actionKey: 'workflow-issue',
      pr: pr.number,
      headSha: pr.headRefOid ?? pr.headSha ?? '',
    },
    {
      type: 'comment',
      target: 'issue',
      issueSelector: { title: issue.title },
      body: '/fix',
      actionKey: 'workflow-issue-fix',
    },
  ];

  if (review.decision === 'merge') {
    actions.push({
      type: 'merge-pr',
      number: pr.number,
      method: 'squash',
      actionKey: 'direct-merge',
    });
  } else {
    actions.push({
      type: 'direct-merge-review-required',
      number: pr.number,
      actionKey: 'direct-merge-review',
      prompt:
        'Run kos-project-manager read-only PR review before direct merge.',
    });
  }

  actions.push(
    makeStatePatch(pr, state, 'direct-merge', now, {
      readySince,
      directMergeReview: review.decision ?? 'not-run',
      directMergeReviewAt: review.decision ? now : '',
    }),
  );

  return {
    type: 'compound',
    actionKey: 'direct-merge',
    number: pr.number,
    actions,
  };
}

function manualOnlyAction(pr, state, readySince, now) {
  if (!isManualOnly(pr) || !isReady(pr)) return null;
  if (hasMaintainerRejection(pr, readySince)) return null;

  const approved = hasMaintainerApproval(pr);
  const agedOut = readySince && hoursBetween(readySince, now) >= 8;
  if (!approved && !agedOut) return null;

  const review = directMergeReviewDecision(pr, state);
  if (review.decision !== 'merge') {
    return {
      type: 'direct-merge-review-required',
      number: pr.number,
      actionKey: 'manual-direct-merge-review',
      prompt:
        'Run kos-project-manager read-only PR review before manual-only direct merge.',
      statePatch: makeStatePatch(pr, state, 'direct-merge', now, {
        readySince,
        directMergeReview: review.decision ?? 'not-run',
        directMergeReviewAt: review.decision ? now : '',
      }),
    };
  }

  return {
    type: 'compound',
    actionKey: 'manual-direct-merge',
    number: pr.number,
    actions: [
      makeCommentAction(
        pr,
        [
          'Project-manager review passed for this manual-only PR.',
          '',
          `Decision: ${review.reason ?? 'merge'}`,
        ].join('\n'),
        'direct-merge-comment',
      ),
      {
        type: 'merge-pr',
        number: pr.number,
        method: 'squash',
        actionKey: 'direct-merge',
      },
      makeStatePatch(pr, state, 'direct-merge', now, {
        readySince,
        directMergeReview: 'merge',
        directMergeReviewAt: now,
      }),
    ],
  };
}

const BLOCKED_ESCALATION_HOURS = 72;
const BLOCKED_ESCALATION_LABELS = [
  'needs-review',
  'deps-review-manual',
  'deps-review-blocked',
];
const BLOCKED_ESCALATION_MARKER = '<!-- project-manager-blocked-escalation -->';
const ATTENTION_DIGEST_TITLE =
  '[project-manager] Attention: PRs blocked on maintainer';

function attentionDigestActions(pr, entryBody) {
  return [
    {
      type: 'create-or-reuse-issue',
      title: ATTENTION_DIGEST_TITLE,
      body: [
        ISSUE_MARKER,
        '',
        'PRs waiting on maintainer attention, escalated by project-manager.',
        'One comment is appended per escalated PR; close this issue once the queue is handled.',
      ].join('\n'),
      labels: ['needs-review'],
      actionKey: 'attention-digest',
      pr: pr.number,
      headSha: pr.headRefOid ?? pr.headSha ?? '',
    },
    {
      type: 'comment',
      target: 'issue',
      issueSelector: { title: ATTENTION_DIGEST_TITLE },
      body: entryBody,
      actionKey: 'attention-digest-entry',
    },
  ];
}

function blockedEscalationLabels(pr) {
  // do-not-merge is an explicit human hold; never remind about it.
  if (hasLabel(pr, 'do-not-merge')) return [];
  return BLOCKED_ESCALATION_LABELS.filter((label) => hasLabel(pr, label));
}

function blockedClockPatch(pr, state, readySince, now) {
  if (blockedEscalationLabels(pr).length === 0) return null;
  if (state.blockedSince) return null;
  return makeStatePatch(pr, state, 'blocked-clock', now, {
    readySince,
    blockedSince: now,
  });
}

function blockedEscalationAction(pr, state, now) {
  const blocked = blockedEscalationLabels(pr);
  if (blocked.length === 0) return null;
  if (!state.blockedSince) return null;
  if (hoursBetween(state.blockedSince, now) < BLOCKED_ESCALATION_HOURS) {
    return null;
  }

  // A deps-review-manual verdict can be transient (context-starved run):
  // redispatch dependency review once per head before asking a human.
  if (
    blocked.includes('deps-review-manual') &&
    !state.depsReviewRedispatchedAt
  ) {
    return {
      type: 'compound',
      actionKey: 'deps-review-redispatch',
      reason:
        'deps-review-manual persisted past the escalation window; redispatching dependency review once before escalating.',
      number: pr.number,
      actions: [
        {
          type: 'dispatch-workflow',
          workflow: 'dependency-review.yml',
          ref: pr.baseRefName ?? 'main',
          inputs: {
            pr_number: String(pr.number),
            head_sha: pr.headRefOid ?? pr.headSha ?? '',
            base_ref: pr.baseRefName ?? 'main',
          },
          actionKey: 'deps-review-redispatch',
        },
        makeStatePatch(pr, state, 'deps-review-redispatch', now, {
          depsReviewRedispatchedAt: now,
        }),
      ],
    };
  }

  if (state.blockedEscalatedAt) return null;

  const days = Math.floor(hoursBetween(state.blockedSince, now) / 24);
  return {
    type: 'compound',
    actionKey: 'blocked-escalation',
    reason: `Blocking labels (${blocked.join(', ')}) persisted ${days} day(s) with no maintainer action; escalating once per head.`,
    number: pr.number,
    actions: [
      makeCommentAction(
        pr,
        [
          BLOCKED_ESCALATION_MARKER,
          `This PR has been waiting on a maintainer for ${days} day(s) (labels: ${blocked.join(', ')}).`,
          '',
          'To unblock: approve the PR or remove the blocking label.',
          'Add `do-not-merge` to hold it deliberately and silence this reminder.',
        ].join('\n'),
        'blocked-escalation',
      ),
      ...attentionDigestActions(
        pr,
        `PR #${pr.number} blocked on ${blocked.join(', ')} for ${days} day(s): ${pr.url ?? ''}`,
      ),
      makeStatePatch(pr, state, 'blocked-escalation', now, {
        blockedEscalatedAt: now,
      }),
    ],
  };
}

const AUTOMATION_BRANCH_PREFIXES = [
  'claude-',
  'claude/',
  'codex/',
  'dependabot/',
];

function isAutomationPr(pr) {
  const branch = String(pr.headRefName ?? '');
  return AUTOMATION_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix));
}

function duplicateAutomationPrActions(prs, now) {
  const groups = new Map();
  for (const pr of prs) {
    if (!isOpenPr(pr) || pr.isDraft || !isAutomationPr(pr)) continue;
    const key = String(pr.title ?? '')
      .trim()
      .toLowerCase();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), pr]);
  }

  const actions = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(
      (a, b) =>
        (parseDate(b.createdAt)?.getTime() ?? 0) -
        (parseDate(a.createdAt)?.getTime() ?? 0),
    );
    const canonical = sorted[0];
    for (const dup of sorted.slice(1)) {
      const state = normalizeState(dup);
      if (state.duplicateFlaggedAt) continue;
      actions.push(
        ...attentionDigestActions(
          dup,
          `PR #${dup.number} appears superseded by #${canonical.number} (same automation title): ${dup.url ?? ''}`,
        ),
        makeStatePatch(dup, state, 'duplicate-flag', now, {
          duplicateFlaggedAt: now,
        }),
      );
    }
  }
  return actions;
}

function decidePrAction(pr, options = {}) {
  const now = options.now ?? DEFAULT_NOW;
  if (!isOpenPr(pr)) return null;
  const state = normalizeState(pr);
  const readySince = readySinceFor(pr, state, now);
  const withReadyState =
    readySince !== state.readySince
      ? makeStatePatch(pr, state, 'ready', now, { readySince })
      : null;

  const failedRun = failedRepairRun(pr);
  if (failedRun && !escalationExists(pr, failedRun)) {
    const issue = buildRepairWorkflowIssue(pr, failedRun);
    return {
      type: 'compound',
      actionKey: 'claude-escalation',
      reason: `${failedRun.workflow} failed for the current head; escalating instead of repeating the command loop.`,
      number: pr.number,
      actions: [
        makeCommentAction(
          pr,
          [
            CLAUDE_ESCALATION_MARKER,
            '@claude fix this workflow failure.',
            '',
            `Target: PR #${pr.number}`,
            `Head SHA: ${pr.headRefOid ?? pr.headSha ?? ''}`,
            `Workflow: ${failedRun.workflow}`,
            `Run: ${failedRun.url ?? failedRun.databaseId ?? failedRun.id ?? ''}`,
            `Observed failure: ${failedRun.failureSummary ?? failedRun.conclusion ?? 'workflow failed'}`,
            `Failure fingerprint: ${failureFingerprint(failedRun)}`,
            '',
            'Please diagnose the root cause and implement the narrowest workflow/code fix.',
          ].join('\n'),
          'claude-escalation',
        ),
        {
          type: 'create-or-reuse-issue',
          title: issue.title,
          body: issue.body,
          labels: ['auto-fix', 'ci-failure'],
          actionKey: 'workflow-issue',
          pr: pr.number,
          headSha: pr.headRefOid ?? pr.headSha ?? '',
        },
        {
          type: 'comment',
          target: 'issue',
          issueSelector: { title: issue.title },
          body: '/fix',
          actionKey: 'workflow-issue-fix',
        },
        makeStatePatch(pr, state, 'claude-escalation', now, { readySince }),
      ],
    };
  }

  if (
    (pr.mergeable === 'CONFLICTING' || pr.conflict === true) &&
    !activeRun(pr, 'rebasePr') &&
    !cooldownActive(state, 'rebase', now) &&
    !recentCommandCommentExists(pr, '/rebase', now)
  ) {
    return {
      type: 'compound',
      actionKey: 'rebase',
      reason: 'PR is conflicting and no same-head rebase repair is active.',
      number: pr.number,
      actions: [
        makeCommentAction(pr, '/rebase', 'rebase'),
        makeStatePatch(pr, state, 'rebase', now, { readySince }),
      ],
    };
  }

  if (
    staleCodeReviewNeedsRebase(pr, now) &&
    !cooldownActive(state, 'rebase', now) &&
    !recentCommandCommentExists(pr, '/rebase', now)
  ) {
    return {
      type: 'compound',
      actionKey: 'rebase',
      reason:
        'Current-head Code Review is stale and the latest rebase was not a no-op.',
      number: pr.number,
      actions: [
        makeCommentAction(pr, '/rebase', 'rebase'),
        makeStatePatch(pr, state, 'rebase', now, { readySince }),
      ],
    };
  }

  if (
    checksFailed(pr) &&
    !activeRun(pr, 'fixPr') &&
    !activeRun(pr, 'autoFixCi') &&
    !cooldownActive(state, 'fix', now) &&
    !recentCommandCommentExists(pr, '/fix', now)
  ) {
    return {
      type: 'compound',
      actionKey: 'fix',
      reason: 'Required checks are failed and no PR fix run is active.',
      number: pr.number,
      actions: [
        makeCommentAction(pr, '/fix', 'fix'),
        makeStatePatch(pr, state, 'fix', now, { readySince }),
      ],
    };
  }

  // Due blocked-PR escalation runs before /fix-review so a PR stuck on
  // deps-review-manual/-blocked stops re-triggering futile review repairs.
  const blockedEscalation = blockedEscalationAction(pr, state, now);
  if (blockedEscalation) return blockedEscalation;

  if (
    hasReviewBlocker(pr) &&
    !checksFailed(pr) &&
    !activeRun(pr, 'fixReview') &&
    !cooldownActive(state, 'fix-review', now) &&
    !recentCommandCommentExists(pr, '/fix-review', now)
  ) {
    return {
      type: 'compound',
      actionKey: 'fix-review',
      reason:
        'Review blockers are present and no same-head fix-review run is active.',
      number: pr.number,
      actions: [
        makeCommentAction(pr, '/fix-review', 'fix-review'),
        makeStatePatch(pr, state, 'fix-review', now, { readySince }),
      ],
    };
  }

  if (
    isReady(pr) &&
    !isManualOnly(pr) &&
    !finalizerAlreadyDispatched(pr, state) &&
    !activeRun(pr, 'finalizer') &&
    !cooldownActive(state, 'finalizer', now)
  ) {
    return {
      type: 'compound',
      actionKey: 'finalizer',
      reason:
        'Required checks and review signals passed; finalizer remains the preferred merge path.',
      number: pr.number,
      actions: [
        {
          type: 'dispatch-workflow',
          workflow: 'pr-finalizer.yml',
          ref: pr.baseRefName ?? 'main',
          inputs: {
            pr_number: String(pr.number),
            head_sha: pr.headRefOid ?? pr.headSha ?? '',
            base_ref: pr.baseRefName ?? 'main',
            orchestrated: 'true',
            dry_run: 'false',
          },
          actionKey: 'finalizer',
        },
        makeStatePatch(pr, state, 'finalizer', now, { readySince }),
      ],
    };
  }

  if (
    isReady(pr) &&
    !isManualOnly(pr) &&
    !cooldownActive(state, 'direct-merge', now)
  ) {
    const stalled = stalledReadyAction(pr, state, readySince, now);
    if (stalled) return stalled;
  }

  const manual = manualOnlyAction(pr, state, readySince, now);
  if (manual) return manual;

  const blockedClock = blockedClockPatch(pr, state, readySince, now);
  if (blockedClock) return blockedClock;

  return withReadyState;
}

function selectRoute(snapshot, options = {}) {
  const override = options.route ?? options.routeOverride ?? 'auto';
  const prThreshold = Number(options.prThreshold ?? 5);
  const issueThreshold = Number(options.issueThreshold ?? 5);
  const openPrCount =
    snapshot.openPrCount ?? (snapshot.openPullRequests ?? []).length;
  const openIssueCount =
    snapshot.openIssueCount ?? (snapshot.openIssues ?? []).length;

  if (override && override !== 'auto') return override;
  if (openPrCount > prThreshold) return 'prs';
  if (openIssueCount > issueThreshold) return 'issues';
  return 'low-load';
}

function noActionReason(pr, decision, state, now) {
  if (decision?.reason) return decision.reason;
  if (!isOpenPr(pr)) return 'PR is closed or already merged.';
  if (pr.isDraft) return 'PR is draft.';
  if (activeRun(pr, 'rebasePr')) return 'A rebase run is already active.';
  if (activeRun(pr, 'fixReview')) return 'A fix-review run is already active.';
  if (activeRun(pr, 'fixPr') || activeRun(pr, 'autoFixCi')) {
    return 'A fix run is already active.';
  }
  if (checksFailed(pr) && cooldownActive(state, 'fix', now)) {
    return 'Checks are failed, but /fix is inside cooldown.';
  }
  if (hasReviewBlocker(pr) && cooldownActive(state, 'fix-review', now)) {
    return 'Review blockers exist, but /fix-review is inside cooldown.';
  }
  if (
    staleCodeReviewNeedsRebase(pr, now) &&
    cooldownActive(state, 'rebase', now)
  ) {
    return 'Stale Code Review needs rebase, but /rebase is inside cooldown.';
  }
  if (isReady(pr) && isManualOnly(pr)) {
    return 'PR is ready but manual-only direct merge is not eligible yet.';
  }
  if (isReady(pr))
    return 'PR is ready but finalizer/direct-merge conditions did not match.';
  if (withReviewOrCheckPending(pr))
    return 'PR is waiting for checks or review signals.';
  return 'No project-manager action matched this PR state.';
}

function withReviewOrCheckPending(pr) {
  return (
    checkStatus(pr).status === 'pending' ||
    checkStatus(pr).status === 'unknown' ||
    !reviewSignalsPassed(pr)
  );
}

function flattenAction(action) {
  if (!action) return [];
  if (action.type === 'compound') return action.actions.flatMap(flattenAction);
  if (action.statePatch) return [action, action.statePatch];
  return [action];
}

function planPrRoute(snapshot, options = {}) {
  const now = options.now ?? snapshot.now ?? DEFAULT_NOW;
  const prs = selectPrInspectionCandidates(
    snapshot.openPullRequests,
    options.prLimit,
  );
  const decisions = [];
  const actions = [];

  for (const pr of prs) {
    const decision = decidePrAction(pr, { ...options, now });
    const state = normalizeState(pr);
    decisions.push({
      pr: pr.number,
      action: decision?.actionKey ?? decision?.type ?? 'none',
      reason: noActionReason(pr, decision, state, now),
    });
    actions.push(...flattenAction(decision));
  }

  actions.push(...duplicateAutomationPrActions(prs, now));

  return {
    route: 'prs',
    decisions,
    actions,
    summary: buildPrRouteSummary(snapshot, prs, decisions, actions),
  };
}

function issueHasLinkedPr(issue) {
  const text = `${issue.body ?? ''}\n${(issue.comments ?? [])
    .map((comment) => comment.body ?? '')
    .join('\n')}`;
  return /pull\/\d+|Fixes #\d+|PR:\s*#\d+/i.test(text);
}

const MAX_ISSUE_FIX_ATTEMPTS = 3;
const ISSUE_FIX_COOLDOWN_HOURS = 6;

function issueFixAttemptComments(issue) {
  return (issue.comments ?? []).filter((comment) =>
    String(comment.body ?? '').includes('/fix'),
  );
}

function safeIssueForFix(issue, options = {}) {
  const labels = normalizeLabels(issue.labels);
  const terminal = [
    'fixed',
    'duplicate',
    'canceled',
    'keep-open',
    'in-progress',
    'needs-review',
  ];
  if (terminal.some((label) => labels.includes(label))) return false;
  if (issue.pull_request) return false;
  if (issueHasLinkedPr(issue)) return false;
  if (issue.activeFixRun || issue.activeFixBranch) return false;
  const attempts = issueFixAttemptComments(issue);
  const maxAttempts = Number(
    options.maxIssueFixAttempts ?? MAX_ISSUE_FIX_ATTEMPTS,
  );
  if (attempts.length >= maxAttempts) return false;
  const cooldownHours = Number(
    options.issueFixCooldownHours ?? ISSUE_FIX_COOLDOWN_HOURS,
  );
  const now = options.now ?? DEFAULT_NOW;
  return !attempts.some((comment) => {
    const createdAt = comment.createdAt ?? comment.created_at ?? '';
    // Comments without a parseable timestamp count as recent so a retry
    // never fires on unknown-age attempts.
    if (!parseDate(createdAt)) return true;
    return hoursBetween(createdAt, now) < cooldownHours;
  });
}

function planIssueRoute(snapshot, options = {}) {
  const now = options.now ?? snapshot.now ?? DEFAULT_NOW;
  const issues = sortNewest(snapshot.openIssues)
    .filter((issue) => safeIssueForFix(issue, { ...options, now }))
    .slice(0, Number(options.issueLimit ?? 10));
  return {
    route: 'issues',
    decisions: issues.map((issue) => ({ issue: issue.number, action: 'fix' })),
    actions: issues.map((issue) => ({
      type: 'comment',
      target: 'issue',
      number: issue.number,
      body: '/fix',
      actionKey: 'issue-fix',
    })),
    summary: {
      issuesInspected: sortNewest(snapshot.openIssues).length,
      issuesSelected: issues.length,
      actionsPlanned: issues.length,
    },
  };
}

function isWorkflowActive(snapshot, workflow) {
  return (snapshot.activeRuns ?? []).some(
    (run) =>
      workflowMatches(run, workflow) &&
      ['queued', 'in_progress', 'pending', 'waiting', 'requested'].includes(
        String(run.status ?? '').toLowerCase(),
      ),
  );
}

function matchingWorkflowRuns(snapshot, workflow) {
  return (snapshot.workflowRuns ?? snapshot.activeRuns ?? []).filter((run) =>
    workflowMatches(run, workflow),
  );
}

function latestWorkflowRunAt(snapshot, workflow) {
  const direct =
    snapshot.workflowLastDispatches?.[workflow] ??
    snapshot.workflowLastRuns?.[workflow] ??
    snapshot.workflowLastRunAt?.[workflow];
  if (direct) return direct;

  const latest = sortNewest(matchingWorkflowRuns(snapshot, workflow))[0];
  return latest?.updatedAt ?? latest?.createdAt ?? latest?.startedAt ?? '';
}

function cooldownCompleteAt(entry, snapshot) {
  const lastRunAt = latestWorkflowRunAt(snapshot, entry.workflow);
  const lastRunDate = parseDate(lastRunAt);
  if (!lastRunDate) return 0;
  return (
    lastRunDate.getTime() + Number(entry.cooldownHours ?? 0) * 60 * 60 * 1000
  );
}

function hasPendingDuplicate(snapshot, entry) {
  const titlePrefix = entry.dedupe?.titlePrefix;
  if (!titlePrefix) return false;
  return (snapshot.openPullRequests ?? []).some((pr) =>
    String(pr.title ?? '').startsWith(titlePrefix),
  );
}

function lowLoadEligibleEntries(snapshot) {
  return PR_PRODUCER_REGISTRY.filter((entry) => {
    if (!['proactive', 'conditional-proactive'].includes(entry.category)) {
      return false;
    }
    if (entry.workflow === 'gsd-planning.yml' && !snapshot.phaseCandidate) {
      return false;
    }
    if (isWorkflowActive(snapshot, entry.workflow)) return false;
    if (hasPendingDuplicate(snapshot, entry)) return false;
    return true;
  }).sort((left, right) => {
    const leftReadyAt = cooldownCompleteAt(left, snapshot);
    const rightReadyAt = cooldownCompleteAt(right, snapshot);
    if (leftReadyAt !== rightReadyAt) return leftReadyAt - rightReadyAt;
    return (
      PR_PRODUCER_REGISTRY.indexOf(left) - PR_PRODUCER_REGISTRY.indexOf(right)
    );
  });
}

function scheduleHealth(snapshot, workflow) {
  const runs = sortNewest(matchingWorkflowRuns(snapshot, workflow));
  if (runs.length < 2) {
    return { workflow, observedRuns: runs.length, latestGapHours: null };
  }
  const latestAt = runs[0].createdAt ?? runs[0].updatedAt;
  const previousAt = runs[1].createdAt ?? runs[1].updatedAt;
  const gap = hoursBetween(previousAt, latestAt);
  return {
    workflow,
    observedRuns: runs.length,
    latestGapHours: Number.isFinite(gap) ? Number(gap.toFixed(2)) : null,
  };
}

function buildPrRouteSummary(snapshot, prs, decisions, actions) {
  const nextLowLoad = lowLoadEligibleEntries(snapshot)[0];
  const activeRepairRuns = Object.fromEntries(
    REPAIR_WORKFLOWS.map((entry) => [
      entry.workflow,
      matchingWorkflowRuns(snapshot, entry.workflow).filter(isActiveRun).length,
    ]).filter(([, count]) => count > 0),
  );
  const unknownCheckStatus = prs.filter(
    (pr) => checkStatus(pr).status === 'unknown',
  ).length;
  const checksFailedLabelFallbacks = prs.filter((pr) => {
    const status = checkStatus(pr);
    return status.status === 'failed' && status.source === 'flow-label';
  }).length;

  return {
    prsInspected: prs.length,
    actionsPlanned: actions.length,
    activeRunSkips: decisions.filter((decision) =>
      String(decision.reason ?? '').includes('already active'),
    ).length,
    priorFailedRepairs: decisions.filter(
      (decision) => decision.action === 'claude-escalation',
    ).length,
    escalationsPlanned: actions.filter(
      (action) => action.actionKey === 'claude-escalation',
    ).length,
    readyPrs: prs.filter(isReady).length,
    finalizerDispatches: actions.filter(
      (action) => action.actionKey === 'finalizer',
    ).length,
    directMergeReviews: actions.filter(
      (action) => action.type === 'direct-merge-review-required',
    ).length,
    manualOnlyReady: prs.filter((pr) => isReady(pr) && isManualOnly(pr)).length,
    manualOnlyNotReady: prs.filter((pr) => !isReady(pr) && isManualOnly(pr))
      .length,
    unknownCheckStatus,
    checksFailedLabelFallbacks,
    activeRepairRuns,
    nextLowLoadWorkflowIfPressureDrops: nextLowLoad?.workflow ?? '',
  };
}

function planLowLoadRoute(snapshot) {
  const eligible = lowLoadEligibleEntries(snapshot);
  const entry = eligible[0];
  if (!entry) {
    return {
      route: 'low-load',
      decisions: [],
      actions: [],
      summary: { eligibleWorkflows: 0, actionsPlanned: 0 },
    };
  }

  const inputs = { ...(entry.inputs ?? {}) };
  if (entry.workflow === 'gsd-planning.yml') {
    inputs.phase = snapshot.phaseCandidate;
    inputs.dry_run = 'false';
  }

  return {
    route: 'low-load',
    decisions: [{ workflow: entry.workflow, action: 'dispatch' }],
    actions: [
      {
        type: 'dispatch-workflow',
        workflow: entry.workflow,
        ref: entry.dispatchRef ?? 'main',
        inputs,
        actionKey: 'low-load-dispatch',
      },
    ],
    summary: {
      eligibleWorkflows: eligible.length,
      selectedWorkflow: entry.workflow,
      actionsPlanned: 1,
    },
  };
}

function buildPlanSummary(snapshot, route, routePlan) {
  const workflowGaps = scheduleHealth(snapshot, 'project-manager.yml');
  return {
    route,
    openPrCount:
      snapshot.openPrCount ?? (snapshot.openPullRequests ?? []).length,
    openIssueCount:
      snapshot.openIssueCount ?? (snapshot.openIssues ?? []).length,
    actionsPlanned: (routePlan.actions ?? []).length,
    ...(routePlan.summary ?? {}),
    projectManagerSchedule: workflowGaps,
  };
}

function buildPlan(snapshot, options = {}) {
  const hydrated = hydrateSnapshot(snapshot);
  const route = selectRoute(hydrated, options);
  const routePlan =
    route === 'prs'
      ? planPrRoute(hydrated, options)
      : route === 'issues'
        ? planIssueRoute(hydrated, options)
        : planLowLoadRoute(hydrated, options);

  return {
    route,
    generatedAt: options.now ?? hydrated.now ?? new Date().toISOString(),
    openPrCount:
      hydrated.openPrCount ?? (hydrated.openPullRequests ?? []).length,
    openIssueCount:
      hydrated.openIssueCount ?? (hydrated.openIssues ?? []).length,
    ...routePlan,
    summary: buildPlanSummary(hydrated, route, routePlan),
  };
}

function detectPrProducingWorkflows(workflowsDir) {
  const detected = [];
  const files = fs
    .readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));

  for (const file of files) {
    const text = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    const signals = [];
    if (text.includes('./.github/actions/upsert-pull-request')) {
      signals.push('upsert-pull-request');
    }
    if (text.includes('./.github/actions/prepare-automation-branch')) {
      signals.push('prepare-automation-branch');
    }
    if (text.includes('./.github/workflows/_auto-fix-ci.yml')) {
      signals.push('_auto-fix-ci');
    }
    if (signals.length > 0) {
      detected.push({ workflow: file, signals });
    }
  }

  return detected;
}

function registryCoverage(detected) {
  const known = new Set(PR_PRODUCER_REGISTRY.map((entry) => entry.workflow));
  const excluded = new Set(
    INTENTIONAL_PR_PRODUCER_EXCLUSIONS.map((entry) => entry.workflow),
  );
  return detected.filter(
    (entry) => !known.has(entry.workflow) && !excluded.has(entry.workflow),
  );
}

function gh(args, options = {}) {
  if (options.dryRun) {
    console.log(`[dry-run] gh ${args.join(' ')}`);
    return '';
  }
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

function ghJson(args, fallback = null) {
  try {
    return JSON.parse(gh(args));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

function valueFromLine(lines, prefix) {
  const line = lines.find((item) => item.trimStart().startsWith(prefix));
  if (!line) return '';
  return line.slice(line.indexOf(prefix) + prefix.length).trim();
}

function parseStateComment(body) {
  const text = String(body ?? '');
  if (!text.includes(STATE_MARKER)) return null;
  const lines = text.split(/\r?\n/);
  return {
    headSha: valueFromLine(lines, '- Head SHA:'),
    readySince: valueFromLine(lines, '- Ready since:'),
    lastAction: valueFromLine(lines, '- Last action:'),
    lastActionAt: valueFromLine(lines, '- Last action at:'),
    directMergeReview:
      valueFromLine(lines, '- Direct merge review:') || 'not-run',
    directMergeReviewAt: valueFromLine(lines, '- Direct merge review at:'),
    workflowIssueNumber: valueFromLine(lines, '- Workflow issue:'),
    workflowIssueUrl: valueFromLine(lines, '- Workflow issue URL:'),
    cooldowns: {
      rebase: valueFromLine(lines, '- rebase:'),
      fix: valueFromLine(lines, '- fix:'),
      'fix-review': valueFromLine(lines, '- fix-review:'),
      finalizer: valueFromLine(lines, '- finalizer:'),
      'direct-merge': valueFromLine(lines, '- direct-merge:'),
      'claude-escalation': valueFromLine(lines, '- claude-escalation:'),
    },
  };
}

function latestProjectManagerState(comments) {
  const stateComments = sortNewest(comments ?? []).filter((comment) =>
    String(comment.body ?? '').includes(STATE_MARKER),
  );
  return parseStateComment(stateComments[0]?.body);
}

function stripInlineMarkdown(value) {
  return String(value ?? '')
    .replace(/[`*_]/g, '')
    .trim();
}

function cleanSummaryValue(value) {
  const cleaned = stripInlineMarkdown(value);
  return cleaned === '_n/a_' ? '' : cleaned;
}

function extractCommentUpdatedAt(body, comment) {
  return (
    String(body ?? '').match(/<!--\s*updated:\s*([^>]+?)\s*-->/)?.[1] ??
    comment?.updatedAt ??
    comment?.updated_at ??
    comment?.createdAt ??
    comment?.created_at ??
    ''
  );
}

function extractRunId(value) {
  return String(value ?? '').match(/\/actions\/runs\/(\d+)/)?.[1] ?? '';
}

function summaryHeading(body) {
  return (
    String(body ?? '')
      .split(/\r?\n/)
      .find((line) => line.startsWith('## ')) ?? ''
  ).trim();
}

function summaryBase(comment, marker) {
  const body = String(comment?.body ?? '');
  if (!body.includes(marker)) return null;
  const lines = body.split(/\r?\n/);
  const runUrl = cleanSummaryValue(valueFromLine(lines, '- Run:'));
  return {
    body,
    databaseId: extractRunId(runUrl),
    headSha: cleanSummaryValue(
      valueFromLine(lines, '- Head SHA:') ||
        valueFromLine(lines, '- Old head:'),
    ),
    runUrl,
    url: runUrl,
    updatedAt: extractCommentUpdatedAt(body, comment),
    heading: summaryHeading(body),
    source: 'summary',
  };
}

function withSummaryFingerprint(summary, workflow) {
  return {
    ...summary,
    workflow,
    fingerprint: failureFingerprint({
      workflow,
      headSha: summary.headSha,
      databaseId: summary.databaseId,
      url: summary.url,
      outcome: summary.outcome,
      failureSummary: summary.failureSummary,
    }),
  };
}

function parseRebaseSummaryComment(comment) {
  const base = summaryBase(comment, REBASE_SUMMARY_MARKER);
  if (!base) return null;
  const heading = base.heading;
  const body = base.body;
  let outcome = 'unknown';
  let conclusion = '';
  let status = 'completed';
  let noop = false;
  let active = false;

  if (heading.includes('Rebase complete')) {
    noop = body.includes('Pushed: no (no changes after rebase)');
    outcome = noop ? 'noop' : 'success';
    conclusion = 'success';
  } else if (heading.includes('Validation failed')) {
    outcome = 'validation_failed_not_pushed';
    conclusion = 'failure';
  } else if (heading.includes('Push rejected')) {
    outcome = 'push_rejected';
    conclusion = 'failure';
  } else if (heading.includes('Rebase ancestry check failed')) {
    outcome = 'ancestry_failed';
    conclusion = 'failure';
  } else if (heading.includes('Rebase failed')) {
    outcome = 'failed';
    conclusion = 'failure';
  } else if (heading.includes('Rebase cancelled')) {
    outcome = 'cancelled';
    conclusion = 'cancelled';
  } else if (heading.includes('Rebase skipped')) {
    outcome = 'skipped';
    conclusion = 'skipped';
  } else if (
    heading.includes('Rebase started') ||
    heading.includes('Resolving rebase conflicts')
  ) {
    outcome = 'active';
    status = 'in_progress';
    active = true;
  }

  return withSummaryFingerprint(
    {
      ...base,
      outcome,
      conclusion,
      status,
      noop,
      active,
      failureSummary: heading.replace(/^##\s*/, '').trim() || outcome,
    },
    'rebase-pr.yml',
  );
}

function parseFixReviewSummaryComment(comment) {
  const base = summaryBase(comment, FIX_REVIEW_SUMMARY_MARKER);
  if (!base) return null;
  const heading = base.heading;
  let outcome = 'unknown';
  let conclusion = '';
  let status = 'completed';
  let noop = false;
  let active = false;

  if (heading.includes('Review fixes applied')) {
    outcome = 'success';
    conclusion = 'success';
  } else if (heading.includes('No changes needed')) {
    outcome = 'noop';
    conclusion = 'success';
    noop = true;
  } else if (heading.includes('Validation failed')) {
    outcome = 'validation_failed_not_pushed';
    conclusion = 'failure';
  } else if (heading.includes('Push rejected')) {
    outcome = 'push_rejected';
    conclusion = 'failure';
  } else if (heading.includes('Review fix failed')) {
    outcome = 'failed';
    conclusion = 'failure';
  } else if (heading.includes('Review fix cancelled')) {
    outcome = 'cancelled';
    conclusion = 'cancelled';
  } else if (heading.includes('Review fix skipped')) {
    outcome = 'skipped';
    conclusion = 'skipped';
  } else if (
    heading.includes('Review fix started') ||
    heading.includes('Applying review fixes')
  ) {
    outcome = 'active';
    status = 'in_progress';
    active = true;
  }

  return withSummaryFingerprint(
    {
      ...base,
      outcome,
      conclusion,
      status,
      noop,
      active,
      failureSummary: heading.replace(/^##\s*/, '').trim() || outcome,
    },
    'fix-review.yml',
  );
}

function headMatches(summaryHead, prHead) {
  const left = String(summaryHead ?? '').toLowerCase();
  const right = String(prHead ?? '').toLowerCase();
  if (!left || !right) return true;
  return left.startsWith(right) || right.startsWith(left);
}

function latestSummary(comments, parser, pr) {
  const headSha = pr.headRefOid ?? pr.headSha ?? '';
  return sortNewest(
    (comments ?? [])
      .map(parser)
      .filter(Boolean)
      .filter((summary) => headMatches(summary.headSha, headSha)),
  )[0];
}

function isActiveRun(run) {
  return ACTIVE_RUN_STATUSES.has(normalizeConclusion(run?.status));
}

function workflowMatches(run, workflow) {
  const expected = normalizeWorkflowIdentity(workflow);
  return [run.workflow, run.workflowName, run.name, run.path].some(
    (value) => normalizeWorkflowIdentity(value) === expected,
  );
}

function normalizeWorkflowIdentity(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const file = raw.split('/').pop().toLowerCase();
  if (file.endsWith('.yml') || file.endsWith('.yaml')) return file;
  return WORKFLOW_NAME_ALIASES.get(file) ?? file;
}

function runMatchesSummary(run, summary) {
  if (!summary) return false;
  const runId = String(run.databaseId ?? run.id ?? '');
  return (
    Boolean(
      runId && summary.databaseId && runId === String(summary.databaseId),
    ) || Boolean(run.url && summary.url && run.url === summary.url)
  );
}

function runHasPrEvidence(run, pr, summary) {
  if (runMatchesSummary(run, summary)) return true;
  const prNumber = String(pr.number ?? '');
  const title = String(pr.title ?? '').toLowerCase();
  const text = [
    run.displayTitle,
    run.headBranch,
    run.headSha,
    run.url,
    run.name,
    run.workflowName,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  if (
    prNumber &&
    (text.includes(`#${prNumber}`) || text.includes(`/${prNumber}`))
  ) {
    return true;
  }
  if (title && text.includes(title)) return true;
  if (run.headBranch && run.headBranch === pr.headRefName) return true;
  if (run.headSha && run.headSha === (pr.headRefOid ?? pr.headSha)) return true;
  return false;
}

function normalizeWorkflowRun(run, workflow) {
  return {
    databaseId: run.databaseId ?? run.id,
    id: run.id ?? run.databaseId,
    workflow,
    name: run.name,
    workflowName: run.workflowName,
    displayTitle: run.displayTitle,
    event: run.event,
    headBranch: run.headBranch,
    headSha: run.headSha,
    status: normalizeConclusion(run.status),
    conclusion: normalizeConclusion(run.conclusion),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt ?? run.createdAt,
    url: run.url,
    active: isActiveRun(run),
  };
}

function mergeRepairBucket(existing, workflow, runCandidates, summary) {
  const candidates = [];
  if (existing?.latest) candidates.push(existing.latest);
  for (const run of runCandidates)
    candidates.push(normalizeWorkflowRun(run, workflow));
  if (summary) candidates.push(summary);

  const latest = chooseRepairLatest(candidates, summary, existing?.latest);
  const cancellationFingerprints = new Set(
    candidates
      .filter((item) => normalizeConclusion(item.conclusion) === 'cancelled')
      .map((item) => failureFingerprint({ ...item, workflow })),
  );

  return {
    ...(existing ?? {}),
    active:
      Boolean(existing?.active) ||
      candidates.some((item) => item.active || isActiveRun(item)),
    latest,
    cancelledCount: Math.max(
      Number(existing?.cancelledCount ?? 0),
      cancellationFingerprints.size,
    ),
  };
}

function chooseRepairLatest(candidates, summary, existingLatest) {
  const newest = sortNewest(candidates)[0] ?? existingLatest ?? null;
  if (!summary) return newest;
  if (summary.active) return newest;
  if (!newest) return summary;
  if (runMatchesSummary(newest, summary)) return summary;

  const newestUpdatedAt = parseDate(
    newest.updatedAt ?? newest.createdAt ?? newest.startedAt,
  );
  const summaryUpdatedAt = parseDate(summary.updatedAt ?? summary.createdAt);
  const newer = Boolean(
    newestUpdatedAt && summaryUpdatedAt && newestUpdatedAt > summaryUpdatedAt,
  );
  // A newer different live run may supersede a sticky summary only when it
  // represents a successful repair. A newer cancelled/skipped/neutral/failing
  // run carries no repair outcome, so letting it override the summary would
  // mask an unresolved hard failure and suppress @claude escalation.
  if (newer && normalizeConclusion(newest.conclusion) === 'success') {
    return newest;
  }

  return summary;
}

function attachRepairRunsToPullRequest(pr, workflowRuns = []) {
  const comments = pr.comments ?? [];
  const summaries = {
    rebase: latestSummary(comments, parseRebaseSummaryComment, pr),
    fixReview: latestSummary(comments, parseFixReviewSummaryComment, pr),
  };
  const runs = { ...(pr.runs ?? {}) };
  for (const entry of REPAIR_WORKFLOWS) {
    const summary = summaries[entry.summary];
    const matchingRuns = (workflowRuns ?? []).filter(
      (run) =>
        workflowMatches(run, entry.workflow) &&
        runHasPrEvidence(run, pr, summary),
    );
    runs[entry.key] = mergeRepairBucket(
      runs[entry.key],
      entry.workflow,
      matchingRuns,
      summary,
    );
  }
  return {
    ...pr,
    runs,
    rebase: summaries.rebase
      ? { ...(pr.rebase ?? {}), latest: summaries.rebase }
      : pr.rebase,
    fixReview: summaries.fixReview
      ? { ...(pr.fixReview ?? {}), latest: summaries.fixReview }
      : pr.fixReview,
  };
}

function hydrateSnapshot(snapshot) {
  const workflowRuns = snapshot.workflowRuns ?? snapshot.activeRuns ?? [];
  return {
    ...snapshot,
    openPullRequests: (snapshot.openPullRequests ?? []).map((pr) =>
      attachRepairRunsToPullRequest(pr, workflowRuns),
    ),
  };
}

function latestCommitDate(commits) {
  const latest = [...(commits ?? [])].pop();
  return (
    latest?.committedDate ??
    latest?.commit?.committedDate ??
    latest?.commit?.committer?.date ??
    latest?.commit?.author?.date ??
    ''
  );
}

function enrichPullRequest(pr) {
  const details = ghJson(
    [
      'pr',
      'view',
      String(pr.number),
      '--json',
      [
        'number',
        'title',
        'url',
        'state',
        'mergedAt',
        'isDraft',
        'isCrossRepository',
        'headRefName',
        'headRefOid',
        'baseRefName',
        'labels',
        'mergeable',
        'autoMergeRequest',
        'updatedAt',
        'createdAt',
        'comments',
        'reviews',
        'commits',
        'statusCheckRollup',
      ].join(','),
    ],
    pr,
  );
  const comments = details.comments ?? pr.comments ?? [];
  const labels = details.labels ?? pr.labels ?? [];
  return {
    ...pr,
    ...details,
    labels,
    comments,
    reviews: details.reviews ?? pr.reviews ?? [],
    headCommittedAt:
      latestCommitDate(details.commits) ??
      pr.headCommittedAt ??
      details.updatedAt ??
      pr.updatedAt,
    checkStatus:
      pr.checkStatus ??
      details.checkStatus ??
      deriveCheckStatusFromRollup(details.statusCheckRollup),
    projectManagerState:
      pr.projectManagerState ?? latestProjectManagerState(comments),
  };
}

function enrichIssue(issue) {
  const details = ghJson(
    [
      'issue',
      'view',
      String(issue.number),
      '--json',
      'number,title,url,state,labels,updatedAt,createdAt,body,comments',
    ],
    issue,
  );
  return { ...issue, ...details };
}

function workflowFileByName() {
  const workflowsDir = path.resolve(__dirname, '..');
  try {
    return new Map(
      fs
        .readdirSync(workflowsDir)
        .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
        .map((file) => {
          const text = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
          const name = text.match(/^name:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
          return name ? [name, file] : null;
        })
        .filter(Boolean),
    );
  } catch {
    return new Map();
  }
}

function workflowRuns() {
  const nameToFile = workflowFileByName();
  const globalRuns = ghJson(
    [
      'run',
      'list',
      '--limit',
      '100',
      '--json',
      'conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,name,status,updatedAt,url,workflowName',
    ],
    [],
  );
  const namedRuns = WORKFLOW_RUN_COLLECTION_WORKFLOWS.flatMap((workflow) =>
    ghJson(
      [
        'run',
        'list',
        '--workflow',
        workflow,
        '--limit',
        '50',
        '--json',
        'conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,name,status,updatedAt,url,workflowName',
      ],
      [],
    ).map((run) => normalizeLiveWorkflowRun(run, nameToFile, workflow)),
  );

  return uniqueWorkflowRuns([
    ...globalRuns.map((run) => normalizeLiveWorkflowRun(run, nameToFile)),
    ...namedRuns,
  ]);
}

function normalizeLiveWorkflowRun(run, nameToFile, workflowOverride = '') {
  return {
    ...run,
    workflow:
      workflowOverride ||
      (nameToFile.get(run.workflowName ?? run.name) ??
        run.workflowName ??
        run.name),
  };
}

function uniqueWorkflowRuns(runs) {
  const byKey = new Map();
  for (const run of runs) {
    const key =
      String(run.databaseId ?? run.id ?? '') ||
      run.url ||
      [
        run.workflow,
        run.workflowName,
        run.name,
        run.displayTitle,
        run.createdAt,
        run.headSha,
      ].join('|');
    if (!byKey.has(key)) {
      byKey.set(key, run);
      continue;
    }
    byKey.set(key, { ...byKey.get(key), ...run });
  }
  return [...byKey.values()];
}

function collectSnapshot(options = {}) {
  const prLimit = Number(options.prLimit ?? 10);
  const issueLimit = Number(options.issueLimit ?? 10);
  const prs = ghJson([
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title,url,state,mergedAt,isDraft,isCrossRepository,headRefName,headRefOid,baseRefName,labels,mergeable,autoMergeRequest,updatedAt,createdAt',
  ]);
  const issues = ghJson([
    'issue',
    'list',
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title,url,state,labels,updatedAt,createdAt,body',
  ]).filter((issue) => !issue.pull_request);
  const latestPrs = selectPrInspectionCandidates(prs, prLimit).map(
    enrichPullRequest,
  );
  const latestIssues = sortNewest(issues).slice(0, issueLimit).map(enrichIssue);
  const runs = workflowRuns();

  return {
    now: new Date().toISOString(),
    openPrCount: prs.length,
    openIssueCount: issues.length,
    openPullRequests: latestPrs,
    openIssues: latestIssues,
    activeRuns: runs.filter((run) =>
      ACTIVE_RUN_STATUSES.has(String(run.status ?? '').toLowerCase()),
    ),
    workflowRuns: runs,
  };
}

function renderStateBody(state) {
  const cooldowns = state.cooldowns ?? {};
  return [
    STATE_MARKER,
    '## Project Manager State',
    '',
    `- Head SHA: ${state.headSha ?? ''}`,
    `- Ready since: ${state.readySince ?? ''}`,
    `- Last action: ${state.lastAction ?? ''}`,
    `- Last action at: ${state.lastActionAt ?? ''}`,
    `- Direct merge review: ${state.directMergeReview ?? 'not-run'}`,
    `- Direct merge review at: ${state.directMergeReviewAt ?? ''}`,
    `- Workflow issue: ${state.workflowIssueNumber ?? ''}`,
    `- Workflow issue URL: ${state.workflowIssueUrl ?? ''}`,
    '- Cooldowns:',
    `  - rebase: ${cooldowns.rebase ?? ''}`,
    `  - fix: ${cooldowns.fix ?? ''}`,
    `  - fix-review: ${cooldowns['fix-review'] ?? ''}`,
    `  - finalizer: ${cooldowns.finalizer ?? ''}`,
    `  - direct-merge: ${cooldowns['direct-merge'] ?? ''}`,
    `  - claude-escalation: ${cooldowns['claude-escalation'] ?? ''}`,
  ].join('\n');
}

function resolveIssueNumberByTitle(title, options = {}) {
  if (!title) return null;
  if (options.issueByTitle?.has(title)) return options.issueByTitle.get(title);
  if (options.dryRun) return null;

  const output = gh([
    'issue',
    'list',
    '--state',
    'open',
    '--search',
    `${title} in:title`,
    '--json',
    'number,title',
    '--limit',
    '20',
  ]);
  const issue = JSON.parse(output).find((item) => item.title === title);
  const number = issue?.number ?? null;
  if (number && options.issueByTitle) options.issueByTitle.set(title, number);
  return number;
}

function upsertPrStateComment(number, body, options = {}) {
  if (options.dryRun) {
    gh(['pr', 'comment', String(number), '--body', body], {
      dryRun: true,
    });
    return;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    gh(['pr', 'comment', String(number), '--body', body]);
    return;
  }

  const comments = ghJson(
    ['api', `repos/${repository}/issues/${number}/comments`, '--paginate'],
    [],
  );
  const existing = sortNewest(comments).find((comment) =>
    String(comment.body ?? '').includes(STATE_MARKER),
  );

  if (existing?.id) {
    gh([
      'api',
      '-X',
      'PATCH',
      `repos/${repository}/issues/comments/${existing.id}`,
      '-f',
      `body=${body}`,
    ]);
    return;
  }

  gh(['pr', 'comment', String(number), '--body', body]);
}

function applyAction(action, options = {}) {
  const dryRun = options.dryRun;
  if (action.type === 'comment') {
    if (action.target === 'pr') {
      gh(['pr', 'comment', String(action.number), '--body', action.body], {
        dryRun,
      });
    } else {
      const issueNumber =
        action.number ??
        resolveIssueNumberByTitle(action.issueSelector?.title, options);
      if (issueNumber) {
        gh(['issue', 'comment', String(issueNumber), '--body', action.body], {
          dryRun,
        });
      } else {
        console.log(
          `[skip] issue selector comments require a resolved issue number: ${action.body}`,
        );
      }
    }
    return;
  }

  if (action.type === 'dispatch-workflow') {
    const args = ['workflow', 'run', action.workflow, '--ref', action.ref];
    for (const [key, value] of Object.entries(action.inputs ?? {})) {
      args.push('-f', `${key}=${String(value)}`);
    }
    gh(args, { dryRun });
    return;
  }

  if (action.type === 'create-or-reuse-issue') {
    const existing = resolveIssueNumberByTitle(action.title, options);
    if (existing) {
      console.log(`Reusing workflow issue #${existing}: ${action.title}`);
      return;
    }
    const args = [
      'issue',
      'create',
      '--title',
      action.title,
      '--body',
      action.body,
    ];
    if ((action.labels ?? []).length > 0) {
      args.push('--label', action.labels.join(','));
    }
    const output = gh(args, { dryRun });
    const match = String(output ?? '').match(/\/issues\/(\d+)/);
    if (match && options.issueByTitle) {
      options.issueByTitle.set(action.title, Number(match[1]));
    }
    return;
  }

  if (action.type === 'review-approved-merge') {
    gh(['pr', 'merge', String(action.number), '--squash'], { dryRun });
    return;
  }

  if (action.type === 'merge-pr') {
    gh(['pr', 'merge', String(action.number), '--squash'], { dryRun });
    return;
  }

  if (action.type === 'upsert-pr-state') {
    upsertPrStateComment(action.number, renderStateBody(action.state), {
      dryRun,
    });
    return;
  }

  if (action.type === 'direct-merge-review-required') {
    const review = options.reviewByPr?.get(action.number);
    if (review?.decision === 'merge') {
      gh(['pr', 'merge', String(action.number), '--squash'], {
        dryRun,
      });
      return;
    }
    console.log(`Project-manager review required for PR #${action.number}.`);
  }
}

function writeOutputs(plan, outputPath) {
  if (!outputPath) return;
  const reviewAction = plan.actions.find(
    (action) => action.type === 'direct-merge-review-required',
  );
  fs.appendFileSync(
    outputPath,
    [
      `route=${plan.route}`,
      `review_required=${reviewAction ? 'true' : 'false'}`,
      `review_pr_number=${reviewAction?.number ?? ''}`,
      `plan_file=${getArg('--plan-file', '')}`,
      '',
    ].join('\n'),
  );
}

function parseReviewJson(value) {
  const parsed =
    typeof value === 'string' && value.trim()
      ? JSON.parse(value)
      : value && typeof value === 'object'
        ? value
        : null;
  if (!parsed) return null;
  return {
    decision: parsed.decision === 'merge' ? 'merge' : 'hold',
    reason: String(parsed.reason ?? ''),
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    required_human_action: String(parsed.required_human_action ?? ''),
  };
}

function main() {
  const stateFile = getArg('--state-file');
  const applyPlanFile = getArg('--apply-plan');
  const planFile = getArg('--plan-file');
  const reviewJson = getArg('--review-json');
  const githubOutput = getArg('--github-output', process.env.GITHUB_OUTPUT);
  const dryRun = toBoolean(getArg('--dry-run', 'true'));
  const options = {
    route: getArg('--route', 'auto'),
    prThreshold: toNumber(getArg('--pr-threshold'), 5),
    issueThreshold: toNumber(getArg('--issue-threshold'), 5),
    prLimit: toNumber(getArg('--pr-limit'), 10),
    issueLimit: toNumber(getArg('--issue-limit'), 10),
    now: getArg('--now', null),
  };

  if (applyPlanFile) {
    const plan = readJson(applyPlanFile, { actions: [] });
    const review = parseReviewJson(reviewJson);
    const reviewByPr = new Map();
    if (review) {
      const reviewAction = plan.actions.find(
        (action) => action.type === 'direct-merge-review-required',
      );
      if (reviewAction) reviewByPr.set(reviewAction.number, review);
    }
    const issueByTitle = new Map();
    for (const action of plan.actions ?? []) {
      applyAction(action, { dryRun, issueByTitle, reviewByPr });
    }
    return;
  }

  const snapshot = stateFile
    ? readJson(stateFile, {})
    : collectSnapshot({
        prLimit: options.prLimit,
        issueLimit: options.issueLimit,
      });
  const plan = buildPlan(snapshot, options);
  const json = JSON.stringify(plan, null, 2);
  if (planFile) fs.writeFileSync(planFile, json);
  writeOutputs(plan, githubOutput);
  console.log(json);
}

if (require.main === module) {
  main();
}

module.exports = {
  CLAUDE_ESCALATION_MARKER,
  INTENTIONAL_PR_PRODUCER_EXCLUSIONS,
  ISSUE_MARKER,
  PR_PRODUCER_REGISTRY,
  STATE_MARKER,
  attachRepairRunsToPullRequest,
  buildPlan,
  decidePrAction,
  detectPrProducingWorkflows,
  hasMaintainerRejection,
  hydrateSnapshot,
  latestRebaseNoop,
  lowLoadEligibleEntries,
  planIssueRoute,
  planLowLoadRoute,
  planPrRoute,
  parseFixReviewSummaryComment,
  parseRebaseSummaryComment,
  registryCoverage,
  reviewSignalsPassed,
  duplicateAutomationPrActions,
  safeIssueForFix,
  scheduleHealth,
  selectPrInspectionCandidates,
  selectRoute,
  staleCodeReviewNeedsRebase,
};
