#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Monitor post-agent gate: actionlint/shellcheck only the changed files.
// A repo-wide actionlint scan failed run 29803905118 on unrelated
// fix-review.yml SC2129 (#881).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');

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
    /^\.github\/actions\/(?:[^/]+\/)+action\.ya?ml$/.test(normalized)
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
  const actionYamlFiles = [];
  const shellFiles = [];
  for (const file of files) {
    const abs = path.isAbsolute(file) ? file : path.join(cwd, file);
    if (!existsSync(abs)) continue;
    if (isWorkflowOrActionYaml(file)) {
      if (normalizeRepoPath(file).startsWith('.github/actions/')) {
        actionYamlFiles.push(file);
      } else {
        workflowYamlFiles.push(file);
      }
    } else if (isShellScript(file)) shellFiles.push(file);
  }
  return { workflowYamlFiles, actionYamlFiles, shellFiles };
}

function validateActionManifest(file, cwd) {
  const manifest = yaml.load(fs.readFileSync(path.resolve(cwd, file), 'utf8'));
  if (
    typeof manifest?.name !== 'string' ||
    typeof manifest.description !== 'string' ||
    typeof manifest.runs?.using !== 'string'
  ) {
    throw new Error(
      'Action metadata requires name, description, and runs.using',
    );
  }
  const { runs, inputs, outputs } = manifest;
  switch (runs.using) {
    case 'composite':
      if (!Array.isArray(runs.steps)) {
        throw new Error('Composite action requires runs.steps');
      }
      break;
    case 'node20':
    case 'node24':
      if (typeof runs.main !== 'string' || !runs.main.trim()) {
        throw new Error('JavaScript action requires runs.main');
      }
      break;
    case 'docker':
      if (typeof runs.image !== 'string' || !runs.image.trim()) {
        throw new Error('Docker action requires runs.image');
      }
      break;
    default:
      throw new Error(`Unsupported runs.using: ${runs.using}`);
  }
  for (const [key, entries] of Object.entries({ inputs, outputs })) {
    if (entries === undefined) continue;
    if (
      !isMapping(entries) ||
      Object.values(entries).some((entry) => !isMapping(entry))
    ) {
      throw new Error(`Action ${key} must map IDs to metadata objects`);
    }
  }
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  // X_OK is existence-only on Windows; commandExtensions applies the real
  // executability rule there (the file extension).
  if (!stat.isFile()) return false;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Windows decides executability by file extension: access(X_OK) only checks
// existence there, so a bare `actionlint` decoy passes isRunnableCandidate
// although execFileSync cannot spawn it. Only extensions Node can spawn are
// candidates; PATHEXT may also list script types (.VBS, .JS, ...) that need a
// host program and would abort the step.
// Batch wrappers require cmd.exe, which would interpret changed filenames.
const WINDOWS_SPAWNABLE_EXTENSIONS = ['.COM', '.EXE'];

function commandExtensions(env, platform = process.platform) {
  if (platform !== 'win32') return [''];
  const configured = String(env.PATHEXT || '')
    .split(';')
    .map((ext) => ext.trim().toUpperCase())
    .filter((ext) => WINDOWS_SPAWNABLE_EXTENSIONS.includes(ext));
  return configured.length > 0 ? configured : WINDOWS_SPAWNABLE_EXTENSIONS;
}

function resolveCommand(name, env = process.env, platform = process.platform) {
  const pathEnv = env.PATH || env.Path || '';
  const exts = commandExtensions(env, platform);
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
  return exec(bin, args, { cwd, env, stdio: 'inherit' });
}

function verifyChangedWorkflowFiles(options = {}) {
  const {
    rawChangedFiles = process.env.CHANGED_FILES || '',
    files: explicitFiles,
    cwd = process.cwd(),
    env = process.env,
    exec = execFileSync,
    existsSync = fs.existsSync,
    log = console,
  } = options;

  const files = explicitFiles ?? parseChangedFiles(rawChangedFiles);
  if (files.length === 0) {
    log.log('No changed files to verify.');
    return {
      status: 0,
      workflowYamlFiles: [],
      actionYamlFiles: [],
      shellFiles: [],
      skipped: true,
    };
  }

  const classified = classifyChangedFiles(files, {
    cwd,
    existsSync: explicitFiles
      ? (file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile()
      : existsSync,
  });
  const { workflowYamlFiles, actionYamlFiles, shellFiles } = classified;

  if (explicitFiles) {
    const accepted = new Set([
      ...workflowYamlFiles,
      ...actionYamlFiles,
      ...shellFiles,
    ]);
    const invalid = explicitFiles.filter((file) => !accepted.has(file));
    if (invalid.length) {
      const error = `Expected existing workflow, action metadata, or shell files: ${JSON.stringify(invalid)}`;
      log.error(error);
      return { status: 1, ...classified, error };
    }
  }

  for (const file of actionYamlFiles) {
    try {
      validateActionManifest(file, cwd);
    } catch (err) {
      log.error(`Invalid action metadata in ${file}: ${err.message}`);
      return { status: 1, ...classified };
    }
  }

  if (workflowYamlFiles.length > 0) {
    if (!hasCommand('actionlint', env)) {
      log.error(`::error::${ACTIONLINT_MISSING}`);
      return {
        status: 1,
        ...classified,
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
        ...classified,
        error: SHELLCHECK_MISSING,
      };
    }
    runTool(exec, 'shellcheck', ['--', ...shellFiles], { cwd, env });
  }

  return { status: 0, ...classified };
}

if (require.main === module) {
  try {
    const paths = process.argv.slice(2);
    const options = paths.length ? { files: paths } : {};
    process.exit(verifyChangedWorkflowFiles(options).status);
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
  commandExtensions,
  resolveCommand,
  hasCommand,
  verifyChangedWorkflowFiles,
};
