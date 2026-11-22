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
  resolveCommand,
  commandExtensions,
  verifyChangedWorkflowFiles,
  ACTIONLINT_MISSING,
} = require(scriptPath);

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFakeBin(binDir, name, body) {
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, `${name}.EXE`), '');
    fs.writeFileSync(path.join(binDir, `${name}.js`), body);
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

function spawnVerifier(root, binDir, env, paths = []) {
  const args = [scriptPath, ...paths];
  if (process.platform === 'win32') {
    // Dispatch fake executables through Node while exercising the real CLI.
    const preload = path.join(binDir, 'fake-tools.cjs');
    fs.writeFileSync(
      preload,
      `const { strict: assert } = require('node:assert');
const childProcess = require('node:child_process');
const { execFileSync } = childProcess;
childProcess.execFileSync = (bin, args, options) => {
  assert.ok(!options.shell);
  assert.equal(require('node:path').dirname(bin), __dirname);
  return execFileSync(process.execPath, [bin.replace(/\\.exe$/i, '.js'), ...args], options);
};`,
    );
    args.unshift('--require', preload);
  }
  return spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: 'utf8',
  });
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
    workflowYamlFiles: ['.github/workflows/workflow-health-optimize.yml'],
    actionYamlFiles: ['.github/actions/example/action.yml'],
    shellFiles: ['scripts/ok.sh'],
  });
});

test('validates changed action metadata without invoking actionlint', () => {
  const root = tmpDir('mon-action-');
  seedRun29803905118(root);
  const manifest = '.github/actions/example/action.yml';
  const errors = [];
  const options = {
    cwd: root,
    rawChangedFiles: manifest,
    env: {},
    exec: () => assert.fail('actionlint must not receive action metadata'),
    log: { error: (message) => errors.push(message) },
  };
  assert.equal(verifyChangedWorkflowFiles(options).status, 0);
  for (const runs of [
    '{ using: node20, main: index.js }',
    '{ using: node24, main: index.js }',
    '{ using: docker, image: Dockerfile }',
  ]) {
    fs.writeFileSync(
      path.join(root, manifest),
      `name: example\ndescription: fixture\nruns: ${runs}\n`,
    );
    assert.equal(verifyChangedWorkflowFiles(options).status, 0, runs);
  }
  fs.writeFileSync(path.join(root, manifest), 'name: example\njobs: {}\n');
  assert.equal(verifyChangedWorkflowFiles(options).status, 1);
  assert.match(errors[0], /Invalid action metadata.*runs\.using/);

  for (const [body, diagnostic] of [
    ['runs: { using: node99 }', /Unsupported runs\.using/],
    ['runs: { using: composite }', /requires runs\.steps/],
    ['runs: { using: node24 }', /requires runs\.main/],
    ['runs: { using: docker }', /requires runs\.image/],
    ['runs: { using: node24, main: index.js }\ninputs: []', /inputs must map/],
    [
      'runs: { using: docker, image: Dockerfile }\noutputs: { id: bad }',
      /outputs must map/,
    ],
  ]) {
    fs.writeFileSync(
      path.join(root, manifest),
      `name: example\ndescription: fixture\n${body}\n`,
    );
    assert.equal(verifyChangedWorkflowFiles(options).status, 1, body);
    assert.match(errors.at(-1), diagnostic);
  }
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

test('invalid positional paths fail while deleted paths from CI are skipped', () => {
  const root = tmpDir('mon-missing-path-');
  const missing = '.github/workflows/deleted.yml';
  const workflow = '.github/workflows/workflow-health-optimize.yml';
  seedRun29803905118(root);
  fs.mkdirSync(path.join(root, 'directory.sh'));
  fs.writeFileSync(path.join(root, 'README.md'), '');
  const options = {
    cwd: root,
    env: { ...process.env, CHANGED_FILES: JSON.stringify([missing]) },
    encoding: 'utf8',
  };
  for (const file of [
    missing,
    'directory.sh',
    'README.md',
    `./${workflow}`,
    path.join(root, workflow),
  ]) {
    const explicit = spawnSync(process.execPath, [scriptPath, file], options);
    assert.equal(explicit.status, 1, explicit.stderr);
    assert.match(explicit.stderr, /Expected existing workflow/);
    assert.ok(explicit.stderr.includes(JSON.stringify(file)));
  }
  const ci = spawnSync(process.execPath, [scriptPath], options);
  assert.equal(ci.status, 0, ci.stderr);
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
  const spawned = spawnVerifier(root, binDir, env);
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
  assert.deepEqual(argv, [
    '-config-file',
    '.github/actionlint.yaml',
    '.github/workflows/workflow-health-optimize.yml',
  ]);

  const failed = spawnVerifier(root, binDir, env, [
    '.github/workflows/fix-review.yml',
  ]);
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.match(failed.stderr, /fix-review\.yml: SC2129/);
  assert.deepEqual(JSON.parse(fs.readFileSync(argvLog, 'utf8')), [
    '-config-file',
    '.github/actionlint.yaml',
    '.github/workflows/fix-review.yml',
  ]);
});

test('changed shell scripts still reach shellcheck', () => {
  const root = tmpDir('mon-sh-');
  const binDir = tmpDir('mon-sh-bin-');
  const argvLog = path.join(root, 'shellcheck-argv.json');
  seedRun29803905118(root);
  fs.writeFileSync(path.join(root, '-example.sh'), '#!/bin/sh\n');
  writeFakeBin(binDir, 'actionlint', SC2129_ACTIONLINT);
  writeFakeBin(binDir, 'shellcheck', RECORD_SHELLCHECK);
  const env = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    Path: `${binDir}${path.delimiter}${process.env.Path || process.env.PATH || ''}`,
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    CHANGED_FILES: 'scripts/ok.sh\n-example.sh\n.github/workflows/gone.yml',
    SHELLCHECK_ARGV_LOG: argvLog,
  };
  const spawned = spawnVerifier(root, binDir, env);
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(argvLog, 'utf8')), [
    '--',
    'scripts/ok.sh',
    '-example.sh',
  ]);
});

