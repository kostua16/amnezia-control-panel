/* eslint-disable @typescript-eslint/no-require-imports */
// Deferrable Auto Cover work stops below the REST quota reserve; an unknown
// reading or a disabled reserve never blocks it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_RESERVE,
  evaluateQuotaReserve,
  run,
} = require('../check-quota-reserve.cjs');

const workflowsDir = path.resolve(__dirname, '..', '..');

test('below the reserve defers, at or above proceeds', () => {
  assert.equal(DEFAULT_RESERVE, 600);
  assert.equal(
    evaluateQuotaReserve({ remaining: '599', reserve: '600' }).proceed,
    false,
  );
  assert.equal(
    evaluateQuotaReserve({ remaining: '0', reserve: '600' }).proceed,
    false,
  );
  assert.equal(
    evaluateQuotaReserve({ remaining: '600', reserve: '600' }).proceed,
    true,
  );
  assert.equal(evaluateQuotaReserve({ remaining: '4999' }).proceed, true);
  assert.equal(evaluateQuotaReserve({ remaining: '100' }).proceed, false);
});

test('a disabled or invalid reserve and an unknown reading always proceed', () => {
  for (const reserve of ['0', '', 'abc', '-5', '1.5']) {
    assert.equal(
      evaluateQuotaReserve({ remaining: '0', reserve }).proceed,
      true,
      `reserve ${JSON.stringify(reserve)}`,
    );
  }
  for (const remaining of ['', undefined, 'n/a', '12abc']) {
    assert.equal(
      evaluateQuotaReserve({ remaining, reserve: '600' }).proceed,
      true,
      `remaining ${JSON.stringify(remaining)}`,
    );
  }
});

test('run writes proceed to GITHUB_OUTPUT and a notice plus summary when deferring', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-reserve-'));
  try {
    const output = path.join(dir, 'output');
    const summary = path.join(dir, 'summary');
    const logs = [];
    const result = run(
      {
        CORE_REMAINING: '120',
        QUOTA_RESERVE: '600',
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
      (line) => logs.push(line),
    );
    assert.equal(result.proceed, false);
    assert.equal(fs.readFileSync(output, 'utf8'), 'proceed=false\n');
    assert.match(logs[0], /^::notice title=Quota reserve::Core REST quota 120/);
    assert.match(fs.readFileSync(summary, 'utf8'), /below the reserve of 600/);

    run(
      { CORE_REMAINING: '', QUOTA_RESERVE: '600', GITHUB_OUTPUT: output },
      () => {},
    );
    assert.equal(
      fs.readFileSync(output, 'utf8'),
      'proceed=false\nproceed=true\n',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('only Auto Cover jobs use the reserve gate, after the setup-environment reading', () => {
  for (const file of ['auto-cover-review.yml', 'auto-cover-dispatch.yml']) {
    const yaml = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    assert.match(
      yaml,
      /- uses: \.\/\.github\/actions\/setup-environment\r?\n\s+id: setup\r?\n/,
      file,
    );
    assert.match(
      yaml,
      /id: reserve\r?\n\s+env:\r?\n\s+CORE_REMAINING: \$\{\{ steps\.setup\.outputs\.core-remaining \}\}\r?\n\s+QUOTA_RESERVE: \$\{\{ vars\.QUOTA_RESERVE \|\| '600' \}\}\r?\n\s+run: node \.github\/workflows\/scripts\/check-quota-reserve\.cjs/,
      file,
    );
    // The gate reads the output of setup-environment, so it must come after it
    // (an earlier gate would see an empty reading and fail open).
    assert.ok(
      yaml.indexOf('- uses: ./.github/actions/setup-environment') <
        yaml.indexOf('id: reserve'),
      file,
    );
    // Every step after the gate is skipped on a deferral (a step cannot end
    // the job green by itself).
    const afterGate = yaml.split(
      'run: node .github/workflows/scripts/check-quota-reserve.cjs',
    )[1];
    const laterSteps = afterGate.split(/\n      - /).slice(1);
    assert.ok(laterSteps.length > 0, file);
    for (const step of laterSteps) {
      assert.match(
        step,
        /if: steps\.reserve\.outputs\.proceed != 'false'/,
        file,
      );
    }
  }
  // PR Improve is dispatched once per head and the orchestrator never retries
  // a skipped run, so it must not be deferred; the orchestrator and required
  // checks are not deferrable either.
  for (const file of [
    'pr-improve.yml',
    'pr-flow.yml',
    'pr-policy.yml',
    'ci.yml',
  ]) {
    const yaml = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    assert.doesNotMatch(yaml, /check-quota-reserve/, file);
  }
});

test('Auto Cover jobs stay soft about auth so an exhausted quota defers instead of failing setup', () => {
  const yamlLib = require('js-yaml');
  const jobsWithSetup = {
    'auto-cover-review.yml': 'cover',
    'auto-cover-dispatch.yml': 'dispatch',
  };
  for (const [file, jobName] of Object.entries(jobsWithSetup)) {
    const doc = yamlLib.load(
      fs.readFileSync(path.join(workflowsDir, file), 'utf8'),
    );
    const setup = doc.jobs[jobName].steps.find((step) =>
      String(step.uses ?? '').endsWith('/setup-environment'),
    );
    assert.ok(setup, `${file}: ${jobName} calls setup-environment`);
    assert.equal(setup.with['require-gh-auth'], 'false', file);
  }
});

test('Auto Cover Dispatch validates its handoff inputs in both jobs', () => {
  const yaml = fs.readFileSync(
    path.join(workflowsDir, 'auto-cover-dispatch.yml'),
    'utf8',
  );
  assert.equal((yaml.match(/name: Validate the handoff/g) ?? []).length, 2);
  assert.match(yaml, /\^\[1-9\]\[0-9\]\*\$/);
  assert.match(yaml, /\^\[0-9a-f\]\{40\}\$/);
});

test('the Kilo-edit checkout in PR Orchestrator is non-fatal and separate from the prt checkout', () => {
  const yaml = fs.readFileSync(path.join(workflowsDir, 'pr-flow.yml'), 'utf8');
  const classify = yaml.split('  orchestrate:')[0];
  const checkouts = classify
    .split(/\n      - uses: actions\/checkout@/)
    .slice(1);
  assert.equal(checkouts.length, 2);
  assert.match(checkouts[0], /if: github\.event_name == 'pull_request_target'/);
  assert.doesNotMatch(checkouts[0], /continue-on-error/);
  assert.match(checkouts[1], /continue-on-error: true/);
});
