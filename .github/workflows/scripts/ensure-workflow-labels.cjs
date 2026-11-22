/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const { execFileSync } = require('child_process');
const {
  applyLabelPlan,
  isQuotaError,
  listExistingLabels,
  planLabelChanges,
} = require('./lib/workflow-labels-diff.cjs');

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;
const MODES = ['diff', 'legacy'];

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function sleep(ms) {
  execFileSync(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`]);
}

function runGh(args) {
  return execFileSync('gh', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: process.env,
  });
}

// Label creation is idempotent repo setup, not PR validation: a transient
// GitHub API failure (observed: HTTP 500 on `gh label create --force`) must
// not fail the required job that happens to host this step — that parked a
// green PR on flow/checks-failed with nothing re-running the workflow.
// Retry briefly, then warn and continue.
function ensureLabel(name, label, { run = runGh, wait = sleep } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      run([
        'label',
        'create',
        name,
        '--color',
        label.color,
        '--description',
        label.description,
        '--force',
      ]);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        wait(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }
  const detail = String(lastError?.stderr ?? lastError?.message ?? lastError)
    .trim()
    .split('\n')[0];
  console.warn(
    `::warning::Could not ensure label "${name}" after ${MAX_ATTEMPTS} attempts (${detail}); continuing — labels are idempotent setup, not validation.`,
  );
  return false;
}

function assertDefined(names, labels) {
  for (const name of names) {
    if (!labels[name]) {
      // A label missing from policy.json is a repo config bug, not a
      // transient failure — keep this loud.
      throw new Error(`Label "${name}" is not defined in the policy file`);
    }
  }
}

// Per-label `gh label create --force` for every requested name (two REST
// calls per existing label). Kept as the rollback path and as the fallback
// when the label list cannot be read for a reason other than quota.
function ensureLabels(names, labels, options = {}) {
  let ensured = 0;
  for (const name of names) {
    assertDefined([name], labels);
    if (ensureLabel(name, labels[name], options)) ensured += 1;
  }
  return ensured;
}

// Reads the existing labels once and writes only the differences. If the read
// fails because the API quota is exhausted, the whole step is skipped: labels
// are steady-state present, and the per-label path would only add minutes of
// retry sleeps to the hosting job. Other read failures fall back to it.
function reconcileLabels(names, labels, options = {}) {
  const { run = runGh, wait = sleep, warn = console.warn } = options;
  assertDefined(names, labels);
  let existing;
  try {
    existing = listExistingLabels(run);
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error)
      .trim()
      .split('\n')[0];
    if (isQuotaError(error)) {
      warn(
        `::warning::Could not read repository labels (${detail}); GitHub API quota exhausted, skipping label setup — labels are idempotent setup, not validation.`,
      );
      return { mode: 'skipped', ensured: 0, total: names.length };
    }
    warn(
      `::warning::Could not read repository labels (${detail}); falling back to per-label setup.`,
    );
    return {
      mode: 'legacy',
      ensured: ensureLabels(names, labels, { run, wait }),
      total: names.length,
    };
  }
  const plan = planLabelChanges(names, labels, existing);
  const result = applyLabelPlan(plan, { run, wait, warn });
  return {
    mode: 'diff',
    ...result,
    unchanged: plan.unchanged,
    ensured: plan.unchanged + result.created + result.updated,
    total: names.length,
  };
}

function resolveMode(value) {
  const mode = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!mode) return 'diff';
  if (MODES.includes(mode)) return mode;
  console.warn(
    `::warning::Unknown label setup mode "${value}"; using "diff" (allowed: ${MODES.join(', ')}).`,
  );
  return 'diff';
}

function main() {
  const policyFile = getArg('--policy-file') ?? '.github/workflows/policy.json';
  const mode = resolveMode(getArg('--mode'));
  const requestedNames = (getArg('--names') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  const labels = policy.labels ?? {};
  const names =
    requestedNames.length > 0 ? requestedNames : Object.keys(labels);

  if (mode === 'legacy') {
    const ensured = ensureLabels(names, labels);
    console.log(`Ensured ${ensured}/${names.length} workflow labels.`);
    return;
  }
  const result = reconcileLabels(names, labels);
  if (result.mode === 'diff') {
    console.log(
      `Workflow labels: ${result.unchanged} unchanged, ${result.created} created, ${result.updated} updated, ${result.failed} failed of ${result.total}.`,
    );
  } else {
    console.log(
      `Ensured ${result.ensured}/${result.total} workflow labels (${result.mode}).`,
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = { ensureLabel, ensureLabels, reconcileLabels, resolveMode };
