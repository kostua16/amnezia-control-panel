/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { basename, delimiter, join, resolve } = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const {
  apiTarget,
  classify,
} = require('../../../actions/log-rate-limit/rest-routes.cjs');
const {
  collectRestCounts,
  reportGhInstallFailure,
  reportRestCounter,
  startRestCounter,
} = require('../../../actions/log-rate-limit/rest-counter.cjs');
const { parseRestCount, summarize } = require('../summarize-rate-limit.cjs');

const runNode = promisify(execFile);
const action = resolve(__dirname, '../../../actions/log-rate-limit');

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'rest counter '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setupEnv(root, runnerTemp = root) {
  return {
    'INPUT_REST-COUNTER': 'true',
    RUNNER_TEMP: runnerTemp,
    GITHUB_ENV: join(root, 'environment'),
    GITHUB_OUTPUT: join(root, 'output'),
    GITHUB_STATE: join(root, 'state'),
    GITHUB_PATH: join(root, 'path'),
  };
}

test('counter startup and post accept the same normalized request', (t) => {
  for (const [input, enabled] of [
    ['True', true],
    ['TRUE', true],
    [' true ', true],
    ['false', false],
    ['False', false],
    ['', false],
    ['invalid', false],
  ]) {
    const setup = { ...setupEnv(temp(t)), 'INPUT_REST-COUNTER': input };
    const dir = startRestCounter(setup);
    assert.equal(Boolean(dir), enabled, JSON.stringify(input));
    if (enabled) {
      assert.match(
        readFileSync(setup.GITHUB_OUTPUT, 'utf8'),
        /^rest-counter-enabled=true$/m,
      );
    } else {
      assert.deepEqual(readdirSync(setup.RUNNER_TEMP), []);
    }
    const lines = [];
    reportRestCounter({
      env: { ...setup, STATE_rest_counter_dir: dir, REST_COUNTER_DIR: dir },
      log: (line) => lines.push(line),
    });
    assert.equal(lines.length, enabled ? 1 : 0, JSON.stringify(input));
  }
});

test('a preload dependency failure never aborts Node startup', async (t) => {
  const fault = join(temp(t), 'fault.cjs');
  writeFileSync(
    fault,
    `
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function (id, ...args) {
      if (id === 'node:diagnostics_channel') throw new Error('fixture load error');
      return load.call(this, id, ...args);
    };
  `,
  );
  const result = await runNode(process.execPath, [
    '--require',
    fault,
    '--require',
    join(action, 'rest-preload.cjs'),
    '-e',
    'console.log("started")',
  ]);
  assert.equal(result.stdout.trim(), 'started');
  assert.equal(result.stderr, '');
});

test('reused collector returns its directory with or without an output file', (t) => {
  const root = temp(t);
  const setup = setupEnv(root);
  const dir = startRestCounter(setup);
  const output = join(root, 'reuse-output');
  const state = join(root, 'reuse-state');
  for (const file of [output, undefined]) {
    const warnings = [];
    const reused = startRestCounter(
      {
        ...setup,
        REST_COUNTER_DIR: dir,
        GITHUB_STATE: state,
        GITHUB_OUTPUT: file,
      },
      (line) => warnings.push(line),
    );
    assert.equal(reused, dir);
    assert.deepEqual(warnings, []);
  }
  assert.equal(
    readFileSync(output, 'utf8'),
    `rest-counter-preload=${join(dir, 'rest-preload.cjs')}\nrest-counter-enabled=true\n`,
  );
  assert.equal(
    readFileSync(state, 'utf8'),
    'rest_counter_skip=true\n'.repeat(2),
  );
});

test('post action contains unexpected report failures', async () => {
  const code = `
    require(${JSON.stringify(join(action, 'rest-counter.cjs'))}).reportRestCounter = () => { throw new Error('private-fixture-data'); };
    require(${JSON.stringify(join(action, 'post.cjs'))});
  `;
  const result = await runNode(process.execPath, ['-e', code], {
    env: {
      ...process.env,
      'INPUT_REPORT-AT-JOB-END': 'false',
      GITHUB_WORKFLOW: 'Workflow "test"',
      GITHUB_JOB: 'check',
      GITHUB_RUN_ID: '12',
      GITHUB_RUN_ATTEMPT: '2',
    },
  });
  assert.match(
    result.stdout,
    /status=unavailable reason=report-failed total=0 graphql=0 by_route=\{\}/,
  );
  assert.doesNotMatch(result.stdout, /private-fixture-data/);
  assert.equal(
    summarize([result.stdout.trimEnd()]).restCounts[0].unavailableRuns.size,
    1,
  );
  assert.equal(result.stderr, '');
});

