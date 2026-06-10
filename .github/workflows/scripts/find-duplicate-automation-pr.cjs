#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

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

function normalizePatch(patch) {
  return String(patch || '')
    .replace(/\r/g, '')
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

function collectLocalFilePatches(baseRef) {
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

function findExactDuplicatePullRequest(localFiles, pullRequests, getFiles) {
  for (const pullRequest of pullRequests) {
    const remoteFiles = getFiles(pullRequest);
    if (hasExactDuplicate(localFiles, remoteFiles)) {
      return pullRequest;
    }
  }

  return null;
}

function run() {
  const repo = getArg('--repo') || process.env.GITHUB_REPOSITORY;
  const baseRef = getArg('--base-ref') || 'main';
  const titlePrefix = getArg('--title-prefix') || '';
  const excludeHead = getArg('--exclude-head') || '';
  const outputPath = getArg('--github-output') || process.env.GITHUB_OUTPUT;

  const result = {
    duplicate_found: 'false',
    duplicate_pr_number: '',
    duplicate_pr_url: '',
    duplicate_pr_branch: '',
    duplicate_reason: '',
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
          'number,title,url,headRefName',
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

    const duplicate = findExactDuplicatePullRequest(
      localFiles,
      candidates,
      (pullRequest) => {
        const files =
          parseJson(
            gh([
              'api',
              `repos/${repo}/pulls/${pullRequest.number}/files?per_page=100`,
            ]),
          ) || [];
        return files;
      },
    );

    if (duplicate) {
      result.duplicate_found = 'true';
      result.duplicate_pr_number = String(duplicate.number);
      result.duplicate_pr_url = String(duplicate.url || '');
      result.duplicate_pr_branch = String(duplicate.headRefName || '');
      result.duplicate_reason = `Exact duplicate diff already exists in PR #${duplicate.number}.`;
    } else {
      result.duplicate_reason = 'No exact duplicate open pull request found.';
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
  extractPatchFromGitDiff,
  findExactDuplicatePullRequest,
  hasExactDuplicate,
  normalizePatch,
  sortedFilePatches,
};

if (require.main === module) {
  run();
}
