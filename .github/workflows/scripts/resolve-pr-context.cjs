/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePullRequest(pr, source) {
  if (!pr) return null;
  const number = toNumber(
    pr.number ?? pr.issue_number ?? pr.pull_request?.number ?? pr,
  );
  if (!number) return null;

  return {
    number,
    source,
    url: pr.html_url ?? pr.url ?? pr.pull_request?.html_url ?? null,
    title: pr.title ?? null,
    headRefName: pr.head?.ref ?? pr.headRefName ?? null,
    baseRefName: pr.base?.ref ?? pr.baseRefName ?? null,
    isDraft: Boolean(pr.draft ?? pr.isDraft),
  };
}

const eventName = getArg('--event-name') ?? process.env.GITHUB_EVENT_NAME ?? '';
const eventPath = getArg('--event-path') ?? process.env.GITHUB_EVENT_PATH ?? '';
const explicitPrNumber =
  getArg('--pr-number') ??
  process.env.PR_NUMBER ??
  process.env.INPUT_PR_NUMBER ??
  null;

let event = {};
if (eventPath && fs.existsSync(eventPath)) {
  event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
}

const pullRequests = [];
const append = (pr, source) => {
  const normalized = normalizePullRequest(pr, source);
  if (normalized) {
    pullRequests.push(normalized);
  }
};

switch (eventName) {
  case 'pull_request':
  case 'pull_request_target':
  case 'pull_request_review':
  case 'pull_request_review_comment':
    append(event.pull_request, eventName);
    break;
  case 'issue_comment':
    if (event.issue?.pull_request) {
      append(
        { number: event.issue.number, url: event.issue.pull_request.html_url },
        eventName,
      );
    }
    break;
  case 'workflow_run':
    for (const pr of event.workflow_run?.pull_requests ?? []) {
      append(pr, eventName);
    }
    break;
  case 'workflow_dispatch':
  case 'schedule':
    append({ number: explicitPrNumber ?? event.inputs?.pr_number }, eventName);
    break;
  default:
    append({ number: explicitPrNumber }, eventName || 'unknown');
    break;
}

const deduped = [];
const seen = new Set();
for (const pr of pullRequests) {
  if (seen.has(pr.number)) continue;
  seen.add(pr.number);
  deduped.push(pr);
}

process.stdout.write(
  JSON.stringify(
    {
      eventName,
      pullRequests: deduped,
      count: deduped.length,
    },
    null,
    2,
  ),
);
