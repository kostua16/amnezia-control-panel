/* eslint-disable @typescript-eslint/no-require-imports */
// setup-environment gh-auth-mode: which callers skip setup-gh token validation
// (env) and how the env-mode step behaves. The step's bash is executed against
// a fake gh, so no test talks to GitHub.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github/workflows');
const actionFile = path.join(
  repoRoot,
  '.github/actions/setup-environment/action.yml',
);

const ENV_MODE = "${{ vars.GH_AUTH_MODE || 'env' }}";
const INSTALLATION_TOKEN = '${{ secrets.GITHUB_TOKEN }}';
const PAT = '${{ secrets.GH_PAT }}';
// Later steps of these jobs override GH_TOKEN with GH_PAT; when that secret is
// empty gh falls back to the token stored by setup-gh, which only validate
// mode provides.
const VALIDATE_EXCEPTIONS = new Set([
  'triage.yml#triage',
  'issue-catch-up.yml#collect-issues',
]);
// Edited together with their own trigger changes; the mode line may or may
// not be present there, but when present it must be the rollback expression.
const OPTIONAL_SITES = new Set([
  'pr-flow.yml#orchestrate',
  'auto-cover-review.yml#cover',
  'auto-cover-dispatch.yml#dispatch',
]);

function setupEnvironmentSites() {
  const sites = [];
  for (const file of fs.readdirSync(workflowsDir).sort()) {
    if (!/\.ya?ml$/.test(file)) continue;
    const doc = yaml.load(
      fs.readFileSync(path.join(workflowsDir, file), 'utf8'),
    );
    for (const [job, body] of Object.entries(doc?.jobs ?? {})) {
      for (const step of body?.steps ?? []) {
        if (step?.uses !== './.github/actions/setup-environment') continue;
        sites.push({ key: `${file}#${job}`, with: step.with ?? {} });
      }
    }
  }
  return sites;
}

test('every installation-token caller opts into env mode through the rollback variable', () => {
  const sites = setupEnvironmentSites().filter(
    (site) => site.with['github-token'] === INSTALLATION_TOKEN,
  );
  assert.ok(sites.length >= 50, `scanner found only ${sites.length} sites`);
  const wrong = [];
  for (const site of sites) {
    const mode = site.with['gh-auth-mode'];
    if (VALIDATE_EXCEPTIONS.has(site.key)) {
      if (mode !== undefined && mode !== 'validate') wrong.push(site.key);
    } else if (OPTIONAL_SITES.has(site.key)) {
      if (mode !== undefined && mode !== ENV_MODE) wrong.push(site.key);
    } else if (mode !== ENV_MODE) {
      wrong.push(site.key);
    }
  }
  assert.deepEqual(wrong, []);
});

test('the jobs that fall back to the stored token stay on validate', () => {
  const keys = new Set(setupEnvironmentSites().map((site) => site.key));
  for (const key of VALIDATE_EXCEPTIONS) {
    assert.ok(keys.has(key), `${key} no longer calls setup-environment`);
  }
});

test('PAT callers never skip token validation', () => {
  const sites = setupEnvironmentSites().filter(
    (site) => site.with['github-token'] === PAT,
  );
  assert.ok(sites.length > 0);
  for (const site of sites) {
    assert.equal(site.with['gh-auth-mode'], undefined, site.key);
  }
});

test('the action keeps validate as its default and gates every setup-gh step on it', () => {
  const action = yaml.load(fs.readFileSync(actionFile, 'utf8'));
  assert.equal(action.inputs['gh-auth-mode'].default, 'validate');
  assert.equal(
    action.outputs['core-remaining'].value,
    '${{ steps.rate_limit.outputs.core-remaining }}',
  );
  const steps = action.runs.steps;
  const rateLimit = steps.find((step) => step.id === 'rate_limit');
  assert.equal(rateLimit.uses, './.github/actions/log-rate-limit');
  assert.ok(
    steps.indexOf(rateLimit) === 0,
    'the quota snapshot runs before anything else',
  );
  const setupGh = steps.find((step) => step.id === 'setup_gh');
  assert.equal(setupGh.if, "inputs.gh-auth-mode != 'env'");
  for (const id of ['setup_gh_retry']) {
    const step = steps.find((candidate) => candidate.id === id);
    assert.equal(step.if, "steps.setup_gh.outcome == 'failure'");
  }
  const verify = steps.find((step) => step.name === 'Verify gh authenticated');
  assert.equal(
    verify.if,
    "inputs.require-gh-auth == 'true' && inputs.gh-auth-mode != 'env'",
  );
  const exportStep = envStep(action);
  assert.equal(exportStep.if, "inputs.gh-auth-mode == 'env'");
  assert.doesNotMatch(exportStep.run, /gh auth status/);
  assert.doesNotMatch(exportStep.run, /gh auth login/);
  assert.doesNotMatch(exportStep.run, /gh api/);
  assert.equal(
    exportStep.env.CORE_REMAINING,
    '${{ steps.rate_limit.outputs.core-remaining }}',
  );
});

