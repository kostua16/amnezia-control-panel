/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { delimiter, join, resolve } = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const action = resolve(__dirname, '../../../actions/log-rate-limit');
const setupAction = resolve(action, '../setup-environment');
const installerStep = yaml
  .load(readFileSync(join(setupAction, 'action.yml'), 'utf8'))
  .runs.steps.find((step) => step.name === 'Count GitHub CLI requests');
const { installGhCounter } = require(join(action, 'gh-counter.cjs'));
const { collectRestCounts, reportRestCounter, startRestCounter } = require(
  join(action, 'rest-counter.cjs'),
);

const args = ['api', '--paginate', '--jq', '.[].name', 'arg with spaces'];
const stdin = Buffer.from([0, 255, 32, 10]);
const warning = Buffer.from([0x2a, 0x20, 0xff, 0x0d, 0x0a, 0x21]);

function runInstallerStep(env) {
  return spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', installerStep.run], {
    env: {
      ...process.env,
      ...env,
      REST_COUNTER_ENABLED: 'true',
      GITHUB_ACTION_PATH: setupAction,
    },
    encoding: 'utf8',
  });
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gh counter ' "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const setup = {
    'INPUT_REST-COUNTER': 'true',
    RUNNER_TEMP: root,
    GITHUB_ENV: join(root, 'env'),
    GITHUB_OUTPUT: join(root, 'out'),
    GITHUB_STATE: join(root, 'state'),
    GITHUB_PATH: join(root, 'path'),
  };
  const dir = startRestCounter(setup);
  const bin = join(dir, 'gh-bin');
  mkdirSync(bin);
  const observer = join(bin, 'gh-counter.cjs');
  copyFileSync(join(action, 'gh-counter.cjs'), observer);
  writeFileSync(
    join(root, 'api'),
    `
const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ${JSON.stringify(args.slice(1))});
assert.equal(process.env.GH_TOKEN, 'child-token-fixture');
if (process.env.GH_DEBUG === '1') {
  if (process.env.FAIL_RECORD) {
    const dir = process.env.REST_COUNTER_DIR;
    const file = fs.readdirSync(dir).find((entry) => entry.startsWith('gh-requests-'));
    fs.rmSync(require('node:path').join(dir, file));
    fs.mkdirSync(require('node:path').join(dir, file));
  }
  process.stderr.write([
    '[git remote -v]',
    '* Request at 2026-11-25 00:00:00',
    '* Request to https://api.github.com/repos/private-owner/private-repo/pulls/10?token=trace-token-fixture',
    '> Authorization: Bearer header-token-fixture',
    '* Request took 1ms',
    '* Request at 2026-11-25 00:00:00',
    '* Request to https://api.github.com/repos/private-owner/private-repo/pulls/10?page=2',
    '* Request took 1ms',
    '* Request to https://enterprise.invalid/api/graphql?secret=token-fixture',
    '* Request to https://api.github.com/rate_limit',
    '* Request to https://enterprise.invalid/api/v3/rate_limit',
    '* Request to https://elsewhere.invalid/token-fixture',
    '* Request URL https://api.github.com/user?signature=drifted-request',
    '* Response from https://api.github.com/user?signature=drifted-response',
    '* HTTP/2 https://api.github.com/user?signature=drifted-http',
    '* Using proxy: http://user:pass@host:3128',
    '* Selected PrOxY user:pass@host:3128',
    '* New transport headline https://example.invalid/?signature=unknown',
    '* dial tcp host:3128: connection refused',
    '* TLS connection using TLS 1.3',
    '> Authorization: Bearer header-without-timing-marker',
    '< Set-Cookie: response-without-timing-marker',
    '',
  ].join('\\n'));
} else if (process.env.GH_DEBUG) {
  process.stderr.write('caller diagnostics\\n');
}
if (process.env.APPLICATION_NOTE) {
  process.stderr.write('* note\\n');
}
process.stdout.write(fs.readFileSync(0));
process.stderr.write(Buffer.from(${JSON.stringify([...warning])}));
process.exitCode = 7;
`,
  );
  const env = {
    ...process.env,
    REST_COUNTER_DIR: dir,
    GH_TOKEN: 'child-token-fixture',
    GH_DEBUG: undefined,
    DEBUG: undefined,
    GITHUB_API_URL: 'https://enterprise.invalid/api/v3',
  };
  const options = { cwd: root, env, input: stdin };
  const run = (overrides = {}, command = args[0]) =>
    spawnSync(
      process.execPath,
      [observer, process.execPath, command, ...args.slice(1)],
      {
        ...options,
        env: { ...env, ...overrides },
      },
    );
  return { dir, root, setup, options, run };
}

