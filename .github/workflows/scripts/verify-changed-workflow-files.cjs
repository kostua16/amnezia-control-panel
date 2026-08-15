#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Monitor post-agent gate: actionlint/shellcheck only the changed files.
// A repo-wide actionlint scan failed run 29803905118 on unrelated
// fix-review.yml SC2129 (#881).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ACTIONLINT_MISSING =
  'actionlint is required for workflow/action YAML changes';
const SHELLCHECK_MISSING = 'shellcheck is required for shell script changes';

function parseChangedFiles(raw) {
  const text = String(raw ?? '');
  let files = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) files = parsed;
  } catch {
    /* JSON or newline/comma list */
  }
  if (files.length === 0) {
    files = text.split(/\r?\n|,/);
  }
  return [...new Set(files.map((file) => String(file).trim()).filter(Boolean))];
}

function normalizeRepoPath(file) {
  return String(file).replace(/\\/g, '/');
}

function isWorkflowOrActionYaml(file) {
  const normalized = normalizeRepoPath(file);
  return (
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(normalized) ||
    /^\.github\/actions\/.+\.ya?ml$/.test(normalized)
  );
}

function isShellScript(file) {
  return normalizeRepoPath(file).endsWith('.sh');
}

function classifyChangedFiles(
  files,
  { cwd = process.cwd(), existsSync = fs.existsSync } = {},
) {
  const workflowYamlFiles = [];
  const shellFiles = [];
  for (const file of files) {
    const abs = path.isAbsolute(file) ? file : path.join(cwd, file);
    if (!existsSync(abs)) continue;
    if (isWorkflowOrActionYaml(file)) workflowYamlFiles.push(file);
    else if (isShellScript(file)) shellFiles.push(file);
  }
  return { workflowYamlFiles, shellFiles };
}

function isRunnableCandidate(candidate) {
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch {
    return false;
  }
  // existsSync is true for directories (and on Unix for non-executables).
  // command -v used access(X_OK); a mode-bit check is broader (other/group
  // execute the process is not in) and still EACCES-aborts. Skip non-files
  // and anything this process cannot execute, then keep searching PATH.
  if (!stat.isFile()) return false;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommand(name, env = process.env) {
  const pathEnv = env.PATH || env.Path || '';
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').concat('')
      : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (isRunnableCandidate(candidate)) return candidate;
    }
  }
  return null;
}

function hasCommand(name, env = process.env) {
  return Boolean(resolveCommand(name, env));
}

function runTool(exec, name, args, { cwd, env }) {
  const bin = resolveCommand(name, env) || name;
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
  return exec(bin, args, { cwd, env, stdio: 'inherit', shell });
}

function verifyChangedWorkflowFiles(options = {}) {
  const {
    rawChangedFiles = process.env.CHANGED_FILES || '',
    cwd = process.cwd(),
    env = process.env,
    exec = execFileSync,
    existsSync = fs.existsSync,
    log = console,
  } = options;

  const files = parseChangedFiles(rawChangedFiles);
  if (files.length === 0) {
    log.log('No changed files to verify.');
    return { status: 0, workflowYamlFiles: [], shellFiles: [], skipped: true };
  }

  const { workflowYamlFiles, shellFiles } = classifyChangedFiles(files, {
    cwd,
    existsSync,
  });

  if (workflowYamlFiles.length > 0) {
    if (!hasCommand('actionlint', env)) {
      log.error(`::error::${ACTIONLINT_MISSING}`);
      return {
        status: 1,
        workflowYamlFiles,
        shellFiles,
        error: ACTIONLINT_MISSING,
      };
    }
    runTool(
      exec,
      'actionlint',
      ['-config-file', '.github/actionlint.yaml', ...workflowYamlFiles],
      { cwd, env },
    );
  }

  if (shellFiles.length > 0) {
    if (!hasCommand('shellcheck', env)) {
      log.error(`::error::${SHELLCHECK_MISSING}`);
      return {
        status: 1,
        workflowYamlFiles,
        shellFiles,
        error: SHELLCHECK_MISSING,
      };
    }
    runTool(exec, 'shellcheck', shellFiles, { cwd, env });
  }

  return { status: 0, workflowYamlFiles, shellFiles };
}

if (require.main === module) {
  try {
    process.exit(verifyChangedWorkflowFiles().status);
  } catch (err) {
    if (err && Number.isInteger(err.status)) process.exit(err.status);
    throw err;
  }
}

module.exports = {
  ACTIONLINT_MISSING,
  SHELLCHECK_MISSING,
  parseChangedFiles,
  classifyChangedFiles,
  isWorkflowOrActionYaml,
  isShellScript,
  resolveCommand,
  hasCommand,
  verifyChangedWorkflowFiles,
};
