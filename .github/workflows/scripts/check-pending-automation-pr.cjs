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
    if (titlePrefix && !title.startsWith(titlePrefix)) continue;

    return pullRequest;
  }

  return null;
}

function run() {
  const repo = getArg('--repo') || process.env.GITHUB_REPOSITORY;
  const baseRef = getArg('--base-ref') || 'main';
  const titlePrefix = getArg('--title-prefix') || '';
  const excludeHead = getArg('--exclude-head') || '';
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

  const pending = findPendingPullRequest(openPulls, { titlePrefix, excludeHead });
  const result = {
    pending: pending ? 'true' : 'false',
    pending_pr: pending ? String(pending.number) : '',
  };

  if (outputPath) {
    for (const [key, value] of Object.entries(result)) {
      appendOutput(outputPath, key, value);
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { findPendingPullRequest };

if (require.main === module) {
  run();
}