test('disabled and invalid setup do not create files, and partial setup is cleaned up', (t) => {
  const root = temp(t);
  const setup = setupEnv(root);
  const warnings = [];
  const log = (line) => warnings.push(line);
  startRestCounter({ ...setup, 'INPUT_REST-COUNTER': 'false' }, log);
  assert.deepEqual(readdirSync(root), []);
  assert.deepEqual(warnings, []);
  startRestCounter({ ...setup, RUNNER_TEMP: `${root}\n` }, log);
  assert.deepEqual(readdirSync(root), []);
  assert.match(warnings[0], /invalid-runner-path/);
  startRestCounter(
    { ...setup, GITHUB_STATE: join(root, 'missing', 'state') },
    log,
  );
  assert.deepEqual(readdirSync(root), []);
  assert.match(warnings[1], /setup-io/);
});

test('enabled reporters mark missing, changed or unreadable storage unavailable', (t) => {
  const root = temp(t);
  const file = join(root, 'not-a-directory');
  writeFileSync(file, '');
  const env = {
    ...setupEnv(root),
    GITHUB_JOB: 'job',
    GITHUB_RUN_ID: '12',
    GITHUB_RUN_ATTEMPT: '1',
  };
  const counts = [
    [{}, 'setup-failed'],
    [
      { STATE_rest_counter_dir: root, REST_COUNTER_DIR: file },
      'directory-changed',
    ],
    [{ STATE_rest_counter_dir: file, REST_COUNTER_DIR: file }, 'read-failed'],
    [
      {
        STATE_rest_counter_dir: join(root, 'missing'),
        REST_COUNTER_DIR: join(root, 'missing'),
      },
      'directory-changed',
    ],
    [
      { STATE_rest_counter_dir: root, REST_COUNTER_DIR: join(root, 'missing') },
      'directory-changed',
    ],
  ];
  for (const [state, reason] of counts) {
    const lines = [];
    reportRestCounter({
      env: { ...env, ...state },
      log: (line) => lines.push(line),
    });
    assert.deepEqual(lines, [
      `REST_COUNT workflow="" job=job run=12.1 status=unavailable reason=${reason}`,
    ]);
    assert.equal(parseRestCount(lines[0]).status, 'unavailable');
  }
});

test('the action reports REST counts even with its quota post snapshot disabled', async (t) => {
  const root = temp(t);
  const env = {
    ...process.env,
    ...setupEnv(root),
    REST_COUNTER_DIR: '',
    RUNNER_OS: '',
    STATE_rest_counter_skip: '',
    'INPUT_REPORT-AT-JOB-END': 'false',
    GITHUB_JOB: 'standalone',
    GITHUB_RUN_ID: '12',
    GITHUB_RUN_ATTEMPT: '1',
  };
  const main = `global.fetch = async () => ({ ok: true, json: async () => ({ resources: {} }) }); require(${JSON.stringify(join(action, 'main.cjs'))});`;
  const started = await runNode(process.execPath, ['-e', main], { env });
  assert.match(started.stdout, /RATE_LIMIT phase=snapshot/);
  const dir = readFileSync(env.GITHUB_STATE, 'utf8')
    .trimEnd()
    .slice('rest_counter_dir='.length);
  assert.ok(dir);
  const result = await runNode(process.execPath, [join(action, 'post.cjs')], {
    env: { ...env, REST_COUNTER_DIR: dir, STATE_rest_counter_dir: dir },
  });
  assert.match(
    result.stdout,
    /^REST_COUNT .* job=standalone .* status=uninstrumented total=0 graphql=0 instrumented=0 unreadable=0 via=\{"node":0,"gh":0\} graphql_via=\{"node":0,"gh":0\} gh_status=unavailable gh_reason=unknown-platform by_route=\{\}\s*$/,
  );
  const preload = join(dir, 'rest-preload.cjs');
  const postEnv = {
    ...env,
    REST_COUNTER_DIR: dir,
    STATE_rest_counter_dir: dir,
  };
  await runNode(process.execPath, ['--require', preload, '-e', ''], {
    env: postEnv,
  });
  const quiet = await runNode(process.execPath, [join(action, 'post.cjs')], {
    env: postEnv,
  });
  assert.match(
    quiet.stdout,
    /total=0 graphql=0 instrumented=1 unreadable=0 via=.* by_route=\{\}/,
  );
  assert.doesNotMatch(quiet.stdout, /status=uninstrumented/);
});

