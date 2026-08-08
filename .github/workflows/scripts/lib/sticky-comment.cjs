/* eslint-disable @typescript-eslint/no-require-imports */
// Shared infrastructure for "sticky" PR comments: find one bot-authored comment
// by its hidden HTML marker, then create-or-update it. Extracted from
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
const { MAX_RETRIES, RETRY_BASE_MS, isTransient } = require('./retry.cjs');

function getRepoSlug() {
  const repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('GH_REPO or GITHUB_REPOSITORY is required.');
  }
  return repo;
}

function run(command, args, options = {}) {
  const retryEnabled = options.retry === true;
  for (let attempt = 0; ; attempt++) {
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
      // Retry transient errors only when the caller opts in with `retry: true`,
      // and do it BEFORE the allowFailure short-circuit. Read paths (listComments
      // via runJson, fallback []) must actually retry, or a transient 504 yields
      // [] and upsertComment posts a duplicate sticky comment. Mutating callers
      // (POST/PATCH/DELETE) leave `retry` off: a retry issued after GitHub
      // already applied the change would post a duplicate comment (or delete a
      // second id) on a late 504.
      if (retryEnabled && attempt < MAX_RETRIES - 1 && isTransient(stderr)) {
        const delay = RETRY_BASE_MS * 2 ** attempt;
        console.warn(
          `sticky-comment: transient HTTP error on attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${delay}ms: ${stderr.split('\n')[0]}`,
        );
        // Synchronous sleep without burning a CPU core. Runners are Linux, so
        // GNU sleep accepts fractional seconds; execFileSync is already imported.
        execFileSync('sleep', [String(delay / 1000)], { stdio: 'ignore' });
        continue;
      }
      if (options.allowFailure) {
        return options.fallback ?? '';
      }
      if (stderr) {
        console.error(stderr);
      }
      throw error;
    }
  }
}

function runJson(command, args, fallback = []) {
  // Idempotent GETs (e.g. listComments): retry transient errors so a 504 does
  // not silently collapse to the fallback and cause a duplicate sticky comment.
  const output = run(command, args, {
    retry: true,
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

// Create the sticky comment if absent, otherwise replace the existing one so
// the refreshed report appears as the latest PR timeline comment. Callers can
// opt out with replaceExisting: false when they need to preserve comment URLs.
// `marker` identifies which sticky comment family to update.
function upsertComment({
  repo,
  prNumber,
  marker,
  body,
  replaceExisting = true,
}) {
  const existing = findExistingComment(listComments(repo, prNumber), marker);
  const payloadPath = writeTempJson('sticky-comment', { body });

  try {
    if (existing && !replaceExisting) {
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

    // Create the replacement before deleting the prior comment so the marker
    // is never absent if the create fails (delete-then-create would lose it).
    run('gh', [
      'api',
      '-X',
      'POST',
      `repos/${repo}/issues/${prNumber}/comments`,
      '--input',
      payloadPath,
    ]);

    if (existing) {
      try {
        run('gh', [
          'api',
          '-X',
          'DELETE',
          `repos/${repo}/issues/comments/${existing.id}`,
        ]);
      } catch (deleteError) {
        // A failed DELETE after a successful POST leaves two comments with the
        // same marker.  Log the orphan ID so a future sweep can clean it up
        // instead of propagating the error — the new comment is already live.
        console.error(
          `sticky-comment: failed to delete orphan comment ${existing.id} on ${repo}#${prNumber}: ${deleteError.message}`,
        );
      }
    }
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
  isTransient,
  writeTempJson,
  listComments,
  findExistingComment,
  upsertComment,
  quoteBlock,
  shortSha,
  parseStructuredOutput,
};
