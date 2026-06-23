/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const mode = getArg('--mode');
const policyFile = getArg('--policy-file', '.github/workflows/policy.json');
const configFile = getArg('--config-file', '.github/pr-flow.json');
const eventFile = getArg('--event-path', process.env.GITHUB_EVENT_PATH);
const eventName = getArg('--event-name', process.env.GITHUB_EVENT_NAME);
const sourcePrFile = getArg('--source-pr-file');

if (!mode) {
  throw new Error('--mode is required');
}

if (!eventFile) {
  throw new Error('--event-path is required');
}

const policy = readJson(policyFile);
const event = readJson(eventFile);

const commentBody = event.comment?.body ?? '';
const reviewBody = event.review?.body ?? '';
const issueTitle = event.issue?.title ?? '';
const issueBody = event.issue?.body ?? '';
const association =
  event.comment?.author_association ??
  event.review?.author_association ??
  event.issue?.author_association ??
  '';
const isMaintainer = policy.maintainerAssociations.includes(association);

function hasStandaloneCommand(body, command) {
  return String(body ?? '')
    .split(/\r?\n/)
    .some((line) => line.trim() === command);
}

function addLabels(target, values) {
  for (const value of values ?? []) {
    if (typeof value === 'string' && value.length > 0) {
      target.add(value);
    }
  }
}

function getPrFlowRelevantLabels(policyConfig, flowConfig) {
  const labels = new Set();
  addLabels(labels, policyConfig.blockingLabels);
  addLabels(labels, policyConfig.improveSkipLabels);
  addLabels(labels, flowConfig.resetOnHeadChange?.labels);

  for (const worker of Object.values(flowConfig.workers ?? {})) {
    addLabels(labels, worker.passLabels);
    addLabels(labels, worker.blockLabels);
    addLabels(labels, worker.successLabels);
    addLabels(labels, worker.skipLabels);
  }

  return Array.from(labels).sort();
}

function isBotAccount(user = {}) {
  const login = String(user.login ?? '');
  const type = String(user.type ?? '');

  return type === 'Bot' || /\[bot\]$/.test(login);
}

