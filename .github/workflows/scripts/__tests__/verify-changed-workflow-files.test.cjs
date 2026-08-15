/* eslint-disable @typescript-eslint/no-require-imports */
// Contract: monitor actionlint sees only changed workflow/action YAML.
// Reproduces run 29803905118 / #881 (unrelated fix-review SC2129).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scriptPath = path.resolve(
  __dirname,
  '..',
  'verify-changed-workflow-files.cjs',
);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const {
  parseChangedFiles,
  classifyChangedFiles,
  isWorkflowOrActionYaml,
  verifyChangedWorkflowFiles,
  ACTIONLINT_MISSING,
} = require(scriptPath);

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFakeBin(binDir, name, body) {
  const jsPath = path.join(binDir, `${name}.js`);
  fs.writeFileSync(jsPath, `#!/usr/bin/env node\n${body}\n`);
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(binDir, `${name}.cmd`),
      `@echo off\r\nnode "${jsPath}" %*\r\n`,
    );
  } else {
    fs.writeFileSync(
      path.join(binDir, name),
      `#!/usr/bin/env node\n${body}\n`,
      {
        mode: 0o755,
      },
    );
  }
}

const SC2129_ACTIONLINT = `
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.ACTIONLINT_ARGV_LOG) {
  fs.writeFileSync(process.env.ACTIONLINT_ARGV_LOG, JSON.stringify(args));
}
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-config-file') { i++; continue; }
  if (String(args[i]).startsWith('-')) continue;
  files.push(String(args[i]).replace(/\\\\/g, '/'));
}
const scanAll = files.length === 0;
const hitsFixReview = scanAll || files.some((f) => f.includes('fix-review.yml'));
if (hitsFixReview) {
  console.error('.github/workflows/fix-review.yml: SC2129: Consider using { cmd1; cmd2; } >> file instead of individual redirects');
  process.exit(1);
}
`;

const RECORD_SHELLCHECK = `
const fs = require('fs');
if (process.env.SHELLCHECK_ARGV_LOG) {
  fs.writeFileSync(process.env.SHELLCHECK_ARGV_LOG, JSON.stringify(process.argv.slice(2)));
}
`;

function seedRun29803905118(root) {
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github', 'actions', 'example'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, '.github', 'actionlint.yaml'),
    'paths: {}\n',
  );
  fs.writeFileSync(
    path.join(root, '.github', 'workflows', 'workflow-health-optimize.yml'),
    'name: health\non: workflow_dispatch\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n',
  );
  fs.writeFileSync(
    path.join(root, '.github', 'workflows', 'fix-review.yml'),
    'name: fix-review\non: workflow_dispatch\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          echo a >> log\n          echo b >> log\n',
  );
  fs.writeFileSync(
    path.join(root, '.github', 'actions', 'example', 'action.yml'),
    'name: example\ndescription: fixture\nruns:\n  using: composite\n  steps:\n    - run: echo ok\n      shell: bash\n',
  );
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'ok.sh'), '#!/bin/sh\necho ok\n');
}

test('parseChangedFiles keeps a single path with no trailing newline', () => {
  assert.deepEqual(
    parseChangedFiles('.github/workflows/workflow-health-optimize.yml'),
    ['.github/workflows/workflow-health-optimize.yml'],
  );
});

test('parseChangedFiles accepts JSON and skips blanks', () => {
  assert.deepEqual(
    parseChangedFiles(
      '[".github/workflows/a.yml", ".github/workflows/a.yml", ""]',
    ),
    ['.github/workflows/a.yml'],
  );
});

test('classifyChangedFiles skips deleted paths and splits yaml vs shell', () => {
  const root = tmpDir('mon-classify-');
  seedRun29803905118(root);
  const classified = classifyChangedFiles(
    [
      '.github/workflows/workflow-health-optimize.yml',
      '.github/actions/example/action.yml',
      '.github/workflows/gone.yml',
      'scripts/ok.sh',
      'README.md',
    ],
    { cwd: root },
  );
  assert.deepEqual(classified, {
    workflowYamlFiles: [
      '.github/workflows/workflow-health-optimize.yml',
      '.github/actions/example/action.yml',
    ],
    shellFiles: ['scripts/ok.sh'],
  });
});

