/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function defaultGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function visibleCommitCountFor(pr) {
  if (!Array.isArray(pr?.commits)) return null;
  return pr.commits.length;
}

function absurdReplayThreshold(visibleCommitCount) {
  const visible = Number(visibleCommitCount);
  if (!Number.isFinite(visible) || visible < 0) return null;
  return Math.max(visible + 20, visible * 5);
}

function runGit(git, args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function asCount(value) {
  const count = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function analyzeRebaseAncestry({ pr, baseRef, git = defaultGit }) {
  const resolvedBaseRef = baseRef || pr?.baseRefName || '';
  const baseName = resolvedBaseRef ? `origin/${resolvedBaseRef}` : '';
  const visibleCommitCount = visibleCommitCountFor(pr);
  const threshold = absurdReplayThreshold(visibleCommitCount);
  const baseSha = baseName ? runGit(git, ['rev-parse', baseName]) : null;
  const headSha = runGit(git, ['rev-parse', 'HEAD']);
  const mergeBase = baseName
    ? runGit(git, ['merge-base', 'HEAD', baseName])
    : null;
  const replayCount = baseName
    ? asCount(runGit(git, ['rev-list', '--count', `${baseName}..HEAD`]))
    : null;

  let ok = true;
  let reason = '';

  if (!baseName) {
    ok = false;
    reason = 'base ref is missing';
  } else if (!baseSha) {
    ok = false;
    reason = `could not resolve ${baseName}`;
  } else if (!headSha) {
    ok = false;
    reason = 'could not resolve HEAD';
  } else if (!mergeBase) {
    ok = false;
    reason = `could not find merge base between HEAD and ${baseName}`;
  } else if (visibleCommitCount === null) {
    ok = false;
    reason = 'PR visible commit count is unavailable';
  } else if (replayCount === null) {
    ok = false;
    reason = `could not count commits in ${baseName}..HEAD`;
  } else if (replayCount > threshold) {
    ok = false;
    reason =
      `replay count ${replayCount} is too large for ${visibleCommitCount} ` +
      `visible PR commit(s) (threshold ${threshold})`;
  }

  return {
    ok,
    reason,
    base_ref: resolvedBaseRef,
    base_sha: baseSha || '',
    head_sha: headSha || '',
    merge_base: mergeBase || '',
    replay_count: replayCount === null ? '' : replayCount,
    visible_commit_count: visibleCommitCount === null ? '' : visibleCommitCount,
    replay_threshold: threshold === null ? '' : threshold,
  };
}

function emitGithubOutputs(result) {
  for (const [key, value] of Object.entries(result)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

function main() {
  const prFile = getArg('--pr-file');
  const baseRef = getArg('--base-ref');
  if (!prFile) {
    throw new Error('--pr-file is required');
  }
  const pr = JSON.parse(fs.readFileSync(prFile, 'utf8'));
  emitGithubOutputs(analyzeRebaseAncestry({ pr, baseRef }));
}

module.exports = {
  absurdReplayThreshold,
  analyzeRebaseAncestry,
  emitGithubOutputs,
  visibleCommitCountFor,
};

if (require.main === module) {
  main();
}
