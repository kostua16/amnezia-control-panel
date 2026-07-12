#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const { execFileSync } = require('child_process');
const fs = require('fs');

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? '';
}

function getFlag(name) {
  return process.argv.includes(name);
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

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function gh(args, options = {}) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function isGhNotFoundError(error) {
  const output = [
    error?.stdout,
    error?.stderr,
    Array.isArray(error?.output) ? error.output.join('\n') : '',
    error?.message,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    /\bHTTP 404\b/.test(output) ||
    /"status"\s*:\s*"?404"?/.test(output) ||
    /"message"\s*:\s*"Not Found"/.test(output)
  );
}

function normalizePatch(patch) {
  return String(patch || '')
    .replace(/\r/g, '')
    .trim();
}

function isCommentOnlyContent(content) {
  const trimmed = String(content || '').trim();
  if (!trimmed) return true;

  return (
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    trimmed === '/*' ||
    trimmed === '*/' ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('<!--') ||
    /^--(\s|$)/.test(trimmed)
  );
}

function normalizeSubstantivePatch(patch) {
  return String(patch || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => {
      if (!line || line.startsWith('@@')) return false;
      if (!line.startsWith('+') && !line.startsWith('-')) return false;
      return !isCommentOnlyContent(line.slice(1));
    })
    .join('\n')
    .trim();
}

function normalizeFilePatch(file) {
  const path = String(file?.path ?? file?.filename ?? '').trim();
  if (!path) return null;
  return {
    path,
    patch: normalizePatch(file?.patch),
  };
}

function sortedFilePatches(files) {
  return files
    .map(normalizeFilePatch)
    .filter(Boolean)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function extractPatchFromGitDiff(diffText) {
  const lines = String(diffText || '')
    .replace(/\r/g, '')
    .split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  if (firstHunk === -1) return '';
  return lines.slice(firstHunk).join('\n').trim();
}

function collectWorkingTreeFilePatches(baseRef) {
  // Automation workflows (fix-issue, audit-auto-prs, …) run this step while
  // Claude's edits are still uncommitted in the working tree, and
  // actions/checkout uses fetch-depth: 1, so HEAD == origin/<base-ref>. Diffing
  // committed state only (origin/<base-ref>...HEAD, HEAD~1..HEAD) therefore sees
  // nothing and the duplicate/overlap check silently short-circuits. Stage the
  // working tree and diff the index against the base ref so uncommitted edits —
  // including new untracked source files — become visible. gitignored runtime
  // artifacts (.claude-pr/, node_modules, …) are not staged, so this stays
  // scoped to real source changes; commit-and-push re-runs `git add -A`
  // regardless, so staging here has no net side effect.
  const base = `origin/${baseRef}`;
  try {
    git(['add', '-A']);
    const names = git([
      'diff',
      '--cached',
      '--name-only',
      '--diff-filter=ACMR',
      base,
    ])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (names.length === 0) return [];

    const files = names.map((path) => ({
      path,
      patch: extractPatchFromGitDiff(
        git(['diff', '--cached', '--no-color', base, '--', path]),
      ),
    }));

    return sortedFilePatches(files);
  } catch (err) {
    // Base ref unavailable or git unusable — fall back to committed-state diffs.
    // Surface the failure so a no-op regression (inert dedup/overlap detection
    // across every workflow sharing this script) stays observable in workflow
    // output instead of silently short-circuiting to "No local diff detected."
    console.warn(
      `collectWorkingTreeFilePatches: staged-working-tree diff against origin/${baseRef} failed (${err && err.message ? err.message : err}); falling back to committed-state diffs.`,
    );
    return [];
  }
}

function collectLocalFilePatches(baseRef) {
  const workingTreeFiles = collectWorkingTreeFilePatches(baseRef);
  if (workingTreeFiles.length > 0) return workingTreeFiles;

  // Fallback for contexts where the changes are already committed and the
  // working tree is clean (e.g. a local dev run after committing).
  const diffTargets = [
    `origin/${baseRef}...HEAD`,
    `${baseRef}...HEAD`,
    'HEAD~1..HEAD',
  ];

  for (const target of diffTargets) {
    try {
      const names = git(['diff', '--name-only', '--diff-filter=ACMR', target])
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (names.length === 0) continue;

      const files = names.map((path) => ({
        path,
        patch: extractPatchFromGitDiff(
          git(['diff', '--no-color', target, '--', path]),
        ),
      }));

      return sortedFilePatches(files);
    } catch {
      // Fall through to the next diff target.
    }
  }

  return [];
}

function hasExactDuplicate(localFiles, remoteFiles) {
  if (!localFiles.length || localFiles.length !== remoteFiles.length) {
    return false;
  }

  const local = sortedFilePatches(localFiles);
  const remote = sortedFilePatches(remoteFiles);

  return local.every(
    (file, index) =>
      file.path === remote[index]?.path && file.patch === remote[index]?.patch,
  );
}

function hasEquivalentDuplicate(localFiles, remoteFiles) {
  if (!localFiles.length || localFiles.length !== remoteFiles.length) {
    return false;
  }

  const local = sortedFilePatches(localFiles);
  const remote = sortedFilePatches(remoteFiles);

  const localSubstantive = local.map((file) => ({
    path: file.path,
    patch: normalizeSubstantivePatch(file.patch),
  }));
  const remoteSubstantive = remote.map((file) => ({
    path: file.path,
    patch: normalizeSubstantivePatch(file.patch),
  }));

  if (localSubstantive.every((file) => !file.patch)) {
    return false;
  }

  return localSubstantive.every(
    (file, index) =>
      file.path === remoteSubstantive[index]?.path &&
      file.patch === remoteSubstantive[index]?.patch,
  );
}

function hasFileOverlap(localFiles, remoteFiles) {
  const localPaths = new Set(
    localFiles
      .map((file) => String(file?.path ?? file?.filename ?? '').trim())
      .filter(Boolean),
  );
  if (localPaths.size === 0) return false;

  return remoteFiles.some((file) =>
    localPaths.has(String(file?.path ?? file?.filename ?? '').trim()),
  );
}

function findDuplicatePullRequest(localFiles, pullRequests, getFiles) {
  let equivalentDuplicate = null;

  for (const pullRequest of pullRequests) {
    const remoteFiles = getFiles(pullRequest);
    if (hasExactDuplicate(localFiles, remoteFiles)) {
      return {
        matchKind: 'exact',
        pullRequest,
      };
    }
    if (
      !equivalentDuplicate &&
      hasEquivalentDuplicate(localFiles, remoteFiles)
    ) {
      equivalentDuplicate = {
        matchKind: 'equivalent',
        pullRequest,
      };
    }
  }

  return equivalentDuplicate;
}

function createPullRequestFileGetter(
  repo,
  ghCommand = gh,
  warn = console.warn,
) {
  const pullRequestFiles = new Map();

  return (pullRequest) => {
    const number = Number(pullRequest.number);
    if (!pullRequestFiles.has(number)) {
      try {
        pullRequestFiles.set(
          number,
          parseJson(
            ghCommand([
              'api',
              `repos/${repo}/pulls/${number}/files?per_page=100`,
            ]),
          ) || [],
        );
      } catch (error) {
        if (!isGhNotFoundError(error)) {
          throw error;
        }
        warn(
          `Skipping PR #${number}; GitHub no longer exposes its files payload.`,
        );
        pullRequestFiles.set(number, []);
      }
    }
    return pullRequestFiles.get(number);
  };
}

function run() {
  const repo = getArg('--repo') || process.env.GITHUB_REPOSITORY;
  const baseRef = getArg('--base-ref') || 'main';
  const titlePrefix = getArg('--title-prefix') || '';
  const excludeHead = getArg('--exclude-head') || '';
  const detectOverlap = getFlag('--detect-overlap');
  const overlapLabel = getArg('--overlap-label') || '';
  const outputPath = getArg('--github-output') || process.env.GITHUB_OUTPUT;

  const result = {
    duplicate_found: 'false',
    duplicate_pr_number: '',
    duplicate_pr_url: '',
    duplicate_pr_branch: '',
    duplicate_reason: '',
    overlap_found: 'false',
    overlap_pr_number: '',
    overlap_pr_url: '',
    overlap_pr_branch: '',
    overlap_reason: '',
  };

  const localFiles = collectLocalFilePatches(baseRef);
  if (localFiles.length === 0) {
    result.duplicate_reason = 'No local diff detected.';
  } else {
    const openPulls =
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
          '--limit',
          '100',
          '--json',
          'number,title,url,headRefName,labels',
        ]),
      ) || [];

    const candidates = openPulls.filter((pullRequest) => {
      if (!pullRequest || typeof pullRequest !== 'object') return false;
      if (excludeHead && pullRequest.headRefName === excludeHead) return false;
      if (
        titlePrefix &&
        !String(pullRequest.title || '').startsWith(titlePrefix)
      ) {
        return false;
      }
      return true;
    });

    const getPullRequestFiles = createPullRequestFileGetter(repo);

    const duplicate = findDuplicatePullRequest(
      localFiles,
      candidates,
      getPullRequestFiles,
    );

    if (duplicate) {
      const duplicatePullRequest = duplicate.pullRequest;
      result.duplicate_found = 'true';
      result.duplicate_pr_number = String(duplicatePullRequest.number);
      result.duplicate_pr_url = String(duplicatePullRequest.url || '');
      result.duplicate_pr_branch = String(
        duplicatePullRequest.headRefName || '',
      );
      result.duplicate_reason =
        duplicate.matchKind === 'exact'
          ? `Exact duplicate diff already exists in PR #${duplicatePullRequest.number}.`
          : `Equivalent duplicate diff already exists in PR #${duplicatePullRequest.number}; differences are comment-only.`;
    } else {
      result.duplicate_reason = 'No exact duplicate open pull request found.';
    }

    if (detectOverlap) {
      // Overlap intentionally ignores --title-prefix: each generator scopes its
      // own duplicate check by title, so cross-family PRs editing the same
      // shared workflow/helper file would otherwise be invisible to each other
      // and produce conflicting same-file PRs. Filter to automation PRs via an
      // optional label to avoid deferring against unrelated human/dependabot PRs.
      const duplicateNumber = result.duplicate_pr_number;
      const overlapCandidates = openPulls.filter((pullRequest) => {
        if (!pullRequest || typeof pullRequest !== 'object') return false;
        if (excludeHead && pullRequest.headRefName === excludeHead)
          return false;
        if (duplicateNumber && String(pullRequest.number) === duplicateNumber) {
          return false;
        }
        if (overlapLabel) {
          const labels = Array.isArray(pullRequest.labels)
            ? pullRequest.labels.map((label) =>
                String(label?.name ?? label ?? ''),
              )
            : [];
          if (!labels.includes(overlapLabel)) return false;
        }
        return true;
      });

      for (const pullRequest of overlapCandidates) {
        const files = getPullRequestFiles(pullRequest);
        if (hasFileOverlap(localFiles, files)) {
          result.overlap_found = 'true';
          result.overlap_pr_number = String(pullRequest.number);
          result.overlap_pr_url = String(pullRequest.url || '');
          result.overlap_pr_branch = String(pullRequest.headRefName || '');
          result.overlap_reason = `Open PR #${pullRequest.number} already edits one or more of the same files; deferring to avoid a conflicting same-file edit.`;
          break;
        }
      }

      if (result.overlap_found !== 'true') {
        result.overlap_reason =
          'No open pull request overlaps the changed files.';
      }
    }
  }

  if (outputPath) {
    for (const [key, value] of Object.entries(result)) {
      appendOutput(outputPath, key, value);
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = {
  collectLocalFilePatches,
  collectWorkingTreeFilePatches,
  createPullRequestFileGetter,
  extractPatchFromGitDiff,
  findDuplicatePullRequest,
  hasExactDuplicate,
  hasEquivalentDuplicate,
  hasFileOverlap,
  isGhNotFoundError,
  normalizePatch,
  normalizeSubstantivePatch,
  sortedFilePatches,
};

if (require.main === module) {
  run();
}