test('post reports missing gh coverage until a launcher or observed requests are present', (t) => {
  const setup = setupEnv(temp(t));
  const dir = startRestCounter(setup);
  writeFileSync(join(dir, 'requests-abcd.log'), 'attached\nGET /user\n');
  const env = {
    ...setup,
    GITHUB_JOB: 'review',
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '1',
    STATE_rest_counter_dir: dir,
    REST_COUNTER_DIR: dir,
    RUNNER_OS: 'Linux',
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
  };
  const report = () => {
    let count;
    reportRestCounter({ env, log: (line) => (count = parseRestCount(line)) });
    return count;
  };
  assert.equal(report().ghUnavailable, true);
  assert.equal(report().ghUnavailableReason, 'not-installed');
  assert.deepEqual(report().via, { node: 1, gh: 0 });
  for (const reason of [
    'no-gh',
    'no-github-path',
    'unwritable-dir',
    'io',
    'node-not-on-path',
    'future-failure2',
  ]) {
    const annotations = [];
    reportGhInstallFailure(dir, reason, (line) => annotations.push(line));
    assert.deepEqual(annotations, [
      `::warning::GitHub CLI request counting unavailable (${reason})`,
    ]);
    assert.equal(
      report().ghUnavailableReason,
      reason === 'future-failure2' ? 'unclassified' : reason,
    );
  }
  writeFileSync(
    join(dir, 'gh-setup-failure'),
    'unexpected https://private.invalid\n',
  );
  assert.equal(report().ghUnavailableReason, 'not-installed');
  for (const value of ['no-gh \n', 'no-gh\r\n\r\n']) {
    writeFileSync(join(dir, 'gh-setup-failure'), value);
    assert.equal(report().ghUnavailableReason, 'no-gh');
  }
  const firstSummary = JSON.parse(
    readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8').split('\n')[4],
  );
  assert.match(
    readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'),
    /"gh_reason":"future-failure2"/,
  );
  assert.equal(firstSummary.gh_status, 'unavailable');
  assert.equal(firstSummary.gh_reason, 'not-installed');
  assert.equal(firstSummary.via.gh, 0);
  assert.equal(Object.hasOwn(firstSummary, 'gh'), false);
  for (const [platform, reason] of [
    ['Windows', 'unsupported-platform'],
    ['macOS', 'unsupported-platform'],
    [undefined, 'unknown-platform'],
    ['unexpected', 'unknown-platform'],
  ]) {
    env.RUNNER_OS = platform;
    assert.equal(report().ghUnavailableReason, reason);
  }
  env.RUNNER_OS = 'Linux';
  reportGhInstallFailure(dir, 'no-gh', () => {});
  const bin = join(dir, 'gh-bin');
  mkdirSync(bin);
  const launcher = join(bin, 'gh');
  const observer = join(bin, 'gh-counter.cjs');
  const node = process.execPath.replaceAll("'", "'\\''");
  assert.equal(report().ghUnavailable, true);
  env.PATH = bin;
  assert.equal(report().ghUnavailableReason, 'launcher-unusable');
  writeFileSync(
    launcher,
    `#!/bin/bash\nnode_bin='${join(bin, 'missing-node')}'\n`,
    { mode: 0o700 },
  );
  assert.equal(report().ghUnavailableReason, 'node-unusable');
  writeFileSync(launcher, `#!/bin/bash\nnode_bin='${node}'\n`);
  writeFileSync(observer, '');
  assert.equal(report().ghUnavailableReason, 'observer-unusable');
  writeFileSync(observer, "'use strict';\n");
  if (process.platform === 'linux') {
    chmodSync(launcher, 0o600);
    assert.equal(report().ghUnavailableReason, 'launcher-unusable');
    chmodSync(launcher, 0o700);
  }
  const shadow = join(dir, 'shadow');
  mkdirSync(shadow);
  writeFileSync(join(shadow, 'gh'), '#!/bin/bash\n', { mode: 0o700 });
  env.PATH = `${shadow}${delimiter}${bin}`;
  assert.equal(report().ghUnavailableReason, 'launcher-shadowed');
  env.PATH = bin;
  assert.equal(report().ghUnavailable, false);
  assert.equal(report().ghUnavailableReason, undefined);
  env.PATH = '';
  writeFileSync(join(dir, 'gh-requests-abcd.log'), 'attached\ngraphql\n');
  assert.equal(report().ghUnavailable, false);
  assert.deepEqual(report().graphqlVia, { node: 0, gh: 1 });
});

