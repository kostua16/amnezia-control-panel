#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Detects whether an open sibling PR from the same automation family is
 * already in review, so a workflow can skip its expensive Claude run instead
 * of stacking a duplicate.
 *
 * Matching is on the PR title prefix (anchored), not the branch-name prefix:
 * branch prefixes collide across families here (e.g. the suggest-improvements
 * branch prefix is a substring of the audit-auto-prs branch prefix), whereas
 * titles are unique and set by the workflow itself.
 *
 * Fails closed: any `gh` error exits non-zero so the run routes to
 * report-failure instead of minting the duplicate PR this check exists to
 * prevent. Fail-closed lives in this script so callers do not have to
 * reimplement the error path in bash.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}

function appendOutput(outputPath, key, value) {
  const delimiter = `EOF-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.appendFileSync(
    outputPath,
    `${key}<<${delimiter}\n${String(value ?? '')}\n${delimiter}\n`,
  );
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Returns the first open PR whose title starts with titlePrefix and whose head
 * ref is not excludeHead, or null when no such PR exists. Pure (no I/O) so it
 * can be unit-tested without mocking `gh`.
 */
function findPendingPullRequest(pullRequests, options = {}) {
  const titlePrefix = String(options.titlePrefix ?? '');
  const excludeHead = String(options.excludeHead ?? '');

  // Without a title prefix there is no "same family" to detect. Fleet
  // back-pressure-only callers pass --max-open-automation-prs with no
  // --title-prefix; returning null here keeps `pending` false so those gates
  // trip only on the automation-PR count, not on the first open PR of any kind.
  if (!titlePrefix) return null;

  for (const pullRequest of pullRequests) {
    if (!pullRequest || typeof pullRequest !== 'object') continue;

    const title = String(pullRequest.title ?? '');
    const head = String(pullRequest.headRefName ?? '');

    // A re-run reuses github.run_id, so this run's own branch name is stable
    // across retries; excluding the full head ref skips only this run's PR,
    // never a prior run of the same family.
    if (excludeHead && head === excludeHead) continue;

    // Anchored prefix match (equivalent to the original ^regex), literal so it
    // needs no escaping.
    if (!title.startsWith(titlePrefix)) continue;

    return pullRequest;
  }

  return null;
}

// Branch prefixes the autonomous fleet creates PRs from. Dependabot is
// excluded on purpose: its PRs are externally scheduled and should not
// throttle the improvement agents.
const AUTOMATION_BRANCH_PREFIXES = ['claude-', 'claude/', 'codex/'];

/**
 * Counts open PRs whose head branch belongs to the automation fleet. Used as
 * a fleet-wide back-pressure signal: when too many automation PRs are open,
 * scheduled agents skip creating more instead of stacking review debt.
 * Pure (no I/O) so it can be unit-tested without mocking `gh`.
 */
function countOpenAutomationPrs(pullRequests, options = {}) {
  const prefixes = options.prefixes ?? AUTOMATION_BRANCH_PREFIXES;
  const excludeHead = String(options.excludeHead ?? '');
  let count = 0;
  for (const pullRequest of pullRequests) {
    if (!pullRequest || typeof pullRequest !== 'object') continue;
    const head = String(pullRequest.headRefName ?? '');
    if (excludeHead && head === excludeHead) continue;
    if (prefixes.some((prefix) => head.startsWith(prefix))) count += 1;
  }
  return count;
}

function run() {
  const repo = getArg('--repo') || process.env.GITHUB_REPOSITORY;
  const baseRef = getArg('--base-ref') || 'main';
  const titlePrefix = getArg('--title-prefix') || '';
  const excludeHead = getArg('--exclude-head') || '';
  // 0 (or absent) disables fleet back-pressure; callers pass 0 on manual
  // dispatch so an operator can always force a run.
  const maxOpenAutomationPrs = Number(getArg('--max-open-automation-prs') || 0);
  const outputPath = getArg('--github-output') || process.env.GITHUB_OUTPUT;

  let openPulls;
  try {
    openPulls =
      parseJson(
        gh([
          'pr',
          'list',
          '--repo',
          repo,
          '--state',
          'open',
          '--base',
          baseRef,
          // Scan wider than gh's default of 30 so a pending sibling sitting
          // deeper in the open-PR list is not missed.
          '--limit',
          '100',
          '--json',
          'number,title,headRefName',
        ]),
      ) || [];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `::error::gh pr list failed; aborting to avoid a stacked PR. ${detail}\n`,
    );
    process.exit(1);
  }

  const pending = findPendingPullRequest(openPulls, {
    titlePrefix,
    excludeHead,
  });
  const openAutomationPrs = countOpenAutomationPrs(openPulls, { excludeHead });
  const backpressure =
    maxOpenAutomationPrs > 0 && openAutomationPrs >= maxOpenAutomationPrs;
  // `pending` doubles as the single skip gate existing workflows already
  // check (`if: steps.<id>.outputs.pending != 'true'`), so back-pressure
  // trips it too; `skip_reason` disambiguates in the run log.
  const result = {
    pending: pending || backpressure ? 'true' : 'false',
    pending_pr: pending ? String(pending.number) : '',
    backpressure: backpressure ? 'true' : 'false',
    open_automation_prs: String(openAutomationPrs),
    skip_reason: pending
      ? `same-family PR #${pending.number} is already open`
      : backpressure
        ? `fleet back-pressure: ${openAutomationPrs} open automation PRs >= ${maxOpenAutomationPrs}`
        : '',
  };

  if (result.skip_reason) {
    process.stdout.write(`Skipping run: ${result.skip_reason}\n`);
  }

  if (outputPath) {
    for (const [key, value] of Object.entries(result)) {
      appendOutput(outputPath, key, value);
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { countOpenAutomationPrs, findPendingPullRequest };

if (require.main === module) {
  run();
}
