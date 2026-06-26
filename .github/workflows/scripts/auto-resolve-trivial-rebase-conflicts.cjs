/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REGULAR_FILE_MODES = new Set(['100644', '100755']);

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function defaultGit(args, options = {}) {
  return execFileSync('git', args, {
    encoding: options.encoding === 'buffer' ? 'buffer' : 'utf8',
  });
}

function runGit(git, args, options = {}) {
  try {
    return { ok: true, stdout: git(args, options) };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout ?? '',
      stderr: error?.stderr ?? error?.message ?? '',
    };
  }
}

function parseUnmergedEntries(output) {
  return String(output ?? '')
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+) ([0-9a-f]+) ([123])\t(.+)$/.exec(line);
      if (!match) {
        throw new Error(`could not parse unmerged index entry: ${line}`);
      }
      return {
        mode: match[1],
        oid: match[2],
        stage: Number(match[3]),
        path: match[4],
      };
    });
}

function groupEntriesByPath(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.path)) groups.set(entry.path, []);
    groups.get(entry.path).push(entry);
  }
  return groups;
}

function analyzeTrivialConflicts(entries) {
  if (entries.length === 0) {
    return { ok: true, conflicts: [], reason: '' };
  }

  const conflicts = [];
  for (const [filePath, pathEntries] of groupEntriesByPath(entries)) {
    const byStage = new Map();
    for (const entry of pathEntries) {
      if (byStage.has(entry.stage)) {
        return {
          ok: false,
          conflicts: [],
          reason: `multiple stage ${entry.stage} entries for ${filePath}`,
        };
      }
      byStage.set(entry.stage, entry);
    }

    const ours = byStage.get(2);
    const theirs = byStage.get(3);
    if (!ours || !theirs) {
      return {
        ok: false,
        conflicts: [],
        reason: `missing stage 2 or stage 3 entry for ${filePath}`,
      };
    }
    if (ours.mode !== theirs.mode) {
      return {
        ok: false,
        conflicts: [],
        reason: `mode mismatch for ${filePath}: ${ours.mode} vs ${theirs.mode}`,
      };
    }
    if (!REGULAR_FILE_MODES.has(ours.mode)) {
      return {
        ok: false,
        conflicts: [],
        reason: `unsupported file mode ${ours.mode} for ${filePath}`,
      };
    }
    if (ours.oid !== theirs.oid) {
      return {
        ok: false,
        conflicts: [],
        reason: `content differs for ${filePath}`,
      };
    }

    conflicts.push({ path: filePath, mode: ours.mode, oid: ours.oid });
  }

  return { ok: true, conflicts, reason: '' };
}

function isRebaseInProgress(git, fsImpl = fs) {
  const gitDirResult = runGit(git, ['rev-parse', '--git-dir']);
  if (!gitDirResult.ok) return false;
  const gitDir = String(gitDirResult.stdout).trim();
  return (
    fsImpl.existsSync(path.join(gitDir, 'rebase-merge')) ||
    fsImpl.existsSync(path.join(gitDir, 'rebase-apply'))
  );
}

function writeBlobToWorktree({ git, fsImpl = fs, conflict }) {
  const blob = git(['cat-file', '-p', conflict.oid], { encoding: 'buffer' });
  const dirname = path.dirname(conflict.path);
  if (dirname && dirname !== '.') {
    fsImpl.mkdirSync(dirname, { recursive: true });
  }
  fsImpl.writeFileSync(conflict.path, blob);
  fsImpl.chmodSync(conflict.path, conflict.mode === '100755' ? 0o755 : 0o644);
  git(['add', '--', conflict.path]);
}

function outputValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value).replace(/\r?\n/g, ' ');
}

function result({ attempted, resolvedPaths, rebaseComplete, reason = '' }) {
  return {
    attempted,
    resolved: resolvedPaths.length > 0,
    rebase_complete: rebaseComplete,
    resolved_count: resolvedPaths.length,
    resolved_paths: resolvedPaths,
    reason,
  };
}

function autoResolveTrivialRebaseConflicts({
  git = defaultGit,
  fsImpl = fs,
  maxIterations = 50,
  rebaseInProgress = () => isRebaseInProgress(git, fsImpl),
} = {}) {
  const resolvedPaths = [];
  let attempted = false;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const entriesResult = runGit(git, ['ls-files', '-u', '-z']);
    if (!entriesResult.ok) {
      return result({
        attempted,
        resolvedPaths,
        rebaseComplete: false,
        reason: `could not inspect unmerged index entries: ${entriesResult.stderr}`,
      });
    }

    const entries = parseUnmergedEntries(entriesResult.stdout);
    if (entries.length === 0) {
      return result({
        attempted,
        resolvedPaths,
        rebaseComplete: !rebaseInProgress(),
        reason:
          resolvedPaths.length > 0
            ? 'all trivial conflicts resolved'
            : 'no unmerged entries',
      });
    }

    attempted = true;
    const analysis = analyzeTrivialConflicts(entries);
    if (!analysis.ok) {
      return result({
        attempted,
        resolvedPaths,
        rebaseComplete: false,
        reason: analysis.reason,
      });
    }

    for (const conflict of analysis.conflicts) {
      writeBlobToWorktree({ git, fsImpl, conflict });
      resolvedPaths.push(conflict.path);
    }

    const continueResult = runGit(git, [
      '-c',
      'core.editor=true',
      'rebase',
      '--continue',
    ]);
    if (!continueResult.ok) {
      return result({
        attempted,
        resolvedPaths,
        rebaseComplete: false,
        reason: `git rebase --continue failed: ${continueResult.stderr}`,
      });
    }
  }

  return result({
    attempted,
    resolvedPaths,
    rebaseComplete: false,
    reason: `max iteration count ${maxIterations} reached`,
  });
}

function emitGithubOutputs(outputs) {
  for (const [key, value] of Object.entries(outputs)) {
    process.stdout.write(`${key}=${outputValue(value)}\n`);
  }
}

function main() {
  const maxIterations = Number.parseInt(
    getArg('--max-iterations', process.env.MAX_ITERATIONS || '50'),
    10,
  );
  emitGithubOutputs(
    autoResolveTrivialRebaseConflicts({
      maxIterations: Number.isFinite(maxIterations) ? maxIterations : 50,
    }),
  );
}

module.exports = {
  REGULAR_FILE_MODES,
  analyzeTrivialConflicts,
  autoResolveTrivialRebaseConflicts,
  emitGithubOutputs,
  isRebaseInProgress,
  parseUnmergedEntries,
};

if (require.main === module) {
  main();
}