test('classifies only API hosts and emits no request data beyond fixed templates', () => {
  const target = apiTarget('https://enterprise.example/api/v3');
  const route = (path, origin = 'https://api.github.com', method = 'GET') =>
    classify({ origin, path, method }, target);
  assert.equal(
    route('/repos/private/project/pulls/19?token=sensitive'),
    'GET /repos/:o/:r/pulls/:n',
  );
  assert.equal(
    route(
      '/repos/private/project/git/refs/heads/feature/name',
      undefined,
      'DELETE',
    ),
    'DELETE /repos/:o/:r/git/refs/:ref',
  );
  assert.equal(route('/private/sensitive'), 'GET /other');
  assert.equal(
    route('/repos/o/r/commits/031d111/check-runs'),
    'GET /repos/:o/:r/commits/:ref/check-runs',
  );
  assert.equal(route('/graphql?secret=value', undefined, 'POST'), 'graphql');
  assert.equal(route('/rate_limit'), null);
  assert.equal(route('/rate_limit', undefined, 'POST'), 'POST /other');
  assert.equal(
    route(
      '/api/v3/repos/o/r/issues/1/comments',
      'https://enterprise.example:8443',
    ),
    'GET /repos/:o/:r/issues/:n/comments',
  );
  assert.equal(route('/api/graphql', 'https://enterprise.example'), 'graphql');
  assert.equal(route('/repos/o/r', 'https://enterprise.example'), null);
  assert.equal(route('/repos/o/r', 'https://api.github.com.example'), null);
});

