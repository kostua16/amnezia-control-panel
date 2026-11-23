/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariant: every workflow YAML in .github/workflows/ must be
// parseable YAML with a `jobs` mapping. GitHub silently registers a run named
// after the workflow file path and fails it with 0 jobs when the file cannot
// be parsed — nothing in the gate caught that class of breakage before this
// test (e.g. a shell heredoc-style string in a `run: |` block whose
// continuation line dedented past the block scalar indentation).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync: runGit } = require('node:child_process');
const yaml = require('js-yaml');
const {
  evaluateCondition,
  renderTemplate,
} = require('./helpers/github-expression.cjs');

test('the governance YAML trust pin matches the parser used by tests', () => {
  const installer = fs.readFileSync(
    path.resolve(__dirname, '../install-governance-yaml.sh'),
    'utf8',
  );
  const parser = require('../../../../package-lock.json').packages?.[
    'node_modules/js-yaml'
  ];
  assert.ok(parser, 'package-lock.json must contain a js-yaml package entry');
  const { resolved, integrity } = parser;
  assert.match(resolved ?? '', /^https:\/\//, 'js-yaml must have an HTTPS URL');
  assert.match(
    integrity ?? '',
    /^sha512-/,
    'js-yaml must have a SHA-512 lockfile digest',
  );

  assert.ok(installer.includes(`${resolved} --output`));
  assert.ok(
    installer.includes(`expected='${integrity.replace(/^sha512-/, '')}'`),
  );
});

test('the governance YAML installer bounds downloads and tests the bundle', () => {
  const installer = fs.readFileSync(
    path.resolve(__dirname, '../install-governance-yaml.sh'),
    'utf8',
  );
  for (const option of [
    /--proto '=https'/,
    /--proto-redir '=https'/,
    /--retry [1-9]\d*\b/,
    /--retry-all-errors\b/,
    /--retry-max-time [1-9]\d*\b/,
    /--connect-timeout [1-9]\d*\b/,
    /--max-time [1-9]\d*\b/,
  ]) {
    assert.match(installer, option);
  }
  assert.match(installer, /node -e .*yaml\.load\(/);
});

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github/workflows');

const workflowFiles = fs
  .readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

test('workflows directory contains workflow YAML files', () => {
  assert.ok(workflowFiles.length > 0, 'expected at least one workflow YAML');
});

for (const file of workflowFiles) {
  test(`${file} parses as YAML and defines a jobs mapping`, () => {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    let doc;
    try {
      doc = yaml.load(content);
    } catch (err) {
      assert.fail(`YAML parse error in ${file}: ${err.message}`);
    }
    assert.ok(
      doc && typeof doc === 'object',
      `${file} did not parse to a mapping`,
    );
    assert.ok(
      doc.jobs &&
        typeof doc.jobs === 'object' &&
        Object.keys(doc.jobs).length > 0,
      `${file} has no jobs mapping`,
    );
  });
}

test('G8a: privileged close jobs check out the current trusted main', () => {
  const workflow = yaml.load(
    fs.readFileSync(
      path.resolve(__dirname, '../../auto-pr-branch-cleanup.yml'),
      'utf8',
    ),
  );
  assert.deepEqual(workflow.on.pull_request_target, {
    branches: ['main'],
    types: ['closed'],
  });
  assert.equal(workflow.on.pull_request, undefined);
  for (const name of ['restore-deferred-proposal', 'delete-generated-branch']) {
    const job = workflow.jobs[name];
    assert.match(
      job.if,
      /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
      `${name} must ignore fork PRs`,
    );
    const checkoutIndex = job.steps.findIndex((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    const snapshotIndex = job.steps.findIndex(
      (step) => step.uses === './.github/actions/log-rate-limit',
    );
    assert.ok(checkoutIndex >= 0, `${name} must have a checkout step`);
    assert.ok(
      snapshotIndex > checkoutIndex,
      `${name} must check out before logging`,
    );
    const checkout = job.steps[checkoutIndex];
    assert.match(checkout.uses, /^actions\/checkout@[a-f0-9]{40}$/);
    assert.equal(checkout.with.ref, 'refs/heads/main');
    assert.equal(checkout.with['persist-credentials'], false);
  }
  assert.equal(
    workflow.jobs['cleanup-orphan-branches'].if,
    "github.event_name != 'pull_request_target'",
  );
});

test('G8b: Docker image publishing jobs use distinct rate-limit labels', () => {
  const workflow = yaml.load(
    fs.readFileSync(path.resolve(__dirname, '../../docker-image.yml'), 'utf8'),
  );
  for (const [job, label] of [
    ['publish', 'docker-publish'],
    ['publish-stack', 'docker-publish-stack'],
  ]) {
    const snapshot = workflow.jobs[job].steps.find(
      (step) => step.uses === './.github/actions/log-rate-limit',
    );
    assert.equal(snapshot?.with.label, label);
  }
});

test('G8d: Docker classifies main pushes from Git and fails open on an unavailable range', async (t) => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(workflowsDir, 'docker-image.yml'), 'utf8'),
  );
  const { steps } = workflow.jobs.classify;
  const checkout = steps[0];
  const script = steps.find((step) => step.id === 'classify').with.script;
  const ref = 'refs/heads/main';
  const before = 'a'.repeat(40);
  const after = 'b'.repeat(40);
  assert.equal(checkout.with['fetch-depth'], undefined);
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(
    evaluateCondition(checkout['continue-on-error'], {
      github: { event_name: 'push', ref },
    }),
    true,
  );
  assert.equal(
    evaluateCondition(checkout['continue-on-error'], {
      github: { event_name: 'push', ref: 'refs/tags/v1.2.3' },
    }),
    false,
  );

  const rewindRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-rewind-'));
  t.after(() => fs.rmSync(rewindRepo, { recursive: true, force: true }));
  const git = (...args) =>
    runGit('git', args, { cwd: rewindRepo, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Workflow Test');
  git('config', 'user.email', 'workflow@example.invalid');
  git('commit', '--allow-empty', '-qm', 'base');
  const rewindAfter = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(rewindRepo, 'Dockerfile'), 'FROM scratch\n');
  git('add', 'Dockerfile');
  git('commit', '-qm', 'add Dockerfile');
  const rewindBefore = git('rev-parse', 'HEAD').trim();

  for (const [name, paths, shouldPublish, failure] of [
    [
      'workflow-only change',
      ['.github/workflows/ci.yml', 'docs/workflow.md'],
      false,
    ],
    ['source change', ['src/app/page.tsx'], true],
    ['rename out of source', ['docs/old.md', 'src/old.ts'], true],
    ['unavailable range', [], true, 'diff'],
    ['failed fetch', [], true, 'fetch'],
    ['failed checkout', [], true, 'checkout'],
    [
      'large diff with a relevant path after the default buffer limit',
      [
        ...Array.from(
          { length: 12_000 },
          (_, i) => `docs/${i}-${'x'.repeat(100)}`,
        ),
        'src/end.ts',
      ],
      true,
    ],
    ['rewind removes a Docker input', null, true],
  ]) {
    await t.test(name, async (subtest) => {
      const pushBefore = paths === null ? rewindBefore : before;
      const pushAfter = paths === null ? rewindAfter : after;
      const outputs = {};
      const warnings = [];
      const summary = {
        addHeading: () => summary,
        addRaw: () => summary,
        addBreak: () => summary,
        write: async () => {},
      };
      const execFileSync = subtest.mock.fn((command, args, options) => {
        assert.equal(command, 'git');
        if (args[1] === 'fetch') {
          if (failure === 'fetch') throw new Error('fetch failed');
          return '';
        }
        if (failure === 'diff') throw new Error('missing commit');
        if (paths === null)
          return runGit(command, args, { ...options, cwd: rewindRepo });
        return paths.join('\0') + '\0';
      });
      await vm.runInNewContext(`(async () => { ${script} })()`, {
        context: {
          eventName: 'push',
          ref,
          payload: { before: pushBefore, after: pushAfter },
        },
        process: {
          env: {
            CHECKOUT_OUTCOME: failure === 'checkout' ? 'failure' : 'success',
            GITHUB_SERVER_URL: 'https://github.com',
            GIT_FETCH_TOKEN: 'test-token',
          },
        },
        Buffer,
        core: {
          setOutput: (key, value) => (outputs[key] = value),
          warning: (message) => warnings.push(message),
          info: () => {},
          setSecret: () => {},
          summary,
        },
        require(module) {
          assert.equal(module, 'node:child_process');
          return { execFileSync };
        },
      });
      const [fetch, diff] = execFileSync.mock.calls;
      assert.equal(
        execFileSync.mock.callCount(),
        failure === 'checkout' ? 0 : failure === 'fetch' ? 1 : 2,
      );
      if (fetch) {
        assert.equal(
          Array.from(fetch.arguments[1]).join(' '),
          `--config-env=http.https://github.com/.extraheader=GIT_FETCH_AUTH fetch --no-tags --depth=1 origin ${pushBefore}`,
        );
        assert.equal(fetch.arguments[2].timeout, 45_000);
      }
      if (diff) {
        assert.equal(
          Array.from(diff.arguments[1]).join(' '),
          `diff --no-renames --name-only -z ${pushBefore}..${pushAfter} --`,
        );
        assert.equal(diff.arguments[2].maxBuffer, 64 * 1024 * 1024);
      }
      assert.equal(outputs.should_publish, String(shouldPublish));
      assert.equal(outputs.should_validate, 'false');
      assert.equal(warnings.length, failure ? 1 : 0);
    });
  }
});

test('F6a: Fix Issue skips authorization for closed issue comments and labels', () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(workflowsDir, 'fix-issue.yml'), 'utf8'),
  );
  const authorize = workflow.jobs.authorize;
  for (const [eventName, payload] of [
    ['issue_comment', { comment: { body: '/fix' } }],
    ['issues', { label: { name: 'auto-fix-approved' } }],
  ]) {
    for (const state of ['open', 'closed']) {
      const github = {
        event_name: eventName,
        event: { ...payload, issue: { state } },
      };
      assert.equal(
        evaluateCondition(authorize.if, { github }),
        state === 'open',
      );
    }
  }
  assert.ok(
    authorize.steps.every(
      (step) => step.uses !== './.github/actions/setup-environment',
    ),
  );
  const snapshot = authorize.steps.find((step) => step.id === 'rate_limit');
  const gate = authorize.steps.find((step) => step.id === 'gate');
  assert.equal(snapshot.uses, './.github/actions/log-rate-limit');
  assert.equal(snapshot.with['report-at-job-end'], 'true');
  assert.equal(
    renderTemplate(gate.env.CORE_REMAINING, {
      steps: { rate_limit: { outputs: { 'core-remaining': '0' } } },
    }),
    '0',
  );
  assert.match(
    gate.run,
    /if \[\[ "\$CORE_REMAINING" == '0' \]\]; then[\s\S]*?exit 1/,
  );
});

