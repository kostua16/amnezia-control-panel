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
  const relevantLabels = getPrFlowRelevantLabels(policy, config);
  const labelRelevant =
    labelActions.has(action) && relevantLabels.includes(labelName);
  const shouldRun =
    eventName === 'pull_request_target' &&
    (alwaysRunActions.has(action) || labelRelevant);

  process.stdout.write(
    JSON.stringify(
      {
        mode,
        should_run: shouldRun,
        triggered: eventName === 'pull_request_target',
        action,
        label: labelName || null,
        relevant_label: labelRelevant,
        reason: alwaysRunActions.has(action)
          ? `pull_request_target ${action} always runs PR flow`
          : labelRelevant
            ? `label ${labelName} affects PR flow`
            : labelActions.has(action)
              ? `label ${labelName} does not affect PR flow`
              : `pull_request_target ${action} is ignored by PR flow`,
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

throw new Error(`Unsupported mode "${mode}"`);
