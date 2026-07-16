/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const { execFileSync } = require('child_process');

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function sleep(ms) {
  execFileSync(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`]);
}

function runGh(args) {
  execFileSync('gh', args, {
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

function ensureLabels(names, labels, options = {}) {
  let ensured = 0;
  for (const name of names) {
    const label = labels[name];
    if (!label) {
      // A label missing from policy.json is a repo config bug, not a
      // transient failure — keep this loud.
      throw new Error(`Label "${name}" is not defined in the policy file`);
    }
    if (ensureLabel(name, label, options)) ensured += 1;
  }
  return ensured;
}

function main() {
  const policyFile = getArg('--policy-file') ?? '.github/workflows/policy.json';
  const requestedNames = (getArg('--names') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  const labels = policy.labels ?? {};
  const names =
    requestedNames.length > 0 ? requestedNames : Object.keys(labels);

  const ensured = ensureLabels(names, labels);
  console.log(`Ensured ${ensured}/${names.length} workflow labels.`);
}

if (require.main === module) {
  main();
}

module.exports = { ensureLabel, ensureLabels };
