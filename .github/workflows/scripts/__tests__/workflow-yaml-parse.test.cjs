/* eslint-disable @typescript-eslint/no-require-imports */
// E2E structural invariant: every workflow YAML in .github/workflows/ must be
// parseable YAML with a `jobs` mapping. GitHub silently registers a run named
// after the workflow file path and fails it with 0 jobs when the file cannot
// be parsed — nothing in the gate caught that class of breakage before this
// test (e.g. a shell heredoc-style string in a `run: |` block whose
// continuation line dedented past the block scalar indentation).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github/workflows');

const workflowFiles = fs
  .readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

test('workflows directory contains workflow YAML files', () => {
  assert.ok(workflowFiles.length > 0, 'expected at least one workflow YAML');
});

for (const file of workflowFiles) {
  test(`${file} parses as YAML and defines a jobs mapping`, () => {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    let doc;
    try {
      doc = yaml.load(content);
    } catch (err) {
      assert.fail(`YAML parse error in ${file}: ${err.message}`);
    }
    assert.ok(
      doc && typeof doc === 'object',
      `${file} did not parse to a mapping`,
    );
    assert.ok(
      doc.jobs &&
        typeof doc.jobs === 'object' &&
        Object.keys(doc.jobs).length > 0,
      `${file} has no jobs mapping`,
    );
  });
}

test('G8a: privileged close jobs check out the current trusted main', () => {
  const workflow = yaml.load(
    fs.readFileSync(
      path.resolve(__dirname, '../../auto-pr-branch-cleanup.yml'),
      'utf8',
    ),
  );
  assert.deepEqual(workflow.on.pull_request_target, {
    branches: ['main'],
    types: ['closed'],
  });
  assert.equal(workflow.on.pull_request, undefined);
  for (const name of ['restore-deferred-proposal', 'delete-generated-branch']) {
    const job = workflow.jobs[name];
    assert.match(
      job.if,
      /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
      `${name} must ignore fork PRs`,
    );
    const checkoutIndex = job.steps.findIndex((step) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    const snapshotIndex = job.steps.findIndex(
      (step) => step.uses === './.github/actions/log-rate-limit',
    );
    assert.ok(checkoutIndex >= 0, `${name} must have a checkout step`);
    assert.ok(
      snapshotIndex > checkoutIndex,
      `${name} must check out before logging`,
    );
    const checkout = job.steps[checkoutIndex];
    assert.match(checkout.uses, /^actions\/checkout@[a-f0-9]{40}$/);
    assert.equal(checkout.with.ref, 'refs/heads/main');
    assert.equal(checkout.with['persist-credentials'], false);
  }
  assert.equal(
    workflow.jobs['cleanup-orphan-branches'].if,
    "github.event_name != 'pull_request_target'",
  );
});

test('G8b: Docker image publishing jobs use distinct rate-limit labels', () => {
  const workflow = yaml.load(
    fs.readFileSync(path.resolve(__dirname, '../../docker-image.yml'), 'utf8'),
  );
  for (const [job, label] of [
    ['publish', 'docker-publish'],
    ['publish-stack', 'docker-publish-stack'],
  ]) {
    const snapshot = workflow.jobs[job].steps.find(
      (step) => step.uses === './.github/actions/log-rate-limit',
    );
    assert.equal(snapshot?.with.label, label);
  }
});
