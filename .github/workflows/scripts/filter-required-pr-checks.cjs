/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

function getArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeBucket(check) {
  const bucket = String(check.bucket ?? '').toLowerCase();
  const state = String(check.state ?? '').toLowerCase();

  if (['pass', 'fail', 'cancel', 'skip', 'pending'].includes(bucket)) {
    return bucket;
  }

  if (state === 'success') return 'pass';
  if (
    [
      'failure',
      'failed',
      'timed_out',
      'action_required',
      'startup_failure',
    ].includes(state)
  ) {
    return 'fail';
  }
  if (state === 'skipped') return 'skip';
  if (['cancelled', 'canceled'].includes(state)) return 'cancel';
  return 'pending';
}

function normalizeCheck(check, required) {
  const bucket = normalizeBucket(check);
  return {
    name: check.name ?? required.name,
    workflow: check.workflow ?? required.workflow ?? '',
    state: check.state ?? (bucket === 'pass' ? 'success' : 'pending'),
    bucket,
    link: check.link ?? '',
  };
}

function requiredChecksFromConfig(config) {
  return (config.checks?.required ?? []).flatMap((group) =>
    (group.names ?? []).map((name) => ({
      name,
      workflow: group.workflow ?? '',
    })),
  );
}

function matchesRequiredCheck(check, required) {
  if (check.name !== required.name) return false;
  if (!required.workflow) return true;
  return check.workflow === required.workflow;
}

function filterRequiredChecks(config, checks) {
  return requiredChecksFromConfig(config).map((required) => {
    const match = checks.find((check) => matchesRequiredCheck(check, required));
    if (match) {
      return normalizeCheck(match, required);
    }

    return {
      name: required.name,
      workflow: required.workflow,
      state: 'pending',
      bucket: 'pending',
      link: '',
    };
  });
}

function main() {
  const configFile = getArg('--config-file');
  const checksFile = getArg('--checks-file');

  if (!configFile || !checksFile) {
    throw new Error('--config-file and --checks-file are required.');
  }

  const config = readJson(configFile);
  const checks = readJson(checksFile);
  process.stdout.write(
    `${JSON.stringify(filterRequiredChecks(config, checks), null, 2)}\n`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  filterRequiredChecks,
  requiredChecksFromConfig,
};