test('setup, parallel children and post count HTTP and fetch without changing requests', async (t) => {
  const root = temp(t);
  const runnerTemp = temp(t);
  const tempAlias = join(root, 'runner-temp');
  symlinkSync(runnerTemp, tempAlias, 'junction');
  const setup = setupEnv(root, tempAlias);
  startRestCounter(setup);
  const exported = Object.fromEntries(
    readFileSync(setup.GITHUB_ENV, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  const duplicateState = join(root, 'duplicate');
  startRestCounter({ ...setup, ...exported, GITHUB_STATE: duplicateState });
  assert.equal(
    readFileSync(duplicateState, 'utf8'),
    'rest_counter_skip=true\n',
  );
  reportRestCounter({
    env: { ...setup, ...exported, STATE_rest_counter_skip: 'true' },
    log: () =>
      assert.fail('duplicate must leave reporting to the first invocation'),
  });
  assert.match(
    readFileSync(setup.GITHUB_STATE, 'utf8'),
    /^rest_counter_dir=[^\n]+\n$/,
  );
  assert.deepEqual(Object.keys(exported), ['REST_COUNTER_DIR']);
  const preload = readFileSync(setup.GITHUB_OUTPUT, 'utf8')
    .split('\n')
    .find((line) => line.startsWith('rest-counter-preload='))
    .slice('rest-counter-preload='.length);

  const requests = [];
  const server = createServer((req, res) => {
    requests.push([req.method, req.url, req.headers.authorization]);
    if (req.url === '/api/v3/repos/o/r/pulls/9') {
      res.writeHead(302, {
        Location: '/api/v3/repos/private/repo/pulls/11?secret=value',
      });
    }
    res.end('response');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  const api = `http://127.0.0.1:${port}/api/v3`;
  const env = {
    ...process.env,
    ...exported,
    REST_COUNTER_DIR: join(tempAlias, basename(exported.REST_COUNTER_DIR)),
    GITHUB_API_URL: api,
    REST_COUNTER_PRELOAD: preload,
    NODE_OPTIONS: '--no-warnings',
  };
  const client = `
    const http = require('node:http');
    const api = process.env.GITHUB_API_URL;
    const headers = { authorization: 'Bearer private-fixture-token' };
    Promise.all([
      new Promise((resolve, reject) => http.get(api + '/repos/o/r', { headers }, (res) => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject)),
      fetch(api + '/repos/o/r/pulls/9', { headers }).then((res) => res.text()),
      fetch(api.replace('/v3', '') + '/graphql?secret=value', { method: 'POST', headers }).then((res) => res.text()),
      fetch(api + '/rate_limit', { headers }).then((res) => res.text()),
      fetch(api.replace('127.0.0.1', 'localhost') + '/user', { headers }).then((res) => res.text()),
    ]).then(() => console.log('unchanged'));
  `;
  const results = await Promise.all([
    runNode(process.execPath, ['--require', preload, '-e', client], { env }),
    runNode(
      process.execPath,
      [
        '-e',
        `
      require(process.env.REST_COUNTER_PRELOAD);
      if (!process.env.NODE_OPTIONS.startsWith('--no-warnings --require "')) process.exit(2);
      const child = require('node:child_process').spawnSync(process.execPath, ['-e', ${JSON.stringify(client)}], {stdio: 'inherit'});
      process.exitCode = child.status ?? 3;
    `,
      ],
      { env },
    ),
    runNode(
      process.execPath,
      [
        '-e',
        `require('node:fs').appendFileSync = () => { throw new Error('fixture write error'); };
      require(require('node:path').join(process.env.REST_COUNTER_DIR, 'rest-preload.cjs'));
      require('node:assert/strict').match(process.env.NODE_OPTIONS, /--require .*rest-preload[.]cjs/);
      ${client}`,
      ],
      { env: { ...env, NODE_OPTIONS: '' } },
    ),
  ]);
  for (const result of results) {
    assert.equal(result.stdout.trim(), 'unchanged');
    assert.equal(result.stderr, '');
  }
  assert.equal(requests.length, 18);
  assert.ok(
    requests.every(([, , auth]) => auth === 'Bearer private-fixture-token'),
  );

  const dir = exported.REST_COUNTER_DIR;
  const files = readdirSync(dir).filter((file) => file.startsWith('requests-'));
  assert.equal(files.length, 3);
  mkdirSync(join(dir, 'requests-deadbeef.log'));
  appendFileSync(
    join(dir, files[0]),
    'GET /private-fixture-token\nGET /repos/:o/:r',
  );
  const counts = {
    total: 7,
    graphql: 2,
    instrumented: 3,
    unreadable: 1,
    via: { node: 7, gh: 0 },
    graphql_via: { node: 2, gh: 0 },
    by_route: {
      'GET /other': 1,
      'GET /repos/:o/:r': 2,
      'GET /repos/:o/:r/pulls/:n': 4,
    },
  };
  assert.deepEqual(collectRestCounts(dir), counts);
  const logs = [];
  const summary = join(root, 'summary');
  reportRestCounter({
    env: {
      ...setup,
      ...exported,
      REST_COUNTER_DIR: env.REST_COUNTER_DIR,
      STATE_rest_counter_dir: dir,
      GITHUB_WORKFLOW: 'Workflow with "quotes"',
      GITHUB_JOB: 'check',
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_STEP_SUMMARY: summary,
    },
    log: (line) => logs.push(line),
  });
  assert.equal(logs.length, 1);
  assert.equal(parseRestCount(logs[0]).total, counts.total);
  assert.ok(!logs[0].includes('private-fixture-token'));
  const stepReport = JSON.parse(readFileSync(summary, 'utf8').split('\n')[4]);
  assert.deepEqual(stepReport, {
    ...counts,
    gh_status: 'unavailable',
    gh_reason: 'unknown-platform',
  });
});
