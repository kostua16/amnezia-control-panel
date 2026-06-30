#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATE_MARKER = '<!-- project-manager-pr-state -->';
const ISSUE_MARKER = '<!-- project-manager-workflow-issue -->';
const CLAUDE_ESCALATION_MARKER = '<!-- project-manager-claude-escalation -->';
const DEFAULT_NOW = '2026-01-01T00:00:00.000Z';

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
  };
}

function cooldownActive(state, key, now, hours = 1) {
  const at = state.cooldowns?.[key];
  return Boolean(at && hoursBetween(at, now) < hours);
}

function checkStatus(pr) {
  const status = pr.checkStatus ?? pr.requiredCheckStatus ?? {};
  if (typeof status === 'string') return { status };
  return { status: status.status ?? 'unknown', ...status };
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

function failedRepairRun(pr) {
  const candidates = [
    ['fix-pr.yml', pr.runs?.fixPr],
    ['fix-issue.yml', pr.runs?.fixIssue],
    ['fix-review.yml', pr.runs?.fixReview],
    ['rebase-pr.yml', pr.runs?.rebasePr],
  ];

  for (const [workflow, run] of candidates) {
    if (!run?.latest) continue;
    if (
      run.latest.conclusion &&
      !['success', 'skipped', 'cancelled'].includes(run.latest.conclusion)
    ) {
      return { workflow, ...run.latest };
    }
  }

  return null;
}

function escalationExists(pr, run) {
  if (!run) return false;
  const runId = String(run.databaseId ?? run.id ?? run.url ?? '');
  return (pr.comments ?? []).some(
    (comment) =>
      String(comment.body ?? '').includes(CLAUDE_ESCALATION_MARKER) &&
      (!runId || String(comment.body ?? '').includes(runId)),
  );
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

function directMergeReviewDecision(pr) {
  const review = pr.projectManagerReview ?? pr.directMergeReview;
  if (!review) return { decision: 'not-run' };
  if (typeof review === 'string') return { decision: review };
  return review;
}

function stalledReadyAction(pr, state, readySince, now) {
  if (!readySince || hoursBetween(readySince, now) < 1) return null;
  if (pr.autoMergeRequest) return null;
  if (hasMaintainerRejection(pr, readySince)) return null;

  const issue = buildWorkflowIssue(pr, readySince);
  const review = directMergeReviewDecision(pr);
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

  const review = directMergeReviewDecision(pr);
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
    return {
      type: 'compound',
      actionKey: 'claude-escalation',
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
            '',
            'Please diagnose the root cause and implement the narrowest workflow/code fix.',
          ].join('\n'),
          'claude-escalation',
        ),
        makeStatePatch(pr, state, 'claude-escalation', now, { readySince }),
      ],
    };
  }

  if (
    (pr.mergeable === 'CONFLICTING' || pr.conflict === true) &&
    !activeRun(pr, 'rebasePr') &&
    !cooldownActive(state, 'rebase', now)
  ) {
    return {
      type: 'compound',
      actionKey: 'rebase',
      number: pr.number,
      actions: [
        makeCommentAction(pr, '/rebase', 'rebase'),
        makeStatePatch(pr, state, 'rebase', now, { readySince }),
      ],
    };
  }

  if (
    staleCodeReviewNeedsRebase(pr, now) &&
    !cooldownActive(state, 'rebase', now)
  ) {
    return {
      type: 'compound',
      actionKey: 'rebase',
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
    !cooldownActive(state, 'fix', now)
  ) {
    return {
      type: 'compound',
      actionKey: 'fix',
      number: pr.number,
      actions: [
        makeCommentAction(pr, '/fix', 'fix'),
        makeStatePatch(pr, state, 'fix', now, { readySince }),
      ],
    };
  }

  if (
    hasReviewBlocker(pr) &&
    !checksFailed(pr) &&
    !activeRun(pr, 'fixReview') &&
    !cooldownActive(state, 'fix-review', now)
  ) {
    return {
      type: 'compound',
      actionKey: 'fix-review',
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

  if (isReady(pr) && !isManualOnly(pr)) {
    const stalled = stalledReadyAction(pr, state, readySince, now);
    if (stalled) return stalled;
  }

  const manual = manualOnlyAction(pr, state, readySince, now);
  if (manual) return manual;

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

function flattenAction(action) {
  if (!action) return [];
  if (action.type === 'compound') return action.actions.flatMap(flattenAction);
  if (action.statePatch) return [action, action.statePatch];
  return [action];
}

function planPrRoute(snapshot, options = {}) {
  const now = options.now ?? snapshot.now ?? DEFAULT_NOW;
  const prs = sortNewest(snapshot.openPullRequests).slice(
    0,
    Number(options.prLimit ?? 10),
  );
  const decisions = [];
  const actions = [];

  for (const pr of prs) {
    const decision = decidePrAction(pr, { ...options, now });
    decisions.push({
      pr: pr.number,
      action: decision?.actionKey ?? decision?.type ?? 'none',
    });
    actions.push(...flattenAction(decision));
  }

  return { route: 'prs', decisions, actions };
}

function issueHasLinkedPr(issue) {
  const text = `${issue.body ?? ''}\n${(issue.comments ?? [])
    .map((comment) => comment.body ?? '')
    .join('\n')}`;
  return /pull\/\d+|Fixes #\d+|PR:\s*#\d+/i.test(text);
}

function safeIssueForFix(issue) {
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
  return !(issue.comments ?? []).some((comment) =>
    String(comment.body ?? '').includes('/fix'),
  );
}

function planIssueRoute(snapshot, options = {}) {
  const issues = sortNewest(snapshot.openIssues)
    .filter(safeIssueForFix)
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
  };
}

function isWorkflowActive(snapshot, workflow) {
  return (snapshot.activeRuns ?? []).some(
    (run) =>
      run.workflow === workflow &&
      ['queued', 'in_progress', 'pending', 'waiting', 'requested'].includes(
        String(run.status ?? '').toLowerCase(),
      ),
  );
}

function matchingWorkflowRuns(snapshot, workflow) {
  return (snapshot.workflowRuns ?? snapshot.activeRuns ?? []).filter(
    (run) =>
      run.workflow === workflow ||
      run.workflowName === workflow ||
      run.name === workflow ||
      String(run.path ?? '').endsWith(`/${workflow}`),
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

function planLowLoadRoute(snapshot) {
  const eligible = lowLoadEligibleEntries(snapshot);
  const entry = eligible[0];
  if (!entry) {
    return { route: 'low-load', decisions: [], actions: [] };
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
  };
}

function buildPlan(snapshot, options = {}) {
  const route = selectRoute(snapshot, options);
  const routePlan =
    route === 'prs'
      ? planPrRoute(snapshot, options)
      : route === 'issues'
        ? planIssueRoute(snapshot, options)
        : planLowLoadRoute(snapshot, options);

  return {
    route,
    generatedAt: options.now ?? snapshot.now ?? new Date().toISOString(),
    openPrCount:
      snapshot.openPrCount ?? (snapshot.openPullRequests ?? []).length,
    openIssueCount:
      snapshot.openIssueCount ?? (snapshot.openIssues ?? []).length,
    ...routePlan,
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
    cooldowns: {
      rebase: valueFromLine(lines, '- rebase:'),
      fix: valueFromLine(lines, '- fix:'),
      'fix-review': valueFromLine(lines, '- fix-review:'),
      finalizer: valueFromLine(lines, '- finalizer:'),
      'direct-merge': valueFromLine(lines, '- direct-merge:'),
    },
  };
}

function latestProjectManagerState(comments) {
  const stateComments = sortNewest(comments ?? []).filter((comment) =>
    String(comment.body ?? '').includes(STATE_MARKER),
  );
  return parseStateComment(stateComments[0]?.body);
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
  const runs = ghJson(
    [
      'run',
      'list',
      '--limit',
      '100',
      '--json',
      'databaseId,displayTitle,event,headBranch,headSha,name,status,updatedAt,url,workflowName',
    ],
    [],
  );
  return runs.map((run) => ({
    ...run,
    workflow:
      nameToFile.get(run.workflowName ?? run.name) ??
      run.workflowName ??
      run.name,
  }));
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
  const latestPrs = sortNewest(prs).slice(0, prLimit).map(enrichPullRequest);
  const latestIssues = sortNewest(issues).slice(0, issueLimit).map(enrichIssue);
  const runs = workflowRuns();

  return {
    now: new Date().toISOString(),
    openPrCount: prs.length,
    openIssueCount: issues.length,
    openPullRequests: latestPrs,
    openIssues: latestIssues,
    activeRuns: runs.filter((run) =>
      ['queued', 'in_progress', 'pending', 'waiting', 'requested'].includes(
        String(run.status ?? '').toLowerCase(),
      ),
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
    '- Cooldowns:',
    `  - rebase: ${cooldowns.rebase ?? ''}`,
    `  - fix: ${cooldowns.fix ?? ''}`,
    `  - fix-review: ${cooldowns['fix-review'] ?? ''}`,
    `  - finalizer: ${cooldowns.finalizer ?? ''}`,
    `  - direct-merge: ${cooldowns['direct-merge'] ?? ''}`,
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
  buildPlan,
  decidePrAction,
  detectPrProducingWorkflows,
  hasMaintainerRejection,
  latestRebaseNoop,
  lowLoadEligibleEntries,
  planIssueRoute,
  planLowLoadRoute,
  planPrRoute,
  registryCoverage,
  reviewSignalsPassed,
  safeIssueForFix,
  selectRoute,
  staleCodeReviewNeedsRebase,
};
