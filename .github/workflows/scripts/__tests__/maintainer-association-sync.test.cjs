/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// The maintainer association set is enforced by policy.json at runtime
// (resolve JS gates, issue-catch-up, triage's dispatch gate), but GitHub
// Actions expressions cannot read files: deepseek-code-review.yml spells
// the associations out in its concurrency group and resolve-pr `if`, and
// triage.yml in two fromJSON lists. If policy.json ever drifts from those
// literals, the concurrency group is the one surface that drifts weak — a
// stale association can cancel an in-progress review (cancel-in-progress)
// before the resolve gate rejects the new run. This test pins every literal
// to the policy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowsDir = path.join(__dirname, '..', '..');
const policy = JSON.parse(
  fs.readFileSync(path.join(workflowsDir, 'policy.json'), 'utf8'),
);
const expected = [...policy.maintainerAssociations].sort();

function readWorkflow(name) {
  return fs.readFileSync(path.join(workflowsDir, name), 'utf8');
}

test('deepseek-code-review association literals match policy.maintainerAssociations', () => {
  const content = readWorkflow('deepseek-code-review.yml');
  const literals = [
    ...content.matchAll(
      /github\.event\.comment\.author_association == '([A-Z_]+)'/g,
    ),
  ].map((m) => m[1]);
  // One literal set in the concurrency group, one in the resolve-pr job `if`.
  assert.ok(literals.length >= 2, 'expected gated association literals');
  assert.deepEqual([...new Set(literals)].sort(), expected);
});

test('triage.yml fromJSON author-gate lists match policy.maintainerAssociations', () => {
  const content = readWorkflow('triage.yml');
  const lists = [
    ...content.matchAll(
      /fromJSON\('(\[[^']+\])'\),\s*github\.event\.(?:issue|comment)\.author_association\)/g,
    ),
  ].map((m) => JSON.parse(m[1]));
  // One gate for the `issues` event, one for `issue_comment`.
  assert.ok(lists.length >= 2, 'expected both author gates');
  for (const list of lists) {
    assert.deepEqual([...list].sort(), expected);
  }
});
