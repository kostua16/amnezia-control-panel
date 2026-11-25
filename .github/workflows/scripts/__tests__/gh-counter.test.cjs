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

const action = resolve(__dirname, '../../../actions/log-rate-limit');
const { installGhCounter } = require(join(action, 'gh-counter.cjs'));
const { collectRestCounts, startRestCounter } = require(
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
    '',
  ].join('\\n'));
} else if (process.env.GH_DEBUG) {
  process.stderr.write('caller diagnostics\\n');
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
  const run = (overrides = {}) =>
    spawnSync(process.execPath, [observer, process.execPath, ...args], {
      ...options,
      env: { ...env, ...overrides },
    });
  return { dir, root, setup, options, run };
}

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

test('disabled counter initializes neither the preload nor the shim', (t) => {
  const { setup, root } = fixture(t);
  assert.equal(
    startRestCounter({ ...setup, 'INPUT_REST-COUNTER': 'false' }),
    undefined,
  );
  installGhCounter(undefined, setup);
  assert.ok(!readdirSync(root).includes('path'));
});

test(
  'Linux PATH launcher runs under strict Bash and tolerates a missing observer',
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
    };
    installGhCounter(dir, { ...env, GITHUB_PATH: setup.GITHUB_PATH });
    const shimBin = readFileSync(setup.GITHUB_PATH, 'utf8').trimEnd();
    env.PATH = `${shimBin}${delimiter}${env.PATH}`;
    // Composite setup may install again without wrapping the previous shim.
    installGhCounter(dir, { ...env, GITHUB_PATH: setup.GITHUB_PATH });
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