test('empty CHANGED_FILES is a no-op', () => {
  const logs = [];
  const result = verifyChangedWorkflowFiles({
    rawChangedFiles: '',
    log: { log: (msg) => logs.push(msg), error() {} },
    exec() {
      throw new Error('exec should not run');
    },
  });
  assert.equal(result.status, 0);
  assert.equal(result.skipped, true);
  assert.ok(logs.includes('No changed files to verify.'));
});

test('isWorkflowOrActionYaml includes nested action.yml', () => {
  assert.equal(
    isWorkflowOrActionYaml('.github/actions/example/action.yml'),
    true,
  );
  assert.equal(isWorkflowOrActionYaml('src/app/page.yml'), false);
});

test('missing actionlint fails closed when YAML changed', () => {
  const root = tmpDir('mon-missing-lint-');
  seedRun29803905118(root);
  const errors = [];
  const result = verifyChangedWorkflowFiles({
    rawChangedFiles: '.github/workflows/workflow-health-optimize.yml',
    cwd: root,
    env: { PATH: root, Path: root },
    log: { log() {}, error: (msg) => errors.push(msg) },
  });
  assert.equal(result.status, 1);
  assert.equal(result.error, ACTIONLINT_MISSING);
  assert.ok(errors.some((msg) => msg.includes(ACTIONLINT_MISSING)));
});

test('run 29803905118: untouched fix-review SC2129 cannot fail monitor', () => {
  const root = tmpDir('mon-881-');
  const binDir = tmpDir('mon-881-bin-');
  const argvLog = path.join(root, 'actionlint-argv.json');
  seedRun29803905118(root);
  writeFakeBin(binDir, 'actionlint', SC2129_ACTIONLINT);
  writeFakeBin(binDir, 'shellcheck', RECORD_SHELLCHECK);

  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    Path: `${binDir}${path.delimiter}${process.env.Path || process.env.PATH || ''}`,
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    CHANGED_FILES: JSON.stringify([
      '.github/workflows/workflow-health-optimize.yml',
    ]),
    ACTIONLINT_ARGV_LOG: argvLog,
  };
  const spawned = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
  assert.deepEqual(argv, [
    '-config-file',
    '.github/actionlint.yaml',
    '.github/workflows/workflow-health-optimize.yml',
  ]);
});

test('changed shell scripts still reach shellcheck', () => {
  const root = tmpDir('mon-sh-');
  const binDir = tmpDir('mon-sh-bin-');
  const argvLog = path.join(root, 'shellcheck-argv.json');
  seedRun29803905118(root);
  writeFakeBin(binDir, 'actionlint', SC2129_ACTIONLINT);
  writeFakeBin(binDir, 'shellcheck', RECORD_SHELLCHECK);
  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    Path: `${binDir}${path.delimiter}${process.env.Path || process.env.PATH || ''}`,
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    CHANGED_FILES: 'scripts/ok.sh\n.github/workflows/gone.yml',
    SHELLCHECK_ARGV_LOG: argvLog,
  };
  const spawned = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(argvLog, 'utf8')), [
    'scripts/ok.sh',
  ]);
});

test('monitor workflow invokes the scoped verifier', () => {
  const yaml = fs.readFileSync(
    path.join(
      repoRoot,
      '.github/workflows/monitor-amnezia-control-panel-github-runs.yml',
    ),
    'utf8',
  );
  assert.match(
    yaml,
    /node \.github\/workflows\/scripts\/verify-changed-workflow-files\.cjs/,
  );
  assert.doesNotMatch(
    yaml,
    /actionlint -config-file \.github\/actionlint\.yaml\s*$/m,
  );
});