if (mode === 'claude') {
  const triggered =
    (eventName === 'issue_comment' && commentBody.includes('@claude')) ||
    (eventName === 'pull_request_review_comment' &&
      commentBody.includes('@claude')) ||
    (eventName === 'pull_request_review' && reviewBody.includes('@claude')) ||
    (eventName === 'issues' &&
      (issueTitle.includes('@claude') || issueBody.includes('@claude')));

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        triggered,
        trusted: triggered && isMaintainer,
        author_association: association,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'antigravity') {
  const triggered =
    (eventName === 'issue_comment' &&
      (commentBody.includes('@gemini') ||
        commentBody.includes('@antigravity'))) ||
    (eventName === 'pull_request_review_comment' &&
      (commentBody.includes('@gemini') ||
        commentBody.includes('@antigravity'))) ||
    (eventName === 'pull_request_review' &&
      (reviewBody.includes('@gemini') ||
        reviewBody.includes('@antigravity'))) ||
    (eventName === 'issues' &&
      (issueTitle.includes('@gemini') ||
        issueTitle.includes('@antigravity') ||
        issueBody.includes('@gemini') ||
        issueBody.includes('@antigravity')));

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        triggered,
        trusted: triggered && isMaintainer,
        author_association: association,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'deepseek') {
  const triggered =
    (eventName === 'issue_comment' && commentBody.includes('@deepseek')) ||
    (eventName === 'pull_request_review_comment' &&
      commentBody.includes('@deepseek')) ||
    (eventName === 'pull_request_review' && reviewBody.includes('@deepseek')) ||
    (eventName === 'issues' &&
      (issueTitle.includes('@deepseek') || issueBody.includes('@deepseek')));

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        triggered,
        trusted: triggered && isMaintainer,
        author_association: association,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'antigravity-review') {
  const isPrComment = Boolean(event.issue?.pull_request);
  const wantsReview = commentBody.includes('/gemini-review');
  const commentTriggered =
    eventName === 'issue_comment' && isPrComment && wantsReview && isMaintainer;
  const dispatchTriggered = eventName === 'workflow_dispatch';
  const prNumber = event.inputs?.pr_number ?? event.issue?.number ?? null;

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: commentTriggered || dispatchTriggered,
        trusted: dispatchTriggered || isMaintainer,
        author_association: association,
        trigger_source: commentTriggered
          ? 'comment'
          : dispatchTriggered
            ? 'workflow_dispatch'
            : null,
        pr_number: prNumber,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'fix-issue') {
  const isOpenIssue =
    event.issue?.state !== 'closed' && !event.issue?.pull_request;
  const labelName = event.label?.name ?? '';
  const maintainerTriggeredFix =
    eventName === 'issue_comment' &&
    isOpenIssue &&
    commentBody.includes('/fix') &&
    isMaintainer;
  const labelTriggeredFix =
    eventName === 'issues' &&
    isOpenIssue &&
    labelName === policy.fixApprovalLabel;

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: maintainerTriggeredFix || labelTriggeredFix,
        author_association: association,
        trusted: isMaintainer,
        trigger_source: maintainerTriggeredFix
          ? 'comment'
          : labelTriggeredFix
            ? 'label'
            : null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'pr-flow-approve') {
  const isPrComment = Boolean(event.issue?.pull_request);
  const wantsApproval = hasStandaloneCommand(commentBody, '/approve');
  const commentTriggered =
    eventName === 'issue_comment' &&
    isPrComment &&
    wantsApproval &&
    isMaintainer;
  const prNumber = event.issue?.number ?? null;

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: commentTriggered,
        triggered:
          eventName === 'issue_comment' && isPrComment && wantsApproval,
        trusted: isMaintainer,
        author_association: association,
        pr_number: commentTriggered ? prNumber : null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'review-approved') {
  const reviewState = String(event.review?.state ?? '').toLowerCase();
  const reviewApproved =
    eventName === 'pull_request_review' && reviewState === 'approved';
  const shouldRun = reviewApproved && isMaintainer;
  const prNumber = event.pull_request?.number ?? null;

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: shouldRun,
        triggered: reviewApproved,
        trusted: isMaintainer,
        author_association: association,
        pr_number: shouldRun ? prNumber : null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'pr-flow-pull-request-target') {
  const config = readJson(configFile);
  const action = event.action ?? '';
  const labelName = event.label?.name ?? '';
  const alwaysRunActions = new Set([
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
    'converted_to_draft',
  ]);
  const labelActions = new Set(['labeled', 'unlabeled']);
  const senderIsBot = labelActions.has(action) && isBotAccount(event.sender);
  const relevantLabels = getPrFlowRelevantLabels(policy, config);
  const labelRelevant =
    labelActions.has(action) &&
    relevantLabels.includes(labelName) &&
    !senderIsBot;
  const shouldRun =
    eventName === 'pull_request_target' &&
    (alwaysRunActions.has(action) || labelRelevant);

  const reason = (() => {
    if (alwaysRunActions.has(action)) {
      return `pull_request_target ${action} always runs PR flow`;
    }
    if (senderIsBot) {
      return `label ${labelName} applied by bot; orchestrator re-evaluates on workflow_run completion`;
    }
    if (labelRelevant) {
      return `label ${labelName} affects PR flow`;
    }
    if (labelActions.has(action)) {
      return `label ${labelName} does not affect PR flow`;
    }
    return `pull_request_target ${action} is ignored by PR flow`;
  })();

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: shouldRun,
        triggered: eventName === 'pull_request_target',
        action,
        label: labelName || null,
        relevant_label: labelRelevant,
        sender_is_bot: senderIsBot || null,
        reason,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'approve-auto-fix') {
  const isOpenIssue =
    event.issue?.state !== 'closed' && !event.issue?.pull_request;
  const commentTriggered =
    eventName === 'issue_comment' &&
    isOpenIssue &&
    commentBody.includes('/approve-auto-fix') &&
    isMaintainer;

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: commentTriggered,
        author_association: association,
        trusted: isMaintainer,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'planning-intake-repair') {
  const isPrComment = Boolean(event.issue?.pull_request);
  const commentTriggered =
    eventName === 'issue_comment' &&
    isPrComment &&
    commentBody.includes('/planning-rename-milestones') &&
    isMaintainer;
  const dispatchTriggered = eventName === 'workflow_dispatch';
  const planningPrNumber =
    event.inputs?.planning_pr_number ?? event.issue?.number ?? null;

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: commentTriggered || dispatchTriggered,
        trusted: dispatchTriggered || isMaintainer,
        author_association: association,
        trigger_source: commentTriggered
          ? 'comment'
          : dispatchTriggered
            ? 'workflow_dispatch'
            : null,
        planning_pr_number: planningPrNumber,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'fix-pr') {
  const workflowRun = event.workflow_run ?? {};
  const sourcePr = sourcePrFile ? readJson(sourcePrFile) : {};
  const labels = Array.isArray(sourcePr.labels)
    ? sourcePr.labels
        .map((label) =>
          typeof label === 'string' ? label : String(label?.name ?? ''),
        )
        .filter(Boolean)
    : [];
  const headRefName =
    sourcePr.headRefName ??
    sourcePr.head?.ref ??
    workflowRun.head_branch ??
    workflowRun.headBranch ??
    '';
  const automationPrefixes = [
    ...(policy.trustedAutomationBranchPrefixes ?? []),
    ...(policy.trustedPlanning?.branchPrefixes ?? []),
    ...(policy.manualOnlyBranchPrefixes ?? []),
    ...(policy.cleanupBranchPrefixes ?? []),
    ...(policy.gsdExecution?.branchPrefix
      ? [policy.gsdExecution.branchPrefix]
      : []),
  ];
  const hasAutomationBranchPrefix = automationPrefixes.some((prefix) =>
    headRefName.startsWith(prefix),
  );
  const hasAutoFixLabel = labels.includes('auto-fix');
  const sourcePrAuthor = sourcePr.user ?? {};
  const sourcePrAuthorLogin = String(sourcePrAuthor.login ?? '');
  const sourcePrAuthorType = String(sourcePrAuthor.type ?? '');
  const hasBotAuthor = isBotAccount(sourcePrAuthor);
  const attemptCount = Number(sourcePr.auto_fix_attempt_count ?? 0);
  const maxAttempts = Number(policy.maxAutoFixAttempts ?? 0);
  const capReached = maxAttempts > 0 && attemptCount >= maxAttempts;
  const shouldRun =
    !hasAutomationBranchPrefix &&
    !hasAutoFixLabel &&
    !hasBotAuthor &&
    !capReached;
  let reason = null;

  if (capReached) {
    reason = `auto-fix attempt cap reached (${attemptCount}/${maxAttempts}); stopping to avoid a fix loop`;
  } else if (hasAutoFixLabel) {
    reason = 'source PR already has the auto-fix label';
  } else if (hasAutomationBranchPrefix) {
    reason = `source PR branch ${headRefName} already matches an automation prefix`;
  } else if (hasBotAuthor) {
    reason = `source PR author ${sourcePrAuthorLogin || 'unknown'} (${sourcePrAuthorType || 'unknown'}) is a bot and fix-pr skips bot-authored PRs`;
  }

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: shouldRun,
        head_ref_name: headRefName,
        labels,
        source_pr_author_login: sourcePrAuthorLogin || null,
        source_pr_author_type: sourcePrAuthorType || null,
        auto_fix_attempt_count: attemptCount,
        max_auto_fix_attempts: maxAttempts,
        reason,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'fix-branch') {
  const workflowRun = event.workflow_run ?? {};
  const headBranch = workflowRun.head_branch ?? workflowRun.headBranch ?? '';
  const actor = workflowRun.actor ?? event.sender ?? {};
  const actorLogin = String(actor.login ?? '');
  const actorType = String(actor.type ?? '');
  const actorAssociation = String(actor.author_association ?? '');
  const isBot = isBotAccount(actor);
  const isTrustedActor =
    isBot ||
    policy.maintainerAssociations.includes(actorAssociation) ||
    actorAssociation === 'OWNER' ||
    actorAssociation === 'MEMBER';
  const allowedBranches = ['main', 'develop'];
  const isAllowedBranch = allowedBranches.includes(headBranch);
  const isAutoFixBranch = String(headBranch).startsWith('claude-auto-fix-ci-');
  const shouldRun =
    isAllowedBranch &&
    !isAutoFixBranch &&
    isTrustedActor &&
    workflowRun.conclusion === 'failure';
  let reason = null;
  if (!isAllowedBranch) {
    reason = `branch ${headBranch} is not in allowed list (${allowedBranches.join(', ')})`;
  } else if (isAutoFixBranch) {
    reason = `branch ${headBranch} is an auto-fix branch`;
  } else if (!isTrustedActor) {
    reason = `triggering actor ${actorLogin} (${actorAssociation}) is not a trusted maintainer`;
  }

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: shouldRun,
        head_branch: headBranch,
        actor_login: actorLogin,
        actor_type: actorType,
        actor_association: actorAssociation,
        reason,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'fix-review') {
  const isPrComment = Boolean(event.issue?.pull_request);
  const body = String(commentBody ?? '');
  const command = body.includes('/address-review')
    ? '/address-review'
    : body.includes('/fix-review')
      ? '/fix-review'
      : null;
  const wantsFix = command !== null;
  const commenterIsBot = isBotAccount(event.comment?.user);
  const commentTriggered =
    eventName === 'issue_comment' &&
    isPrComment &&
    wantsFix &&
    !commenterIsBot &&
    isMaintainer;
  const dispatchTriggered = eventName === 'workflow_dispatch';
  const prNumber = event.inputs?.pr_number ?? event.issue?.number ?? null;
  const active = commentTriggered || dispatchTriggered;

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: active,
        trusted: dispatchTriggered || (isMaintainer && !commenterIsBot),
        author_association: association,
        trigger_source: commentTriggered
          ? 'comment'
          : dispatchTriggered
            ? 'workflow_dispatch'
            : null,
        pr_number: active ? prNumber : null,
        command,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (mode === 'rebase-pr') {
  const isPrComment = Boolean(event.issue?.pull_request);
  // v1 accepts the standalone command only: the whole comment body must be
  // exactly "/rebase". This rejects prose mentions and "/rebase main" (and any
  // arguments), and stays in lockstep with the rebase-pr.yml concurrency guard,
  // which uses `comment.body == '/rebase'`.
  const wantsRebase = String(commentBody ?? '') === '/rebase';
  const commenterIsBot = isBotAccount(event.comment?.user);
  const commentTriggered =
    eventName === 'issue_comment' &&
    isPrComment &&
    wantsRebase &&
    !commenterIsBot &&
    isMaintainer;
  const dispatchTriggered = eventName === 'workflow_dispatch';
  const prNumber = event.inputs?.pr_number ?? event.issue?.number ?? null;
  const active = commentTriggered || dispatchTriggered;

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: active,
        trusted: dispatchTriggered || (isMaintainer && !commenterIsBot),
        author_association: association,
        trigger_source: commentTriggered
          ? 'comment'
          : dispatchTriggered
            ? 'workflow_dispatch'
            : null,
        pr_number: active ? prNumber : null,
        command: commentTriggered ? '/rebase' : null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

throw new Error(`Unsupported mode "${mode}"`);
