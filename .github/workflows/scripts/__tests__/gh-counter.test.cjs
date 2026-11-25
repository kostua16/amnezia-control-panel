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
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { delimiter, join, resolve } = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const action = resolve(__dirname, '../../../actions/log-rate-limit');
const { installGhCounter } = require(join(action, 'gh-counter.cjs'));
const { collectRestCounts, reportRestCounter, startRestCounter } = require(
  join(action, 'rest-counter.cjs'),
);

const args = ['api', '--paginate', '--jq', '.[].name', 'arg with spaces'];
const stdin = Buffer.from([0, 255, 32, 10]);
const warning = Buffer.from([0x2a, 0x20, 0xff, 0x0d, 0x0a, 0x21]);

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
    '> Authorization: Bearer header-without-timing-marker',
    '< Set-Cookie: response-without-timing-marker',
    '',
  ].join('\\n'));
} else if (process.env.GH_DEBUG) {
  process.stderr.write('caller diagnostics\\n');
}
if (process.env.APPLICATION_URL) {
  process.stderr.write('* See https://example.invalid/docs\\n');
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
    'agent-task',
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
  for (const command of [...traced, 'extension', 'copilot', 'custom-alias']) {
    copyFileSync(join(root, 'api'), join(root, command));
    const result = run({}, command);
    assert.equal(result.status, 7, command);
    assert.deepEqual(result.stdout, stdin);
    assert.deepEqual(result.stderr, warning);
  }
  assert.equal(collectRestCounts(dir).via.gh, traced.length * 2);
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

test('suppresses drifted trace URLs and passes ordinary starred URLs through', (t) => {
  const { dir, run } = fixture(t);
  const result = run({ APPLICATION_URL: 'true' });
  assert.equal(result.status, 7);
  assert.deepEqual(result.stdout, stdin);
  assert.deepEqual(
    result.stderr,
    Buffer.concat([
      Buffer.from('* See https://example.invalid/docs\n'),
      warning,
    ]),
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
    const { root, setup } = fixture(t);
    const metadata = yaml.load(
      readFileSync(join(action, '../setup-environment/action.yml'), 'utf8'),
    );
    const { run } = metadata.runs.steps.find(
      (step) => step.name === 'Count GitHub CLI requests',
    );
    const result = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', run], {
      env: { ...process.env, GITHUB_ENV: setup.GITHUB_ENV, PATH: root },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /::warning::.*node-not-on-path/);
    assert.doesNotMatch(readFileSync(setup.GITHUB_ENV, 'utf8'), /UNAVAILABLE/);
    assert.ok(!readdirSync(root).includes('path'));
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
  assert.equal(installGhCounter(dir, true, env), 'failed');
  assert.equal(runInstall('false').status, 0);
  assert.equal(runInstall('true').status, 1);
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
    assert.equal(installGhCounter(dir, true, { ...env, PATH: root }), 'failed');
    assert.match(report(), / gh=unavailable /);
    assert.equal(installGhCounter(dir, false, env), 'disabled');
    assert.equal(readFileSync(env.GITHUB_PATH, 'utf8'), original);
    assert.equal(installGhCounter(dir, true, env), 'installed');
    const shimBin = join(dir, 'gh-bin');
    assert.equal(
      readFileSync(env.GITHUB_PATH, 'utf8'),
      `${original}${shimBin}\n`,
    );
    env.PATH = `${shimBin}${delimiter}${env.PATH}`;
    assert.doesNotMatch(report(), / gh=unavailable /);
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
