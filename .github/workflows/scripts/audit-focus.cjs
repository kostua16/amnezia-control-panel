/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');

const FOCUS_AREAS = [
  {
    name: 'components',
    path: 'src/components',
    description:
      'React UI components: props validation, accessibility, performance',
  },
  {
    name: 'hooks',
    path: 'src/hooks',
    description:
      'Custom React hooks: dependency arrays, cleanup, error handling',
  },
  {
    name: 'lib',
    path: 'src/lib',
    description: 'Library and utility code: pure functions, edge cases, types',
  },
  {
    name: 'api-routes',
    path: 'src/app/api',
    description:
      'API route handlers: input validation, error responses, auth checks',
  },
  {
    name: 'app-pages',
    path: 'src/app',
    exclude: ['src/app/api'],
    description:
      'App pages, layouts, and non-API routes: data fetching, loading states',
  },
  {
    name: 'types',
    path: 'src/types',
    description:
      'TypeScript type definitions: completeness, correctness, exports',
  },
];

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function normalizePath(filePath) {
  return String(filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

function isWithinPath(filePath, rootPath) {
  const file = normalizePath(filePath);
  const root = normalizePath(rootPath);
  return file === root || file.startsWith(`${root}/`);
}

function focusClause(area) {
  const exclude = Array.isArray(area.exclude) ? area.exclude : [];
  return exclude.length
    ? `${area.path} (excluding ${exclude.join(', ')})`
    : String(area.path);
}

function parseRunNumber(value) {
  const runNumber = Number(value);
  if (!Number.isInteger(runNumber) || runNumber <= 0) {
    throw new Error(`invalid run number: ${value}`);
  }
  return runNumber;
}

function selectFocus(runNumberValue, focusAreas = FOCUS_AREAS) {
  const total = Array.isArray(focusAreas) ? focusAreas.length : 0;
  if (total === 0) {
    throw new Error('no focus areas configured');
  }
  const runNumber = parseRunNumber(runNumberValue);
  const index = (runNumber - 1) % total;
  const area = focusAreas[index];
  const exclude = Array.isArray(area.exclude) ? area.exclude : [];
  return {
    name: String(area.name ?? ''),
    path: String(area.path ?? ''),
    exclude,
    description: String(area.description ?? ''),
    focus_clause: focusClause(area),
    index,
    total,
    run_number: runNumber,
  };
}

function parseChangedFiles(raw) {
  if (Array.isArray(raw)) return raw.map(normalizePath).filter(Boolean);
  return String(raw ?? '')
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean);
}

function validateChangedFiles(changedFiles, focus) {
  const files = parseChangedFiles(changedFiles);
  const focusPath = normalizePath(focus?.path);
  if (!focusPath || files.length === 0) {
    return { valid: true, files, invalid: [] };
  }
  const excluded = Array.isArray(focus.exclude) ? focus.exclude : [];
  const invalid = files.filter((file) => {
    if (!isWithinPath(file, focusPath)) return true;
    return excluded.some((excludePath) => isWithinPath(file, excludePath));
  });
  return { valid: invalid.length === 0, files, invalid };
}

function runSelect() {
  const out = selectFocus(getArg('--run-number'));
  process.stdout.write(JSON.stringify(out));
}

function runValidateChangedFiles() {
  const focusPath = getArg('--focus');
  const changedFilesPath = getArg('--changed-files');
  if (!focusPath || !changedFilesPath) {
    process.stderr.write(
      'audit-focus: validate-changed-files requires --focus and --changed-files\n',
    );
    process.exit(2);
  }
  const focus = JSON.parse(fs.readFileSync(focusPath, 'utf8'));
  const changedFiles = fs.readFileSync(changedFilesPath, 'utf8');
  const result = validateChangedFiles(changedFiles, focus);
  if (!result.valid) {
    for (const file of result.invalid) {
      process.stderr.write(
        `::error file=${file}::Audit focus "${focus.name}" permits changes only under ${focus.focus_clause}\n`,
      );
    }
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({ ok: true, checked: result.files.length }),
  );
}

function runCli() {
  const mode = process.argv[2];
  if (mode === 'select') {
    runSelect();
  } else if (mode === 'validate-changed-files') {
    runValidateChangedFiles();
  } else {
    process.stderr.write(
      `audit-focus: unknown mode "${mode}" (select|validate-changed-files)\n`,
    );
    process.exit(2);
  }
}

module.exports = {
  FOCUS_AREAS,
  focusClause,
  getArg,
  isWithinPath,
  normalizePath,
  parseRunNumber,
  parseChangedFiles,
  selectFocus,
  validateChangedFiles,
};

if (require.main === module) {
  runCli();
}