test('traces added API built-ins while leaving extensions and aliases alone', (t) => {
  const { dir, root, run } = fixture(t);
  const traced = [
    'attestation',
    'cache',
    'codespace',
    'gpg-key',
    'org',
    'ruleset',
    'secret',
    'ssh-key',
    'status',
    'variable',
  ];
  for (const command of [
    ...traced,
    'agent-task',
    'extension',
    'copilot',
    'custom-alias',
  ]) {
    copyFileSync(join(root, 'api'), join(root, command));
    const result = run({}, command);
    assert.equal(result.status, 7, command);
    assert.deepEqual(result.stdout, stdin);
    assert.deepEqual(result.stderr, warning);
  }
  assert.equal(collectRestCounts(dir).via.gh, traced.length * 2);
});

test('PATH lookup skips an executable that disappears during realpath resolution', (t) => {
  const { root } = fixture(t);
  const first = join(root, 'first');
  const second = join(root, 'second');
  for (const dir of [first, second]) {
    mkdirSync(dir);
    writeFileSync(join(dir, 'gh'), '#!/bin/bash\nexit 0\n', { mode: 0o700 });
  }
  const code = `
    const fs = require('node:fs');
    const { join } = require('node:path');
    const [modulePath, path, first, second] = process.argv.slice(1);
    const realpath = fs.realpathSync;
    fs.realpathSync = (file) => {
      if (file === join(first, 'gh')) fs.unlinkSync(file);
      return realpath(file);
    };
    const { findGhOnPath } = require(modulePath);
    require('node:assert/strict').equal(findGhOnPath(path, 'skip'), join(second, 'gh'));
  `;
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      code,
      join(action, 'gh-counter.cjs'),
      `${first}${delimiter}${second}`,
      first,
      second,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('excludes public quota probes without a valid enterprise API URL', (t) => {
  const { dir, run } = fixture(t);
  for (const apiUrl of [undefined, 'invalid-url', 'ftp://enterprise.invalid']) {
    assert.equal(run({ GITHUB_API_URL: apiUrl }).status, 7);
  }
  const counts = collectRestCounts(dir);
  assert.equal(counts.via.gh, 6);
  assert.deepEqual(counts.by_route, { 'OTHER /repos/:o/:r/pulls/:n': 6 });
});

test('suppresses proxy credentials and drifted transport lines while preserving ordinary starred output', (t) => {
  const { dir, run } = fixture(t);
  const result = run({ APPLICATION_NOTE: 'true' });
  assert.equal(result.status, 7);
  assert.deepEqual(result.stdout, stdin);
  assert.deepEqual(
    result.stderr,
    Buffer.concat([Buffer.from('* note\n'), warning]),
  );
  assert.equal(collectRestCounts(dir).via.gh, 2);
});

test('gh counter preserves bytes and status, counts pages and GraphQL, and stores only templates', (t) => {
  const { dir, run } = fixture(t);
  const result = run();
  assert.equal(result.status, 7, result.stderr.toString());
  assert.deepEqual(result.stdout, stdin);
  assert.deepEqual(result.stderr, warning);
  const records = readdirSync(dir).filter((name) =>
    name.startsWith('gh-requests-'),
  );
  assert.equal(records.length, 1);
  assert.equal(
    readFileSync(join(dir, records[0]), 'utf8'),
    'attached\nOTHER /repos/:o/:r/pulls/:n\nOTHER /repos/:o/:r/pulls/:n\ngraphql\n',
  );
  writeFileSync(
    join(dir, 'requests-abcd.log'),
    'attached\nGET /user\ngraphql\n',
  );
  assert.deepEqual(collectRestCounts(dir), {
    total: 3,
    graphql: 2,
    instrumented: 2,
    unreadable: 0,
    via: { node: 1, gh: 2 },
    graphql_via: { node: 1, gh: 1 },
    by_route: { 'GET /user': 1, 'OTHER /repos/:o/:r/pulls/:n': 2 },
  });
});

test('gh counter fails open before or during recording and preserves caller diagnostics', (t) => {
  const { dir, root, run } = fixture(t);
  const missing = run({ REST_COUNTER_DIR: join(root, 'missing') });
  assert.equal(missing.status, 7);
  assert.deepEqual(missing.stdout, stdin);
  assert.deepEqual(missing.stderr, warning);
  const debug = run({ GH_DEBUG: 'api' });
  assert.equal(debug.status, 7);
  assert.deepEqual(
    debug.stderr,
    Buffer.concat([Buffer.from('caller diagnostics\n'), warning]),
  );
  assert.equal(collectRestCounts(dir).instrumented, 0);

  const failed = run({ FAIL_RECORD: 'true' });
  assert.equal(failed.status, 7);
  assert.deepEqual(failed.stdout, stdin);
  assert.deepEqual(failed.stderr, warning);
  // A missing classifier prevents injection even if the shim is on PATH.
  renameSync(join(dir, 'rest-routes.cjs'), join(dir, 'missing-routes.cjs'));
  const noClassifier = run();
  assert.equal(noClassifier.status, 7);
  assert.deepEqual(noClassifier.stderr, warning);
});

test(
  'missing Node warns without failing the setup step or changing PATH',
  {
    skip: process.platform !== 'linux',
  },
  (t) => {
    const { dir, root, setup } = fixture(t);
    const originalEnv = readFileSync(setup.GITHUB_ENV);
    const result = runInstallerStep({
      GITHUB_ENV: setup.GITHUB_ENV,
      GITHUB_PATH: setup.GITHUB_PATH,
      PATH: root,
      REST_COUNTER_DIR: dir,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::warning::.*node-not-on-path/);
    assert.deepEqual(readFileSync(setup.GITHUB_ENV), originalEnv);
    assert.equal(
      readFileSync(join(dir, 'gh-setup-failure'), 'utf8'),
      'node-not-on-path\n',
    );
    assert.ok(!readdirSync(root).includes('path'));
    const lines = [];
    reportRestCounter({
      env: {
        ...setup,
        RUNNER_OS: 'Linux',
        GITHUB_JOB: 'test',
        GITHUB_RUN_ID: '1',
        GITHUB_RUN_ATTEMPT: '1',
        REST_COUNTER_DIR: dir,
        STATE_rest_counter_dir: dir,
        PATH: root,
      },
      log: (line) => lines.push(line),
    });
    assert.match(
      lines[0],
      / gh_status=unavailable gh_reason=node-not-on-path /,
    );
  },
);

test(
  'composite installer publishes PATH and reports PATH write failures without failing',
  {
    skip: process.platform !== 'linux',
  },
  (t) => {
    const { dir, root, setup } = fixture(t);
    const tools = join(root, 'tools');
    mkdirSync(tools);
    symlinkSync(process.execPath, join(tools, 'node'));
    writeFileSync(join(tools, 'gh'), '#!/bin/bash\nexit 0\n', { mode: 0o700 });
    const env = { REST_COUNTER_DIR: dir, PATH: tools };
    const ok = runInstallerStep({ ...env, GITHUB_PATH: setup.GITHUB_PATH });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, '');
    assert.equal(
      readFileSync(setup.GITHUB_PATH, 'utf8'),
      `${join(dir, 'gh-bin')}\n`,
    );
    for (const [file, reason] of [
      ['', 'no-github-path'],
      [root, 'io'],
    ]) {
      const failed = runInstallerStep({ ...env, GITHUB_PATH: file });
      assert.equal(failed.status, 0, failed.stderr);
      assert.match(failed.stdout, new RegExp(`::warning::.*\\(${reason}\\)`));
      assert.equal(
        readFileSync(join(dir, 'gh-setup-failure'), 'utf8'),
        `${reason}\n`,
      );
    }
    rmSync(join(tools, 'node'));
    writeFileSync(
      join(tools, 'node'),
      '#!/bin/bash\nprintf "%s\\n" "$FIXTURE_REASON"\nexit 1\n',
      { mode: 0o700 },
    );
    for (const [input, expected] of [
      ['future-failure2', 'future-failure2'],
      ['a'.repeat(41), 'setup-failed'],
      ['bad https://example.invalid', 'setup-failed'],
    ]) {
      const result = runInstallerStep({
        ...env,
        FIXTURE_REASON: input,
        GITHUB_PATH: setup.GITHUB_PATH,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout,
        `::warning::GitHub CLI request counting unavailable (${expected})\n`,
      );
      assert.equal(
        readFileSync(join(dir, 'gh-setup-failure'), 'utf8'),
        `${expected}\n`,
      );
    }
  },
);

test('installer CLI distinguishes disabled counting from failed setup', (t) => {
  const { dir, root, setup } = fixture(t);
  const env = {
    ...process.env,
    REST_COUNTER_DIR: dir,
    GITHUB_PATH: setup.GITHUB_PATH,
    PATH: root,
  };
  const runInstall = (enabled) =>
    spawnSync(
      process.execPath,
      [join(action, 'gh-counter.cjs'), '--install', enabled],
      { env },
    );
  assert.equal(installGhCounter(dir, false, env), 'disabled');
  const reason =
    process.platform === 'linux' ? 'no-gh' : 'unsupported-platform';
  assert.equal(installGhCounter(dir, true, env), `failed:${reason}`);
  assert.equal(runInstall('false').status, 0);
  for (const input of ['true', 'True', 'TRUE', ' true ']) {
    const failed = runInstall(input);
    assert.equal(failed.status, 1, JSON.stringify(input));
    assert.equal(failed.stdout.toString(), `${reason}\n`);
  }
  for (const input of ['False', '', 'invalid']) {
    assert.equal(runInstall(input).status, 0, JSON.stringify(input));
  }
  assert.ok(!readdirSync(root).includes('path'));
});

test(
  'Linux PATH launcher honors the kill switch, runs under strict Bash, and tolerates a missing observer',
  {
    skip: process.platform !== 'linux',
  },
  (t) => {
    const { dir, root, setup, options } = fixture(t);
    const realBin = join(root, 'real bin');
    mkdirSync(realBin);
    writeFileSync(
      join(realBin, 'gh'),
      `#!/bin/bash\nexec "${process.execPath}" "$@"\n`,
      { mode: 0o700 },
    );
    const env = {
      ...options.env,
      PATH: `${realBin}${delimiter}${process.env.PATH}`,
      GITHUB_PATH: setup.GITHUB_PATH,
    };
    const report = () => {
      const lines = [];
      reportRestCounter({
        env: {
          ...env,
          ...setup,
          RUNNER_OS: 'Linux',
          STATE_rest_counter_dir: dir,
        },
        log: (line) => lines.push(line),
      });
      return lines[0];
    };
    const original = `${realBin}\n`;
    writeFileSync(env.GITHUB_PATH, original);
    const blocked = join(root, 'unwritable');
    mkdirSync(blocked);
    writeFileSync(join(blocked, 'gh-bin'), 'blocks directory creation');
    for (const [reason, failedEnv] of [
      ['no-gh', { ...env, PATH: root }],
      ['no-github-path', { ...env, GITHUB_PATH: '' }],
      ['no-counter-directory', { ...env, REST_COUNTER_DIR: '' }],
      ['io', { ...env, GITHUB_PATH: root }],
      ['unwritable-dir', { ...env, REST_COUNTER_DIR: blocked }],
    ]) {
      assert.equal(
        installGhCounter(failedEnv.REST_COUNTER_DIR, true, failedEnv),
        `failed:${reason}`,
      );
      const result = spawnSync(
        process.execPath,
        [join(action, 'gh-counter.cjs'), '--install', 'true'],
        { env: failedEnv, encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, `${reason}\n`);
      assert.equal(result.stderr, '');
    }
    assert.match(report(), / gh_status=unavailable /);
    assert.equal(installGhCounter(dir, false, env), 'disabled');
    assert.equal(readFileSync(env.GITHUB_PATH, 'utf8'), original);
    assert.equal(installGhCounter(dir, true, env), 'installed');
    const shimBin = join(dir, 'gh-bin');
    assert.equal(
      readFileSync(env.GITHUB_PATH, 'utf8'),
      `${original}${shimBin}\n`,
    );
    env.PATH = `${shimBin}${delimiter}${env.PATH}`;
    assert.match(report(), / gh_status=ok /);
    // Composite setup may install again without wrapping the previous shim.
    const retry = spawnSync(
      process.execPath,
      [join(action, 'gh-counter.cjs'), '--install', 'true'],
      { env },
    );
    assert.equal(retry.status, 0);
    const run = () =>
      spawnSync(
        '/bin/bash',
        ['-euo', 'pipefail', '-c', 'gh "$@"', 'fixture', ...args],
        { ...options, env },
      );
    for (const installed of [true, false]) {
      if (!installed) rmSync(join(shimBin, 'gh-counter.cjs'));
      const result = run();
      assert.equal(result.status, 7, result.stderr.toString());
      assert.deepEqual(result.stdout, stdin);
      assert.deepEqual(result.stderr, warning);
      assert.equal(collectRestCounts(dir).via.gh, 2);
    }
  },
);
