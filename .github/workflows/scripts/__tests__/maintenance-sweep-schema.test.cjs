/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariant: the maintenance sweep's category list must stay
// identical everywhere it appears — the JSON schema's categories.required,
// categories.properties keys, the $defs.category-name enum, and the prompt's
// category list. A partial edit (e.g. adding a category to required but not
// the enum) still validates as JSON Schema, yet silently drops created issues
// from aggregation or mislabels per-category outcomes. The same file also
// pins the two hardening rules of the structured-report step: the sweep's
// run-zai call must not pass an inert track-progress input (resolve-track-progress
// forces false for schedule/workflow_dispatch events), and the step-summary
// writer must strip backticks so model-authored JSON cannot break out of the
// markdown fence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const WORKFLOW_PATH = path.resolve(__dirname, '../../maintenance.yml');

function loadWorkflow() {
  return yaml.load(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
}

function findStep(doc, predicate, label) {
  const step = doc.jobs.maintenance.steps.find(predicate);
  assert.ok(step, `maintenance.yml must contain a step ${label}`);
  return step;
}

function loadSweepSchema(doc) {
  const claudeRun = findStep(
    doc,
    (s) => s.uses && s.uses.includes('run-zai'),
    'using the run-zai action',
  );
  assert.ok(
    claudeRun.with && typeof claudeRun.with['json-schema'] === 'string',
    'run-zai step must declare a json-schema input string',
  );
  return { claudeRun, schema: JSON.parse(claudeRun.with['json-schema']) };
}

test('sweep categories are identical across required, properties, enum, and prompt', () => {
  const doc = loadWorkflow();
  const { claudeRun, schema } = loadSweepSchema(doc);

  const required = schema.properties.categories.required;
  const propertyKeys = Object.keys(schema.properties.categories.properties);
  const enumNames = schema.$defs['category-name'].enum;
  const promptMatch = claudeRun.with.prompt.match(
    /exactly one entry per sweep category \(([^)]+)\)/,
  );
  assert.ok(
    promptMatch,
    'prompt must list the sweep categories in parentheses',
  );
  const promptNames = promptMatch[1].split(',').map((name) => name.trim());

  const expected = [
    'planning-health',
    'security-audit',
    'progress',
    'todo-fixme',
    'stale-issues',
  ];
  assert.deepEqual(
    required,
    expected,
    'categories.required must list every sweep category',
  );
  assert.deepEqual(
    [...propertyKeys].sort(),
    [...expected].sort(),
    'categories.properties keys must match required',
  );
  assert.deepEqual(
    [...enumNames].sort(),
    [...expected].sort(),
    '$defs.category-name enum must match required',
  );
  assert.deepEqual(
    [...promptNames].sort(),
    [...expected].sort(),
    'prompt category list must match required',
  );
});

test('per-category schema is shared via $defs, not duplicated per category', () => {
  const doc = loadWorkflow();
  const { schema } = loadSweepSchema(doc);

  for (const [name, def] of Object.entries(
    schema.properties.categories.properties,
  )) {
    assert.deepEqual(
      def,
      { $ref: '#/$defs/category-outcome' },
      `category "${name}" must reference the shared outcome definition`,
    );
  }
  assert.deepEqual(
    schema.properties.issues_created.items.properties.category,
    { $ref: '#/$defs/category-name' },
    'issues_created[].category must reference the shared name enum',
  );

  const outcome = schema.$defs['category-outcome'];
  assert.deepEqual(outcome.required, ['findings_count', 'issue_created']);
  assert.deepEqual(outcome.properties.skip_reason.enum, [
    'no-findings',
    'duplicate',
    'error',
  ]);
});

test('sweep run-zai call does not pass the inert track-progress input', () => {
  const doc = loadWorkflow();
  const { claudeRun } = loadSweepSchema(doc);
  assert.equal(
    claudeRun.with['track-progress'],
    undefined,
    'track-progress is forced false for schedule/workflow_dispatch by run-claude-params; ' +
      'an explicit value is a runtime no-op — add schedule support there first',
  );
});

test('structured sweep report step strips backticks before writing the summary', () => {
  const doc = loadWorkflow();
  const reportStep = findStep(
    doc,
    (s) => s.name === 'Record structured sweep report',
    'named "Record structured sweep report"',
  );
  const run = reportStep.run;
  assert.match(run, /SANITIZED_REPORT="\$\{STRUCTURED_REPORT\/\/\\`\/\}"/);
  assert.match(run, /echo "\$SANITIZED_REPORT"/);
  assert.doesNotMatch(run, /echo "\$STRUCTURED_REPORT"/);
});
