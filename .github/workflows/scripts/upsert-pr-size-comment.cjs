/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const COMMENT_MARKER = '<!-- pr-size-guard -->';
const LARGE_PR_LABEL = 'large-pr';
const DEFAULT_THRESHOLD = 500;

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRepoSlug() {
  const repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('GH_REPO or GITHUB_REPOSITORY is required.');
  }
  return repo;
}

function run(command, args, options = {}) {
  try {
    return (
      execFileSync(command, args, {
        encoding: 'utf8',
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) ?? ''
    ).trim();
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim();
    if (options.allowFailure) {
      return options.fallback ?? '';
    }

    if (stderr) {
      console.error(stderr);
    }
    throw error;
  }
}

function runJson(command, args, fallback = []) {
  const output = run(command, args, {
    allowFailure: fallback !== undefined,
    fallback: JSON.stringify(fallback),
  });
  return output ? JSON.parse(output) : fallback;
}

function writeTempJson(prefix, payload) {
  const filePath = path.join(
    os.tmpdir(),
    `${prefix}-${process.pid}-${Date.now()}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  return filePath;
}

function buildCommentBody(total, files) {
  return [
    COMMENT_MARKER,
    `> **Large PR** (${total} lines across ${files} files)`,
    '>',
    '> Consider splitting into smaller, focused PRs for easier review.',
  ].join('\n');
}

function findExistingComment(comments) {
  return (
    comments.find(
      (comment) =>
        comment.user?.login === 'github-actions[bot]' &&
        String(comment.body ?? '').includes(COMMENT_MARKER),
    ) ?? null
  );
}

function listComments(repo, prNumber) {
  return runJson(
    'gh',
    ['api', `repos/${repo}/issues/${prNumber}/comments`, '--paginate'],
    [],
  );
}

function upsertLargePrComment({ repo, prNumber, total, files }) {
  const existing = findExistingComment(listComments(repo, prNumber));
  const payloadPath = writeTempJson('pr-size-comment', {
    body: buildCommentBody(total, files),
  });

  try {
    if (existing) {
      run('gh', [
        'api',
        '-X',
        'PATCH',
        `repos/${repo}/issues/comments/${existing.id}`,
        '--input',
        payloadPath,
      ]);
      return;
    }

    run('gh', [
      'api',
      '-X',
      'POST',
      `repos/${repo}/issues/${prNumber}/comments`,
      '--input',
      payloadPath,
    ]);
  } finally {
    fs.rmSync(payloadPath, { force: true });
  }
}

function deleteLargePrComment({ repo, prNumber }) {
  const existing = findExistingComment(listComments(repo, prNumber));
  if (!existing) {
    return;
  }

  run('gh', [
    'api',
    '-X',
    'DELETE',
    `repos/${repo}/issues/comments/${existing.id}`,
  ]);
}

function shouldWarnLargePr(total, threshold = DEFAULT_THRESHOLD) {
  return total > threshold;
}

function syncLargePrLabel({ repo, prNumber, shouldWarn }) {
  const command = shouldWarn ? '--add-label' : '--remove-label';
  run(
    'gh',
    ['pr', 'edit', String(prNumber), '--repo', repo, command, LARGE_PR_LABEL],
    { allowFailure: true },
  );
}

function main() {
  const repo = getRepoSlug();
  const prNumber = toNumber(getArg('--pr', getArg('--pr-number')));
  const total = toNumber(getArg('--total'));
  const files = toNumber(getArg('--files'));
  const threshold = toNumber(getArg('--threshold')) ?? DEFAULT_THRESHOLD;

  if (prNumber === null || total === null || files === null) {
    throw new Error('--pr, --total, and --files are required numeric flags.');
  }

  const warn = shouldWarnLargePr(total, threshold);
  if (warn) {
    upsertLargePrComment({ repo, prNumber, total, files });
  } else {
    deleteLargePrComment({ repo, prNumber });
  }

  syncLargePrLabel({ repo, prNumber, shouldWarn: warn });
}

if (require.main === module) {
  main();
}

module.exports = {
  COMMENT_MARKER,
  DEFAULT_THRESHOLD,
  LARGE_PR_LABEL,
  buildCommentBody,
  findExistingComment,
  shouldWarnLargePr,
};
