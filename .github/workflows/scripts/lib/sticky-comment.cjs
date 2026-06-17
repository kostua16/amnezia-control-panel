/* eslint-disable @typescript-eslint/no-require-imports */
// Shared infrastructure for "sticky" PR comments: find one bot-authored comment
// by its hidden HTML marker, then create-or-update it in place. Extracted from
// upsert-code-review-comment.cjs / upsert-pr-size-comment.cjs /
// orchestrate-pr-flow.cjs so the marker-upsert logic lives in one place.
//
// Each caller owns its distinct COMMENT_MARKER string and its domain-specific
// renderers; this module owns only the generic find/list/upsert plumbing and a
// few pure presentation helpers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

function listComments(repo, prNumber) {
  return runJson(
    'gh',
    ['api', `repos/${repo}/issues/${prNumber}/comments`, '--paginate'],
    [],
  );
}

// Find the single bot-authored comment whose body carries `marker`. `marker` is
// required so each caller's sticky comment is addressed independently.
function findExistingComment(
  comments,
  marker,
  botLogin = 'github-actions[bot]',
) {
  return (
    comments.find(
      (comment) =>
        comment.user?.login === botLogin &&
        String(comment.body ?? '').includes(marker),
    ) ?? null
  );
}

// Create the sticky comment if absent, otherwise overwrite the existing one.
// `marker` identifies which sticky comment family to update.
function upsertComment({ repo, prNumber, marker, body }) {
  const existing = findExistingComment(listComments(repo, prNumber), marker);
  const payloadPath = writeTempJson('sticky-comment', { body });

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

// Prefix every line with "> " so multi-line text stays inside a Markdown
// blockquote instead of leaking into the surrounding body.
function quoteBlock(text) {
  return String(text)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function shortSha(sha) {
  return sha ? String(sha).slice(0, 12) : 'unknown';
}

// Defensively parse structured model output: empty/invalid JSON -> {}.
function parseStructuredOutput(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

module.exports = {
  getRepoSlug,
  run,
  runJson,
  writeTempJson,
  listComments,
  findExistingComment,
  upsertComment,
  quoteBlock,
  shortSha,
  parseStructuredOutput,
};
