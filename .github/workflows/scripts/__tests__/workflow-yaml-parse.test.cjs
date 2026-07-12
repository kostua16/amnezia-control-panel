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
