/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// A composite action whose metadata is misshapen is rejected by the runner
// ("Unexpected value 'default'") before any step runs, so every job calling it
// fails at once. YAML parsers accept the misplaced keys, hence this structural
// check over every local action.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ACTIONS_DIR = path.join(__dirname, '..', '..', '..', 'actions');
const TOP_LEVEL = new Set([
  'name',
  'author',
  'description',
  'branding',
  'inputs',
  'outputs',
  'runs',
]);
const INPUT_KEYS = new Set([
  'description',
  'required',
  'default',
  'deprecationMessage',
]);
const OUTPUT_KEYS = new Set(['description', 'value']);

function localActions() {
  return fs
    .readdirSync(ACTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(ACTIONS_DIR, entry.name);
      const file = ['action.yml', 'action.yaml']
        .map((name) => path.join(dir, name))
        .find((candidate) => fs.existsSync(candidate));
      return file ? { name: entry.name, file } : null;
    })
    .filter(Boolean);
}

test('there are local actions to check', () => {
  assert.ok(localActions().length > 3);
});

for (const { name, file } of localActions()) {
  test(`${name} action metadata has the shape the runner accepts`, () => {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));

    for (const key of Object.keys(doc)) {
      assert.ok(TOP_LEVEL.has(key), `unexpected top-level key "${key}"`);
    }
    assert.ok(doc.runs, 'runs is required');

    for (const [inputName, input] of Object.entries(doc.inputs ?? {})) {
      assert.equal(
        typeof input,
        'object',
        `input ${inputName} must be a mapping`,
      );
      for (const key of Object.keys(input ?? {})) {
        assert.ok(
          INPUT_KEYS.has(key),
          `input ${inputName} has unexpected key "${key}"`,
        );
      }
    }

    for (const [outputName, output] of Object.entries(doc.outputs ?? {})) {
      for (const key of Object.keys(output ?? {})) {
        assert.ok(
          OUTPUT_KEYS.has(key),
          `output ${outputName} has unexpected key "${key}"`,
        );
      }
      if (doc.runs?.using === 'composite') {
        assert.ok(output?.value, `composite output ${outputName} needs value`);
      }
    }
  });
}

test('setup-environment keeps every documented input and its outputs', () => {
  const doc = yaml.load(
    fs.readFileSync(
      path.join(ACTIONS_DIR, 'setup-environment', 'action.yml'),
      'utf8',
    ),
  );
  for (const input of [
    'github-token',
    'gh-auth-mode',
    'require-gh-auth',
    'gsd-version',
    'actionlint-sha256',
  ]) {
    assert.ok(doc.inputs[input], `missing input ${input}`);
  }
  assert.deepEqual(Object.keys(doc.outputs), [
    'core-remaining',
    'rest-counter-preload',
  ]);
  assert.equal(doc.inputs['rest-counter'].default, 'true');
  const rateLimit = doc.runs.steps.find((step) => step.id === 'rate_limit');
  assert.equal(rateLimit.with['report-at-job-end'], 'true');
  assert.equal(rateLimit.with['rest-counter'], '${{ inputs.rest-counter }}');
  assert.equal(
    doc.outputs['rest-counter-preload'].value,
    '${{ steps.rate_limit.outputs.rest-counter-preload }}',
  );
  assert.ok(
    doc.runs.steps.every((step) => step.env?.NODE_OPTIONS === undefined),
  );
});

test('every opted-in workflow step loads the preload without overriding runner Node options', () => {
  const workflows = path.resolve(ACTIONS_DIR, '../workflows');
  const output = 'outputs.rest-counter-preload';
  let checked = 0;
  for (const file of fs
    .readdirSync(workflows)
    .filter((name) => /\.ya?ml$/.test(name))) {
    const source = fs.readFileSync(path.join(workflows, file), 'utf8');
    const references = source.split(output).length - 1;
    if (!references) continue;

    let wired = 0;
    for (const job of Object.values(yaml.load(source).jobs)) {
      const steps = job.steps ?? [];
      const setup = steps.findIndex((step) => step.id === 'setup_environment');
      for (const [index, step] of steps.entries()) {
        if (!step.env?.REST_COUNTER_PRELOAD) continue;
        const label = file + ' / ' + step.name;
        assert.ok(setup >= 0 && setup < index, label);
        assert.equal(
          steps[setup].uses,
          './.github/actions/setup-environment',
          label,
        );
        assert.equal(step.env.NODE_OPTIONS, undefined, label);
        assert.equal(
          step.env.REST_COUNTER_PRELOAD,
          '${{ steps.setup_environment.outputs.rest-counter-preload }}',
          label,
        );
        if (step.run) {
          assert.match(
            step.run,
            /preload=\(--require "\$REST_COUNTER_PRELOAD"\)/,
            label,
          );
          assert.match(step.run, /node "\$\{preload\[@\]\}"/, label);
        } else {
          assert.match(step.uses, /^actions\/github-script@/, label);
          assert.match(
            step.with.script,
            /try \{\s+if \(process.env.REST_COUNTER_PRELOAD\) require\(process.env.REST_COUNTER_PRELOAD\);\s+\} catch/,
            label,
          );
        }
        wired += 1;
      }
    }
    assert.equal(wired, references, file);
    checked += wired;
  }
  assert.ok(checked > 0);
});
