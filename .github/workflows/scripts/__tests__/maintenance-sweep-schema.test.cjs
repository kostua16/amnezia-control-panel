/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariant: the maintenance sweep's category list must stay
// identical everywhere it appears — the JSON schema's categories.required,
// categories.properties keys, the issues_created[].category enum, and the
// prompt's category list. A partial edit (e.g. adding a category to required
// but not the enum) still validates as JSON Schema, yet silently drops created
// issues from aggregation or mislabels per-category outcomes. The schema is
// kept fully inline (no $defs/$ref) like every other json-schema in the fleet,
// so the per-category outcome block is deliberately duplicated and this file
// asserts the copies stay identical. It also pins the two hardening rules of
// the structured-report step: the sweep's run-zai call must not pass an inert
// track-progress input (resolve-track-progress forces false for
// schedule/workflow_dispatch events), and the step-summary writer must fence
// the payload with four backticks so model-authored JSON can neither break
// out of the markdown fence nor be rewritten on the way to the summary.
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
  const enumNames =
    schema.properties.issues_created.items.properties.category.enum;
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
    'issues_created[].category enum must match required',
  );
  assert.deepEqual(
    [...promptNames].sort(),
    [...expected].sort(),
    'prompt category list must match required',
  );
});

test('per-category outcome schema is identical and complete for every category', () => {
  const doc = loadWorkflow();
  const { schema } = loadSweepSchema(doc);

  const expectedOutcome = {
    type: 'object',
    additionalProperties: false,
    required: ['findings_count', 'issue_created'],
    properties: {
      findings_count: { type: 'integer', minimum: 0 },
      issue_created: { type: 'boolean' },
      skip_reason: {
        type: 'string',
        enum: ['no-findings', 'duplicate', 'error'],
      },
    },
  };
  for (const [name, def] of Object.entries(
    schema.properties.categories.properties,
  )) {
    assert.deepEqual(
      def,
      expectedOutcome,
      `category "${name}" must carry the full inline outcome schema ` +
        '(a drifted copy silently mislabels that category outcome)',
    );
  }
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

test('structured sweep report step fences the payload without rewriting it', () => {
  const doc = loadWorkflow();
  const reportStep = findStep(
    doc,
    (s) => s.name === 'Record structured sweep report',
    'named "Record structured sweep report"',
  );
  const run = reportStep.run;
  assert.match(
    run,
    /echo '````json'/,
    'the summary fence must use four backticks so a triple backtick in the payload cannot close it',
  );
  assert.match(run, /echo '````'/);
  assert.match(
    run,
    /echo "\$STRUCTURED_REPORT"/,
    'the payload must be echoed verbatim',
  );
  assert.doesNotMatch(
    run,
    /SANITIZED_REPORT/,
    'stripping backticks rewrites the report — escape the fence instead',
  );
});
