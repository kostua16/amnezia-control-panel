/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '..', 'audit-fix.yml');

function readWorkflow() {
  return fs.readFileSync(workflowPath, 'utf8');
}

test('audit-fix selects focus from github.run_number', () => {
  const workflow = readWorkflow();
  assert.match(workflow, /audit-focus\.cjs select/);
  assert.match(workflow, /--run-number "\$\{\{ github\.run_number \}\}"/);
});

test('audit-fix does not persist mutable cursor state', () => {
  const workflow = readWorkflow();
  assert.doesNotMatch(workflow, /audit-cursor\.cjs/);
  assert.doesNotMatch(workflow, /\.planning\/audit-cursor\.json/);
  assert.doesNotMatch(workflow, /advance audit focus cursor/i);
});

test('audit-fix validates changed files against the selected focus before gate', () => {
  const workflow = readWorkflow();
  const guardIndex = workflow.indexOf('Validate audit focus changes');
  const gateIndex = workflow.indexOf('Validate (CI-matching gate)');
  assert.ok(guardIndex > 0, 'focus validation step must exist');
  assert.ok(
    gateIndex > guardIndex,
    'focus validation must run before the gate',
  );
  assert.match(workflow, /audit-focus\.cjs validate-changed-files/);
});