function envStep(action) {
  return action.runs.steps.find(
    (step) => step.name === 'Export gh token without validation',
  );
}

// --- env-mode step behavior --------------------------------------------------

const bashAvailable = spawnSync('bash', ['-c', 'true']).status === 0;

function runEnvStep({ token, requireAuth, coreRemaining = '', withGh = true }) {
  const action = yaml.load(fs.readFileSync(actionFile, 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-auth-mode-'));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  if (withGh) {
    fs.writeFileSync(
      path.join(binDir, 'gh'),
      '#!/bin/sh\necho "gh version 0.0.0-fake"\n',
      { mode: 0o755 },
    );
  }
  const githubEnv = path.join(dir, 'github-env');
  fs.writeFileSync(githubEnv, '');
  const toPosix = (value) => value.replace(/\\/g, '/');
  // The step sees only the fake gh directory on PATH; bash itself is still
  // resolved through the caller's PATH.
  const script = `PATH="$FAKE_GH_PATH"
${envStep(action).run}`;
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      // A drive letter would split a PATH entry at its colon (Git Bash).
      FAKE_GH_PATH: toPosix(binDir).replace(
        /^([A-Za-z]):/,
        (_, drive) => `/${drive.toLowerCase()}`,
      ),
      GH_AUTH_TOKEN: token,
      REQUIRE_GH_AUTH: requireAuth,
      CORE_REMAINING: coreRemaining,
      GITHUB_ENV: toPosix(githubEnv),
    },
  });
  const written = fs.readFileSync(githubEnv, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    written,
  };
}

test(
  'env mode exports a masked GH_TOKEN and prints the gh version',
  { skip: !bashAvailable },
  () => {
    const run = runEnvStep({
      token: 'ghs_example',
      requireAuth: 'true',
      coreRemaining: '4321',
    });
    assert.equal(run.status, 0, run.output);
    assert.equal(run.written, 'GH_TOKEN=ghs_example\n');
    assert.match(run.output, /::add-mask::ghs_example/);
    assert.match(run.output, /gh version 0\.0\.0-fake/);
  },
);

test(
  'strict env mode fails before side effects when the quota is already exhausted',
  { skip: !bashAvailable },
  () => {
    const run = runEnvStep({
      token: 'ghs_example',
      requireAuth: 'true',
      coreRemaining: '0',
    });
    assert.equal(run.status, 1);
    assert.match(run.output, /API rate limit exceeded for installation/);
  },
);

test(
  'an unreadable quota does not fail the job',
  { skip: !bashAvailable },
  () => {
    const run = runEnvStep({ token: 'ghs_example', requireAuth: 'true' });
    assert.equal(run.status, 0, run.output);
  },
);

test(
  'strict env mode fails clearly on an empty token or a missing gh',
  { skip: !bashAvailable },
  () => {
    const empty = runEnvStep({ token: '', requireAuth: 'true' });
    assert.equal(empty.status, 1);
    assert.match(empty.output, /token is empty/);
    assert.equal(empty.written, '');

    const noGh = runEnvStep({
      token: 'ghs_example',
      requireAuth: 'true',
      withGh: false,
    });
    assert.equal(noGh.status, 1);
    assert.match(noGh.output, /gh is not on PATH/);
  },
);

test(
  'soft env mode only warns so CI stays runnable without gh credentials',
  { skip: !bashAvailable },
  () => {
    const run = runEnvStep({
      token: '',
      requireAuth: 'false',
      coreRemaining: '0',
      withGh: false,
    });
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /::warning::gh authentication token is empty/);
    assert.match(run.output, /::warning::gh is not on PATH/);
    assert.doesNotMatch(run.output, /rate limit/);
  },
);

test(
  'a token with a line break is never written to GITHUB_ENV',
  { skip: !bashAvailable },
  () => {
    const run = runEnvStep({
      token: 'ghs_a\nEVIL=1',
      requireAuth: 'true',
    });
    assert.equal(run.status, 1);
    assert.equal(run.written, '');
  },
);