test('F6a: Fix Issue checks live state before repair or side effects', () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(workflowsDir, 'fix-issue.yml'), 'utf8'),
  );
  const [guard, ...repairSteps] = workflow.jobs.fix.steps;
  assert.equal(guard.id, 'issue_state');
  assert.equal(guard.env.GH_TOKEN, '${{ secrets.GH_PAT }}');
  assert.match(guard.run, /gh issue view "\$ISSUE_NUM".*--json state/);
  assert.match(guard.run, /OPEN\) echo 'is_open=true'/);
  assert.match(guard.run, /CLOSED\) echo 'Issue closed/);
  for (const step of repairSteps) {
    assert.ok(step.if, `${step.name ?? step.uses} must be conditional`);
    assert.equal(
      evaluateCondition(step.if, { steps: { issue_state: { outputs: {} } } }),
      false,
      `${step.name ?? step.uses} must skip on a closed issue`,
    );
  }
});

test('G8a: governance rejects wider permissions and extra close jobs', () => {
  const { cleanupPolicyErrors } = require('../workflow-governance-check.cjs');
  const workflow = yaml.load(
    fs.readFileSync(
      path.resolve(__dirname, '../../auto-pr-branch-cleanup.yml'),
      'utf8',
    ),
  );

  assert.deepEqual(cleanupPolicyErrors(yaml.dump(workflow)), []);
  workflow.permissions.actions = 'write';
  workflow.jobs['delete-generated-branch'].permissions = 'write-all';
  workflow.jobs['unexpected-close-job'] = { 'runs-on': 'ubuntu-latest' };
  assert.deepEqual(cleanupPolicyErrors(yaml.dump(workflow)), [
    'cleanup must use the approved workflow permissions',
    'unexpected job in privileged cleanup workflow: unexpected-close-job',
    'delete-generated-branch must inherit the approved workflow permissions',
  ]);
});
