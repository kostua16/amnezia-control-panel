/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const { execFileSync } = require('child_process');

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function runGh(args) {
  execFileSync('gh', args, {
    stdio: 'inherit',
    env: process.env
  });
}

const policyFile = getArg('--policy-file') ?? '.github/workflows/policy.json';
const requestedNames = (getArg('--names') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
const labels = policy.labels ?? {};
const names = requestedNames.length > 0 ? requestedNames : Object.keys(labels);

for (const name of names) {
  const label = labels[name];
  if (!label) {
    throw new Error(`Label "${name}" is not defined in ${policyFile}`);
  }

  runGh([
    'label',
    'create',
    name,
    '--color',
    label.color,
    '--description',
    label.description,
    '--force'
  ]);
}