test('resolveCommand skips a same-named directory earlier in PATH', () => {
  const decoyDir = tmpDir('mon-decoy-');
  const binDir = tmpDir('mon-real-bin-');
  const decoy = process.platform === 'win32' ? 'actionlint.EXE' : 'actionlint';
  fs.mkdirSync(path.join(decoyDir, decoy));
  writeFakeBin(binDir, 'actionlint', 'process.exit(0);');

  const env = {
    PATH: `${decoyDir}${path.delimiter}${binDir}`,
    Path: `${decoyDir}${path.delimiter}${binDir}`,
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
  };
  const resolved = resolveCommand('actionlint', env);
  assert.ok(resolved, 'expected a later PATH file, not the decoy directory');
  assert.ok(
    resolved.startsWith(binDir),
    `resolved ${resolved} should be under ${binDir}`,
  );
  assert.equal(fs.statSync(resolved).isFile(), true);
});

test(
  'resolveCommand skips a non-executable file earlier in PATH',
  { skip: process.platform === 'win32' },
  () => {
    const decoyDir = tmpDir('mon-nox-');
    const binDir = tmpDir('mon-nox-bin-');
    const decoy = path.join(decoyDir, 'actionlint');
    fs.writeFileSync(decoy, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    writeFakeBin(binDir, 'actionlint', 'process.exit(0);');

    const env = {
      PATH: `${decoyDir}${path.delimiter}${binDir}`,
      Path: `${decoyDir}${path.delimiter}${binDir}`,
    };
    const resolved = resolveCommand('actionlint', env);
    assert.ok(resolved, 'expected the later executable');
    assert.ok(
      resolved.startsWith(binDir),
      `resolved ${resolved} should be under ${binDir}`,
    );
  },
);

test('win32 commandExtensions never includes the bare name', () => {
  const spawnable = ['.COM', '.EXE'];
  // A trailing PATHEXT separator must not bring the bare name back.
  assert.deepEqual(
    commandExtensions({ PATHEXT: '.COM;.EXE;.BAT;.CMD;' }, 'win32'),
    spawnable,
  );
  // Script types need a host program execFileSync does not provide.
  assert.deepEqual(commandExtensions({ PATHEXT: '.exe;.VBS;.JS' }, 'win32'), [
    '.EXE',
  ]);
  assert.deepEqual(commandExtensions({}, 'win32'), spawnable);
  assert.deepEqual(commandExtensions({ PATHEXT: '.EXE' }, 'linux'), ['']);
});

test('resolveCommand on win32 skips a bare-name decoy file', () => {
  const decoyDir = tmpDir('mon-win-bare-');
  const binDir = tmpDir('mon-win-exe-');
  const real = path.join(binDir, 'actionlint.EXE');
  // access(X_OK) is existence-only on Windows, so any regular file passes;
  // an executable decoy models that on POSIX runners too.
  fs.writeFileSync(path.join(decoyDir, 'actionlint'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  });
  fs.writeFileSync(real, '#!/usr/bin/env node\nprocess.exit(0);\n', {
    mode: 0o755,
  });

  const env = {
    PATH: `${decoyDir}${path.delimiter}${binDir}`,
    Path: `${decoyDir}${path.delimiter}${binDir}`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
  };
  assert.equal(resolveCommand('actionlint', env, 'win32'), real);
});

test('resolveCommand on win32 skips a non-spawnable extension', () => {
  const decoyDir = tmpDir('mon-win-vbs-');
  const binDir = tmpDir('mon-win-native-');
  const real = path.join(binDir, 'actionlint.EXE');
  fs.writeFileSync(path.join(decoyDir, 'actionlint.VBS'), 'WScript.Quit 1\n', {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(decoyDir, 'actionlint.CMD'), '@echo off\r\n', {
    mode: 0o755,
  });
  fs.writeFileSync(real, '', { mode: 0o755 });

  const env = {
    PATH: `${decoyDir}${path.delimiter}${binDir}`,
    Path: `${decoyDir}${path.delimiter}${binDir}`,
    PATHEXT: '.VBS;.CMD;.EXE',
  };
  assert.equal(resolveCommand('actionlint', env, 'win32'), real);
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
