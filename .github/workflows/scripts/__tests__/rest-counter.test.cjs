/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} = require('node:fs');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const {
  apiTarget,
  classify,
} = require('../../../actions/log-rate-limit/rest-preload.cjs');
const {
  collectRestCounts,
  reportRestCounter,
  startRestCounter,
} = require('../../../actions/log-rate-limit/rest-counter.cjs');
const { parseRestCount } = require('../summarize-rate-limit.cjs');

const runNode = promisify(execFile);

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'rest counter '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

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
  assert.equal(route('/graphql?secret=value', undefined, 'POST'), 'graphql');
  assert.equal(route('/rate_limit'), null);
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
  const setup = {
    'INPUT_REST-COUNTER': 'true',
    RUNNER_TEMP: root,
    GITHUB_ENV: join(root, 'environment'),
    GITHUB_OUTPUT: join(root, 'output'),
    GITHUB_STATE: join(root, 'state'),
  };
  startRestCounter({ ...setup, 'INPUT_REST-COUNTER': 'false' });
  startRestCounter({ ...setup, GITHUB_STATE: join(root, 'missing', 'state') });
  assert.ok(!readdirSync(root).includes('environment'));
  startRestCounter(setup);
  const exported = Object.fromEntries(
    readFileSync(setup.GITHUB_ENV, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  startRestCounter({ ...setup, ...exported });
  assert.match(
    readFileSync(setup.GITHUB_STATE, 'utf8'),
    /^rest_counter_dir=[^\n]+\n$/,
  );
  assert.deepEqual(Object.keys(exported), ['REST_COUNTER_DIR']);
  const preload = readFileSync(setup.GITHUB_OUTPUT, 'utf8')
    .trimEnd()
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
    GITHUB_API_URL: api,
    NODE_OPTIONS: preload,
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
    runNode(process.execPath, ['-e', client], { env }),
    runNode(process.execPath, ['-e', client], { env }),
    runNode(
      process.execPath,
      [
        '-e',
        `require('node:fs').appendFileSync = () => { throw new Error('fixture write error'); };
      require(require('node:path').join(process.env.REST_COUNTER_DIR, 'rest-preload.cjs'));
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
  assert.equal(files.length, 2);
  appendFileSync(
    join(dir, files[0]),
    'GET /private-fixture-token\nGET /repos/:o/:r',
  );
  const counts = {
    total: 6,
    graphql: 2,
    by_route: { 'GET /repos/:o/:r': 2, 'GET /repos/:o/:r/pulls/:n': 4 },
  };
  assert.deepEqual(collectRestCounts(dir), counts);
  const logs = [];
  const summary = join(root, 'summary');
  reportRestCounter({
    env: {
      ...exported,
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
  assert.ok(readFileSync(summary, 'utf8').includes(JSON.stringify(counts)));
});
